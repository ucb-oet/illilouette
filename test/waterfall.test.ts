import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Reader } from '../src/file/pb';
import { decodeWaterfall, WaterfallError } from '../src/file/waterfall';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
// The fixtures are waterfall files that Chipyard's `eventtrace waterfall` wrote, copied in; they are not kept in the
// repo. The README says where each comes from.
const haveFixtures = existsSync(new URL('./fixtures/rocket-rv64ui-p-add.waterfall', import.meta.url));

describe.skipIf(!haveFixtures)('decodeWaterfall on Chipyard’s files', () => {
  it('reads Sodor’s traces', () => {
    const add = decodeWaterfall(fixture('sodor-rv32ui-p-add.waterfall'));
    expect(add.rows).toHaveLength(4707);
    const illegal = decodeWaterfall(fixture('sodor-rv32mi-p-illegal.waterfall'));
    const trap = illegal.rows.find((r) => r.id === 3470)!;
    expect(illegal.strings[trap.endedBy]).toBe('trap');
    expect(trap.normalEnd).toBe(false);
    expect(illegal.rows.every((r) => r.parent === null)).toBe(true);
  });

  it('reads Rocket’s two types, each instruction under the packet its decode names', () => {
    const w = decodeWaterfall(fixture('rocket-rv64ui-p-add.waterfall'));
    const t = w.strings;
    expect(w.types.map((x) => [t[x.name], x.stages.map((s) => t[s])])).toEqual([
      ['instruction', ['Decode', 'Execute', 'Memory', 'Writeback']],
      ['fetch', ['S2', 'Miss', 'Queue', 'Buffer']],
    ]);
    expect(w.rows).toHaveLength(2080);
    w.rows.forEach((r, i) => {
      if (r.type === 1) return expect(r.parent).toBeNull();
      expect(r.parent).toBeLessThan(i);
      expect(w.rows[r.parent!].type).toBe(1);
      const fetch = r.events[0].fields.find((f) => t[f.name] === 'fetch')!;
      expect(fetch.row).toBe(r.parent);
      expect(t[fetch.text]).toBe(`fetch#${w.rows[r.parent!].id}`);
    });
  });
});

describe('decodeWaterfall', () => {
  it('rejects a file of another format version', () => {
    // version = 2
    expect(() => decodeWaterfall(new Uint8Array([0x08, 0x02]))).toThrow(
      new WaterfallError('This waterfall file has format version 2; this viewer reads version 1.'),
    );
  });

  it.skipIf(!haveFixtures)('rejects a file cut short', () => {
    const bytes = fixture('sodor-rv32ui-p-add.cycle-48079-to-flush.waterfall');
    expect(() => decodeWaterfall(bytes.subarray(0, bytes.length - 3))).toThrow(WaterfallError);
  });
});

describe('Reader.varint', () => {
  it('reads values past 32 bits exactly', () => {
    // 2^40 + 5
    const bytes = new Uint8Array([0x85, 0x80, 0x80, 0x80, 0x80, 0x20]);
    expect(new Reader(bytes).varint()).toBe(2 ** 40 + 5);
  });

  it('rejects values past 2^53', () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]);
    expect(() => new Reader(bytes).varint()).toThrow(RangeError);
  });
});
