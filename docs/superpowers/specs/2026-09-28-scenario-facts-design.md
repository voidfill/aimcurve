# Scenario facts: bot splits, dead time and score breakdown from run data

One system that replaces how the app splits a run between bots. It measures each
scenario's respawn behaviour and each run's scoring from the only files the app gets
(the `Stats.csv` and the `.perf`), stores per kill only what no scenario-level value
depends on, and computes every split, dead-time figure and bot value in SQL when a
page asks.

Prerequisites: [scoring model](2026-09-24-scoring-model-design.md) (D1, D2 and D8
are amended here), [run view](2026-09-24-run-view-design.md) (R3–R6: chart
encounters and the bot table), [scenario page](2026-09-25-scenario-page-design.md)
(S6 bot tabs), [about page](2026-09-26-about-and-embeds-design.md) (the demo run's
bot table), [run schema](2026-09-18-run-schema-design.md). Evidence:
[`scenario-facts.md`](../../scenario-facts.md), the research record. Numbers below
come from it or from the checks in
[Evidence and how each rule could fail](#evidence-and-how-each-rule-could-fail).

Out of scope: reading `.sce` files (infeasible; see the research record), dead time
for switching scenarios (decided: none), correcting paused runs (they are excluded),
blocker-bot detection, projectile weapons (see the failure modes), and layout changes
beyond the values the tables, chart and tabs already show.

## Summary of decisions

| | |
| --- | --- |
| F1 | One split formula for every kill: `split = clamp(min(ttk, gap − d − lag), 0, gap)` |
| F2 | Each kill's logging lag comes from its own CSV `OverShots` |
| F3 | The hittable delay `d` is measured per killed bot; it's 0 for the first kill and in multi-target scenarios |
| F4 | Points come from each run's fitted scoring formula over exact counts, not from interpolating the running score |
| F5 | Each run's scoring formula is fitted at ingest; the scenario's label is the formula most of its runs agree on |
| F6 | `classify()` handles timescale and a near-1000 time limit; race elapsed time comes from the score |
| F7 | Paused runs are left out of every kill-based value |
| F8 | Ingest stores per-kill and per-run values that no scenario-level value depends on; scenario values are SQL aggregates at query time |
| F9 | The old rules, their loaders, and the demo snapshot's slot stats are removed or replaced |

---

### F1. One split formula for every kill

For kill `k` of a run:

- `gap` is the seconds since the previous kill's CSV time, or since challenge start.
  It's unwrapped at midnight, as `killTimes` does.
- `ttk` is the CSV TTK.
- `d` is the hittable delay of the bot killed at `k − 1` (F3).
- `lag` is kill `k`'s logging lag (F2).

```
split_k = clamp(min(ttk_k, gap_k − d − lag_k), 0, gap_k)
dead_k  = gap_k − split_k
```

In the run's own CSV clock, the engagement for the chart and the tables runs from
**start** to **end**:
- `start_k` = `end_k − split_k`, where `end_k` = CSV time of kill `k` − `lag_k`.
- For every kill with a measured `d`, that start equals the previous CSV kill + `d`,
  unless the TTK cap binds.
- **The first kill** counts from challenge start, which acts as kill 0: its CSV time
  is 0, all its counts are 0, and `d` is 0. So `split_1 = min(ttk_1, gap_1 − lag_1)`.
- **After the last kill.** On a clock run, the time from the last kill's `end` to the
  run's duration, and the points scored in it, go to the dead-time row, as
  `clockRows` does today. That covers the respawn and the unfinished bot, whose name
  the CSV doesn't give. So rows plus dead time still add up to the duration and the
  final score. A race ends at its last kill, so it has no tail.

`encounters()` places the chart spans at those times, and the table's dead-time row
sums `dead` (plus the tail on clock runs).

What derives from the split:

- **race slot pace** = `split × slots × timescale`;
- **clock bot time** = Σ `split` over the bot's kills;
- **best split** = the smallest `split` per slot over comparable runs.

A split clamped to 0 means the inputs are wrong for that kill. It's left out of best
split and pace, not counted as a 0 s split.

`min(ttk, …)` is the timed-bot term: see F3's fixed-window estimate and failure mode
"bots in one rotation with different lives".

By scenario kind:

| scenario kind | `d` | result |
| ------------- | --- | ------ |
| single target (Air Spectral, Air Pure, CELESTIAL, Sparky) | measured per killed bot | the real engagement; the respawn and the logging lag become dead time |
| timed bots (VT PGT/Aether/Ground, Plink Palace) | measured, with the fixed window as extra evidence (F3) | matches today's `fixedWindow` within 0.01 s |
| several targets at once (the `.perf` `added_bots` has more than one entry; a `.rot` rotation counts as one) | 0 | `split ≈ ttk`, as today; dead time is not shown (decided) |
| click scenarios (the run's `isClicking`) | — | no per-bot breakdown, as today |
| no `d` estimate yet (a new scenario, semi-auto) | 0 | the respawn counts as engagement; the page says the respawn isn't measured yet |

### F2. Each kill's logging lag comes from its own `OverShots`

The CSV logs a kill when the scenario's overshot protection ends, not when the bot
dies. Shots fired during the protection aren't counted as shots anywhere: not in
the `.perf`, the weapon row or the kill rows. They're counted only in the kill row's
`OverShots`.

The protection ends in any of these cases:
- its timer runs out;
- the player releases the trigger;
- the challenge ends;
- the player damages something (a vendor rule; it matters when the next bot is up
  before the protection ends, as on Plink Palace, and in multi-target scenarios).

So:

```
lag_k = (OverShots_k + 1) ÷ r
```

- `r` is the scenario's fire rate (F3).
- The `+ 1` is one shot interval. It's the small constant every TTK leftover shows:
  0.01 s at 100 shots/s, 0.036 s at 28/s.

**The fire rate `r`** is the larger of:
- the most shots in any complete tick of any of the scenario's runs;
- the largest `(shots − 1) ÷ TTK` over held kill rows.

The kill-row term matters in switching scenarios, where nobody holds fire for a whole
tick, so ticks alone underestimate the rate. There, a low `r` would make every lag
0.02–0.055 s too long, and push the hit bound below the truth.

This replaces a per-scenario lag estimate. It handles players who release fire and
the last kill of a run with no special case:
- a held kill logs the full protection (Air Pure 25 overshots → 0.26 s);
- a kill that ends the run logs 0;
- a kill cut short by the time limit logs what was left (Plink's last kill: 10 →
  0.11 s).

### F3. The hittable delay is measured per killed bot

`d` is how long after the previous kill's CSV time the next bot can first be hit. It
belongs to the bot that was **killed**: the game applies the killed bot's respawn
delay (test 4). Two estimates, per scenario hash and killed bot:

1. **Hit bound.** For each gap:
   - The hits counted up to the previous kill equal the kill rows' running hit sum
     exactly. So the next bot's hits are the `.perf` running hit count minus that
     sum.
   - Take the first `.perf` tick that ends after the previous kill's CSV time and
     before this kill's, and whose running hits exceed that sum. That tick may start
     before the CSV kill time.
   - Ingest stores, per kill, that tick's end relative to the previous CSV kill
     (`t_rel`) and `h` = its running hits minus the sum.
   - At query time, with the scenario's `r` (F2):

     ```
     bound = t_rel − (h − 1) ÷ r
     ```

     `h` hits take at least `h − 1` shot intervals, so the bot was hittable no later
     than `bound`.
   - The estimate is the smallest bound. If it's more than 0.1 s below the second
     smallest, the second smallest is used instead.
2. **Fixed window.** Apply the existing `fixedWindow` test: every slot's TTK is the
   same run to run. When it passes:
   - `W` = the first slot's TTK. The first bot is up at challenge start, so `W` is
     its life.
   - For the kill after this bot, `d_window = gap − W − lag`.
   - Per killed bot, the estimate is the median of `d_window` (median and minimum
     differ by at most 0.007 s on the data here).
   - It assumes every bot in the rotation lives as long as the first. The TTK cap in
     F1 covers bots that don't (see failure modes).

`d` = the smaller of the two, and may be negative. That happens when the protection
is at least as long as the respawn, so the next bot is up before its predecessor's
kill is logged: Plink Palace's true `d` is −0.01 s.

`d` is 0 for the first kill of a run and in multi-target scenarios. Estimates only
come from:
- runs that weren't paused (F7);
- full-auto weapons (fire rate at least 20 shots/s);
- single-target scenarios: the `.perf` `added_bots` has one entry.

The page shows `d` as an estimate with its kill count until the bot has at least 30
bounds. The measured spread of the smallest bounds doesn't shrink reliably (on Air
Pure the tenth smallest stays 0.08–0.15 s above the smallest after 54 runs), so no
spread-based "settled" rule is used.

### F4. Points come from the fitted formula over exact counts

Per-bot points on clock runs, and dead-time points, are the running score's change
over a stretch of time. The running score is only stored per ~1 s tick. Inside a
tick it isn't linear: hits come before a kill and misses after it, so interpolating
the score flattens the peak at each kill.

Points are instead computed from **counts** at the stretch's ends, through the run's
own fitted formula `f` (F5):

```
S(t) = f(damage(t), hits(t), kills(t), misses(t), damage taken(t))
bot points_k  = S(end_k) − S(start_k)
dead points_k = S(start_k) − S(end_(k−1))
```

The counts at each end:

- **At a kill.** Hits, damage and shots are exact at every kill: the kill rows'
  running sums, already in `kill_series`. They also hold at the bot's death, because
  nothing fired during the overshot protection is counted.
  - misses = shots − hits;
  - kills = the kill index.
- **At `start_k`.** The same counts as at the previous kill, plus the shots fired
  between the previous kill's CSV time and `start_k`. Those shots are all misses:
  no bot was up to hit. Most of them are counted exactly, the rest extrapolated:
  - **Exact part.** The last `.perf` tick end after the previous CSV kill whose
    running hit count still equals the kill rows' running hit sum lies inside the
    dead stretch.

    Ingest stores per kill:
    - `dead_t` = that tick end − the kill's CSV time;
    - `dead_shots` = the `.perf` running shots there minus the kill rows' running
      shot sum. Exact: no hits, so every counted shot is a miss.
  - **Extrapolated part.** From `dead_t` to `start_k` only (less than one tick). Use
    `next_rate` = the shot rate of the following tick, the first with the next bot's
    hits.
  - If no such tick end exists (the next bot was hit within the kill's own tick),
    then `dead_t = 0` and `dead_shots = 0`.

  ```
  x = start_k − CSV kill_(k−1)
  shots(start_k) = shots(kill_(k−1)) + (x ≤ dead_t ? dead_shots × x ÷ dead_t
                                                   : dead_shots + next_rate × (x − dead_t))
  ```

  Kill 0 (challenge start) has the same three values, so the first kill is computed
  the same way.
- **Damage taken.** It isn't in the kill rows. It's stored per kill the same way:
  at the kill's CSV time (shared by time within its tick) and at `dead_t`, with its
  own `next_rate`.

If `start_k` falls at or after `end_k` (split 0), there are no bot points. The whole
stretch is dead.

This amends scoring model D1 ("no scoring formulas"). The running score stays the
source of truth for curves, pace and the final score. The formula is only used to
split a stretch between bots and dead time. Under an accuracy multiplier, per-bot
points aren't additive, since every miss rescales all earlier points. That was true
before too.

### F5. Each run's scoring formula is fitted at ingest

Fit the run's running score (the cumulative `.perf` score ticks) against cumulative
damage, hits, kills, misses and damage taken, for each accuracy form {none,
√accuracy, accuracy}. MBS points enter as a known term, not a fitted one: the model
is `S = (a·damage + b·hits + c·kills − e·misses − g·taken + MBS) × multiplier`. This
is exactly what the quoted evidence fitted. It subtracted `MBS × multiplier` from the
score before fitting. Use least squares with a solver that drops dependent columns
(Gram–Schmidt): on one-hit targets damage = hits = kills.

- **The form:**
  - keep **none** when its largest residual is under 0.01% of the run's peak running
    score;
  - otherwise keep the form with the smallest residual, if that's under 0.2%;
  - otherwise the run has no formula.
- **A run's points use its own formula**, which is exact for that run. No pooled
  refit is needed.
- **The scenario's displayed formula** is the one most of its runs agree on. Terms
  that can't be told apart (per kill against per damage on one-hit targets) are shown
  as indistinguishable.
- **A run with no formula** shows splits and dead time, but no clock bot points or
  dead points. Today those runs do show interpolated bot points; that's a deliberate
  loss.

### F6. `classify()` handles timescale and a near-1000 time limit

- **Countdown test:** a race's score tick is `−timescale × tick length`, within 0.02
  per tick.
- **Sentinel:** `|time_limit − 1000| < 0.01`, not `=== 1000`. Flicker Plaza stores
  999.99994.
- **Race elapsed time** = `(time_limit − score) ÷ timescale`, taken from the score.
  It's exact and ignores pauses. It isn't the CSV's last kill or `Fight Time`.

### F7. Paused runs are left out of every kill-based value

A pause stops the `.perf` clock but not the CSV kill times, so every CSV kill after a
pause is misaligned with the ticks by the pause length.

- A run is **paused** if the CSV `Pause Count` is above 0 or the `.perf` has a pause
  event.
- Paused runs get no splits, dead time or bot points, and feed no scenario-level
  value.
- Their score, clock curve and pace are unaffected, because those come from ticks
  only.
- A paused **race** has no curve (its knots are kill times): `classify()` returns
  `unsupported: paused`.

### F8. Storage: nothing stored depends on a scenario-level value

**Per kill**, next to `kill_series` (plus kill 0, challenge start, per run):
- `gap`;
- `t_rel` and `h` for the hit bound (both nullable);
- `dead_t`, `dead_shots` and `next_rate`;
- damage taken at the CSV kill time and at `dead_t`, with its own `next_rate`.

Shots, hits, damage and overshots per kill are already in `kill_series`.

**When these are computed.**
- These per-kill values, the fire rate and the paused flag need the CSV's kill times
  and the `.perf`'s ticks together.
- Ingest parses each file on its own. A CSV and its `.perf` usually share a chunk,
  but not at a chunk boundary: unmatched `.perf` files are staged again and attached
  to earlier runs in `batch.sql`'s join (`src/lib/ingest/index.ts`).
- So they're computed where the two meet: in SQL at the `.perf` join, or in a
  post-pass over runs that have both files but no derived values yet.
- A run without a `.perf` has none of them. It gets no splits, as today.

**Per run**:
- classification: race or clock, duration, budget, pool, bots, or the unsupported
  reason;
- `isClicking` and paused;
- fire rate: the most shots in any complete tick;
- the fitted formula: the form plus five coefficients.

**Per scenario, nothing is stored.** `r`, `d` per killed bot, the fixed-window test,
the scenario kind and the displayed formula are SQL aggregates over the scenario's
per-kill and per-run rows. Splits, dead time, bot time, points, pace and best split
are SQL expressions joining those aggregates to the kill rows. All of it runs in the
database worker when a page asks.

- New runs change the result simply by being there. Nothing stored has to be
  revisited, versioned or rebuilt.
- Deleting or reingesting a run needs nothing special.
- Changing a per-kill definition is a migration plus a reingest, as for any other
  schema change.

Cost: a scenario is at most a few thousand kills. The `kill` view already unnests
`kill_series`, and the per-slot aggregate `getSlotStats` runs today on every page
load. Everything needed is plain Postgres, which PGlite supports:
- the two smallest bounds per killed bot: `(array_agg(x order by x))[1:2]`;
- the `d_window` median: `percentile_cont`;
- per-slot `stddev_pop` over the unnested ordinality;
- `lag()` and running `sum()` for gaps and counts;
- a `CASE` on the run's formula form.

These are of the same order as today's query.

### F9. What is removed or replaced

- **Removed** from `src/lib/run/bots.ts` and `src/lib/run/queries.ts`:
  - `engagements()`'s `kill − ttk` rule;
  - `fixedWindow()`, `getSlotStats()`;
  - `deadTime()`;
  - the interpolated `gained()` in `clockRows()`;
  - the misleading header comment (the "0.26 s respawn gap" on Air Pure is the
    logging lag).
- **Replaced by one query each:**
  - `useScenario.computeBots`' loading of every run's ticks and kill detail;
  - `useRunAnalysis`'s `raceCandidates` loading of every race run.
- **Replaced by SQL:** `Loader.walk`'s loading of ticks only to learn which runs
  compare. Comparable runs are picked in SQL from the stored classification; only the
  curves the chart draws load.
- **`DataSource`** (`src/lib/data-source.ts`):
  - `getSlotStats` goes;
  - a method returning a run's splits, dead time and points (and a scenario's bot
    series) takes its place.
- **The other callers of the bot functions:**
  - `src/lib/scenario/bots.ts` (`botTabs` and the bot series call `engagements`,
    `clockRows`, `raceRows` and `isClicking`);
  - `src/composables/useRunCharts.ts` (`engagements`, `bestSplits`, `raceRows`,
    `clockRows`, `encounters`).

  Both move to the new values.
- **Tests that pin today's numbers:** `bots.test.ts`, the `useRunCharts` test and
  `snapshot.test.ts` are rewritten against the new values.
- **Demo snapshot** (`src/lib/demo/snapshot.ts`, `build.ts`, `snapshot.test.ts`,
  `src/data/demo-snapshot.json`):
  - it must carry those precomputed values, because the About page must not load
    PGlite;
  - the snapshot is regenerated;
  - About's Air Spectral figures change. Splits for kills 2–6 drop by about 1.5 s
    each; the first kill's doesn't change (its `d` is 0). That's 1.26 s on average.
- **Preview images:** About runs the real `useRunAnalysis` and `useRunCharts`
  (`useDemoRun.ts`), so `public/og.png` and `docs/images/{pace,bots}.png` change. They
  need `pnpm shots`, per [`preview-assets.md`](../../preview-assets.md).

## Evidence and how each rule could fail

**What "truth" means here.** The checks compare the formula's output with a truth
built from the `.sce` of each scenario on this install, joined by hash:
- **death** = CSV kill time − the lag;
- **hittable** = death + the configured respawn delay and animation ÷ timescale;
- **truth split** = hittable to death, capped by the bot's decay life where the
  `.sce` gives one.

That truth shares the model's structure. So the table below measures **how well the
run-data estimates recover the true parameters under the model**, not the model
itself.

The model's structure is validated separately:
- **the killed bot's delay applies:** test 4, 22 of 22 gaps;
- **timescale scales the delay and the animation:** test 1, 4.0 s bracketed at
  4.006–4.025 s;
- **the lag:** the `.perf` kill-tick offsets fit every run of Air Pure (54/54),
  CELESTIAL (15/15) and Spectral (67/67). Test 2's overshots equal its 0.5 s
  protection on every held kill;
- **`OverShots` gives the lag.** For held fire, `gap − ttk = (OverShots + 1) ÷ r`
  within ±0.01 s on every kill checked:
  - Air Pure: 228;
  - CELESTIAL: 105;
  - Sparky: 305;
  - Plink Palace: 118, plus 59 last kills cut short by the time limit;
  - Air Spectral: 350;
  - tests 1, 3 and 4;
  - switching scenarios at timescales 0.69–2.0.

  Against the `.perf` kill-tick bounds it holds on 68,576 of 68,590 kills across
  every scenario, within 0.02 s. The 14 failures are switching scenarios whose fire
  rate was underestimated from ticks alone, which the kill-row term in F2 fixes. On
  test 2's release-fire run, `gap − ttk − lag` is never below −0.002 s. That fits TTK
  starting at or after the protection ends.
- **Counts are exact at every kill.**
  - `.perf` shots equal the weapon row's shots in every run checked (57/57 Air Pure,
    59/59 Plink, and the rest).
  - The kill rows' running shots and hits equal the `.perf`'s at every tick inside a
    protection window: 247/247 ticks on Air Pure, Plink, Sparky and test 2.
  - So nothing fired during the protection is counted.

