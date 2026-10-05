# ARC: the aimcurve rank composite

ARC is aimcurve's one number for where a player stands on a benchmark
difficulty. It also covers each category and subcategory on that difficulty.
This document explains what it is, how it is computed and why it is built that
way. [benchmarks.md](benchmarks.md) covers the page that shows it.

The name is a word and an acronym at once: **ARC**, the *aimcurve rank
composite*. Values are written in lowercase next to a number ("PB 249 arc",
"+51 arc"); the plural is "arcs".

## In one paragraph

Every rank on a difficulty's ladder is worth 100 arc, and progress between
ranks counts proportionally: reaching the ladder's third rank is 300 arc, and
being halfway from there to the fourth is 350. A subcategory is the average of
its scenarios; categories and the overall combine their parts so a weak spot
pulls the result down, but never to zero.

## ARC is not anyone else's score

ARC is aimcurve's own. **It does not correspond to Voltaic energy, Evxl's
energies, Viscose's ranks or any other benchmark's official number, and it
does not convert to or from them.** 400 arc is not 400 Voltaic energy, and an
ARC rank-up is not an official rank-up.

- Every difficulty is its own scale. Difficulties are not chained (Voltaic
  Novice does not continue into Intermediate), and different benchmark
  families are never placed on one axis.
- One rule applies to every benchmark. There are no per-benchmark special cases
  such as Voltaic's strafe exclusion or Advanced cap.
- The page says this wherever ARC is shown (the ARC chip and its explainer).

