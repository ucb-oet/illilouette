// The page: a landing that opens a waterfall file, then the viewer with its keys.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { decodeWaterfall, WaterfallError } from '../file/waterfall';
import { MemorySource } from '../model/memory';
import { fmt, objectName, segmentAt } from '../model/present';
import { Controller, useController, ZOOM_STEP } from './controller';
import { DetailPanel } from './DetailPanel';
import { Header } from './Header';
import { Help } from './Help';
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
  const [dropping, setDropping] = useState(false);

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
      // While the list of keys is open, only its own keys act.
      if (c.helpOpen) {
        if (k === '?' || k === 'Escape') {
          c.toggleHelp();
          ev.preventDefault();
        }
        return;
      }
      const x = c.hover ? c.hover.x : c.gutterW + c.plotW / 2;
      const rows = Math.max(1, Math.floor((c.height - 28) / c.rowH));
      if (k === 'q' || k === 'e') c.zoomTime(x, k === 'e' ? ZOOM_STEP : 1 / ZOOM_STEP);
      else if (k === 'Q' || k === 'E') c.zoomRows(k === 'E' ? ZOOM_STEP : 1 / ZOOM_STEP, c.hover ? c.hover.y : null);
      else if (k === 'w' || k === 's') c.scrollRows((k === 's' ? 1 : -1) * Math.max(c.rowH, (rows * c.rowH) / 8));
      else if (k === 'a' || k === 'd') c.panTime(((k === 'd' ? 1 : -1) * c.visibleCycles) / 8);
      else if (k === 'f') void c.focusSelected();
      else if (k >= '1' && k <= '9') void c.toggleType(Number(k) - 1);
      else if (k === 'r') c.toggleArrows();
      else if (k === 'i') c.insertCursor();
      else if (k === 'I') void c.insertAtSelectedEdge('start');
      else if (k === 'A') void c.insertAtSelectedEdge('end');
      else if (k === 'x') c.deleteCursor();
      else if (k === '0') void c.toSelectedEdge('start');
      else if (k === '$') void c.toSelectedEdge('end');
      else if (k === 'Escape') {
        c.select(null);
        c.selectColumn(null);
      }
      // The selection moves as vim's cursor does: by rows, keeping its column, and by cycles.
      else if (k === 'ArrowDown' || k === 'j') c.moveSelection(1);
      else if (k === 'ArrowUp' || k === 'k') c.moveSelection(-1);
      else if (k === 'ArrowRight' || k === 'l') void c.moveColumn(1);
      else if (k === 'ArrowLeft' || k === 'h') void c.moveColumn(-1);
      else if (k === '/') document.getElementById('jump')?.focus();
      else if (k === '?') c.toggleHelp();
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

    // A file dropped anywhere on the page opens in place of this one, as Open… does. Entering and leaving each element
    // on the way are counted, so that the outline stays while the file is over the page.
    const hasFiles = (ev: DragEvent) => Array.from(ev.dataTransfer?.types ?? []).includes('Files');
    let over = 0;
    const onDragEnter = (ev: DragEvent) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      over++;
      setDropping(true);
    };
    const onDragOver = (ev: DragEvent) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      ev.dataTransfer!.dropEffect = 'copy';
    };
    const onDragLeave = (ev: DragEvent) => {
      if (!hasFiles(ev)) return;
      over = Math.max(0, over - 1);
      if (!over) setDropping(false);
    };
    const onDrop = (ev: DragEvent) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      over = 0;
      setDropping(false);
      const f = ev.dataTransfer?.files[0];
      if (f) onOpen(f).catch((err: Error) => c.say(err.message));
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
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
      <Help c={c} />
      <div class="dropping" hidden={!dropping}>
        <p>Drop to open in place of {source.info.title}</p>
      </div>
    </div>
  );
}

function Status({ c }: { c: Controller }) {
  useController(c);
  const h = c.hover;
  const r = h?.row == null ? undefined : c.row(h.row);
  const t = r && c.source.info.types[r.type];
  let readout = '';
  if (h?.cycle != null) {
    readout = `cycle ${fmt(h.cycle)}`;
    if (r && t) {
      const s = segmentAt(r, h.cycle);
      readout += ` · ${objectName(t.name, r.id)}${s ? ` · ${t.stages[s.stage]}${h.cycle < s.from + s.held ? ' · held' : ''}` : ''}`;
    }
  } else if (r && t) {
    // Over the label column.
    readout = objectName(t.name, r.id);
  }
  const zoom = `${c.cellW >= 10 ? c.cellW.toFixed(0) : c.cellW.toFixed(2)} px/cycle · ${c.rowH.toFixed(0)} px rows · ${DETAIL_NAMES[detailOf(c)]}`;
  return (
    <footer class="status">
      <span class="readout">{c.notice ? <span class="notice">{c.notice}</span> : readout}</span>
      <span>
        {zoom} · <kbd>?</kbd> keys
      </span>
    </footer>
  );
}
