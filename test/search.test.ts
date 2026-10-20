import { describe, expect, it } from 'vitest';
import { MemorySource } from '../src/model/memory';
import { labelHolds, parseQuery, sameValue, suggest, type Query } from '../src/model/search';
import { FETCH, INSTRUCTION, open, pipeline, staircase } from './build';

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

describe('Searching the pipeline', () => {
  const source = new MemorySource(pipeline());
  const run = async (text: string, hidden: number[] = []) => {
    const q = parseQuery(text, await source.words());
    if ('error' in q) throw new Error(q.error);
    return source.search(q as Query, { types: new Set(hidden), aborted: false });
  };
  const rows = async (text: string) => (await run(text)).matches.map((m) => m.row);
  const error = async (text: string) => {
    const q = parseQuery(text, await source.words());
    return 'error' in q ? q.error : null;
  };

  it('finds label text, and a 0x number among the labels\' numbers, a jump\'s target included', async () => {
    expect(await rows('addi')).toEqual([2]);
    expect(await rows('A0')).toEqual([2, 4, 7, 9]);
    expect(await rows('0x104')).toEqual([3, 4]);
    // instruction#4 at 0x200, and instruction#2, whose branch targets it.
    expect(await rows('0x200')).toEqual([7, 10]);
    expect(await rows('fence.i')).toEqual([]);
  });

  it('finds an object\'s own field, an event\'s field, and an event, landing on the cycle that matched', async () => {
    expect((await run('instruction.pc=0x104')).matches).toEqual([{ row: 4, cycle: 15 }]);
    expect(await rows('*.pc=0x104')).toEqual([3, 4]);
    expect((await run('instruction.mark_replay.cause=cache_nack')).matches).toEqual([{ row: 9, cycle: 23 }]);
    expect((await run('instruction.*.cause=cache_nack')).matches).toEqual([{ row: 9, cycle: 23 }]);
    expect((await run('fetch.miss.cause=cache')).matches).toEqual([{ row: 3, cycle: 12 }]);
    expect((await run('instruction.squash')).matches).toEqual([{ row: 7, cycle: 19 }]);
    expect((await run('instruction.decode.by=instruction#0')).matches).toEqual([{ row: 4, cycle: 15 }]);
  });

  it('leaves out objects of hidden types, and counts them', async () => {
    expect(await run('*.pc=0x104', [FETCH])).toEqual({ matches: [{ row: 4, cycle: 15 }], skipped: 1 });
  });

  it('says what is wrong, listing the names the file has', async () => {
    expect(await error('instruction.pcc=1')).toBe('instruction has no field pcc. Its fields are bits, fetch, pc.');
    expect(await error('instrction.pc=1')).toBe('No object type is named instrction. The types are fetch, instruction.');
    expect(await error('instruction.pc')).toBe('pc is a field of instruction. Give it a value, as in instruction.pc=…');
    expect(await error('instruction.retire.foo=1')).toBe('retire has no fields.');
    expect(await error('instruction.mark_replay.cause')).toBe('Give the field a value, as in instruction.mark_replay.cause=…');
    expect(await error('instruction.mark_replay.*=x')).toBe('* stands for a type or an event, not a field.');
    expect(await error('*.bogus=3')).toBe('No type has a field bogus. The fields are pc, bits, fetch.');
  });

  it('completes types, fields, events, and the values of a field that takes few', async () => {
    const words = await source.words();
    const texts = (q: string) => suggest(q, words).map((s) => s.text);
    expect(texts('ins')).toEqual(['instruction.']);
    expect(texts('instruction.m')).toEqual(['instruction.memory', 'instruction.mark_replay']);
    expect(texts('instruction.mark_replay.')).toEqual(['instruction.mark_replay.cause=']);
    expect(texts('instruction.decode.stall=')).toEqual(['instruction.decode.stall=scoreboard']);
    // Label text has nothing to complete.
    expect(texts('addi')).toEqual([]);
  });

  it('offers no values for a field that takes too many', async () => {
    const words = await new MemorySource(staircase(40)).words();
    expect(suggest('instruction.fetch=f', words)).toEqual([]);
  });
});

describe('Moving through matches', () => {
  it('goes down the rows from the selection, round past the last, and follows hidden types', async () => {
    const c = await open(staircase(300));
    expect(await c.nextMatch(1)).toBe(false);
    expect(c.notice).toMatch(/^Nothing is searched/);
    await c.setSearch('instruction.squash');
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
    c.select(null);
    c.y0 = 0;
    const places: number[] = [];
    for (let j = 0; j < 10; j++) {
      await c.nextMatch(1);
      places.push(c.placeOf(c.selected!));
    }
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(new Set(places).size).toBe(10);
    // Hiding a type searches again, leaving it out.
    await c.setSearch('*.fetch=fetch#3');
    expect(c.search!.matches.length).toBe(1);
    await c.toggleType(INSTRUCTION);
    expect([c.search!.matches.length, c.search!.skipped]).toEqual([0, 1]);
    await c.setSearch('instruction.pcc=1');
    expect(await c.nextMatch(1)).toBe(false);
    expect(c.notice).toBe('instruction has no field pcc. Its fields are fetch.');
  });
});
