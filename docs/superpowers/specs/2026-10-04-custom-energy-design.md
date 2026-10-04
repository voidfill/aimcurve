# Custom energy: one balanced score per benchmark difficulty

How a player's scenario scores in one benchmark difficulty are reduced to a
single number, its "energy", and a rank. The same calculation also produces
per-category and per-subcategory energies and a history over time. This is
the groundwork for the Benchmarks page (its own spec), which displays it.

Prerequisites: [benchmark ranks](2026-09-25-benchmark-ranks-design.md) (the
snapshot, `rankOf`, candidate picking), [run schema](2026-09-18-run-schema-design.md)
(`run_complete`, `run_progress`).

Out of scope:
- the Benchmarks page and its charts;
- parity with Evxl's or voltaic.gg's energy numbers;
- Evxl's `rankCalculation` methods;
- comparing energies across benchmark families;
- how stale form is treated (page spec).

## Research (2026-10-04)

### What upstream provides

`GET https://evxl.app/data/benchmarks`, at the time of measurement:

- **Size:** 131 visible benchmarks and 267 difficulties.
- **Per benchmark:** `benchmarkName`, `rankCalculation`, `abbreviation`, `color`,
  `spreadsheetURL`, `dateAdded`, `difficulties`.
- **Per difficulty:** `difficultyName`, `kovaaksBenchmarkId`, `sharecode`,
  `rankColors`, `categories`. Only REVENGE adds a `scenarioSelection` object.
- **Per category and subcategory:** `categoryName` or `subcategoryName`, and
  `color`. Subcategories also have `scenarioCount`. **No scenario names.**

Scenario names and ladders come only from KovaaK's
`player-progress-rank-benchmark` response, which the generator already fetches
(B2). Its `categories` object lists scenarios in benchmark order.

Evxl assigns scenarios to subcategories by position:
1. flatten KovaaK's scenario keys in response order;
2. slice that list by Evxl's `scenarioCount`s, in Evxl's category and
   subcategory order.

Checked against every visible difficulty on 2026-10-04:

- **Counts:** in 266 of 267 difficulties, the Evxl `scenarioCount` total equals
  the number of KovaaK's scenarios. The exception is PureG S1 · All, with 14
  KovaaK's scenarios against 12 in Evxl.
- **Names:** no difficulty repeats a trimmed scenario name.
- **Categories:** KovaaK's category keys are not Evxl's categories. They differ
  in 224 difficulties, and in 191 of them the number of categories differs
  too. For example, Voltaic S5.5 lists nine KovaaK's categories, one per
  subcategory. The positional slice is therefore the only reliable mapping, and
  category and subcategory names must come from Evxl.

### Evxl's `rankCalculation` is a label, not data

There are 45 distinct values across the 131 benchmarks:

| Method | Benchmarks |
| --- | ---: |
| `basic` | 37 |
| `generic-energy` | 19 |
| `aplus-alt` | 9 |
| `generic-energy-alt`, `complete`, `generic-energy-uncapped` | 4 each |
| `vt-energy`, `ca-s1`, `dm`, `jade-palace` | 3 each |
| 35 other methods | 1–2 each |

The algorithms exist only in Evxl's minified client bundle, as one ~2,900-line
chunk with a dispatch table keyed by method name. It has no published licence
and no specification. Evxl's energies also differ from voltaic.gg's official
numbers. Matching either would mean reverse engineering and then chasing their
changes. Neither is a stable target.

What the bundle shows about the established conventions, for context:

- **`vt-energy`**:
  - Fixed energy ladders: Novice 100–400, Intermediate 500–800, Advanced
    900–1200.
  - One energy per subcategory, from its *best* scenario by fractional rank,
    linear between thresholds.
  - A fake lower rank at `T₀ − 100` (Novice `T₀ − 0`), with its score threshold
    extrapolated one ladder step below rank 1. One fake rank above the top.
  - Subcategories named "strafe" are excluded.
  - Advanced is capped at 1200 unless the player is already at the top rank.
  - Harmonic mean over subcategories, rounded to 0.1. It is 0 while any
    subcategory is missing.
