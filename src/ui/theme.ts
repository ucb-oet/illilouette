// The canvas's colors, read from the page's CSS tokens (Catppuccin Latte and Mocha), and the viewer's theme choice.
import { CURSOR_GROUPS } from './controller';

export interface Theme {
  dark: boolean;
  base: string;
  mantle: string;
  crust: string;
  surface0: string;
  surface1: string;
  surface2: string;
  overlay0: string;
  overlay1: string;
  subtext0: string;
  subtext1: string;
  text: string;
  /** Marks an object that left without its type's normal end, and links from what aborted it. */
  killed: string;
  /** Dots for events that find their object blocked, and links from what blocks it. */
  blocked: string;
  /** Dots for other events that describe an object without moving or ending it. */
  event: string;
  /** The selection. */
  accent: string;
  /** Cursor groups' colors, in group order. */
  cursors: string[];
  /** Cursor tags' fills and texts, in group order: in Latte a light tint and a deep shade of each color; in Mocha the
   *  strip's ground and the color. */
  cursorFills: string[];
  cursorInks: string[];
  /** Stage colors, in stage order; a type's stage i takes color i. */
  stages: string[];
  /** Opacity of a stage's wash behind its letters. */
  wash: number;
  /** Diagonal hatching per stage color, for held cycles. */
  hatch: CanvasPattern[];
}

const STAGE_COLORS = 8;

export function readTheme(ctx: CanvasRenderingContext2D): Theme {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string) => style.getPropertyValue(`--${name}`).trim();
  const root = document.documentElement.dataset.theme;
  const dark = root === 'dark' || (root !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const stages = Array.from({ length: STAGE_COLORS }, (_, i) => get(`stage-${i}`));
  const wash = parseFloat(get('wash')) || 0.3;
  return {
    dark,
    base: get('base'),
    mantle: get('mantle'),
    crust: get('crust'),
    surface0: get('surface0'),
    surface1: get('surface1'),
    surface2: get('surface2'),
    overlay0: get('overlay0'),
    overlay1: get('overlay1'),
    subtext0: get('subtext0'),
    subtext1: get('subtext1'),
    text: get('text'),
    killed: get('killed'),
    blocked: get('blocked'),
    event: get('event'),
    accent: get('accent'),
    cursors: Array.from({ length: CURSOR_GROUPS }, (_, i) => get(`cursor-${i}`)),
    cursorFills: Array.from({ length: CURSOR_GROUPS }, (_, i) => get(`cursor-fill-${i}`)),
    cursorInks: Array.from({ length: CURSOR_GROUPS }, (_, i) => get(`cursor-ink-${i}`)),
    stages,
    wash,
    hatch: stages.map((color) => hatchPattern(ctx, color, wash, dark)),
  };
}

export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

function hatchPattern(ctx: CanvasRenderingContext2D, color: string, wash: number, dark: boolean): CanvasPattern {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 6;
  const g = tile.getContext('2d')!;
  g.fillStyle = rgba(color, wash * 0.45);
  g.fillRect(0, 0, 6, 6);
  g.strokeStyle = rgba(color, dark ? 0.75 : 0.65);
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(-1, 7);
  g.lineTo(7, -1);
  g.moveTo(-1, 1);
  g.lineTo(1, -1);
  g.moveTo(5, 7);
  g.lineTo(7, 5);
  g.stroke();
  return ctx.createPattern(tile, 'repeat')!;
}

/** Calls back whenever the colors may have changed: the palette toggle, the system's light or dark setting, or the
 *  fonts finishing loading. Returns a function that stops listening. */
export function onThemeChange(callback: () => void): () => void {
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', callback);
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let live = true;
  void document.fonts?.ready.then(() => live && callback());
  return () => {
    live = false;
    media.removeEventListener('change', callback);
    observer.disconnect();
  };
}

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Whether a choice comes out dark: the system's setting until a choice is made. */
export function isDark(choice: ThemeChoice): boolean {
  return choice === 'dark' || (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}

const KEY = 'illilouette.theme';

export function loadThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // Storage can be unavailable, as in a private window; the system theme applies.
  }
  return 'system';
}

export function applyThemeChoice(choice: ThemeChoice): void {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // As above.
  }
}

export const MONO = (size: number, weight = 400) =>
  `${weight} ${size}px "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
