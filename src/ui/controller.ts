// The viewer's state and navigation; rows load from the source in chunks and are cached here.
import { useEffect, useState } from 'preact/hooks';
import { fmt, objectName, segmentAt } from '../model/present';
import { parseQuery, type Match, type TypeWords } from '../model/search';
import { linkKind, type LinkKind, type RowFilter, type RowView, type Source } from '../model/source';
import { CHAR_EM, labelColumns, labelFontSize } from './labels';

const CHUNK = 256;
const MAX_CHUNKS = 64;

export const RULER = 28;

/** A link from one object to another at a cycle: from what blocks an instruction to the instruction, say. */
export interface Link {
  from: number;
  to: number;
  cycle: number;
  kind: LinkKind;
}
export const ZOOM_STEP = 1.25;
/** From this width up, cells are drawn one by one, so they snap to whole pixels for crisp edges. */
export const WHOLE_CELLS = 8;

/** A size after a zoom, in whole pixels from `whole` up. A key moves the drawn size at least a pixel; the wheel and
 *  pinch keep an exact level so small turns add up, restarting it when the size was set other than by zooming. */
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
  /** One of CURSOR_GROUPS, each with its own color; a cursor's distances are to its group's neighbors. */
  group: number;
}

/** One group per color that stays distinct from the others. */
export const CURSOR_GROUPS = 6;

/** The height of a group's lane in the cursor strip along the bottom of the waterfall, and the strip's padding. */
export const LANE = 22;
const STRIP_PAD = 6;

interface Hover {
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
  /** The selected cycle. */
  column: number | null = null;
  hiddenTypes = new Set<number>();
  hideAborted = false;
  viewOpen = false;
  /** Keys waiting for the rest of their command, such as a count or the g of gg. */
  keysPending = '';
  /** The type drawn in full; every other type keeps only its bars. */
  focusType: number;
  /** Links for the selected row, of every kind. */
  related: Link[] = [];
  /** The kinds of link shown. */
  linkKinds = new Set<LinkKind>(['aborted', 'blocked']);
  /** Whether links show for everything on screen, not only the selected row. */
  allLinks = false;
  /** Cursors on clock edges, in order. */
  cursors: Cursor[] = [];
  /** The edge of the cursor whose name is being typed, if any. */
  naming: number | null = null;
  /** The group a new cursor goes in: the one last chosen. */
  cursorGroup = 0;
  cursorsOpen = false;
  helpOpen = false;
  /** The jump box's search: matches are in row order, and `skipped` counts the matching objects hidden. */
  search: { text: string; error: string | null; matches: Match[]; rows: Set<number>; skipped: number } | null = null;
  /** The file's names for searches, once read. */
  words: TypeWords[] | null = null;
  /** A short note for the status bar, such as why a jump did nothing. */
  notice = '';

  /** The rows on screen, in order, while a type is hidden; null while every row shows. */
  private shown: Uint32Array | null = null;
  /** Each row's place among the rows on screen, or -1 for a row of a hidden type; null while every row shows. */
  private place: Int32Array | null = null;
  /** Bumped per type toggle, timeline move, and search, so that a stale async result is dropped. */
  private toggles = 0;
  private moves = 0;
  private searches = 0;

  private markSized!: () => void;
  /** Resolves once the canvas has its size, which the view a file opens with depends on. */
  private readonly sized = new Promise<void>((resolve) => (this.markSized = resolve));

  private chunks = new Map<number, RowView[]>();
  private pending = new Set<number>();
  private listeners = new Set<() => void>();
  private redrawHook: (() => void) | null = null;

