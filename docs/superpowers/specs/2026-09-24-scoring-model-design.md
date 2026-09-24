# Scoring model: score at a moment in time

How any run is reduced to one comparable curve — the "shared meaningful scale" that
the unified Run graph plots local pace, accumulated pace and comparisons on.

Prerequisites: [product and page design](2026-09-20-product-and-page-design.md)
(the graph this feeds, "Unified graph: meaning of the scale"),
[run schema](2026-09-18-run-schema-design.md) (the tables read here),
[`perf-format.md`](../../perf-format.md) (what a tick is).

Out of scope: rank thresholds and bands (later; see D7 for why they need no
conversion), the bot breakdown (its own spec; see D8 for what it consumes from
here), chart rendering, and comparison compatibility by settings such as
sensitivity.

Numbers below were measured on 2026-09-24 over the full fixture dump: 2,487
completed CSVs, 2,156 of them with a `.perf`. Measurement was done from scratch
with the current parsers; the earlier Python implementation was read for prior
findings only, and its structure is not carried over.

## Summary of decisions

| | |
| --- | --- |
| D1 | The game's running score is the source of truth; no scoring formulas |
| D2 | Two kinds, `clock` and `race`, plus an explicit `unsupported` |
| D3 | A run classifies itself from its own `.perf`; no schema change |
| D4 | Every run reduces to a progress/spend pair `(x, u)` |
| D5 | One y-axis: projected final score |
| D6 | Local pace is marginal, not isolated |
| D7 | Rank thresholds are horizontal lines with no reverse conversion |
| D8 | Bots touch the model only through x placement and Δu |
| D9 | Pure TypeScript over one query, memoised per run |

---

### D1. The game's running score is the source of truth; no scoring formulas

The `.perf` `score` column is the per-tick change of the game's own running
score, not an independent per-tick award:

- `sum(score ticks) = Score:` in the CSV in **2,156 / 2,156** runs.
- The intermediate values are the running score, including nonlinear scoring. On
  `VT Pasu Novice S5` and `VT 1w3ts Intermediate S5 Hard`, `cumsum(score)[i]`
  equals `10 · kills_i · √(hits_i / shots_i)` over cumulative counters at every
  tick, max error 0.000.

So "score at time t" is `S(t) = cumsum(score)`, read directly, for every
fixed-clock scenario. Fitted final-score formulas, for context only (none is used):

| Family | Final score | Scenarios |
| --- | --- | ---: |
| tracking / accuracy (VT Aether) | `hits` (fixed fire rate) | 143 |
| clicking (Pasu-like) | `10 · kills` | 11 |
| accuracy multiplier (1w3ts, 1w4ts, VT Pasu) | `10 · kills · √accuracy` | 10 |
| miss penalty | `a · kills − b · misses` | 12 |
| pulse (return fire) | `10 · kills − 5 · misses − c · damage taken` | 4 |
| no simple fit (Pasu Perfected Goated, domiSwitch, Aimerz Static) | — | 3 |
| race | `time_limit − elapsed` | 10 |

31 fixed-clock scenarios have negative score ticks. That is expected: penalties
and multiplier drops lower the running score. Because nothing depends on a formula,
the three unfitted scenarios, and families not in this corpus such as strafe
scenarios, are handled like every other fixed-clock scenario.

### D2. Two kinds, `clock` and `race`, plus an explicit `unsupported`

| kind | meaning | runs |
| --- | --- | ---: |
| `clock` | fixed duration `T`; higher score is better | 2,001 |
| `race` | fixed work (a damage pool); `score = B − elapsed` | 153 (10 scenarios) |
| `unsupported` | anything else | 2 |

**Race facts.** `score + elapsed = time_limit = 1000` in 153 / 153 runs, and every kill
carries exactly `pool / N` damage in 153 / 153. The budget `B` is read from
`time_limit`, not hard-coded.

**Clock duration.** `T = time_limit / timescale` in real seconds, for example
`VT Aether … 90%`: 54 / 0.9 = 60 s. It is within 0.1 s of the last tick in
1,999 / 2,003 non-race runs; the four exceptions are listed below.

**`unsupported`** today is the kill-capped pair `VT Air Novice` and
`VT Plaza Novice` (`end_challenge_after_kills = 5`). They score by hits but end
at a variable time, so a projection to `T` would be fiction. They get no pace
lines, and the UI says why. The two 1.0 s shortfalls, `Leapcorn Pure Easy` and
`Star Clicking Novice`, are ordinary clock runs whose last tick fell short.
They stay `clock`, and their endpoint is the CSV score (D5).

### D3. A run classifies itself from its own `.perf`; no schema change

```
race        ⟺ time_limit = 1000  AND  countdown(score)
clock       ⟺ time_limit < 1000  AND  NOT countdown(score)  AND  end_challenge_after_kills is null
unsupported ⟺ everything else, including the two signals disagreeing
```

