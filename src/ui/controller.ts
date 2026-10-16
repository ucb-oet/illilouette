// The viewer's state and navigation, shared by the canvas, which redraws from it, and the Preact panels, which
// subscribe to it. Rows come from the source in chunks and are cached here.
import { useEffect, useState } from 'preact/hooks';
import { fmt, objectName } from '../model/present';
import { parseQuery, type Match, type TypeWords } from '../model/search';
import type { RowView, Source } from '../model/source';
import { CHAR_EM, labelColumns, labelFontSize } from './labels';

const CHUNK = 256;
const MAX_CHUNKS = 64;

export const RULER = 28;
/** The factor one press of a zoom key zooms by. */
export const ZOOM_STEP = 1.25;
/** Cells this wide and up, drawn one by one, take whole pixels, so that their edges are crisp; narrower ones, drawn
 *  as runs, zoom smoothly. Rows always take whole pixels. */
export const WHOLE_CELLS = 8;

/** A size after a zoom by a factor, in whole pixels from `whole` up. A key press moves the drawn size at least a pixel;
 *  the wheel and pinch keep an exact level, so that their small turns add up. A drawn size set other than by zooming,
 *  as when a file opens, starts the exact level afresh. */
function zoomSize(drawn: number, exact: number, factor: number, key: boolean, min: number, max: number, whole: number) {
  const snap = (v: number) => (v >= whole ? Math.round(v) : v);
  const clampTo = (v: number) => Math.min(max, Math.max(min, v));
  if (key) {
    let next = clampTo(drawn * factor);
    if (next >= whole) {
      next = Math.round(next);
      if (next === drawn) next = clampTo(drawn + (factor > 1 ? 1 : -1));
    }
    return { drawn: next, exact: next };
  }
  const level = clampTo((snap(exact) === drawn ? exact : drawn) * factor);
  return { drawn: snap(level), exact: level };
}

/** A cursor on a clock edge, by the cycle the edge starts. An empty name shows as that cycle. */
export interface Cursor {
  edge: number;
  name: string;
}

export interface Hover {
  row: number | null;
  cycle: number | null;
  x: number;
  y: number;
}

export class Controller {
  /** The cycle at the timeline's left edge. */
  x0 = 0;
  /** Scroll offset of the rows, in pixels. */
  y0 = 0;
  /** Pixels per cycle. */
  cellW = 22;
  /** Pixels per row. */
  rowH = 22;
  /** The levels the wheel and pinch zoom to, of which cellW and rowH are the sizes drawn. */
  private cellLevel = 22;
  private rowLevel = 22;
  /** Width of the label column. */
  gutterW = 280;
  /** Size of the waterfall canvas, in CSS pixels. */
  width = 1;
  height = 1;
  hover: Hover | null = null;
  selected: number | null = null;
  /** The selected cycle, as vim's cursor column is to its current line. */
  column: number | null = null;
  hiddenTypes = new Set<number>();
  /** The type drawn in full; every other type keeps only its bars. A file opens with its first type in focus. */
  focusType = 0;
  /** Arrows for the selected row: from each object it names to it, and from it to each row that names it. */
  related: { from: number; to: number; cycle: number }[] = [];
  allArrows = false;
  /** Cursors on clock edges, in order. */
  cursors: Cursor[] = [];
  /** The edge of the cursor whose name is being typed, if any. */
  naming: number | null = null;
  /** Whether the list of keys is open. */
  helpOpen = false;
  /** The search in the jump box: its text, what is wrong with it if anything, its matches in time order, the rows they
   *  are on, and how many matching objects are of hidden types. Null while the box holds no search. */
  search: { text: string; error: string | null; matches: Match[]; rows: Set<number>; skipped: number } | null = null;
  /** The file's names for searches, once read. */
  words: TypeWords[] | null = null;
  /** A short note for the status bar, such as why a jump did nothing; it stays until the next key, click, or wheel. */
  notice = '';

  /** The rows on screen, in order, while a type is hidden; null while every row shows. */
  private shown: Uint32Array | null = null;
  /** Each row's place among the rows on screen, or -1 for a row of a hidden type; null while every row shows. */
  private place: Int32Array | null = null;
  /** Counts type toggles, so that a toggle whose rows arrive after a later one's is dropped. */
  private toggles = 0;
  /** Counts moves from the timeline bar, likewise. */
  private moves = 0;
  /** Counts searches, likewise. */
  private searches = 0;