Why not match the official numbers: see [Upstream](#upstream-research).

## The calculation

### A scenario: its fractional rank

A scenario on a difficulty with `n` ranks has thresholds `t₁ ≤ … ≤ tₙ` from the
benchmark snapshot; rank `i` is reached at `tᵢ`. The ladder is extended by one
step at each end:

- `t₀ = t₁ − step_low` below rank 1, the "Unranked" step;
- `tₙ₊₁ = tₙ + step_high` above the top rank, its overflow.

`step_low` is the first non-zero gap between thresholds from the bottom,
`step_high` the first from the top. A single-rank ladder steps by
`0.1 × |t₁|`, or 1 when `t₁ = 0`.

For a score `s`, the fractional rank `r` is:

- `s < t₀` → `0`;
- `s ≥ tₙ₊₁` → `n + 1`;
- otherwise, with `i` the largest index in `0..n` where `tᵢ ≤ s`:
  `r = i + (s − tᵢ) / (tᵢ₊₁ − tᵢ)`.

Taking the *largest* `i` jumps a tied (zero-width) step instead of dividing by
it, and reaches the higher of the tied ranks, as the rank badge does.

**ARC is `100 × r`**, shown whole. A difficulty with `n` ranks spans 0 to
`(n + 1) × 100`.

Example: thresholds `500, 600, 700, 800` give `t₀ = 400` and `t₅ = 900`.

| Score | `r` | ARC |
| --- | --- | --- |
| 380 | 0 | 0 |
| 450 | 0.5 | 50 |
| 650 | 2.5 | 250 |
| 950 | 5 | 500 |

Race scenarios need nothing extra: their ladders are in the CSV's score units.

A scenario slot whose ladder the snapshot generator skipped (a decreasing
ladder) is **unrated**. It is left out of every calculation and every coverage
count, and the page lists it as unrated.

### Up the tree: mean, then shifted geometric mean

The goal is to reward neither one-tricks nor cherry-picking, and not to punish
one weak area too hard.

- **Subcategory:** the arithmetic mean of its scenarios' `r`. Every scenario
  counts, not only the best, so playing only the easiest one does not pay.
- **Category:** `G` over its subcategories.
- **Overall:** `G` over the categories, each with equal weight however many
  subcategories it has.

`G(x₁ … x_k) = exp(mean(ln(xⱼ + 1))) − 1` is a shifted geometric mean. The `+1`
makes it safe at zero: one subcategory at 0 lowers the result but does not zero
it, as a harmonic mean would. `G` is the power mean of `x + 1` with exponent 0;
`POWER` in `aggregate.ts` is the one tuning constant (−1 harmonic, 1
arithmetic).

With 12 subcategories:

| | Arithmetic | `G` | Shifted harmonic |
| --- | ---: | ---: | ---: |
| One at 0, eleven at 5 (weak spot) | 4.58 | **4.17** | 3.24 |
| One at 8, eleven at 3 (one-trick) | 3.42 | **3.28** | 3.19 |

A difficulty's tree comes from the snapshot (see [Data](#data)). One with a
single category has no category row on the page: `G` of one value is that
value, so it would repeat the overall. A subcategory Evxl left unnamed has no
row either, but still counts as a subcategory.

### Coverage: provisional or strict

**Provisional**, the default, counts only what has been played. Unplayed
scenarios are left out, a subcategory with none played drops out of its
category, and a category with none drops out of the overall. With nothing
played there is no value. This lets a player who trains one category still see
its rank.

**Strict** counts unplayed scenarios as 0 and keeps every denominator, so it
always gives a number.

Coverage is reported with every result: scenarios, subcategories and categories
played, each out of the total (unrated excluded). At full coverage the two
modes agree. The setting is stored per browser
(`aimcurve.benchmark-coverage`).

### Naming a value

`r` maps back to the difficulty's rank names. `k = min(⌊r⌋, n)`: `k = 0` is
Unranked, otherwise rank `k` with progress `r − k` toward the next. At the top
rank the progress is the overflow past it. Progress is shown as a whole percent,
rounded down so 99.6 % never reads as the next rank: "Gold, 60 % to Platinum",
"Master, 40 % past the top rank", and on the pills just "60%".

### Two inputs: PB and form

The calculation is a function of `scenario → score`; only the input differs.

- **PB arc:** each scenario's best score as of a moment. It never decreases.
- **Form arc:** the median of each scenario's last `W` complete runs as of that
  moment, or of fewer while fewer exist. It can fall, so it shows current skill
  rather than peak.

`W` is the run window, one setting shared by the scenario and Benchmarks pages:
5, 10, 20 or 50 runs, 10 by default (`aimcurve.form-window`). It also sets the
candle and the median pill on the Benchmarks page.

Only complete runs with a score count, timed by `started_at`. Form is not
decayed for age; the page fades a scenario not played for 30 days instead.

## Data

The snapshot (`src/data/benchmarks.json`, version 2) gives each difficulty its
category `tree`, or `null` when it cannot be built:

```jsonc
{ "id": 458, "name": "Voltaic S5", "difficulty": "Intermediate",
  "color": "#02A2DA",
  "ranks": [ … ],
  "tree": [
    { "name": "Clicking", "color": "#CC0000", "subs": [
      { "name": "Dynamic", "color": "#F1C232", "scenarios": ["…", "…"] }
    ] }
  ] }
```

The generator builds it by flattening KovaaK's scenario keys in response order
(trimmed), slicing that list by Evxl's `scenarioCount`s in Evxl's category and
subcategory order, and taking names and colours from Evxl. Subcategories are
arrays, so a repeated name stays as two entries; a scenario in two slots stays
in both. When Evxl's counts do not add up to KovaaK's scenarios, the tree is
`null` and the generator's summary lists the difficulty.

A difficulty without a tree has no sheet and is left off the Benchmarks index.
Its ladders still serve the rank badge, and the scenario page still shows a
scenario's row on it, from a flat stand-in tree of every scenario with a ladder
there (`arcTree(…, flat)`); its aggregates mean nothing and are not shown.

Scenarios match by trimmed name, trimmed the way JavaScript's `trim()` does it,
in SQL too. Every hash of a name counts as one scenario.

## How it is computed

SQL narrows, JavaScript computes:

- PGlite is single-threaded WebAssembly, shared with live queries and ingest.
- An as-of-time value in SQL needs `events × scenarios` rows; in JavaScript it
  is one linear pass.
- The formula is easier to tune in tested TypeScript than in migrations.

**Queries** (`src/lib/arc/queries.ts`):
- `listArcRuns`: every complete scored run of the given names, ordered by
  `started_at, id`, as typed arrays, with each scenario row's trimmed name and
  hash.
- `listPlayedNames`: the trimmed names with at least one complete run, for the
  index's "n/m played".

**The history pass** (`history.ts`) walks the run stream once, for one coverage
mode and one window. Per scenario it keeps the PB and the last `W` scores in a
sorted ring; per subcategory a running sum and count. A run updates its
scenario and subcategories, then recomputes their categories and the overall.
The output is sparse and columnar: for every node, the run events inside it and
its PB and form values after each. Category and overall values are kept in the
`G` term domain and converted on read. Switching the mode or the window reruns
the pass.

**The spread pass** (`spread.ts`) is the candle's statistics: each scenario's
worst, p10, median and p90 of its last `W` runs and its all-time PB, in rank and
in score; each statistic aggregated through the tree on its own.

**Budget:** `arc.bench.ts` runs the pass over 100k synthetic runs on 30
scenarios. The target is one frame, 16 ms; it measures about 20–25 ms. Real
histories are far smaller (one player's is about 2.7k runs), so it is not
urgent. If it ever matters, the functions are pure and can move to a compute
worker without interface changes.

### Modules

All in `src/lib/arc/`, pure and unit-tested:

| Module | What |
| --- | --- |
| `rank.ts` | `fractionalRank`, `rankScale` |
| `aggregate.ts` | `G`, `arcTree`, `evaluate`, `coverage` |
| `name.ts` | rank names and percentages, `arcText` |
| `history.ts` | the run stream and the history pass |
| `spread.ts` | the candle's statistics |
| `axis.ts`, `pill.ts`, `chart.ts`, `tip.ts` | the Benchmarks page's lane, pills, charts and tooltips |
| `queries.ts` | the SQL above |

`useBenchmarkPage` joins them for the page.

## Decisions

- **Our own number, per difficulty.** A rough, balanced picture of progress, not
  a reproduction of an official score. The name went from "custom energy" to
  ARC so it is its own thing and not mistaken for anyone's energy.
- **Mean, then `G`.** Every scenario counts; a weak spot costs something, not
  everything.
- **Provisional by default.** Partial coverage is normal; strict is there for
  the complete picture.
- **Form as much as PB.** The median of recent runs shows where a player is now.
- **One run window.** Form, the candle and the median pill once had separate
  windows; one setting is easier to read.
- **Tuning is a code change.** `POWER`, the end steps and the 100-per-rank scale
  can change with a test update, not a redesign.
- **Rejected:** "cheapest next rank" suggestions, since an ARC rank-up is not an
  official one; a percentile-exact candle for aggregates (each statistic is
  aggregated on its own, an approximation the page says so).

## Upstream research

Measured on 2026-10-04 against `GET https://evxl.app/data/benchmarks` (131
visible benchmarks, 267 difficulties).

- Evxl gives each difficulty its categories and subcategories with names,
  colours and each subcategory's `scenarioCount`, but **no scenario names**.
  Those come only from KovaaK's `player-progress-rank-benchmark` response, in
  benchmark order. Slicing KovaaK's list by Evxl's counts is the only reliable
  join: KovaaK's own category keys differ from Evxl's in 224 difficulties.
- The counts agree in 266 of 267 difficulties; PureG S1 · All has 14 KovaaK's
  scenarios against Evxl's 12. No difficulty repeats a trimmed scenario name.
- Evxl's `rankCalculation` is a label for one of 45 algorithms (`basic` 37
  benchmarks, `generic-energy` 19, `aplus-alt` 9, `vt-energy` 3, …). They exist
  only in Evxl's minified client, with no licence or specification, and Evxl's
  numbers differ from voltaic.gg's official ones. Matching either would mean
  reverse engineering a moving target.
- For context, `vt-energy` uses fixed energy ladders per difficulty (Novice
  100–400, Intermediate 500–800, Advanced 900–1200), takes each subcategory's
  *best* scenario, excludes strafe subcategories, caps Advanced, and combines
  with a harmonic mean that is 0 while any subcategory is missing.
  `generic-energy` chains the ladders across difficulties. Every method's final
  rank is at least the lowest scenario rank.