### Split formula (F1–F3)

The truth's lag for a run's last kill comes from `OverShots`, the same source as the
estimate, so last kills are not independently checked. Every estimate uses run data
only; `d` is estimated in-sample over all the scenario's runs. The numbers are over
the runs parsed on 2026-09-27; the install has gained a few since (Spectral 420 kills
against 402, Air Pure 285 against 270). The re-implementation below used the newer,
larger set and agrees.

With F1–F3's final rules (lag `(OverShots + 1) ÷ r`, the tighter hit bound):

| scenario | kills | mean error | largest error | today, mean error |
| -------- | ----- | ---------- | ------------- | ----------------- |
| Air Spectral Easy | 402 | −0.014 s | −0.018 s | +1.242 s (`kill − ttk`) |
| Air Pure Medium | 270 | −0.015 s | −0.022 s | +0.592 s |
| Air CELESTIAL No UFO Easy Slowed | 120 | −0.018 s | −0.024 s | +1.085 s |
| Ground Plaza Sparky V3 | 348 | −0.013 s | −0.018 s | +1.109 s |
| VT PGT Intermediate S5 | 147 | +0.045 s | +0.068 s | +0.048 s (`fixedWindow`) |
| VT Aether Intermediate S5 | 216 | +0.023 s | −0.124 s | +0.027 s (`fixedWindow`) |
| VT Ground Intermediate S5 | 252 | +0.024 s | +0.037 s | +0.028 s (`fixedWindow`) |
| VT Aether Novice S5 Hard Bot 1 90% | 171 | −0.007 s | −0.010 s | −0.002 s (`fixedWindow`) |
| Plink Palace Easy | 168 | −0.004 s | −0.013 s | −0.004 s (`fixedWindow`) |

