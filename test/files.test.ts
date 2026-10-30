// Smoke tests over every .waterfall under test/fixtures, a link to Chipyard's sims/verilator/output.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeWaterfall, type Waterfall } from '../src/file/waterfall';
import { MemorySource } from '../src/model/memory';
import { parseQuery } from '../src/model/search';
import { Controller, ZOOM_STEP } from '../src/ui/controller';
import { drawWaterfall } from '../src/ui/render';
import type { Theme } from '../src/ui/theme';

const root = fileURLToPath(new URL('./fixtures', import.meta.url));

function waterfalls(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...waterfalls(path));
    else if (name.endsWith('.waterfall')) out.push(path);
  }
  return out.sort();
}

const files = existsSync(root) ? waterfalls(root) : [];

/** A canvas context that draws nothing, but measures text as a monospace font would, for the drawing code to run. */
function canvas(): CanvasRenderingContext2D {
  const own: Record<string | symbol, unknown> = {
    measureText: (text: string) => ({ width: text.length * 7 }),
    createPattern: () => ({}),
  };
  return new Proxy(own, {
    get: (target, key) => (key in target ? target[key] : () => undefined),
    set: (target, key, value) => ((target[key] = value), true),
  }) as unknown as CanvasRenderingContext2D;
}

const theme: Theme = {
  dark: false,
  ...Object.fromEntries(
    ['base', 'mantle', 'surface0', 'surface1', 'surface2', 'overlay0', 'overlay1', 'subtext0', 'subtext1', 'text', 'killed', 'blocked', 'event', 'accent'].map((k) => [k, '#4c4f69']),
  ),
  stages: Array.from({ length: 8 }, () => '#209fb5'),
  cursors: Array.from({ length: 6 }, () => '#04a5e5'),
  cursorFills: Array.from({ length: 6 }, () => '#bddded'),
  cursorInks: Array.from({ length: 6 }, () => '#00629e'),
  wash: 0.3,
  hatch: Array.from({ length: 8 }, () => ({}) as CanvasPattern),
} as Theme;

describe('Chipyard\'s waterfall files', () => {
  it('are linked at test/fixtures', () => {
    expect(files.length, 'Link test/fixtures to Chipyard\'s sims/verilator/output: ln -s <chipyard>/sims/verilator/output test/fixtures').toBeGreaterThan(0);
  });
});