  private markSized!: () => void;
  /** Resolves once the canvas has its size, which the view a file opens with depends on. */
  private readonly sized = new Promise<void>((resolve) => (this.markSized = resolve));

  private chunks = new Map<number, RowView[]>();
  private pending = new Set<number>();
  private listeners = new Set<() => void>();
  private redrawHook: (() => void) | null = null;

  constructor(readonly source: Source) {}

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.markSized();
  }

  get plotW(): number {
    return Math.max(1, this.width - this.gutterW);
  }
  get visibleCycles(): number {
    return this.plotW / this.cellW;
  }
  xOf(cycle: number): number {
    return this.gutterW + (cycle - this.x0) * this.cellW;
  }
  /** How many rows are on screen, counting those scrolled out of view. */
  get shownCount(): number {
    return this.shown ? this.shown.length : this.source.info.rowCount;
  }
  /** The row at a place among the rows on screen. */
  rowAtPlace(p: number): number {
    return this.shown ? this.shown[p] : p;
  }
  /** A row's place among the rows on screen, or -1 if its type is hidden. */
  placeOf(i: number): number {
    return this.place ? this.place[i] : i;
  }
  /** The place of a row, or of the first row on screen after it if its type is hidden. */
  private placeAtOrAfter(i: number): number {
    if (!this.shown) return i;
    let lo = 0;
    let hi = this.shown.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.shown[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(lo, Math.max(0, this.shown.length - 1));
  }
  rowY(i: number): number {
    return RULER + this.placeOf(i) * this.rowH - this.y0;
  }
  rowAtY(y: number): number | null {
    const p = Math.floor((y - RULER + this.y0) / this.rowH);
    return y > RULER && p >= 0 && p < this.shownCount ? this.rowAtPlace(p) : null;
  }
  cycleAtX(x: number): number | null {
    return x >= this.gutterW ? Math.floor(this.x0 + (x - this.gutterW) / this.cellW) : null;
  }

  /** A row if its chunk is loaded; otherwise asks for the chunk and returns undefined until it arrives. */
  row(i: number): RowView | undefined {
    const chunk = Math.floor(i / CHUNK);
    const rows = this.chunks.get(chunk);
    if (rows) {
      // Keep recently used chunks at the end of the map's order, for eviction.
      this.chunks.delete(chunk);
      this.chunks.set(chunk, rows);
      return rows[i - chunk * CHUNK];
    }
    this.load(chunk);
    return undefined;
  }

  async rowAsync(i: number): Promise<RowView> {
    const chunk = Math.floor(i / CHUNK);
    if (!this.chunks.has(chunk)) await this.load(chunk);
    return this.chunks.get(chunk)![i - chunk * CHUNK];
  }

  private async load(chunk: number): Promise<void> {
    if (this.pending.has(chunk)) return;
    this.pending.add(chunk);
    const rows = await this.source.rows(chunk * CHUNK, (chunk + 1) * CHUNK);
    this.pending.delete(chunk);
    this.chunks.set(chunk, rows);
    while (this.chunks.size > MAX_CHUNKS) this.chunks.delete(this.chunks.keys().next().value!);
    this.redraw();
  }

  // ---------------------------------------------------------------- notification
  /** Shows a note in the status bar, in place of the hover readout. */
  say(text: string): void {
    this.notice = text;
    this.changed();
  }
  onRedraw(hook: () => void): void {
    this.redrawHook = hook;
  }
  redraw(): void {
    this.redrawHook?.();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Redraws the canvas and tells the panels that state changed. */
  changed(): void {
    // The row and cycle under the pointer move with the view, as when a key pans it.
    if (this.hover) {
      this.hover.row = this.rowAtY(this.hover.y);
      this.hover.cycle = this.cycleAtX(this.hover.x);
    }
    this.redraw();
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------- navigation
  clamp(): void {
    const { firstCycle, lastCycle } = this.source.info;
    const visible = this.visibleCycles;
    this.x0 = Math.min(Math.max(this.x0, firstCycle - visible * 0.5), lastCycle + 1 - visible * 0.5);
    this.y0 = Math.min(Math.max(0, this.y0), Math.max(0, this.shownCount * this.rowH - (this.height - RULER) + this.rowH * 2));
  }

  /** Zooms time around a point on the timeline, by a factor on pixels per cycle; `key` for a key press. */
  zoomTime(x: number, factor: number, key = false): void {
    const px = Math.max(0, x - this.gutterW);
    const cycle = this.x0 + px / this.cellW;
    ({ drawn: this.cellW, exact: this.cellLevel } = zoomSize(this.cellW, this.cellLevel, factor, key, 0.05, 64, WHOLE_CELLS));
    this.x0 = cycle - px / this.cellW;
    this.clamp();
    this.changed();
  }

  /** Zooms rows, keeping in place the row being looked at: the selected row while it is on screen, else the row
   *  under the pointer, else the middle of the view; `key` for a key press. */
  zoomRows(factor: number, pointerY: number | null, key = false): void {
    const { drawn: next, exact } = zoomSize(this.rowH, this.rowLevel, factor, key, 1, 40, 1);
    this.rowLevel = exact;
    let row: number;
    let y: number;
    const sel = this.selected;
    if (sel !== null && this.placeOf(sel) >= 0 && this.rowY(sel) >= RULER && this.rowY(sel) + this.rowH <= this.height) {
      row = this.placeOf(sel) + 0.5;
      y = this.rowY(sel) + this.rowH / 2;
    } else if (pointerY !== null && pointerY > RULER) {
      row = (this.y0 + pointerY - RULER) / this.rowH;
      y = pointerY;
    } else {
      y = RULER + (this.height - RULER) / 2;
      row = (this.y0 + y - RULER) / this.rowH;
    }
    this.rowH = next;
    this.y0 = row * this.rowH - (y - RULER);
    this.clamp();
    this.changed();
  }

  panTime(cycles: number): void {
    this.x0 += cycles;
    this.clamp();
    this.changed();
  }

  scrollRows(px: number): void {
    this.y0 += px;
    this.clamp();
    this.changed();
  }

  select(i: number | null, reveal = false): void {
    this.selected = i;
    this.related = [];
    if (i !== null && reveal) this.reveal(i);
    this.changed();
    void this.loadRelated(i);
  }

  private async loadRelated(i: number | null): Promise<void> {
    if (i === null) return;
    const [row, referrers] = await Promise.all([this.rowAsync(i), this.source.referrers(i)]);
    if (this.selected !== i) return;
    const related: { from: number; to: number; cycle: number }[] = [];
    for (const e of row.events) for (const f of e.fields) if (f.row !== null && f.row !== i) related.push({ from: f.row, to: i, cycle: e.cycle });
    for (const x of referrers) related.push({ from: i, to: x.row, cycle: x.cycle });
    this.related = related;
    this.changed();
  }

  /** Selects a cycle, within the trace; with `reveal`, pans time just enough to keep it on screen. */
  selectColumn(cycle: number | null, reveal = false): void {
    const { firstCycle, lastCycle } = this.source.info;
    this.column = cycle === null ? null : Math.min(Math.max(Math.floor(cycle), firstCycle), lastCycle);
    if (this.column !== null && reveal) {
      const margin = Math.min(3, this.visibleCycles / 6);
      if (this.column < this.x0 + margin) this.x0 = this.column - margin;
      else if (this.column + 1 > this.x0 + this.visibleCycles - margin) this.x0 = this.column + 1 - this.visibleCycles + margin;
      this.clamp();
    }
    this.changed();
  }

  /** Moves the selected cycle by cycles. With none selected, selects the selected object's first event's, or with no
   *  object selected, the middle of the view's. */
  async moveColumn(delta: number): Promise<void> {
    if (this.column !== null) return this.selectColumn(this.column + delta, true);
    const row = this.selected === null ? null : await this.rowAsync(this.selected);
    this.selectColumn(row ? (row.events[0]?.cycle ?? row.start) : this.x0 + this.visibleCycles / 2, true);
  }

  /** Moves the selection by rows on screen; with nothing selected, selects the top row. */
  moveSelection(delta: number): void {
    const p = this.selected === null ? -1 : this.placeOf(this.selected);
    const next = p < 0 ? Math.floor(this.y0 / this.rowH) : p + delta;
    if (next >= 0 && next < this.shownCount) this.select(this.rowAtPlace(next), true);
  }

  /** Brings a row into view, scrolling only if it is off screen. */
  private reveal(i: number): void {
    if (this.placeOf(i) < 0) return;
    const y = this.placeOf(i) * this.rowH;
    if (y < this.y0 || y > this.y0 + this.height - RULER - this.rowH * 2) this.y0 = y - (this.height - RULER) / 3;
    this.clamp();
  }

  /** Focus: the selected row in view, with its first event a third of the way in from the left. */
  async focusSelected(): Promise<void> {
    if (this.selected === null) return;
    const row = await this.rowAsync(this.selected);
    if (this.placeOf(row.index) < 0) {
      const type = this.source.info.types[row.type].name;
      this.say(`${objectName(type, row.id)} is hidden with its type; press ${row.type + 1} to show ${type}.`);
      return;
    }
    const first = row.events.length ? row.events[0].cycle : row.start;
    this.y0 = this.placeOf(row.index) * this.rowH - (this.height - RULER) / 3;
    this.x0 = first - this.visibleCycles / 3;
    this.clamp();
    this.changed();
  }

  /** Selects the cycle of the selected object's first or last event, as vim's 0 and $ go to the start and end of the
   *  line, and pans time to put it a third of the way in from the left, or from the right; rows move only to bring
   *  its row into view. */
  async toSelectedEdge(edge: 'start' | 'end'): Promise<void> {
    if (this.selected === null) return;
    const i = this.selected;
    const row = await this.rowAsync(i);
    if (this.selected !== i) return;
    const events = row.events;
    if (edge === 'start') {
      this.column = events.length ? events[0].cycle : row.start;
      this.x0 = this.column - this.visibleCycles / 3;
    } else {
      this.column = events.length ? events[events.length - 1].cycle : (row.end ?? this.source.info.lastCycle + 1) - 1;
      this.x0 = this.column - (this.visibleCycles * 2) / 3;
    }
    this.reveal(i);
    this.clamp();
    this.changed();
  }

  /** Moves the view to a cycle picked on the timeline bar: time centered on it, and rows scrolled so that the first
   *  object alive in the view's cycles, or starting in them, is near the top. */
  async moveToCycle(cycle: number): Promise<void> {
    this.x0 = cycle - this.visibleCycles / 2;
    this.clamp();
    this.changed();
    const move = ++this.moves;
    const i = await this.source.rowAt(Math.floor(this.x0));
    if (move !== this.moves || this.shownCount === 0) return;
    this.y0 = (this.placeAtOrAfter(i) - 1) * this.rowH;
    this.clamp();
    this.changed();
  }

  async jumpToCycle(cycle: number): Promise<void> {
    const i = await this.source.rowAt(cycle);
    this.y0 = this.placeAtOrAfter(i) * this.rowH - (this.height - RULER) / 4;
    this.x0 = cycle - this.visibleCycles / 3;
    this.clamp();
    this.changed();
  }

  /** Selects and focuses an object; says why when there is none, and returns whether there was. */
  async jumpToObject(id: number, typeName?: string): Promise<boolean> {
    const types = this.source.info.types;
    const type = typeName === undefined ? undefined : types.findIndex((t) => t.name === typeName);
    if (type === -1) {
      this.say(`No object type is named ${typeName}.`);
      return false;
    }
    const i = await this.source.find(id, type);
    if (i === null) {
      this.say(`No ${typeName === undefined ? `object #${id}` : objectName(typeName, id)} is in this file.`);
      return false;
    }
    this.select(i);
    await this.focusSelected();
    return true;
  }

  /** Shows or hides a type's rows, closing up the rows on screen around them. The row being looked at stays in place:
   *  the selection while it is on screen and stays shown, else the top row, or the first shown row after it. */
  async toggleType(t: number): Promise<void> {
    if (t >= this.source.info.types.length) return;
    const sel = this.selected;
    const selOnScreen = sel !== null && this.placeOf(sel) >= 0 && this.rowY(sel) >= RULER && this.rowY(sel) < this.height;
    const top = Math.min(Math.floor(this.y0 / this.rowH), this.shownCount - 1);
    let anchor = selOnScreen ? sel! : top >= 0 ? this.rowAtPlace(top) : 0;
    const offset = selOnScreen || top >= 0 ? this.rowY(anchor) - RULER : 0;
    if (this.hiddenTypes.has(t)) this.hiddenTypes.delete(t);
    else this.hiddenTypes.add(t);
    // The focus stays on a shown type while any is shown.
    if (this.hiddenTypes.has(this.focusType)) this.focusType = this.nextShownType(this.focusType, 1) ?? this.focusType;
    const toggle = ++this.toggles;
    const shown = this.hiddenTypes.size ? await this.source.visibleRows(this.hiddenTypes) : null;
    if (toggle !== this.toggles) return;
    this.shown = shown;
    this.place = null;
    if (shown) {
      this.place = new Int32Array(this.source.info.rowCount).fill(-1);
      shown.forEach((row, p) => (this.place![row] = p));
    }
    if (sel !== null && this.placeOf(sel) < 0) this.select(null);
    if (this.shownCount > 0) {
      if (this.placeOf(anchor) < 0) anchor = this.rowAtPlace(this.placeAtOrAfter(anchor));
      this.y0 = this.placeOf(anchor) * this.rowH - offset;
    }
    this.clamp();
    this.changed();
    // A search leaves out hidden types, so its matches change with them.
    if (this.search && !this.search.error) await this.setSearch(this.search.text);
  }

  /** Reads the file's names for searches, once. */
  async loadWords(): Promise<TypeWords[]> {
    if (!this.words) {
      this.words = await this.source.words();
      this.changed();
    }
    return this.words;
  }

  /** Runs a search, as it is typed, without moving the view. */
  async setSearch(text: string): Promise<void> {
    const n = ++this.searches;
    const query = parseQuery(text, await this.loadWords());
    const result = 'error' in query ? { matches: [], skipped: 0 } : await this.source.search(query, this.hiddenTypes);
    if (n !== this.searches) return;
    this.search = { text, error: 'error' in query ? query.error : null, ...result, rows: new Set(result.matches.map((m) => m.row)) };
    this.changed();
  }

  clearSearch(): void {
    ++this.searches;
    this.search = null;
    this.changed();
  }

  /** The match the selection is on, as an index into the search's matches, or -1. */
  get matchAt(): number {
    const s = this.search;
    return s ? s.matches.findIndex((m) => m.row === this.selected && m.cycle === this.column) : -1;
  }

  /** Goes to the next or previous match, in time order, from the selected object and cycle, or else from a third of
   *  the way into the view, as vim's n and N do; past the last, it goes round to the first. Says why when there is
   *  nowhere to go, and returns whether it went. */
  async nextMatch(step: 1 | -1): Promise<boolean> {
    const s = this.search;
    if (!s) {
      this.say('Nothing is searched: press / and type a search, such as csrr or instruction.flush.');
      return false;
    }
    if (s.error) {
      this.say(s.error);
      return false;
    }
    if (!s.matches.length) {
      this.say(`Nothing matches ${s.text}${s.skipped ? `, apart from ${s.skipped} objects of hidden types` : ''}.`);
      return false;
    }
    const cycle = this.column ?? Math.floor(this.x0 + this.visibleCycles / 3);
    const row = this.selected ?? -1;
    const after = (m: Match) => m.cycle > cycle || (m.cycle === cycle && m.row > row);
    let k = -1;
    if (step > 0) k = s.matches.findIndex(after);
    else for (let j = s.matches.length - 1; j >= 0 && k < 0; j--) if (!after(s.matches[j]) && !(s.matches[j].cycle === cycle && s.matches[j].row === row)) k = j;
    if (k < 0) {
      k = step > 0 ? 0 : s.matches.length - 1;
      if (s.matches.length > 1) this.say(step > 0 ? 'Past the last match; back to the first.' : 'Before the first match; on to the last.');
    }
    const m = s.matches[k];
    this.select(m.row);
    this.column = m.cycle;
    this.y0 = this.placeOf(m.row) * this.rowH - (this.height - RULER) / 3;
    this.x0 = m.cycle - this.visibleCycles / 3;
    this.clamp();
    this.changed();
    return true;
  }

  /** Puts a cursor on an edge, by default the one where the selected cycle starts, as vim's i inserts before the
   *  character under its cursor, and opens its name for typing. Does nothing where a cursor is already. */
  insertCursor(at: number | null = this.column): void {
    if (at === null) {
      this.say('Select a cycle first: click one, or press 0 or $ on a selected object.');
      return;
    }
    const { firstCycle, lastCycle } = this.source.info;
    const edge = Math.min(Math.max(at, firstCycle), lastCycle + 1);
    if (this.cursors.some((k) => k.edge === edge)) return;
    this.cursors = [...this.cursors, { edge, name: '' }].sort((a, b) => a.edge - b.edge);
    this.naming = edge;
    this.changed();
  }

  /** Names a cursor, which ends typing its name. A name left empty, or as the cycle it was filled with, shows as the
   *  cycle. */
  nameCursor(edge: number, name: string): void {
    const text = name.trim();
    const plain = text === fmt(edge) || text === String(edge) ? '' : text;
    this.cursors = this.cursors.map((k) => (k.edge === edge ? { edge, name: plain } : k));
    this.naming = null;
    this.changed();
  }

  /** Puts a cursor at the selected object's front or tail, as vim's I and A insert at the start and end of the line:
   *  on the edge where its first event's cycle starts, or on the edge after its last event's cycle. Selects that
   *  event's cycle, as 0 and $ do. */
  async insertAtSelectedEdge(end: 'start' | 'end'): Promise<void> {
    if (this.selected === null) {
      this.say('Select an object first.');
      return;
    }
    await this.toSelectedEdge(end);
    if (this.column !== null) this.insertCursor(end === 'start' ? this.column : this.column + 1);
  }

  /** Removes the cursor on the selected cycle, as vim's x deletes the character under its cursor: the one on the
   *  edge where the cycle starts, or else the one on the edge after it, where A puts one. */
  deleteCursor(): void {
    const col = this.column;
    if (col === null) return;
    const edge = this.cursors.some((k) => k.edge === col) ? col : col + 1;
    const kept = this.cursors.filter((k) => k.edge !== edge);
    if (kept.length === this.cursors.length) return;
    this.cursors = kept;
    this.changed();
  }

  toggleHelp(): void {
    this.helpOpen = !this.helpOpen;
    this.changed();
  }

  /** The next shown type after one, in the view's order, wrapping; null when no type is shown. */
  private nextShownType(from: number, step: 1 | -1): number | null {
    const n = this.source.info.types.length;
    for (let k = 1; k <= n; k++) {
      const t = (((from + step * k) % n) + n) % n;
      if (!this.hiddenTypes.has(t)) return t;
    }
    return null;
  }

  /** Moves the focus to the next or previous shown type, in the view's order. */
  cycleFocus(step: 1 | -1): void {
    const next = this.nextShownType(this.focusType, step);
    if (next === null || next === this.focusType) return;
    this.focusType = next;
    this.changed();
  }

  toggleArrows(): void {
    this.allArrows = !this.allArrows;
    this.changed();
  }

  /** The view a file opens with: its start, up close enough for lettered cells, with rows shrunk toward 40 in
   *  view but kept tall enough for letters, and the label column wide enough for every label, up to 40% of the
   *  waterfall. */
  async home(): Promise<void> {
    await this.sized;
    const top = this.rowAtPlace(0);
    const [first] = this.shownCount ? await this.source.rows(top, top + 1) : [];
    this.cellW = 22;
    this.rowH = Math.max(16, Math.min(22, Math.floor((this.height - RULER) / 40)));
    const { fullW } = labelColumns(this.source.info, this.hiddenTypes, labelFontSize(this.rowH) * CHAR_EM);
    this.gutterW = Math.round(Math.min(fullW, this.width * 0.4));
    this.x0 = (first?.start ?? this.source.info.firstCycle) - 3;
    this.y0 = 0;
    this.clamp();
    this.changed();
  }
}

/** Re-renders a component whenever the controller's state changes. */
export function useController(c: Controller): Controller {
  const [, setTick] = useState(0);
  useEffect(() => c.subscribe(() => setTick((t) => t + 1)), [c]);
  return c;
}