- The tighter hit bound (F3) removes Air Pure's earlier slack: with the looser one it
  was −0.039 s mean, −0.088 s worst.
- The VT and Plink rows only show that the new formula matches `fixedWindow`, which
  the app applies there today.
- VT Aether's largest error (−0.124 s) is one kill with a 0.134 s TTK leftover and 0
  overshots. That contradicts "with no protection, releasing fire makes no
  difference" for that one kill. Unexplained.
- The VT residual of +0.02–0.05 s is most likely an error in the truth, not in the
  estimate. The effective delay run data measures is 1.40–1.41 s, against 1.45 s
  configured (1.48 s on PGT). The difference is unexplained.
- An independent re-implementation of the rules reproduced every row within
  0.003 s.

**Early in a scenario's life** it's worse. Using only the runs before each one:
- Air Pure's mean error is −0.059 s, worst −1.11 s;
- Air Spectral's unsettled kills average −0.044 s, worst −0.65 s;
- a scenario's very first run has only its own kills to estimate from.

The error is always toward **short** splits, because the bound only ever
over-estimates `d`. Hence the kill-count label in F3.

**How it could fail, and what was seen:**

- **Overshot protection longer than the respawn.**
  - TTK then starts after the next bot spawned, so `min(ttk, …)` undercounts the
    engagement by the difference.
  - 101 played scenarios have protection at least as long as their respawn, but
    almost all are multi-target (0.25 s protection against a ~0.001 s respawn, where
    `d` = 0 anyway) or click scenarios (no breakdown).
  - Single-target exceptions include KovaaKs Sandbox Intro (0.25 s against 0.2 s).
  - Plink Palace (1.5 s against 1.5 s) is within 0.013 s.
  - **Not validated** where protection clearly exceeds the respawn.