  constructor(readonly source: Source) {
    this.focusType = source.info.focus;
  }

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
    return y > RULER && y < this.plotBottom && p >= 0 && p < this.shownCount ? this.rowAtPlace(p) : null;
  }

  /** The groups with cursors, in order: one lane each in the cursor strip. */
  get cursorLanes(): number[] {
    return [...new Set(this.cursors.map((k) => k.group))].sort((a, b) => a - b);
  }
  get stripH(): number {
    return this.cursors.length ? this.cursorLanes.length * LANE + STRIP_PAD : 0;
  }
  /** The middle of a group's lane in the cursor strip. */
  laneY(group: number): number {
    return this.plotBottom + STRIP_PAD / 2 + this.cursorLanes.indexOf(group) * LANE + LANE / 2;
  }
  /** Where the rows end, above the cursor strip. */
  get plotBottom(): number {
    return this.height - this.stripH;
  }
  get plotH(): number {
    return Math.max(1, this.plotBottom - RULER);
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
  changed(): void {
    // The row and cycle under the pointer move with the view, as when a key pans it.
    if (this.hover) {
      this.hover.row = this.rowAtY(this.hover.y);
      this.hover.cycle = this.cycleAtX(this.hover.x);
    }
    this.redraw();
    for (const l of this.listeners) l();
  }

  clamp(): void {
    const { firstCycle, lastCycle } = this.source.info;
    const visible = this.visibleCycles;
    this.x0 = Math.min(Math.max(this.x0, firstCycle - visible * 0.5), lastCycle + 1 - visible * 0.5);
    this.y0 = Math.min(Math.max(0, this.y0), Math.max(0, this.shownCount * this.rowH - this.plotH + this.rowH * 2));
  }

  /** Zooms time around a point on the timeline; `key` for a key press. */
  zoomTime(x: number, factor: number, key = false): void {
    const px = Math.max(0, x - this.gutterW);
    const cycle = this.x0 + px / this.cellW;
    ({ drawn: this.cellW, exact: this.cellLevel } = zoomSize(this.cellW, this.cellLevel, factor, key, 0.05, 64, WHOLE_CELLS));
    this.x0 = cycle - px / this.cellW;
    this.clamp();
    this.changed();
  }

  /** Zooms rows, keeping the row being looked at in place; `key` for a key press. */
  zoomRows(factor: number, pointerY: number | null, key = false): void {
    const { drawn: next, exact } = zoomSize(this.rowH, this.rowLevel, factor, key, 1, 40, 1);
    this.rowLevel = exact;
    let row: number;
    let y: number;
    const sel = this.selected;
    if (sel !== null && this.placeOf(sel) >= 0 && this.rowY(sel) >= RULER && this.rowY(sel) + this.rowH <= this.plotBottom) {
      row = this.placeOf(sel) + 0.5;
      y = this.rowY(sel) + this.rowH / 2;
    } else if (pointerY !== null && pointerY > RULER) {
      row = (this.y0 + pointerY - RULER) / this.rowH;
      y = pointerY;
    } else {
      y = RULER + this.plotH / 2;
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
    const related: Link[] = [];
    for (const e of row.events) {
      for (const f of e.fields) if (f.row !== null && f.row !== i) related.push({ from: f.row, to: i, cycle: e.cycle, kind: linkKind(f.role) });
    }
    for (const x of referrers) related.push({ from: i, to: x.row, cycle: x.cycle, kind: linkKind(x.role) });
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

  async moveColumn(delta: number): Promise<void> {
    if (this.column !== null) return this.selectColumn(this.column + delta, true);
    const row = this.selected === null ? null : await this.rowAsync(this.selected);
    this.selectColumn(row ? (row.events[0]?.cycle ?? row.start) : this.x0 + this.visibleCycles / 2, true);
  }

  moveSelection(delta: number): void {
    if (this.shownCount === 0) return;
    const p = this.selected === null ? -1 : this.placeOf(this.selected);
    const next = p < 0 ? Math.floor(this.y0 / this.rowH) : Math.min(Math.max(p + delta, 0), this.shownCount - 1);
    if (next !== p) this.select(this.rowAtPlace(next), true);
  }

  /** A row's depth among the rows shown, as its type name's indent shows it. */
  private depthOf(r: RowView): number {
    return r.ancestorTypes.filter((t) => !this.hiddenTypes.has(t)).length;
  }

  /** vim's } and {: a paragraph is a row and the rows under it; a row with none under it is in its parent's. */
  async moveParagraph(step: 1 | -1, times = 1): Promise<void> {
    if (this.selected === null || this.placeOf(this.selected) < 0) return this.moveSelection(step);
    const start = this.selected;
    const depthAt = async (q: number) => this.depthOf(await this.rowAsync(this.rowAtPlace(q)));
    let p = this.placeOf(start);
    for (let moved = 0; moved < times; moved++) {
      const depth = await depthAt(p);
      // A row has rows under it when the next row shown is deeper.
      const leaf = p + 1 >= this.shownCount || (await depthAt(p + 1)) <= depth;
      const stop = leaf && depth > 0 ? (d: number) => d < depth : (d: number) => d <= depth;
      let q = p + step;
      while (q >= 0 && q < this.shownCount && !stop(await depthAt(q))) q += step;
      if (q < 0 || q >= this.shownCount) break;
      p = q;
    }
    if (this.selected !== start) return;
    if (p !== this.placeOf(start)) this.select(this.rowAtPlace(p), true);
  }

  private hasAt(r: RowView, cycle: number): boolean {
    return segmentAt(r, cycle) !== null || r.events.some((e) => e.cycle === cycle);
  }

  /** J and K: the next row with anything at the selected cycle; from the top or bottom with nothing selected. */
  async moveInColumn(step: 1 | -1, times = 1): Promise<void> {
    const cycle = this.column;
    if (cycle === null) {
      this.say('Select a cycle first: click one, or press h or l; J and K go down and up its column.');
      return;
    }
    const start = this.selected;
    let p = start === null || this.placeOf(start) < 0 ? (step > 0 ? -1 : this.shownCount) : this.placeOf(start);
    let found = false;
    for (let moved = 0; moved < times; moved++) {
      let q = p + step;
      while (q >= 0 && q < this.shownCount && !this.hasAt(await this.rowAsync(this.rowAtPlace(q)), cycle)) q += step;
      if (q < 0 || q >= this.shownCount) break;
      p = q;
      found = true;
    }
    if (this.selected !== start || this.column !== cycle) return;
    if (!found) {
      this.say(`No object ${step > 0 ? 'below' : 'above'} has anything at cycle ${fmt(cycle)}.`);
      return;
    }
    this.select(this.rowAtPlace(p), true);
  }

  /** gg and G: the first or last row shown, brought into view as f does. */
  async selectEdgeRow(edge: 'first' | 'last'): Promise<void> {
    if (this.shownCount === 0) return;
    this.select(this.rowAtPlace(edge === 'first' ? 0 : this.shownCount - 1));
    await this.focusSelected();
  }

  /** H, M, and L: the top, middle, or bottom row on screen, without moving the view. */
  selectScreenRow(where: 'top' | 'middle' | 'bottom'): void {
    if (this.shownCount === 0) return;
    const last = this.shownCount - 1;
    const top = Math.min(Math.ceil(this.y0 / this.rowH), last);
    const bottom = Math.max(top, Math.min(Math.floor((this.y0 + this.plotH) / this.rowH) - 1, last));
    const p = where === 'top' ? top : where === 'bottom' ? bottom : Math.floor((top + bottom) / 2);
    this.select(this.rowAtPlace(p));
  }

  /** Puts the selected row in the middle, top, or bottom of the screen; time stays. */
  scrollSelectedTo(where: 'middle' | 'top' | 'bottom'): void {
    if (this.selected === null || this.placeOf(this.selected) < 0) return;
    const y = this.placeOf(this.selected) * this.rowH;
    const room = this.plotH;
    this.y0 = where === 'top' ? y : where === 'bottom' ? y + this.rowH - room : y + this.rowH / 2 - room / 2;
    this.clamp();
    this.changed();
  }

  /** ] and [: the next or previous event; with no cycle selected, from before the first or after the last. */
  async moveEvent(step: 1 | -1, times = 1): Promise<void> {
    if (this.selected === null) {
      this.say('Select an object first: ] and [ go through its events.');
      return;
    }
    const i = this.selected;
    const row = await this.rowAsync(i);
    if (this.selected !== i) return;
    const cycles = [...new Set(row.events.map((e) => e.cycle))].sort((a, b) => a - b);
    let at = this.column ?? (step > 0 ? -Infinity : Infinity);
    let moved = 0;
    for (; moved < times; moved++) {
      const next = step > 0 ? cycles.find((k) => k > at) : [...cycles].reverse().find((k) => k < at);
      if (next === undefined) break;
      at = next;
    }
    const type = this.source.info.types[row.type].name;
    if (!moved) this.say(`${objectName(type, row.id)} has no ${step > 0 ? 'later' : 'earlier'} event.`);
    else this.selectColumn(at, true);
  }

  /** Brings a row into view, scrolling only if it is off screen. */
  private reveal(i: number): void {
    if (this.placeOf(i) < 0) return;
    const y = this.placeOf(i) * this.rowH;
    if (y < this.y0 || y > this.y0 + this.plotH - this.rowH * 2) this.y0 = y - this.plotH / 3;
    this.clamp();
  }

  /** f: the selected row in view, its first event a third in from the left; with `rows` false, only time moves. */
  async focusSelected(rows = true): Promise<void> {
    if (this.selected === null) return;
    const row = await this.rowAsync(this.selected);
    if (this.placeOf(row.index) < 0) {
      const type = this.source.info.types[row.type].name;
      if (this.hiddenTypes.has(row.type)) this.say(`${objectName(type, row.id)} is hidden with its type; press z${row.type + 1} to show ${type}.`);
      else this.say(`${objectName(type, row.id)} was aborted (${row.endedBy}), and aborted objects are hidden; press o to show them.`);
      return;
    }
    const first = row.events.length ? row.events[0].cycle : row.start;
    if (rows) this.y0 = this.placeOf(row.index) * this.rowH - this.plotH / 3;
    this.x0 = first - this.visibleCycles / 3;
    this.clamp();
    this.changed();
  }

  /** 0 and $: selects the first or last event's cycle, a third in from that side; rows move only to reveal it. */
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

  /** Centers time on a cycle picked on the timeline bar, with the first object alive in view near the top. */
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
    this.y0 = this.placeAtOrAfter(i) * this.rowH - this.plotH / 4;
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

  /** Shows or hides a type's rows. */
  async toggleType(t: number): Promise<void> {
    if (t >= this.source.info.types.length) return;
    await this.refilter(() => {
      if (this.hiddenTypes.has(t)) this.hiddenTypes.delete(t);
      else this.hiddenTypes.add(t);
      // The focus stays on a shown type while any is shown.
      if (this.hiddenTypes.has(this.focusType)) this.focusType = this.nextShownType(this.focusType, 1) ?? this.focusType;
    });
  }

  async toggleAborted(): Promise<void> {
    await this.refilter(() => (this.hideAborted = !this.hideAborted));
  }

  get filter(): RowFilter {
    return { types: this.hiddenTypes, aborted: this.hideAborted };
  }

  get hiddenCount(): number {
    return this.source.info.rowCount - this.shownCount;
  }

  toggleView(): void {
    this.viewOpen = !this.viewOpen;
    if (this.viewOpen) this.cursorsOpen = false;
    this.changed();
  }

  /** Changes what is hidden, keeping the row being looked at in place: the selection if on screen, else the top row. */
  private async refilter(change: () => void): Promise<void> {
    const sel = this.selected;
    const selOnScreen = sel !== null && this.placeOf(sel) >= 0 && this.rowY(sel) >= RULER && this.rowY(sel) < this.plotBottom;
    const top = Math.min(Math.floor(this.y0 / this.rowH), this.shownCount - 1);
    let anchor = selOnScreen ? sel! : top >= 0 ? this.rowAtPlace(top) : 0;
    const offset = selOnScreen || top >= 0 ? this.rowY(anchor) - RULER : 0;
    change();
    const toggle = ++this.toggles;
    const shown = this.hiddenTypes.size || this.hideAborted ? await this.source.visibleRows(this.filter) : null;
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
    // A search leaves out hidden objects, so its matches change with them.
    if (this.search && !this.search.error) await this.setSearch(this.search.text);
  }

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
    const result = 'error' in query ? { matches: [], skipped: 0 } : await this.source.search(query, this.filter);
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

  /** n and N: the next or previous match by row, wrapping; says why when there is none; returns whether it went. */
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
      this.say(`Nothing matches ${s.text}${s.skipped ? `, apart from ${s.skipped} hidden objects` : ''}.`);
      return false;
    }
    // With nothing selected, just above the top row on screen, so that n finds a match on it.
    const sel = this.selected === null ? -1 : this.placeOf(this.selected);
    const here = sel >= 0 ? sel : Math.floor(this.y0 / this.rowH) - 0.5;
    let k = -1;
    if (step > 0) k = s.matches.findIndex((m) => this.placeOf(m.row) > here);
    else for (let j = s.matches.length - 1; j >= 0 && k < 0; j--) if (this.placeOf(s.matches[j].row) < here) k = j;
    if (k < 0) {
      k = step > 0 ? 0 : s.matches.length - 1;
      if (s.matches.length > 1) this.say(step > 0 ? 'Past the last match; back to the first.' : 'Before the first match; on to the last.');
    }
    const m = s.matches[k];
    this.select(m.row);
    this.column = m.cycle;
    this.y0 = this.placeOf(m.row) * this.rowH - this.plotH / 3;
    this.x0 = m.cycle - this.visibleCycles / 3;
    this.clamp();
    this.changed();
    return true;
  }

  /** i: a cursor on the selected cycle's start edge, its name open for typing; nothing where a cursor is already. */
  insertCursor(at: number | null = this.column): void {
    if (at === null) {
      this.say('Select a cycle first: click one, or press 0 or $ on a selected object.');
      return;
    }
    const { firstCycle, lastCycle } = this.source.info;
    const edge = Math.min(Math.max(at, firstCycle), lastCycle + 1);
    if (this.cursors.some((k) => k.edge === edge)) return;
    this.cursors = [...this.cursors, { edge, name: '', group: this.cursorGroup }].sort((a, b) => a.edge - b.edge);
    this.naming = edge;
    this.changed();
  }

  /** Moves a cursor to a group, which new cursors then go in too. */
  setCursorGroup(edge: number, group: number): void {
    this.cursorGroup = group;
    this.cursors = this.cursors.map((k) => (k.edge === edge ? { ...k, group } : k));
    this.changed();
  }

  /** Ends typing a cursor's name; a name left empty, or as the cycle it was filled with, shows as the cycle. */
  nameCursor(edge: number, name: string): void {
    const text = name.trim();
    const plain = text === fmt(edge) || text === String(edge) ? '' : text;
    this.cursors = this.cursors.map((k) => (k.edge === edge ? { ...k, name: plain } : k));
    this.naming = null;
    this.changed();
  }

  /** I and A: a cursor before the first event or after the last, selecting that cycle as 0 and $ do. */
  async insertAtSelectedEdge(end: 'start' | 'end'): Promise<void> {
    if (this.selected === null) {
      this.say('Select an object first.');
      return;
    }
    await this.toSelectedEdge(end);
    if (this.column !== null) this.insertCursor(end === 'start' ? this.column : this.column + 1);
  }

  /** x: removes the cursor on the selected cycle's start edge, else on its end edge, where A puts one. */
  deleteCursor(): void {
    const col = this.column;
    if (col === null) return;
    this.removeCursor(this.cursors.some((k) => k.edge === col) ? col : col + 1);
  }

  removeCursor(edge: number): void {
    const kept = this.cursors.filter((k) => k.edge !== edge);
    if (kept.length === this.cursors.length) return;
    this.cursors = kept;
    if (this.naming === edge) this.naming = null;
    this.changed();
  }

  panToCursor(edge: number): void {
    this.x0 = edge - this.visibleCycles / 2;
    this.clamp();
    this.selectColumn(edge);
  }

  /** The view panel closes as this one opens, as both hang from the header. */
  toggleCursors(): void {
    this.cursorsOpen = !this.cursorsOpen;
    if (this.cursorsOpen) this.viewOpen = false;
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

  setFocus(t: number): void {
    this.focusType = t;
    this.changed();
  }

  cycleFocus(step: 1 | -1): void {
    const next = this.nextShownType(this.focusType, step);
    if (next === null || next === this.focusType) return;
    this.focusType = next;
    this.changed();
  }

  toggleLinks(): void {
    this.allLinks = !this.allLinks;
    this.changed();
  }

  toggleLinkKind(kind: LinkKind): void {
    if (!this.linkKinds.delete(kind)) this.linkKinds.add(kind);
    this.changed();
  }

  get shownRelated(): Link[] {
    return this.related.filter((a) => this.linkKinds.has(a.kind));
  }

  /** The view a file opens with: cells and rows big enough for letters, rows toward 40 in view, and the label column
   *  wide enough for every label, up to 40% of the width. */
  async home(): Promise<void> {
    await this.sized;
    const top = this.rowAtPlace(0);
    const [first] = this.shownCount ? await this.source.rows(top, top + 1) : [];
    this.cellW = 22;
    this.rowH = Math.max(16, Math.min(22, Math.floor(this.plotH / 40)));
    const { fullW } = labelColumns(this.source.info, this.hiddenTypes, labelFontSize(this.rowH) * CHAR_EM);
    this.gutterW = Math.round(Math.min(fullW, this.width * 0.4));
    this.x0 = (first?.start ?? this.source.info.firstCycle) - 3;
    this.y0 = 0;
    this.clamp();
    this.changed();
  }
}

/** Re-renders a component whenever the controller's state changes. */
export function useController(c: Controller): void {
  const [, setTick] = useState(0);
  useEffect(() => c.subscribe(() => setTick((t) => t + 1)), [c]);
}
