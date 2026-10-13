import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWaterfall } from '../src/file/waterfall';
import { MemorySource } from '../src/model/memory';
import { effectText, fieldText, segmentAt, timeByStage } from '../src/model/present';
import { Controller, RULER } from '../src/ui/controller';

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

describe.skipIf(!haveFixtures)('MemorySource on Rocket, with instructions under fetch packets', () => {
  const source = haveFixtures ? load('rocket-rv64ui-p-add') : (undefined as never);
  const all = async () => source.rows(0, source.info.rowCount);

  it('gives each instruction its packet as its ancestor', async () => {
    for (const r of await all()) expect(r.ancestorTypes).toEqual(r.type === 0 ? [1] : []);
    expect(source.info.types.map((t) => t.ancestorTypes)).toEqual([[1], []]);
  });

  it('lists the rows of the types shown, in file order', async () => {
    const rows = await all();
    const instructions = [...(await source.visibleRows(new Set([1])))].map((i) => rows[i]);
    expect(instructions).toHaveLength(943);
    expect(instructions.every((r) => r.type === 0)).toBe(true);
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
    c.width = 1200;
    c.height = 800;
    await c.home();
    return c;
  };

  it('closes up the rows of a hidden type and opens them again', async () => {
    const c = await open();
    await c.toggleType(1);
    expect(c.shownCount).toBe(943);
    expect((await c.rowAsync(c.rowAtPlace(0))).type).toBe(0);
    expect(c.placeOf(0)).toBe(-1);
    expect(c.rowAtY(RULER + 1)).toBe(c.rowAtPlace(0));
    await c.toggleType(1);
    expect(c.shownCount).toBe(2080);
    expect(c.placeOf(0)).toBe(0);
  });

  it('keeps the selected row in place', async () => {
    const c = await open();
    c.y0 = 600 * c.rowH;
    let instruction = c.rowAtY(RULER + 10 * c.rowH + 1)!;
    while ((await c.rowAsync(instruction)).type !== 0) instruction++;
    c.select(instruction);
    const y = c.rowY(instruction);
    await c.toggleType(1);
    expect(c.rowY(instruction)).toBe(y);
    await c.toggleType(1);
    expect(c.rowY(instruction)).toBe(y);
  });

  it('drops a selection whose type is hidden, and moves the selection over rows shown', async () => {
    const c = await open();
    c.select(0);
    await c.toggleType(1);
    expect(c.selected).toBeNull();
    c.select(c.rowAtPlace(3));
    c.moveSelection(1);
    expect(c.selected).toBe(c.rowAtPlace(4));
  });
});