- **Players who release fire.**
  - `OverShots` gives their real lag, so the lag itself is right.
  - But with protection above 0, TTK starts at their next trigger press. So
    `min(ttk, …)` counts their hesitation after the spawn as dead time. Test 2's
    release run shows TTK leftovers up to 1.31 s against 0.5 s held.
  - The split is then short by that hesitation, and best splits favour players who
    release fire.
  - Accepted (decided); tested on one release-fire run per test only.
- **Bots that can't be hit right after spawning** (out of view, say) make the bound
  loose, so `d` comes out too large and splits too short.
  - VT Ground's first bot: smallest bound 1.625 s against a 1.45 s delay. The
    fixed-window estimate corrects it to 1.405 s.
  - Without a fixed window nothing corrects it. With the tighter bound (F3), the
    per-bot `d` on Air Pure is 0.759–0.762 s against a true 0.740 s.
- **A bound below the truth** would make `d` too small and splits too long.
  - It would come from a too-low fire rate, hits on another bot, misaligned clocks or
    a pause.
  - Each is guarded: the fire rate is the scenario-wide maximum, and only
    single-target, unpaused, full-auto runs are estimated from.
  - One bad kill is caught by the second-smallest rule.
  - On the 8 single-target scenarios with a `.sce` and on tests 1–3, no smallest
    bound fell below the truth by more than 0.001 s. That includes the paused run
    once its shift was applied.
  - On test 4, every bracketed gap agreed with the killed bot's delay within the
    0.02 s tolerance used.
