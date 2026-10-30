// Waterfall files built in code, and their encoding.
import { ROLES, type Effect, type Field, type Role, type Site, type Waterfall } from '../src/file/waterfall';
import { MemorySource } from '../src/model/memory';
import { Controller } from '../src/ui/controller';

export interface FieldSpec {
  name: string;
  text: string;
  row?: number;
  role?: Role;
}

export interface EventSpec {
  cycle: number;
  /** The event's whole name, such as "instruction.decode". */
  name: string;
  effect?: Effect;
  /** Blocks its object; gets a site of its own. */
  blocks?: boolean;
  fields?: FieldSpec[];
}

export interface RowSpec {
  type: number;
  id: number;
  label?: string[];
  /** Segments as [from, stage, held]. */
  segments: [number, number, number?][];
  end?: number;
  endedBy?: string;
  normalEnd?: boolean;
  fields?: FieldSpec[];
  events?: EventSpec[];
  parent?: number;
}

export interface FileSpec {
  title?: string;
  firstCycle: number;
  lastCycle: number;
  types: { name: string; stages: string[] }[];
  rows: RowSpec[];
  focus?: number;
}

/** A waterfall from a spec, its texts interned as the reader writes them, index 0 the empty text. */
export function build(spec: FileSpec): Waterfall {
  const strings = [''];
  const indices = new Map<string, number>([['', 0]]);
  const s = (text: string) => {
    let i = indices.get(text);
    if (i === undefined) {
      i = strings.length;
      strings.push(text);
      indices.set(text, i);
    }
    return i;
  };
  const sites: Site[] = [];
  const siteOf = new Map<string, number>();
  const site = (event: string, blocks: boolean) => {
    const key = `${event}${blocks ? ' blocks' : ''}`;
    let i = siteOf.get(key);
    if (i === undefined) {
      i = sites.length;
      sites.push({ event: s(event), instance: s('TestHarness.chiptop0.tile'), source: s(`Test.scala:${10 + i}`), blocks });
      siteOf.set(key, i);
    }
    return i;
  };
  const field = (f: FieldSpec) => ({ name: s(f.name), text: s(f.text), row: f.row ?? null, role: f.role ?? 'none' });
  const types = spec.types.map((t) => ({ name: s(t.name), stages: t.stages.map(s) }));
  return {
    version: 1,
    title: spec.title ?? 'test',
    firstCycle: spec.firstCycle,
    lastCycle: spec.lastCycle,
    strings,
    sites,
    types,
    rows: spec.rows.map((r) => ({
      type: r.type,
      id: r.id,
      label: (r.label ?? []).map(s),
      segments: r.segments.map(([from, stage, held]) => ({ from, stage, held: held ?? 0 })),
      end: r.end ?? null,
      endedBy: r.end === undefined ? 0 : s(r.endedBy ?? ''),
      normalEnd: r.normalEnd ?? false,
      fields: (r.fields ?? []).map(field),
      events: (r.events ?? []).map((e) => ({
        cycle: e.cycle,
        site: site(e.name, e.blocks ?? false),
        effect: e.effect ?? { kind: 'observes' },
        fields: (e.fields ?? []).map(field),
      })),
      parent: r.parent ?? null,
    })),
    focus: spec.focus ?? 0,
  };
}

