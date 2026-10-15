// The page: a landing that opens a waterfall file, then the viewer with its keys.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { decodeWaterfall, WaterfallError } from '../file/waterfall';
import { MemorySource } from '../model/memory';
import { fmt, objectName, segmentAt } from '../model/present';
import { Controller, useController, ZOOM_STEP } from './controller';
import { DetailPanel } from './DetailPanel';
import { Header } from './Header';
import { DETAIL_NAMES, detailOf } from './render';
import { applyThemeChoice, loadThemeChoice } from './theme';
import { TimelineBar } from './TimelineBar';
import { Waterfall } from './Waterfall';

applyThemeChoice(loadThemeChoice());

/** Reads a waterfall file; on failure, throws an error whose message names the file and the problem. */
async function read(file: File): Promise<MemorySource> {
  try {
    return new MemorySource(decodeWaterfall(new Uint8Array(await file.arrayBuffer())));
  } catch (e) {
    throw new Error(e instanceof WaterfallError ? `${file.name}: ${e.message}` : `${file.name} could not be read: ${String(e)}`);
  }
}

export function App() {
  const [source, setSource] = useState<MemorySource | null>(null);
  const open = async (file: File) => setSource(await read(file));
  return source ? <Viewer key={source.info.title + source.info.rowCount} source={source} onOpen={open} /> : <Landing onOpen={open} />;
}

/** Opening the first file. Its errors show here; the viewer's show in its status bar. */
function Landing({ onOpen }: { onOpen: (f: File) => Promise<void> }) {
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      await onOpen(file);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <main class="landing">
      <div
        class={over ? 'drop over' : 'drop'}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer?.files[0];
          if (f) void open(f);
        }}
      >
        <h1>illilouette</h1>
        <p>
          A pipeline waterfall for EventTrace. Drop a waterfall file here, or choose one. Chipyard's{' '}
          <code>eventtrace waterfall</code> writes it from a trace, its manifest, and the design's view.
        </p>
        <label class="plain">
          {busy ? 'Opening…' : 'Choose a file'}
          <input
            type="file"
            accept=".pb,.waterfall"
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              const f = input.files?.[0];
              // Cleared, so that choosing the same file again, after fixing it, opens it again.
              input.value = '';
              if (f) void open(f);
            }}
          />
        </label>
        {error && <p class="error">{error}</p>}
        {/* TODO: connect to a local server for files too large to load in the browser. */}
      </div>
    </main>
  );
}

function Viewer({ source, onOpen }: { source: MemorySource; onOpen: (f: File) => Promise<void> }) {
  const c = useMemo(() => new Controller(source), [source]);

  useEffect(() => {
    // Open at the file's start, once the canvas has its size.
    void c.home();
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest('input, textarea')) {
        if (ev.key === 'Escape') target.blur();
        return;
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const k = ev.key;
      const x = c.hover ? c.hover.x : c.gutterW + c.plotW / 2;
      const rows = Math.max(1, Math.floor((c.height - 28) / c.rowH));
      if (k === 'q' || k === 'e') c.zoomTime(x, k === 'e' ? ZOOM_STEP : 1 / ZOOM_STEP);
      else if (k === 'Q' || k === 'E') c.zoomRows(k === 'E' ? ZOOM_STEP : 1 / ZOOM_STEP, c.hover ? c.hover.y : null);
      else if (k === 'w' || k === 's') c.scrollRows((k === 's' ? 1 : -1) * Math.max(c.rowH, (rows * c.rowH) / 8));
      else if (k === 'a' || k === 'd') c.panTime(((k === 'd' ? 1 : -1) * c.visibleCycles) / 8);
      else if (k === 'f') void c.focusSelected();
      else if (k >= '1' && k <= '9') void c.toggleType(Number(k) - 1);
      else if (k === 'r') c.toggleArrows();
      else if (k === '0') void c.toSelectedEdge('start');
      else if (k === '$') void c.toSelectedEdge('end');
      else if (k === 'Escape') c.select(null);
      else if (k === 'ArrowDown' || k === 'ArrowUp') c.moveSelection(k === 'ArrowDown' ? 1 : -1);
      else if (k === '/') document.getElementById('jump')?.focus();
      else return;
      ev.preventDefault();
    };
    // A notice stays until the next key, click, or wheel, which clears it before acting.
    const clearNotice = () => {
      if (c.notice) c.say('');
    };
    window.addEventListener('keydown', clearNotice, true);
    window.addEventListener('pointerdown', clearNotice, true);
    window.addEventListener('wheel', clearNotice, { capture: true, passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', clearNotice, true);
      window.removeEventListener('pointerdown', clearNotice, true);
      window.removeEventListener('wheel', clearNotice, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [c]);

  return (
    <div class="app">
      <Header c={c} onOpen={onOpen} />
      <TimelineBar c={c} />
      <div class="workspace">
        <Waterfall c={c} />
        <DetailPanel c={c} />
      </div>
      <Status c={c} />
    </div>
  );
}

function Status({ c }: { c: Controller }) {
  useController(c);
  const h = c.hover;
  let readout = '';
  if (h?.cycle != null) {
    readout = `cycle ${fmt(h.cycle)}`;
    const r = h.row === null ? undefined : c.row(h.row);
    if (r) {
      const t = c.source.info.types[r.type];
      const s = segmentAt(r, h.cycle);
      readout += ` · ${objectName(t.name, r.id)}${s ? ` · ${t.stages[s.stage]}${h.cycle < s.from + s.held ? ' · held' : ''}` : ''}`;
    }
  }
  const zoom = `${c.cellW >= 10 ? c.cellW.toFixed(0) : c.cellW.toFixed(2)} px/cycle · ${c.rowH.toFixed(0)} px rows · ${DETAIL_NAMES[detailOf(c)]}`;
  return (
    <footer class="status">
      <span class="readout">{c.notice ? <span class="notice">{c.notice}</span> : readout}</span>
      <span>
        {zoom} · <kbd>W</kbd>
        <kbd>A</kbd>
        <kbd>S</kbd>
        <kbd>D</kbd> move · <kbd>Q</kbd>
        <kbd>E</kbd> zoom time · <kbd>Shift</kbd>+<kbd>Q</kbd>
        <kbd>E</kbd> zoom rows · <kbd>F</kbd> focus
      </span>
    </footer>
  );
}