- **Bots in one rotation with different lives** break the fixed-window estimate.
  - Plink's third bot lives 18.9 s against 19.0 s. Its `d_window` for the second
    bot comes out −0.093 s against a true −0.01 s.
  - The TTK cap in F1 absorbs it: Plink's splits stay within 0.013 s. So the Plink
    row is evidence for the cap, not for the window estimate.
- **Random respawn delays** (`UseMinimumRespawnTime=false`, Min < Max). `d` becomes
  the shortest delay seen, so splits run long by up to Max − Min.
  - Sparky (1.49–1.51 s) is within 0.018 s.
  - Wide ranges (1–5 s) are **not validated**: 2 runs of one such scenario exist.
- **The first bot might not be up at the start.**
  - The first-hit bound from the start is 0.008–0.05 s on the well-sampled
    single-target scenarios (49–84 runs each), Plink included (0.048 s).
  - It's up to 0.29 s on scenarios with 3–10 runs, which is expected of an upper
    bound over few kills.
  - Test runs: 0.04–0.16 s.
  - No first bound came near a respawn delay.
- **A negative `d`** is legitimate (protection ≥ respawn) and allowed. The F1 clamp
  and the TTK cap keep splits within `[0, gap]`.
- **The check "split ≥ hits ÷ fire rate"** held on all 2094 kills. Its smallest
  margin is 0.94 s, so it can't detect `d` errors under about a second. It's a sanity
  check, not evidence of precision.

