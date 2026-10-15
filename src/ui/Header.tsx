// The header: the file's name and range, the jump box, the type and arrow toggles, the palette, and opening another file.
import { useRef, useState } from 'preact/hooks';
import { fmt } from '../model/present';
import { Controller, useController } from './controller';
import { applyThemeChoice, loadThemeChoice, type ThemeChoice } from './theme';

export function Header({ c, onOpen }: { c: Controller; onOpen: (file: File) => Promise<void> }) {
  useController(c);
  const info = c.source.info;
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<ThemeChoice>(loadThemeChoice());
  const box = useRef<HTMLInputElement>(null);

  const jump = async (ev: Event) => {
    ev.preventDefault();
    const q = query.trim();
    let m: RegExpMatchArray | null;
    let landed = false;
    if (/^\d[\d,]*$/.test(q)) {
      await c.jumpToCycle(Number(q.replace(/,/g, '')));
      landed = true;
    } else if ((m = q.match(/^([A-Za-z_][\w.]*)?#(\d+)$/))) {
      landed = await c.jumpToObject(Number(m[2]), m[1]);
    } else {
      // TODO: queries in the trigger syntax of +eventtrace_start, such as event:instruction.decode,pc=0x80000148,
      // repeated forward with Enter and backward with Shift+Enter.
      c.say('Type a cycle, such as 41440, or an object, such as #3454.');
    }
    // Once a jump lands, keys move the view again; a jump that found nothing leaves the box to correct.
    if (landed) box.current?.blur();
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
          ref={box}
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
