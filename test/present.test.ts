import { describe, expect, it } from 'vitest';
import { MemorySource } from '../src/model/memory';
import { effectText, fieldText, fieldValue, outcomeText, segmentAt, shortName, timeByStage } from '../src/model/present';
import { EXECUTE, FETCH, INSTRUCTION, pipeline } from './build';

describe('Text for the pipeline', async () => {
  const source = new MemorySource(pipeline());
  const rows = await source.rows(0, source.info.rowCount);
  const stages = source.info.types.map((t) => t.stages);
  const effects = (i: number) => rows[i].events.map((e) => effectText(rows[i], e, stages[rows[i].type]));

  it('says where an object is in the cycle it is created, then what each event does at the edge after it', () => {
    expect(effects(2)).toEqual([
      'created in Decode at 12 · enters Execute at 13',
      'enters Memory at 14',
      'enters Writeback at 15',
      'leaves Writeback after 15',
    ]);
    // A packet that misses.
    expect(effects(3)).toEqual(['created in S1 at 11 · enters Miss at 12', 'while in Miss', 'leaves Miss after 15']);
  });

  it('keeps the stage of an object created stalled, and reads an event that describes as "while in"', () => {
    expect(effects(4)).toEqual([
      'created in Decode at 15',
      'enters Execute at 18',
      'enters Memory at 19',
      'enters Writeback at 20',
      'leaves Writeback after 20',
    ]);
    expect(effects(9).slice(2)).toEqual(['while in Memory', 'leaves Memory after 24']);
  });

  it('reads a row that starts the cycle after its create event, as Sodor draws them, by the edge alone', () => {
    expect(effects(10)).toEqual(['enters Decode at 31', 'leaves Decode after 32']);
  });

  it('says where an object a field names was in that cycle', () => {
    const decode = rows[4].events[0];
    const by = decode.fields.find((f) => f.name === 'by')!;
    expect(fieldText(by, rows[by.row!], decode.cycle, stages[INSTRUCTION])).toBe('by instruction#0 (in Writeback)');
    expect(fieldValue(by, rows[by.row!], decode.cycle, stages[INSTRUCTION])).toBe('instruction#0 (in Writeback)');
    const stall = decode.fields.find((f) => f.name === 'stall')!;
    expect(fieldText(stall)).toBe('stall scoreboard');
  });

  it('counts time by stage, held cycles apart', () => {
    expect(timeByStage(rows[4])).toEqual([
      { stage: 0, cycles: 3, held: 2 },
      { stage: 1, cycles: 1, held: 0 },
      { stage: 2, cycles: 1, held: 0 },
      { stage: 3, cycles: 1, held: 0 },
    ]);
    expect(timeByStage(rows[3])).toEqual([
      { stage: 0, cycles: 1, held: 0 },
      { stage: 2, cycles: 4, held: 3 },
    ]);
  });

  it('says how an object ended, or that it is live, with its cycles', () => {
    const last = source.info.lastCycle;
    expect(outcomeText(rows[2], last)).toBe('Completed: retire · 4 cycles · 12–15');
    expect(outcomeText(rows[7], last)).toBe('Aborted: squash · 2 cycles · 18–19');
    expect(outcomeText(rows[12], last)).toBe('Live when the trace ends · 4 cycles · 37–40');
  });

  it('finds the segment at a cycle, and none from the end on', () => {
    expect(segmentAt(rows[7], 19)?.stage).toBe(EXECUTE);
    expect(segmentAt(rows[7], 20)).toBeNull();
    expect(segmentAt(rows[12], 40)?.stage).toBe(EXECUTE);
  });

  it('shortens an event name within its type', () => {
    expect(shortName('instruction.mark_replay', 'instruction')).toBe('mark_replay');
    expect(shortName('fetch.miss', source.info.types[FETCH].name)).toBe('miss');
  });
});