export function encode(w: Waterfall): Uint8Array {
  const out: number[] = [];
  const varint = (n: number) => {
    let v = BigInt(n);
    do {
      const b = Number(v & 0x7fn);
      v >>= 7n;
      out.push(v ? b | 0x80 : b);
    } while (v);
  };
  const tag = (field: number, wire: number) => varint((field << 3) | wire);
  const num = (field: number, n: number) => {
    tag(field, 0);
    varint(n);
  };
  const bytes = (field: number, body: number[]) => {
    tag(field, 2);
    varint(body.length);
    out.push(...body);
  };
  /** Writes into a buffer of its own, for a nested message. */
  const nested = (write: () => void) => {
    const saved = out.splice(0, out.length);
    write();
    const body = out.splice(0, out.length);
    out.push(...saved);
    return body;
  };
  const packed = (field: number, values: number[]) => {
    if (values.length) bytes(field, nested(() => values.forEach(varint)));
  };
  const field = (n: number, f: Field) =>
    bytes(n, nested(() => {
      num(1, f.name);
      num(2, f.text);
      if (f.row !== null) num(3, f.row);
      if (f.role !== 'none') num(4, ROLES.indexOf(f.role));
    }));

  num(1, w.version);
  bytes(2, [...new TextEncoder().encode(w.title)]);
  num(3, w.firstCycle);
  num(4, w.lastCycle);
  for (const text of w.strings) bytes(5, [...new TextEncoder().encode(text)]);
  for (const site of w.sites) {
    bytes(6, nested(() => {
      num(1, site.event);
      num(2, site.instance);
      num(3, site.source);
      if (site.blocks) num(4, 1);
    }));
  }
  for (const t of w.types) bytes(7, nested(() => (num(1, t.name), packed(2, t.stages))));
  for (const r of w.rows) {
    bytes(8, nested(() => {
      num(1, r.type);
      num(2, r.id);
      packed(3, r.label);
      for (const g of r.segments) bytes(4, nested(() => (num(1, g.from), num(2, g.stage), num(3, g.held))));
      if (r.end !== null) num(5, r.end);
      num(6, r.endedBy);
      num(7, r.normalEnd ? 1 : 0);
      for (const f of r.fields) field(8, f);
      for (const e of r.events) {
        bytes(9, nested(() => {
          num(1, e.cycle);
          num(2, e.site);
          if (e.effect.kind === 'enters') num(3, e.effect.stage);
          else if (e.effect.kind === 'observes') num(4, 1);
          else if (e.effect.kind === 'ends') num(5, 1);
          for (const f of e.fields) field(6, f);
        }));
      }
      if (r.parent !== null) num(10, r.parent);
    }));
  }
  if (w.focus) num(9, w.focus);
  return new Uint8Array(out);
}

const enters = (stage: number): Effect => ({ kind: 'enters', stage });
const ends: Effect = { kind: 'ends' };

// Stage indices of the files below.
export const [S1, S2, MISS] = [0, 1, 2];
export const [DECODE, EXECUTE, MEMORY, WRITEBACK] = [0, 1, 2, 3];
export const [FETCH, INSTRUCTION] = [0, 1];

/**
 * A small pipeline, cycles 10 to 40, with each case the tests check, in the reader's row order, each packet followed
 * by its instruction:
 *
 *   row 0   instruction#9  from before the window: no label, in Writeback at 10, retired
 *   row 1   fetch#0        S1 10, S2 11, used at 11
 *   row 2   instruction#0  created in Decode at 12, Execute 13, Memory 14, Writeback 15, retired at 15
 *   row 3   fetch#1        S1 11, Miss 12–15 held 3, blocked by the miss at 12, used at 15
 *   row 4   instruction#1  created in Decode at 15, blocked by instruction#0 until 17, Execute 18, …, retired at 20
 *   row 5   fetch#2        S1 13, S2 14, killed at 14
 *   row 6   fetch#3        S1 16, S2 17, used at 17
 *   row 7   instruction#2  created in Decode at 18, Execute 19, squashed by instruction#1 at 19
 *   row 8   fetch#4        S1 19, S2 20, used at 20
 *   row 9   instruction#3  created in Decode at 21, Execute 22, Memory 23–24, a replay marked at 23, replayed at 24
 *   row 10  instruction#4  without a packet; decoded at 30, in Decode from 31, as Sodor draws its rows; retired at 32
 *   row 11  fetch#5        S1 35, S2 36, used at 36
 *   row 12  instruction#5  created in Decode at 37, Execute 38, live when the trace ends
 */
