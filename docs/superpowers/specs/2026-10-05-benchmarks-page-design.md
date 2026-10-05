# Benchmarks page: one sheet per difficulty, with spread and history

One page per benchmark difficulty that answers "where am I on this benchmark,
how consistent am I, and how did I get here?". It is the benchmark sheet people
know (category, subcategory, scenario rows), but every level of the tree,
including the overall, is a row on the same rank axis. Each row shows the spread
of recent runs as a candle, the PB and the median as filling pills, and folds
open into a chart of its history.

Prerequisites: [custom energy](2026-10-04-custom-energy-design.md) (E1–E9: the
fractional rank, aggregation, coverage, PB and form, snapshot v2, the history
pass), [benchmark ranks](2026-09-25-benchmark-ranks-design.md) (B4 pick, B7
bands), [scenario page](2026-09-25-scenario-page-design.md) (S5 progression
chart, the persisted x-axis).

Out of scope:
- the experimental chart modes in [Parked](#parked-for-later): session-time
  axis, warm-up profile, session candles, markers;
- hidden coverage across difficulties and "which difficulty fits me";
- comparing benchmark families on one axis (E1);
- a coach or recommendations.

## Summary of decisions

| | |
| --- | --- |
| P1 | A minimal index at `#/benchmarks`; one page per difficulty at `#/benchmark/:id` |
| P2 | Layout: header, then one table of rows in tree order, overall first |
| P3 | A row is name, candle lane, PB pill and median pill |
| P4 | Every row shares one rank axis from Unranked to the top rank's overflow |
| P5 | The candle is worst, p10–p90, median and PB, from the last `W` runs (default 20) and the all-time PB |
| P6 | Each part of the candle takes the colour of the rank it reaches |
| P7 | The lane background is a per-rank pattern in the rank's colour |
| P8 | PB and median are pills that fill toward the next rank |
| P9 | Any row folds open into its history chart; the overall starts open |
| P10 | Charts use the scenario page's date / runs toggle, shared and persisted |
| P11 | Scenario charts merge every hash of the name; aggregate charts plot custom energy |
| P12 | Pure modules in `src/lib/energy/`, one composable, components per part |

---

### P1. An index at `#/benchmarks`, one page per difficulty at `#/benchmark/:id`

The routes mirror Scenarios (`/scenarios`, `/scenario/:hash`).

- **Nav:** a Benchmarks tab in the header opens the index. On a difficulty page,
  the tab stays active.
- **Index (`#/benchmarks`):** deliberately minimal, only an access point. A
  proper concept for it comes later.
  - It lists the benchmark families in snapshot order. Each family has a heading
    and its difficulties as links, one per line.
  - A difficulty with any played scenario adds muted "14/18 played" after its
    link. The count comes from the current-state query (E8).
  - A difficulty with `tree: null` (E7) is listed without a link, with the
    reason in muted text.
  - It has no search, sorting, energies or charts.
- **Difficulty page (`#/benchmark/:id`):** `:id` is the difficulty's
  `kovaaksBenchmarkId`.
  - The header has a back link to the index and the family's difficulties as a
    segmented control, which switches between those difficulties' routes.
  - An unknown `:id`, or one whose tree is null, shows a notice in the style of
    the scenario page's missing-scenario notice, with a link to the index.
  - The page title in the tab is "<benchmark> <difficulty>".

### P2. Layout: header, then one table

**Header:**
- benchmark name, difficulty control, the "Custom energy" chip (E1);
- coverage, for example "provisional · 14/18 scenarios" (E4);
- the provisional / strict toggle (E4), persisted per browser;
- the run window for the candle and the median (P5): a select with 10, 20 and
  50, stored in `useStorage('aimcurve.benchmark-window', 20, localStorage)`;
- a legend for the candle and the pills.

**Table:** one row per tree node in tree order: overall, then each category,
its subcategories and their scenarios. Indentation and weight mark the level:
the overall is largest on a raised background, categories are bold with a rule
above, subcategories are indented, and scenarios are indented further in a
lighter colour. A column header labels the rank columns over the lane (P4).

The table sits in a horizontally scrolling box below its minimum width, so the
page works at phone width without squeezing the lane.

### P3. A row is name, candle lane, PB pill and median pill

| Column | Content |
| --- | --- |
| Name | node name, which folds the row's chart open (P9); scenario rows add an icon link to their scenario page (P11) |
| Lane | the candle on the shared rank axis (P4–P7) |
| PB | pill (P8) |
| Median | pill (P8): the median of the last `W` runs |

There is no separate energy number column. The pill's text carries rank and
progress, and the exact custom energy is in the tooltip and the folded-open
chart.

**Unplayed:** a scenario with no complete run has an empty lane, "not played"
in muted text, and empty pills ("—"). In provisional mode, an aggregate whose
children are all unplayed shows the same. In strict mode, aggregates count
unplayed scenarios as 0 (E4) for every statistic.

**Unrated** slots (E2) show "unrated" and are excluded, as in E4.

### P4. Every row shares one rank axis, Unranked to overflow

For a difficulty with `n` ranks, the lane spans fractional rank `r ∈ [0, n+1]`
(E2):
- `[0, 1)` is Unranked, the extended step below rank 1;
- `[i, i+1)` is rank `i`;
- `[n, n+1]` is the top rank and its overflow.

Each step gets equal width, so the axis has `n + 1` columns. Unranked is always
shown: on Voltaic the step below rank 1 is wide in score, and players there need
to see progress toward their first rank.

Every row uses the same axis, so candles compare by eye down the table.

### P5. The candle: worst, p10–p90, median and PB

Per scenario, from its complete runs (E6):
- **Window:** the `W` most recent complete runs, or all of them while there are
  fewer. `W` is the header's setting (P2), 20 by default.
- **Statistics:** worst (minimum), p10, median (p50) and p90 of the window's
  scores, and the all-time PB.
- **Percentiles:** linear interpolation between closest ranks (the common
  default, `(len − 1) × p`).
- **Units:** each score goes through `fractionalRank` (E2). The function is
  monotone, so it does not matter whether percentiles are taken before or after.

**Sparse data:**
- With fewer than 5 runs in the window there is no body. The lane shows each run
  as a short tick in its rank colour, plus the PB dot.
- With one run, the PB dot only.

**Aggregates:** each statistic is aggregated separately through the tree with
the E3 rules (mean for subcategories, `G` above) and the page's coverage mode
(E4). The result is labelled in the legend as an approximation: the p10 of a
category is the aggregate of its scenarios' p10s, not a percentile of anything.

The median pill and the candle use this `W`-run window. The form line in the
charts (P11) is E6 form. They are different quantities with different names.

### P6. Each part of the candle takes the colour of the rank it reaches

| Part | Drawn as | Colour |
| --- | --- | --- |
| Lower wick | line from worst to p10, with an end cap at worst | rank of worst |
| Body | rounded box from p10 to p90, about 45 % fill and a 1.5 px outline | rank of the median |
| Median | white tick, taller than the body | white |
| Upper wick | line from p90 to PB | rank of PB |
| PB | dot with a dark outline | rank of PB |

Unranked uses the neutral `#8b9299`. Rank colours come from the benchmark, as
everywhere (B7).

### P7. The lane background is a per-rank pattern

Each rank column is filled with a fine pattern in that rank's colour, and the
Unranked column with the same pattern in neutral grey. Two candidates were
liked in the experiments (board 10, T3 and T8) and the final pick is made in
implementation, against real data in both light and busy rows:
- **Hatch:** 45° lines, about 1.6 px every 6 px, at 30–45 % opacity;
- **Dot screen:** about 0.9 px dots every 5 px, at 50–70 % opacity.

The opacity is tuned per rank colour so light colours (Diamond, Jade) and
saturated ones (Master) read equally strong. The previous flat tint at 7 % was
too dark and low in contrast.

### P8. PB and median are pills that fill toward the next rank

Each pill:
- has the rank colour as a faint background (about 14 %) and outline (about
  45 %);
- fills from the left by the progress within the rank (E5), in the rank colour;
- shows the rank name on the left and progress on the right ("62%");
- at the top rank, fills with the overflow `r − n` and shows "+29";
- for Unranked, is neutral grey and fills toward rank 1;
- inverts its text to dark ink where the fill passes under it (two layered
  copies of the text, the top one clipped to the fill).

The pill has a fixed width, so pills line up down the table.

### P9. Any row folds open into its history chart

- Clicking a row's name or its chevron toggles a chart below that row.
- Several charts may be open at once, to compare.
- The overall chart is open when the page loads. Which charts are open is not
  persisted.
- The chevron is a real button with `aria-expanded` and a label ("Show Tracking
  history").

### P10. Charts use the scenario page's date / runs toggle

The x-axis toggle is the scenario page's (S5): the same `attempt | date`
control and the same stored value, `aimcurve.scenario-axis`. Switching on either
page switches both. Attempt stays the default.

- **Date:** each point at its run's `started_at`.
- **Runs:** for a scenario, its completed attempt number, as on the scenario
  page. For an aggregate, the number of complete runs inside that node: the
  Tracking chart counts Tracking runs, and the overall chart counts every run in
  the difficulty.

Zoom and pan come from `useChartZoom`, as on the scenario page. Switching the
axis resets the zoom.

### P11. Scenario charts merge every hash; aggregate charts plot custom energy

**Scenario charts** reuse the scenario page's progression chart (S5): runs as
dots, the PB step and the rolling median, with the rank bands of **this**
difficulty (not the stored B4 pick).
- Energy matches scenarios by trimmed name (E8), so the chart shows the runs of
  every scenario hash with that name, merged in time order.
- The row's icon link opens the scenario page of the hash with the most runs.

**Aggregate charts** (subcategory, category, overall) plot custom energy on y:
- the PB energy as a step line (`#f0b23f`, as the scenario chart's PB);
- the E6 form energy as a line (`#e8ebee`, as the scenario chart's median);
- rank bands and threshold labels from E5;
- no dots in v1. One point per run event comes from the history pass (E8).

The chart header names the level's rule: "mean of its scenarios", or "shifted
geometric mean of its subcategories / categories".

### P12. Pure modules, one composable, components per part

New pure modules in `src/lib/energy/`, next to E9's:
- `spread.ts`: the window and its statistics for one scenario (P5), and their
  aggregation through a tree with a coverage mode;
- `axis.ts`: the lane domain and column layout for `n` ranks (P4);
- `pill.ts`: `r` → pill text, fill fraction and colours (P8).

The composable `useBenchmarkPage` joins the snapshot tree, the E8 run stream,
the history pass and the spread statistics into one row model per node, plus
the chart series for open rows.

Components:
- `BenchmarkHeader.vue`
- `BenchmarkTable.vue`
- `CandleLane.vue`
- `RankPill.vue`
- `EnergyChart.vue`, the aggregate chart. Scenario rows mount the existing
  progression chart.

The spread statistics come from the same ordered run stream as the history pass
(E8): the end state of each scenario's last `W` scores. No new query is needed.
Changing `W` reruns only this step.

**Live updates:** the page is reactive. When runs are ingested (a manual import
or the watched folder), the existing change notification reruns the query, the
history pass and the spread step (E8). Rows, pills and open charts then update
in place, with no reload and no lost fold state.

## Testing

- `spread`:
  - window of exactly `W`, of fewer, of 1, for `W` = 10, 20 and 50;
  - percentiles against hand-computed values, including interpolation;
  - worst ≤ p10 ≤ median ≤ p90 ≤ PB;
  - fewer than 5 runs → no body;
  - aggregation per statistic in provisional and strict modes, equal at full
    coverage;
  - several scenario ids sharing one trimmed name count as one scenario.
- `axis`: `n + 1` equal columns; Unranked first; overflow inside the top column;
  values clamp to `[0, n+1]`.
- `pill`:
  - mid-rank;
  - exactly on a threshold;
  - Unranked;
  - top rank with overflow;
  - overflow at the cap.
- Index:
  - families and difficulties in snapshot order;
  - "n/m played" only where something is played;
  - a `tree: null` difficulty is listed without a link.
- Difficulty route:
  - an unknown or `tree: null` id shows the notice;
  - the segmented control lists only that family's difficulties.
- The window setting: changing it updates the candle and median, not PB.
- Live update: a newly ingested run updates its row and the aggregates above it,
  and open charts stay open.
- Row model:
  - tree order and levels;
  - unplayed and unrated rows;
  - provisional coverage text.
- Charts:
  - runs-axis counts per node;
  - date axis uses `started_at`;
  - the axis toggle is shared with the scenario page.

## How we got here

The concept went through four rounds of mockups. They are all on two canvases:
the [first four concepts](https://claude.ai/artifact/S42g1SjDkSUppFUqAfoexp) and
[everything since](https://claude.ai/artifact/YafTHCCyrnLbkz6swu3g5f).

### Round 1: four page concepts (2026-10-04)

Sample data for all rounds: one deterministic year on the real Voltaic S5
Intermediate ladders. The sample player is strong at clicking and weak at
tracking, and a tracking-focus block (days 110–235) makes switching rusty.

| Concept | Idea | Outcome |
| --- | --- | --- |
| B · Enriched grid | classic grid, PB and form per scenario, sparklines, header tiles | too close to existing trackers |
| C · History first | year-long energy chart, focus block shaded, PB-vs-form "rust" list | history was valued, but it was split off from the sheet |
| Mix 1 · Rank river | weekly cells per scenario, hue = rank, brightness = progress | "GitHub-like" but low value: brightness levels are hard to tell apart |
| Mix 2 · Then vs now | period presets, runs share vs Δ form, then-to-now dumbbells | not chosen |

None of them joined the classic display with improvement over time at every
level. That became the brief for round 2.

### Round 2: one rank axis for every level (2026-10-05)

The key insight was that fractional rank (E2) puts a scenario, a subcategory
mean, a category's `G` and the overall on the same axis.

| Concept | Idea | Outcome |
| --- | --- | --- |
| A · The Ladder | sheet rows on a rank axis; a comet per row (PB head, form ring, weekly trail dots); play button | rejected: really hard to read |
| B · Wall and Trail | scenario columns with subcategory and category ledges, a time chart sharing the y-axis | rejected along with A |
| C · Rank rows + fold-open charts | one PB bar and one form bar per row; any row folds open into a chart like the scenario page's | **kept**: the right direction, but the bars and plain badges were weak |

### Round 3: the progress indicator

Ten variants of what a row shows, all on the same rows:
1. colour ramp track;
2. rising ticks;
3. next-rank lens;
4. filling badges;
5. rank rings;
6. filling gems;
7. rank staircase;
8. run-spread candle (p25–p90, median, amber PB);
9. balanced candle (worst, p10–p90, median, PB, all rank-coloured);
10. board 9 plus PB and median pills and nine lane backgrounds.

**Chosen:** board 10's candle and pills (P5–P8), with hatch or dots as the lane
background (P7).

Why the candle won:
- it shows consistency, which no PB tracker shows;
- the reach from p90 to PB shows how repeatable the best is;
- a horizontal candle keeps every row on one axis, so rows compare.

Changes along the way:
- the body widened from p25 to p10 so the candle is balanced against a worst
  wick;
- amber PB was dropped for rank colours;
- the lane was extended into Unranked (P4).

### Round 4: the chart axis

Ideas discussed:
- a **playtime** axis: within a benchmark it is nearly the same as attempts, since
  scenarios are about 60 s;
- a **session** axis;
- a **session-time** axis with idle gaps cut out and semantic zoom;
- a **warm-up profile**.

The question behind them was real: on a plain date axis a session squashes into
a sliver, so "did I start bad and get better?" is unreadable. For v1 we keep the
basics, date with a switch to runs (P10), and park the rest.

### Decisions carried over from the energy work

- No parity with Evxl or voltaic.gg; always "custom energy" (E1).
- Per difficulty, never chained (E1).
- Balanced aggregation (E3); provisional by default, strict as a toggle (E4).
- Form matters as much as PB (E6).
- SQL narrows, JS computes, and the budget is 16 ms for 100k runs (E8, E9).
- Rejected: a "coach" page; "cheapest next energy" (a custom-energy rank-up is
  not a VT rank-up).

## Parked for later

- **Session-time axis:** real time inside a session, idle gaps collapsed to a
  labelled spacer ("3 d"). Semantic zoom: zoomed out, one slope tick per
  session (first runs to last, rank-coloured); zoomed in, run dots.
- **Dated session breaks** on the runs axis: about 80 % of the session-time
  axis for little work.
- **Warm-up profile:** run number within a session against each run's gap to
  its scenario's pre-session form, as a median across sessions with a band.
  Measuring against each scenario's own form also makes it meaningful for
  aggregates.
- **Session-end dots** on aggregate charts, coloured by rank.
- **Session candles** on aggregate charts. Note the bias: a mixed-scenario
  candle reflects which scenarios were played.
- **Markers:** coverage changes ("+ Aether, 14/18") and rank-ups.
- **Recent best vs all-time PB:** an upper wick ending at the window's best, with
  the all-time PB as a separate dot. The gap between them is a better rust
  signal than form vs PB.
- **Hidden coverage and difficulty fit**, probably on their own page.

## Open questions

- **Stale data** (not refresh, which P12 covers): a scenario last played months
  ago still shows its last `W` runs as if they were current. The options are:
  - mark it: a muted "4 mo ago" in the row and the candle drawn fainter;
  - decay it;
  - leave it as is.

  The proposal is to mark it in v1, after 30 days, and not decay.
- **E6 form window:** E6 form uses the last 5 runs, the scenario page's typical
  line the last 10, and the candle `W` (20). Should E6 move to 10, to match the
  scenario page, or follow `W`?
- **Lane pattern:** hatch or dots (P7).

## Facts worth not re-deriving

- The Evxl index and KovaaK's join facts are in the energy spec's research.
- The PGlite worker is the stock `@electric-sql/pglite/worker`. It is a single
  thread shared with live queries and ingest, so our own compute does not go
  there (E8).
- `run_progress.best_so_far` and `pb_before` already give PB-as-of.
- Chart colours on the dark plot surface `#0e1114`:
  - the scenario chart's PB is `#f0b23f` and its median `#e8ebee`;
  - rank colours come from the benchmark;
  - rank badges on dark backgrounds use dark ink.
