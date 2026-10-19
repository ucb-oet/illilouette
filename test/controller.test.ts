import { describe, expect, it } from 'vitest';
import { MemorySource } from '../src/model/memory';
import { segmentAt } from '../src/model/present';
import { Controller, RULER, ZOOM_STEP } from '../src/ui/controller';
import { CHAR_EM, labelColumns, labelFontSize } from '../src/ui/labels';
import { arrowsShown, detailOf } from '../src/ui/render';
import { build, FETCH, INSTRUCTION, open, pipeline, staircase } from './build';

// 300 packets and their 240 instructions: every fifth packet is killed before decode.
const stairs = () => open(staircase(300));
const rowOf = (c: Controller, id: number, type: number) => c.source.find(id, type) as Promise<number>;

describe('Opening a file', () => {
  it('sets the label column wide enough for every label, up to 40% of the waterfall', async () => {
    const c = await stairs();
    const { fullW } = labelColumns(c.source.info, new Set(), labelFontSize(c.rowH) * CHAR_EM);
    expect(fullW).toBeGreaterThan(240);
    expect(c.gutterW).toBe(Math.round(fullW));
    const narrow = await open(staircase(300), 600, 800);
    expect(narrow.gutterW).toBe(240);
  });
});

describe('Hiding a type', () => {
  it('closes up its rows, and opens them again', async () => {
    const c = await stairs();
    await c.toggleType(FETCH);
    expect(c.shownCount).toBe(240);
    expect((await c.rowAsync(c.rowAtPlace(0))).type).toBe(INSTRUCTION);
    expect(c.placeOf(0)).toBe(-1);
    expect(c.rowAtY(RULER + 1)).toBe(c.rowAtPlace(0));
    await c.toggleType(FETCH);
    expect(c.shownCount).toBe(540);
    expect(c.placeOf(0)).toBe(0);
  });

  it('keeps the selected row in place', async () => {
    const c = await stairs();
    c.y0 = 200 * c.rowH;
    let row = c.rowAtY(RULER + 10 * c.rowH + 1)!;
    while ((await c.rowAsync(row)).type !== INSTRUCTION) row++;
    c.select(row);
    const y = c.rowY(row);
    await c.toggleType(FETCH);
    expect(c.rowY(row)).toBe(y);
    await c.toggleType(FETCH);
    expect(c.rowY(row)).toBe(y);
  });

  it('drops a selection of its type, and moves the selection over the rows shown', async () => {
    const c = await stairs();
    c.select(0);
    await c.toggleType(FETCH);
    expect(c.selected).toBeNull();
    c.select(c.rowAtPlace(3));
    c.moveSelection(1);
    expect(c.selected).toBe(c.rowAtPlace(4));
  });
});

describe('Hiding objects that ended abnormally', () => {
  it('closes up their rows, clears a selection of one, and leaves them out of searches', async () => {
    const c = await open(pipeline());
    // Row 7, instruction#2, was squashed.
    c.select(7);
    await c.setSearch('instruction.squash');
    expect(c.search!.matches.length).toBe(1);
    await c.toggleAbnormal();
    // fetch#2 killed, instruction#2 squashed, instruction#3 replayed.
    expect([c.hiddenCount, c.shownCount]).toEqual([3, 10]);
    expect(c.placeOf(7)).toBe(-1);
    expect(c.selected).toBe(null);
    expect([c.search!.matches.length, c.search!.skipped]).toEqual([0, 1]);
    c.select(7);
    await c.focusSelected();
    expect(c.notice).toBe('instruction#2 ended by squash, and objects that ended abnormally are hidden; press o to show them.');
    await c.toggleType(FETCH);
    expect(c.hiddenCount).toBe(6 + 2);
    await c.toggleAbnormal();
    expect(c.hiddenCount).toBe(6);
  });
});

