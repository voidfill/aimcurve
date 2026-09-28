# Scenario facts from run data

Research notes, not yet implemented. What the app can learn about a scenario (how it
scores, how its bots behave, when each bot can be hit) from the only files it gets:
the `Stats.csv` and the `.perf`. It started as a dead-time bug on Air Spectral Easy.

**The design that follows from this research is
[`superpowers/specs/2026-09-28-scenario-facts-design.md`](superpowers/specs/2026-09-28-scenario-facts-design.md).
Where this record and the spec differ, the spec is current.** The record keeps the
research in the order it happened, including conclusions later revised; the last
section, [Per-kill lag from `OverShots`](#per-kill-lag-from-overshots-2026-09-28),
supersedes the lag and dead-points material before it.

The scenario definition files (`.sce`) hold all of this directly, but the app can't
get them reliably (see [Reading `.sce` files: infeasible](#reading-sce-files-infeasible)).
They were used as **ground truth** instead: every rule below was checked against
the real `.sce` values of the scenarios it was measured on.

[`perf-format.md`](perf-format.md) covers what is inside a `.perf`,
[`ingest.md`](ingest.md) how it pairs with its CSV.

## How this was worked out

Done on 2026-09-27 and 2026-09-28, on one install:

- **Ground truth.** 391 `.sce` files: 363 Steam workshop scenarios and 28 local ones.
  They were parsed as INI (below), skipping the `[Map Data]` block.
- **Runs.** 2703 Stats CSVs and their `.perf` files from the same install.
- **Join.** The CSV `Hash:` line (and `.perf` `scenario_hash`) is the **MD5 of the
  `.sce` file**: `28c12fc03478e987f910709ce18a5cfa` for Air Spectral Easy. So a run
  joins to the exact version it was played on. 2641 of 2703 runs had their file on
  disk. The other 62 belong to 15 scenario versions: 14 no longer installed, and 1
  since updated.
- **Bots.** Every kill row's `Bot` names a `[Bot Profile]` in its file (74,589 of
  74,589 kills), so each kill resolves exactly to its bot and character profile.

The analysis scripts were throwaway and are not in the repo. Re-running any check
needs an install with workshop scenarios subscribed.

An independent review (a fresh agent, with no context from the research) checked
the doc against the code and the scripts on 2026-09-28. It found:
- the hittable bound as first written wasn't an upper bound;
- the query-time split formulas were missing clamps and edge cases;
- the claim that nothing scores during a respawn was wrong;
- `classify()` fails at timescale ≠ 1;
- the validation tolerances were looser than stated.

The sections below carry the corrections.

### The `.sce` format (for reference)

INI-like text with CRLF line endings. A header of `Key=Value` lines comes first,
then repeated `[Section]` blocks: `[Bot Profile]`, `[Bot Rotation Profile]`,
`[Character Profile]`, `[Dodge Profile]`, `[Weapon Profile]`, `[Aim Profile]`,
ability profiles, and `[Map Data]` (level geometry as JSON: ~700 KB of Air Spectral
Easy's 740 KB). The file embeds every profile it uses, so the loose
`.bot`/`.rot`/`.chr` files under `Saved/SaveGames` aren't needed. Values include
`;`-separated lists and `X=… Y=… Z=…` vectors.

## TTK: time since the previous kill, minus overshot protection

KovaaK's TTK has nothing to do with spawns. For each kill, with the trigger held:

```
TTK = (kill − previous kill, or challenge start for the first) − OvershotProtectionTimer − ~0.01 s
```

When overshot protection is above 0 and the player releases the trigger, TTK starts at
the first shot of the next press instead, so the leftover grows. Test 2 shows
0.22–1.31 s against 0.5 s held (see
[Test scenario results](#test-scenario-results-2026-09-28)). The ~0.01 s is scenario
time: it doubles at timescale 0.5.

Per scenario, the median of (gap since previous kill − TTK), over the 143 scenarios
whose median TTK is at least 0.05 s (below that, TTK starts at the first hit: click
scenarios):

- **114 of 143**: equals `OvershotProtectionTimer` + ~0.01 s, to within 0.02 s:
  - 0.25 → ~0.26: Air Pure, Air CELESTIAL, most switching scenarios.
  - 0.0 → ~0.009: Air Spectral, VT Aether, Ground, PGT.
  - The first kill works the same way, measured from `Challenge Start`.
- **8** older files don't have the field and show 0.24–0.28, so the default is 0.25.
- **The rest**:
  - Plink Palace (fixed window, timer 1.5, later kills leave 0.11).
  - Multi-target switching with sub-second TTKs (0.13–0.36), where kills overlap.
  - Two old files without the field: VT bounceTS Intermediate (0.335) and
    `air far long strafes %70` (random 1–5 s respawn, 2.4).

**What this means from run data alone:** the CSV gives the overshot protection
exactly (the median leftover above) but says nothing about respawns. A scenario's
respawn is always hidden in the TTK of the kill after it.

### The dead-time bug

`engagements()` in [`src/lib/run/bots.ts`](../src/lib/run/bots.ts) starts each
engagement at `kill − TTK` and counts the rest as dead time, which assumes TTK starts
at the spawn. So dead time only ever shows the overshot protection:

- Air Spectral Easy, a six-bot race with a 1.5 s gap between bots (see below):
  0.009 s × 6 ≈ **0.06 s** of dead time. Every split after the first is 1.5 s too
  long, and so is its pace.
- The file's header comment says Air Pure's "respawn gap (0.26 s)" is dead time.
  That 0.26 s is the 0.25 s overshot protection. Air Pure's real 1.0 s respawn is
  hidden in TTK the same way.
- `fixedWindow()` recovers the hidden reset on VT Aether, Ground and PGT, but only
  because their TTKs are identical run to run.

## When the next bot becomes hittable

The real start of each engagement. In `.sce` terms (validated below, and by test
scenarios 1 and 2 in
[Test scenario results](#test-scenario-results-2026-09-28)):

```
bot dies       at  death
CSV logs kill  at  death + lag             (lag = overshot protection with the trigger held; see tests)
next bot hittable  death + (respawn delay + RespawnAnimationDuration) ÷ timescale
               =   CSV kill + (respawn delay + animation) ÷ timescale − lag
```

- The respawn delay comes from the character profile of the bot that was **killed**
  (confirmed by test 4; see
  [Mixed-rotation test](#mixed-rotation-test-2026-09-28)):
  `MinRespawnDelay` when its bot profile has `UseMinimumRespawnTime=true` (most files),
  otherwise random in [Min, Max].
- **The spawn animation counts**: Air Spectral's `RespawnAnimationDuration=0.5` adds
  to its 1.0 s delay.
- **Timescale scales the animation too** (test 1: a 1.0 s delay plus a 1.0 s
  animation at timescale 0.5 gives a 4.0 s gap, not 3.0 s).

### Estimating it from `.perf` hit ticks

For each kill after the first, find the first one-second tick that starts after the
previous kill, ends before this kill, and has hits. With `h` hits in a tick ending at
`t_end`, and the weapon's fire rate `r`, the bot was hittable no later than:

```
bound = t_end − (h − 1) / r − previous kill
```

`h` hits take at least `h` shots, and `h` shots span at least `h − 1` shot intervals,
so the first hit can't be later than that. The bound is stored on the kill whose
bot it measures (the kill after the gap). It's null when no tick with hits fits
before the next kill.

Against the `.sce` values, for every scenario with one bot alive at a time
(estimate = minimum over every kill in every run):

| scenario | `.sce` | expected | estimate | kills |
| -------- | ------ | -------- | -------- | ----- |
| Air Spectral Easy | 1.0 respawn + 0.5 animation, overshot 0 | 1.5 | **1.506** | 335 |
| VT PGT Intermediate S5 Bot 1 | 1.48, overshot 0 | 1.48 | **1.494** | 12 |
| VT Aether Intermediate S5 | 1.45 (and 1.5), overshot 0 | 1.45 | **1.460** | 144 |
| VT Ground Intermediate S5 | 1.45 (and 2.0), overshot 0 | 1.45 | **1.456** | 168 |
| VT Aether Novice S5 Hard Bot 1 90% | 1.305 at timescale 0.9 | 1.45 | **1.449** | 114 |
| Air CELESTIAL No UFO Easy Slowed | 1.5, overshot 0.25 | 1.25 | **1.261** | 105 |
| Ground Plaza Sparky V3 | 1.49–1.51 + 0.1 anim, overshot 0.25 | 1.34 | **1.342** | 290 |
| Air Pure Medium | 1.0, overshot 0.25 | 0.75 | **0.762** | 216 |

Every estimate is at or above the expected value, by 0.001–0.014 s. The one
exception is 0.001 s under, which is within timing noise.

**A first version used `h / r` and called it a hard upper bound. It isn't:** it came
out below the `.sce` value in 6 of 8 scenarios. The independent review caught this.

These runs are from one player, who holds fire through respawns, which makes the
bound tight. The bound only holds when its inputs are right, so:

- **Fire rate `r`**: the most shots in any tick of one run is too low when the
  player never held fire through a whole tick (10 of 202 full-auto runs), and a too-low
  `r` pushes the bound below the truth. Take the maximum over the scenario's runs
  instead, and skip semi-auto weapons, where shot counts are the player's click rate.
- **Only one target up at a time**: hits on another bot (blockers, multi-bot
  scenarios) break the bound. Only estimate when the `.perf` header's `added_bots`
  shows a single bot or rotation.
- **One bad kill decides a minimum**, and a minimum keeps drifting down as kills
  accumulate. A low quantile (2nd–5th percentile) of the bounds is more robust. It
  needs the smallest few bounds kept, not just the minimum.
- **The two clocks are assumed to agree**: CSV kill times (`at_ms − start_ms`) and
  `.perf` tick times were never checked against each other. `curve.ts` already notes
  per-tick damage reaching a kill's share up to ~0.23 s before that kill is logged.
  The model's `− overshot protection` term fits a CSV that logs kills about the
  overshot protection late. This is an unverified assumption.
- **Only validated on one player.**

Limits:

- **Switching scenarios** (several bots alive, ~0.001 s respawn): the estimate stays
  at 0.3–0.9 s because one-second ticks are too coarse when the next target is already
  up. **Decision: no dead time for switching scenarios.** A test for when the
  estimate can be trusted: one target at a time (above), median TTK well above a
  tick, and a stable estimate (the tenth-smallest bound close to the smallest).
- **The first kill**: the first bot is up at challenge start in every single-target
  scenario checked, Plink Palace included (see
  [Answered from existing data](#answered-from-existing-data-2026-09-28)). So `d`
  is never applied to the first kill.
- **Fixed windows** (Plink Palace, VT PGT/Aether/Ground): `fixedWindow` already
  applies.
- **A scenario's first runs**: five kills give a rough estimate. It tightens as runs
  accumulate, so show it as an estimate until there are enough kills.
- **Mixed rotations** (VT Aether 1.45/1.5, VT Ground 1.45/2.0): the estimate lands on
  the shorter delay. Which bot's delay applies after a kill isn't established.

## Scoring

### The formula (exact for 2641 of 2641 runs with a `.sce`)

```
race (ScorePerTime > 0):
  score = Timelimit − ScorePerTime × elapsed × Timescale
  elapsed = seconds from Challenge Start to the last kill (real time)

otherwise:
  base  = ScorePerDamage × damage + ScorePerHit × hits + ScorePerKill × kills
        − ScoreLossPerMiss × misses − ScoreLossPerDamageTaken × damageTaken
        + MBS points
  score = base × (ScoreMultAccuracy ? (MultSqrtAcc ? √acc : acc) : 1)
               × (ScoreMultDamageEfficiency ? damage / damagePossible : 1)
```

`acc` = hits / (hits + misses). Every CSV `Score:` reproduced to within 0.1% (or 0.05
points). Terms exercised:

| term | runs | scenarios |
| ---- | ---- | --------- |
| per hit | 1067 | 135 |
| per damage | 725 | 79 |
| per kill | 617 | 84 |
| √accuracy multiplier | 268 | 17 |
| plain accuracy multiplier | 8 | 4 |
| race | 247 | 11 |
| timescale ≠ 1 | 361 | 51 |
| loss per miss | 74 | 14 |
| loss per damage taken | 53 | 4 |
| MBS points | 4 | 2 |

Not exercised: damage-efficiency multiplier (3 files, no runs) and
`ScorePerDistance`.

### Race findings

- **Elapsed time is not `Fight Time`.** `Fight Time` sums the TTKs, so it leaves out
  the overshot protection after every kill. Using it misses Air Pure Medium by 1.05
  points (4 × 0.26 s).
- **The countdown runs in scenario time**: real seconds × `Timescale`. `.perf` tick
  times are real seconds (a `Timelimit=60`, timescale-0.7 run ends at t = 85.7).
- **The budget is `Timelimit`, which isn't always exactly 1000.** Flicker Plaza rAim
  Easy Less Blinks has `Timelimit=999.999939` and `Timescale=0.9`: 999.999939 −
  97.531 × 0.9 = 912.22, exactly its score.
- **`classify()` gets races with timescale ≠ 1 wrong** (found by the review; worked
  out from the code, not run, because every race run with a `.perf` on this install is
  at timescale 1):
  - `isCountdown` expects each score tick to be −(tick length) within 0.02. At
    timescale 0.9 it's −0.9 × (tick length), so the countdown test fails.
  - With `Timelimit=1000`, the sentinel test passes and the countdown test fails:
    `signals-disagree`.
  - Flicker Plaza's `time_limit` (a `real`, 999.99994) fails the `=== 1000`
    sentinel too, so both tests fail. It falls through to **clock** with
    `durationS = 999.99994 / 0.9 ≈ 1111 s`: silently wrong, not
    `signals-disagree`.
  - Fix: scale the expected countdown step by timescale, and compare the sentinel
    with a tolerance.
  - The scenario bot tabs' race value `budget − pace` ([`src/lib/scenario/bots.ts`](../src/lib/scenario/bots.ts))
    mixes a scenario-time budget with a real-time pace. Pace needs scaling by
    timescale too.
- **The race formula's check covers timescale ≠ 1 through Flicker Plaza's CSV only**
  (4 runs, no `.perf`).

### Recovering the formula from one run

The `.perf` score ticks are the per-tick change in the running score. Accumulate the
ticks into running totals of score, damage, hits, kills, misses, damage taken and MBS
points. For each accuracy form p in {none, √, linear}, least-squares fit

```
score_i = (a·damage_i + b·hits_i + c·kills_i − d·misses_i − e·taken_i) × acc_i^p + mbs_i × acc_i^p
```

The script tried the forms in the order none, √, linear. It kept "none" when its
largest residual was under 0.01% of the run's peak running score. Otherwise it kept
the form with the smallest residual. When damage per hit is constant, the linear
form with a miss term reproduces the plain formula, so trying the plain form first
is what makes the choice correct. The solver has to cope with inputs that move
together (damage = hits = kills on one-hit targets): Gram–Schmidt that drops
dependent columns works, while plain normal equations produce NaN.

Over the 2113 clock runs with a `.perf` and a `.sce`:

- **Every run fits**: the largest residual is at most 0.2% of the run's peak running
  score. That's lenient, since running totals are strongly correlated tick to tick.
- **The accuracy form matches the `.sce` in 2109.** The other 4 are √-accuracy runs
  where accuracy barely varied, so the plain form fit by absorbing the multiplier into
  its coefficients. Trying the plain form first causes exactly this.
- **The formula fitted on each scenario's first run predicts the final score of all
  1850 later runs** of the same scenario version, within max(0.05 points, 0.2%).

The `.sce` formula check above used a tighter tolerance: 0.1% or 0.05 points.

Limits:

- **Terms that can't be told apart.** When damage per hit or hits per kill never
  varies, "10 per kill" and "10 per damage" give the same scores on one-hit targets.
  Predictions and score breakdowns are unaffected. Only the label (which term the
  author set) is a choice.
- **Terms a run never exercises.** A run with no misses or no damage taken fits with
  that coefficient dropped (the script set it to 0), so a later run that does miss
  can disagree.
- **Near-constant accuracy hides the multiplier** (the 4 runs above).

So the scenario's formula should be fitted on the pooled runs of the scenario, and
refitted when a new run disagrees. Its accuracy form stays undetermined until
accuracy has varied enough across the runs to tell the forms apart.

It enables, per run:

- A score breakdown: points from hits, damage and kills, points lost to misses, and
  the accuracy multiplier's cost.
- What-ifs: "at 5% better accuracy this run scores X".

## Scenario and bot facts

Checked against `.sce` values over the same runs:

| fact | from run data | result |
| ---- | ------------- | ------ |
| Bot health, per bot | most common damage per kill, when it's constant kill to kill | 1130/1150 exact without regen and over-damage; 1280/1326 with over-damage. The misses are B180 Voltaic (50 against 5.0) and Flicker Plaza (721.1 against 720) |
| Health regen or timed targets (pokeball, reflex, PGT-style windows) | damage per kill varies between kills | health can't be read (56/889 and 22/221 match), but the variation itself flags these scenarios |
| Damage per hit | run damage ÷ hits | 236/242. The misses: a 0.02668 damage per shot comes out 0.026, and a 100000 damage per shot is capped at the bot's 1 health |
| Full-auto fire rate | most shots in any tick, against `ShotsPerClick ÷ TimeBetweenShots × Timescale` | 192/202 within 6%. The rest are lower because the player released fire |
| Semi-auto fire rate | — | **not recoverable**: shot counts reflect how fast the player clicks (0/40) |
| Magazine / reloads | reload events exist ⇔ `MagazineMax > 0` | 227/242. The misses never emptied the magazine |
| Bots shoot back | damage-taken events exist | 242/242 |
| Targets at once, rotations | `.perf` header `added_bots` (one entry per simultaneous bot or `.rot`) | read directly |
| Kill or damage cap, player lives, time limit, timescale, map | `.perf` header | read directly |
| Race vs clock | `classify()` (sentinel plus countdown) | right for timescale-1 races; timescale ≠ 1 and a `Timelimit` just under 1000 break it (see race findings). Untested there: no race run with a `.perf` on this install has timescale ≠ 1 |
| Adaptive target size / time dilation | CSV `Avg Target Scale`, `Avg Time Dilation` | read directly |
| Aim type, description, author | KovaaK's web API (below), fetched on demand | not from run data |

### Categories

[SalziCantAim/Documentation-for-Kovaaks-Scenarios](https://github.com/SalziCantAim/Documentation-for-Kovaaks-Scenarios)
sorts scenarios into categories from `.sce` fields. Its signals and their run-data
counterparts:

| category signal (`.sce`) | run-data counterpart |
| ------------------------ | -------------------- |
| `AimTypeTag` | KovaaK's API `aimType`; or fire rate and shots per kill (the `isClicking` heuristic) |
| `InvincibleBots=true` (tracking invincible) | damage without kills |
| `HealthRegenPerSec < 0` (timed / reflex) | a fixed TTK window, or damage per kill below the bot's usual |
| `HealthRegenPerSec > 0`, short `HealthRegenDelay` (pokeball) | damage per kill above the bot's health, varying |
| `MagazineMax`, `Category=SemiAuto` | reload events; shots per kill |
| `PlayerMaxLives=1` (nevermiss) | `.perf` `player_max_lives` |
| several simultaneous bots | `.perf` `added_bots` |
| `DisableScoring=true` (blocker bots) | bots in `added_bots` that never appear in kill rows across runs (not yet checked) |
| `SearchTags` (Precise/Reactive/Smooth/Speed/Evasive) | none; KovaaK's API has the description only |

## Where it would live

The database already stores every raw field from both files (`run`, `kill_series`,
`run_perf`, `run_series`). What's new is small derived data, keyed by the scenario
the runs belong to. The database runs in a worker, so SQL and ingest work stay off
the main thread. The browser should only do what's interactive.

### What the browser computes today, and where it should go

| where | work per page load | move to |
| ----- | ------------------ | ------- |
| Scenario page bot tabs (`useScenario.computeBots` → `botSeries`) | loads the score and damage ticks plus kill detail for **every** run of the scenario with a `.perf`, builds curves, engagements and bot rows | a SQL query over stored per-kill values (below) |
| Run view race "best" column (`raceCandidates` → `bestSplits`) | loads and rebuilds **every** race run | a SQL aggregate per slot |
| Run view baselines and recent band (`Loader.walk`) | loads ticks and kill detail in batches of 20 until enough comparable curves turn up. The curves it keeps then draw the baseline and the recent band | stored classification picks the runs in SQL. Only the chosen runs' curves load |
| Scenario page race/clock label and bot tabs (`useScenario.load`) | loads up to 5 runs' ticks and kill detail. The first run that classifies sets the label, and the same inputs build the bot tabs | stored classification, plus the scenario's bot list |
| `fixedWindow` via `getSlotStats` | SQL aggregate over every kill of the scenario | the scenario table, kept up to date incrementally |
| `isClicking` | median shots per kill, per run | per run at ingest. Keep it per run: a scenario-level flag changes behaviour for scenarios whose runs differ |

**Stays in the browser**: the inspected run's curve, pace lines, local-pace window and
hover readouts (one to a few runs of ~100 points), the recent-range band over 10
curves, directory medians and ranks, and the progression chart's best-so-far and
rolling median. Curves aren't stored: they're cheap to rebuild from stored ticks,
and storing them would roughly double the tick data.

### Scenario facts change as runs arrive

The hittable delay and the fixed window are statistics over every run, so both can
move when new runs arrive. If each run's engagements and bot values were stored with
those values applied, every import would have to recompute every run of each
scenario it touched: hundreds of runs, each needing its ticks read back. So nothing
per run stores a scenario fact already applied. Remedies, in order of how much they
carry:

#### 1. Apply scenario facts at query time

Store per kill only values that don't depend on scenario facts:

| per kill, stored once at ingest | from |
| -------------------------------- | ---- |
| `gap`: seconds since the previous kill, or since challenge start for the first. Add 86,400 s when the difference is negative: `at_ms` is ms since local midnight, and the `kill` view deliberately doesn't wrap it (`killTimes` unwraps it the same way) | CSV |
| `points`: running score at this kill − at the previous kill (or challenge start) | ticks, interpolated at the two kill times |
| `bound`: when this kill's bot became hittable, measured from the previous kill. Null for the first kill, and when no tick with hits fits before the kill | ticks, with the run's own fire rate |

Per run, also store its fire rate: the most shots in any complete tick, skipping a
short last tick. That lets the scenario take the maximum over runs, and lets a
rebuild run without ticks.

Every split is then a clamped expression of stored values and at most one scenario
number. The scenario's **kind** decides which expression applies, in this order:

1. **Click** (the run's `isClicking`): no breakdown, as today.
2. **Fixed window** (`W` from `fixedWindow`): `split = min(ttk, W, gap)`. If the
   scenario also has a hittable delay (VT PGT, Aether, Ground have both), the window
   wins. The two disagree by ~0.05 s on Aether (1.45 against the ~1.40 reset), which
   is still open.
3. **Single target with a published `d`** (one bot or rotation in `added_bots`, a
   settled estimate):
   - first kill: `split = min(ttk, gap)`; `d` isn't applied (see the first-kill
     limit above);
   - later kills: `split = clamp(gap − d − lag, 0, gap)`. A split clamped to 0 means
     `d` is wrong for that kill. Treat it as missing rather than as a 0 s split in
     best-split and pace.
   - `lag` is how late the CSV logs this kill. It's the overshot protection (the
     scenario's held-fire leftover) for every kill except the one that ends the
     challenge, where it's ~0.01 s. Without it, `gap − d` over-counts each split by
     that kill's lag, since `d` is measured from the previous CSV kill. Found by the
     second review; see
     [Second review](#second-review-of-the-test-findings-2026-09-28).
   - With the trigger held, `gap − lag ≈ ttk`, so `split ≈ ttk − d`. *(Superseded:
     each kill's lag is read from its own `OverShots`, released fire included; see
     [Per-kill lag from `OverShots`](#per-kill-lag-from-overshots-2026-09-28).)*
4. **Everything else** (switching, several targets, or no settled `d` yet):
   `split = min(ttk, gap)`, exactly what `engagements()` computes today. No dead
   time is shown for switching scenarios, as decided, even though `gap − split` is
   the ~0.26 s overshot protection there.

Then, for the kinds that show it:

```
dead time for the kill = gap − split          (never negative: split ≤ gap)
race slot pace         = split × slots        (× timescale once races at ts ≠ 1 are fixed)
clock bot time         = Σ split over the bot's kills
clock bot points       = Σ points over the bot's kills
clock bot pace         = points ÷ time × duration
best split per slot    = min over runs of split, missing splits excluded
```

The filters today's code applies still apply: `run_complete`, runs `comparable()`
with the reference, and for races, the same number of engagements as slots.
`kill_series` stores arrays, so each query unnests it (or reads the `kill` view)
and joins the scenario table. When `d` or `W` changes, nothing stored changes,
ingest never revisits old runs, and the page reads current values in one query.

**Behaviour changes, all of them:**

- **Clock points cover the whole gap.** Today a kill's points are the running score
  between its engagement start and the kill. That start is `kill − TTK`, about the
  overshot protection after the previous kill. Now they cover everything since the
  previous kill:
  - **Scoring doesn't stop while no bot is up.** With a miss penalty, every shot
    fired into a respawn after the overshot protection is a miss. With an accuracy
    multiplier, those misses rescale the whole running score. Damage taken from
    shots still in flight counts too. All of that lands in the next bot's points,
    while its time leaves the respawn out, so the respawn's penalties drag down
    that bot's pace. Today part of it falls into dead time. Test 3 measured it: holding
    fire through 3 s respawns turned a +32 score into −63 with the same hits (see
    [Test scenario results](#test-scenario-results-2026-09-28)).
  - **Switching**: points now span [previous kill, kill] instead of today's
    [kill − TTK, kill], which starts ~0.26 s later. With sub-second TTKs, the points
    come out higher by up to the ~0.26 s gap's worth of scoring.
  - **Per-bot points with an accuracy multiplier were never additive.** Every miss
    rescales everything scored before it, today and after.
  - **Remedy for both**: store a second per-kill value, `dead points`: the score
    change in the ticks after the previous kill up to the first tick with hits. It
    uses the hit ticks as the boundary, so it doesn't depend on `d`. Show it as
    dead-time points and leave it out of the bot's. It's exact to the tick. The
    inspected run, a single run, can compute its exact dead-time points from its own
    ticks in the browser.
- **The clock dead-time row** (duration − engaged time, final score − engaged points)
  still adds up. Its points become what scored after the last kill plus every kill's
  `dead points`.
- **Race dead time becomes nearly constant**: about `(N − 1) · d` per run for a single
  target, so its delta against a baseline is ~0. That's correct (the player can't
  speed up a respawn), but the row says little.
- **History shifts.** Splits, paces and bot-tab values for affected scenarios change
  once the new rule lands. Air Spectral's race splits drop by ~1.5 s each, about 7.5 s
  per run in total. Old screenshots and memory won't match.

#### 2. Keep scenario aggregates up to date incrementally

Each import folds in its new runs only, per scenario hash:

| fact | aggregate state | on delete / reingest |
| ---- | --------------- | -------------------- |
| hittable delay | the smallest k (say 16) bounds, so a low quantile and the settle test (tenth-smallest close to the smallest) both work | rebuild (remedy 4) |
| fixed window | per slot: count, sum and sum of squares, in `float8`, or Welford's running mean and variance. The spread test works at a relative spread of 1e-4 on ~19 s means, which `real` loses to cancellation. Same filters as `getSlotStats`: `ttk > 0`, `run_complete` | subtract the run |
| overshot protection | 10 ms buckets of the per-kill leftover. Kept as a fact for display and as the first-kill check; no split formula uses it | subtract the run |
| bot health, per bot | counts per damage value, rounded to 0.01, keeping only the 8 most common values (regen scenarios produce endless distinct values) | rebuild |
| fire rate | maximum of the runs' stored fire rates | rebuild |
| scoring formula | refit on the pooled runs whenever a new run disagrees with the current formula (not "first run wins", which depends on order). Accuracy form undetermined until accuracy varies | rebuild |

Folding in N new runs costs N runs of work, whatever the scenario's history.

**Facts aren't monotone.** One odd run can flip a scenario out of fixed-window (its
spread jumps), or a bad bound can pull the hittable delay down. The kind and each
fact are recomputed from the aggregate state on every fold, never latched.

**Per-bot facts**, such as a hittable delay per bot in mixed rotations, key the
aggregate by scenario and **killed bot**, since the gap after a kill is the killed
bot's delay (see [Mixed-rotation test](#mixed-rotation-test-2026-09-28)). That also
works for randomised rotations, where a slot has no fixed bot. So the bound on the
gap before kill k belongs to the bot of kill k − 1, and kill k's split uses that
bot's `d`.

#### 3. What queries use before a fact settles

A fact is **published** once it settles: enough kills, and the tenth-smallest bound
close to the smallest. Until then, queries use the rule-4 fallback, today's
behaviour (`split = min(ttk, gap)`), and the page labels dead time as including
the respawn. So a new scenario, or a new hash of an old one (facts are keyed per
hash), shows what it shows today until it settles, never nothing. A new hash could
also start from the published facts of another hash with the same name, labelled as
such.

The published value tracks the aggregate. There's no hysteresis, since queries
read it directly and there's no cache to protect.

#### 4. Recompute a whole scenario only when forced

A rule change in the app (a new estimator, a changed threshold) invalidates every
scenario. Record a derivation version per scenario, and on a mismatch rebuild that
scenario's aggregate state from the stored per-kill and per-run values (`gap`,
`points`, `bound`, TTK, damage, the per-run fire rate and formula). That's done in
the ingest worker, lazily when the scenario is first opened. Ticks are read again
only when a per-kill value's own definition changes: that's a migration and a
reingest, as for any other schema change.

### Stored, in total

Per run:
- one row of classification: race or clock, duration, budget, pool, bots, or why
  unsupported;
- `isClicking`;
- fire rate;
- the fitted scoring formula: the form plus five coefficients.

Per kill: `gap`, `points`, `bound`, and `dead points` (the score change before the
first tick with hits).

Per scenario hash: one row of published facts and their kind, plus the aggregate
state above and a derivation version.

## Reading `.sce` files: infeasible

Every route to the scenario files was checked. None works reliably for every user
with live sync.

- **They're not in the folder the app reads.** Workshop scenarios live under
  `steamapps/workshop/content/824270/<workshop id>/<name>.sce`, a sibling of the game
  folder. The game folder only has local scenarios (`Saved/SaveGames/Scenarios/`, 28
  on this install).
  - Asking for `steamapps/` is too broad.
  - A second folder handle would also need its own live-sync link, as `stats` and
    `performances` have.
- **Local coverage is partial anyway.** 15 of the 316 scenario versions played here
  had no file: 14 no longer installed, and 1 since updated. Steam keeps only each
  scenario's current version.
- **KovaaK's web API** (`kovaaks.com/webapp-backend`, unofficial) allows browser
  requests: CORS echoes the origin.
  - `scenario/popular?scenarioNameSearch=…` gives `leaderboardId`, `aimType`,
    description and play counts.
  - `scenario/details?leaderboardId=…` adds the author and created date.
  - There's no file, hash or profile data. Still useful for the scenario card.
- **Steam `ISteamRemoteStorage/GetPublishedFileDetails`** (no key) gives title, size
  and preview image. `file_url` is empty because workshop content only downloads
  through the Steam client, and there's no CORS header.
- **steamcmd.** `workshop_download_item 824270 <id>` with `login anonymous` fails:
  KovaaK's is a paid game, so it needs an account that owns it. The workshop has
  **59,254 items**. A full pull at an estimated 0.3–0.7 MB each is 20–40 GB.
- **Terms.** The Steam Subscriber Agreement forbids *"any form of scripts, bots,
  macros, or other non-human-controlled systems ('Automation') to interact with
  Content and Services on Steam in any manner"*. Workshop authors license their items
  to Valve, and other subscribers only get *"the same rights to use"*: personal,
  non-commercial. Transferring *"reproductions of the Content"* to others needs
  Valve's written consent. A bundled table of values from a mass download conflicts
  with both, even with map data stripped.
- **The community dump** (`github.com/fvolpe83/Scenarios`) was last pushed in 2020,
  so its hashes won't match.
- **Matching a newer version by name** works for scoring: the one updated scenario
  here reproduced both runs' scores with its newer file, and every killed bot was in
  it. It can't catch changed respawn or movement values. The question doesn't arise
  now that nothing reads `.sce` files.

## Answered from existing data (2026-09-28)

### The first bot is up at challenge start

For every well-sampled single-target scenario, the bound on the first hit, measured
from challenge start, is 0.01–0.05 s:

| scenario | runs | bound |
| -------- | ---- | ----- |
| Air Spectral Easy | 67 | 0.008 s |
| VT Ground Intermediate S5 | 84 | 0.022 s |
| VT PGT Intermediate S5 | 49 | 0.022 s |
| Ground Plaza Sparky V3 | 58 | 0.020 s |
| Plink Palace Easy | 56 | 0.048 s |

**The respawn delay is never applied to the first kill.** Plink Palace's 1.5 s
first-kill leftover is its `OvershotProtectionTimer=1.5` running from challenge
start, not a spawn delay.

### In a mixed rotation, the next bot's own delay doesn't apply

Per slot, the smallest bound is:

- **VT Ground Intermediate S5:** before the third bot (its own delay 2.0 s, the
  second bot's 1.45 s) the bound is **1.456 s** over 84 runs.
- **VT Aether Intermediate S5:** before the third bot (its own 1.5 s, the second
  bot's 1.45 s) it is **1.460 s** over 72 runs.

So the gap isn't the next bot's own `MinRespawnDelay`. It matches the **killed** bot's,
which test 4 then confirmed (see
[Mixed-rotation test](#mixed-rotation-test-2026-09-28)). Aether's 0.05 s difference
between its 1.45 s delay and the ~1.40 s reset `fixedWindow` measures is still
unexplained.

### Blocker bots do appear in kill rows

The 24 scenario files with `DisableScoring=true` bot profiles have 236 runs here.
Those runs have **50 kills on blocker bots**. Absence from kill rows doesn't identify
blockers. A kill that adds no points under the scenario's fitted formula might. Not
checked.

### The CSV and `.perf` clocks agree, but tracking kills are logged late in the CSV

Each `.perf` tick counts its kills, so every CSV kill time has to fall inside the
tick that counts it. That bounds an offset (`.perf` time − CSV time). Intersecting
the bounds over every run of a scenario, and leaving out the kill that ends each
challenge (it isn't logged late, see below):

| scenario | overshot | offset that fits every run |
| -------- | -------- | -------------------------- |
| Air Spectral Easy | 0 | −0.016 .. −0.006 s (67/67 runs) |
| VT Aether / Ground / PGT Intermediate S5 | 0 | about −0.40 .. −0.01 s (72/72, 84/84, 49/49) |
| Air Pure Medium | 0.25 | −0.272 .. −0.256 s (54/54) |
| Air CELESTIAL No UFO Easy Slowed | 0.25 | −0.276 .. −0.257 s (15/15) |
| Ground Plaza Sparky V3 | absent (0.25) | ≈ −0.26 s (58 runs; the bounds just touch) |
| click and switching scenarios | any | ≈ −0.01 s |

- **The clocks share a zero, and the CSV logs a kill late by the overshot
  protection**: the offset is ~−0.01 s with no protection and ~−(overshot + 0.01) s
  with it. Test 2 confirms it at 0.5 s.
- **The kill that ends the challenge isn't late**: its leftover (gap − TTK) is
  ~0.009 s in every scenario checked, against 0.26 s for the other kills at overshot
  0.25.
- **Correction:** an earlier version of this table took each run's midpoint instead
  of intersecting the runs. That produced a "timed VT bots are 0.206 s off with
  overshot 0" finding that was an artefact of the method. The second review caught
  it.

What it means:
- **`points`**: the running score has to be read at each kill's actual time, not its
  CSV time, or ~0.25 s of scoring shifts between neighbouring bots in overshot-0.25
  scenarios.
- **Splits**: the lag has to come off each split (see remedy 1).

### `Saved/SaveGames` has usable data, inside the game folder

- **`Playlists/*.json`** (26 here): playlist name, author, and each scenario with
  its play count. That's how players group scenarios, such as benchmark sets.
- **`FovSensConfig.json`**: every sens scale's formulas, for example
  `"InchesFormula": "360 / (Inches * 0.022 * DPI)"`. It could replace hard-coded
  cm/360 conversions.
- **`PrimaryUserSettings.json`**: game settings (bounding boxes, colours). Likely of
  little use.
- **`PlaylistInProgress.json`**, **`LocalFavoritePlaylists.json`**,
  **`PlaylistOrder.json`**: playlist state.

## Test scenario results (2026-09-28)

Three test scenarios, copies of Air Spectral Easy (a single-target rotation,
full-auto hitscan) with only the listed settings changed, so their `.sce` is ground
truth by construction. They were generated by a throwaway script, copied into
`…/Saved/SaveGames/Scenarios/`, and played 8 times with `.perf` saving on. All 8
runs carry the generated files' hashes.

| test | changed settings | runs |
| ---- | ---------------- | ---- |
| **1, slowed race** | `Timescale=0.5`, respawn 1.0 s, animation 1.0 s, overshot 0, 50 HP, 10 kills | 2 holding fire, 1 releasing fire (it also paused once for 4 s) |
| **2, long overshot** | overshot 0.5 s, respawn 1.0 s, animation 0, 50 HP, 10 kills | 2 holding fire, 1 releasing fire |
| **3, scoring during respawn** | 20 s clock, `ScorePerDamage=1`, `ScoreLossPerMiss=0.5`, `ScoreMultAccuracy=true`, respawn 3.0 s, 100 HP | 1 holding fire, 1 releasing fire |

### Confirmed

- **Timescale scales the spawn animation.** Test 1's gap between a kill and the next
  hittable moment is bracketed at **4.006–4.025 s** (the largest all-zero-hit tick
  end and the smallest hit bound). That's (1.0 + 1.0) ÷ 0.5 = 4.0. The alternative,
  1.0 ÷ 0.5 + 1.0 = 3.0, is ruled out.
- **The hit bound `t_end − (h − 1)/r` held in every test**, release-fire runs
  included. It never came out below the truth:
  - test 1: truth 4.0, smallest bound 4.025 (4.211 in the release run);
  - test 2: truth 0.5 after the CSV kill, smallest 0.596;
  - test 3: truth 3.0, smallest 3.088.

  The release runs bound less tightly, as expected.
- **The CSV logs a kill late by the overshot protection** when the trigger is held.
  The `.perf`/CSV offset is −0.50 to −0.52 s in test 2's held-fire runs (overshot 0.5),
  against −0.01 to −0.05 s in test 1's (overshot 0). With the lag, the hittable model
  above predicts 0.5 s after the CSV kill in test 2. The bound is consistent with it
  (≥ 0.596), though not tight enough to confirm it exactly.
- **`classify()` breaks on slowed races.** All three test-1 runs return
  `unsupported: signals-disagree`: the sentinel test passes, and the countdown test
  fails because each score tick is −0.5, not −1.
- **The race score is `Timelimit − elapsed × Timescale`** (975.364 against 975.358 on
  run 1), but see pauses below.
- **Scoring during a respawn is large where misses cost points.** In test 3 the
  running score falls during every respawn while the trigger is held: −24.8 and −12.4
  in the two full respawn ticks after the first kill. The held-fire run scored
  **−62.6**, the release-fire run **+32.2**, with the same 500 hits each. The formula
  reproduces both from the CSV totals: (500 − 0.5 × 1501) × 500/2001 = −62.59, and
  (500 − 0.5 × 829) × 500/1329 = 32.17.
- **The per-run formula fit recovers it exactly.** On both test-3 runs the linear
  accuracy form fits with zero residual: 1 per damage, −0.5 per miss. The plain and √
  forms leave residuals of 5–29 points.
- **The first bot is up at challenge start**: the first-hit bound from the start is
  0.04 s in test 1 and 0.11–0.16 s in test 3.

### New findings

- **TTK depends on the trigger when overshot protection > 0.** With the trigger held,
  each leftover (gap − TTK) is the overshot protection plus a little: 0.508–0.516 s in
  test 2. In the release-fire run the leftovers ranged from **0.22 to 1.31 s**: TTK
  starts at the first shot of a new trigger press, or when the protection ends if the
  trigger stays down. With overshot 0 (test 1), releasing made no difference (every
  leftover 0.019–0.021 s). So:
  - the overshot estimate (median leftover) is only right for players who hold fire;
  - today's fallback split, `min(ttk, gap)`, measures from the player's first click in
    such scenarios, not from the spawn.
- **The CSV kill lag also depends on the trigger.** In test 2's release run no single
  offset fits every kill: one kill's lag is at most 0.18 s, another's at least 0.29 s.
  So with fire released, each kill's lag is anywhere from 0 to the overshot
  protection. That fits the kill being logged when the protection ends, and releasing
  the trigger ending it early.
- **The ~0.01 s constant in the leftover is scenario time.** It doubles to 0.019–0.021 s
  at timescale 0.5.
- **The kill that ends the challenge isn't logged late.** Test 2's last kill had a
  leftover of 0.011 s, and so does the last kill of every race on this install (Air
  Pure, CELESTIAL, Sparky, Flicker Plaza), against 0.26 s for the other kills. The
  race score agrees: the time recovered from the score is the CSV last kill + 0.011–
  0.015 s in all 5 unpaused test races.
- **Pauses break the CSV/`.perf` alignment and the race elapsed time.** Test 1's third
  run paused once (CSV `Pause Count: 1`, `Pause Duration: 4`):
  - The `.perf` clock stops during a pause: the tick after 11.98 s is stamped 12.71 s,
    and later ticks keep that shift.
  - CSV kill times, CSV TTK and `Fight Time` all include the pause. Every kill after
    it is ~4.28 s later in the CSV than in the `.perf`.
  - The race score uses game time without the pause: 975.764 = 1000 − **48.47** × 0.5,
    where 48.47 s is the `.perf` end time. The CSV last kill is 52.76 s.
  - So `killTimes()` and everything built on CSV kill offsets (race curves,
    engagements, `points`, `bound`) is misaligned after a pause.
  - The shift can be rebuilt: it's the jump in the tick grid, and the CSV's
    `Pause Duration` is that shift rounded to whole seconds. That held for all 4
    paused runs with a `.perf` (4.28 → 4, 24.04 → 24, 11.94 → 12, 89.51 → 90, the last
    right on the rounding edge). With the shift applied, every bound in the paused run
    is 4.046–4.529 against a truth of 4.0.
  - It's rare: 10 of 2736 runs on this install, 7 of them with kills.
- **`.perf` leaves out ticks with no events.** Test 3's release run has no ticks at
  2.98, 6.98 or 11.98 s. A tick's start is `max(previous t, t − 1)`, not the previous
  stored `t`. For the hit bound the mistake only loosens it. For `dead points` and any
  lower bound it's wrong.

### What changes in the design

- **Splits subtract the lag**: `split = gap − d − lag` (see remedy 1). The lag is the
  overshot protection, except for the kill that ends the challenge.
- **Dead-time points matter.** Test 3 shows respawn scoring can decide the whole score
  in miss-penalty and accuracy-multiplier scenarios. `dead points` as first proposed
  (the score change in whole ticks before the first tick with hits) only catches the
  whole ticks inside a respawn. That's about R − 1 s of an R-second respawn: nothing
  for Air Pure, about a third for Air Spectral. In test 3's held run, kill 1, it caught
  −37.2 while ~130 misses fell into the boundary ticks. The boundary ticks have to be
  shared by shot counts, using the known fire rate, and that still needs checking
  against test 3. Under an accuracy multiplier the value isn't additive anyway.
- **The overshot estimate needs held-fire kills.** Take the leftover's lowest common
  value (for example the 10th percentile) instead of the median. A player who releases
  fire only adds larger leftovers. Leave out each run's last kill.
- **Pause handling**: until the shift rule has more than 4 runs behind it, leave runs
  with a CSV `Pause Count` > 0 or a `.perf` pause event out of kill-based values. The
  race score and curve can still use the `.perf` time.
- **`classify()`**: scale the expected countdown step by timescale, and compare the
  sentinel with a tolerance. Take the race's elapsed time from the score,
  `(Timelimit − score) ÷ (ScorePerTime × Timescale)`: exact, and immune to pauses
  (48.472 against the 48.474 `.perf` end). A paused race whose CSV kills run past the
  `.perf` end falls to `bad-kill-times` today, which is safe.
- **Hittable delay per killed bot.** Test 4 settles which bot's delay applies (see
  [Mixed-rotation test](#mixed-rotation-test-2026-09-28)).

## Second review of the test findings (2026-09-28)

A second fresh agent recomputed every test finding from the raw files and gave a
verdict per component. It confirmed:
- timescale scales the animation;
- the hit bound held in every test, including the pause-corrected release run;
- the held-fire lag equals the overshot protection;
- TTK depends on the trigger;
- `classify()` fails on slowed races;
- the race score and test 3's formula and fit;
- the first bot is up at the start;
- the mixed-rotation bounds;
- the blocker-bot count;
- the pause count.

Its corrections are folded in above:
- **the split lag** (the most important);
- the last-kill explanation;
- the clock-offset table's midpoint artefact;
- the release-fire offset, which is an empty interval rather than a range;
- `dead points` bias;
- the half-shown mixed-rotation rule;
- missing ticks;
- the pause-shift rule.

It also noted that test 2's release run can't test the hit bound (the truth there is
anywhere from 0.5 to 1.0 s after the CSV kill), and that the first-bot bound in test 3
is 0.11–0.16 s, not 0.04.

### Verdict per component

*(Superseded by the later reviews: the `OverShots` lag resolves the "not yet for
overshot > 0" row, and dead points were redesigned. See
[Per-kill lag from `OverShots`](#per-kill-lag-from-overshots-2026-09-28) and the spec.)*

| component | verdict | guards / missing |
| --------- | ------- | ---------------- |
| Query-time splits with `d` | **Switch now for overshot-0 single-target scenarios** (Air Spectral, VT PGT/Aether/Ground), with the guards: single target, full-auto, settled estimate, today's rule as fallback | **Not yet for overshot > 0** (Air Pure, CELESTIAL, Sparky) until the lag correction is implemented and checked against those scenarios' runs. Release-fire lag there is only bounded, not known |
| `dead points` | **Not yet** | boundary-tick sharing, checked on test 3 |
| Scoring fit, per run and pooled | **Switch, with guards** | accuracy form undetermined until accuracy varies; refit on the pooled runs; label terms that can't be told apart |
| `classify()` fix and race elapsed from the score | **Switch now** | — |
| Pauses | **Switch now to leaving them out**; not yet to shifting them | more multi-pause runs |
| Incremental aggregates and query-time design | **Switch, with guards** | store a last-kill flag, a paused flag, tick starts that know about gaps, `d` per slot, and a derivation version (per-kill meanings may still change) |

Data limits: one player who holds fire as a habit, one install, 8 test runs with a
single release-fire run per test (test 1's also paused), no overshot > 0 clock test,
no rotation that wraps with mixed delays.

## Still open

- **Other players**: whether the hittable and overshot estimates settle the same way
  for players who release fire as a habit, and which quantile to use. That needs a
  few players' `stats` and `performances` folders for the same scenarios. The
  analysis only reads them.
- **The lag correction for overshot > 0**: implement it and check the corrected
  splits against Air Pure, CELESTIAL and Sparky runs, where the true engagement is
  known from hit ticks.
- **Boundary-tick sharing for `dead points`**: check against test 3.
- **Aether's 0.05 s difference** between its configured delay (1.45 s) and the reset
  `fixedWindow` measures (~1.40 s).
- **Blocker bots**: they appear in kill rows. Whether the fitted formula can identify
  them (their kills add no points) isn't checked.

## Mixed-rotation test (2026-09-28)

**Test 4, mixed rotation**: Air Spectral Easy with each of the six rotation bots on
its own character profile (`mix1`–`mix6`, cloned from `air1`), with respawn delays of
1.0, 2.0, 0.5, 1.5, 2.5 and 0.75 s in rotation order. Everything else is fixed:
`Randomized=false`, overshot 0, animation 0, timescale 1, 50 HP, 12 kills (the
rotation twice). Every candidate rule predicts a different gap for each kill, so the
test separates them.

It was played 3 times with held fire. All 3 runs carry the generated file's hash,
have 12 kills and no pause. For each of the 33 gaps the gap-aware tick scan
bracketed when the next bot became hittable. 22 gaps had an upper bound; in the
other 11 the next kill came before any tick with hits. Over those 22:

| rule for the delay after a kill | gaps it fits (within 0.02 s) | worst miss |
| ------------------------------- | ---------------------------- | ---------- |
| **the killed bot's delay** | **22 / 22** | **0 s** |
| the minimum delay | 12 / 22 | 1.86 s |
| the rotation's first bot's delay | 9 / 22 | 1.36 s |
| the maximum delay | 5 / 22 | 1.73 s |
| the next bot's delay | 1 / 22 | 1.61 s |

The fits are tight: the upper bounds after the 0.5, 1.5 and 2.5 s bots are 0.768,
1.508 and 2.507 s. **So the gap after a kill is the killed bot's delay.** A per-bot
hittable delay keys on the bot of the previous kill, and works for randomised
rotations too.

## Per-kill lag from `OverShots` (2026-09-28)

Found by the third independent review, checked on the raw files, and confirmed per
kill by the fourth review.

**Shots fired during overshot protection aren't counted as shots anywhere.**
- `.perf` shots equal the weapon row's shots in every run checked (57/57 Air Pure,
  59/59 Plink Palace).
- The kill rows' running shots and hits equal the `.perf`'s at every tick inside a
  protection window (247/247 ticks: Air Pure, Plink, Sparky, test 2).
- Those shots appear only in the kill row's `OverShots` column. Held-fire examples:
  - test 2 has 50 overshots on every held kill, which is 0.5 s × 100/s, and 0 on the
    run's last kill;
  - Air Pure has 25 per kill;
  - Plink Palace has 150, and 9–10 on its last kill, which the 60 s time limit cut
    short.

**So each kill's logging lag is `(OverShots + 1) ÷ r`**, where `r` is the fire rate
and the `+ 1` is one shot interval.
- For held fire, `gap − ttk` matches it within ±0.01 s on every kill checked:
  - Air Pure: 228;
  - CELESTIAL: 105;
  - Sparky: 305;
  - Plink: 118, plus 59 last kills;
  - Spectral: 350;
  - tests 1, 3 and 4;
  - switching scenarios at timescales 0.69–2.0.
- It holds against the `.perf` kill-tick bounds on 68,576 of 68,590 kills. The 14
  exceptions are switching scenarios whose fire rate ticks alone underestimate.
- **For released fire**, `OverShots` gives the real, shorter lag. Releasing the
  trigger ends the protection early; per the vendor, so does damaging something.

This replaces:
- the per-scenario lag percentile;
- the special "challenge-ending kill" lag, which was wrong on time-limited clock
  scenarios such as Plink, whose last kill is cut short by the time limit.

**Also from these reviews:**
- **A tighter hit bound.** The hits counted up to a kill equal the kill rows' running
  hit sum, so the next bot's hits in the kill's own tick can be separated out. On Air
  Pure the per-bot `d` becomes 0.759–0.762 s against a true 0.740 s, and the mean
  split error goes from −0.039 s to −0.015 s.
- **Dead-stretch misses.** They're counted exactly up to the last tick with no new
  hits. Extrapolating one post-kill shot rate over the whole stretch undercounted
  them by 10–33% on test 3's release-fire run, which, it turned out, didn't hold
  fire.
