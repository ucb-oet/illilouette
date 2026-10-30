// A plain bar of the whole trace: its cycle range, a marker for the current view, click or drag to move there, with
// the rows following to the objects in the new range.
import { useEffect, useRef } from 'preact/hooks';
import { fmt } from '../model/present';
import { Controller } from './controller';
import { MONO, onThemeChange, readTheme, rgba } from './theme';

const PAD = 12;
const MIN_MARKER = 6;

export function TimelineBar({ c }: { c: Controller }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const { firstCycle, lastCycle } = c.source.info;
    const span = Math.max(1, lastCycle + 1 - firstCycle);
    let W = 1;
    let H = 1;
    let dpr = 1;

    const draw = () => {
      const th = readTheme(ctx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = th.mantle;
      ctx.fillRect(0, 0, W, H);
      const w = W - PAD * 2;
      const mid = H / 2;
      ctx.fillStyle = th.surface1;
      ctx.fillRect(PAD, mid - 1, w, 2);
      ctx.font = MONO(11);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const left = fmt(firstCycle);
      const right = fmt(lastCycle);
      // The view's marker, kept a few pixels wide so that it stays visible on a long trace.
      const x1 = PAD + ((c.x0 - firstCycle) / span) * w;
      const x2 = PAD + ((c.x0 + c.visibleCycles - firstCycle) / span) * w;
      const mx = Math.max(PAD - 2, Math.min(x1, PAD + w - MIN_MARKER));
      const mw = Math.max(MIN_MARKER, Math.min(x2, PAD + w + 2) - mx);
      ctx.fillStyle = rgba(th.accent, th.dark ? 0.3 : 0.25);
      ctx.beginPath();
      ctx.roundRect?.(mx, 4, mw, H - 8, 4);
      ctx.fill();
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // A search's matches, as short ticks below the line, one per pixel at most, so that clusters show.
      if (c.search) {
        ctx.fillStyle = th.accent;
        let last = -Infinity;
        for (const m of c.search.matches) {
          const x = Math.round(PAD + ((m.cycle - firstCycle) / span) * w);
          if (x === last) continue;
          last = x;
          ctx.fillRect(x, mid + 3, 1, H / 2 - 7);
        }
      }
      // Cursors, so that a distant one can be clicked back to.
      for (const k of c.cursors) {
        ctx.fillStyle = th.cursors[k.group];
        ctx.fillRect(PAD + ((k.edge - firstCycle) / span) * w - 0.75, 7, 1.5, H - 14);
      }
      // The trace's range at the ends, unless the marker covers them.
      ctx.fillStyle = th.subtext0;
      if (mx > PAD + ctx.measureText(left).width + 8) ctx.fillText(left, PAD + 2, mid - 9);
      ctx.textAlign = 'right';
      if (mx + mw < PAD + w - ctx.measureText(right).width - 8) ctx.fillText(right, PAD + w - 2, mid - 9);
    };

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const b = el.getBoundingClientRect();
      W = Math.max(1, b.width);
      H = Math.max(1, b.height);
      el.width = Math.round(W * dpr);
      el.height = Math.round(H * dpr);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const unsubscribe = c.subscribe(draw);
    const stopTheme = onThemeChange(draw);

    let dragging = false;
    const move = (ev: PointerEvent) => {
      const b = el.getBoundingClientRect();
      void c.moveToCycle(firstCycle + ((ev.clientX - b.left - PAD) / (W - PAD * 2)) * span);
    };
    const onDown = (ev: PointerEvent) => {
      dragging = true;
      el.setPointerCapture(ev.pointerId);
      move(ev);
    };
    const onMove = (ev: PointerEvent) => dragging && move(ev);
    const onUp = () => (dragging = false);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => {
      observer.disconnect();
      unsubscribe();
      stopTheme();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
  }, [c]);

  return <canvas class="timeline" ref={canvas} aria-label="The whole trace; click or drag to move the view" />;
}
