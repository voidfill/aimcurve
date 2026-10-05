# The Benchmarks pages

One page per benchmark difficulty that answers "where am I on this benchmark,
how consistent am I, and how did I get here?". It is the benchmark sheet people
know (categories, subcategories, scenarios), but every level of the tree,
including the overall, is a row on the same rank axis. Each row shows the
spread of recent runs as a candle and the PB and median as filling pills, and
folds open into its history chart.

The numbers behind the aggregate rows are [ARC](arc.md). The scenario and Run
pages link in through the benchmark picker.

## Routes and navigation

- **`#/benchmarks`**, the index: deliberately minimal, only the way in. Every
  benchmark family in snapshot order with its difficulties as links, one per
  line, and a muted "14/18 played" where anything is. Difficulties without a
  category tree have no sheet and are not listed; a family left with none is
  hidden. A database that cannot open shows a notice.
- **`#/benchmark/:id`**, one difficulty, by its KovaaK's benchmark ID. An unknown
  ID or one without a tree shows a notice with a link to the index. The tab
  title is "<benchmark> <difficulty>".
- **`?open=<row key>`** opens that row's fold instead of the overall's and
  scrolls it into view: the scenario page links to its own row this way.
- **The Benchmarks tab** remembers the last Benchmarks location, as the
  Scenarios tab does. On a difficulty page it leads back to the index instead.

## The difficulty page

### Header

A back link to the index, then a bar that sticks to the top of the page while
scrolling (pure CSS, `position: sticky`; its height is `--bar-h`):

- the benchmark's name, and its difficulties as a segmented control (only those
  with a sheet);
- the **ARC** chip, which opens a short explainer of what ARC is and that it is
  not Voltaic's, Evxl's or any official number;
- the settings: provisional or strict coverage, the run window, and the charts'
  runs / date axis.

