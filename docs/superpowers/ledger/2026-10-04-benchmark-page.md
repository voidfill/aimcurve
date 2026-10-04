# Ledger: Benchmarks page (session 2026-10-04)

A handoff for continuing the work. Branch: `feat/benchmark-energy`.

## Where we are

1. **Done:** the custom energy design is written, approved and committed as
   [`docs/superpowers/specs/2026-10-04-custom-energy-design.md`](../specs/2026-10-04-custom-energy-design.md)
   (`7d1b6c9`).
   - It contains the research: what Evxl and KovaaK's provide, Evxl's 45
     `rankCalculation` methods, how vt-energy works, and the positional-join
     check.
   - It contains decisions E1–E9 and the testing list.
2. **In progress:** the page concept. Four mockups are on a canvas:
   <https://claude.ai/artifact/S42g1SjDkSUppFUqAfoexp>. It is private, so share
   it from its Share menu if anyone else needs it. The user has not chosen a
   concept yet.
3. **Not started:**
   - the page spec;
   - any code: snapshot v2, `src/lib/energy/`, the query, the page.

## Next steps

1. The user picks or combines concepts on the canvas.
2. Settle the open questions below that the choice depends on.
3. Write the page spec, `docs/superpowers/specs/YYYY-MM-DD-benchmarks-page-design.md`,
   in the same style as the others: summary table, numbered decisions, testing.
4. After spec approval, go straight to code. Per the user's memory, there is no
   separate implementation-plan document. A natural order:
   1. snapshot v2 (E7) and a regenerated `benchmarks.json`;
   2. the pure `src/lib/energy/` modules and their tests (E2–E5);
   3. the history pass and its bench (E8–E9);
   4. the query;
   5. the page.

## Decisions so far (user-confirmed)

- **No parity with upstream.**
  - Evxl's rules exist only in minified JS with no licence. Reverse engineering
    them is ruled out.
  - Evxl's numbers also differ from voltaic.gg's.
  - We build our own energy, always labelled **"custom energy"**. Breaking with
    convention is fine as long as it says so.
- **Per difficulty, never chained.** VT and Viscose keep their difficulty
  ladders separate, and so do we. Different benchmark families are never
  compared on one axis.
- **Balanced aggregation.** Don't reward one-tricks, and don't punish one weak
  subcategory too hard.
  - Subcategory: mean of its scenarios.
  - Category and overall: shifted geometric mean, `exp(mean(ln(x+1)))−1`.
  - The exact rules may be tuned later. The number is meant to be rough.
- **Coverage.**
  - Provisional is the default: only played scenarios count, and coverage is
    shown.
  - Strict is a toggle: unplayed scenarios count as 0.
  - This addresses the user's gripe about training only tracking in VT and
    getting no rank at all.
- **Form matters as much as PB.**
  - PB energy: best score as of time T.
  - Form energy: median of the last 5 runs as of T.
  - The page should go beyond PB trackers into form and long-term analysis.
- **Compute split.**
  - SQL (PGlite worker) narrows the runs to an ordered `(scenario_id,
    started_at, score)` stream.
  - One JS pass computes everything into columnar arrays.
  - Budget: 100k runs in 16 ms. If it goes over, the pass moves to a dedicated
    compute worker.
- **Page direction:** start with an enriched grid, but the long-term analysis is
  the differentiator ("other tools cannot do this at all").
- **Rejected:**
  - A "coach" page: too much.
  - "Cheapest next energy": arbitrary, because a custom-energy rank-up isn't a
    VT rank-up.

## The four page concepts on the canvas

Every board uses the same deterministic sample year on the real Voltaic S5
Intermediate ladders. The sample player is strong at clicking and weak at
tracking, and a tracking-focus block (days 110–235) makes switching rusty.

1. **B · Enriched grid** (`Main.dc.html`):
   - a classic category/subcategory/scenario grid;
   - PB and form per scenario;
   - an all-runs sparkline with the PB step line;
   - plays and last played; form fades after 30 days;
   - header tiles: PB energy, form energy, coverage, largest PB-to-form gap.