### Logging lag (F2)

- **Evidence.**
  - **Held fire:** `OverShots` equals the protection × fire rate on every non-final
    held kill checked (test 2: 50 = 0.5 s × 100/s; Air Pure 25; Plink 150).
  - **Last kill of a kill-ended run:** 0 overshots. The kill is logged 0.012–0.03 s
    after the `.perf` kill tick (5 of 57 Air Pure races run that high), slightly more
    than the one shot interval F2 adds.
  - **Plink's time-limited last kill:** 10, which matches its measured lag of about
    0.1 s.
  - **Test 2's release run:** 6–32 overshots per kill, consistent with its `.perf`
    lag limits.
- **How it could fail.**
  - **Semi-auto weapons** with protection above 0: `r` is then the click rate, not
    the weapon's. Click scenarios get no breakdown anyway. Semi-auto single-target
    tracking isn't known on this install.
  - **Reloads during the protection:** fewer overshots than the time elapsed, so the
    lag is understated. Not checked.
  - **Protection that doesn't end on release** for some weapon type: the lag would
    then be understated for release-fire kills. Test 2's release run is consistent
    with release ending it; one run.

### Points (F4)

- **Evidence.** Test 3 (20 s clock, (damage − 0.5 × misses) × accuracy, 3 s respawn,
  overshot 0, 100 hits per bot). Its first run held fire; its second didn't (ticks
  of 65, 87, 47, 2 and 51 shots, and one missing). Dead points per respawn on the
  held-fire run, using the estimated `d` (3.088 s against a true 3.0 s):

  | respawn | counts through the formula | reference | interpolated score |
  | ------- | -------------------------- | --------- | ------------------ |
  | 1 | −97.01 | −96.25 | −76.84 |
  | 2 | −39.54 | −38.82 | −23.03 |
  | 3 | −32.95 | −32.23 | −25.68 |
  | 4 | −29.87 | −29.17 | −20.34 |

  - The reference assumes shots are evenly spread in time (held fire makes that
    close to exact) and uses the configured 3.0 s. So it differs from the method only
    in `d`: the ~0.7 point gap is the 0.088 s overestimate of `d`, about 8.8 extra
    misses.
  - It doesn't exercise the fitted formula, the stored dead-stretch values, or overshot
    above 0.
  - Interpolating the running score comes out 20–40% short. That's why it isn't
    used.
