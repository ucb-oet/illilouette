// The header: the file's name and range, the jump box, the type and arrow toggles, the palette, and opening another file.
import { useState } from 'preact/hooks';
import { fmt } from '../model/present';
import { Controller, useController } from './controller';
import { applyThemeChoice, loadThemeChoice, type ThemeChoice } from './theme';

export function Header({ c, onOpen }: { c: Controller; onOpen: (file: File) => void }) {
  useController(c);
  const info = c.source.info;
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<ThemeChoice>(loadThemeChoice());

  const jump = (ev: Event) => {
    ev.preventDefault();
    const q = query.trim();
    let m: RegExpMatchArray | null;
    if (/^\d[\d,]*$/.test(q)) void c.jumpToCycle(Number(q.replace(/,/g, '')));
    else if ((m = q.match(/^([A-Za-z_][\w.]*)?#(\d+)$/))) void c.jumpToObject(Number(m[2]), m[1]);
    else {
      // TODO: queries in the trigger syntax of +eventtrace_start, such as event:instruction.decode,pc=0x80000148,
      // repeated forward with Enter and backward with Shift+Enter.
      c.notice = 'Type a cycle, such as 41440, or an object, such as #3454.';
      c.changed();
    }
  };
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
      <form class="jump" onSubmit={jump}>
        <input
          id="jump"
          type="text"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          placeholder="Jump to a cycle or #id"
          aria-label="Jump to a cycle or an object"
          spellcheck={false}
          autocomplete="off"
        />
      </form>
      <div class="chips" role="group" aria-label="Show or hide">
        {info.types.slice(0, 9).map((t, i) => (
          <button type="button" class="chip" key={t.name} aria-pressed={!c.hiddenTypes.has(i)} onClick={() => void c.toggleType(i)}>
            <kbd>{i + 1}</kbd>
            <span class="swatches">
              {t.stages.map((s, k) => (
                <i key={s} title={s} style={{ background: `var(--stage-${k % 8})` }} />
              ))}
            </span>
            {t.name}
          </button>
        ))}
        <button type="button" class="chip" aria-pressed={c.allArrows} onClick={() => c.toggleArrows()}>
          <kbd>R</kbd>All arrows
        </button>
      </div>
      <div class="seg" role="group" aria-label="Palette">
        {(['light', 'dark', 'system'] as const).map((t) => (
          <button type="button" key={t} aria-pressed={theme === t} onClick={() => choose(t)}>
            {t === 'light' ? 'Latte' : t === 'dark' ? 'Mocha' : 'Auto'}
          </button>
        ))}
      </div>
      <label class="plain">
        Open…
        <input
          type="file"
          accept=".pb,.waterfall"
          hidden
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) onOpen(f);
          }}
        />
      </label>
    </header>
  );
}
