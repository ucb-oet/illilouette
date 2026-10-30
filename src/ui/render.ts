// Draws the waterfall: the label column, the ruler, and one row per object. How much a row shows follows its size:
// lettered cells up close, one run per stage in the middle, solid rows far out.
import { fmt } from '../model/present';
import { linkKind, type LinkKind, type RowView } from '../model/source';
import { Controller, RULER, ZOOM_STEP, type Cursor, type Link } from './controller';
import { EDGE, GAP, labelColumns, labelFontSize } from './labels';
import { MONO, rgba, type Theme } from './theme';

export type Detail = 'letters' | 'cells' | 'runs' | 'solid';

/** Cells take letters from this many pixels per cycle, and rows this tall. */
const LETTER_CELLS = 14;
const LETTER_ROWS = 16;
/** The label column shows text in rows this tall. */
const LABEL_ROWS = 12;

export function detailOf(c: Controller): Detail {
  if (c.cellW >= LETTER_CELLS && c.rowH >= LETTER_ROWS) return 'letters';
  if (c.cellW >= 8) return 'cells';
  if (c.cellW >= 2.5) return 'runs';
  return 'solid';
}

/** Whether links show, the selection's included: not once zoomed out a step past where cells lose their letters or
 *  the label column its text, where they would only clutter. Sizes there are whole pixels, so the step is rounded. */
export function linksShown(c: Controller): boolean {
  return c.cellW >= Math.round(LETTER_CELLS / ZOOM_STEP) - 0.5 && c.rowH >= Math.round(LABEL_ROWS / ZOOM_STEP) - 0.5;
}

export const DETAIL_NAMES: Record<Detail, string> = {
  letters: 'Lettered cells',
  cells: 'Cells',
  runs: 'One run per stage',
  solid: 'Solid rows',
};

/** Whether an object was aborted: ended other than by its type's normal end. */
const aborted = (r: RowView) => r.end !== null && !r.normalEnd;

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

function niceStep(minCycles: number): number {
  for (let p = 1; ; p *= 10) {
    for (const m of [1, 2, 5]) if (m * p >= minCycles) return m * p;
  }
}

function ellipsize(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}

