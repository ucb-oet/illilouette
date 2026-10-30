// Reading keys as vim does: a count before a command, such as 20j, and commands of two keys, such as gg, zz, and z2.

/** A key, or two keys such as "gg" or "z2", and its count, 1 if none. */
export interface Command {
  key: string;
  count: number;
}

/** The largest count, so that a long run of digits cannot stall the view. */
const MAX_COUNT = 9999;

/** Keys that only modify others, which leave what is pending as it is: Shift, typed for G, say. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

/** The keys that start a command of two keys, and the second keys each takes. */
const SECOND: Record<string, RegExp> = {
  g: /^g$/,
  z: /^[ztb1-9]$/,
};

/** Reads one key after those pending: returns what is pending next, and the command it completes, if any. */
export function readKey(pending: string, key: string): { pending: string; command: Command | null } {
  if (MODIFIERS.has(key)) return { pending, command: null };
  const first = pending.slice(-1);
  if (Object.hasOwn(SECOND, first)) {
    return { pending: '', command: SECOND[first].test(key) ? { key: first + key, count: 1 } : null };
  }
  if (key === 'Escape') return { pending: '', command: pending ? null : { key, count: 1 } };
  // A count: digits from 1, and 0 after one; 0 alone is a command of its own, as in vim.
  if (/^[1-9]$/.test(key) || (key === '0' && pending !== '')) return { pending: pending + key, command: null };
  if (Object.hasOwn(SECOND, key)) return { pending: key, command: null };
  const count = pending ? Math.min(Number(pending), MAX_COUNT) : 1;
  return { pending: '', command: { key, count } };
}