`countdown(score)`: `score[0] > 0`, and at least 90 % of interior ticks satisfy
`|score[i] + (t[i] − t[i−1])| < 0.02`. The slack absorbs 1 Hz cadence jitter.

The two race signals are independent, the header sentinel and the tick pattern,
and they partition the corpus identically, 153 / 153 with no overlap. Requiring both
means a KovaaK's format change degrades a scenario to `unsupported` rather than
putting it on the wrong axis.

Classification is a pure function of one run's `run_perf` and `run_series` rows,
so no new column or migration is needed. Every scenario hash is observed to have a
single kind (0 hashes with both). Comparisons still assert that the kinds match
(D4). Runs without a `.perf` have no curve and need no kind. If a later page
needs the kind for CSV-only runs, such as showing race results as times in the
Scenarios directory, it can be materialised per scenario hash at that point.

### D4. Every run reduces to a progress/spend pair `(x, u)`

For each tick `i`, prepended with `(0, 0)`:

| kind | `x` (progress, 0 → 1) | `u` (accumulated) | inputs |
| --- | --- | --- | --- |
| `clock` | `t_i / T` | `S_i = cumsum(score)` | `t`, `score`, `T` |
| `race` | `D_i / P`, `D = cumsum(damage_done)` | `t_i` (seconds spent) | `t`, `damage_done`, `P`, `B` |

The race pool `P` is the run's total `damage_done`, since a completed race consumes the
whole pool.

**Race kill knots.** Kill `k` of `N` is inserted as the exact point
`(x = k / N, u = t_offset_k)`, using the millisecond kill table rather than the 1 Hz
ticks. Tick samples and knots are samples of the same monotone `D(t)`, so the merged
sequence must be non-decreasing in both `x` and `u`. This is an asserted invariant
(Testing), not something to repair silently. The last knot is `x = 1`.

**Clock kills** add no knots. Their score is already inside the tick that contains
them. Their chart position is `t_offset / T` (D8).

Between points, `x` and `u` are linear in `t`. Evaluating a run at a given `x`
interpolates on the polyline with a two-pointer walk.

**Comparable runs** have the same scenario hash, the same kind, and the same parameters:
`|T − T'| < 0.5 s` for clock, equal `B`, `P` and `N` for race. Comparisons line up
at equal `x`. For races, that is equal challenge progress, as the page spec requires. Race
bot boundaries fall at the same `x = k / N` in every run.

### D5. One y-axis: projected final score

A single function per kind maps a spend rate to the score it would produce over a
full run:

| kind | `project(r)` with `r = Δu / Δx` | reads as |
| --- | --- | --- |
| `clock` | `r` | points if this pace held for all of `T` |
| `race` | `B − r` | score if this pace held for the whole pool; `r` is projected seconds |

- **Accumulated pace** at point `i`: `project(u_i / x_i)`.
- **Local pace** at point `i`: `project((u(t_i) − u(t_i − w)) / (x(t_i) − x(t_i − w)))`
  over a rolling window of `w` seconds of the run's own clock. The default is `w = 5 s`,
  and the page spec's smoothing setting changes it.
- **Gaps, not zeroes.** Both lines are undefined (`NaN`, drawn as a gap) while
  `t_i < w`, and local pace is undefined when `Δx = 0`, for example a race window spent
  entirely in a respawn gap. Nothing divides by zero.
- **Endpoint.** At `x = 1`, accumulated pace is `S(T)` for clock and `B − elapsed` for race,
  which is the real score in both cases. The displayed final value and the at-rest
  readout use the CSV `score` directly, so a short last tick never changes the
  headline.

Score direction is uniform: in both kinds a higher projected score is better. Only
labels differ. Race axis ticks and readouts show seconds (`B − y`), and 1 s = 1 point.
Accumulated totals come from `u`, never from integrating the smoothed local line.

**Exact readout.** The cumulative comparison at `x` is `Δu`, current minus baseline:

- `clock`: `S_cur(x) − S_base(x)` points.
- `race`: `t_base(x) − t_cur(x)` seconds. Positive means ahead.

At rest it is the CSV score difference, and on inspection the interpolated value at the
inspected `x`. The shaded gap between accumulated lines is a pace difference, and the
readout is never derived from it.

**Recent range.** Mean ± one standard deviation of accumulated pace over comparable
prior runs (inspected run excluded), evaluated at the inspected run's own `x`
values. No grid is invented. The sample count is carried alongside, so the page can
apply its rules for fewer than ten runs and for a single run.

### D6. Local pace is marginal, not isolated

