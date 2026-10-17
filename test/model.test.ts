import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWaterfall, type Waterfall } from '../src/file/waterfall';
import { MemorySource } from '../src/model/memory';
import { effectText, fieldText, segmentAt, timeByStage } from '../src/model/present';
import { Controller, RULER, ZOOM_STEP } from '../src/ui/controller';
import { arrowsShown, detailOf } from '../src/ui/render';
import { CHAR_EM, labelColumns, labelFontSize } from '../src/ui/labels';

const load = (name: string) =>
  new MemorySource(decodeWaterfall(new Uint8Array(readFileSync(new URL(`./fixtures/${name}.waterfall`, import.meta.url)))));

// The fixtures are waterfall files that Chipyard's `eventtrace waterfall` wrote, copied in; they are not kept in the
// repo. The README says where each comes from.
const haveFixtures = existsSync(new URL('./fixtures/rocket-rv64ui-p-add.waterfall', import.meta.url));

describe.skipIf(!haveFixtures)('MemorySource on rv32mi-p-illegal', () => {
  const source = haveFixtures ? load('sodor-rv32mi-p-illegal') : (undefined as never);
  const stages = haveFixtures ? source.info.types[0].stages : [];
  const row = async (id: number) => (await source.rows((await source.find(id))!, (await source.find(id))! + 1))[0];

  it('describes the stalled csrwi on the waterfall clock', async () => {
    const r = await row(3428);
    expect(r.label).toEqual(['0x800000e4', 'csrwi 1860, 8']);
    expect(r.events.map((e) => effectText(r, e, stages))).toEqual([
      'enters Decode at 41,403',
      'while in Decode',
      'enters Execute at 41,405',
      'enters Memory at 41,406',
      'enters Writeback at 41,407',
      'leaves Writeback after 41,407',
    ]);
    expect(timeByStage(r)).toEqual([
      { stage: 0, cycles: 2, held: 1 },
      { stage: 1, cycles: 1, held: 0 },
      { stage: 2, cycles: 1, held: 0 },
      { stage: 3, cycles: 1, held: 0 },
    ]);
  });

  it('says where a stall’s blocker was in that cycle', async () => {
    const r = await row(3428);
    const stall = r.events[1];
    const blocker = (await source.rows(stall.fields[0].row!, stall.fields[0].row! + 1))[0];
    expect(blocker.id).toBe(3427);
    expect(fieldText(stall.fields[0], blocker, stall.cycle, stages)).toBe('blocker instruction#3427 (in Execute)');
  });

  it('finds rows that name a row', async () => {
    const referrers = await source.referrers((await source.find(3428))!);
    expect(referrers.map((x) => [x.event, x.field])).toEqual([['instruction.stall', 'blocker']]);
  });

  it('marks a squash as not a normal end', async () => {
    const r = await row(3454);
    expect([r.end, r.endedBy, r.normalEnd]).toEqual([41442, 'squash', false]);
    expect(segmentAt(r, 41441)?.stage).toBe(0);
    expect(segmentAt(r, 41442)).toBeNull();
  });

  it('finds the row alive at a cycle', async () => {
    const i = await source.rowAt(41403);
    const [r] = await source.rows(i, i + 1);
    expect(r.start).toBeLessThanOrEqual(41403);
    expect(r.end === null || r.end > 41403).toBe(true);
  });

  it('summarizes ends', () => {
    const [s] = source.info.summary;
    expect(s.rows).toBe(3686);
    expect(s.ends.map((e) => [e.name, e.normal, e.rows])).toEqual([
      ['retire', true, 3640],
      ['squash', false, 35],
      ['flush', false, 8],
      ['trap', false, 1],
    ]);
    expect(s.live).toBe(2);
  });
});

describe.skipIf(!haveFixtures)('MemorySource on a window', () => {
  it('keeps objects created before the window, without labels', async () => {
    const source = load('sodor-rv32ui-p-add.cycle-48079-to-flush');
    const [a, b] = await source.rows(0, 2);
    expect([a.id, b.id]).toEqual([3944, 3945]);
    expect(a.label).toEqual(['', '']);
  });
});