Below the bar, scrolling away with the page: the coverage ("provisional · 16/18
scenarios") and a legend for the candle, the ticks, the pills and the fading.

### The sheet

A column legend heads the sheet: one long pill naming the columns ("Benchmark",
each rank's name centred over its lane column, "PB", "Median · last 10"). It
pins under the header bar for the whole sheet, with a blur behind it so rows
passing underneath stay quiet.

Rows follow the tree: the overall, then each category, its subcategories and
their scenarios. There is no indentation and no text marking the level:

- the overall is its own raised block;
- each category is a block, its row the block's tinted header (the category's
  Evxl colour), and each subcategory a faint band inside it;
- the type carries the level: the overall largest, categories bold,
  subcategories semibold, scenarios regular and lighter.

A difficulty with one category has no category row, and an unnamed subcategory
none either (see [ARC](arc.md#up-the-tree-mean-then-shifted-geometric-mean)).
Rows have no hover effect. Below its minimum width the sheet scrolls sideways.

### A row

| Column | Content |
| --- | --- |
| Benchmark | chevron, name, and for a stale scenario its age ("4 mo ago") |
| Lane | the candle on the shared rank axis |
| PB | pill |
| Median | pill: the median of the last `W` runs |

The columns are the shared `.sheet-grid` (`app.css`), so the scenario page's
row lines up the same way.

- **Unplayed:** an empty lane with "not played", and empty pills. In
  provisional mode an aggregate with nothing played looks the same; in strict
  mode it counts the unplayed as 0.
- **Unrated:** "unrated · no ladder on this difficulty".
- **Stale** (last run over 30 days ago): the age after the name, and the candle
  and median pill at half opacity. The PB pill stays at full strength.
  Aggregates are never marked.

### The lane and the candle

The lane is the fractional rank axis from 0 to `n + 1`: `n + 1` equal columns,
Unranked first and the top rank's column holding its overflow. Every row uses
the same axis, so candles compare down the sheet. Each column is a flat tint of
its rank's colour, its opacity tuned by luminance so light and saturated colours
read alike; the strip's ends are slightly rounded.

The candle shows a scenario's last `W` complete runs and its all-time PB:

| Part | Drawn as |
| --- | --- |
| Worst | end cap, and a wick to p10 |
| p10–p90 | rounded body, about 45 % fill with an outline |
| Median | white tick, taller than the body |
| PB | wick from p90, and a dot in the solid colour of the rank it reaches |

The wicks, cap and body are painted with a lane-wide gradient of the rank
colours, so every part takes the colour of the rank under it and a body spanning
ranks shows each. Each lane has its own gradient (a shared one renders wrong in
Chrome). Colours go through `chartColor`, which keeps dark rank colours visible.

Percentiles interpolate linearly (`(len − 1) × p`). With fewer than 5 runs in
the window there is no body: one tick per run in its rank colour, and the PB
dot.

Aggregates aggregate each statistic on its own with the [ARC](arc.md) rules and
the coverage mode. The legend says it is an approximation: a category's p10 is
the aggregate of its scenarios' p10s, not a percentile. The candle never
inverts: the PB is at least the window's best, and mean and `G` keep order.

### The pills

The PB and median pills show the rank name on the left and the progress toward
the next rank on the right ("62%"), filled from the left in the rank colour. At
the top rank they fill and count how far past it ("40%"). Unranked is neutral
grey and fills toward rank 1. The text inverts where the fill passes under it
(two copies, the top one clipped to the fill, in black or white by contrast). A
fixed width lines them up down the sheet.

### The lane's tooltip

Hovering a lane shows a card in the progress charts' style, with the numbers
behind the candle. It sits under the lane (above it near the bottom of the
window), beside the pointer, and flips left near the right edge. Touch shows
none.

- **Scenario:** PB and median as score and rank; p10–p90 and worst when there is
  a body; the next rank above the PB, its score, and the points to it from the
  PB and from the median; when last played; total runs.
- **Aggregate:** the same in arc, and how many of its scenarios are played.
- **Unplayed scenario:** the score each rank needs.
- **Unrated:** none.

### Folds

Clicking anywhere on a row folds its chart open below it; the chevron is the
same toggle for the keyboard, with `aria-expanded`. Several folds may be open.
The overall starts open; which folds are open is not stored, an import keeps
them, and another difficulty starts over.

A scenario's fold leads with its facts (PB, next rank and the points to it, run
count, last played) and what to do next:

- **Play in KovaaK's** (through Steam);
- **Follow in Run**: Run filtered to the scenario, following the latest run;
- **Scenario page →**, with this benchmark preselected (`?bench=`).

An unplayed scenario offers only KovaaK's.

### Charts

Every fold's chart is the existing `ProgressChart`, with zoom and the shared
runs / date axis (`aimcurve.scenario-axis`, switched on either page). Charts
have no title; the row above names them.

- **Scenario:** every complete run of every hash with the name, merged in time
  order; dots in the colour of their rank on *this* difficulty's ladder, the PB
  step line, the form line (median of the last `W`), and this ladder's rank
  bands. The tooltip has the run's score, rank, change from the PB before and
  form. Clicking a dot opens that run in Run.
- **Aggregate:** PB arc and form arc after each run inside the node, over rank
  bands at `100, 200, … n × 100`. The runs axis counts the runs inside the node.
  The tooltip has both values with rank names, how many scenarios were played
  by then, and which scenario the run was.

There are no session breaks on these charts: the run stream does not carry
sessions.

### Live updates

The page watches the data source's `revision`, bumped on every import, and
rereads the runs; rows, pills and open charts update in place. Changing the run
window or the coverage mode recomputes without a query.

## Elsewhere

**The benchmark picker** on the Run and scenario pages chooses which benchmark a
scenario is shown against. It is a select joined to an arrow that opens the
selected difficulty's sheet (left out for none, or a difficulty without a
sheet). Each option names the rank the PB reaches on it.

**The scenario page** shows the scenario's row from the selected benchmark,
exactly as the sheet draws it (the same legend, lane, pills and tooltip, from
the same model). Its name cell says where the scenario sits ("in Clicking ›
Dynamic") and links to the sheet at that row, folded open. It reads only this
scenario's runs. It shows a placeholder while loading, an error with "Try
again", or a note when the scenario is not on that benchmark. A benchmark
without a sheet still gets the row. A link from the sheet preselects its
benchmark (`?bench=`), and switching the scenario's version keeps it.

## Settings

| Setting | Values | Stored as | Used by |
| --- | --- | --- | --- |
| Run window `W` | 5, 10, 20, 50; default 10 | `aimcurve.form-window` | form lines, form arc, the candle and median pill; both pages |
| Coverage | provisional (default), strict | `aimcurve.benchmark-coverage` | the Benchmarks page |
| Chart axis | runs (default), date | `aimcurve.scenario-axis` | both pages' charts |

All are per browser, and changing one on either page changes both.

## Code

- Views: `BenchmarksView.vue` (index), `BenchmarkView.vue` (one difficulty).
- Components: `BenchmarkHeader`, `RunWindowSelect`, `BenchmarkTable`,
  `SheetLegend`, `RowCells`, `CandleLane`, `RankPill`, `TipCard`,
  `ScenarioFold`, `BenchmarkPicker`, `ScenarioBenchmarkRow`.
- `useBenchmarkPage` joins the snapshot tree, the run stream, the history pass
  and the candle statistics into one row model, and builds an open row's chart.
  `useBenchmarkIndex` serves the index; `useBenchmarksRoute` the tab.
- Pure modules in `src/lib/arc/` (see [ARC](arc.md#modules)).

Tests cover the calculations and the row model. How the page looks is checked
by eye, not by tests.

## How the design came about

The concept went through four rounds of mockups, on two canvases: the
[first four concepts](https://claude.ai/artifact/S42g1SjDkSUppFUqAfoexp) and
[everything since](https://claude.ai/artifact/YafTHCCyrnLbkz6swu3g5f). The
sample data was one synthetic year on the real Voltaic S5 Intermediate ladders.

1. **Four page concepts:** an enriched grid (too close to existing trackers), a
   history-first page (history valued, but split from the sheet), a "rank river"
   of weekly cells (hard to read) and then-vs-now dumbbells. None joined the
   classic sheet with improvement over time at every level.
2. **One rank axis for every level.** Fractional rank puts a scenario, a
   subcategory mean, a category's `G` and the overall on the same axis. Rows on
   that axis that fold open into charts were kept; comets and a "wall" view were
   too hard to read.
3. **The row's indicator:** ten variants. The candle won: it shows consistency,
   which no PB tracker does, the reach from p90 to PB shows how repeatable the
   best is, and a horizontal candle keeps rows comparable.
4. **The chart axis:** playtime, session and session-time axes and a warm-up
   profile were discussed; v1 keeps runs and date.

Refinements made while building it:

- one run window instead of separate candle and form windows;
- the tree without indentation or braces: category blocks and type weight;
- no row hover, and no chart titles (the row names them);
- the column legend as a pinned pill, in pure CSS;
- flat rank tints in the lane instead of a hatch;
- the top rank's overshoot as a percent;
- the whole row toggles its fold, and a scenario's fold carries its actions;
- the scenario page shows the scenario's sheet row in place of its PB badge and
  "N to next rank" (the lane's tooltip now carries that gap);
- an "ARC gain" on the Run page was built and dropped;
- "custom energy" became [ARC](arc.md).

## Parked

- Extra details in category folds, such as which scenario holds a category back
  and which carries it.
- A ruler in the lane's tooltip: the score at the pointer and how many recent
  runs reach it.
- A session-time axis with idle gaps collapsed, and session breaks on these
  charts (the run stream would need each run's session).
- A warm-up profile: run number within a session against the gap to pre-session
  form.
- Session candles and session-end dots on aggregate charts.
- Markers for coverage changes and rank-ups.
- Race scenarios as time, as on the scenario page.
- The window's best as a separate upper wick end, with the all-time PB as its
  own dot: a better rust signal than form vs PB.
- Hidden coverage across difficulties, and "which difficulty fits me".
- A fuller index.
