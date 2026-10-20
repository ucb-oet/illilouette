// The waterfall canvas: sizing, pointer and wheel input, the label column's splitter, and the hover tooltip.
import { useEffect, useRef } from 'preact/hooks';
import { effectText, endText, fieldText, fmt, objectName, outcomeText, segmentAt, shortName } from '../model/present';
import type { RowView } from '../model/source';
import { Controller, RULER, useController } from './controller';
import { drawWaterfall } from './render';
import { onThemeChange, readTheme, type Theme } from './theme';

export function Waterfall({ c }: { c: Controller }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const splitter = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    let theme: Theme = readTheme(ctx);
    let dpr = window.devicePixelRatio || 1;
    let frame = 0;
    const draw = () => {
      frame = 0;
      drawWaterfall(ctx, c, theme, dpr);
      if (splitter.current) splitter.current.style.left = `${c.gutterW}px`;
    };
    c.onRedraw(() => {
      if (!frame) frame = requestAnimationFrame(draw);
    });

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const b = wrap.current!.getBoundingClientRect();
      c.setSize(b.width, b.height);
      el.width = Math.round(c.width * dpr);
      el.height = Math.round(c.height * dpr);
      c.gutterW = Math.min(c.gutterW, Math.max(0, c.width - 160));
      c.clamp();
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap.current!);

    const stopTheme = onThemeChange(() => {
      theme = readTheme(ctx);
      c.redraw();
    });

    // Pointer: drag to move, click to select, hover for the tooltip.
    let drag: { x: number; y: number; x0: number; y0: number; moved: boolean } | null = null;
    const local = (ev: PointerEvent | WheelEvent) => {
      const b = el.getBoundingClientRect();
      return { x: ev.clientX - b.left, y: ev.clientY - b.top };
    };
    const onDown = (ev: PointerEvent) => {
      el.setPointerCapture(ev.pointerId);
      drag = { x: ev.clientX, y: ev.clientY, x0: c.x0, y0: c.y0, moved: false };
    };
    const onMove = (ev: PointerEvent) => {
      if (drag) {
        const dx = ev.clientX - drag.x;
        const dy = ev.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          drag.moved = true;
          el.classList.add('grabbing');
          tip.current!.hidden = true;
        }
        if (drag.moved) {
          c.x0 = drag.x0 - dx / c.cellW;
          c.y0 = drag.y0 - dy;
          c.clamp();
          c.changed();
          return;
        }
      }
      const { x, y } = local(ev);
      const row = c.rowAtY(y);
      const cycle = c.cycleAtX(x);
      if (c.hover?.row !== row || c.hover?.cycle !== cycle) {
        c.hover = { row, cycle, x, y };
        c.changed();
      }
      showTip(c, tip.current!, row, cycle, x, y);
    };
    const onUp = (ev: PointerEvent) => {
      el.classList.remove('grabbing');
      if (drag && !drag.moved) {
        // A click selects the object under it, and the cycle, as a click in vim puts its cursor on a line and column;
        // a click on the label column keeps the cycle.
        const { x, y } = local(ev);
        const row = c.rowAtY(y);
        const r = row === null ? undefined : c.row(row);
        c.select(r && !c.hiddenTypes.has(r.type) ? row : null);
        const cycle = c.cycleAtX(x);
        if (y > RULER && cycle !== null) c.selectColumn(cycle);
      }
      drag = null;
    };
    const onLeave = () => {
      c.hover = null;
      tip.current!.hidden = true;
      c.changed();
    };
    // Wheel: scroll moves through rows; Shift or a sideways swipe pans time. Ctrl or Cmd, or a pinch, zooms time, and
    // with Shift, rows: Shift switches the axis, as Q and E zoom rows where q and e zoom time.
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      tip.current!.hidden = true;
      const { x, y } = local(ev);
      const scale = ev.deltaMode === 1 ? 16 : 1;
      // Some systems turn a wheel with Shift held into a sideways scroll.
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey) c.zoomRows(Math.exp(-(ev.deltaY || ev.deltaX) * scale * 0.0025), y);
      else if (ev.ctrlKey || ev.metaKey) c.zoomTime(x, Math.exp(-ev.deltaY * scale * 0.0025));
      else if (ev.shiftKey) c.panTime((ev.deltaY || ev.deltaX) * scale / c.cellW);
      else if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) c.panTime(ev.deltaX * scale / c.cellW);
      else c.scrollRows(ev.deltaY * scale);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });

    // The splitter between the label column and the timeline.
    const sp = splitter.current!;
    let splitDrag: { x: number; w: number } | null = null;
    const onSplitDown = (ev: PointerEvent) => {
      sp.setPointerCapture(ev.pointerId);
      sp.classList.add('dragging');
      splitDrag = { x: ev.clientX, w: c.gutterW };
    };
    const onSplitMove = (ev: PointerEvent) => {
      if (!splitDrag) return;
      c.gutterW = Math.min(Math.max(0, splitDrag.w + ev.clientX - splitDrag.x), c.width - 160);
      c.clamp();
      c.changed();
    };
    const onSplitUp = () => {
      splitDrag = null;
      sp.classList.remove('dragging');
    };
    sp.addEventListener('pointerdown', onSplitDown);
    sp.addEventListener('pointermove', onSplitMove);
    sp.addEventListener('pointerup', onSplitUp);

    return () => {
      observer.disconnect();
      stopTheme();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      sp.removeEventListener('pointerdown', onSplitDown);
      sp.removeEventListener('pointermove', onSplitMove);
      sp.removeEventListener('pointerup', onSplitUp);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [c]);

  return (
    <div class="viewer" ref={wrap}>
      <canvas ref={canvas} tabIndex={0} aria-label="Pipeline waterfall: one row per object, one column per cycle" />
      <div class="splitter" ref={splitter} title="Drag to resize the label column" />
      <div class="tooltip" ref={tip} role="status" hidden />
      <CursorName c={c} />
    </div>
  );
}