// Rocket's types, parents' first.
const [FETCH, INSTRUCTION] = [0, 1];

describe.skipIf(!haveFixtures)('MemorySource on Rocket, with instructions under fetch packets', () => {
  const source = haveFixtures ? load('rocket-rv64ui-p-add') : (undefined as never);
  const all = async () => source.rows(0, source.info.rowCount);

  it('gives each instruction its packet as its ancestor', async () => {
    for (const r of await all()) expect(r.ancestorTypes).toEqual(r.type === INSTRUCTION ? [FETCH] : []);
    expect(source.info.types.map((t) => t.ancestorTypes)).toEqual([[], [FETCH]]);
  });

  it('describes a create event in the cycle its row starts, then the edge after it', async () => {
    const stages = source.info.types.map((t) => t.stages);
    const first = async (id: number, type: number) => {
      const [r] = await source.rows((await source.find(id, type))!, (await source.find(id, type))! + 1);
      return effectText(r, r.events[0], stages[type]);
    };
    // Stalled at decode, so it stays in Decode; issues at once; a packet.
    expect(await first(4, INSTRUCTION)).toBe('created in Decode at 412');
    expect(await first(60, INSTRUCTION)).toBe('created in Decode at 1,511 · enters Execute at 1,512');
    expect(await first(97, FETCH)).toMatch(/^created in S1 at [\d,]+ · enters S2 at [\d,]+$/);
  });

  it('lists the rows of the types shown, in file order', async () => {
    const rows = await all();
    const instructions = [...(await source.visibleRows({ types: new Set([FETCH]), abnormal: false }))].map((i) => rows[i]);
    expect(instructions).toHaveLength(943);
    expect(instructions.every((r) => r.type === INSTRUCTION)).toBe(true);
    // Packets come in fetch order, so their instructions do too.
    expect(instructions.map((r) => r.id)).toEqual(instructions.map((r) => r.id).sort((a, b) => a - b));
    expect(await source.visibleRows({ types: new Set(), abnormal: false })).toHaveLength(2080);
  });

  it('finds a row alive at a cycle near the first one, though rows under parents start out of order', async () => {
    const rows = await all();
    for (let cycle = source.info.firstCycle; cycle <= source.info.lastCycle; cycle += 7) {
      const relevant = (r: (typeof rows)[0]) => r.start > cycle || r.end === null || r.end > cycle;
      const i = await source.rowAt(cycle);
      expect(relevant(rows[i])).toBe(true);
      expect(i - rows.findIndex(relevant)).toBeLessThanOrEqual(8);
    }
  });
});

describe.skipIf(!haveFixtures)('Controller hiding a type', () => {
  const open = async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    return c;
  };

  it('opens with the label column wide enough for every label, up to 40% of the waterfall', async () => {
    const c = await open();
    const { fullW } = labelColumns(c.source.info, new Set(), labelFontSize(c.rowH) * CHAR_EM);
    expect(fullW).toBeGreaterThan(280);
    expect(c.gutterW).toBe(Math.round(fullW));
    const narrow = new Controller(c.source);
    narrow.setSize(600, 800);
    await narrow.home();
    expect(narrow.gutterW).toBe(240);
  });

  it('closes up the rows of a hidden type and opens them again', async () => {
    const c = await open();
    await c.toggleType(FETCH);
    expect(c.shownCount).toBe(943);
    expect((await c.rowAsync(c.rowAtPlace(0))).type).toBe(INSTRUCTION);
    expect(c.placeOf(0)).toBe(-1);
    expect(c.rowAtY(RULER + 1)).toBe(c.rowAtPlace(0));
    await c.toggleType(FETCH);
    expect(c.shownCount).toBe(2080);
    expect(c.placeOf(0)).toBe(0);
  });

  it('keeps the selected row in place', async () => {
    const c = await open();
    c.y0 = 600 * c.rowH;
    let instruction = c.rowAtY(RULER + 10 * c.rowH + 1)!;
    while ((await c.rowAsync(instruction)).type !== INSTRUCTION) instruction++;
    c.select(instruction);
    const y = c.rowY(instruction);
    await c.toggleType(FETCH);
    expect(c.rowY(instruction)).toBe(y);
    await c.toggleType(FETCH);
    expect(c.rowY(instruction)).toBe(y);
  });

  it('drops a selection whose type is hidden, and moves the selection over rows shown', async () => {
    const c = await open();
    c.select(0);
    await c.toggleType(FETCH);
    expect(c.selected).toBeNull();
    c.select(c.rowAtPlace(3));
    c.moveSelection(1);
    expect(c.selected).toBe(c.rowAtPlace(4));
  });
});

