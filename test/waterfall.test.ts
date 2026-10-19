import { describe, expect, it } from 'vitest';
import { Reader } from '../src/file/pb';
import { decodeWaterfall, WaterfallError } from '../src/file/waterfall';
import { encode, pipeline, staircase } from './build';

describe('decodeWaterfall', () => {
  it('reads back every field of a file', () => {
    const w = pipeline();
    expect(decodeWaterfall(encode(w))).toEqual(w);
  });

  it('tells a parent at row 0 from none, and a live object from one that ended', () => {
    const stairs = decodeWaterfall(encode(staircase(3)));
    expect(stairs.rows.map((r) => r.parent)).toEqual([null, 0, null, 2, null, 4]);
    const w = decodeWaterfall(encode(pipeline()));
    expect([w.rows[2].end, w.rows[12].end]).toEqual([16, null]);
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
