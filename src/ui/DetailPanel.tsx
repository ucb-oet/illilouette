// The detail panel: the selected object, or with nothing selected, a summary of the file.
import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { effectText, fieldText, fmt, objectName, outcomeText, shortName, timeByStage } from '../model/present';
import type { Referrer, RowView } from '../model/source';
import { Controller, useController } from './controller';

interface Selected {
  row: RowView;
  /** Rows its fields name, by row index. */
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
        <button type="button" class="plain" onClick={() => setCollapsed(false)} aria-label="Show the detail panel">
          ‹
        </button>
      </aside>
    );
  }
  return (
    <aside class="panel" aria-live="polite">
      <div class="panel-head">
        <p class="eyebrow">{selected ? 'Selected' : 'This file'}</p>
        <button type="button" class="plain" onClick={() => setCollapsed(true)} aria-label="Hide the detail panel">
          ›
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
          {/* The legend of the type's stages, which share their colors with every other type's. */}
          <div class="stages legend">
            {c.source.info.types[ti].stages.map((s, k) => (
              <span key={s}>
                <i style={{ background: `var(--stage-${k % 8})` }} />
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
                  {!e.normal && <span class="cap" />}Ended by {e.name}
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

function Selection({ c, s }: { c: Controller; s: Selected }) {
  const { row, others, referrers } = s;
  const type = c.source.info.types[row.type];
  const stagesOf = (r: RowView) => c.source.info.types[r.type].stages;
  const label = row.label.filter(Boolean);
  const go = (i: number) => {
    c.select(i);
    void c.focusSelected();
  };
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);

  const links: { label: string; row: RowView }[] = [];
  for (const e of row.events) {
    for (const f of e.fields) {
      const other = f.row === null ? undefined : others.get(f.row);
      if (other) links.push({ label: `${shortName(e.name, type.name)} ${f.name}`, row: other });
    }
  }
  for (const x of referrers) {
    const other = others.get(x.row);
    if (other) links.push({ label: `${x.field} of ${shortName(x.event, c.source.info.types[other.type].name)}`, row: other });
  }

  return (
    <>
      <div>
        <h2>{label.length ? label[label.length - 1] : objectName(type.name, row.id)}</h2>
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
                <i style={{ background: `var(--stage-${t.stage % 8})` }} />
                {type.stages[t.stage]} {fmt(t.cycles)}
                {t.held ? ` (${fmt(t.held)} held)` : ''}
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
                <span>{l.row.label.filter(Boolean).slice(-1)[0] ?? ''}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3>Events, at the cycle each fires</h3>
        <ol class="events">
          {row.events.map((e, k) => {
            const fields = e.fields
              .map((f) => {
                const other = f.row === null ? undefined : others.get(f.row);
                return fieldText(f, other, e.cycle, other ? stagesOf(other) : undefined);
              })
              .join(' · ');
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
                  {fields && <span class="fields">{fields}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