2. **C · History first** (`History.dc.html`):
   - a year-long energy chart with rank bands, PB and form lines, rank-up
     markers and runs per day;
   - the detected focus block shaded;
   - one small chart per category;
   - a "rust" list of subcategory PB-vs-form dumbbells, sorted by gap.
3. **Mix 1 · Rank river** (`River.dc.html`, interactive):
   - each scenario row is a lane of weekly cells (hue = rank, brightness =
     progress within the rank);
   - a date slider scrubs one cursor through the chart and every lane;
   - lanes can be coloured by form or by PB.
4. **Mix 2 · Then vs now** (`ThenNow.dc.html`, interactive):
   - period presets: the detected focus block, the last 90 days, the whole year;
   - "where the time went": share of runs against Δ form per category;
   - subcategory cards with a then-to-now dumbbell per scenario;
   - energy per hour, "plateau", "rusting" or "barely played".

**Claude's recommendation:** the river (3) as the page body, with the grid's
detail on hover or row expand. "Then vs now" (4) as a second tab. Auto-detected
training blocks annotate the river.

**Other ideas raised but not yet placed:**
- session impact (Δ form per session);
- consistency (spread of the last N runs);
- difficulty fit across a family;
- hidden coverage ("you've played 14/18 of Viscose S2 Medium", found from
  history across all 267 difficulties).

## Open questions for the page spec

- How form treats a scenario not played recently: mark it stale (the mockups
  fade it after 30 days), decay it, or count it as is.
- The form window: N = 5 runs, or a time window?
- History resolution: one point per run event (as the spec says) or daily
  samples (as the mockups use)? What do the time-range controls do (3M/6M/1Y/All)?
- Where the benchmark/difficulty picker defaults to. Reuse B4's default and the
  stored pick, or the most-played difficulty?
- How training blocks are detected: the rule for "focus" (share of runs per
  category over a rolling window).
- Whether "hidden coverage" and "difficulty fit" belong on this page or on a
  separate one.
- Routing and navigation: a new `/benchmarks` route, and links from the
  scenario and run views.

## Facts worth not re-deriving

- **Evxl index** (`https://evxl.app/data/benchmarks`):
  - 131 visible benchmarks and 267 difficulties.
  - Per difficulty: categories, then subcategories with names, colours and
    `scenarioCount`, but **no scenario names**.
  - `rankCalculation` is only a label.
- **KovaaK's response:** scenario keys in benchmark order. Its category keys are
  **not** Evxl's (they differ in 224 difficulties, with a different count in
  191). The tree must come from slicing KovaaK's flattened scenario order by
  Evxl's counts.
- **Positional join check:** counts match in 266 of 267 difficulties. The one
  exception is PureG S1 · All, with 14 KovaaK's scenarios against 12 in Evxl;
  it gets `tree: null`. No difficulty repeats a scenario name.
- **Today's `benchmarks.json`** (v1, ~340 KB):
  - It keeps only ladders keyed by scenario name.
  - It drops order, categories and `rankCalculation`.
  - Snapshot v2 (E7) adds a per-difficulty `tree`.
- **The PGlite worker** is the stock `@electric-sql/pglite/worker`, a single
  thread shared with live queries and ingest. Our own compute does not go there.
- **`run_progress.best_so_far` / `pb_before`** already give PB-as-of. Filter
  window views on `scenario_id`.
- **Chart colours,** validated on the dark plot surface `#0e1114`: PB `#3987e5`,
  form `#d95926`. Rank colours come from the benchmark. On dark backgrounds,
  rank badges use dark ink, and bands use 0.08 alpha (as in B7).

## Session scratch (not kept)

The Evxl bundle crawl, the formatted rank chunk and the join-check scripts were
in the session's temporary scratchpad and are gone. To recheck the join, fetch
the Evxl index and each difficulty's KovaaK's
`player-progress-rank-benchmark?benchmarkId=<id>&steamId=00000000000000000`,
then compare the flattened scenario count with the sum of Evxl's
`scenarioCount`s. Keep the 0.5 s spacing from `scripts/gen-benchmarks.ts`.
