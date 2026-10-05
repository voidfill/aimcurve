# Preview assets: demo data, link card, README screenshots

The About page, the link-preview card and the README screenshots are all drawn
from **real sample runs** bundled with the app, never from a live database.
This is how to refresh them. Design background:
[`specs/2026-09-26-about-and-embeds-design.md`](superpowers/specs/2026-09-26-about-and-embeds-design.md).

## What exists

| asset | made from | made by |
| --- | --- | --- |
| `test/fixtures/demo/` | every completed run of the demo scenarios in `test/fixtures/raw/` | `pnpm gen:demo-fixtures` |
| `src/data/demo-snapshot.json` | the demo fixtures, through the real ingest and queries | `pnpm gen:demo` |
| `public/og.png` | the dev-only `#/dev/card` route | `pnpm shots` |
| `docs/images/{pace,bots,benchmark}.png` | the About page's `[data-shot]` panels | `pnpm shots` |

The demo scenarios are `DEMO_SCENARIOS` in `src/lib/demo/snapshot.ts`:

- **Air Spectral Easy**: About's pace chart and bot table show one of its runs,
  `DEMO_RUN_STEM`, picked because it led its PB-before mid-run and finished
  behind. The About copy reads those numbers from the data.
About's third beat, the benchmark sheet, is one category of one difficulty, `DEMO_BENCHMARK_ID`
and `DEMO_CATEGORY` (Viscose Benchmarks S2 Medium, Reactive Tracking): one
category, because a whole difficulty is too much at once. Its scenarios come
from the benchmark snapshot, every version of each name. Their fixtures are
CSVs only, without `.perf`s: ARC needs nothing but scores, and the perfs would
only grow LFS. The snapshot holds just their scenario rows and history. The
sheet's "now" is the sample's last run, so nothing in it turns stale as the
sample ages.

## Full refresh

After new runs in the author's KovaaK's install, or changing a demo scenario:

1. **Update the raw dump.** Copy the install's `stats/` and `performances/`
   into `test/fixtures/raw/` (gitignored). Add, don't replace: raw keeps files
   the install may have since lost.

   ```sh
   SRC="/c/Program Files (x86)/Steam/steamapps/common/FPSAimTrainer/FPSAimTrainer"
   cp -n "$SRC"/stats/* test/fixtures/raw/stats/
   cp -n "$SRC"/performances/* test/fixtures/raw/performances/
   ```

2. **`pnpm gen:demo-fixtures`** rewrites `test/fixtures/demo/` with the
   completed runs of each demo scenario and their `.perf` files, and the
   completed runs of the benchmark sheet's scenarios as CSVs alone. Resets are
   left out, because the real ingest decides what counts as completed. It runs
   in vitest (the ingest needs Vite), in its own mode; `pnpm test` skips it.

3. **`pnpm gen:demo`** regenerates `src/data/demo-snapshot.json`. `pnpm test`
   fails whenever that file no longer matches what the ingest and queries
   produce from the fixtures, so this step is also needed after changing
   ingest, migrations or queries.

4. **`pnpm test`**. The demo suites derive their counts from the fixtures, so
   more runs need no test edits. Two assertions do pin the story: the
   `useRunCharts` test requires `DEMO_RUN_STEM` to be ahead of its baseline
   mid-run and behind at the end. If a new pick is wanted, change
   `DEMO_RUN_STEM` and its comment.

5. **`pnpm dev`**, then in another terminal **`pnpm shots`**. It drives
   headless Chrome (a throwaway profile, never your data) and writes
   `public/og.png` and `docs/images/*.png`. Look at each image before
   committing. Set `CHROME` if Chrome is not at its usual path, or `BASE_URL`
   for a server elsewhere.

6. Commit the fixtures (Git LFS), the snapshot, and the images together.

## Only the look changed

Skip to step 5. The images are screenshots of the live components, so any
change to the charts or the About layout should be followed by `pnpm shots`.
To change what the card shows, edit `src/views/dev/CardView.vue`, open
`http://localhost:4321/#/dev/card` to iterate, then run `pnpm shots`.

## Guarantees the tests hold

- The snapshot answers every query exactly as the database would
  (`src/lib/demo/snapshot.test.ts`, plus the `useRunAnalysis` and `useScenario`
  parity suites).
- About never reads the database, so its charts never wait for it (the app
  still warms the database in the background for the import), and it writes no
  storage beyond `aimcurve.seen-about` (`src/views/AboutView.test.ts`).
- The CSVs carry the author's settings (sensitivity, DPI, FOV, resolution,
  crosshair). Publishing them is intended.
