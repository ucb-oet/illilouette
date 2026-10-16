// A source over a waterfall file loaded whole in the browser.
import type { Row, Waterfall } from '../file/waterfall';
import { shortName } from './present';
import { labelHolds, MAX_OFFERED_VALUES, sameValue, type FieldWords, type Match, type Query, type SearchResult, type TypeWords } from './search';
import type { Info, Referrer, RowFilter, RowView, Source, TypeSummary } from './source';

export class MemorySource implements Source {
  readonly info: Info;
  private readonly views: (RowView | undefined)[];
  private readonly starts: number[];
  /** The earliest start from each row on, which rises even though rows under their parents do not start in order. */
  private readonly laterStart: Float64Array;
  private readonly byId = new Map<string, number>();
  private referrersOf: Map<number, Referrer[]> | null = null;
  private wordsOf: TypeWords[] | null = null;

  constructor(private readonly w: Waterfall) {
    this.views = new Array(w.rows.length);
    this.starts = w.rows.map((r) => (r.segments.length ? r.segments[0].from : r.events.length ? r.events[0].cycle : w.firstCycle));
    this.laterStart = new Float64Array(this.starts.length);
    for (let i = this.starts.length - 1, min = Infinity; i >= 0; i--) this.laterStart[i] = min = Math.min(min, this.starts[i]);
    w.rows.forEach((r, i) => this.byId.set(`${r.type}#${r.id}`, i));
    const t = w.strings;
    this.info = {
      title: w.title,
      firstCycle: w.firstCycle,
      lastCycle: w.lastCycle,
      rowCount: w.rows.length,
      types: w.types.map((type, ti) => {
        const labelWidths: number[] = [];
        let idWidth = 1;
        let ancestors: number[] = [];
        for (const r of w.rows) {
          if (r.type !== ti) continue;
          r.label.forEach((s, k) => (labelWidths[k] = Math.max(labelWidths[k] ?? 0, t[s].length)));
          idWidth = Math.max(idWidth, String(r.id).length);
          if (r.parent !== null) {
            const a = ancestorTypes(w, r);
            if (a.length > ancestors.length) ancestors = a;
          }
        }
        return { name: t[type.name], stages: type.stages.map((s) => t[s]), labelWidths, idWidth, ancestorTypes: ancestors };
      }),
      summary: w.types.map((type, ti) => summarize(t[type.name], ti, w)),
    };
  }

  async rows(first: number, last: number): Promise<RowView[]> {
    const out: RowView[] = [];
    for (let i = Math.max(0, first); i < Math.min(last, this.w.rows.length); i++) out.push(this.view(i));
    return out;
  }