describe('The type in focus', () => {
  it('starts at the first type, cycles over shown types, and moves on when its type is hidden', async () => {
    const c = await stairs();
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

describe('Panning to a selected object\'s start and end', () => {
  it('selects its first or last event\'s cycle, a third of the way in from that side, its row in view', async () => {
    const c = await stairs();
    const before = c.x0;
    await c.toSelectedEdge('end');
    expect(c.x0).toBe(before);
    // instruction#100: decode at 202, retired after 205.
    const i = await rowOf(c, 100, INSTRUCTION);
    c.select(i);
    await c.toSelectedEdge('end');
    expect(c.column).toBe(205);
    expect(c.xOf(205)).toBeCloseTo(c.gutterW + (c.plotW * 2) / 3);
    expect(c.rowY(i)).toBeGreaterThanOrEqual(RULER);
    expect(c.rowY(i) + c.rowH).toBeLessThanOrEqual(c.height);
    await c.toSelectedEdge('start');
    expect(c.column).toBe(202);
    expect(c.xOf(202)).toBeCloseTo(c.gutterW + c.plotW / 3);
  });
});

describe('Jumping to an object', () => {
  it('says why it found nothing, and selects what it finds', async () => {
    const c = await stairs();
    expect(await c.jumpToObject(99999)).toBe(false);
    expect(c.notice).toBe('No object #99999 is in this file.');
    expect(await c.jumpToObject(97, 'packet')).toBe(false);
    expect(c.notice).toBe('No object type is named packet.');
    c.say('');
    expect(await c.jumpToObject(97, 'fetch')).toBe(true);
    expect(c.selected).toBe(await rowOf(c, 97, FETCH));
    expect(c.notice).toBe('');
  });
});

describe('The selected column', () => {
  it('moves by cycles, starting from the selected object\'s first event, and stays on screen', async () => {
    const c = await stairs();
    await c.jumpToObject(100, 'instruction');
    expect(c.column).toBe(null);
    await c.moveColumn(1);
    expect(c.column).toBe(202);
    for (let k = 0; k < 100; k++) await c.moveColumn(1);
    expect(c.column).toBe(302);
    expect(c.xOf(303)).toBeLessThanOrEqual(c.width);
    expect(c.xOf(302)).toBeGreaterThanOrEqual(c.gutterW);
    c.selectColumn(c.source.info.lastCycle + 40);
    expect(c.column).toBe(c.source.info.lastCycle);
  });
});

describe('Cursors', () => {
  it('go on the edge where the selected cycle starts, once each, in order, named by their cycle unless named', async () => {
    const c = await stairs();
    c.insertCursor();
    expect(c.cursors).toEqual([]);
    expect(c.notice).toMatch(/^Select a cycle first/);
    c.selectColumn(215);
    c.insertCursor();
    expect(c.naming).toBe(215);
    c.nameCursor(215, ' 215 ');
    c.selectColumn(211);
    c.insertCursor();
    c.nameCursor(211, 'decode');
    c.insertCursor();
    expect(c.naming).toBe(null);
    expect(c.cursors).toEqual([
      { edge: 211, name: 'decode' },
      { edge: 215, name: '' },
    ]);
    c.selectColumn(213);
    c.deleteCursor();
    expect(c.cursors.length).toBe(2);
    c.selectColumn(215);
    c.deleteCursor();
    expect(c.cursors).toEqual([{ edge: 211, name: 'decode' }]);
  });

  it('go at the selected object\'s start and after its end with I and A, and x takes the one A put', async () => {
    const c = await stairs();
    await c.insertAtSelectedEdge('start');
    expect(c.notice).toBe('Select an object first.');
    await c.jumpToObject(100, 'instruction');
    await c.insertAtSelectedEdge('start');
    c.nameCursor(202, '');
    await c.insertAtSelectedEdge('end');
    expect(c.naming).toBe(206);
    c.nameCursor(206, '');
    // instruction#100's life, 202–205, is the 4 cycles between them.
    expect(c.cursors.map((k) => k.edge)).toEqual([202, 206]);
    expect(c.column).toBe(205);
    c.deleteCursor();
    expect(c.cursors.map((k) => k.edge)).toEqual([202]);
  });
});

describe('Vim moves', () => {
  it('stop at the first and last rows, select rows on screen, and scroll the selection into place', async () => {
    const c = await stairs();
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
    c.y0 = 200 * c.rowH + 7;
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
    const c = await stairs();
    // instruction#100: decode at 202, memory at 203, writeback at 204, retire at 205.
    await c.jumpToObject(100, 'instruction');
    await c.moveEvent(1);
    expect(c.column).toBe(202);
    await c.moveEvent(1, 2);
    expect(c.column).toBe(204);
    await c.moveEvent(1);
    expect(c.column).toBe(205);
    c.say('');
    await c.moveEvent(1);
    expect([c.column, c.notice]).toEqual([205, 'instruction#100 has no later event.']);
    await c.moveEvent(-1, 3);
    expect(c.column).toBe(202);
  });
});

describe('Paragraphs', () => {
  it('move by a row and the rows under it with } and {', async () => {
    const c = await stairs();
    // Rows open fetch#0, instruction#0, fetch#1, instruction#1: } from a packet skips its instruction.
    c.select(await rowOf(c, 0, FETCH));
    await c.moveParagraph(1);
    expect(c.selected).toBe(await rowOf(c, 1, FETCH));
    await c.moveParagraph(-1);
    expect(c.selected).toBe(await rowOf(c, 0, FETCH));
    await c.moveParagraph(1, 3);
    expect(c.selected).toBe(await rowOf(c, 3, FETCH));
    // From an instruction, out of its packet: to the next packet.
    c.select(await rowOf(c, 0, INSTRUCTION));
    await c.moveParagraph(1);
    expect(c.selected).toBe(await rowOf(c, 1, FETCH));
    // With packets hidden, instructions are the top level, and } goes from one to the next.
    await c.toggleType(FETCH);
    c.select(await rowOf(c, 0, INSTRUCTION));
    await c.moveParagraph(1);
    expect(c.selected).toBe(await rowOf(c, 1, INSTRUCTION));
  });

  it('go past a row with rows under it, and out of its parent\'s rows from one without, three levels deep', async () => {
    // fetch#0 > instruction#0 > vuop#0–2, instruction#1; fetch#1 > instruction#2.
    const plan: [number, number, number | undefined][] = [[0, 0, undefined], [1, 0, 0], [2, 0, 1], [2, 1, 1], [2, 2, 1], [1, 1, 0], [0, 1, undefined], [1, 2, 6]];
    const c = await open(
      build({
        firstCycle: 0,
        lastCycle: 20,
        types: ['fetch', 'instruction', 'vuop'].map((name) => ({ name, stages: ['S'] })),
        rows: plan.map(([type, id, parent], i) => ({ type, id, parent, segments: [[i, 0]], end: i + 2, endedBy: 'done', normalEnd: true })),
      }),
    );
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

describe('Walking a column with J and K', () => {
  it('goes down and up the selected cycle, starting from the top with nothing selected', async () => {
    const c = await stairs();
    const all = await c.source.rows(0, c.source.info.rowCount);
    const at = all.filter((r) => segmentAt(r, 205) !== null || r.events.some((e) => e.cycle === 205)).map((r) => r.index);
    // instruction#100 and #101, and fetch#102.
    expect(at.length).toBe(3);
    await c.moveInColumn(1);
    expect(c.notice).toMatch(/^Select a cycle first/);
    c.selectColumn(205);
    await c.moveInColumn(1);
    expect(c.selected).toBe(at[0]);
    await c.moveInColumn(1, 2);
    expect(c.selected).toBe(at[2]);
    await c.moveInColumn(-1);
    expect([c.selected, c.column]).toEqual([at[1], 205]);
    c.select(null);
    await c.moveInColumn(-1);
    expect(c.selected).toBe(at[2]);
    c.say('');
    await c.moveInColumn(1);
    expect(c.notice).toBe('No object below has anything at cycle 205.');
  });
});

describe('The hovered cycle', () => {
  it('follows the view when a key pans it', async () => {
    const c = await stairs();
    const x = c.gutterW + 100;
    c.hover = { row: null, cycle: c.cycleAtX(x), x, y: RULER + 50 };
    const before = c.hover.cycle!;
    c.panTime(10);
    expect(c.hover.cycle).toBe(before + 10);
  });
});

describe('Moving from the timeline bar', () => {
  it('scrolls rows to the first object in the new range', async () => {
    const c = await stairs();
    const { firstCycle, lastCycle } = c.source.info;
    for (let k = 1; k < 20; k++) {
      await c.moveToCycle(firstCycle + ((lastCycle - firstCycle) * k) / 20);
      // Below one row of margin, the first row on screen lives in the view's cycles.
      const r = await c.rowAsync(c.rowAtPlace(Math.floor(c.y0 / c.rowH) + 1));
      expect(r.start).toBeLessThan(c.x0 + c.visibleCycles);
      expect(r.end === null || r.end > c.x0).toBe(true);
    }
  });
});

describe('Zoom sizes', () => {
  it('are whole pixels for rows, and for cells from 8 px per cycle; a key moves a pixel, and small turns add up', async () => {
    const c = await stairs();
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

describe('Arrows when zoomed out', () => {
  it('go one zoom step after the label column loses its text, or the cells their letters', async () => {
    const c = await stairs();
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

describe('A source of no rows', () => {
  it('opens and moves without failing', async () => {
    const c = await open(build({ firstCycle: 0, lastCycle: 0, types: [{ name: 'instruction', stages: ['Decode'] }], rows: [] }));
    c.moveSelection(1);
    await c.selectEdgeRow('last');
    await c.moveParagraph(1);
    expect(c.selected).toBe(null);
    expect(new MemorySource(build({ firstCycle: 0, lastCycle: 0, types: [], rows: [] })).info.rowCount).toBe(0);
  });
});
