// The example the landing page offers, which ships with the page and so is checked in CI, unlike Chipyard's files:
// it must open with this viewer's format, and carry what the viewer draws in color, which a file from a reader older
// than the format's link roles would lack, drawing every link gray.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { EXAMPLE } from '../src/example';
import { readWaterfall } from '../src/file/waterfall';
import { MemorySource } from '../src/model/memory';

it('opens, with blocking events and links of every kind', async () => {
  const path = fileURLToPath(new URL(`../public/${EXAMPLE}`, import.meta.url));
  const w = await readWaterfall(new Uint8Array(readFileSync(path)));
  const { info } = new MemorySource(w);
  expect(info.types.map((t) => t.name)).toEqual(['fetch', 'instruction', 'vuop']);
  expect(w.sites.some((s) => s.blocks)).toBe(true);
  for (const kind of ['aborted', 'blocked', 'other'] as const) expect(info.links[kind], kind).toBeGreaterThan(0);
});