describe.skipIf(!haveFixtures)('Controller panning to a selected object’s start and end', () => {
  it('brings either end of a long miss into view, its row with it, and selects its first or last event’s cycle', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    const before = c.x0;
    await c.toSelectedEdge('end');
    expect(c.x0).toBe(before);
    const i = (await c.source.find(97, FETCH))!;
    const packet = await c.rowAsync(i);
    expect(packet.segments.map((s) => c.source.info.types[FETCH].stages[s.stage])).toContain('Miss');
    c.select(i);
    await c.toSelectedEdge('end');
    const last = packet.events[packet.events.length - 1].cycle;
    expect(c.column).toBe(last);
    expect(c.xOf(last)).toBeCloseTo(c.gutterW + (c.plotW * 2) / 3);
    expect(c.rowY(i)).toBeGreaterThanOrEqual(RULER);
    expect(c.rowY(i) + c.rowH).toBeLessThanOrEqual(c.height);
    await c.toSelectedEdge('start');
    expect(c.column).toBe(packet.events[0].cycle);
    expect(c.xOf(packet.events[0].cycle)).toBeCloseTo(c.gutterW + c.plotW / 3);
  });
});

describe.skipIf(!haveFixtures)('Controller jumping to an object', () => {
  it('says why it found nothing, and selects what it finds', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    expect(await c.jumpToObject(99999)).toBe(false);
    expect(c.notice).toBe('No object #99999 is in this file.');
    expect(await c.jumpToObject(97, 'packet')).toBe(false);
    expect(c.notice).toBe('No object type is named packet.');
    c.say('');
    expect(await c.jumpToObject(97, 'fetch')).toBe(true);
    expect(c.selected).toBe(await c.source.find(97, FETCH));
    expect(c.notice).toBe('');
  });
});

describe.skipIf(!haveFixtures)('The selected column', () => {
  it('moves by cycles, starting from the selected object’s first event, and stays on screen', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    await c.jumpToObject(60, 'instruction');
    expect(c.column).toBe(null);
    await c.moveColumn(1);
    expect(c.column).toBe(1511);
    for (let k = 0; k < 100; k++) await c.moveColumn(1);
    expect(c.column).toBe(1611);
    expect(c.xOf(1612)).toBeLessThanOrEqual(c.width);
    expect(c.xOf(1611)).toBeGreaterThanOrEqual(c.gutterW);
    c.selectColumn(c.source.info.lastCycle + 40);
    expect(c.column).toBe(c.source.info.lastCycle);
  });
});

describe.skipIf(!haveFixtures)('Cursors', () => {
  it('go on the edge where the selected cycle starts, once each, in order, named by their cycle unless named', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    c.insertCursor();
    expect(c.cursors).toEqual([]);
    expect(c.notice).toMatch(/^Select a cycle first/);
    c.selectColumn(1515);
    c.insertCursor();
    expect(c.naming).toBe(1515);
    c.nameCursor(1515, ' 1,515 ');
    c.selectColumn(1511);
    c.insertCursor();
    c.nameCursor(1511, 'decode');
    c.insertCursor();
    expect(c.naming).toBe(null);
    expect(c.cursors).toEqual([
      { edge: 1511, name: 'decode' },
      { edge: 1515, name: '' },
    ]);
    c.selectColumn(1513);
    c.deleteCursor();
    expect(c.cursors.length).toBe(2);
    c.selectColumn(1515);
    c.deleteCursor();
    expect(c.cursors).toEqual([{ edge: 1511, name: 'decode' }]);
  });

  it('go at the selected object’s start and after its end with I and A, and x takes the one A put', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    await c.insertAtSelectedEdge('start');
    expect(c.notice).toBe('Select an object first.');
    await c.jumpToObject(60, 'instruction');
    await c.insertAtSelectedEdge('start');
    c.nameCursor(1511, '');
    await c.insertAtSelectedEdge('end');
    expect(c.naming).toBe(1515);
    c.nameCursor(1515, '');
    // Instruction#60's life, 1,511–1,514, is the 4 cycles between them.
    expect(c.cursors.map((k) => k.edge)).toEqual([1511, 1515]);
    expect(c.column).toBe(1514);
    c.deleteCursor();
    expect(c.cursors.map((k) => k.edge)).toEqual([1511]);
  });
});

