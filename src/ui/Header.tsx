// The header: the file's name and range, the jump box, which also searches, the type and arrow toggles, the palette,
// and opening another file.
import { useEffect, useRef, useState } from 'preact/hooks';
import { fmt } from '../model/present';
import { suggest, type Suggestion } from '../model/search';
import { Controller, useController } from './controller';
import { applyThemeChoice, isDark, loadThemeChoice, onThemeChange, type ThemeChoice } from './theme';

export function Header({ c, onOpen }: { c: Controller; onOpen: (file: File) => Promise<void> }) {
  useController(c);
  const info = c.source.info;
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<ThemeChoice>(loadThemeChoice());
  const [focused, setFocused] = useState(false);
  /** The completion picked with the arrow keys, or -1. */
  const [picked, setPicked] = useState(-1);
  const box = useRef<HTMLInputElement>(null);
  // The theme button follows the system's setting while no choice is made.
  const [, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick((n) => n + 1)), []);
  const dark = isDark(theme);

  /** A cycle or an object to jump to, rather than a search. */
  const isJump = (q: string) => /^\d[\d,]*$/.test(q) || /^([A-Za-z_][\w.]*)?#\d+$/.test(q);
  const suggestions: Suggestion[] = focused && c.words && !isJump(query.trim()) ? suggest(query, c.words) : [];

  const edit = (text: string) => {
    setQuery(text);
    setPicked(-1);
    const q = text.trim();
    if (!q || isJump(q)) c.clearSearch();
    else void c.setSearch(q);
  };
  const go = async (back: boolean) => {
    const q = query.trim();
    let m: RegExpMatchArray | null;
    let landed = false;
    if (!q) return;
    if (/^\d[\d,]*$/.test(q)) {
      await c.jumpToCycle(Number(q.replace(/,/g, '')));
      landed = true;
    } else if ((m = q.match(/^([A-Za-z_][\w.]*)?#(\d+)$/))) {
      landed = await c.jumpToObject(Number(m[2]), m[1]);
    } else {
      if (c.search?.text !== q) await c.setSearch(q);
      landed = await c.nextMatch(back ? -1 : 1);
    }
    // Once a jump lands, keys move the view again, n and N among them; one that found nothing leaves the box to correct.
    if (landed) box.current?.blur();
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    const n = suggestions.length;
    if (n && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      setPicked((p) => (ev.key === 'ArrowDown' ? (p + 1) % n : (p - 1 + n) % n));
    } else if (n && ev.key === 'Tab' && !ev.shiftKey) {
      ev.preventDefault();
      edit(suggestions[Math.max(0, picked)].text);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (picked >= 0 && picked < n) edit(suggestions[picked].text);
      else void go(ev.shiftKey);
    } else if (ev.key === 'Escape' && picked >= 0) {
      // Esc first lets go of a picked completion, then of the box.
      ev.stopPropagation();
      setPicked(-1);
    }
  };
  const s = c.search;
  const at = c.matchAt;
  const count = !s || s.error ? '' : !s.matches.length ? 'no matches' : at >= 0 ? `${fmt(at + 1)} of ${fmt(s.matches.length)}` : `${fmt(s.matches.length)} ${s.matches.length === 1 ? 'match' : 'matches'}`;
  const skipped = s && !s.error && s.skipped ? ` · ${fmt(s.skipped)} hidden` : '';
  const choose = (t: ThemeChoice) => {
    setTheme(t);
    applyThemeChoice(t);
  };

  return (
    <header class="top">
      <div class="title">
        <h1>{info.title}</h1>
        <p>
          cycles {fmt(info.firstCycle)}–{fmt(info.lastCycle)} · {fmt(info.rowCount)} objects
        </p>
      </div>
      <form class="jump" onSubmit={(e) => e.preventDefault()}>
        <input
          id="jump"
          ref={box}
          type="text"
          value={query}
          onInput={(e) => edit((e.target as HTMLInputElement).value)}
          // Room on the right for the count, at its monospace width.
          style={{ paddingRight: count || skipped ? `${Math.ceil((count + skipped).length * 7 + 20)}px` : undefined }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
            void c.loadWords();
          }}
          onBlur={() => {
            setFocused(false);
            setPicked(-1);
          }}
          placeholder="Cycle, #id, or search"
          aria-label="Jump to a cycle or an object, or search"
          aria-autocomplete="list"
          aria-controls="jump-suggestions"
          spellcheck={false}
          autocomplete="off"
        />
        {(count || skipped) && (
          <span class="count" aria-live="polite">
            {count}
            {skipped}
          </span>
        )}
        {suggestions.length > 0 && (
          <ul class="suggestions" id="jump-suggestions" role="listbox">
            {suggestions.map((g, k) => (
              <li
                key={g.text}
                role="option"
                aria-selected={k === picked}
                // Taken on mousedown, before the box loses focus.
                onMouseDown={(e) => {
                  e.preventDefault();
                  edit(g.text);
                }}
              >
                <span>{g.text}</span>
                <small>{g.kind}</small>
              </li>
            ))}
          </ul>
        )}
      </form>
      <div class="chips" role="group" aria-label="Show or hide">
        {info.types.slice(0, 9).map((t, i) => (
          <button
            type="button"
            class={i === c.focusType ? 'chip focused' : 'chip'}
            key={t.name}
            aria-pressed={!c.hiddenTypes.has(i)}
            title={`${t.name}: ${t.stages.join(', ')}${i === c.focusType ? '. In focus; t moves the focus.' : ''}`}
            onClick={() => void c.toggleType(i)}
          >
            <kbd>{i + 1}</kbd>
            {/* Drawn as the type's cells are: filled with a bar beneath in focus, the bar alone otherwise. */}
            <i class="mark" aria-hidden="true" />
            {t.name}
          </button>
        ))}
        <button type="button" class="chip" aria-pressed={c.allArrows} title="Arrows for everything on screen" onClick={() => c.toggleArrows()}>
          <kbd>r</kbd>Arrows
        </button>
      </div>
      <button
        type="button"
        class="plain icon"
        onClick={() => choose(dark ? 'light' : 'dark')}
        title={dark ? 'Switch to Latte, the light palette' : 'Switch to Mocha, the dark palette'}
        aria-label={dark ? 'Switch to the light palette' : 'Switch to the dark palette'}
      >
        {dark ? <Sun /> : <Moon />}
      </button>
      <label class="plain">
        Open…
        <input
          type="file"
          accept=".pb,.waterfall"
          hidden
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            const f = input.files?.[0];
            // Cleared, so that choosing the same file again, after fixing it, opens it again.
            input.value = '';
            if (f) onOpen(f).catch((err: Error) => c.say(err.message));
          }}
        />
      </label>
    </header>
  );
}

function Sun() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
    </svg>
  );
}

function Moon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
      <path d="M13.5 9.6A5.75 5.75 0 1 1 6.4 2.5a4.6 4.6 0 0 0 7.1 7.1z" />
    </svg>
  );
}
