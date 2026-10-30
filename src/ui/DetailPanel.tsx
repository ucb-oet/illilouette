import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { effectText, endText, fieldValue, fmt, objectName, outcomeText, shortName, timeByStage } from '../model/present';
import type { Role } from '../file/waterfall';
import type { Referrer, RowView } from '../model/source';
import { Controller, useController } from './controller';
import { stageColor } from './theme';

interface Selected {
  row: RowView;
  /** Rows linked to or from it, by index. */
  others: Map<number, RowView>;
  referrers: Referrer[];
}

export function DetailPanel({ c }: { c: Controller }) {
  useController(c);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let current = true;
    if (c.selected === null) {
      setSelected(null);
      return;
    }
    const i = c.selected;
    void (async () => {
      const row = await c.rowAsync(i);
      const referrers = await c.source.referrers(i);
      const wanted = new Set<number>(referrers.map((x) => x.row));
      for (const e of row.events) for (const f of e.fields) if (f.row !== null) wanted.add(f.row);
      const others = new Map<number, RowView>();
      for (const k of wanted) others.set(k, await c.rowAsync(k));
      if (current) setSelected({ row, others, referrers });
    })();
    return () => {
      current = false;
    };
  }, [c, c.selected]);

  if (collapsed) {
    return (
      <aside class="panel collapsed">
        <button type="button" class="plain icon" onClick={() => setCollapsed(false)} title="Show the detail panel" aria-label="Show the detail panel">
          <Chevron left />
        </button>
      </aside>
    );
  }
  return (
    <aside class="panel" aria-live="polite">
      <div class="panel-head">
        <p class="eyebrow">{selected ? 'Selected' : 'This file'}</p>
        <button type="button" class="fold" onClick={() => setCollapsed(true)} title="Hide the detail panel" aria-label="Hide the detail panel">
          <Chevron />
        </button>
      </div>
      {selected ? <Selection c={c} s={selected} /> : <Summary c={c} />}
    </aside>
  );
}

function Summary({ c }: { c: Controller }) {
  const { summary } = c.source.info;
  return (
    <>
      {summary.map((t, ti) => (
        <section key={t.name}>
          <h3>{t.name}</h3>
          <div class="stages legend">
            {c.source.info.types[ti].stages.map((s, k) => (
              <span key={s}>
                <i style={{ background: stageColor(k) }} />
                {s}
              </span>
            ))}
          </div>
          <dl class="summary">
            <dt>Objects</dt>
            <dd>{fmt(t.rows)}</dd>
            {t.ends.map((e) => (
              <Fragment key={e.name}>
                <dt>
                  {!e.normal && <span class="cap" />}
                  {endText(e.name, e.normal)}
                </dt>
                <dd>{fmt(e.rows)}</dd>
              </Fragment>
            ))}
            {t.live > 0 && (
              <>
                <dt>Live when the trace ends</dt>
                <dd>{fmt(t.live)}</dd>
              </>
            )}
          </dl>
        </section>
      ))}
      <p class="empty">Click an object to see its events and what it waited on.</p>
    </>
  );
}

/** What an object a selected row names is to it, by the field's role. */
const LINKED: Partial<Record<Role, string>> = { parent: 'parent', abortedBy: 'aborted by', blockedBy: 'blocked by' };
/** What the selected row is to an object that names it. */
const LINKING: Partial<Record<Role, string>> = { parent: 'parent of', abortedBy: 'aborted', blockedBy: 'blocks' };

function Selection({ c, s }: { c: Controller; s: Selected }) {
  const { row, others, referrers } = s;
  const type = c.source.info.types[row.type];
  const label = row.label.filter(Boolean);
  const go = (i: number) => {
    c.select(i);
    void c.focusSelected();
  };
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);

  // Each link, named by role, or else by event and field.
  const links: { label: string; row: RowView }[] = [];
  for (const e of row.events) {
    for (const f of e.fields) {
      const other = f.row === null ? undefined : others.get(f.row);
      if (other) links.push({ label: LINKED[f.role] ?? `${shortName(e.name, type.name)} ${f.name}`, row: other });
    }
  }
  for (const x of referrers) {
    const other = others.get(x.row);
    if (other) links.push({ label: LINKING[x.role] ?? `${x.field} of ${shortName(x.event, c.source.info.types[other.type].name)}`, row: other });
  }

  return (
    <>
      <div>
        <h2>{label.at(-1) ?? objectName(type.name, row.id)}</h2>
        <p class="sub">
          {objectName(type.name, row.id)}
          {label.length > 1 ? ` · ${label.slice(0, -1).join(' · ')}` : ''}
        </p>
      </div>
      <div class="outcome">
        {row.end !== null && !row.normalEnd && <span class="cap" />}
        <span>{outcomeText(row, c.source.info.lastCycle)}</span>
      </div>
      {row.segments.length > 0 && (
        <section>
          <h3>Time by stage</h3>
          <div class="stages">
            {timeByStage(row).map((t) => (
              <span key={t.stage}>
                <i style={{ background: stageColor(t.stage) }} />
                {type.stages[t.stage]}
                <span class="n">
                  {fmt(t.cycles)}
                  {t.held ? ` (${fmt(t.held)} held)` : ''}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}
      {row.fields.length > 0 && (
        <section>
          <h3>Fields</h3>
          <dl class="kv">
            {row.fields.map((f) => (
              <Fragment key={f.name}>
                <dt>{f.name}</dt>
                <dd>{f.text}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      )}
      {links.length > 0 && (
        <section>
          <h3>Related</h3>
          <div class="links">
            {links.map((l) => (
              <button type="button" key={`${l.label}${l.row.index}`} onClick={() => go(l.row.index)}>
                {l.label} {objectName(c.source.info.types[l.row.type].name, l.row.id)}
                <span>{l.row.label.filter(Boolean).at(-1) ?? ''}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3>Events, at the cycle each fires</h3>
        <ol class="events">
          {row.events.map((e, k) => {
            const fields = e.fields.map((f) => {
              const other = f.row === null ? undefined : others.get(f.row);
              return { name: f.name, value: fieldValue(f, other, e.cycle, other && c.source.info.types[other.type].stages) };
            });
            return (
              <li key={k}>
                <span class="cyc">{fmt(e.cycle)}</span>
                <div class="body">
                  <span class="name">
                    <span>{shortName(e.name, type.name)}</span>
                    <button type="button" class="src" title={`${e.instance}\nClick to copy ${e.source}`} onClick={() => copy(e.source)}>
                      {e.source.split('/').pop()}
                    </button>
                  </span>
                  <span class="effect">{effectText(row, e, type.stages)}</span>
                  {fields.length > 0 && (
                    <dl class="fields">
                      {fields.map((f, j) => (
                        <Fragment key={j}>
                          <dt>{f.name}</dt>
                          <dd>{f.value}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

/** A chevron toward where the panel goes: right to hide it, left to show it. */
function Chevron({ left }: { left?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={left ? 'M10 4 6 8l4 4' : 'M6 4l4 4-4 4'} />
    </svg>
  );
}