describe.skipIf(!haveFixtures)('Vim moves', () => {
  it('stop at the first and last rows, select rows on screen, and scroll the selection into place', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    c.moveSelection(1);
    c.moveSelection(-5);
    expect(c.placeOf(c.selected!)).toBe(0);
    c.moveSelection(9999);
    expect(c.placeOf(c.selected!)).toBe(c.shownCount - 1);
    await c.selectEdgeRow('first');
    expect(c.selected).toBe(c.rowAtPlace(0));
    await c.selectEdgeRow('last');
    expect(c.selected).toBe(c.rowAtPlace(c.shownCount - 1));
    expect(c.rowY(c.selected!) + c.rowH).toBeLessThanOrEqual(c.height);
    c.y0 = 500 * c.rowH + 7;
    c.selectScreenRow('top');
    expect(c.rowY(c.selected!)).toBeGreaterThanOrEqual(RULER);
    expect(c.rowY(c.selected!)).toBeLessThan(RULER + c.rowH);
    c.selectScreenRow('bottom');
    expect(c.rowY(c.selected!) + c.rowH).toBeLessThanOrEqual(c.height);
    expect(c.rowY(c.selected!) + 2 * c.rowH).toBeGreaterThan(c.height);
    c.scrollSelectedTo('top');
    expect(c.rowY(c.selected!)).toBe(RULER);
    c.scrollSelectedTo('bottom');
    expect(c.rowY(c.selected!) + c.rowH).toBe(c.height);
    c.scrollSelectedTo('middle');
    expect(c.rowY(c.selected!) + c.rowH / 2).toBeCloseTo((RULER + c.height) / 2);
  });

  it('go through the selected object\'s events with ] and [, counts included', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    // instruction#35's events: decode at 594, memory, writeback, and a replay marked and taken at 597.
    await c.jumpToObject(35, 'instruction');
    await c.moveEvent(1);
    expect(c.column).toBe(594);
    await c.moveEvent(1, 2);
    expect(c.column).toBe(596);
    await c.moveEvent(1);
    expect(c.column).toBe(597);
    c.say('');
    await c.moveEvent(1);
    expect([c.column, c.notice]).toEqual([597, 'instruction#35 has no later event.']);
    await c.moveEvent(-1, 3);
    expect(c.column).toBe(594);
  });
});

describe('Paragraphs three levels deep', () => {
  // fetch#0 > instruction#0 > vuop#0–2, instruction#1; fetch#1 > instruction#2.
  const plan: [number, number, number | null][] = [[0, 0, null], [1, 0, 0], [2, 0, 1], [2, 1, 1], [2, 2, 1], [1, 1, 0], [0, 1, null], [1, 2, 6]];
  const w: Waterfall = {
    version: 1,
    title: 'three levels',
    firstCycle: 0,
    lastCycle: 20,
    strings: ['', 'fetch', 'instruction', 'vuop', 'S'],
    sites: [],
    types: [1, 2, 3].map((name) => ({ name, stages: [4] })),
    rows: plan.map(([type, id, parent], i) => ({
      type, id, label: [], segments: [{ from: i, stage: 0, held: 0 }], end: i + 2, endedBy: 0, normalEnd: true, fields: [], events: [], parent,
    })),
  };
  it('go past a row with rows under it, and out of its parent\'s rows from one without', async () => {
    const c = new Controller(new MemorySource(w));
    c.setSize(1200, 800);
    await c.home();
    const at = async (row: number, step: 1 | -1, times = 1) => {
      c.select(row);
      await c.moveParagraph(step, times);
      return c.selected;
    };
    // From a vuop, out of the instruction's vuops; from an instruction with vuops, past them.
    expect(await at(2, 1)).toBe(5);
    expect(await at(1, 1)).toBe(5);
    // From an instruction with nothing under it, out of its packet's instructions; from a packet, to the next.
    expect(await at(5, 1)).toBe(6);
    expect(await at(0, 1)).toBe(6);
    // Back: from a row with nothing under it to its parent; from a packet to the previous one.
    expect(await at(4, -1)).toBe(1);
    expect(await at(5, -1)).toBe(0);
    expect(await at(6, -1)).toBe(0);
    // A count repeats from wherever each step lands.
    expect(await at(2, 1, 2)).toBe(6);
  });
});

