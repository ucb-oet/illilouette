import { describe, expect, it } from 'vitest';
import { MemorySource } from '../src/model/memory';
import { FETCH, INSTRUCTION, pipeline, staircase } from './build';

describe('MemorySource on the pipeline', async () => {
  const source = new MemorySource(pipeline());
  const rows = await source.rows(0, source.info.rowCount);

  it('gives each object its ancestors\' types, and each type its deepest row\'s', () => {
    expect(rows.map((r) => r.ancestorTypes)).toEqual([[], [], [FETCH], [], [FETCH], [], [], [FETCH], [], [FETCH], [], [], [FETCH]]);
    expect(source.info.types.map((t) => t.ancestorTypes)).toEqual([[], [FETCH]]);
  });

  it('draws a row from its first stage, or its first event, to the cycle after its end or the trace', () => {
    expect([rows[10].start, rows[10].segments[0].to]).toEqual([31, 33]);
    expect(rows[12].segments.at(-1)!.to).toBe(source.info.lastCycle + 1);
  });

  it('finds the events of other objects that name an object, and what it is to them', async () => {
    expect(await source.referrers(2)).toEqual([{ row: 4, cycle: 15, event: 'instruction.decode', field: 'by', role: 'blockedBy' }]);
    expect(await source.referrers(4)).toEqual([{ row: 7, cycle: 19, event: 'instruction.squash', field: 'by', role: 'abortedBy' }]);
    expect((await source.referrers(1)).map((x) => [x.row, x.field, x.role])).toEqual([[2, 'fetch', 'parent']]);
  });

  it('says which events find their object blocked, and counts the file\'s links by what they say', () => {
    const blocking = rows.flatMap((r) => r.events.filter((e) => e.blocks).map((e) => [r.index, e.name]));
    expect(blocking).toEqual([[3, 'fetch.miss'], [4, 'instruction.decode']]);
    // An instruction's packet is its parent, and so among the others.
    expect(source.info.links).toEqual({ aborted: 1, blocked: 1, other: 5 });
  });

  it('summarizes how each type\'s objects ended, most common first', () => {
    expect(source.info.summary).toEqual([
      { name: 'fetch', rows: 6, ends: [{ name: 'use', normal: true, rows: 5 }, { name: 'kill', normal: false, rows: 1 }], live: 0 },
      {
        name: 'instruction',
        rows: 7,
        ends: [
          { name: 'retire', normal: true, rows: 4 },
          { name: 'squash', normal: false, rows: 1 },
          { name: 'replay', normal: false, rows: 1 },
        ],
        live: 1,
      },
    ]);
  });

  it('lists the rows a filter leaves, in order', async () => {
    const list = async (types: number[], aborted: boolean) => [...(await source.visibleRows({ types: new Set(types), aborted }))];
    expect(await list([FETCH], false)).toEqual([0, 2, 4, 7, 9, 10, 12]);
    expect(await list([], true)).toEqual([0, 1, 2, 3, 4, 6, 8, 10, 11, 12]);
    expect(await list([FETCH], true)).toEqual([0, 2, 4, 10, 12]);
  });

  it('finds objects by ID, and by type when IDs repeat across types', async () => {
    expect(await source.find(3, INSTRUCTION)).toBe(9);
    expect(await source.find(3)).toBe(6);
    expect(await source.find(99)).toBeNull();
  });

  it('measures each type\'s widest label texts and IDs', () => {
    expect(source.info.types.map((t) => [t.labelWidths, t.idWidth])).toEqual([
      [[12], 1],
      [[12, 17], 1],
    ]);
  });
});

describe('MemorySource finding the row at a cycle', () => {
  it('lands near the first row alive at a cycle, or starting after it', async () => {
    const source = new MemorySource(staircase(200));
    const rows = await source.rows(0, source.info.rowCount);
    for (let cycle = source.info.firstCycle; cycle <= source.info.lastCycle; cycle += 3) {
      const relevant = (r: (typeof rows)[0]) => r.start > cycle || r.end === null || r.end > cycle;
      // After every object has ended, there is no such row.
      if (!rows.some(relevant)) continue;
      const i = await source.rowAt(cycle);
      expect(relevant(rows[i])).toBe(true);
      expect(i - rows.findIndex(relevant)).toBeLessThanOrEqual(8);
    }
  });
});
