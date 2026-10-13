// The viewer's state and navigation, shared by the canvas, which redraws from it, and the Preact panels, which
// subscribe to it. Rows come from the source in chunks and are cached here.
import { useEffect, useState } from 'preact/hooks';
import { objectName } from '../model/present';
import type { RowView, Source } from '../model/source';

const CHUNK = 256;
const MAX_CHUNKS = 64;

export const RULER = 28;

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
  /** Width of the label column. */
  gutterW = 280;
  /** Size of the waterfall canvas, in CSS pixels. */
  width = 1;
  height = 1;
  hover: Hover | null = null;
  selected: number | null = null;
  hiddenTypes = new Set<number>();
  /** Arrows for the selected row: from each object it names to it, and from it to each row that names it. */
  related: { from: number; to: number; cycle: number }[] = [];
  allArrows = false;
  /** A short note for the status bar, such as why a jump did nothing. */
  notice = '';

  /** The rows on screen, in order, while a type is hidden; null while every row shows. */
  private shown: Uint32Array | null = null;
  /** Each row's place among the rows on screen, or -1 for a row of a hidden type; null while every row shows. */
  private place: Int32Array | null = null;
  /** Counts type toggles, so that a toggle whose rows arrive after a later one's is dropped. */
  private toggles = 0;

  private chunks = new Map<number, RowView[]>();
  private pending = new Set<number>();
  private listeners = new Set<() => void>();
  private redrawHook: (() => void) | null = null;

  constructor(readonly source: Source) {}

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

  /** Zooms time around a point on the timeline, by a factor on pixels per cycle. */
  zoomTime(x: number, factor: number): void {
    const px = Math.max(0, x - this.gutterW);
    const cycle = this.x0 + px / this.cellW;
    this.cellW = Math.min(64, Math.max(0.05, this.cellW * factor));
    this.x0 = cycle - px / this.cellW;
    this.clamp();
    this.changed();
  }

  /** Zooms rows, keeping in place the row being looked at: the selected row while it is on screen, else the row
   *  under the pointer, else the middle of the view. */
  zoomRows(factor: number, pointerY: number | null): void {
    const next = Math.min(40, Math.max(1, this.rowH * factor));
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
      this.notice = `${objectName(type, row.id)} is hidden with its type; press ${row.type + 1} to show ${type}.`;
      this.changed();
      return;
    }
    const first = row.events.length ? row.events[0].cycle : row.start;
    this.y0 = this.placeOf(row.index) * this.rowH - (this.height - RULER) / 3;
    this.x0 = first - this.visibleCycles / 3;
    this.clamp();
    this.changed();
  }

  async jumpToCycle(cycle: number): Promise<void> {
    const i = await this.source.rowAt(cycle);
    this.y0 = this.placeAtOrAfter(i) * this.rowH - (this.height - RULER) / 4;
    this.x0 = cycle - this.visibleCycles / 3;
    this.notice = '';
    this.clamp();
    this.changed();
  }

  async jumpToObject(id: number, typeName?: string): Promise<void> {
    const types = this.source.info.types;
    const type = typeName === undefined ? undefined : types.findIndex((t) => t.name === typeName);
    if (type === -1) {
      this.notice = `No object type is named ${typeName}.`;
      this.changed();
      return;
    }
    const i = await this.source.find(id, type);
    if (i === null) {
      this.notice = `No ${typeName === undefined ? `object #${id}` : objectName(typeName, id)} is in this file.`;
      this.changed();
      return;
    }
    this.notice = '';
    this.select(i);
    await this.focusSelected();
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
  }

  toggleArrows(): void {
    this.allArrows = !this.allArrows;
    this.changed();
  }

  /** The view a file opens with: its start, up close enough for lettered cells, with rows shrunk toward 40 in
   *  view but kept tall enough for letters. */
  async home(): Promise<void> {
    const top = this.rowAtPlace(0);
    const [first] = this.shownCount ? await this.source.rows(top, top + 1) : [];
    this.cellW = 22;
    this.rowH = Math.max(16, Math.min(22, Math.floor((this.height - RULER) / 40)));
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
