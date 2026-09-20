# aimcurve: product, pages, and live analysis layout

Status: draft for user review. This is a product and interaction specification,
not an implementation plan. Confirmed direction is distinguished from proposed
details below; writing this document does not approve implementation.

## Purpose and implementation scope

aimcurve is a browser-based Kovaak's analysis tool for use between challenge
attempts, often on a second monitor. Its primary question is: **where did this
run gain or lose performance, and what can I improve toward the next rank?**

Examples include accuracy dropping around 40 seconds and worse performance
against a particular bot. Rank and long-term score progression provide context;
the main differentiator is analysis within individual runs.

The product runs in the browser without installation. Build the pages,
components, and interactions from the requirements in this document and the
current repository's data interfaces. This is new UI implementation, not a
migration or refactoring task. Historical application code is outside the
implementation scope and should not be consulted or ported for the UI.

The user will separately provide scenario-specific score conversion logic.
Integrate it through an explicit conversion interface; do not reconstruct those
formulas from historical application code.

Reference material:

- User-provided `Downloads/unified.png`: unified-chart design exploration.
- Existing [run schema](2026-09-18-run-schema-design.md) and
  [ingest design](2026-09-19-ingest-design.md).

The chart screenshot is an external visual reference, not a committed repository
asset or an implementation dependency. Written requirements take precedence.

## Agreed direction

- Live run analysis is the default destination.
- Use a dense, readable analysis layout with a main chart, bot breakdown, and
  right-hand attempt history; visual styling may evolve.
- Use one main graph with rank-colored backgrounds, local performance, and
  accumulated-average performance on a shared meaningful scale.
- Scenario-specific conversions normalize scoring, including races, through
  conversion logic supplied separately by the user.
- Support optional PB and recent-run comparisons with layer toggles.
- Keep bot breakdowns and connect them to intervals in the graph.
- Data import and storage happen in the browser under the current architecture.

The full page inventory and the exact default layer visibility below are
proposals synthesized from the discussion, pending review.

## Page inventory and navigation

Primary navigation: **Run / Sessions / Scenarios / Benchmarks**. Data and settings
are accessible through a persistent connection/status control. Benchmarks is a
secondary milestone; the initial core navigation can omit it until implemented.

| Destination | Purpose | Main contents and actions |
| --- | --- | --- |
| Run | Inspect the latest or a selected attempt | Result, comparisons, unified graph, bot breakdown, attempt rail, Follow latest control |
| Sessions | Understand a practice session | Session list, selected-session summary, results grouped by scenario, links to attempts |
| Scenarios | Find a scenario and inspect its history | Searchable directory with PB, recent form, completed runs, and last played |
| Scenario detail | Assess improvement on one scenario | Rank context, score history, recent form, attempts, link into Run analysis |
| Benchmarks | Choose a rank goal and scenario to practice | Benchmark/season/difficulty selection, scenario scorecard, thresholds and gaps |
| Data & settings | Connect local files and manage preferences | Import/reconnect, import report, connection status, analysis/display preferences |

First-use onboarding is an empty state in the application, not a separate
marketing site. Scenario detail and selected sessions are nested destinations,
not additional top-level navigation items. Run selections should be linkable;
links identify data in the current browser and do not imply public sharing.
Exact URL structure is an implementation decision.

## Main page: Run

### Desktop layout

The main analysis column occupies the remaining width beside a roughly
300–340 px right-hand attempt rail. The rail scrolls independently. Above both
is a compact application navigation bar with data status.

```text
aimcurve   Run  Sessions  Scenarios  Benchmarks       Data status
-----------------------------------------------------------------
Scenario / run time / relevant settings          | Recent attempts
Score / PB comparison / optional rank target     | Search / filter
Compact scenario-relevant statistics             | Time, scenario,
                                                | result, delta
Unified analysis chart                          | selected row
  Layer controls and exact comparison readout   | clearly marked
  Rank backgrounds + performance curves         |
  Bot boundaries + shared time axis             |
                                                |
Bot breakdown / splits                          |
Analysis controls                               |
```

The result and chart are the first visual priorities. At a typical desktop or
second-monitor viewport, show the result, the entire chart, and at least the
start of the bot table together. Avoid oversized cards and decorative spacing.

### Result and statistics

Show scenario, run timestamp, final score, and comparison result prominently.
For races, show completion time prominently as well; lower time is better.
Expose relevant settings such as sensitivity without making them compete with
the result. Show next-rank target only when a verified benchmark mapping exists.

Use a compact row of scenario-relevant statistics, such as accuracy, elapsed
time, hits/shots, damage rate, or time per bot. Secondary diagnostics such as
FPS and overshoots can be expanded. Do not show empty statistics just to preserve
a fixed grid.

