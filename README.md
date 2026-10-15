# illilouette

A pipeline waterfall viewer for [EventTrace](https://github.com/ucb-bar/chipyard) traces, served as a web page: one row per object, such as an instruction, and one column per cycle.

The viewer draws a **waterfall file**, `proto/waterfall.proto`, which a post-processor writes from a trace, its manifest, and the design's view configuration. Everything the viewer draws is already derived in that file: stages, held cycles, how each object ended, the objects its events name, and labels such as disassembly. The viewer applies none of the trace's rules.

## Making a waterfall file

Chipyard's EventTrace reader writes the file with `eventtrace waterfall`. It keeps a copy of this repo's schema, which this repo owns:

```sh
cd chipyard/tools/eventtrace/reader
cargo build --release
target/release/eventtrace waterfall sodor/view.json \
  ../../../sims/verilator/generated-src/<long name>/<long name>.eventtrace.json \
  ../../../sims/verilator/output/<long name>/<test>.trace \
  <test>.waterfall
```

## Running

Node 24 or later:

```sh
npm install
npm run dev        # serves the page with live reload
npm test           # decodes the fixtures and checks their rows
npm run build      # type-checks, then writes the static page to dist/
```

Open the page and drop a waterfall file on it, or choose one. Drop or open another at any time to replace it; one that cannot be read leaves the current file open, and the status bar says why.

## Using it

Letters are as typed: a capital takes Shift.

| Input | Does |
|---|---|
| Scroll / two-finger swipe | Move through rows; sideways or with Shift, pan time |
| Click or drag the timeline bar | Move there; rows follow to the first object in the new range |
| Pinch, Ctrl+scroll | Zoom time only |
| `q` / `e` | Zoom time out / in |
| `Q` / `E` | Zoom rows |
| `w` `a` `s` `d` | Move up, left, down, right |
| Hover a label | The object, its whole label, and how it ended |
| Click | Select an object and the cycle; its arrows and details appear |
| `f` | Bring the selection into view, its first event a third of the way in |
| `↑` `↓` or `k` `j` | Move the selection a row, keeping its cycle, and scrolling rows only |
| `←` `→` or `h` `l` | Move the selected cycle; from the selected object's first event when none is selected |
| `Esc` | Clear the selection and the selected cycle |
| `1`–`9` | Show or hide an object type; its rows close up |
| `t` / `T` | Focus the next or previous shown type; a file opens with its first type in focus |
| `0` / `$` | Select the selection's first or last event's cycle, and pan to it, as vim's start and end of line |
| `i` | Put a cursor on the edge where the selected cycle starts, as vim's `i` inserts before the cursor, and name it: type a name, or keep its cycle, then Enter or `Esc`. The ruler shows each cursor, and between neighbors the gap, such as `Δ 4` |
| `I` / `A` | Put a cursor at the selected object's start, or after its end, as vim's `I` and `A` insert at the start and end of the line; selects its first or last event's cycle, as `0` and `$` do |
| `x` | Remove the cursor at the selected cycle: on the edge where it starts, or else the edge after it |
| `r` | Show or hide arrows for everything on screen; none show once zoomed out a step past where the label column loses its text or the cells their letters |
| `/` | Jump to a cycle (`41440`) or an object (`#3454`, `instruction#3454`); once it lands, keys move the view again |
| `?` | List these keys |

Rows come in the file's order. An object with a parent sits under it, such as a Rocket instruction under the fetch packet it decoded from, its type name indented; hiding the parent's type takes the indent away.

How much a row shows follows the zoom: lettered cells up close, one run per stage in the middle, solid rows far out. One object type is in focus and drawn in full; every other type keeps only the bar along the bottom of its cells, so that packets and instructions, say, tell apart. Hatched cycles, or a dashed bar in a type not in focus, are cycles in which an object was held in its stage. A dot marks an event that describes an object without moving or ending it, such as a stall. A red cap marks an object that left without its type's normal end, such as a squashed instruction.

## Layout

- `proto/waterfall.proto`: the file format.
- `src/file/`: protobuf decoding of the file.
- `src/model/`: the source interface the drawing code reads rows through, the in-memory source, and text derived for display.
- `src/ui/`: the page: controller, canvas renderer, timeline bar, detail panel, header.
- `test/fixtures/`: waterfall files that Chipyard's `eventtrace waterfall` wrote, copied in and not kept in the repo; the tests skip without them:
  - `rocket-rv64ui-p-add.waterfall`: `sims/verilator/output/rocket-fetch/rv64ui-p-add.waterfall`, instructions under fetch packets;
  - `sodor-<test>.waterfall`, for `rv32ui-p-add`, `rv32mi-p-illegal`, and `rv32ui-p-add.cycle-48079-to-flush`: written with `reader/sodor/view.json` from `sims/verilator/output/<long name>/<test>.trace`.

## Not yet

- A local server, and a chunked file layout, for files too large to load in the browser.
- Jump queries in the trigger syntax of `+eventtrace_start`, such as `event:instruction.decode,pc=0x80000148`.
- `[` / `]` to the previous or next event of a kind; history of past selections; view state in the URL.
- Collapsing rows under their parent.
- Comparing two traces.
