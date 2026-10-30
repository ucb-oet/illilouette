// Searches: one term, either text in an object's label or a named field or event, type first, as the trace names its
// events. The rules are the plan's "Jump box and search"; none of them is a trace rule.
//
//   csrr, sw gp                               label text, ignoring case; a bare 0x number matches label numbers by value
//   instruction.pc=0x80000050                 an object's own field
//   instruction.mark_replay.cause=cache_nack  a field of one of its events
//   instruction.flush                         objects with that event
//   *.pc=…, instruction.*.cause=…             * stands for any one whole type or event name

export type Query =
  | { kind: 'label'; text: string }
  | { kind: 'field'; type: string; field: string; value: string }
  | { kind: 'event'; type: string; event: string; field: string | null; value: string | null };

/** A match: an object's row, and the cycle a jump to it selects. */
export interface Match {
  row: number;
  cycle: number;
}

export interface SearchResult {
  /** In the order the rows are listed, top to bottom. */
  matches: Match[];
  /** Matching objects of hidden types, which are left out. */
  skipped: number;
}

/** A field, and the values it takes in the file, when few enough to offer. */
export interface FieldWords {
  name: string;
  values: string[] | null;
}

/** The names a search can use, from the file: each type's own fields, and its events and their fields. */
export interface TypeWords {
  name: string;
  fields: FieldWords[];
  events: { name: string; fields: FieldWords[] }[];
}

/** A field's values are offered when it takes this many or fewer, as a cause does; an address takes too many. */
export const MAX_OFFERED_VALUES = 24;

const NAME = /^(?:[A-Za-z_]\w*|\*)$/;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const list = (names: string[]) => (names.length ? names.join(', ') : 'none');

/** Reads a search, or says what is wrong with it. A dotted text whose first name is not a type, such as `fence.i`, is
 *  label text; with a value, it is a mistyped type. */
export function parseQuery(text: string, words: TypeWords[]): Query | { error: string } {
  const q = text.trim();
  const eq = q.indexOf('=');
  const path = (eq < 0 ? q : q.slice(0, eq)).trim();
  const value = eq < 0 ? null : q.slice(eq + 1).trim();
  const parts = path.split('.');
  const dotted = parts.length >= 2 && parts.every((p) => NAME.test(p));
  if (!dotted || parts.length > 3) {
    if (value !== null && dotted) return { error: `A search names at most a type, an event, and a field, as in instruction.mark_replay.cause=cache_nack.` };
    return { kind: 'label', text: q };
  }
  const [typeName, second, third] = parts;
  const types = typeName === '*' ? words : words.filter((t) => same(t.name, typeName));
  if (!types.length) {
    if (value === null) return { kind: 'label', text: q };
    return { error: `No object type is named ${typeName}. The types are ${list(words.map((t) => t.name))}.` };
  }
  const where = typeName === '*' ? 'any type' : types[0].name;
  // "instruction has no field pcc. Its fields are pc, bits, fetch.", or for *, "No type has a field pcc. …"
  const missing = (kind: string, name: string, have: string[]) =>
    typeName === '*'
      ? `No type has ${kind === 'event' ? 'an' : 'a'} ${kind} ${name}. The ${kind}s are ${list(have)}.`
      : `${where} has no ${kind} ${name}. Its ${kind}s are ${list(have)}.`;
  const fieldsOf = (ts: TypeWords[]) => [...new Set(ts.flatMap((t) => t.fields.map((f) => f.name)))];
  const eventsOf = (ts: TypeWords[]) => [...new Set(ts.flatMap((t) => t.events.map((e) => e.name)))];
  if (value === '') return { error: `Give a value after =, as in ${path}=…` };

  if (parts.length === 2) {
    if (second === '*') return { error: `Name an event, or give a field of any event a value, as in ${typeName}.*.cause=…` };
    const isField = fieldsOf(types).some((f) => same(f, second));
    const isEvent = eventsOf(types).some((e) => same(e, second));
    if (value !== null) {
      if (isField) return { kind: 'field', type: typeName, field: second, value };
      if (isEvent) return { error: `${second} is an event of ${where}. Give one of its fields a value, as in ${path}.${eventFieldExample(types, second)}=…` };
      return { error: missing('field', second, fieldsOf(types)) };
    }
    if (isEvent) return { kind: 'event', type: typeName, event: second, field: null, value: null };
    if (isField) return { error: `${second} is a field of ${where}. Give it a value, as in ${path}=…` };
    return { error: missing('event', second, eventsOf(types)) };
  }

  if (third === '*') return { error: '* stands for a type or an event, not a field.' };
  if (value === null) return { error: `Give the field a value, as in ${path}=…` };
  const events = types.flatMap((t) => t.events).filter((e) => second === '*' || same(e.name, second));
  if (!events.length) return { error: missing('event', second, eventsOf(types)) };
  const fields = [...new Set(events.flatMap((e) => e.fields.map((f) => f.name)))];
  if (!fields.some((f) => same(f, third))) {
    if (second === '*') return { error: `No event of ${where} has a field ${third}. Their fields are ${list(fields)}.` };
    if (!fields.length) return { error: `${second} has no fields.` };
    return { error: `${second} has no field ${third}. Its fields are ${list(fields)}.` };
  }
  return { kind: 'event', type: typeName, event: second, field: third, value };
}

