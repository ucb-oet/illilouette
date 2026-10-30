# illilouette

A pipeline waterfall viewer for [EventTrace](https://github.com/ucb-bar/chipyard) traces, served as a web page: one row per object, such as an instruction, and one column per cycle.

The viewer draws a **waterfall file**, `proto/waterfall.proto`, which a post-processor writes from a trace, its manifest, and the design's view configuration. Everything the viewer draws is already derived in that file: stages, held cycles, how each object ended, the objects its events name, and labels such as disassembly. The viewer applies none of the trace's rules.

It is hosted at https://ucb-oet.github.io/illilouette/, built from `main` on every push. A file you open there is read in your browser and never leaves it: the page has no server and sends nothing. Without a trace at hand, open the example, `vec-strlen` traced on Rocket with Saturn's vector unit.

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
npm test           # runs the tests, and the smoke tests over Chipyard's waterfall files
npm run build      # type-checks, then writes the static page to dist/
```

Open the page and drop a waterfall file on it, or choose one. A gzipped file, such as `vec-strlen.waterfall.gz`, opens as it is, at about a quarter of the size. Drop or open another at any time to replace it; one that cannot be read leaves the current file open, and the status bar says why.

## Using it

| Input | Does |
|---|---|
| Scroll / two-finger swipe | Move through rows; sideways or with Shift, pan time |
| Drag | Move |
| Pinch, Ctrl or Cmd+scroll | Zoom time; with Shift held, zoom rows |
| Click or drag the timeline bar | Move there; rows follow to the first object in the new range |
| Hover a label | The object, its whole label, and how it ended |
| Click | Select an object and the cycle; its links and details appear |
| Double-click a label | Bring that object's events into view; the rows stay where they are |

Everything else has a key, read as vim reads them: counts such as `20j`, `gg` and `G`, `H` `M` `L`, `zz` `zt` `zb`, `{` and `}`, `0` and `$`, and `i` `I` `A` `x` for cursors. Press `?` in the viewer for the list; `o` opens the view panel and `c` the cursor panel.

Rows come in the file's order. An object with a parent sits under it, such as a Rocket instruction under the fetch packet it decoded from, its type name indented; hiding the parent's type takes the indent away.

How much a row shows follows the zoom: lettered cells up close, one run per stage in the middle, solid rows far out. One object type is in focus and drawn in full, at first the one the design's view names, such as instruction; every other type keeps only the bar along the bottom of its cells, so that packets and instructions, say, tell apart. Hatched cycles, or a dashed bar in a type not in focus, are cycles in which an object was held in its stage. An amber dot marks an event that finds its object blocked, such as a stall; a smaller gray dot marks any other event that describes an object without moving or ending it. A red cap marks an aborted object, one that ended other than by its type's normal end, such as a squashed instruction. Links join an object to each object its events name, colored by what that object is to it: red for what aborted it, amber for what blocks it, and gray for anything else, such as its parent. A link has no arrowhead: it runs into the mark it explains, the amber dot or the red cap. The view panel picks which kinds show; parents start hidden, since the rows' order and indent already show them. Cursors are lines in their group's color. While there are any, a strip along the bottom of the waterfall has a lane per group, holding its cursors' names and cycles and the distances between neighbors, so that the ruler is left to time.

## Searching

Type a search in the jump box. It takes one term, with no patterns to learn:

| Search | Finds | Lands on |
|---|---|---|
| `csrr`, `sw gp`, `0x80000050` | Objects whose label contains the text, ignoring case; a `0x` number matches the label's numbers by value | The object's first event |
| `instruction.pc=0x80000050` | Objects whose own field has the value | The object's first event |
| `instruction.mark_replay.cause=cache_nack` | Objects with that event, its field having the value | That event |
| `instruction.flush` | Objects with that event, which covers how objects ended | That event |
| `*.pc=…`, `instruction.*.cause=…` | `*` stands for any one type or event | |

Values match whole: numbers by value, so `0x80000050` matches `0x0080000050`; causes and other fixed choices by name; objects as `type#id`. Tab completes the file's own types, fields, events, and the values a field takes when they are few. A name the file does not have gets a message listing the ones it does.

The box counts the matches as you type. Enter goes to the first match after the selection, selecting the object and the cycle, and hands the keys back; `n` and `N` then go on through the matches, down and up the rows, as vim's `n` goes through a buffer. Matching rows are marked at the left of the label column and on the timeline bar. Hidden objects are left out, and the count says how many. Emptying the box ends the search.

## Layout

- `proto/waterfall.proto`: the file format.
- `.github/workflows/pages.yml`: on every push to `main`, runs the tests other than the smoke tests, which need Chipyard's files, builds the page, and publishes it to GitHub Pages.
- `public/example/`: the example the landing page opens, served with the page. Regenerate it from Chipyard's output when the format changes, as `src/example.ts` shows; `test/example.test.ts` checks that it opens and carries the link roles.
- `src/file/`: protobuf decoding of the file.
- `src/model/`: the source interface the drawing code reads rows through, the in-memory source, and text derived for display.
- `src/ui/`: the page and its controller.
- `test/`: tests on small waterfall files built in code (`test/build.ts`), which pin exact values, and smoke tests (`test/files.test.ts`) over every waterfall file under `test/fixtures`, a link to a Chipyard checkout's output that is not kept in the repo:

  ```sh
  ln -s <chipyard>/sims/verilator/output test/fixtures
  ```

  Each file there must decode, hold together as the viewer reads it, and run every feature, drawing included, without breaking. Without the link, one test fails and says how to make it.

## Not yet

- A local server, and a chunked file layout, for files too large to load in the browser.
- Jump queries in the trigger syntax of `+eventtrace_start`, such as `event:instruction.decode,pc=0x80000148`.
- `[` / `]` to the previous or next event of a kind; history of past selections; view state in the URL.
- Collapsing rows under their parent.
- Comparing two traces.
