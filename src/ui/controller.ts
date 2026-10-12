// The viewer's state and navigation, shared by the canvas, which redraws from it, and the Preact panels, which
// subscribe to it. Rows come from the source in chunks and are cached here.
import { useEffect, useState } from 'preact/hooks';
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
  rowY(i: number): number {
    return RULER + i * this.rowH - this.y0;
  }
  rowAtY(y: number): number | null {
    const i = Math.floor((y - RULER + this.y0) / this.rowH);
    return y > RULER && i >= 0 && i < this.source.info.rowCount ? i : null;
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
    const { firstCycle, lastCycle, rowCount } = this.source.info;
    const visible = this.visibleCycles;
    this.x0 = Math.min(Math.max(this.x0, firstCycle - visible * 0.5), lastCycle + 1 - visible * 0.5);
    this.y0 = Math.min(Math.max(0, this.y0), Math.max(0, rowCount * this.rowH - (this.height - RULER) + this.rowH * 2));
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

  /** Zooms rows around a height on the canvas. */
  zoomRows(y: number, factor: number): void {
    const row = (this.y0 + y - RULER) / this.rowH;
    this.rowH = Math.min(40, Math.max(1, this.rowH * factor));
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

  /** Brings a row into view, scrolling only if it is off screen. */
  private reveal(i: number): void {
    const y = i * this.rowH;
    if (y < this.y0 || y > this.y0 + this.height - RULER - this.rowH * 2) this.y0 = y - (this.height - RULER) / 3;
    this.clamp();
  }

  /** Focus: the selected row in view, with its first event a third of the way in from the left. */
  async focusSelected(): Promise<void> {
    if (this.selected === null) return;
    const row = await this.rowAsync(this.selected);
    const first = row.events.length ? row.events[0].cycle : row.start;
    this.y0 = this.selected * this.rowH - (this.height - RULER) / 3;
    this.x0 = first - this.visibleCycles / 3;
    this.clamp();
    this.changed();
  }

  async jumpToCycle(cycle: number): Promise<void> {
    const i = await this.source.rowAt(cycle);
    this.y0 = i * this.rowH - (this.height - RULER) / 4;
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
      this.notice = `No ${typeName ?? 'object'} #${id} is in this file.`;
      this.changed();
      return;
    }
    this.notice = '';
    this.select(i);
    await this.focusSelected();
  }

  toggleType(t: number): void {
    if (t >= this.source.info.types.length) return;
    if (this.hiddenTypes.has(t)) this.hiddenTypes.delete(t);
    else this.hiddenTypes.add(t);
    this.changed();
  }

  toggleArrows(): void {
    this.allArrows = !this.allArrows;
    this.changed();
  }

  /** The view a file opens with: its start, up close enough for lettered cells, with rows shrunk toward 40 in
   *  view but kept tall enough for letters. */
  async home(): Promise<void> {
    const [first] = await this.source.rows(0, 1);
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
