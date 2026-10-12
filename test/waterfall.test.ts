import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Reader } from '../src/file/pb';
import { decodeWaterfall, WaterfallError } from '../src/file/waterfall';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
// The fixtures are made from a Chipyard checkout by scripts/make_fixtures.py and are not kept in the repo.
const haveFixtures = existsSync(new URL('./fixtures/sodor-rv32mi-p-illegal.waterfall.pb', import.meta.url));

describe.skipIf(!haveFixtures)('decodeWaterfall on Sodor', () => {
  // The JSON is the same file as Chipyard's eventtrace_waterfall.py wrote it, read back with the protobuf package.
  for (const name of ['sodor-rv32ui-p-add.cycle-48079-to-flush', 'sodor-rv32ui-p-add.from-0x80000000']) {
    it(`reads ${name} as the protobuf package does`, () => {
      const expected = JSON.parse(readFileSync(new URL(`./fixtures/${name}.expected.json`, import.meta.url), 'utf8'));
      expect(decodeWaterfall(fixture(`${name}.waterfall.pb`))).toEqual(expected);
    });
  }

  it('reads the full traces', () => {
    const add = decodeWaterfall(fixture('sodor-rv32ui-p-add.waterfall.pb'));
    expect(add.rows).toHaveLength(4707);
    const illegal = decodeWaterfall(fixture('sodor-rv32mi-p-illegal.waterfall.pb'));
    const trap = illegal.rows.find((r) => r.id === 3470)!;
    expect(illegal.strings[trap.endedBy]).toBe('trap');
    expect(trap.normalEnd).toBe(false);
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
    const bytes = fixture('sodor-rv32ui-p-add.cycle-48079-to-flush.waterfall.pb');
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