for (const file of files) {
  describe(relative(root, file), () => {
    // Read as the file's tests start and dropped as they end, so that only one file is in memory at a time.
    let w: Waterfall;
    let source: MemorySource;
    beforeAll(() => {
      w = decodeWaterfall(new Uint8Array(readFileSync(file)));
      source = new MemorySource(w);
    }, 120_000);
    afterAll(() => {
      w = undefined!;
      source = undefined!;
    });

    it('holds together as the viewer reads it', () => {
      // Problems are gathered rather than asserted one by one, for speed on files of half a million rows.
      const problems: string[] = [];
      const check = (ok: boolean, what: () => string) => {
        if (!ok && problems.length < 10) problems.push(what());
      };
      const types = w.types.length;
      check(types > 0, () => 'no object types');
      w.rows.forEach((r, i) => {
        check(r.type < types, () => `row ${i}: type ${r.type} of ${types}`);
        check(r.parent === null || r.parent < i, () => `row ${i}: parent ${r.parent} not before it`);
        const stages = w.types[r.type]?.stages.length ?? 0;
        r.segments.forEach((g, k) => {
          check(g.stage < stages, () => `row ${i}: stage ${g.stage} of ${stages}`);
          check(k === 0 || g.from > r.segments[k - 1].from, () => `row ${i}: segment ${k} not after the one before`);
        });
        check(r.end === null || !r.segments.length || r.end > r.segments[r.segments.length - 1].from, () => `row ${i}: ends at ${r.end}, before its last stage`);
        r.events.forEach((e, k) => {
          check(k === 0 || e.cycle >= r.events[k - 1].cycle, () => `row ${i}: event ${k} before the one before`);
          check(e.site < w.sites.length, () => `row ${i}: event ${k} at site ${e.site} of ${w.sites.length}`);
          for (const f of e.fields) check(f.row === null || f.row < w.rows.length, () => `row ${i}: field names row ${f.row}`);
        });
      });
      check(source.info.summary.reduce((n, t) => n + t.rows, 0) === w.rows.length, () => 'the summary does not count every row');
      for (const t of source.info.summary) check(t.ends.reduce((n, e) => n + e.rows, 0) + t.live === t.rows, () => `${t.name}: ends and live do not add up`);
      expect(problems).toEqual([]);
    }, 120_000);

    it('runs every feature, drawing included, without breaking', async () => {
      const c = new Controller(source);
      c.setSize(1400, 800);
      await c.home();
      const ctx = canvas();
      const draw = () => drawWaterfall(ctx, c, theme, 1);
      const shown = () => expect(c.hiddenCount).toBe(source.info.rowCount - c.shownCount);
      draw();

      for (let t = 0; t < source.info.types.length; t++) {
        c.cycleFocus(1);
        await c.toggleType(t);
        shown();
        draw();
        await c.toggleType(t);
      }
      await c.toggleAborted();
      shown();
      draw();
      await c.toggleAborted();
      expect(c.hiddenCount).toBe(0);

      await c.selectEdgeRow('last');
      await c.selectEdgeRow('first');
      c.moveSelection(5);
      await c.moveParagraph(1, 3);
      await c.moveParagraph(-1);
      const busy = await c.rowAsync(c.rowAtPlace(Math.floor(c.shownCount / 2)));
      c.selectColumn(busy.start);
      c.select(null);
      await c.moveInColumn(1);
      expect(c.selected).not.toBeNull();
      await c.moveInColumn(1);
      await c.moveInColumn(-1);
      await c.moveEvent(1, 2);
      await c.moveEvent(-1);
      await c.toSelectedEdge('end');
      await c.insertAtSelectedEdge('start');
      c.nameCursor(c.naming!, 'start');
      await c.insertAtSelectedEdge('end');
      // In a second group, with lanes for both in the cursor strip.
      c.setCursorGroup(c.naming!, 1);
      c.deleteCursor();
      c.scrollSelectedTo('middle');
      c.selectScreenRow('bottom');
      c.toggleLinks();
      c.toggleLinkKind('other');
      draw();
      c.toggleLinkKind('other');
      c.toggleLinks();

      const words = await source.words();
      const labelled = (await source.rows(0, Math.min(source.info.rowCount, 2000))).find((r) => r.label.some(Boolean));
      const queries = [
        labelled && labelled.label.filter(Boolean).at(-1)!,
        ...words.flatMap((t) => {
          const field = t.fields.find((f) => f.values?.length);
          const event = t.events[0];
          return [field && `${t.name}.${field.name}=${field.values![0]}`, event && `${t.name}.${event.name}`];
        }),
      ].filter((q): q is string => Boolean(q));
      for (const q of queries) {
        expect(parseQuery(q, words)).not.toHaveProperty('error');
        await c.setSearch(q);
        expect(c.search!.matches.length, q).toBeGreaterThan(0);
        for (const m of c.search!.matches.slice(0, 100)) expect(c.placeOf(m.row)).toBeGreaterThanOrEqual(0);
        await c.nextMatch(1);
        await c.nextMatch(1);
        await c.nextMatch(-1);
        draw();
      }

      for (let k = 0; k < 30; k++) {
        c.zoomTime(c.gutterW + c.plotW / 2, 1 / ZOOM_STEP, true);
        if (k % 3 === 0) c.zoomRows(1 / ZOOM_STEP, null, true);
        draw();
      }
      await c.moveToCycle((source.info.firstCycle + source.info.lastCycle) / 2);
      await c.jumpToCycle(source.info.lastCycle);
      draw();
      const last = await c.rowAsync(source.info.rowCount - 1);
      expect(await c.jumpToObject(last.id, source.info.types[last.type].name)).toBe(true);
      draw();
    }, 120_000);
  });
}