Name comparison baselines explicitly. A historical attempt's improvement over
the PB before that attempt is different from comparison with the currently
selected PB; label those meanings consistently in the rail and detail view.

### Unified graph: meaning of the scale

All visible performance lines and rank thresholds share one normalized rate
scale. Independently stretching series to make them fit is prohibited.

- **Local pace:** normalized performance over a rolling interval.
- **Accumulated pace:** normalized overall performance from the start through
  the selected point. It is not raw accumulated score or cumulative delta.
- **Rank bands:** rank-equivalent pace ranges for this scenario and benchmark.

For additive normalized output, accumulated pace is total output divided by
elapsed time; local pace is output gained over the rolling interval divided by
its duration. Other scoring systems require an explicit scenario adapter with
corresponding definitions and rank-threshold conversion. Do not assume all
nonlinear scoring can be converted by averaging local rates.

Each adapter must define local pace, accumulated pace, units, better/worse
direction, threshold conversion, and comparison alignment. The endpoint must
agree with the real final result under that conversion. Missing or unsupported
conversions must not produce fabricated rank bands.

Race comparisons need alignment by equivalent challenge progress or bot section,
with actual elapsed times retained. A shared-axis rendering must not compare
different race sections merely because their wall-clock timestamps match.
Choose and label the axis according to scenario type; normalized progress and
elapsed time must not be presented as interchangeable.

Rank crossings mean **rank-equivalent pace**, not an achieved rank or proof of
rank-level ability against an individual bot. Uneven section difficulty remains
visible context. At time zero, accumulated pace is undefined: show a gap until
sufficient data exists rather than dividing by zero or inventing a value.

### Graph layers and proposed defaults

| Layer | Appearance | Default |
| --- | --- | --- |
| Rank bands | Muted backgrounds with readable edge labels | On when mapped |
| Current local pace | Thin but clearly visible solid line | On |
| Current accumulated pace | Prominent thicker solid line | On |
| PB accumulated pace | Prominent dashed comparison line | On when available |
| Accumulated-pace gap | Subtle fill between accumulated lines | On with both lines |
| PB local pace | Thin dashed comparison line | Off |
| Recent performance range | Faint mean ± one standard deviation band | Off |

Use layer controls for Local pace, Accumulated pace, PB, and Recent range, with
an explicit way to enable PB local pace independently. Persist display choices.
Removing a line also removes shading that depends on it.

The recent range is descriptive variation, not a confidence interval. Calculate
it from compatible prior completed runs, excluding the inspected run. Show the
actual sample count when fewer than ten are available. At one available run,
show its mean without implying a meaningful variability estimate.

Smoothing applies to displayed local pace. Compute accumulated totals from the
underlying data, not by integrating the visually smoothed curve. Define recent
range and comparison alignment consistently with the selected scenario adapter.

### Precision and interaction

Place an exact cumulative comparison readout beside the chart heading or line
endpoint. At rest it shows the completed-run difference; on hover or keyboard
inspection it shows the difference at the selected point. Identify that point
so an inspected value cannot be mistaken for the final result.

The gap between accumulated-pace curves is a pace difference. The exact
cumulative readout uses the adapter's meaningful result unit, such as points or
seconds, and is not inferred by estimating shaded area.

A shared crosshair exposes time/progress, bot, local pace, accumulated pace,
comparison values, and cumulative advantage/deficit. Keep a concise default
tooltip and reveal additional available metrics without covering the plot.

- Hovering a bot row highlights its encounters; repeated encounters may occupy
  multiple intervals.
- Selecting a bot pins that highlight; selecting again or clearing restores all.
- Selecting an interval shows its contributing encounters and available metrics.
- Hovering a series emphasizes it and reduces competing line emphasis.
- Pointer and keyboard inspection should provide equivalent information.

Use readable labels at normal desktop scale, clear line styles, and explicit
ahead/behind signs. Color alone must not carry meaning. Avoid printing dense
numeric annotations throughout the plotting area.

### Bot breakdown

Adapt the table to the scenario: race time splits, fixed-window output, or
per-bot encounter statistics. Show bot name, relevant current metric,
comparison metric, and signed difference. Include accuracy or other useful
metrics when recorded. Clearly distinguish aggregate bot rows from individual
encounters, and explain what a best split compares against.

Highlight the largest losses without hiding the other rows. Statements such as
"accuracy was lower against bot X" are observations. Do not assert that a
specific movement behavior caused the loss without supporting data.

### Live following and attempt history

"Live" means newly completed, imported attempts appear automatically where
folder access supports it; it does not promise telemetry during an active run.

