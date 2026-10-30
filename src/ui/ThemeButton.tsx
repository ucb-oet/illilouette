import { useEffect, useState } from 'preact/hooks';
import { applyThemeChoice, onThemeChange, pageIsDark } from './theme';

export function ThemeButton() {
  // Read from the page; rerenders when it or the system setting changes.
  const [, setTick] = useState(0);
  useEffect(() => onThemeChange(() => setTick((n) => n + 1)), []);
  const dark = pageIsDark();
  return (
    <button
      type="button"
      class="plain icon"
      onClick={() => applyThemeChoice(dark ? 'light' : 'dark')}
      title={dark ? 'Switch to Latte, the light palette' : 'Switch to Mocha, the dark palette'}
      aria-label={dark ? 'Switch to the light palette' : 'Switch to the dark palette'}
    >
      {dark ? <Sun /> : <Moon />}
    </button>
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
