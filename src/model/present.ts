// Text and facts derived from a row for display. These describe what the file already says; none applies a trace
// rule of its own.
import type { EventView, FieldView, RowView, SegmentView } from './source';

export const fmt = (n: number) => n.toLocaleString('en-US');

/** An object as the file's field values name one, such as "instruction#13". */
export const objectName = (type: string, id: number) => `${type}#${id}`;

export function segmentAt(row: RowView, cycle: number): SegmentView | null {
  for (const s of row.segments) if (cycle >= s.from && cycle < s.to) return s;
  return null;
}

/** What an event did, on the waterfall's clock: "enters Decode at 41,403", "while in Decode", "leaves Memory after 41,466".
 *  A row that starts in the cycle of the event that creates it is in its first stage during that cycle, and the
 *  event's own effect lands at the edge after it: "created in Decode at 629 · enters Execute at 630". */
export function effectText(row: RowView, e: EventView, stages: string[]): string {
  const at = segmentAt(row, e.cycle);
  const first = row.segments[0];
  if (e === row.events[0] && first?.from === e.cycle) {
    const created = `created in ${stages[first.stage]} at ${fmt(e.cycle)}`;
    if (e.effect.kind === 'enters' && e.effect.stage !== first.stage) return `${created} · enters ${stages[e.effect.stage]} at ${fmt(e.cycle + 1)}`;
    if (e.effect.kind === 'ends') return `${created} · leaves ${stages[first.stage]} after ${fmt(e.cycle)}`;
    return created;
  }
  switch (e.effect.kind) {
    case 'enters':
      return `enters ${stages[e.effect.stage]} at ${fmt(e.cycle + 1)}`;
    case 'observes':
      return at ? `while in ${stages[at.stage]}` : 'while in no stage';
    case 'ends':
      return at ? `leaves ${stages[at.stage]} after ${fmt(e.cycle)}` : `ends after ${fmt(e.cycle)}`;
    default:
      return '';
  }
}

/** A field as text; a field naming another object also says where that object was, when its row is given. */
export function fieldText(f: FieldView, other?: RowView, cycle?: number, stages?: string[]): string {
  if (other && cycle !== undefined && stages) {
    const s = segmentAt(other, cycle);
    if (s) return `${f.name} ${f.text} (in ${stages[s.stage]})`;
  }
  return `${f.name} ${f.text}`;
}

/** Cycles spent in each stage, in the order the stages were first entered. */
export function timeByStage(row: RowView): { stage: number; cycles: number; held: number }[] {
  const out: { stage: number; cycles: number; held: number }[] = [];
  for (const s of row.segments) {
    let entry = out.find((x) => x.stage === s.stage);
    if (!entry) out.push((entry = { stage: s.stage, cycles: 0, held: 0 }));
    entry.cycles += s.to - s.from;
    entry.held += s.held;
  }
  return out;
}

/** The short name of an event within its type, such as "stall" for "instruction.stall". */
export function shortName(event: string, type: string): string {
  return event.startsWith(`${type}.`) ? event.slice(type.length + 1) : event;
}
