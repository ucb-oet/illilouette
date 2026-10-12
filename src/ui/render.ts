// Draws the waterfall: the label column, the ruler, and one row per object. How much a row shows follows its size:
// lettered cells up close, one run per stage in the middle, solid rows far out.
import { fmt } from '../model/present';
import type { RowView } from '../model/source';
import { Controller, RULER } from './controller';
import { MONO, rgba, type Theme } from './theme';

export type Detail = 'letters' | 'cells' | 'runs' | 'solid';

export function detailOf(c: Controller): Detail {
  if (c.cellW >= 14 && c.rowH >= 16) return 'letters';
  if (c.cellW >= 8) return 'cells';
  if (c.cellW >= 2.5) return 'runs';
  return 'solid';
}

export const DETAIL_NAMES: Record<Detail, string> = {
  letters: 'Lettered cells',
  cells: 'Cells',
  runs: 'One run per stage',
  solid: 'Solid rows',
};

/** An arrow from one object to another at a cycle: from a stall's blocker to the stalled instruction, say. */
interface Arrow {
  from: number;
  to: number;
  cycle: number;
}

const muted = (r: RowView) => r.end !== null && !r.normalEnd;

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
  const last = Math.min(info.rowCount, Math.ceil((c.y0 + H - RULER) / rowH) + 1);
  const rows: RowView[] = [];
  for (let i = first; i < last; i++) {
    const r = c.row(i);
    if (r && !c.hiddenTypes.has(r.type)) rows.push(r);
  }
  const cStart = Math.floor(c.x0);
  const cEnd = Math.ceil(c.x0 + c.visibleCycles);
  const step = niceStep(72 / cw);

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

  const arrows: Arrow[] = [...c.related];
  if (c.allArrows) {
    for (const r of rows) for (const e of r.events) for (const f of e.fields) if (f.row !== null) arrows.push({ from: f.row, to: r.index, cycle: e.cycle });
  }
  const relatedRows = new Set(c.related.flatMap((a) => [a.from, a.to]));
  for (const r of rows) {
    const y = c.rowY(r.index);
    let band: string | null = null;
    if (r.index === c.selected) band = rgba(th.accent, th.dark ? 0.16 : 0.14);
    else if (relatedRows.has(r.index)) band = rgba(th.accent, th.dark ? 0.07 : 0.06);
    else if (c.hover?.row === r.index) band = rgba(th.overlay0, 0.1);
    if (band) {
      ctx.fillStyle = band;
      ctx.fillRect(gx, y, W - gx, rowH);
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
  for (const a of arrows) {
    const xc = c.xOf(a.cycle) + Math.min(cw, 24) / 2;
    drawArrow(ctx, th, xc, c.rowY(a.from) + rowH / 2, c.rowY(a.to) + rowH / 2);
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
      if (r.index === c.selected) {
        ctx.fillStyle = rgba(th.accent, th.dark ? 0.2 : 0.16);
        ctx.fillRect(0, c.rowY(r.index), gx, rowH);
      }
    }
    if (rowH >= 12) drawLabels(ctx, c, th, rows);
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
  ctx.restore();
}

function padOf(rowH: number): number {
  return rowH >= 10 ? 2 : rowH >= 4 ? 1 : 0;
}

/** A dot for an event that describes an object without moving or ending it. */
function drawDot(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 3.5 * s, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = th.base;
  ctx.stroke();
  ctx.fillStyle = th.event;
  ctx.fill();
}

/** A cap where an object left without its type's normal end. */
function drawCap(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, h: number): void {
  rr(ctx, x - 1.5, y, 3, h, 1.5);
  ctx.fillStyle = th.killed;
  ctx.fill();
}

function drawMarks(ctx: CanvasRenderingContext2D, c: Controller, th: Theme, r: RowView, y: number, gap: number): void {
  const pad = padOf(c.rowH);
  const s = Math.min(1, Math.max(0.5, Math.min(c.cellW, c.rowH) / 18));
  for (const e of r.events) {
    if (e.effect.kind === 'observes') drawDot(ctx, th, c.xOf(e.cycle) + Math.max(3, Math.min(c.cellW * 0.22, 6)), y + pad + 3.5 * s, s);
  }
  if (muted(r)) drawCap(ctx, th, c.xOf(r.end!) - gap / 2, y + pad, c.rowH - 2 * pad);
}

/** One cell per cycle; held cycles hatched; letters when there is room. */
function drawCells(ctx: CanvasRenderingContext2D, c: Controller, th: Theme, r: RowView, y: number, letters: boolean): void {
  const cw = c.cellW;
  const pad = padOf(c.rowH);
  const h = c.rowH - 2 * pad;
  const gap = 2;
  const stages = c.source.info.types[r.type].stages;
  const cMin = Math.floor(c.x0) - 1;
  const cMax = Math.ceil(c.x0 + c.visibleCycles) + 1;
  ctx.globalAlpha = muted(r) ? 0.5 : 1;
  ctx.font = MONO(11, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of r.segments) {
    const color = th.stages[s.stage % th.stages.length];
    for (let k = Math.max(s.from, cMin); k < Math.min(s.to, cMax); k++) {
      const x = c.xOf(k);
      const held = k < s.from + s.held;
      rr(ctx, x + gap / 2, y + pad, cw - gap, h, cw >= 10 ? 3 : 1);
      ctx.fillStyle = held ? th.hatch[s.stage % th.hatch.length] : rgba(color, th.wash);
      ctx.fill();
      if (!held && h >= 8) {
        ctx.fillStyle = color;
        ctx.fillRect(x + gap / 2, y + pad + h - 2, cw - gap, 2);
      }
      if (letters) {
        ctx.fillStyle = held ? th.subtext0 : th.text;
        ctx.fillText(stages[s.stage]?.[0] ?? '?', x + cw / 2, y + c.rowH / 2 - 0.5);
      }
    }
  }
  ctx.globalAlpha = 1;
  drawMarks(ctx, c, th, r, y, gap);
}

/** Each stage's cycles merged into one run, held part hatched. */
function drawRuns(ctx: CanvasRenderingContext2D, c: Controller, th: Theme, r: RowView, y: number): void {
  const pad = padOf(c.rowH);
  const h = c.rowH - 2 * pad;
  const gap = c.cellW >= 5 ? 2 : 1;
  ctx.globalAlpha = muted(r) ? 0.5 : 1;
  for (const s of r.segments) {
    const color = th.stages[s.stage % th.stages.length];
    const x1 = c.xOf(s.from) + gap / 2;
    const x2 = c.xOf(s.to) - gap / 2;
    if (x2 < c.gutterW || x1 > c.width) continue;
    const hx = Math.max(x1, Math.min(x2, c.xOf(s.from + s.held)));
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

/** Solid runs; events and caps become thin ticks. */
function drawSolid(ctx: CanvasRenderingContext2D, c: Controller, th: Theme, r: RowView, y: number): void {
  const inset = c.rowH >= 3 ? 1 : 0;
  const top = y + inset;
  const h = Math.max(1, c.rowH - inset);
  ctx.globalAlpha = muted(r) ? 0.4 : 1;
  for (const s of r.segments) {
    const color = th.stages[s.stage % th.stages.length];
    const x1 = c.xOf(s.from);
    const x2 = c.xOf(s.to);
    if (x2 < c.gutterW || x1 > c.width) continue;
    const hx = Math.max(x1, Math.min(x2, c.xOf(s.from + s.held)));
    if (hx > x1) {
      ctx.fillStyle = rgba(color, 0.4);
      ctx.fillRect(x1, top, hx - x1, h);
    }
    ctx.fillStyle = color;
    ctx.fillRect(hx, top, Math.max(1, x2 - hx), h);
  }
  ctx.globalAlpha = 1;
  for (const e of r.events) {
    if (e.effect.kind !== 'observes') continue;
    ctx.fillStyle = th.event;
    ctx.fillRect(c.xOf(e.cycle), top, Math.max(1.5, c.cellW * 0.4), h);
  }
  if (muted(r)) {
    ctx.fillStyle = th.killed;
    ctx.fillRect(c.xOf(r.end!), top, Math.max(2, c.cellW * 0.6), h);
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, th: Theme, x: number, y1: number, y2: number): void {
  const bow = Math.max(18, Math.abs(y2 - y1) * 0.35);
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.bezierCurveTo(x + bow, y1, x + bow, y2, x + 3, y2);
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 3, y2);
  ctx.lineTo(x + 10, y2 - 4.5);
  ctx.lineTo(x + 10, y2 + 4.5);
  ctx.closePath();
  ctx.fillStyle = th.accent;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y1, 3.5, 0, Math.PI * 2);
  ctx.strokeStyle = th.base;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fill();
}

/** Each row's ID, then its label texts, aligned per type; the last label text is the main one. */
function drawLabels(ctx: CanvasRenderingContext2D, c: Controller, th: Theme, rows: RowView[]): void {
  const info = c.source.info;
  const size = c.rowH >= 18 ? 12 : 11;
  ctx.font = MONO(size);
  ctx.textBaseline = 'middle';
  const charW = ctx.measureText('0').width;
  const showType = info.types.length - c.hiddenTypes.size > 1;
  const typeW = showType ? Math.max(...info.types.map((t) => t.name.length)) * charW + 12 : 0;
  const idW = Math.max(...info.types.map((t) => t.idWidth)) * charW;
  for (const r of rows) {
    const cy = c.rowY(r.index) + c.rowH / 2 + 0.5;
    const t = info.types[r.type];
    let x = 10;
    if (showType) {
      ctx.textAlign = 'left';
      ctx.fillStyle = th.overlay1;
      ctx.fillText(t.name, x, cy);
      x += typeW;
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = th.overlay1;
    ctx.fillText(String(r.id), x + idW, cy);
    x += idW + 14;
    ctx.textAlign = 'left';
    r.label.forEach((text, k) => {
      const lastLabel = k === r.label.length - 1;
      const room = lastLabel ? c.gutterW - x - 10 : (t.labelWidths[k] ?? text.length) * charW;
      if (room > charW && text) {
        const shown = ellipsize(ctx, text, room);
        ctx.fillStyle = muted(r) ? th.overlay1 : lastLabel ? th.text : th.subtext0;
        ctx.fillText(shown, x, cy);
        if (muted(r) && lastLabel) {
          ctx.fillStyle = th.overlay1;
          ctx.fillRect(x, Math.round(cy), ctx.measureText(shown).width, 1);
        }
      }
      x += (t.labelWidths[k] ?? text.length) * charW + 14;
    });
  }
}