function eventFieldExample(types: TypeWords[], event: string): string {
  const e = types.flatMap((t) => t.events).find((x) => same(x.name, event));
  return e?.fields[0]?.name ?? 'field';
}

function asNumber(s: string): bigint | null {
  const t = s.trim();
  if (/^0x[0-9a-f]+$/i.test(t) || /^\d+$/.test(t)) return BigInt(t);
  return null;
}

/** Whether a field's text is a search's value: numbers by value, so 0x80000050 is 0x0080000050; other texts, such as a
 *  cause or an object as type#id, whole, ignoring case. */
export function sameValue(text: string, value: string): boolean {
  const a = asNumber(text);
  const b = asNumber(value);
  if (a !== null && b !== null) return a === b;
  return same(text, value);
}

/** Whether label texts hold a search's text, ignoring case; a 0x number matches a label's numbers by value. */
export function labelHolds(texts: string[], text: string): boolean {
  const n = /^0x[0-9a-f]+$/i.test(text) ? BigInt(text) : null;
  if (n !== null) return texts.some((t) => t.split(/[^0-9A-Za-z_]+/).some((w) => /^0x[0-9a-f]+$/i.test(w) && BigInt(w) === n));
  const lower = text.toLowerCase();
  return texts.some((t) => t.toLowerCase().includes(lower));
}

export interface Suggestion {
  /** The box's whole text once the suggestion is taken. */
  text: string;
  /** What it is: a type, field, event, or value. */
  kind: 'type' | 'field' | 'event' | 'value';
}

const MAX_SUGGESTIONS = 16;

/** Completions for the text in the box, from the file's own names and values. */
export function suggest(text: string, words: TypeWords[]): Suggestion[] {
  const q = text.trimStart();
  const starts = (name: string, prefix: string) => name.toLowerCase().startsWith(prefix.toLowerCase());
  const eq = q.indexOf('=');
  const path = eq < 0 ? q : q.slice(0, eq);
  if (/\s/.test(path)) return [];
  const parts = path.split('.');
  if (!parts.slice(0, -1).every((p) => NAME.test(p))) return [];
  const out: Suggestion[] = [];

  if (parts.length === 1 && eq < 0) {
    // A type, when the text could be the start of one.
    if (!/^[A-Za-z_]*\*?$/.test(q)) return [];
    for (const t of words) if (starts(t.name, q)) out.push({ text: `${t.name}.`, kind: 'type' });
    if (q === '' || q === '*') out.push({ text: '*.', kind: 'type' });
    return out.slice(0, MAX_SUGGESTIONS);
  }
  const types = parts[0] === '*' ? words : words.filter((t) => same(t.name, parts[0]));
  if (!types.length) return [];
  const typeName = parts[0] === '*' ? '*' : types[0].name;

  if (eq >= 0) {
    // A value, for a field whose values are few.
    const prefix = q.slice(eq + 1).trim();
    let fields: FieldWords[] = [];
    if (parts.length === 2) fields = types.flatMap((t) => t.fields).filter((f) => same(f.name, parts[1]));
    else if (parts.length === 3)
      fields = types
        .flatMap((t) => t.events)
        .filter((e) => parts[1] === '*' || same(e.name, parts[1]))
        .flatMap((e) => e.fields)
        .filter((f) => same(f.name, parts[2]));
    const values = new Set<string>();
    for (const f of fields) for (const v of f.values ?? []) if (starts(v, prefix)) values.add(v);
    for (const v of [...values].sort()) out.push({ text: `${path}=${v}`, kind: 'value' });
    return out.slice(0, MAX_SUGGESTIONS);
  }

  if (parts.length === 2) {
    const prefix = parts[1];
    const fields = [...new Set(types.flatMap((t) => t.fields.map((f) => f.name)))];
    const events = [...new Set(types.flatMap((t) => t.events.map((e) => e.name)))];
    for (const f of fields) if (starts(f, prefix)) out.push({ text: `${typeName}.${f}=`, kind: 'field' });
    for (const e of events) if (starts(e, prefix)) out.push({ text: `${typeName}.${e}`, kind: 'event' });
    if (prefix === '' || prefix === '*') out.push({ text: `${typeName}.*.`, kind: 'event' });
    return out.slice(0, MAX_SUGGESTIONS);
  }

  if (parts.length === 3) {
    const prefix = parts[2];
    const fields = [
      ...new Set(
        types
          .flatMap((t) => t.events)
          .filter((e) => parts[1] === '*' || same(e.name, parts[1]))
          .flatMap((e) => e.fields.map((f) => f.name)),
      ),
    ];
    for (const f of fields) if (starts(f, prefix)) out.push({ text: `${typeName}.${parts[1]}.${f}=`, kind: 'field' });
  }
  return out.slice(0, MAX_SUGGESTIONS);
}