For multiplier scoring, local pace is `ΔS` over the window: what the window
actually added to the final score. That includes a miss lowering the multiplier on
earlier kills. The alternative is scoring the window's own counters with the scenario's
formula ("how good was this stretch on its own"). That was rejected for now: it
needs a formula per scenario, which D1 removes, and it no longer adds up to
the final score. If it is wanted later, it is an optional per-scenario
`isolatedLocal` hook and leaves the rest of this model unchanged.

### D7. Rank thresholds are horizontal lines with no reverse conversion

Not implemented in this slice. The y-axis is already in score units, and every
benchmark threshold is a fixed score, so a band is `[s_k, s_{k+1})` on that axis
for both kinds. Races only relabel it as a time, `B − s`. The later rank work needs
threshold data and scenario mapping, not a pace conversion.

### D8. Bots touch the model only through x placement and Δu

Per-bot metrics (TTK, accuracy, damage, overshots) come from the kill table and do
not depend on the scenario kind. The model gives the bot breakdown exactly two
things:

1. **Placement.** Encounter `k` spans `x` from the previous kill to kill `k`. For races
   that is `[(k−1)/N, k/N]`, identical across runs. For clock scenarios it is
   `[t_offset_{k−1}/T, t_offset_k/T]`, per run, with the first encounter starting at 0.
2. **Contribution.** `Δu` across that span. Race: seconds spent on bot `k`, including
   its share of respawn gap. Clock: points gained during the encounter.

Runs with no kills (invincible tracking, 1,152 / 2,487 runs) have no encounters. That
is a normal case, not an error.

### D9. Pure TypeScript over one query, memoised per run

- **One query** per Run view selection fetches, for the inspected run plus its
  comparison candidates, `run_series.t`, `score` and `damage_done`;
  `run_perf.time_limit`, `timescale` and `end_challenge_after_kills`; kill
  `t_offset`s; and `run.score` and `damage_done`. That is arrays only, with no per-tick rows.
- **Cost.** A run is 45–125 ticks (median 60). Building `(x, u)`, both pace lines
  and an interpolation is `O(n)` per run. The inspected run, a PB and ~10 recent runs
  come to roughly 1.5k points in total. This runs on the main thread with no worker and
  no SQL-side math.
- **Memoisation.** Runs are immutable after ingest, so `(x, u)` is cached by run id.
  Pace lines are cached by `(run id, w)`.

## Module map

```
src/lib/scoring/
  classify.ts   D3: kind + parameters (T | B, P, N) from one run's perf rows
  curve.ts      D4: (x, u) construction, race kill knots, interpolation at x
  pace.ts       D5: project(), accumulated and local pace, gaps
  compare.ts    D4/D5: comparability, exact readout, recent range
  index.ts      public types and a memoised curveFor(run)
src/lib/run/queries.ts   the series query (D9)
```

Public shape (indicative):

```ts
type ScoringKind = 'clock' | 'race' | 'unsupported';

type ScoringParams =
	| { kind: 'clock'; durationS: number }
	| { kind: 'race'; budget: number; pool: number; bots: number }
	| { kind: 'unsupported'; reason: 'kill-capped' | 'signals-disagree' | 'no-score-series' };

interface RunCurve {
	params: ScoringParams;
	t: Float64Array; // seconds
	x: Float64Array; // progress 0..1, non-decreasing
	u: Float64Array; // clock: running score; race: seconds spent
	score: number;   // CSV score, the authoritative endpoint
}

interface PaceLines {
	x: Float64Array;
	accumulated: Float64Array; // projected final score; NaN = gap
	local: Float64Array;       // projected final score; NaN = gap
}
```

## Testing

- **Unit tests over curated fixtures** (one race pair, one clock tracking pair, one
  multiplier pair, one penalty pair): classification, the endpoint identity, and the
  sign of the race readout.
- **Corpus invariants** in a new `test/fixtures/scoring-corpus.test.ts`, guarded by
  `raw.available` like the existing ingest sweep. These are the checks whose absence
  would let a real defect through silently:
  - kinds partition as measured (153 race, 2 unsupported, the rest clock) with no hash
    in two kinds;
  - the accumulated endpoint equals the CSV score: clock within float tolerance, race
    within 0.05 s;
  - race `(x, u)` with kill knots is non-decreasing in both coordinates;
  - the recent range never includes the inspected run.
- Not tested: chart rendering, and the choice of `w`.

## Risks

- **Undocumented formats.** Both race signals read vendor behaviour (the 1000
  sentinel, the countdown). A change degrades to `unsupported`, not to a wrong axis.
- **1 Hz resolution.** Clock pace cannot resolve detail finer than a tick. Races get
  exact kill knots, but between knots progress is still tick-sampled.
- **Early noise.** Projection from a few seconds of data swings widely. The `t ≥ w`
  gap is the only guard. A larger minimum for accumulated pace can be added if the
  line is misleading in practice.
- **Single-player corpus.** Scoring families absent here are expected to be `clock`
  and to just work (D1), but that is untested.