  async rowAt(cycle: number): Promise<number> {
    // Find the first row after which every row starts at or after the cycle, then step back over earlier rows still
    // alive at the cycle.
    let lo = 0;
    let hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.laterStart[mid] < cycle) lo = mid + 1;
      else hi = mid;
    }
    let i = Math.min(lo, this.starts.length - 1);
    for (let back = 0; back < 256 && i > 0; back++) {
      const prev = this.w.rows[i - 1];
      if (this.starts[i - 1] <= cycle && (prev.end === null || prev.end > cycle)) i--;
      else if (this.starts[i - 1] > cycle) i--;
      else break;
    }
    return Math.max(0, i);
  }

  async visibleRows(filter: RowFilter): Promise<Uint32Array> {
    const rows = this.w.rows;
    const out = new Uint32Array(rows.length);
    let n = 0;
    for (let i = 0; i < rows.length; i++) if (!hides(filter, rows[i])) out[n++] = i;
    return out.slice(0, n);
  }

  async find(id: number, type?: number): Promise<number | null> {
    if (type !== undefined) return this.byId.get(`${type}#${id}`) ?? null;
    for (let ti = 0; ti < this.w.types.length; ti++) {
      const i = this.byId.get(`${ti}#${id}`);
      if (i !== undefined) return i;
    }
    return null;
  }

  async referrers(row: number): Promise<Referrer[]> {
    if (!this.referrersOf) {
      const t = this.w.strings;
      const map = new Map<number, Referrer[]>();
      this.w.rows.forEach((r, i) => {
        for (const e of r.events) {
          for (const f of e.fields) {
            if (f.row === null || f.row === i) continue;
            const list = map.get(f.row) ?? [];
            list.push({ row: i, cycle: e.cycle, event: t[this.w.sites[e.site].event], field: t[f.name] });
            map.set(f.row, list);
          }
        }
      });
      this.referrersOf = map;
    }
    return this.referrersOf.get(row) ?? [];
  }

  async search(q: Query, filter: RowFilter): Promise<SearchResult> {
    const w = this.w;
    const t = w.strings;
    const typeNames = this.info.types.map((x) => x.name.toLowerCase());
    const matches: Match[] = [];
    let skipped = 0;
    w.rows.forEach((r, i) => {
      const first = r.events.length ? r.events[0].cycle : this.starts[i];
      let cycle: number | null = null;
      if (q.kind === 'label') {
        if (labelHolds(r.label.map((s) => t[s]), q.text)) cycle = first;
      } else if (q.type !== '*' && typeNames[r.type] !== q.type.toLowerCase()) {
        return;
      } else if (q.kind === 'field') {
        if (r.fields.some((f) => t[f.name].toLowerCase() === q.field.toLowerCase() && sameValue(t[f.text], q.value))) cycle = first;
      } else {
        const event = q.event.toLowerCase();
        const field = q.field?.toLowerCase();
        for (const e of r.events) {
          if (event !== '*' && shortName(t[w.sites[e.site].event], this.info.types[r.type].name).toLowerCase() !== event) continue;
          if (field !== undefined && !e.fields.some((f) => t[f.name].toLowerCase() === field && sameValue(t[f.text], q.value!))) continue;
          cycle = e.cycle;
          break;
        }
      }
      if (cycle === null) return;
      if (hides(filter, r)) skipped++;
      else matches.push({ row: i, cycle });
    });
    matches.sort((a, b) => a.cycle - b.cycle || a.row - b.row);
    return { matches, skipped };
  }

  async words(): Promise<TypeWords[]> {
    if (this.wordsOf) return this.wordsOf;
    const w = this.w;
    const t = w.strings;
    // Each field's distinct values, until there are too many to offer.
    type Values = Map<string, Set<string> | null>;
    const note = (fields: Values, name: string, text: string) => {
      if (!fields.has(name)) fields.set(name, new Set());
      const values = fields.get(name);
      if (!values) return;
      values.add(text);
      if (values.size > MAX_OFFERED_VALUES) fields.set(name, null);
    };
    const own = this.info.types.map((): Values => new Map());
    const events = this.info.types.map(() => new Map<string, Values>());
    for (const r of w.rows) {
      for (const f of r.fields) note(own[r.type], t[f.name], t[f.text]);
      for (const e of r.events) {
        const name = shortName(t[w.sites[e.site].event], this.info.types[r.type].name);
        if (!events[r.type].has(name)) events[r.type].set(name, new Map());
        for (const f of e.fields) note(events[r.type].get(name)!, t[f.name], t[f.text]);
      }
    }
    const listed = (fields: Values): FieldWords[] => [...fields].map(([name, values]) => ({ name, values: values ? [...values] : null }));
    this.wordsOf = this.info.types.map((type, ti) => ({
      name: type.name,
      fields: listed(own[ti]),
      events: [...events[ti]].map(([name, fields]) => ({ name, fields: listed(fields) })),
    }));
    return this.wordsOf;
  }

  private view(i: number): RowView {
    const cached = this.views[i];
    if (cached) return cached;
    const w = this.w;
    const t = w.strings;
    const r: Row = w.rows[i];
    const lastTo = r.end ?? w.lastCycle + 1;
    const fieldView = (f: { name: number; text: number; row: number | null }) => ({ name: t[f.name], text: t[f.text], row: f.row });
    const view: RowView = {
      index: i,
      type: r.type,
      id: r.id,
      label: r.label.map((s) => t[s]),
      segments: r.segments.map((s, k) => ({
        from: s.from,
        to: k + 1 < r.segments.length ? r.segments[k + 1].from : lastTo,
        stage: s.stage,
        held: s.held,
      })),
      start: this.starts[i],
      end: r.end,
      endedBy: r.end === null ? null : t[r.endedBy],
      normalEnd: r.normalEnd,
      fields: r.fields.map(fieldView),
      parent: r.parent,
      ancestorTypes: ancestorTypes(w, r),
      events: r.events.map((e) => {
        const site = w.sites[e.site];
        return { cycle: e.cycle, name: t[site.event], source: t[site.source], instance: t[site.instance], effect: e.effect, fields: e.fields.map(fieldView) };
      }),
    };
    this.views[i] = view;
    return view;
  }
}

/** Whether a filter hides a row: by its type, or as an object that ended without its type's normal end. */
function hides(filter: RowFilter, r: Row): boolean {
  return filter.types.has(r.type) || (filter.abnormal && r.end !== null && !r.normalEnd);
}

function ancestorTypes(w: Waterfall, r: Row): number[] {
  const types: number[] = [];
  // Parents come before their children, so a well-formed file cannot loop; the bound guards a malformed one.
  for (let p = r.parent; p !== null && p < w.rows.length && types.length < 64; p = w.rows[p].parent) types.push(w.rows[p].type);
  return types;
}

function summarize(name: string, type: number, w: Waterfall): TypeSummary {
  const ends = new Map<string, { name: string; normal: boolean; rows: number }>();
  let rows = 0;
  let live = 0;
  for (const r of w.rows) {
    if (r.type !== type) continue;
    rows++;
    if (r.end === null) {
      live++;
      continue;
    }
    const end = w.strings[r.endedBy];
    const entry = ends.get(end) ?? { name: end, normal: r.normalEnd, rows: 0 };
    entry.rows++;
    ends.set(end, entry);
  }
  return { name, rows, ends: [...ends.values()].sort((a, b) => b.rows - a.rows), live };
}