Separate **data connection state** from **Follow latest selection state**.
With Follow latest enabled, a new eligible run becomes the selected run.
Manually inspecting an older run pauses following but keeps importing; show a
new-run indicator and a clear Resume latest action. Filters remain explicit.

The rail includes timestamp, scenario, result, clearly defined delta, and
selection. Support scenario filtering and keyboard navigation. Historical links
must resolve the requested run even if it is outside the loaded rail page.

## Sessions page

Provide a selectable history of sessions, initially selecting the latest.
Use the existing database's session definition rather than treating every day
as one session. Show date/time span, completed runs, resets where available,
scenarios played, and PB events.

The main section groups results by scenario: completions, best result, recent
trend, and links to individual attempts. Avoid a session-wide highest raw score
across unrelated scenarios. Distinguish elapsed session span from active play
time; only show active time if it can be computed reliably.

Opening a run enters Run in inspection mode. Scenario links open its history.

## Scenarios directory and detail

The directory provides search, sorting, PB, recent form, run count, and last
played. Show scenario versions distinctly when hashes differ; do not silently
merge incompatible versions under the same display name.

Scenario detail places a personal progression chart above an attempts table.
Show PB history, recent typical performance, optional rank thresholds, and
filters for time range and compatible settings. Resets can be inspected but
must not count as completed-score results. A selected attempt opens Run.

This page answers whether a pattern is improving over time. It does not need
the full within-run chart duplicated above the history chart.

## Benchmarks page

This is supporting functionality, after the live-analysis experience works.
Select benchmark, season, and difficulty; group scenario rows by category.
Each row shows PB, achieved scenario rank, next threshold, and distance to it.
Unplayed scenarios are explicit. Link each row to scenario history and its
relevant run analysis.

Only show overall ranks when that benchmark's aggregation rules are implemented.
Scenario mapping must account for versions and practice variants. Thresholds,
score direction, and formulas are versioned definitions, not guesses from names.
The first supported benchmark remains a product choice for this later milestone.

## Data, onboarding, and settings

The empty state explains that users select local Kovaak's output files/folders,
data is processed in their browser, and the current product does not sync across
devices. Offer supported directory connection and snapshot import fallback.

Show import progress and a concise report: added runs, skipped files, and
actionable failures. Separate missing performance detail from invalid runs.
Permission loss or a reload may require an explicit Reconnect action. Snapshot
imports show their last import time and a reimport action rather than claiming
continuous updates.

Data & settings contains connection management, import details, smoothing,
comparison compatibility preferences, and display defaults. Destructive local
data removal, if implemented, requires clear scope and confirmation. If a
migration resets imported data, surface that event and guide reimport.

## Responsive and incomplete-data states

- On narrow screens, move attempt history into a drawer or separate section;
  prioritize result and chart. Bot tables may scroll horizontally.
- A valid CSV without performance detail still has summary/history value.
  Show available detail only, with an explanation of unavailable curves.
- If the true PB lacks a curve, distinguish its score from the best available
  charted comparison. Never silently relabel the latter as the true PB.
- No rank mapping: display performance and comparisons without rank bands.
- No compatible history: show current data and explain unavailable comparisons.
- Empty filters, import errors, unavailable local links, and denied permission
  need explicit recoverable states.

## Verification criteria

1. A user can import files, inspect a real run, refresh without losing it, and
   reimport without duplicates.
2. A newly completed run appears while following; inspecting an older run is
   not interrupted by new imports.
3. Local performance and accumulated pace use one valid scale; final results
   and adapter conversions agree. The same guarantee applies to race handling.
4. An early lead followed by a late loss is readable, including a near-PB finish
   whose exact difference cannot be estimated visually.
5. Bot selection links table and chart, including repeated bot encounters.
6. Unsupported ranks, missing curves, and insufficient comparison samples remain
   truthful rather than appearing as zeroes or invented values.
7. The default desktop view remains readable with rank bands and three lines;
   optional layers can be enabled without losing access to exact values.

## Delivery sequence and review points

1. Browser import, connection states, Run shell, and attempt selection.
2. Scenario adapters, unified graph, compatible comparisons, and bot breakdown.
3. Sessions and scenario history.
4. Benchmark definitions, scorecard, and verified rank context. Rank-band design
   can be prototyped earlier, but production bands require those definitions.

Review this document for page scope, default chart layers, and main-page layout
before an implementation plan is written. Define the conversion interface and
comparison-alignment contract separately with the user, who will supply the
scenario-specific formulas. UI development can use clearly labeled synthetic
data against that contract; production scoring and rank bands require validated
conversions. Do not expand the UI task into implementing conversion formulas.