- **`generic-energy`**: the same core, but the energy ladder runs on across the
  benchmark's difficulties (difficulty 2 starts where difficulty 1 ends).
- **Every method:** the final rank is `max(method rank, "complete" rank)`, where
  the complete rank is the lowest scenario rank.

## Summary of decisions

| | |
| --- | --- |
| E1 | Our own energy, labelled "custom energy", per difficulty; no parity with any upstream |
| E2 | Scenario → fractional rank on its ladder, extended one step at each end |
| E3 | Subcategory = mean; category and overall = shifted geometric mean |
| E4 | Two coverage modes: provisional (default) and strict |
| E5 | Overall fractional rank maps back to the difficulty's rank names |
| E6 | Two inputs to the same calculation: PB and form |
| E7 | Snapshot v2 adds each difficulty's category tree |
| E8 | SQL narrows the runs; one JS pass computes energies and history |
| E9 | Pure functions in `src/lib/energy/`, with a performance budget |

---

### E1. Our own energy, labelled "custom energy", per difficulty

The goal is a rough, balanced reflection of progress across a benchmark's
scenarios, not a reproduction of anyone's official number.

- It is shown as "custom energy" everywhere, so nobody mistakes it for
  Voltaic's or Evxl's energy.
- Every difficulty is its own ladder. Difficulties are not chained, and their
  energies are not offset. This follows the established VT and Viscose
  convention of separate difficulty ladders. Novice Gold and Intermediate
  Platinum are different scales, not neighbours.
- Different benchmark families are never placed on one axis as if their
  energies were equivalent.
- One rule applies to every benchmark. There are no per-benchmark special cases:
  no strafe exclusion, no Advanced cap.
- The constants are expected to be tuned later. A tuning change is a code change
  and a test update, not a redesign.

### E2. Scenario → fractional rank on its ladder, extended one step at each end

A scenario in a difficulty with `n` ranks has thresholds `t₁ ≤ … ≤ tₙ` from the
snapshot. Rank `i` is reached at `tᵢ`, as in B5. The ladder is extended by one
step at each end:

- `t₀ = t₁ − step_low` (fake lower rank)
- `tₙ₊₁ = tₙ + step_high` (fake upper rank)

where:
- `step_low` is the first non-zero difference `tᵢ₊₁ − tᵢ` from the bottom;
- `step_high` is the first non-zero difference from the top;
- for a single-rank ladder, both are `0.1 × |t₁|`, or `1` when `t₁ = 0`. The
  generator already drops all-equal ladders.

For a score `s`:

- `s < t₀` → `r = 0`
- `s ≥ tₙ₊₁` → `r = n + 1`
- otherwise, `i` is the largest index in `0..n` with `tᵢ ≤ s`, and
  `r = i + (s − tᵢ) / (tᵢ₊₁ − tᵢ)`.

Choosing the *largest* `i` means a tied (zero-width) step is jumped, never
divided by. It also reaches the higher of the tied ranks, consistent with B5.
`t₀` may be negative. That is harmless.

Energy is `100 × r`, shown as an integer. A difficulty with `n` ranks spans
0 to `(n + 1) × 100`.

Example: thresholds `500, 600, 700, 800` give `t₀ = 400` and `t₅ = 900`.

| Score | `r` | Energy |
| --- | --- | --- |
| 380 | 0 | 0 |
| 450 | 0.5 | 50 |
| 650 | 1.5 | 150 |
| 950 | 5 | 500 |

Race scenarios need nothing extra. Their ladders are in CSV score units, as
verified in B5.

A scenario slot whose ladder the generator skipped (a decreasing ladder, B2) is
**unrated**. It is excluded from both coverage modes and from the coverage
counts, and it is listed by the page.

### E3. Subcategory = mean; category and overall = shifted geometric mean

The goal is to reward neither one-tricks nor cherry-picking, and not to punish
one weak area too hard.

- **Subcategory:** the arithmetic mean of its scenarios' `r`. Every scenario
  counts, not only the best one, so playing only the easiest scenario of a
  subcategory does not pay.
- **Category:** `G` over its subcategories.
- **Overall:** `G` over the categories. Each category has equal weight, however
  many subcategories it has.