export function drawWaterfall(ctx: CanvasRenderingContext2D, c: Controller, th: Theme, dpr: number): void {
  const { width: W, height: H, rowH, cellW: cw, gutterW: gx } = c;
  const info = c.source.info;
  const detail = detailOf(c);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = th.base;
  ctx.fillRect(0, 0, W, H);

  const first = Math.max(0, Math.floor(c.y0 / rowH));
  const last = Math.min(c.shownCount, Math.ceil((c.y0 + H - RULER) / rowH) + 1);
  const rows: RowView[] = [];
  for (let p = first; p < last; p++) {
    const r = c.row(c.rowAtPlace(p));
    if (r) rows.push(r);
  }
  const cStart = Math.floor(c.x0);
  const cEnd = Math.ceil(c.x0 + c.visibleCycles);
  const step = niceStep(72 / cw);
  // A row's tint, the same across the label column and the timeline: selected, related to the selection, or hovered.
  // The selection's is a little stronger on the label column's darker ground.
  const relatedRows = new Set(c.shownRelated.flatMap((a) => [a.from, a.to]));
  const bandOf = (r: RowView, gutter: boolean): string | null => {
    if (r.index === c.selected) return rgba(th.accent, gutter ? (th.dark ? 0.2 : 0.16) : th.dark ? 0.16 : 0.14);
    if (relatedRows.has(r.index)) return rgba(th.accent, th.dark ? 0.07 : 0.06);
    if (c.hover?.row === r.index) return rgba(th.overlay0, 0.1);
    return null;
  };

  // ---- timeline area
  ctx.save();
  ctx.beginPath();
  ctx.rect(gx, RULER, W - gx, H - RULER);
  ctx.clip();
  ctx.fillStyle = th.surface0;
  for (let k = Math.ceil(cStart / step) * step; k <= cEnd; k += step) ctx.fillRect(Math.round(c.xOf(k)), RULER, 1, H - RULER);
  if (c.hover?.cycle != null) {
    ctx.fillStyle = rgba(th.overlay0, th.dark ? 0.12 : 0.14);
    ctx.fillRect(c.xOf(c.hover.cycle), RULER, Math.max(1, cw), H - RULER);
  }
  if (c.column !== null) {
    ctx.fillStyle = rgba(th.accent, th.dark ? 0.14 : 0.12);
    ctx.fillRect(c.xOf(c.column), RULER, Math.max(1, cw), H - RULER);
  }

  // Links of the kinds shown: the selected row's, and with r those of everything else on screen, fainter while a row
  // is selected, so that its own stand out.
  const mine = linksShown(c) ? c.shownRelated : [];
  const others: Link[] = [];
  if (linksShown(c) && c.allLinks) {
    for (const r of rows) {
      for (const e of r.events) {
        for (const f of e.fields) {
          if (f.row === null || f.row === r.index || r.index === c.selected || f.row === c.selected) continue;
          const kind = linkKind(f.role);
          if (c.linkKinds.has(kind)) others.push({ from: f.row, to: r.index, cycle: e.cycle, kind });
        }
      }
    }
  }
  for (const r of rows) {
    const band = bandOf(r, false);
    if (band) {
      ctx.fillStyle = band;
      ctx.fillRect(gx, c.rowY(r.index), W - gx, rowH);
    }
  }
  for (const r of rows) {
    const y = c.rowY(r.index);
    const end = r.end ?? info.lastCycle + 1;
    if (c.xOf(end) < gx - 20 || c.xOf(r.start) > W + 20) continue;
    if (detail === 'letters' || detail === 'cells') drawCells(ctx, c, th, r, y, detail === 'letters');
    else if (detail === 'runs') drawRuns(ctx, c, th, r, y);
    else drawSolid(ctx, c, th, r, y);
  }
  const drawLinks = (links: Link[], alpha: number) => {
    ctx.globalAlpha = alpha;
    for (const a of links) {
      if (c.placeOf(a.from) < 0 || c.placeOf(a.to) < 0) continue;
      // From the edge after the event's cell on the linked object's row, into the mark the link explains: the dot of a
      // blocking event, on its left, or the cap of an abort, on the edge where the object's row ends. Any other link
      // ends on that edge too.
      const edge = c.xOf(a.cycle + 1) - 1;
      const to = a.kind === 'blocked' ? markAt(c, a.cycle, c.rowY(a.to)) : null;
      const x2 = to ? to.x + to.r + 2.5 : edge;
      const y2 = to ? to.y : c.rowY(a.to) + rowH / 2;
      drawLink(ctx, th, linkColor(th, a.kind), edge, c.rowY(a.from) + rowH / 2, x2, y2);
    }
    ctx.globalAlpha = 1;
  };
  drawLinks(others, c.selected === null ? 1 : 0.4);
  drawLinks(mine, 1);
  // The selected cell, where the selected row and column cross: lavender corners just outside it, which no cell
  // border looks like.
  if (c.selected !== null && c.column !== null && c.placeOf(c.selected) >= 0) {
    const w = Math.max(4, cw);
    drawBrackets(ctx, th, c.xOf(c.column) + (cw - w) / 2, c.rowY(c.selected), w, rowH);
  }
  // Cursors: lines in their groups' colors on the clock edges they mark, in the gaps between cells.
  for (const k of c.cursors) {
    ctx.fillStyle = th.cursors[k.group];
    ctx.fillRect(c.xOf(k.edge) - 0.75, RULER, 1.5, c.plotBottom - RULER);
  }
  ctx.restore();

  // ---- label column
  if (gx > 0) {
    ctx.fillStyle = th.mantle;
    ctx.fillRect(0, 0, gx, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER, gx - 1, H - RULER);
    ctx.clip();
    for (const r of rows) {
      const band = bandOf(r, true);
      if (band) {
        ctx.fillStyle = band;
        ctx.fillRect(0, c.rowY(r.index), gx, rowH);
      }
    }
    // Rows a search matches: a lavender mark at the column's left edge, which stays when rows are too small for text.
    if (c.search) {
      ctx.fillStyle = th.accent;
      for (const r of rows) if (c.search.rows.has(r.index)) ctx.fillRect(0, c.rowY(r.index) + padOf(rowH), 3, Math.max(1, rowH - 2 * padOf(rowH)));
    }
    if (rowH >= LABEL_ROWS) drawLabels(ctx, c, th, rows);
    ctx.restore();
    ctx.fillStyle = th.surface0;
    ctx.fillRect(gx - 1, 0, 1, H);
  }

  // ---- ruler
  ctx.fillStyle = th.mantle;
  ctx.fillRect(gx, 0, W - gx, RULER);
  ctx.fillStyle = th.surface0;
  ctx.fillRect(0, RULER - 1, W, 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(gx, 0, W - gx, RULER);
  ctx.clip();
  if (c.hover?.cycle != null) {
    ctx.fillStyle = rgba(th.overlay0, 0.2);
    ctx.fillRect(c.xOf(c.hover.cycle), 0, Math.max(1, cw), RULER - 1);
  }
  if (c.column !== null) {
    ctx.fillStyle = rgba(th.accent, th.dark ? 0.3 : 0.25);
    ctx.fillRect(c.xOf(c.column), 0, Math.max(1, cw), RULER - 1);
  }
  ctx.font = MONO(11);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let k = Math.ceil(cStart / step) * step; k <= cEnd; k += step) {
    const x = Math.round(c.xOf(k));
    if (x < gx) continue;
    ctx.fillStyle = th.surface2;
    ctx.fillRect(x, RULER - 7, 1, 6);
    ctx.fillStyle = th.subtext0;
    ctx.fillText(fmt(k), x + 4, RULER / 2);
  }
  // The ruler is left to time: cursors cross it as lines only, their tags and distances in the strip below.
  for (const k of c.cursors) {
    ctx.fillStyle = th.cursors[k.group];
    ctx.fillRect(c.xOf(k.edge) - 0.75, 0, 1.5, RULER);
  }
  ctx.restore();
  if (c.cursors.length) drawCursorStrip(ctx, c, th);
}

