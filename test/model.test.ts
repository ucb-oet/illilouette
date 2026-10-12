import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWaterfall } from '../src/file/waterfall';
import { MemorySource } from '../src/model/memory';
import { effectText, fieldText, segmentAt, timeByStage } from '../src/model/present';

const load = (name: string) =>
  new MemorySource(decodeWaterfall(new Uint8Array(readFileSync(new URL(`./fixtures/${name}.waterfall.pb`, import.meta.url)))));

// The fixtures are made from a Chipyard checkout by scripts/make_fixtures.py and are not kept in the repo.
const haveFixtures = existsSync(new URL('./fixtures/sodor-rv32mi-p-illegal.waterfall.pb', import.meta.url));

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
    expect(fieldText(stall.fields[0], blocker, stall.cycle, stages)).toBe('blocker #3427 (in Execute)');
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
