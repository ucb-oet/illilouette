import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Reader } from '../src/file/pb';
import { decodeWaterfall, readWaterfall, WaterfallError } from '../src/file/waterfall';
import { encode, pipeline, staircase } from './build';

describe('decodeWaterfall', () => {
  it('reads back every field of a file', () => {
    const w = { ...pipeline(), focus: 1 };
    expect(decodeWaterfall(encode(w))).toEqual(w);
  });

  it('tells a parent at row 0 from none', () => {
    const stairs = decodeWaterfall(encode(staircase(3)));
    expect(stairs.rows.map((r) => r.parent)).toEqual([null, 0, null, 2, null, 4]);
  });

  it('rejects a file of another format version', () => {
    // version = 2
    expect(() => decodeWaterfall(new Uint8Array([0x08, 0x02]))).toThrow(
      new WaterfallError('This waterfall file has format version 2; this viewer reads version 1.'),
    );
  });

  it('rejects a file cut short', () => {
    const bytes = encode(pipeline());
    expect(() => decodeWaterfall(bytes.subarray(0, bytes.length - 3))).toThrow(WaterfallError);
  });
});

describe('readWaterfall', () => {
  it('reads a file as written or gzipped, by its first bytes', async () => {
    const bytes = encode(pipeline());
    expect(await readWaterfall(bytes)).toEqual(pipeline());
    expect(await readWaterfall(new Uint8Array(gzipSync(bytes)))).toEqual(pipeline());
  });

  it('rejects a gzipped file cut short, or one that is not a waterfall inside', async () => {
    const gzipped = gzipSync(encode(pipeline()));
    await expect(readWaterfall(new Uint8Array(gzipped.subarray(0, gzipped.length - 20)))).rejects.toThrow(
      new WaterfallError('This gzipped file is damaged or cut short.'),
    );
    await expect(readWaterfall(new Uint8Array(gzipSync('not a waterfall')))).rejects.toThrow(WaterfallError);
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
