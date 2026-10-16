// The view panel, opened with o or the header's View button: settings changed now and then, beside the state of those
// with keys. It does not block the waterfall, which changes behind it as settings do.
import type { RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { fmt } from '../model/present';
import { Controller, useController } from './controller';

export function ViewPanel({ c, anchor }: { c: Controller; anchor: RefObject<HTMLElement> }) {
  useController(c);
  const panel = useRef<HTMLDivElement>(null);
  // A click outside the panel and its button closes it.
  useEffect(() => {
    if (!c.viewOpen) return;
    const onDown = (ev: PointerEvent) => {
      const target = ev.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) c.toggleView();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [c, c.viewOpen]);
  if (!c.viewOpen) return null;

  const { types, summary } = c.source.info;
  const abnormal = summary.reduce((n, t) => n + t.ends.reduce((m, e) => m + (e.normal ? 0 : e.rows), 0), 0);
  return (
    <div class="view-panel" ref={panel} role="dialog" aria-label="View">
      <section>
        <h3>
          Types <span>shown, and in focus</span> <kbd>t</kbd>
        </h3>
        {types.map((t, i) => (
          <div class="opt" key={t.name}>
            <label>
              <input type="checkbox" checked={!c.hiddenTypes.has(i)} onChange={() => void c.toggleType(i)} />
              {t.name}
              <kbd>{i + 1}</kbd>
            </label>
            <label class="focus" title="The type drawn in full; t moves the focus">
              <input type="radio" name="view-focus" checked={c.focusType === i} disabled={c.hiddenTypes.has(i)} onChange={() => c.setFocus(i)} />
              focus
            </label>
          </div>
        ))}
      </section>
      <section>
        <h3>Objects</h3>
        <div class="opt">
          <label>
            <input type="checkbox" checked={!c.hideAbnormal} onChange={() => void c.toggleAbnormal()} />
            <span class="cap" />
            Ended abnormally
          </label>
          <span class="n">{fmt(abnormal)}</span>
        </div>
      </section>
      <section>
        <h3>Arrows</h3>
        <div class="opt">
          <label>
            <input type="checkbox" checked={c.allArrows} onChange={() => c.toggleArrows()} />
            For everything on screen
          </label>
          <kbd>r</kbd>
        </div>
      </section>
    </div>
  );
}