`G(x₁ … x_k) = exp(mean(ln(xⱼ + 1))) − 1` is a shifted geometric mean. The `+1`
shift makes it safe at zero: one subcategory at 0 lowers the result, but does
not zero it the way a harmonic mean does.

`G` is the power mean of `(x + 1)` with exponent 0. That exponent is the
module's one tuning constant: −1 is harmonic, 1 is arithmetic.

Computed with 12 subcategories:

| | Arithmetic | `G` | Shifted harmonic |
| --- | ---: | ---: | ---: |
| One at 0, eleven at 5 (weak spot) | 4.58 | **4.17** | 3.24 |
| One at 8, eleven at 3 (one-trick) | 3.42 | **3.28** | 3.19 |

### E4. Two coverage modes: provisional (default) and strict

**Provisional** (the default) uses only what has been played:
- Unplayed scenarios are left out.
- A subcategory with no played scenario drops out of its category.
- A category with no played subcategory drops out of the overall.
- Nothing played at all gives no energy (`null`).

This answers the case of a player who trains only one category: that category
still earns a rank.

**Strict** is an opt-in toggle:
- Unplayed scenarios count as `r = 0`, and every node keeps its full denominator.
- Strict always gives a number. It is 0 when nothing has been played.

**Coverage** is computed with every result, in either mode:
- played and total scenarios (unrated excluded);
- subcategories with at least one played scenario, and total;
- the same for categories.

With full coverage, the two modes are equal and the result is not provisional.
The page shows provisional results as provisional, for example
"provisional · 9/12 subcategories".

### E5. Overall fractional rank maps back to the difficulty's rank names

For an overall `r` in a difficulty with ranks `R₁ … Rₙ`:

- `k = min(⌊r⌋, n)`.
- `k = 0` is Unranked.
- Otherwise the rank is `R_k`, with progress `r − k` toward `R_{k+1}`.
- At `k = n`, the rank is `Rₙ` plus the overflow `r − n` (at most 1), shown as
  "Rₙ +0.4".

The same mapping names category and subcategory values, for example "Tracking:
Gold, 60 % to Platinum".

### E6. Two inputs to the same calculation: PB and form

The calculation is a pure function of `scenario → score`. Only its input
differs:

- **PB energy:** each scenario's best score as of time `T`. It never decreases.
  This is what conventional trackers show.
- **Form energy:** the median of each scenario's last `N` complete runs as of
  `T`, with `N = 5`, or fewer while fewer exist. It can fall, so it reflects
  current skill, not peak skill.

Only complete runs (`run_complete`) with a non-null score count. Time is
`started_at`, the same clock as `run_progress`.

How form treats a scenario whose last run is old (mark it stale, decay it, or
count it as is) is left to the page spec.

### E7. Snapshot v2 adds each difficulty's category tree

`src/data/benchmarks.json` goes to `version: 2`. Each benchmark entry gains a
`tree`, which is null when the tree could not be built:

```jsonc
{ "id": 458, "name": "Voltaic S5", "difficulty": "Intermediate",
  "color": "#02A2DA",            // Evxl benchmark colour
  "ranks": [ … ],                // unchanged
  "tree": [
    { "name": "Clicking", "color": "#CC0000", "subs": [
      { "name": "Dynamic", "color": "#F1C232",
        "scenarios": ["…", "…"] }   // illustrative
    ] }
  ] }
```

**How the tree is built** (inside `buildSnapshot`):
1. Flatten the KovaaK's response's scenario keys in response order, trimmed.
2. Slice that list by Evxl's `scenarioCount`s, in Evxl's category and
   subcategory order.
3. Take names and colours from Evxl.

Rules:
- Subcategories are arrays, not maps, so a repeated subcategory name stays as
  two entries.
- A name repeated in two slots stays in both. Its thresholds are looked up
  through `scenarios`, as today.
- If the Evxl count total differs from the KovaaK's scenario count, `tree` is
  `null`. The difficulty is listed in the generator summary, and its ladders
  still serve the rank badge.

Unchanged: the `scenarios` map, candidate order (B4), the deterministic
serialiser and the rank badge. The serialiser writes each tree on its
benchmark's line, so diffs stay one line per changed difficulty. The app does
not use `rankCalculation`, so it is not stored.