- **How it could fail.**
  - **Overshot above 0.** The counts at a kill are confirmed exact there too (the
    247-tick check above). On Plink the dead stretch *is* the protection, so the true
    dead points are 0, which is what F4 gives. The counts between a kill and the
    next bot haven't been checked on an overshot > 0 scenario.
  - **Uneven firing between a kill and the next bot** (released fire, reloads).
    - An earlier draft extrapolated one `rate_after` over the whole stretch. On test
      3's release-fire run it undercounted the misses before the next bot by 10–33%
      per respawn: 138/91/126/116 against 152/136/139/153.
    - F4 now counts them exactly up to the last hit-free tick, and extrapolates only
      the final part-tick.
    - That was checked only against a reference built on the same exact counts. The
      part-tick extrapolation itself is **not validated** against an independent
      truth.
  - **Damage per hit that varies** (falloff, headshots): damage is exact at kills,
    which is all F4 reads, so it's unaffected.
  - **MBS points and distance scoring** aren't in the counts. 4 runs here score MBS
    points; they may fit no form and then get no points (F5). Not checked.
  - **Coverage.** No single-target clock scenario with killable bots has more than 2
    runs on this install. Clock bot points and dead points for that case rest on test
    3's 2 runs.

### Scoring formula (F5)

- **Evidence**, with F5's rule (none under 0.01%, otherwise the best under 0.2%):
  - all 2113 clock runs with a `.perf` and a `.sce` fit;
  - the form matches the `.sce` in 2109;
  - the formula fitted on each scenario's first run predicts all 1850 later runs'
    final scores within max(0.05, 0.2%);
  - test 3's combined miss penalty and accuracy multiplier is recovered exactly from
    one run, and the other forms leave 5–29 points of residual.
