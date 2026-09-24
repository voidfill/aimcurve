# Run view: result, unified chart, bot breakdown

The Run page as built on the [scoring model](2026-09-24-scoring-model-design.md):
one inspected run, its comparison against a chosen baseline, the unified pace
chart and the bot breakdown, beside the existing attempt rail.

Prerequisites: [product and page design](2026-09-20-product-and-page-design.md)
("Main page: Run"), [scoring model](2026-09-24-scoring-model-design.md) (D4 x/u,
D5 pace and readout, D8 bots), [run schema](2026-09-18-run-schema-design.md).

Visual reference: the claude.ai design project *aimcurve*
(`e2f62fab-f374-421c-b322-0370c08bae61`). The layout follows `Aimcurve Run A`,
the chart follows `Aimcurve Unified`, and the bot table follows
`Aimcurve Run B`. Those files are mock-ups with synthetic data. The written
requirements here take precedence over them.

Out of scope: rank bands and next-rank progress (need benchmark definitions),
per-row deltas and a race tag in the attempt rail, comparison filtering by
sensitivity, a settings page for chart defaults, Sessions and Scenarios.

## Summary of decisions

| | |
| --- | --- |
| R1 | Layout is Run A without the reading line, the cumulative chart and the rank bar |
| R2 | One selectable baseline for every view; default PB before this run, flat when it has no curve |
| R3 | The chart is uPlot on one shared x grid |
| R4 | Chart layers and smoothing are toggles persisted per browser |
| R5 | Bots along the chart are plain dashed boundaries with text labels |
| R6 | The bot table is per kill slot for races and per bot for clock runs |
| R7 | The exact comparison lives in the header, the tooltip and the chart footer |
| R8 | Pure functions for baseline choice and bot rows; one composable joins them |

---

### R1. Layout is Run A without the reading line, the cumulative chart and the rank bar

The main column beside the existing 320–340 px rail contains, top to bottom:

1. **Result header.** Scenario name, then a mono meta line: start time, duration,
   sensitivity. On the right, three blocks separated by rules, as in Run A:
   - *compared with*: the baseline's label in amber and its result, with a
     sub-line saying which run it is (date and time);
   - the signed delta vs the baseline, large, as a percentage with an arrow, and
     below it the absolute difference with its unit and "ahead of / behind
     <label>";
   - the result: score, or the completion time for a race (`B − score` seconds).

   Percentage is `Δ / |baseline result|`, where Δ is in the result's own unit:
   points for clock, seconds for race. Direction is uniform: positive is better.
   Color is never the only carrier: the arrow and the sign carry direction too.
2. **Stats strip.** One cell per statistic this run actually recorded, picked from:
   accuracy, hits / shots, kills, average TTK, damage efficiency, damage taken,
   overshots, average FPS. A statistic that is null for this run has no cell.
3. **Unified chart** (R3–R5, R7).
4. **Bot table** (R6). It takes the remaining height and scrolls.

The application bar gains Run A's selection pill on the right, replacing the
inline note in `RunView`: *following live* (green, pulsing dot) while following,
or *inspecting <time> · paused* (amber) with a **return to live** button
while inspecting, prefixed "new run ·" once a newer attempt has been imported.
The rail only knows *whether* one is newer, not how many, so no count is shown. The pill describes selection state only; the data connection
status stays where it is. The rail keeps its behaviour and is restyled only.

Run A's palette (`#0b0d0f` background, `#101316` panels, `#22272c` rules,
`#e8ebee` ink, `#737a81` muted, `#43d492` ahead, `#ff6f61` behind, `#f0b23f`
baseline, `#5f9bd6` highlight) replaces the tokens in `src/styles/app.css`, so the
Data page follows. Mono type is used for all figures, labels and axis text.

Narrow screens keep the current behaviour: below 800 px the rail follows the
main column, and the bot table scrolls horizontally.

### R2. The baseline is selectable; the default is the PB before this run

A dropdown in the chart header offers four baselines. The choice is persisted per
browser, not per run.

Two sets of runs are involved. **Same-scenario runs** are the completed runs with
the inspected run's scenario hash, with or without a `.perf`. **Candidates** are
the same-scenario runs that have a curve and are `comparable()` with the
inspected run (scoring D4).