export function pipeline(): Waterfall {
  const pc = (n: number) => `0x${n.toString(16).padStart(10, '0')}`;
  const packet = (id: number, at: number, mid: number, until: number, held = 0, endedBy = 'use'): RowSpec => ({
    type: FETCH,
    id,
    label: [pc(0x100 + 4 * id)],
    segments: [[at, S1], [at + 1, mid, held]],
    end: until,
    endedBy,
    normalEnd: endedBy === 'use',
    fields: [{ name: 'pc', text: pc(0x100 + 4 * id) }],
    events: [
      { cycle: at, name: 'fetch.lookup', effect: enters(mid), fields: [{ name: 'pc', text: pc(0x100 + 4 * id) }] },
      { cycle: until - 1, name: `fetch.${endedBy}`, effect: ends },
    ],
  });
  const own = (id: number, bits: string, fetchRow: number) => [
    { name: 'bits', text: bits },
    { name: 'fetch', text: `fetch#${id}`, row: fetchRow, role: 'parent' as const },
    { name: 'pc', text: pc(0x100 + 4 * id) },
  ];
  return build({
    title: 'pipeline',
    firstCycle: 10,
    lastCycle: 40,
    types: [
      { name: 'fetch', stages: ['S1', 'S2', 'Miss'] },
      { name: 'instruction', stages: ['Decode', 'Execute', 'Memory', 'Writeback'] },
    ],
    rows: [
      // 0
      {
        type: INSTRUCTION, id: 9, label: ['', ''], segments: [[10, WRITEBACK]], end: 11, endedBy: 'retire', normalEnd: true,
        events: [{ cycle: 10, name: 'instruction.retire', effect: ends }],
      },
      // 1, 2
      packet(0, 10, S2, 12),
      {
        type: INSTRUCTION, id: 0, label: [pc(0x100), 'addi a0, a0, 1'], parent: 1,
        segments: [[12, DECODE], [13, EXECUTE], [14, MEMORY], [15, WRITEBACK]], end: 16, endedBy: 'retire', normalEnd: true,
        fields: own(0, '0x00150513', 1),
        events: [
          { cycle: 12, name: 'instruction.decode', effect: enters(EXECUTE), fields: own(0, '0x00150513', 1) },
          { cycle: 13, name: 'instruction.memory', effect: enters(MEMORY) },
          { cycle: 14, name: 'instruction.writeback', effect: enters(WRITEBACK) },
          { cycle: 15, name: 'instruction.retire', effect: ends },
        ],
      },
      // 3, 4
      { ...packet(1, 11, MISS, 16, 3), events: [
        { cycle: 11, name: 'fetch.lookup', effect: enters(MISS), fields: [{ name: 'pc', text: pc(0x104) }] },
        { cycle: 12, name: 'fetch.miss', blocks: true, fields: [{ name: 'cause', text: 'cache' }] },
        { cycle: 15, name: 'fetch.use', effect: ends },
      ] },
      {
        type: INSTRUCTION, id: 1, label: [pc(0x104), 'sw a0, 0(a1)'], parent: 3,
        segments: [[15, DECODE, 2], [18, EXECUTE], [19, MEMORY], [20, WRITEBACK]], end: 21, endedBy: 'retire', normalEnd: true,
        fields: own(1, '0x00a5a023', 3),
        events: [
          {
            cycle: 15, name: 'instruction.decode', blocks: true,
            fields: [...own(1, '0x00a5a023', 3), { name: 'stall', text: 'scoreboard' }, { name: 'by', text: 'instruction#0', row: 2, role: 'blockedBy' }],
          },
          { cycle: 17, name: 'instruction.issue', effect: enters(EXECUTE) },
          { cycle: 18, name: 'instruction.memory', effect: enters(MEMORY) },
          { cycle: 19, name: 'instruction.writeback', effect: enters(WRITEBACK) },
          { cycle: 20, name: 'instruction.retire', effect: ends },
        ],
      },
      // 5
      packet(2, 13, S2, 15, 0, 'kill'),
      // 6, 7
      packet(3, 16, S2, 18),
      {
        type: INSTRUCTION, id: 2, label: [pc(0x10c), 'beq a0, a1, 0x200'], parent: 6,
        segments: [[18, DECODE], [19, EXECUTE]], end: 20, endedBy: 'squash', normalEnd: false,
        fields: own(3, '0x00b50463', 6),
        events: [
          { cycle: 18, name: 'instruction.decode', effect: enters(EXECUTE), fields: own(3, '0x00b50463', 6) },
          { cycle: 19, name: 'instruction.squash', effect: ends, fields: [{ name: 'by', text: 'instruction#1', row: 4, role: 'abortedBy' }] },
        ],
      },
      // 8, 9
      packet(4, 19, S2, 21),
      {
        type: INSTRUCTION, id: 3, label: [pc(0x110), 'lw a2, 0(a0)'], parent: 8,
        segments: [[21, DECODE], [22, EXECUTE], [23, MEMORY, 1]], end: 25, endedBy: 'replay', normalEnd: false,
        fields: own(4, '0x00052603', 8),
        events: [
          { cycle: 21, name: 'instruction.decode', effect: enters(EXECUTE), fields: own(4, '0x00052603', 8) },
          { cycle: 22, name: 'instruction.memory', effect: enters(MEMORY) },
          { cycle: 23, name: 'instruction.mark_replay', fields: [{ name: 'cause', text: 'cache_nack' }] },
          { cycle: 24, name: 'instruction.replay', effect: ends },
        ],
      },
      // 10
      {
        type: INSTRUCTION, id: 4, label: [pc(0x200), 'jal ra, 0x300'], segments: [[31, DECODE]], end: 33, endedBy: 'retire', normalEnd: true,
        events: [
          { cycle: 30, name: 'instruction.decode', effect: enters(DECODE) },
          { cycle: 32, name: 'instruction.retire', effect: ends },
        ],
      },
      // 11, 12
      packet(5, 35, S2, 37),
      {
        type: INSTRUCTION, id: 5, label: [pc(0x114), 'mv ra, zero'], parent: 11,
        segments: [[37, DECODE], [38, EXECUTE]],
        fields: own(5, '0x00000093', 11),
        events: [{ cycle: 37, name: 'instruction.decode', effect: enters(EXECUTE), fields: own(5, '0x00000093', 11) }],
      },
    ],
  });
}