- **A looser rule fails:** "the plainest form under 0.2%" matches the form in only
  1861 of 2113 runs, and turns 248 √-accuracy runs plain. It's not used.
- **How it could fail.**
  - **Near-constant accuracy** lets the plain form absorb the multiplier: 4 of 2113
    runs. Harmless for a run's own points, since its own fit reproduces its own
    score. It only affects the scenario's label, which follows the majority.
  - **A term the run never exercises** fits as 0. Harmless for that run's points,
    for the same reason.

### `classify()` (F6)

- **Evidence.**
  - All 3 runs of test 1 (timescale 0.5) return `signals-disagree` today.
  - With the scaled countdown their ticks pass: the paused run's shortened tick is
    −0.350 against −0.364 expected.
  - Elapsed time from the score: 48.472 s against the `.perf` end of 48.474 s.
- **How it could fail.** A race that scores time with a factor other than 1
  (`ScorePerTime` ≠ 1). None of the 11 race scenarios here does. The countdown test
  would reject it, which is safe.

### Pauses (F7)

- **Evidence.**
  - 10 of 2736 runs paused, 7 of them with kills.
  - In the paused test run, CSV kill times after the pause are 4.28 s later than the
    `.perf`'s.
- **How it could fail.** A pause neither file records. None seen: in all 4 paused
  runs with a `.perf`, the CSV `Pause Count` and the tick-grid jump agree.

### Other failure modes

- **Projectile weapons:** travel time delays hits, so the bound over-estimates `d`
  by the travel time and splits come out short. Not checked: every scenario in the
  tables uses a hitscan weapon, but no projectile scenario was examined.
- **Reloads during a respawn:** the counted misses stay exact up to the last
  hit-free tick (F4). Only the part-tick extrapolation is affected. The hit bound
  stays safe.
- **Deletion or reingest:** nothing stored per scenario, so nothing to rebuild.

## Data limits

- One player, who holds fire as a habit, on one install, plus 11 runs of 4 test
  scenarios.
- Release-fire behaviour has one run per test.
- Not validated:
  - protection longer than the respawn in single-target scenarios;
  - wide random respawn delays;
  - F4's counts between a kill and the next bot with overshot above 0;
  - F4's part-tick extrapolation under uneven firing;
  - the 0.05 s effective-delay difference on VT Aether, Ground and PGT, which affects
    nothing because `d` is measured.

## Testing

- **Fixtures.** Curated runs, with their `.sce` values written into the fixtures as
  expected parameters:
  - Air Spectral Easy, Air Pure Medium, VT Aether Intermediate S5, Plink Palace Easy;
  - a switching scenario and a click scenario;
  - the 8 test-scenario runs and 3 mixed-rotation runs;
  - the paused test run.
- **Unit.**
  - The split formula's clamps and each row of the F1 kinds table.
  - The hit bound with gap-aware tick starts, and the second-smallest rule.
  - The lag from `OverShots`, including a kill that ends the run and a time-limited
    last kill.
  - Count-based points against test 3, within 1 point per respawn.
  - The fit's form rule on a near-constant-accuracy run.
  - `classify()` at timescale 0.5 and time limit 999.99994.
  - A negative `d`.
- **Corpus regression.** Over `test/fixtures/raw`, recompute the split-error table
  from each scenario's `.sce` values. It fails when a scenario's mean error passes
  0.1 s.
- **Demo snapshot.** The regenerated snapshot's bot table matches the SQL values for
  the same run.