/** The box a new cursor's name is typed in, on the ruler at its line, filled with its cycle. Enter or Esc keeps the
 *  name, as Esc leaves vim's insert mode; so does clicking elsewhere. */
function CursorName({ c }: { c: Controller }) {
  useController(c);
  const box = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const edge = c.naming;
  useEffect(() => {
    done.current = false;
    box.current?.focus();
    box.current?.select();
  }, [edge]);
  if (edge === null) return null;
  const keep = () => {
    if (done.current) return;
    done.current = true;
    c.nameCursor(edge, box.current?.value ?? '');
  };
  return (
    <input
      ref={box}
      class="cursor-name"
      style={{ left: `${Math.max(c.gutterW, Math.min(c.xOf(edge), c.width - 140))}px` }}
      defaultValue={fmt(edge)}
      aria-label="Cursor name"
      spellcheck={false}
      autocomplete="off"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          keep();
        }
      }}
      onBlur={keep}
    />
  );
}

/** Fills and places the tooltip for the hovered cell, or, over the label column, for the hovered row. Texts go in
 *  through textContent: they come from the file. */
function showTip(c: Controller, tip: HTMLDivElement, rowIndex: number | null, cycle: number | null, x: number, y: number): void {
  const r: RowView | undefined = rowIndex === null ? undefined : c.row(rowIndex);
  const end = r ? (r.end ?? c.source.info.lastCycle + 1) : 0;
  if (!r || c.hiddenTypes.has(r.type) || (cycle !== null && (cycle < r.start || cycle > end))) {
    tip.hidden = true;
    return;
  }
  const type = c.source.info.types[r.type];
  const div = (cls: string, text: string) => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  };
  tip.replaceChildren();
  const label = r.label.filter(Boolean).join('  ');
  if (cycle === null) {
    // Over the label column: the object, its whole label, which the column may cut or leave out, and how it went.
    tip.append(div('main', objectName(type.name, r.id)));
    if (label) tip.append(div('label', label));
    tip.append(div('note', outcomeText(r, c.source.info.lastCycle)));
    place(c, tip, x, y);
    return;
  }
  const s = segmentAt(r, cycle);
  const main = document.createElement('div');
  main.className = 'main';
  if (s) {
    const key = document.createElement('span');
    key.className = 'key';
    key.style.background = getComputedStyle(document.documentElement).getPropertyValue(`--stage-${s.stage % 8}`);
    main.append(key, document.createTextNode(type.stages[s.stage] + (cycle < s.from + s.held ? ' · held' : '')));
  } else {
    main.textContent = r.end !== null && cycle >= r.end ? endText(r.endedBy!, r.normalEnd) : 'In no stage';
  }
  tip.append(main, div('sub', `cycle ${fmt(cycle)} · ${objectName(type.name, r.id)}`));
  if (label) tip.append(div('label', label));
  if (s) {
    const entered = r.events.find((e) => e.effect.kind === 'enters' && e.cycle === s.from - 1);
    if (entered) tip.append(div('note', `since ${shortName(entered.name, type.name)} at ${fmt(entered.cycle)}`));
  }
  for (const e of r.events) {
    if (e.cycle !== cycle) continue;
    const fields = e.fields
      .map((f) => fieldText(f, f.row === null ? undefined : c.row(f.row), e.cycle, f.row === null ? undefined : c.source.info.types[c.row(f.row)?.type ?? 0]?.stages))
      .join(' · ');
    tip.append(div('event', `${shortName(e.name, type.name)}: ${effectText(r, e, type.stages)}${fields ? ' · ' + fields : ''}`));
  }
  place(c, tip, x, y);
}

/** Shows the tooltip below and right of the pointer, or on whichever side keeps it inside the waterfall. */
function place(c: Controller, tip: HTMLDivElement, x: number, y: number): void {
  tip.hidden = false;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let tx = x + 16;
  let ty = y + 16;
  if (tx + tw > c.width - 8) tx = x - tw - 12;
  if (ty + th > c.height - 8) ty = y - th - 12;
  tip.style.left = `${Math.max(8, tx)}px`;
  tip.style.top = `${Math.max(8, ty)}px`;
}