/**
 * A staircase of n packets, each followed by its instruction, as Rocket's straight-line code looks: packet k in S1 at
 * 2k, S2 at 2k + 1; its instruction in Decode at 2k + 2 and on through Writeback, retired after 2k + 5. Every fifth
 * packet is killed, without an instruction; every seventh instruction is squashed in Execute.
 */
export function staircase(n: number): Waterfall {
  const rows: RowSpec[] = [];
  for (let k = 0; k < n; k++) {
    const t = 2 * k;
    const killed = k % 5 === 4;
    rows.push({
      type: FETCH, id: k, label: [`0x${(0x1000 + 4 * k).toString(16)}`], segments: [[t, S1], [t + 1, S2]], end: t + 2,
      endedBy: killed ? 'kill' : 'use', normalEnd: !killed,
      events: [{ cycle: t, name: 'fetch.lookup', effect: enters(S2) }, { cycle: t + 1, name: killed ? 'fetch.kill' : 'fetch.use', effect: ends }],
    });
    if (killed) continue;
    const squashed = k % 7 === 6;
    const packetRow = rows.length - 1;
    rows.push({
      type: INSTRUCTION, id: k, label: [`0x${(0x1000 + 4 * k).toString(16)}`, `addi a${k % 8}, a${k % 8}, ${k}`], parent: packetRow,
      segments: squashed ? [[t + 2, DECODE], [t + 3, EXECUTE]] : [[t + 2, DECODE], [t + 3, EXECUTE], [t + 4, MEMORY], [t + 5, WRITEBACK]],
      end: squashed ? t + 4 : t + 6, endedBy: squashed ? 'squash' : 'retire', normalEnd: !squashed,
      fields: [{ name: 'fetch', text: `fetch#${k}`, row: packetRow, role: 'parent' }],
      events: [
        { cycle: t + 2, name: 'instruction.decode', effect: enters(EXECUTE), fields: [{ name: 'fetch', text: `fetch#${k}`, row: packetRow, role: 'parent' }] },
        ...(squashed
          ? [{ cycle: t + 3, name: 'instruction.squash', effect: ends }]
          : [
              { cycle: t + 3, name: 'instruction.memory', effect: enters(MEMORY) },
              { cycle: t + 4, name: 'instruction.writeback', effect: enters(WRITEBACK) },
              { cycle: t + 5, name: 'instruction.retire', effect: ends },
            ]),
      ],
    });
  }
  return build({
    title: `staircase of ${n}`,
    firstCycle: 0,
    lastCycle: 2 * n + 4,
    types: [
      { name: 'fetch', stages: ['S1', 'S2', 'Miss'] },
      { name: 'instruction', stages: ['Decode', 'Execute', 'Memory', 'Writeback'] },
    ],
    rows,
  });
}

/** A controller over a file, sized and at its opening view. */
export async function open(w: Waterfall, width = 1200, height = 800): Promise<Controller> {
  const c = new Controller(new MemorySource(w));
  c.setSize(width, height);
  await c.home();
  return c;
}