describe.skipIf(!haveFixtures)('Paragraphs and columns', () => {
  it('move by a row and the rows under it with } and {', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    const row = (type: number, id: number) => c.source.find(id, type) as Promise<number>;
    // Rows open fetch#0, instruction#0, fetch#1, instruction#1: } from a packet skips its instruction.
    c.select(await row(FETCH, 0));
    await c.moveParagraph(1);
    expect(c.selected).toBe(await row(FETCH, 1));
    await c.moveParagraph(-1);
    expect(c.selected).toBe(await row(FETCH, 0));
    await c.moveParagraph(1, 3);
    expect(c.selected).toBe(await row(FETCH, 3));
    // From an instruction, } goes to the next row no deeper: here the next packet.
    c.select(await row(INSTRUCTION, 0));
    await c.moveParagraph(1);
    expect(c.selected).toBe(await row(FETCH, 1));
    // With packets hidden, instructions are the top level, and } goes from one to the next.
    await c.toggleType(FETCH);
    c.select(await row(INSTRUCTION, 0));
    await c.moveParagraph(1);
    expect(c.selected).toBe(await row(INSTRUCTION, 1));
  });

  it('walk down and up the selected cycle with J and K, starting from the top with nothing selected', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    const all = await c.source.rows(0, c.source.info.rowCount);
    const at = all.filter((r) => segmentAt(r, 1511) !== null || r.events.some((e) => e.cycle === 1511)).map((r) => r.index);
    expect(at.length).toBeGreaterThan(2);
    await c.moveInColumn(1);
    expect(c.notice).toMatch(/^Select a cycle first/);
    c.selectColumn(1511);
    await c.moveInColumn(1);
    expect(c.selected).toBe(at[0]);
    await c.moveInColumn(1, 2);
    expect(c.selected).toBe(at[2]);
    await c.moveInColumn(-1);
    expect([c.selected, c.column]).toEqual([at[1], 1511]);
    c.select(null);
    await c.moveInColumn(-1);
    expect(c.selected).toBe(at[at.length - 1]);
    c.say('');
    await c.moveInColumn(1);
    expect(c.notice).toBe('No object below has anything at cycle 1,511.');
  });
});

describe.skipIf(!haveFixtures)('Hiding objects that ended abnormally', () => {
  it('closes up their rows, clears a selection of one, and leaves them out of searches', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    // instruction#3 ended by a flush.
    const flushed = (await c.source.find(3, INSTRUCTION))!;
    c.select(flushed);
    await c.setSearch('instruction.flush');
    expect(c.search!.matches.length).toBe(53);
    await c.toggleAbnormal();
    // 168 killed packets, and 53 flushed, 32 squashed, 8 replayed, and 2 trapped instructions.
    expect(c.hiddenCount).toBe(263);
    expect(c.shownCount).toBe(2080 - 263);
    expect(c.placeOf(flushed)).toBe(-1);
    expect(c.selected).toBe(null);
    expect([c.search!.matches.length, c.search!.skipped]).toEqual([0, 53]);
    c.select(flushed);
    await c.focusSelected();
    expect(c.notice).toBe('instruction#3 ended by flush, and objects that ended abnormally are hidden; press o to show them.');
    await c.toggleType(FETCH);
    expect(c.hiddenCount).toBe(1137 + 95);
    await c.toggleAbnormal();
    expect(c.hiddenCount).toBe(1137);
  });
});

