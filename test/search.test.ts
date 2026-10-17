import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWaterfall } from '../src/file/waterfall';
import { MemorySource } from '../src/model/memory';
import { labelHolds, parseQuery, sameValue, suggest, type Query } from '../src/model/search';
import { Controller } from '../src/ui/controller';

const load = (name: string) =>
  new MemorySource(decodeWaterfall(new Uint8Array(readFileSync(new URL(`./fixtures/${name}.waterfall`, import.meta.url)))));
const haveFixtures = existsSync(new URL('./fixtures/rocket-rv64ui-p-add.waterfall', import.meta.url));
const [FETCH, INSTRUCTION] = [0, 1];

describe('Values and labels', () => {
  it('compare numbers by value and other texts whole, ignoring case', () => {
    expect(sameValue('0x0080000050', '0x80000050')).toBe(true);
    expect(sameValue('0x0080000050', '0x80000058')).toBe(false);
    expect(sameValue('cache_nack', 'CACHE_NACK')).toBe(true);
    expect(sameValue('cache_nack', 'cache')).toBe(false);
    expect(sameValue('instruction#60', 'instruction#60')).toBe(true);
  });

  it('find text anywhere in a label, and a 0x number among its numbers', () => {
    expect(labelHolds(['0x0080000040', 'sw gp, -0x3c(t5)'], 'SW GP')).toBe(true);
    expect(labelHolds(['0x0080000000', 'j 0x80000050'], '0x80000050')).toBe(true);
    expect(labelHolds(['0x0080000054', 'mv sp, zero'], '0x80000050')).toBe(false);
  });
});

describe.skipIf(!haveFixtures)('Searching rv64ui-p-add', () => {
  const source = haveFixtures ? load('rocket-rv64ui-p-add') : (undefined as never);
  const run = async (text: string, hidden: number[] = []) => {
    const q = parseQuery(text, await source.words());
    if ('error' in q) throw new Error(q.error);
    return source.search(q as Query, { types: new Set(hidden), abnormal: false });
  };
  const error = async (text: string) => {
    const q = parseQuery(text, await source.words());
    return 'error' in q ? q.error : null;
  };

  it('finds labels, own fields, events, and their fields', async () => {
    expect((await run('csrr')).matches.length).toBe(8);
    expect((await run('fence.i')).matches.length).toBe(0);
    // The instruction at 0x80000050, the jump to it, and their packets; with fetch hidden, the packets are skipped.
    expect((await run('0x80000050')).matches.length).toBe(4);
    expect(await run('0x80000050', [FETCH])).toMatchObject({ skipped: 2 });
    expect((await run('instruction.pc=0x80000050')).matches).toEqual([{ row: (await source.find(60, INSTRUCTION))!, cycle: 1511 }]);
    expect((await run('*.pc=0x80000050')).matches.length).toBe(3);
    const nacks = await run('instruction.mark_replay.cause=cache_nack');
    expect(nacks.matches.length).toBe(4);
    for (const m of nacks.matches) {
      const [r] = await source.rows(m.row, m.row + 1);
      expect(r.events.find((e) => e.cycle === m.cycle)?.name).toBe('instruction.mark_replay');
    }
    expect((await run('instruction.*.cause=load_use')).matches.length).toBe(2);
    expect((await run('instruction.flush')).matches.length).toBe(53);
    expect((await run('fetch.miss', [FETCH])).skipped).toBe(31);
    const rows = (await run('instruction.flush')).matches.map((m) => m.row);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it('says what is wrong, listing the names the file has', async () => {
    expect(await error('instruction.pcc=1')).toBe('instruction has no field pcc. Its fields are bits, fetch, pc.');
    expect(await error('instrction.pc=1')).toBe('No object type is named instrction. The types are fetch, instruction.');
    expect(await error('instruction.pc')).toBe('pc is a field of instruction. Give it a value, as in instruction.pc=…');
    expect(await error('instruction.retire.foo=1')).toBe('retire has no fields.');
    expect(await error('instruction.mark_replay.cause')).toBe('Give the field a value, as in instruction.mark_replay.cause=…');
    expect(await error('instruction.mark_replay.*=x')).toBe('* stands for a type or an event, not a field.');
  });

  it('completes types, fields, events, and few values', async () => {
    const words = await source.words();
    const texts = (q: string) => suggest(q, words).map((s) => s.text);
    expect(texts('ins')).toEqual(['instruction.']);
    expect(texts('instruction.m')).toEqual(['instruction.memory', 'instruction.mark_replay']);
    expect(texts('instruction.mark_replay.')).toEqual(['instruction.mark_replay.cause=']);
    expect(texts('instruction.mark_replay.cause=ca')).toEqual(['instruction.mark_replay.cause=cache_busy', 'instruction.mark_replay.cause=cache_nack']);
    // An address takes too many values to offer, and label text has nothing to complete.
    expect(texts('instruction.pc=0x')).toEqual([]);
    expect(texts('csrr')).toEqual([]);
  });
});

describe.skipIf(!haveFixtures)('Moving through matches', () => {
  it('goes on down the rows from the selection, round past the last, and follows hidden types', async () => {
    const c = new Controller(load('rocket-rv64ui-p-add'));
    c.setSize(1200, 800);
    await c.home();
    expect(await c.nextMatch(1)).toBe(false);
    expect(c.notice).toMatch(/^Nothing is searched/);
    await c.setSearch('instruction.mark_replay.cause=cache_nack');
    const all = c.search!.matches;
    expect(await c.nextMatch(1)).toBe(true);
    expect([c.selected, c.column, c.matchAt]).toEqual([all[0].row, all[0].cycle, 0]);
    await c.nextMatch(1);
    expect(c.matchAt).toBe(1);
    await c.nextMatch(-1);
    expect(c.matchAt).toBe(0);
    c.say('');
    await c.nextMatch(-1);
    expect(c.matchAt).toBe(all.length - 1);
    expect(c.notice).toMatch(/on to the last/);
    // Each n goes further down the rows.
    await c.setSearch('instruction.flush');
    c.select(null);
    c.y0 = 0;
    const places: number[] = [];
    for (let j = 0; j < 10; j++) {
      await c.nextMatch(1);
      places.push(c.placeOf(c.selected!));
    }
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(new Set(places).size).toBe(10);
    await c.setSearch('*.pc=0x80000050');
    expect(c.search!.matches.length).toBe(3);
    await c.toggleType(FETCH);
    expect([c.search!.matches.length, c.search!.skipped]).toEqual([1, 2]);
    await c.setSearch('instruction.pcc=1');
    expect(await c.nextMatch(1)).toBe(false);
    expect(c.notice).toBe('instruction has no field pcc. Its fields are bits, fetch, pc.');
  });
});
