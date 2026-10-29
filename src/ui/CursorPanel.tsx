// The cursor panel, opened with c or the header's Cursors button: each group's cursors, in order, with the distance
// from the one before in the group. A click on a name renames it, on a color moves the cursor to another group, on ×
// removes it, and on a cursor's cycle pans to it. Like the view panel, it does not block the waterfall.
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fmt } from '../model/present';
import { Controller, CURSOR_GROUPS, useController } from './controller';

export function CursorPanel({ c, anchor }: { c: Controller; anchor: RefObject<HTMLElement> }) {
  useController(c);
  const panel = useRef<HTMLDivElement>(null);
  // The edge of the cursor whose name is being edited, or whose colors are offered.
  const [renaming, setRenaming] = useState<number | null>(null);
  const [regrouping, setRegrouping] = useState<number | null>(null);
  // A click outside the panel and its button closes it.
  useEffect(() => {
    if (!c.cursorsOpen) return;
    const onDown = (ev: PointerEvent) => {
      const target = ev.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) c.toggleCursors();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [c, c.cursorsOpen]);
  if (!c.cursorsOpen) return null;

  return (
    <div class="view-panel cursor-panel" ref={panel} role="dialog" aria-label="Cursors">
      <h3>
        Cursors <kbd>c</kbd>
      </h3>
      {c.cursors.length === 0 && (
        <p class="empty">
          None yet. Select a cycle, then press <kbd>i</kbd>; <kbd>I</kbd> and <kbd>A</kbd> put one at the selected object's
          start or end.
        </p>
      )}
      {c.cursorLanes.map((g) => {
        const lane = c.cursors.filter((k) => k.group === g);
        return (
          <section key={g} class="lane">
            {lane.map((k, i) => (
              <div class="cursor" key={k.edge}>
                <button
                  type="button"
                  class="swatch"
                  style={{ background: `var(--cursor-${g})` }}
                  title="Move to another group"
                  aria-label={`Group ${g + 1}; move to another`}
                  aria-expanded={regrouping === k.edge}
                  onClick={() => setRegrouping(regrouping === k.edge ? null : k.edge)}
                />
                {regrouping === k.edge ? (
                  <span class="swatches" role="radiogroup" aria-label="Group">
                    {Array.from({ length: CURSOR_GROUPS }, (_, h) => (
                      <button
                        key={h}
                        type="button"
                        role="radio"
                        aria-checked={h === g}
                        aria-label={`Group ${h + 1}`}
                        style={{ background: `var(--cursor-${h})` }}
                        onClick={() => {
                          c.setCursorGroup(k.edge, h);
                          setRegrouping(null);
                        }}
                      />
                    ))}
                  </span>
                ) : renaming === k.edge ? (
                  <input
                    class="name"
                    defaultValue={k.name || fmt(k.edge)}
                    aria-label="Cursor name"
                    spellcheck={false}
                    autocomplete="off"
                    ref={(el) => el?.focus()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
                    }}
                    onBlur={(e) => {
                      c.nameCursor(k.edge, (e.target as HTMLInputElement).value);
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <button type="button" class="name" title="Rename" onClick={() => setRenaming(k.edge)}>
                    {k.name || <span class="unnamed">unnamed</span>}
                  </button>
                )}
                <button type="button" class="cycle" title="Pan to it" onClick={() => c.panToCursor(k.edge)}>
                  {fmt(k.edge)}
                </button>
                <span class="delta">{i > 0 ? `Δ ${fmt(k.edge - lane[i - 1].edge)}` : ''}</span>
                <button type="button" class="remove" title="Remove" aria-label="Remove" onClick={() => c.removeCursor(k.edge)}>
                  ×
                </button>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