| option | chosen run | label |
| --- | --- | --- |
| PB before this run (default) | highest score among same-scenario runs that started before the inspected run | `PB before` |
| All-time PB | highest score among all same-scenario runs, the inspected run excluded | `PB` |
| Best charted before this run | highest score among candidates that started before the inspected run | `best charted` |
| Previous run | the most recent candidate that started before the inspected run | `previous` |

Ties on score go to the earlier run.

**A baseline is either charted or flat.** The two PB options choose by CSV score
alone, so the chosen run may have no curve.

- **Charted:** the chosen run is a candidate. It is compared at equal `x` as
  usual.
- **Flat:** the chosen run has no `.perf`, or has one that is not comparable.
  Only its score is used: a horizontal line at the PB score on the projected-score
  axis. That line is the pace that ties the PB if held evenly. The run's
  accumulated pace ends above the line exactly when it beat the PB. The page
  never suggests the PB's shape. Its label adds "· no curve" (for example
  `PB before · no curve`), and R3, R6 and R7 say what each view does with it.
  Same-scenario runs are assumed to share the scenario's length. A flat
  baseline without a curve cannot be checked with `comparable()`.

Best charted and Previous only choose among candidates, so they are always
charted. Best charted is the option to use when a flat PB is not wanted.

**One baseline for the whole page.** The header, the chart lines and shading, the
tooltip, the footer and the bot table all show the one selected baseline.
Switching the option updates every view together. Only the race *best* split
column (R6) is independent, because it is a best over all candidates by
definition and is labelled that way.

