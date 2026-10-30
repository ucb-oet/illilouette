// The shipped example must open with this format and carry blocking sites, every link kind, and its focus type.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { EXAMPLE } from '../src/example';
import { readWaterfall } from '../src/file/waterfall';
import { MemorySource } from '../src/model/memory';

it('opens on instructions, with blocking events and links of every kind', async () => {
  const path = fileURLToPath(new URL(`../public/${EXAMPLE}`, import.meta.url));
  const w = await readWaterfall(new Uint8Array(readFileSync(path)));
  const { info } = new MemorySource(w);
  expect(info.types[info.focus].name).toBe('instruction');
  expect(w.sites.some((s) => s.blocks)).toBe(true);
  for (const kind of ['aborted', 'blocked', 'other'] as const) expect(info.links[kind], kind).toBeGreaterThan(0);
});
