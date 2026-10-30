// Decodes a waterfall file, proto/waterfall.proto, into plain objects, from the file as written or gzipped. Field
// comments are in the schema.
import { Reader, Wire } from './pb';

export const FORMAT_VERSION = 1;

export interface Waterfall {
  version: number;
  title: string;
  firstCycle: number;
  lastCycle: number;
  strings: string[];
  sites: Site[];
  types: Type[];
  rows: Row[];
  /** Index into types of the type in focus when the file opens. */
  focus: number;
}

export interface Site {
  event: number;
  instance: number;
  source: number;
  blocks: boolean;
}

export interface Type {
  name: number;
  stages: number[];
}

export interface Row {
  type: number;
  id: number;
  label: number[];
  segments: Segment[];
  end: number | null;
  endedBy: number;
  normalEnd: boolean;
  fields: Field[];
  events: Event[];
  parent: number | null;
}

export interface Segment {
  from: number;
  stage: number;
  held: number;
}

export type Effect = { kind: 'enters'; stage: number } | { kind: 'observes' } | { kind: 'ends' } | { kind: null };

export interface Event {
  cycle: number;
  site: number;
  effect: Effect;
  fields: Field[];
}

export interface Field {
  name: number;
  text: number;
  row: number | null;
  role: Role;
}

/** What a field naming another object means: that object is this one's parent, aborted it, or blocks it. */
export type Role = 'none' | 'parent' | 'abortedBy' | 'blockedBy';

/** Roles in the order of the schema's Role enum. */
export const ROLES: readonly Role[] = ['none', 'parent', 'abortedBy', 'blockedBy'];

export class WaterfallError extends Error {}

/** Reads a waterfall file's bytes, gzipped or not. A gzipped file starts with gzip's magic number, 1f 8b, and a
 *  waterfall file never does: its first byte is a protobuf field tag, and as a tag 0x1f would have wire type 7, which
 *  protobuf does not use. So the bytes say which it is, whatever the file is named. */
export async function readWaterfall(bytes: Uint8Array): Promise<Waterfall> {
  return decodeWaterfall(bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzip(bytes) : bytes);
}

/** Decompresses gzipped bytes with the browser's own DecompressionStream. */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    // The browser's own message, such as Chromium's "Failed to fetch", says nothing more.
    throw new WaterfallError('This gzipped file is damaged or cut short.');
  }
}

export function decodeWaterfall(bytes: Uint8Array): Waterfall {
  const w: Waterfall = { version: 0, title: '', firstCycle: 0, lastCycle: 0, strings: [], sites: [], types: [], rows: [], focus: 0 };
  const r = new Reader(bytes);
  try {
    while (!r.done()) {
      const [field, wire] = r.tag();
      if (field === 1 && wire === Wire.Varint) w.version = r.varint();
      else if (field === 2 && wire === Wire.Bytes) w.title = r.string();
      else if (field === 3 && wire === Wire.Varint) w.firstCycle = r.varint();
      else if (field === 4 && wire === Wire.Varint) w.lastCycle = r.varint();
      else if (field === 5 && wire === Wire.Bytes) w.strings.push(r.string());
      else if (field === 6 && wire === Wire.Bytes) w.sites.push(site(r.message()));
      else if (field === 7 && wire === Wire.Bytes) w.types.push(type(r.message()));
      else if (field === 8 && wire === Wire.Bytes) w.rows.push(row(r.message()));
      else if (field === 9 && wire === Wire.Varint) w.focus = r.varint();
      else r.skip(wire);
    }
  } catch (e) {
    if (e instanceof RangeError) throw new WaterfallError(`This is not a readable waterfall file: ${e.message}.`);
    throw e;
  }
  if (w.version !== FORMAT_VERSION) {
    throw new WaterfallError(
      w.version === 0
        ? 'This is not a waterfall file: it has no format version.'
        : `This waterfall file has format version ${w.version}; this viewer reads version ${FORMAT_VERSION}.`,
    );
  }
  if (w.strings.length === 0) w.strings.push('');
  return w;
}

function site(r: Reader): Site {
  const s: Site = { event: 0, instance: 0, source: 0, blocks: false };
  while (!r.done()) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === Wire.Varint) s.event = r.varint();
    else if (field === 2 && wire === Wire.Varint) s.instance = r.varint();
    else if (field === 3 && wire === Wire.Varint) s.source = r.varint();
    else if (field === 4 && wire === Wire.Varint) s.blocks = r.varint() !== 0;
    else r.skip(wire);
  }
  return s;
}

function type(r: Reader): Type {
  const t: Type = { name: 0, stages: [] };
  while (!r.done()) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === Wire.Varint) t.name = r.varint();
    else if (field === 2) r.varints(wire, t.stages);
    else r.skip(wire);
  }
  return t;
}

function row(r: Reader): Row {
  const row: Row = {
    type: 0, id: 0, label: [], segments: [], end: null, endedBy: 0, normalEnd: false, fields: [], events: [], parent: null,
  };
  while (!r.done()) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === Wire.Varint) row.type = r.varint();
    else if (field === 2 && wire === Wire.Varint) row.id = r.varint();
    else if (field === 3) r.varints(wire, row.label);
    else if (field === 4 && wire === Wire.Bytes) row.segments.push(segment(r.message()));
    else if (field === 5 && wire === Wire.Varint) row.end = r.varint();
    else if (field === 6 && wire === Wire.Varint) row.endedBy = r.varint();
    else if (field === 7 && wire === Wire.Varint) row.normalEnd = r.varint() !== 0;
    else if (field === 8 && wire === Wire.Bytes) row.fields.push(fieldOf(r.message()));
    else if (field === 9 && wire === Wire.Bytes) row.events.push(event(r.message()));
    else if (field === 10 && wire === Wire.Varint) row.parent = r.varint();
    else r.skip(wire);
  }
  return row;
}

function segment(r: Reader): Segment {
  const s: Segment = { from: 0, stage: 0, held: 0 };
  while (!r.done()) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === Wire.Varint) s.from = r.varint();
    else if (field === 2 && wire === Wire.Varint) s.stage = r.varint();
    else if (field === 3 && wire === Wire.Varint) s.held = r.varint();
    else r.skip(wire);
  }
  return s;
}

function event(r: Reader): Event {
  const e: Event = { cycle: 0, site: 0, effect: { kind: null }, fields: [] };
  while (!r.done()) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === Wire.Varint) e.cycle = r.varint();
    else if (field === 2 && wire === Wire.Varint) e.site = r.varint();
    else if (field === 3 && wire === Wire.Varint) e.effect = { kind: 'enters', stage: r.varint() };
    else if (field === 4 && wire === Wire.Varint) e.effect = (r.varint(), { kind: 'observes' });
    else if (field === 5 && wire === Wire.Varint) e.effect = (r.varint(), { kind: 'ends' });
    else if (field === 6 && wire === Wire.Bytes) e.fields.push(fieldOf(r.message()));
    else r.skip(wire);
  }
  return e;
}

function fieldOf(r: Reader): Field {
  const f: Field = { name: 0, text: 0, row: null, role: 'none' };
  while (!r.done()) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === Wire.Varint) f.name = r.varint();
    else if (field === 2 && wire === Wire.Varint) f.text = r.varint();
    else if (field === 3 && wire === Wire.Varint) f.row = r.varint();
    // A role from a later schema is read as none.
    else if (field === 4 && wire === Wire.Varint) f.role = ROLES[r.varint()] ?? 'none';
    else r.skip(wire);
  }
  return f;
}
