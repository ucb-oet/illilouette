// What the drawing code asks for. It never touches the file: a source answers from a file loaded in the browser
// today, and from a server for large files later.
// TODO: a server-backed source with a version handshake, for files too large to load whole.
import type { Effect } from '../file/waterfall';

export interface Info {
  title: string;
  /** The first and last cycles with any event in the trace. */
  firstCycle: number;
  lastCycle: number;
  types: TypeInfo[];
  rowCount: number;
  summary: TypeSummary[];
}

export interface TypeInfo {
  name: string;
  stages: string[];
  /** The widest text at each label position, in characters, so that labels of one type line up. */
  labelWidths: number[];
  /** The longest ID, in characters. */
  idWidth: number;
  /** The types of the ancestors of its deepest row, its parent's first, for room to indent. */
  ancestorTypes: number[];
}

export interface TypeSummary {
  name: string;
  rows: number;
  /** Rows by the event that ended them, most common first. */
  ends: { name: string; normal: boolean; rows: number }[];
  /** Rows still live when the trace ends. */
  live: number;
}

/** One object, ready to draw. */
export interface RowView {
  index: number;
  type: number;
  id: number;
  label: string[];
  segments: SegmentView[];
  /** The first cycle drawn: its first stage's, or else its first event's. */
  start: number;
  /** The first cycle after its life; null while it is still live when the trace ends. */
  end: number | null;
  endedBy: string | null;
  normalEnd: boolean;
  fields: FieldView[];
  events: EventView[];
  /** Its parent's row, if any. */
  parent: number | null;
  /** The types of its ancestors, its parent's first; a row is indented once for each that is not hidden. */
  ancestorTypes: number[];
}

export interface SegmentView {
  from: number;
  /** The first cycle after the stage: the next stage's start, the row's end, or the cycle after the trace's last. */
  to: number;
  stage: number;
  /** Cycles, counting from `from`, in which the object was held in the stage. */
  held: number;
}

export interface FieldView {
  name: string;
  text: string;
  /** The row of the object this field names, if any. */
  row: number | null;
}

export interface EventView {
  cycle: number;
  name: string;
  source: string;
  instance: string;
  effect: Effect;
  fields: FieldView[];
}

/** An event of another row that names this one, such as a stall naming its blocker. */
export interface Referrer {
  row: number;
  cycle: number;
  event: string;
  field: string;
}

export interface Source {
  readonly info: Info;
  /** Rows first through last - 1. */
  rows(first: number, last: number): Promise<RowView[]>;
  /** A row alive at a cycle, or starting just after it, near the first such row. */
  rowAt(cycle: number): Promise<number>;
  /** The rows whose types are not hidden, in order. */
  visibleRows(hidden: ReadonlySet<number>): Promise<Uint32Array>;
  /** The row of an object, by ID and, when several types share IDs, type. */
  find(id: number, type?: number): Promise<number | null>;
  /** Events of other rows that name this one. */
  referrers(row: number): Promise<Referrer[]>;
}
