import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWaterfall } from '../src/file/waterfall';
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
    const instructions = [...(await source.visibleRows(new Set([FETCH])))].map((i) => rows[i]);
    expect(instructions).toHaveLength(943);
    expect(instructions.every((r) => r.type === INSTRUCTION)).toBe(true);
    // Packets come in fetch order, so their instructions do too.
    expect(instructions.map((r) => r.id)).toEqual(instructions.map((r) => r.id).sort((a, b) => a - b));
    expect(await source.visibleRows(new Set())).toHaveLength(2080);
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
  it('brings either end of a long miss into view, and its row with it', async () => {
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
    expect(c.xOf(packet.end! - 1)).toBeCloseTo(c.gutterW + (c.plotW * 2) / 3);
    expect(c.rowY(i)).toBeGreaterThanOrEqual(RULER);
    expect(c.rowY(i) + c.rowH).toBeLessThanOrEqual(c.height);
    await c.toSelectedEdge('start');
    expect(c.xOf(packet.events[0].cycle)).toBeCloseTo(c.gutterW + c.plotW / 3);
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
