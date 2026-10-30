// The view panel, opened with o or the header's View button: settings changed now and then, beside the state of those
// with keys. It does not block the waterfall, which changes behind it as settings do.
import type { RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { fmt } from '../model/present';
import { LINK_KINDS, type LinkKind } from '../model/source';
import { Controller, useController } from './controller';

/** Each kind of link, as the panel lists it beside its color. */
const LINK_NAMES: Record<LinkKind, string> = {
  aborted: 'Aborted by',
  blocked: 'Blocked by',
  other: 'Parents and others',
};

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

  const { types, summary, links } = c.source.info;
  const aborted = summary.reduce((n, t) => n + t.ends.reduce((m, e) => m + (e.normal ? 0 : e.rows), 0), 0);
  return (
    <div class="view-panel" ref={panel} role="dialog" aria-label="View">
      <section>
        <h3 class="cols">
          Types
          <span class="col">
            Focus <kbd>t</kbd>
          </span>
        </h3>
        {types.map((t, i) => (
          <div class="opt" key={t.name}>
            <label>
              <input type="checkbox" checked={!c.hiddenTypes.has(i)} onChange={() => void c.toggleType(i)} />
              {t.name}
              <kbd>z{i + 1}</kbd>
            </label>
            <label class="focus" title="The type drawn in full; t moves the focus">
              <input
                type="radio"
                name="view-focus"
                aria-label={`Focus ${t.name}`}
                checked={c.focusType === i}
                disabled={c.hiddenTypes.has(i)}
                onChange={() => c.setFocus(i)}
              />
            </label>
          </div>
        ))}
      </section>
      <section>
        <h3>Objects</h3>
        <div class="opt">
          <label>
            <input type="checkbox" checked={!c.hideAborted} onChange={() => void c.toggleAborted()} />
            <span class="cap" />
            Aborted
          </label>
          <span class="n">{fmt(aborted)}</span>
        </div>
      </section>
      <section>
        <h3>Links</h3>
        {LINK_KINDS.map((k) => (
          <div class="opt" key={k}>
            <label>
              <input type="checkbox" checked={c.linkKinds.has(k)} onChange={() => c.toggleLinkKind(k)} />
              <span class={`line ${k}`} />
              {LINK_NAMES[k]}
            </label>
            <span class="n">{fmt(links[k])}</span>
          </div>
        ))}
        <div class="opt">
          <label>
            <input type="checkbox" checked={c.allLinks} onChange={() => c.toggleLinks()} />
            For everything on screen
          </label>
          <kbd>r</kbd>
        </div>
      </section>
    </div>
  );
}