### E8. SQL narrows the runs; one JS pass computes energies and history

The energy math is not done in Postgres:

- PGlite is single-threaded WebAssembly in the same worker that serves live
  queries and ingest.
- An as-of-time energy in SQL needs `events × scenarios` rows and a GROUP BY.
  The same work in JS is one linear pass.
- The snapshot would have to be copied into tables and re-migrated after every
  regeneration.
- Tuning the formula is easier in unit-tested TypeScript than in numbered
  migrations.

**SQL** filters and narrows, because moving rows across the worker boundary is
the main cost:

- **History:** one ordered stream of `(scenario_id, started_at, score)` for the
  complete runs of a difficulty's scenarios. Scenarios are matched by
  `trim(scenario.name)` and ordered by `started_at, id`. A small separate
  `scenario_id → trimmed name` map comes with it. Several scenario rows can
  share a trimmed name, and they count as one scenario.
- **PB-only views** may ask for only the runs with `score > pb_before`, which is
  far fewer rows.
- **Current state across many difficulties:** one row per scenario with the
  current PB and the last `N` scores. This also feeds "which difficulty fits
  me".

**JS** makes one pass over the stream:

- **State:** each scenario's PB and a ring of its last `N` scores. Each
  subcategory keeps a running sum and count of `r` per input.
- **At each run:** update that scenario's `r` and its subcategory, then
  recompute its category and the overall with `G` (O(subcategories)). Both
  coverage modes come out of the same pass, since strict only fixes the
  denominators.
- **Output:** columnar `Float64Array`s, one value per run event, for every node
  (overall, each category, each subcategory) and for both inputs, plus the event
  times and coverage. Every chart reads these arrays, so switching or adding a
  display needs no new query.
- **Refresh:** the existing change notification reruns the query and the pass.
  Appending only new runs is possible later, if ever needed.

### E9. Pure functions in `src/lib/energy/`, with a performance budget

Pure modules:
- `src/lib/energy/rank.ts`: `fractionalRank(thresholds, score)` (E2).
- `src/lib/energy/aggregate.ts`: `G`, and evaluating a tree from a
  `scenario → r` map with a mode (E3, E4), returning values per node and
  coverage.
- `src/lib/energy/history.ts`: the single pass (E8), from a run stream and a
  tree to the columnar output.
- `src/lib/energy/name.ts`: `r` → rank name and progress (E5).

Query and composable:
- The run-stream query in `src/lib/energy/queries.ts`.
- A composable that joins the snapshot, the query and the pass, shaped by the
  page spec.

`src/lib/energy/energy.bench.ts` runs the pass over 100k synthetic runs across
30 scenarios. The budget is one frame (16 ms). If the pass goes over budget, it
moves to a dedicated compute worker. The functions are pure, so that move
changes no interfaces. The real history is about 2.7k runs in total.

## Testing

- `fractionalRank`:
  - below `t₀`, at `t₀`, between thresholds, exactly on a threshold;
  - at and above `tₙ₊₁`;
  - tied thresholds (jumped, higher rank reached);
  - a tie at the bottom or top (`step_low`/`step_high` skip zeros);
  - a single-rank ladder, and `t₁ = 0`;
  - the worked example in E2.
- `G`: the E3 table values; all zeros → 0; a single child is the identity.
- Tree evaluation:
  - provisional with gaps (subcategory and category drop-out, nothing played →
    null);
  - strict with gaps;
  - both modes equal at full coverage;
  - unrated slots excluded from the counts;
  - a duplicate subcategory name;
  - a scenario name in two slots.
- Rank naming: unranked, mid-ladder, top rank with overflow.
- History pass:
  - PB is monotone and form can fall;
  - form with fewer than `N` runs;
  - output equals tree evaluation of the as-of state at sampled events;
  - several scenario ids sharing one trimmed name.
- `buildSnapshot` v2:
  - the tree is sliced by counts;
  - a count mismatch gives `tree: null` and a summary line;
  - a repeated subcategory name;
  - colours are carried over;
  - deterministic output.
- Bench: 100k runs inside the 16 ms budget.
