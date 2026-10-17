import { describe, expect, it } from 'vitest';
import { readKey, type Command } from '../src/ui/keys';

/** The commands a run of keys reads as, and what is left pending. */
function read(keys: string[]): { commands: Command[]; pending: string } {
  let pending = '';
  const commands: Command[] = [];
  for (const k of keys) {
    const r = readKey(pending, k);
    pending = r.pending;
    if (r.command) commands.push(r.command);
  }
  return { commands, pending };
}

describe('Reading keys', () => {
  it('reads counts before commands, and 0 alone as a command', () => {
    expect(read(['2', '0', 'j']).commands).toEqual([{ key: 'j', count: 20 }]);
    expect(read(['0']).commands).toEqual([{ key: '0', count: 1 }]);
    expect(read(['l']).commands).toEqual([{ key: 'l', count: 1 }]);
    expect(read(['9', '9', '9', '9', '9', 'n']).commands).toEqual([{ key: 'n', count: 9999 }]);
  });

  it('reads two-key commands, and drops a first key the second does not complete', () => {
    expect(read(['g', 'g', 'z', 'z', 'z', 't', 'z', 'b', 'z', '2']).commands.map((c) => c.key)).toEqual(['gg', 'zz', 'zt', 'zb', 'z2']);
    expect(read(['g', 'x', 'j']).commands.map((c) => c.key)).toEqual(['j']);
    expect(read(['3', 'g', 'g']).commands).toEqual([{ key: 'gg', count: 1 }]);
  });

  it('keeps what is pending through Shift, shows it, and drops it on Esc', () => {
    expect(read(['Shift', 'G']).commands).toEqual([{ key: 'G', count: 1 }]);
    expect(read(['2', '0'])).toEqual({ commands: [], pending: '20' });
    expect(read(['z'])).toEqual({ commands: [], pending: 'z' });
    expect(read(['2', '0', 'Escape', 'j']).commands).toEqual([{ key: 'j', count: 1 }]);
    expect(read(['z', 'Escape']).commands).toEqual([]);
    expect(read(['Escape']).commands).toEqual([{ key: 'Escape', count: 1 }]);
  });
});