describe.skipIf(!haveFixtures)('The type in focus', () => {
  it('starts at the first type, cycles over shown types, and moves on when its type is hidden', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    expect(c.focusType).toBe(FETCH);
    c.cycleFocus(1);
    expect(c.focusType).toBe(INSTRUCTION);
    c.cycleFocus(1);
    expect(c.focusType).toBe(FETCH);
    c.cycleFocus(-1);
    expect(c.focusType).toBe(INSTRUCTION);
    await c.toggleType(INSTRUCTION);
    expect(c.focusType).toBe(FETCH);
    // With one type shown, there is nowhere else to go.
    c.cycleFocus(1);
    expect(c.focusType).toBe(FETCH);
    // With none shown, the focus stays, and goes to the first type shown again.
    await c.toggleType(FETCH);
    expect(c.focusType).toBe(FETCH);
    await c.toggleType(INSTRUCTION);
    expect(c.focusType).toBe(INSTRUCTION);
  });
});

describe.skipIf(!haveFixtures)('The hovered cycle', () => {
  it('follows the view when a key pans it', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    const x = c.gutterW + 100;
    c.hover = { row: null, cycle: c.cycleAtX(x), x, y: RULER + 50 };
    const before = c.hover.cycle!;
    c.panTime(10);
    expect(c.hover.cycle).toBe(before + 10);
  });
});

describe.skipIf(!haveFixtures)('Controller moving from the timeline bar', () => {
  it('scrolls rows to the first object in the new range', async () => {
    for (const name of ['rocket-rv64ui-p-add', 'sodor-rv32mi-p-illegal']) {
      const c = new Controller(load(name));
      c.setSize(1200, 800);
      await c.home();
      const { firstCycle, lastCycle } = c.source.info;
      for (let k = 1; k < 20; k++) {
        await c.moveToCycle(firstCycle + ((lastCycle - firstCycle) * k) / 20);
        // Below one row of margin, the first row on screen lives in the view's cycles.
        const r = await c.rowAsync(c.rowAtPlace(Math.floor(c.y0 / c.rowH) + 1));
        expect(r.start).toBeLessThan(c.x0 + c.visibleCycles);
        expect(r.end === null || r.end > c.x0).toBe(true);
      }
    }
  });
});

describe.skipIf(!haveFixtures)('Zoom sizes', () => {
  it('are whole pixels for rows, and for cells from 8 px per cycle; a key moves a pixel, and small turns add up', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    const widths: number[] = [];
    for (let k = 0; k < 5; k++) {
      c.zoomTime(c.gutterW, 1 / ZOOM_STEP, true);
      widths.push(c.cellW);
    }
    expect(widths.slice(0, 4)).toEqual([18, 14, 11, 9]);
    expect(widths[4]).toBeCloseTo(7.2);
    c.cellW = 22;
    for (let k = 0; k < 10; k++) c.zoomTime(c.gutterW, 0.99);
    expect(c.cellW).toBe(20);
    c.rowH = 2;
    c.zoomRows(1 / ZOOM_STEP, null, true);
    expect(c.rowH).toBe(1);
    c.zoomRows(ZOOM_STEP, null, true);
    expect(c.rowH).toBe(2);
    c.rowH = 18;
    for (let k = 0; k < 10; k++) c.zoomRows(1.01, null);
    expect(c.rowH).toBe(20);
  });
});

describe.skipIf(!haveFixtures)('Arrows when zoomed out', () => {
  it('go one zoom step after the label column loses its text, or the cells their letters', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    c.rowH = 13;
    c.zoomRows(1 / ZOOM_STEP, null);
    expect(c.rowH).toBeLessThan(12);
    expect(arrowsShown(c)).toBe(true);
    c.zoomRows(1 / ZOOM_STEP, null);
    expect(arrowsShown(c)).toBe(false);
    c.rowH = 18;
    c.cellW = 15;
    c.zoomTime(c.gutterW, 1 / ZOOM_STEP);
    expect(detailOf(c)).toBe('cells');
    expect(arrowsShown(c)).toBe(true);
    c.zoomTime(c.gutterW, 1 / ZOOM_STEP);
    expect(arrowsShown(c)).toBe(false);
  });
});
