// The list of keys, opened with ?.
import { useEffect, useRef } from 'preact/hooks';
import { Controller, useController } from './controller';

/** Each group's inputs, as key caps, and what they do, with example texts where the group takes text. Letters are as
 *  typed: a capital takes Shift. */
const GROUPS: { name: string; keys: [string[], string][]; examples?: [string, string][] }[] = [
  {
    name: 'Move',
    keys: [
      [['w', 'a', 's', 'd'], 'Move up, left, down, right'],
      [['Scroll'], 'Move through rows; sideways or with Shift, pan time'],
      [['Drag'], 'Move'],
      [['Timeline bar'], 'Click or drag to move there'],
    ],
  },
  {
    name: 'Search',
    keys: [
      [['/'], 'Jump to a cycle (41440) or an object (#3454), or search'],
      [['Tab'], 'Complete a type, field, event, or value'],
      [['Enter'], 'Go to the next match; with Shift, the previous'],
      [['n', 'N'], 'Next or previous match'],
    ],
    examples: [
      ['csrr', 'labels that contain it'],
      ['instruction.pc=0x80000050', 'an object’s own field'],
      ['instruction.mark_replay.cause=cache_nack', 'a field of one of its events'],
      ['instruction.flush', 'objects with that event'],
      ['*.pc=0x80000050', '* for any type or event'],
    ],
  },
  {
    name: 'Zoom',
    keys: [
      [['q', 'e'], 'Zoom time out, in'],
      [['Q', 'E'], 'Zoom rows out, in'],
      [['Ctrl', 'Scroll'], 'Zoom time; so do Cmd and a pinch'],
      [['Ctrl', 'Shift', 'Scroll'], 'Zoom rows; so does Shift with a pinch'],
    ],
  },
  {
    name: 'Select',
    keys: [
      [['Click'], 'Select an object and the cycle'],
      [['↑', '↓'], 'Move the selection a row, keeping its cycle; or k j'],
      [['←', '→'], 'Move the selected cycle; or h l'],
      [['[', ']'], "Move the selected cycle to the object's previous or next event"],
      [['0', '$'], "Select the object's first or last event's cycle"],
      [['{', '}'], 'Move past a row and the rows under it'],
      [['J', 'K'], 'Next or previous row with anything at the selected cycle'],
      [['gg', 'G'], 'Select the first or last row'],
      [['H', 'M', 'L'], 'Select the top, middle, or bottom row on screen'],
      [['zz', 'zt', 'zb'], 'Scroll the selected row to the middle, top, or bottom'],
      [['20', 'j'], 'A count repeats a move: 20j, 5l, 3n, 2]'],
      [['f'], 'Bring the selection into view'],
      [['Esc'], 'Clear the selection and the selected cycle'],
    ],
  },
  {
    name: 'Cursors',
    keys: [
      [['i'], 'Cursor before the selected cycle'],
      [['I', 'A'], "Cursor at the selected object's start, or after its end"],
      [['x'], 'Remove the cursor at the selected cycle'],
      [['Enter'], "Keep a new cursor's name, typed or its cycle; so does Esc"],
    ],
  },
  {
    name: 'Show',
    keys: [
      [['z1', '–', 'z9'], 'Show or hide an object type'],
      [['t', 'T'], 'Focus the next or previous shown type; the others keep only their bars'],
      [['r'], 'Arrows for everything on screen'],
      [['o'], 'View: types, focus, objects that ended abnormally, arrows'],
      [['?'], 'These keys'],
    ],
  },
];

export function Help({ c }: { c: Controller }) {
  useController(c);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (c.helpOpen) card.current?.focus();
  }, [c.helpOpen]);
  if (!c.helpOpen) return null;
  return (
    <div class="help" onClick={(e) => e.target === e.currentTarget && c.toggleHelp()}>
      <div class="help-card" ref={card} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Keys">
        <div class="help-head">
          <h2>
            Keys <span>Letters as typed: a capital takes Shift.</span>
          </h2>
          <button type="button" class="plain" onClick={() => c.toggleHelp()} aria-label="Close">
            Esc
          </button>
        </div>
        <div class="help-groups">
          {GROUPS.map((g) => (
            <section key={g.name}>
              <h3>{g.name}</h3>
              <dl>
                {g.keys.map(([caps, does]) => (
                  <div key={does}>
                    <dt>
                      {caps.map((k) => (k === '–' ? <span key={k}>–</span> : <kbd key={k}>{k}</kbd>))}
                    </dt>
                    <dd>{does}</dd>
                  </div>
                ))}
              </dl>
              {g.examples && (
                <ul class="examples">
                  {g.examples.map(([text, finds]) => (
                    <li key={text}>
                      <code>{text}</code> <span>{finds}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
