// Reads protobuf's wire format: as much as the waterfall file's messages use.

export enum Wire {
  Varint = 0,
  Fixed64 = 1,
  Bytes = 2,
  Fixed32 = 5,
}

const utf8 = new TextDecoder();

export class Reader {
  pos: number;

  constructor(
    readonly buf: Uint8Array,
    start = 0,
    readonly end = buf.length,
  ) {
    this.pos = start;
  }

  done(): boolean {
    return this.pos >= this.end;
  }

  /** An unsigned varint. Values past 2^53 are not exact as JavaScript numbers, so they are rejected. */
  varint(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end) throw new RangeError('the file ends inside a number');
      const byte = this.buf[this.pos++];
      // Below bit 28, bitwise operators are exact; above it, multiply so that the value stays unsigned.
      value = shift < 28 ? value | ((byte & 0x7f) << shift) : value + (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) break;
      shift += 7;
      if (shift > 63) throw new RangeError('a number in the file is longer than 64 bits');
    }
    if (value > Number.MAX_SAFE_INTEGER) throw new RangeError(`a number in the file exceeds 2^53: ${value}`);
    return value;
  }

  /** The next field's number and wire type. */
  tag(): [number, Wire] {
    const tag = this.varint();
    return [Math.floor(tag / 8), (tag & 7) as Wire];
  }

  /** A length-delimited field's contents, as a reader over them. */
  message(): Reader {
    const length = this.varint();
    const start = this.pos;
    this.pos += length;
    if (this.pos > this.end) throw new RangeError('the file ends inside a message');
    return new Reader(this.buf, start, start + length);
  }

  string(): string {
    const r = this.message();
    return utf8.decode(r.buf.subarray(r.pos, r.end));
  }

  /** A repeated varint field's next values: several when packed, one when not. */
  varints(wire: Wire, into: number[]): void {
    if (wire === Wire.Bytes) {
      const r = this.message();
      while (!r.done()) into.push(r.varint());
    } else {
      into.push(this.varint());
    }
  }

  /** Skips a field this reader does not know, so that newer files with added fields still read. */
  skip(wire: Wire): void {
    switch (wire) {
      case Wire.Varint:
        this.varint();
        return;
      case Wire.Fixed64:
        this.pos += 8;
        return;
      case Wire.Bytes:
        this.message();
        return;
      case Wire.Fixed32:
        this.pos += 4;
        return;
      default:
        throw new RangeError(`unknown wire type ${wire as number}`);
    }
  }
}
