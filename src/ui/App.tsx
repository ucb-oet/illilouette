// The page: a landing that opens a waterfall file, then the viewer with its keys.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { decodeWaterfall, WaterfallError } from '../file/waterfall';
import { MemorySource } from '../model/memory';
import { fmt, objectName, segmentAt } from '../model/present';
import { Controller, useController, ZOOM_STEP } from './controller';
import { DetailPanel } from './DetailPanel';
import { Header } from './Header';
import { readKey } from './keys';
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
      // Keys go to boxes text is typed in; a checkbox in the view panel lets them through.
      if (target?.closest('input[type="text"], input:not([type]), textarea')) {
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
      // Keys are read as vim reads them: a count before a command, such as 20j, and commands of two keys, such as gg.
      const { pending, command } = readKey(c.keysPending, k);
      if (pending !== c.keysPending) {
        c.keysPending = pending;
        c.changed();
      }
      if (!command) {
        if (pending || k === 'Escape') ev.preventDefault();
        return;
      }
      const n = command.count;
      const x = c.hover ? c.hover.x : c.gutterW + c.plotW / 2;
      const rows = Math.max(1, Math.floor((c.height - 28) / c.rowH));
      const times = (act: () => void) => {
        for (let j = 0; j < n; j++) act();
      };
      switch (command.key) {
        case 'q':
        case 'e':
          times(() => c.zoomTime(x, command.key === 'e' ? ZOOM_STEP : 1 / ZOOM_STEP, true));
          break;
        case 'Q':
        case 'E':
          times(() => c.zoomRows(command.key === 'E' ? ZOOM_STEP : 1 / ZOOM_STEP, c.hover ? c.hover.y : null, true));
          break;
        case 'w':
        case 's':
          c.scrollRows((command.key === 's' ? n : -n) * Math.max(c.rowH, (rows * c.rowH) / 8));
          break;
        case 'a':
        case 'd':
          c.panTime(((command.key === 'd' ? n : -n) * c.visibleCycles) / 8);
          break;
        // The selection moves as vim's cursor does: by rows, keeping its column, and by cycles.
        case 'ArrowDown':
        case 'j':
          c.moveSelection(n);
          break;
        case 'ArrowUp':
        case 'k':
          c.moveSelection(-n);
          break;
        case 'ArrowRight':
        case 'l':
          void c.moveColumn(n);
          break;
        case 'ArrowLeft':
        case 'h':
          void c.moveColumn(-n);
          break;
        case ']':
        case '[':
          void c.moveEvent(command.key === ']' ? 1 : -1, n);
          break;
        case '}':
        case '{':
          void c.moveParagraph(command.key === '}' ? 1 : -1, n);
          break;
        case 'J':
        case 'K':
          void c.moveInColumn(command.key === 'J' ? 1 : -1, n);
          break;
        case 'gg':
          void c.selectEdgeRow('first');
          break;
        case 'G':
          void c.selectEdgeRow('last');
          break;
        case 'H':
          c.selectScreenRow('top');
          break;
        case 'M':
          c.selectScreenRow('middle');
          break;
        case 'L':
          c.selectScreenRow('bottom');
          break;
        case 'zz':
          c.scrollSelectedTo('middle');
          break;
        case 'zt':
          c.scrollSelectedTo('top');
          break;
        case 'zb':
          c.scrollSelectedTo('bottom');
          break;
        case 'n':
        case 'N':
          void (async () => {
            for (let j = 0; j < n; j++) if (!(await c.nextMatch(command.key === 'n' ? 1 : -1))) break;
          })();
          break;
        case 'f':
          void c.focusSelected();
          break;
        case 'r':
          c.toggleLinks();
          break;
        case 't':
        case 'T':
          c.cycleFocus(command.key === 't' ? 1 : -1);
          break;
        case 'i':
          c.insertCursor();
          break;
        case 'I':
          void c.insertAtSelectedEdge('start');
          break;
        case 'A':
          void c.insertAtSelectedEdge('end');
          break;
        case 'x':
          c.deleteCursor();
          break;
        case '0':
          void c.toSelectedEdge('start');
          break;
        case '$':
          void c.toSelectedEdge('end');
          break;
        case 'Escape':
          if (c.viewOpen) c.toggleView();
          else {
            c.select(null);
            c.selectColumn(null);
          }
          break;
        case 'o':
          c.toggleView();
          break;
        case '/':
          document.getElementById('jump')?.focus();
          break;
        case '?':
          c.toggleHelp();
          break;
        default:
          // z1 to z9 show or hide a type; other keys are the browser's.
          if (/^z[1-9]$/.test(command.key)) void c.toggleType(Number(command.key[1]) - 1);
          else return;
      }
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
  const zoom = `${Number.isInteger(c.cellW) ? c.cellW : c.cellW.toFixed(2)} px/cycle · ${c.rowH} px rows · ${DETAIL_NAMES[detailOf(c)]}`;
  return (
    <footer class="status">
      <span class="readout">
        {/* Keys waiting for the rest of their command, as vim shows them. */}
        {c.keysPending ? <span class="notice">{c.keysPending}…</span> : c.notice ? <span class="notice">{c.notice}</span> : readout}
      </span>
      <span>
        {zoom} · <kbd>?</kbd> keys
      </span>
    </footer>
  );
}