/** A text in a box on a lane of the cursor strip. */
interface TagBox {
  left: number;
  w: number;
  text: string;
}

/** Where a lane's tags go: each cursor's name and cycle beside its line, right of it as tick labels are, or left of it
 *  when that would run into the next cursor; none when neither side has room. */
function layoutTags(ctx: CanvasRenderingContext2D, c: Controller, lane: Cursor[]): (TagBox | null)[] {
  const xs = lane.map((k) => c.xOf(k.edge));
  const tags: (TagBox | null)[] = [];
  // Where the last tag or line ends, which the next tag must clear.
  let floor = -Infinity;
  xs.forEach((x, i) => {
    const { edge, name } = lane[i];
    const text = name ? `${name} · ${fmt(edge)}` : fmt(edge);
    const w = ctx.measureText(text).width + 10;
    const ceiling = Math.min(c.width, i + 1 < xs.length ? xs[i + 1] - 2 : Infinity);
    let left: number | null = null;
    if (x >= floor && x + w <= ceiling) left = x;
    else if (x - w >= floor) left = x - w;
    tags.push(left === null ? null : { left, w, text });
    floor = Math.max(x, left === null ? x : left + w) + 2;
  });
  return tags;
}

/** The cursor strip along the bottom of the waterfall: a lane for each group with cursors, its color as a dot in the
 *  label column, as the cursor panel shows it. A lane holds its group's tags, boxes outlined in its color with its fill and ink, and between neighbors a
 *  line in its color with the distance as plain text in its ink, the line breaking around it. A cursor being named has
 *  its name box over its tag. */