**No baseline.** When no run qualifies — first attempt, nothing comparable for the
two charted options, or the inspected run is itself the all-time PB — the
*compared with* block and the delta say so in words ("first run", "no comparable
charted run", "this is the PB"), the chart draws this run only, and baseline
layers are disabled rather than empty.

Runs without a `.perf` can still be inspected: header and stats render, and the
chart and bot table are replaced by the existing "no performance detail"
explanation. An `unsupported` run shows the chart area with its reason in words.

### R3. The chart is uPlot on one shared x grid

New dependency: `uplot`. A thin `UnifiedChart.vue` owns one `uPlot` instance,
sizes it with a `ResizeObserver` (`useResizeObserver`), and calls `setData` /
`setSeries` on changes instead of recreating it. No wrapper package.

uPlot needs one shared x array. The grid is the union of the inspected run's
and the baseline's `x` values, sorted and deduplicated. Every series is
evaluated on that grid by linear interpolation between its own points. A gap in
a source series (NaN from scoring D5) stays a gap: a grid point that falls
inside or next to a source gap is `null`, and series use `spanGaps: false`.
Recent-range series are evaluated on the same grid. A flat baseline (R2)
adds no grid points: it is a constant series at the PB score.

Axes:

- **x.** Clock: elapsed seconds, `x · T`, labelled "elapsed". Race: challenge
  progress, `x` as a percentage, labelled "progress". The label says which;
  they are never presented as interchangeable.
- **y.** Projected final score. Race ticks show seconds (`B − y`). Both kinds use
  the same scale for every series; nothing is stretched to fit.

Series and styling, from Unified:

| series | style | default |
| --- | --- | --- |
| this run, accumulated | white, 2.8 px, solid | on |
| this run, local | `#cfd6dd`, 1.1 px, solid | on |
| baseline, accumulated | amber, 2.6 px, dash 7/5 | on when a baseline exists |
| baseline, local | amber, 1.1 px, dash 4/3.5 | off; disabled with the reason when the baseline is flat |
| flat baseline | amber, 2 px, dotted 2/4, labelled at its right end "PB <score> · no curve" | replaces the baseline's accumulated line when it is flat |
| accumulated gap | green where this run is ahead, red where behind, low alpha; against a flat baseline it means above or below PB pace | on with both accumulated lines |
| recent range | mean ± 1σ of accumulated pace, grey fill and a faint mean line | off |

The gap fill cannot be a uPlot band, because its color depends on the sign. It
is painted in a `drawSeries`/`draw` hook between the two accumulated lines,
split at each crossing. Bot boundaries, labels and highlights (R5) are painted
in the same hook, under the lines.

**Tooltip.** uPlot's cursor drives a Vue-rendered overlay positioned from
`setCursor`, flipped to the left of the crosshair near the right edge. Rows:
time or progress and the bot at that point; local and accumulated pace for this
run and the baseline (a flat baseline shows its PB score once, marked "no
curve"); the cumulative difference vs the baseline (R7). Dots mark each visible
line at the cursor.

**Keyboard.** The chart is focusable. Left and right move the cursor one grid
point, Home and End jump to the ends, Escape clears. This calls
`u.setCursor(...)`, so pointer and keyboard show the same tooltip.

**Recent range.** Up to ten candidates that started before the inspected run,
most recent first, through `recentRange()` (scoring D5). With fewer than ten, the
toggle's label shows the count ("recent · 4"). With one, only the mean line is
drawn, with no band. With none, the toggle is disabled.

### R4. Chart layers and smoothing are toggles persisted per browser

The chart header, left to right: title ("Pace over elapsed time" or "Pace over
progress"), the axis note, then Unified's toggle chips — *local*, *accumulated*,
*baseline*, *recent* — each showing its line style, then the baseline dropdown
(R2), then Run A's smoothing segment: *raw* (1 s) / *3 s* / *5 s*, the local-pace
window `w`. Default 5 s.

Toggles, baseline option and smoothing are stored with `useStorage` under one
key. Turning a line off also removes what depends on it: the gap needs both
accumulated lines, and the baseline's local line needs both *local* and
*baseline*. Smoothing changes only local pace. Accumulated pace always comes
from `u` (scoring D5).

### R5. Bots along the chart are plain dashed boundaries with text labels

As in Run A, not Unified's chip strip or Run B's lane ribbon: each encounter
boundary is a 1 px dashed vertical line, and the bot's name is plain mono text
near the top at the start of its encounter. Encounter spans come from scoring
D8: race `[(k−1)/N, k/N]`, clock `[t_{k−1}/T, t_k/T]` starting at 0.

Density rules, so click scenarios with a hundred kills stay readable:

- a label is drawn only if its span is wider than the label plus padding;
- boundaries are drawn only when the median encounter is at least 12 px wide.

Otherwise the chart shows no bot marks at rest. Highlighting still works.

Hovering a bot row in the table highlights all of that bot's encounters — a
blue tint with edge lines — and dims the rest of the plot (Run B). Clicking a row
pins the highlight, clicking it again unpins. The tooltip's bot name uses the
same data. Runs without kills have no bot marks.

### R6. The bot table is per kill slot for races and per bot for clock runs

Run B's table: a swatch per bot, mono figures, the largest loss's Δ in bold. Colors
come from Run B's six-tint palette, assigned in sorted bot-name order so a bot
keeps its color across runs of a scenario, and the same swatch appears before
the bot's chart label. (`run_perf.added_bots` holds `.bot` file names, which do
not match the kill table's bot names, so it cannot order them.)

**Race** — one row per kill slot `k`, in order. The bot is the one killed at `k`.

| column | value |
| --- | --- |
| this run | seconds spent on slot `k`: `u(k/N) − u((k−1)/N)` |
| baseline | the same for the baseline run |
| Δ | baseline − this run; positive means faster |
| best | fastest split for slot `k` over all candidates and this run |
| Δ best | best − this run |

Splits include the slot's share of respawn gap (scoring D8), which the table
sub-heading states. The header sub-line gives totals: this run, baseline, Δ.

**Clock with kills** — one row per bot, ordered by first appearance.

| column | value |
| --- | --- |
| time | seconds in this bot's encounters |
| enc. | encounter count |
| hits / shots | summed from the kill rows |
| acc | hits / shots; "—" when there were no shots |
| points | Δu summed over this bot's encounters |
| Δ | points − the baseline's points on the same bot |

A muted final row, *after last kill*, holds the time and points after the last
kill up to `T`, with no Δ. Δ compares totals per bot, and so it also
reflects time spent. The sub-heading says "points gained while engaged" and the
page makes no causal claim.

**Clock without kills** — no table. One line: "No kills were recorded, so this
run has no bot encounters." It is a normal case.

**Flat baseline.** The baseline and Δ columns show "—", and the sub-heading says
"<label> has no per-bot detail". The PB is never spread evenly across bots or
slots. The race *best* column is unaffected (R2).

The race *best* column needs kill times for every candidate. It is loaded by a
separate query when the run is a race, and race scenarios are small (at most a
few hundred runs).

### R7. The exact comparison lives in the header, the tooltip and the chart footer

The product spec's standalone cumulative-difference chart is dropped. Its
precision requirement is met without it:

- **At rest.** The header delta, and the chart footer: "final accumulated
  <value> vs <baseline label> <value> · <±Δ> <unit>", colored and signed. Both use
  the CSV scores (scoring D5 endpoint).
- **On inspection.** The tooltip row "vs <label>", from `readout(current,
  baseline, x)` at the cursor's `x`, labelled with that point so it is not
  mistaken for the final result.
- **Flat baseline on inspection.** The row reads "vs <label> at even pace". It is
  the difference from the PB spread evenly over progress: clock
  `S_cur(x) − PB · x` points, race `PB_time · x − t_cur(x)` seconds. It is not where
  the PB actually stood, and the label says so. At `x = 1` it equals the header
  delta.

The shaded gap is a pace difference, and no number is read off it.

### R8. Pure functions for baseline choice and bot rows; one composable joins them

```
src/lib/run/queries.ts      + listScenarioRuns(hash): id, stem, score, started_at, has_perf
                            + getKillDetail(ids): per-kill bot name, hits, shots, in the
                              same order as getScoringInputs' kill offsets
                            + stats columns on Attempt
src/lib/run/baseline.ts     R2: choose(option, inspected, runs, curves)
                              → { charted run } | { flat score } | { none, reason }
                              + flatReadout(current, score, x) for R7
src/lib/run/bots.ts         R6: botRows(curve, kills, baseline?) and raceRows(...)
src/lib/run/chart-data.ts   R3: shared grid, interpolation, gaps → uPlot AlignedData
src/composables/useRunAnalysis.ts
                            selected attempt → curves, baseline, recent range, rows;
                            re-runs on baseline option or smoothing change
src/components/RunDetail.vue   one run: header, stats, chart, table, one baseline
src/components/RunHeader.vue, StatsStrip.vue, ChartControls.vue, UnifiedChart.vue
                (tooltip included), BotTable.vue, SelectionPill.vue
```

Loading for one selection: `listScenarioRuns` (metadata only), which already
settles which runs the two PB options choose, since they go by score alone. Then
`getScoringInputs` for the inspected run, the chosen runs of all four options and
up to ten recent candidates, so switching the baseline option does not refetch.
Curves come from the existing memoised `curveFor`. Comparability needs curves, so
for the other options the scenario's perf-backed runs are walked and their inputs
fetched in batches of 20 until each answer is settled: by score descending for
*best charted* (the first comparable run wins), and by start time descending from
the inspected run for *previous* and the recent set. A PB with a `.perf` has its
input fetched too, to decide between charted and flat. A scenario whose runs are all
comparable settles in one batch.

Loading states follow `RunView`'s existing pattern: header and stats render from
the `Attempt` straight away, and the chart and table show a quiet "Loading
detail…" until the analysis settles. A failure shows the error with a retry,
without disturbing the header.

## Testing

- **`baseline.ts`**: each option on a hand-built run list; ties; inspected run
  first, last and PB; a PB without a `.perf` and a PB with an incomparable one
  both come back flat; *best charted* and *previous* skip runs without a curve
  and incomparable runs; no candidates; the flat readout equals the header delta at
  `x = 1` and is zero at `x = 0`.
- **`bots.ts`**: race splits sum to the run's elapsed time and match
  `uAtX(k/N)` differences; clock per-bot points plus the after-last-kill row sum
  to the final score; repeated encounters aggregate; no-kill runs yield no
  rows; the baseline Δ matches per bot; curated fixtures for one race and one
  clock-with-kills run.
- **`chart-data.ts`**: the grid is the sorted union; interpolation is exact at
  source points; a source gap stays `null`; race y values convert to seconds.
- Not unit-tested: uPlot rendering and hooks. They are checked by running the
  page in the browser on a race, a clock-with-kills, a no-kill tracking run and a
  CSV-only run.
