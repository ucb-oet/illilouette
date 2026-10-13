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
  <test>.waterfall.pb
```

## Running

Node 24 or later:

```sh
npm install
npm run dev        # serves the page with live reload
npm test           # decodes the fixtures and checks their rows
npm run build      # type-checks, then writes the static page to dist/
```

Open the page and drop a waterfall file on it, or choose one.

## Using it

| Input | Does |
|---|---|
| Scroll / two-finger swipe | Move through rows; sideways or with Shift, pan time |
| Pinch, Ctrl+scroll | Zoom time only |
| `Q` / `E` | Zoom time out / in |
| Shift+`Q` / `E` | Zoom rows |
| `W` `A` `S` `D` | Move up, left, down, right |
| Click | Select an object; its arrows and details appear |
| `F` | Focus: bring the selection into view, its first event a third of the way in |
| `↑` / `↓`, `Esc` | Move or clear the selection |
| `1`–`9` | Show or hide an object type |
| `0` | Show or hide arrows for everything on screen |
| `/` | Jump to a cycle (`41440`) or an object (`#3454`, `instruction#3454`) |

How much a row shows follows the zoom: lettered cells up close, one run per stage in the middle, solid rows far out. Hatched cycles are cycles in which an object was held in its stage. A dot marks an event that describes an object without moving or ending it, such as a stall. A red cap marks an object that left without its type's normal end, such as a squashed instruction.

## Layout

- `proto/waterfall.proto`: the file format.
- `src/file/`: protobuf decoding of the file.
- `src/model/`: the source interface the drawing code reads rows through, the in-memory source, and text derived for display.
- `src/ui/`: the page: controller, canvas renderer, timeline bar, detail panel, header.
- `test/fixtures/`: waterfall files of Sodor traces, made by `scripts/make_fixtures.py` from a Chipyard checkout with simulated Sodor traces: `uv run --with protobuf scripts/make_fixtures.py <chipyard>`, with cargo and protoc on the path.

## Not yet

- A local server, and a chunked file layout, for files too large to load in the browser.
- Jump queries in the trigger syntax of `+eventtrace_start`, such as `event:instruction.decode,pc=0x80000148`.
- `[` / `]` to the previous or next event of a kind; history of past selections; view state in the URL.
- Several object types in one file: their row order, and rows closing up when a type is hidden.
- Comparing two traces.