function drawCursorStrip(ctx: CanvasRenderingContext2D, c: Controller, th: Theme): void {
  const top = c.plotBottom;
  ctx.save();
  ctx.fillStyle = th.mantle;
  ctx.fillRect(0, top, c.width, c.stripH);
  ctx.fillStyle = th.surface0;
  ctx.fillRect(0, top, c.width, 1);
  if (c.gutterW > 0) ctx.fillRect(c.gutterW - 1, top, 1, c.stripH);
  for (const g of c.cursorLanes) {
    ctx.fillStyle = th.cursors[g];
    ctx.beginPath();
    ctx.arc(EDGE + 6, c.laneY(g), 6, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.rect(c.gutterW, top, c.width - c.gutterW, c.stripH);
  ctx.clip();
  for (const k of c.cursors) {
    ctx.fillStyle = th.cursors[k.group];
    ctx.fillRect(c.xOf(k.edge) - 0.75, top, 1.5, c.stripH);
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const g of c.cursorLanes) {
    const y = c.laneY(g);
    const color = th.cursors[g];
    const lane = c.cursors.filter((k) => k.group === g);
    const xs = lane.map((k) => c.xOf(k.edge));
    ctx.font = MONO(11, 600);
    const tags = layoutTags(ctx, c, lane);
    for (let i = 0; i + 1 < xs.length; i++) {
      ctx.fillStyle = color;
      ctx.fillRect(xs[i], y - 0.75, xs[i + 1] - xs[i], 1.5);
      const text = `Δ ${fmt(lane[i + 1].edge - lane[i].edge)}`;
      ctx.font = MONO(11);
      const w = ctx.measureText(text).width + 10;
      const from = Math.max(c.gutterW, xs[i], tags[i] ? tags[i]!.left + tags[i]!.w : -Infinity);
      const to = Math.min(c.width, xs[i + 1], tags[i + 1]?.left ?? Infinity);
      if (to - from < w + 8) continue;
      const left = (from + to - w) / 2;
      ctx.fillStyle = th.mantle;
      ctx.fillRect(left, y - 7, w, 14);
      ctx.fillStyle = th.cursorInks[g];
      ctx.fillText(text, left + 5, y + 0.5);
    }
    ctx.font = MONO(11, 600);
    tags.forEach((t, i) => {
      if (!t || lane[i].edge === c.naming) return;
      rr(ctx, t.left + 0.5, y - 7.5, t.w - 1, 15, 4);
      ctx.fillStyle = th.cursorFills[g];
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = th.cursorInks[g];
      ctx.fillText(t.text, t.left + 5, y + 0.5);
    });
  }
  ctx.restore();
}

function padOf(rowH: number): number {
  return rowH >= 10 ? 2 : rowH >= 4 ? 1 : 0;
}

/** A dot for an event, edged in the ground color: amber for one that finds its object blocked, and a little smaller
 *  and gray for any other that describes an object without moving or ending it. */
function drawDot(ctx: CanvasRenderingContext2D, color: string, ground: string, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = ground;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
}

/** A cap where an object left without its type's normal end. */
function drawCap(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, h: number): void {
  rr(ctx, x - 1.5, y, 3, h, 1.5);
  ctx.fillStyle = th.killed;
  ctx.fill();
}

/** Where an event's dot goes, near the top left of its cell in a row at y, and a blocking event's dot's radius. */
function markAt(c: Controller, cycle: number, y: number): { x: number; y: number; r: number } {
  const s = Math.min(1, Math.max(0.5, Math.min(c.cellW, c.rowH) / 18));
  return { x: c.xOf(cycle) + Math.max(3, Math.min(c.cellW * 0.22, 6)), y: y + padOf(c.rowH) + 3.5 * s, r: 3.5 * s };
}

function drawMarks(ctx: CanvasRenderingContext2D, c: Controller, th: Theme, r: RowView, y: number, gap: number): void {
  const pad = padOf(c.rowH);
  for (const e of r.events) {
    const at = markAt(c, e.cycle, y);
    if (e.blocks) drawDot(ctx, th.blocked, th.base, at.x, at.y, at.r);
    else if (e.effect.kind === 'observes') drawDot(ctx, th.event, th.base, at.x, at.y, at.r * 0.85);
  }
  if (aborted(r)) drawCap(ctx, th, c.xOf(r.end!) - gap / 2, y + pad, c.rowH - 2 * pad);
}

/** Dashes of a held stretch of bar, and the gaps between them, in pixels. */
const DASH = 3;
const DASH_GAP = 2;

/** The bar's height in a cell this tall: as the focused type's bar, or a third of a short cell. */
function barHeight(h: number): number {
  return h >= 8 ? 2 : Math.max(1, Math.round(h / 3));
}

/** The bar an unfocused type keeps along the bottom of its cells, from x1 to x2: dashed up to hx, where the object is
 *  held, and whole after it, where it moves on. Hatching marks held cycles in the focused type only. */
function drawBar(ctx: CanvasRenderingContext2D, color: string, x1: number, x2: number, hx: number, bottom: number, h: number): void {
  ctx.fillStyle = color;
  for (let x = x1; x < hx; x += DASH + DASH_GAP) ctx.fillRect(x, bottom - h, Math.min(DASH, hx - x), h);
  if (x2 > hx) ctx.fillRect(hx, bottom - h, x2 - hx, h);
}

/** One cell per cycle; held cycles hatched; letters when there is room. An unfocused type keeps only its bars. */
function drawCells(ctx: CanvasRenderingContext2D, c: Controller, th: Theme, r: RowView, y: number, letters: boolean): void {
  const cw = c.cellW;
  const pad = padOf(c.rowH);
  const h = c.rowH - 2 * pad;
  const gap = 2;
  const stages = c.source.info.types[r.type].stages;
  const cMin = Math.floor(c.x0) - 1;
  const cMax = Math.ceil(c.x0 + c.visibleCycles) + 1;
  ctx.globalAlpha = aborted(r) ? 0.5 : 1;
  ctx.font = MONO(11, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const focused = r.type === c.focusType;
  for (const s of r.segments) {
    const color = th.stages[s.stage % th.stages.length];
    for (let k = Math.max(s.from, cMin); k < Math.min(s.to, cMax); k++) {
      const x = c.xOf(k);
      const held = k < s.from + s.held;
      if (focused) {
        rr(ctx, x + gap / 2, y + pad, cw - gap, h, cw >= 10 ? 3 : 1);
        ctx.fillStyle = held ? th.hatch[s.stage % th.hatch.length] : rgba(color, th.wash);
        ctx.fill();
        if (!held && h >= 8) {
          ctx.fillStyle = color;
          ctx.fillRect(x + gap / 2, y + pad + h - 2, cw - gap, 2);
        }
      } else {
        const left = x + gap / 2;
        drawBar(ctx, color, left, x + cw - gap / 2, held ? x + cw - gap / 2 : left, y + pad + h, barHeight(h));
      }
      if (letters) {
        ctx.fillStyle = held ? th.subtext0 : focused ? th.text : th.subtext1;
        ctx.fillText(stages[s.stage]?.[0] ?? '?', x + cw / 2, y + c.rowH / 2 - 0.5);
      }
    }
  }
  ctx.globalAlpha = 1;
  drawMarks(ctx, c, th, r, y, gap);
}

/** Each stage's cycles merged into one run, held part hatched. An unfocused type keeps only its bars. */
function drawRuns(ctx: CanvasRenderingContext2D, c: Controller, th: Theme, r: RowView, y: number): void {
  const pad = padOf(c.rowH);
  const h = c.rowH - 2 * pad;
  const gap = c.cellW >= 5 ? 2 : 1;
  ctx.globalAlpha = aborted(r) ? 0.5 : 1;
  const focused = r.type === c.focusType;
  for (const s of r.segments) {
    const color = th.stages[s.stage % th.stages.length];
    const x1 = c.xOf(s.from) + gap / 2;
    const x2 = c.xOf(s.to) - gap / 2;
    if (x2 < c.gutterW || x1 > c.width) continue;
    const hx = Math.max(x1, Math.min(x2, c.xOf(s.from + s.held)));
    if (!focused) {
      drawBar(ctx, color, x1, x2, hx, y + pad + h, barHeight(h));
      continue;
    }
    ctx.save();
    rr(ctx, x1, y + pad, x2 - x1, h, Math.min(3, c.cellW / 3));
    ctx.clip();
    if (hx > x1) {
      ctx.fillStyle = th.hatch[s.stage % th.hatch.length];
      ctx.fillRect(x1, y + pad, hx - x1, h);
    }
    if (x2 > hx) {
      if (h >= 8) {
        ctx.fillStyle = rgba(color, th.wash);
        ctx.fillRect(hx, y + pad, x2 - hx, h);
        ctx.fillStyle = color;
        ctx.fillRect(hx, y + pad + h - 2, x2 - hx, 2);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(hx, y + pad, x2 - hx, h);
      }
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  drawMarks(ctx, c, th, r, y, gap);
}

/** Solid runs; events and caps become thin ticks. An unfocused type keeps only its bars. */
function drawSolid(ctx: CanvasRenderingContext2D, c: Controller, th: Theme, r: RowView, y: number): void {
  const inset = c.rowH >= 3 ? 1 : 0;
  const top = y + inset;
  const h = Math.max(1, c.rowH - inset);
  ctx.globalAlpha = aborted(r) ? 0.4 : 1;
  const focused = r.type === c.focusType;
  for (const s of r.segments) {
    const color = th.stages[s.stage % th.stages.length];
    const x1 = c.xOf(s.from);
    const x2 = c.xOf(s.to);
    if (x2 < c.gutterW || x1 > c.width) continue;
    const hx = Math.max(x1, Math.min(x2, c.xOf(s.from + s.held)));
    if (!focused) {
      drawBar(ctx, color, x1, Math.max(x1 + 1, x2), hx, top + h, barHeight(h));
      continue;
    }
    if (hx > x1) {
      ctx.fillStyle = rgba(color, 0.4);
      ctx.fillRect(x1, top, hx - x1, h);
    }
    ctx.fillStyle = color;
    ctx.fillRect(hx, top, Math.max(1, x2 - hx), h);
  }
  ctx.globalAlpha = 1;
  for (const e of r.events) {
    if (!e.blocks && e.effect.kind !== 'observes') continue;
    ctx.fillStyle = e.blocks ? th.blocked : th.event;
    ctx.fillRect(c.xOf(e.cycle), top, Math.max(1.5, c.cellW * 0.4), h);
  }
  if (aborted(r)) {
    ctx.fillStyle = th.killed;
    ctx.fillRect(c.xOf(r.end!), top, Math.max(2, c.cellW * 0.6), h);
  }
}

/** Four corners around a cell, a little outside it. */
function drawBrackets(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, w: number, h: number): void {
  const x1 = x - 1.5;
  const x2 = x + w + 1.5;
  const y1 = y - 1;
  const y2 = y + h + 1;
  const l = Math.max(2, Math.min(5, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x1, y1 + l);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 + l, y1);
  ctx.moveTo(x2 - l, y1);
  ctx.lineTo(x2, y1);
  ctx.lineTo(x2, y1 + l);
  ctx.moveTo(x2, y2 - l);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 - l, y2);
  ctx.moveTo(x1 + l, y2);
  ctx.lineTo(x1, y2);
  ctx.lineTo(x1, y2 - l);
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** A link's color, by what it says: red for what aborted an object, as the cap at its end; amber for what blocks it,
 *  as the dot of the event that says so; gray for anything else, such as its parent. */
function linkColor(th: Theme, kind: LinkKind): string {
  return kind === 'aborted' ? th.killed : kind === 'blocked' ? th.blocked : th.overlay1;
}

/** A link from (x1, y1) to (x2, y2), bowed to the right, edged in the ground color so that it reads over any stage's
 *  cells. It has no arrowhead: the mark it runs into shows which end is affected, and a link without a mark, such as
 *  from a parent, comes down from the row above. */
function drawLink(ctx: CanvasRenderingContext2D, th: Theme, color: string, x1: number, y1: number, x2: number, y2: number): void {
  const right = Math.max(x1, x2) + Math.max(18, Math.abs(y2 - y1) * 0.35);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(right, y1, right, y2, x2, y2);
  ctx.lineCap = 'round';
  ctx.strokeStyle = th.base;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** Each row's type while several show, indented once for each shown ancestor, then its ID and label texts, which
 *  line up across rows; the last label text is the main one. */
function drawLabels(ctx: CanvasRenderingContext2D, c: Controller, th: Theme, rows: RowView[]): void {
  const info = c.source.info;
  ctx.font = MONO(labelFontSize(c.rowH));
  ctx.textBaseline = 'middle';
  const charW = ctx.measureText('0').width;
  const { showType, typeW, idW, indent } = labelColumns(info, c.hiddenTypes, charW);
  for (const r of rows) {
    const cy = c.rowY(r.index) + c.rowH / 2 + 0.5;
    const t = info.types[r.type];
    let x = EDGE;
    if (showType) {
      ctx.textAlign = 'left';
      ctx.fillStyle = th.overlay1;
      ctx.fillText(t.name, x + indent(r.ancestorTypes), cy);
      x += typeW;
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = th.overlay1;
    ctx.fillText(String(r.id), x + idW, cy);
    x += idW + GAP;
    ctx.textAlign = 'left';
    r.label.forEach((text, k) => {
      const lastLabel = k === r.label.length - 1;
      // Earlier columns are as wide as their longest text, so they are drawn whole; the gutter's clip bounds them.
      const room = c.gutterW - x - EDGE;
      if (text && (!lastLabel || room > charW)) {
        const shown = lastLabel ? ellipsize(ctx, text, room) : text;
        ctx.fillStyle = aborted(r) ? th.overlay1 : lastLabel ? th.text : th.subtext0;
        ctx.fillText(shown, x, cy);
        if (aborted(r) && lastLabel) {
          ctx.fillStyle = th.overlay1;
          ctx.fillRect(x, Math.round(cy), ctx.measureText(shown).width, 1);
        }
      }
      x += (t.labelWidths[k] ?? text.length) * charW + GAP;
    });
  }
}
