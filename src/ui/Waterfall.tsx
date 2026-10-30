// The waterfall canvas: sizing, pointer and wheel input, the label column's splitter, and the hover tooltip.
import { useEffect, useRef } from 'preact/hooks';
import { effectText, endText, fieldText, fmt, objectName, outcomeText, segmentAt, shortName } from '../model/present';
import { Controller, CURSOR_GROUPS, RULER, useController } from './controller';
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

    let drag: { x: number; y: number; x0: number; y0: number; moved: boolean } | null = null;
    const local = (ev: MouseEvent) => {
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
        // The label column has no cycle, so a click there keeps the selected one; on the strip only the cycle changes.
        const { x, y } = local(ev);
        const cycle = c.cycleAtX(x);
        if (y >= c.plotBottom) {
          if (cycle !== null) c.selectColumn(cycle);
        } else {
          const row = c.rowAtY(y);
          const r = row === null ? undefined : c.row(row);
          c.select(r && !c.hiddenTypes.has(r.type) ? row : null);
          if (y > RULER && cycle !== null) c.selectColumn(cycle);
        }
      }
      drag = null;
    };
    // Like f, but the rows stay, so the row stays under the pointer.
    const onDouble = (ev: MouseEvent) => {
      const { x, y } = local(ev);
      if (x < c.gutterW && y < c.plotBottom && c.selected !== null && c.rowAtY(y) === c.selected) void c.focusSelected(false);
    };
    const onLeave = () => {
      c.hover = null;
      tip.current!.hidden = true;
      c.changed();
    };
    // A pinch arrives as a wheel event with ctrlKey set.
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
    el.addEventListener('dblclick', onDouble);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });

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
      el.removeEventListener('dblclick', onDouble);
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

/** A new cursor's name box, on its lane, with the groups' swatches. */
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
  const cursor = edge === null ? undefined : c.cursors.find((k) => k.edge === edge);
  if (edge === null || !cursor) return null;
  const keep = () => {
    if (done.current) return;
    done.current = true;
    c.nameCursor(edge, box.current?.value ?? '');
  };
  const choose = (g: number) => c.setCursorGroup(edge, (g + CURSOR_GROUPS) % CURSOR_GROUPS);
  // Mirrors .cursor-name's CSS widths.
  const width = 140 + 8 + CURSOR_GROUPS * 16 + 8;
  return (
    <div
      class="cursor-name"
      style={{
        left: `${Math.max(c.gutterW, Math.min(c.xOf(edge), c.width - width))}px`,
        top: `${c.laneY(cursor.group) - 9}px`,
        '--group': `var(--cursor-${cursor.group})`,
        '--fill': `var(--cursor-fill-${cursor.group})`,
        '--ink': `var(--cursor-ink-${cursor.group})`,
      }}
    >
      <input
        ref={box}
        defaultValue={fmt(edge)}
        aria-label="Cursor name"
        spellcheck={false}
        autocomplete="off"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            keep();
          } else if (e.key === 'Tab') {
            e.preventDefault();
            choose(cursor.group + (e.shiftKey ? -1 : 1));
          }
        }}
        onBlur={keep}
      />
      <span class="swatches" role="radiogroup" aria-label="Cursor group">
        {Array.from({ length: CURSOR_GROUPS }, (_, g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={g === cursor.group}
            aria-label={`Group ${g + 1}`}
            style={{ background: `var(--cursor-${g})` }}
            // Kept from taking the focus, so that the name stays open for typing.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(g)}
          />
        ))}
      </span>
    </div>
  );
}

/** Fills and places the tooltip for the hovered cell, or, over the label column, for the hovered row. Texts go in
 *  through textContent: they come from the file. */
function showTip(c: Controller, tip: HTMLDivElement, rowIndex: number | null, cycle: number | null, x: number, y: number): void {
  const r = rowIndex === null ? undefined : c.row(rowIndex);
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
    // Over the label column: the whole label, which the column may cut or leave out.
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
    const line = div('event', `${shortName(e.name, type.name)}: ${effectText(r, e, type.stages)}`);
    for (const f of e.fields) {
      const other = f.row === null ? undefined : c.row(f.row);
      line.append(' · ', div('pair', fieldText(f, other, e.cycle, other && c.source.info.types[other.type].stages)));
    }
    tip.append(line);
  }
  place(c, tip, x, y);
}

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
