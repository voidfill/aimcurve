# Ingesting KovaaK's output

How to pair a `Stats.csv` with its `.perf`, and how to tell a real run from an
abandoned one.

[`perf-format.md`](perf-format.md) covers what is *inside* a `.perf`;
[`stats-csv.ts`](../src/lib/parse/stats-csv.ts) covers what is inside a CSV. This
covers what the two files mean *together*, which is where the traps are. Every
claim below is pinned by a test in
[`test/fixtures/curated.test.ts`](../test/fixtures/curated.test.ts) against files in
[`test/fixtures/curated/`](../test/fixtures/curated/README.md).

## How this was worked out

The partial-write behaviour is not in the corpus by accident. KovaaK's has a setting
controlling when files are written — *none*, *on completion*, *on completion/reset*,
*always* — and it is normally not on *always*. The files were captured deliberately:
a filesystem watcher logged every create/write on both output directories with a
content fingerprint while runs were played with the setting on *always*, resetting
and aborting on purpose. The watcher was throwaway and is not in the repo.

That matters because a corpus collected on the default setting contains **none** of
this, and would lead you to believe the failure modes below do not exist.

## Files are written once, atomically

Every file appears in a single write at a terminal event. Two ~85-second runs each
produced exactly one create and zero subsequent modifications.

**There is no partial-write window to defend against.** A file that exists is a file
that is finished. Do not poll for size stability or wait for writes to settle.

What *always* changes is not *how* files are written but **which events flush one**:

| terminal event | `Stats.csv` | `.perf` |
| -------------- | :---------: | :-----: |
| run completes  | ✅ | ✅ |
| player resets  | ✅ | ❌ |
| player leaves a paused scenario | ✅ | ❌ |

So `.perf` means "this run finished". That, plus the 310 pre-3.9.0 CSVs from before
`.perf` existed, is the whole explanation for the file-count gap.

### One race worth knowing

The CSV is written **~1.6 ms before** the `.perf` (1.64 ms and 1.55 ms, measured). An
importer watching the directory and reacting to CSV-create will sometimes find no
`.perf` yet. Wait for the pair rather than concluding the run did not complete.

## Three file shapes

| | complete | reset | abort |
| --- | --- | --- | --- |
| filename infix | ` - Challenge - ` | ` - Challenge - ` | **absent** |
| `Scenario:` / `Hash:` | filled | filled | **empty** |
| `Avg FPS:` | 388–486 | **`0.0`** | normal |
| `Avg TTK:` | real | **`0.0`** | `0.0` |
| `Score:` | real | `0.0` ¹ | real |
| `Challenge Start:` | correct | **next attempt's** | **stale garbage** |
| `.perf` | ✅ | ❌ | ❌ |

¹ `Score` is zeroed only where it is *derived* at run end. Where score is a raw
accumulator it survives — the Voltaic reset fixture has `Score: 142.0` equal to its
`Damage Done`.

### Detecting them

```
abort  ⟺  Scenario: or Hash: is empty        (equivalently: no " - Challenge - ")
reset  ⟺  Avg FPS: == 0.0                    (equivalently: duration < 1s, below)
```

Two things to get right:

- **`Avg FPS == 0` does not catch aborts.** An abort keeps a perfectly normal
  `Avg FPS`; its tell is the missing scenario identity. You need both checks.
- **A missing `.perf` is not a validity signal.** 310 CSVs in the dump are complete,
  valid runs from game version 3.8.x, before `.perf` existed. Requiring one throws
  away five months of history — exactly the earliest history, where progression is
  most visible.

### What survives in a partial

Not much is lost, and what is lost is specific: everything computed *at run end*.

Valid: `Shots`, `Hits`, `Miss Count`, `Damage Done`/`Possible`, `Kills`,
`Total Overshots`, `Damage Taken`, `Distance Traveled`, `MBS Points`, the whole
settings block, and **the per-kill table including its timestamps**.

Not valid: `Score` (when derived), `Avg TTK`, `Avg FPS`, `Challenge Start`, and
`Fight Time` — which is the completed kill's TTK, so it reads `0.0` if the player
reset mid-engagement rather than meaning no time elapsed.

The kill table is written from the real clock and is **not** rebased onto the broken
`Challenge Start`. The one partial in the corpus carrying a kill row has that kill at
`18:42:39.762` while the file's own `Challenge Start` says `18:42:43.841` — the kill
is 4.1 s *before* the run supposedly began. Per-kill TTK, bot, accuracy and
inter-kill deltas are therefore trustworthy in a partial; only offsets computed
against `Challenge Start` are not.

## The reset off-by-one

**A reset-written CSV carries the start time of the attempt that *follows* it.**

The challenge clock restarts before the dead attempt is flushed, so the file holding
attempt N's stats is stamped with attempt N+1's start:

```
attempt B  18:42:43.841 → 18:42:50.379, player resets
   file@18:42:50   holds B's stats (166 hits)
                   stamped Challenge Start 18:42:50.379  ← that is C's start
attempt C  18:42:50.379 → 18:44:15, completes
   file@18:44:15   holds C's stats (5000 hits)
                   stamped Challenge Start 18:42:50.379  ← correct
```

Both files claim `18:42:50.379`.

**Consequence: `(scenario, Challenge Start)` is not a unique key.** It is the obvious
choice — the only stable run identifier in the CSV — and it collides on every
reset that is followed by a completed attempt. Use it and you get a unique-constraint
error on import, or you silently keep one of the two with even odds of keeping the
6-second throwaway instead of the real run.

Only the *last* reset in a chain collides. Earlier resets steal the start of an
attempt that was itself reset, so that timestamp never gets a second, correct file.
Filtering partials removes all of them regardless, so there is no need to reason
about chain position.

## The CSV/perf timestamp skew

`challenge_start_utc` in the `.perf` is the CSV's `Challenge Start` **truncated to the
whole second**. The CSV keeps milliseconds; the perf does not.

So the delta between them is just the discarded fraction, spread uniformly over the
second:

```
delta (perf − csv), 100ms buckets, n=2154:
  -900 -800 -700 -600 -500 -400 -300 -200 -100    0
   192  229  244  214  202  198  221  198  235  221      range −997ms .. +3ms
```

Two things follow, and both bite:

1. **~50% of runs have a perf start that rounds to a different second than the CSV
   start.** This is not an edge case, it is a coin flip.
2. **The +3 ms tail means the relationship is not exactly `floor()`.** The two
   subsystems sample the clock a few milliseconds apart, so a start within ~3 ms of a
   second boundary lands on the *later* second in the perf. **There is no exact
   timestamp join.**

When the write itself lands near a second boundary, the two **filenames** disagree
too — 8 pairs in the dump are named a full second apart. Joining on filename stem
silently drops them and invents 16 phantom orphans. (It is otherwise tempting:
filename stems are unique, and the filename scenario matches the `Scenario:` field in
every checkable file.)

## Joining a CSV to its `.perf`

Use the timeline, not a value match. A run occupies an interval, and **a player
cannot be inside two completed runs at once** — a guarantee about the world, not a
guess about how fast someone can press reset.

```
1. classify    drop reset and abort files          ← prerequisite, see below
2. interval    start = Challenge Start
               end   = filename timestamp, end of second
3. join        a .perf belongs to the unique complete CSV whose interval contains
               its challenge_start_utc, allowing 1000ms of slack on the lower
               bound to absorb the truncation
```

Measured over the corpus: **2154/2154 perfs matched, 0 unmatched, 0 ambiguous, 0 perf
claimed twice, 0 overlapping complete intervals.**

The 1000 ms is a property of the format — truncation discards at most 999 ms — not a
tuning parameter. Nothing here degrades when a player spams reset to reroll a seed;
reset intervals only get shorter, pushing them further below the classification
threshold.

### Step 1 is not optional

**Classification is a prerequisite of the join, not an emergent property of it.**

A reset file is stamped with the following attempt's start, and the 1000 ms slack is
exactly enough for its degenerate interval to reach that attempt's `.perf`. If you
join before filtering, `Air Pure Medium … 18.42.50` — a 6-second throwaway — claims
the perf belonging to the completed `18.44.15` run. Two tests pin this.

### An alternative, and why not

A content join also works: narrow by `scenario_hash` and a coarse time window, then
pick the candidate whose summed `shots_fired` and `shots_hit` events equal the CSV's
`Shots` and `Hit Count`. That also scores 2154/2154.

It is weaker in two ways. Its time window is a bet on how quickly a player can
produce two files, which is precisely the assumption seed-rerolling breaks; and it
must decode and scan every event in every perf, where the interval join reads only
the header.

Its one advantage is not needing the filename, so it is the better choice if you ever
ingest renamed files.

## Choosing a primary key

**Summed counters cannot be a primary key.** They collide badly: `(Hash, shots,
hits)` has 75 collisions in 2468 files, and adding every other counter —
`Miss Count`, `Score`, `Kills`, `Total Overshots` — only improves it to 72. Replaying
a scenario produces identical stat lines routinely, and capped scenarios make it
worse: `Air Voltaic Invincible 4 Medium` fires exactly 6001 shots every run, so
`shots` carries no information there at all.

Counters are a good *disambiguator* and a bad *identifier*. Inside a 2-second window
they separate one real candidate from zero; asked to separate 2468 runs, they fail 72
times.

Measured across 2468 files:

| candidate | distinct | collisions |
| --------- | -------: | ---------: |
| filename stem | 2468 | **0** |
| `(Hash, Challenge Start ms, isPartial)` | 2468 | **0** |
| `(Hash, Challenge Start second, shots, hits)` | 2468 | **0** |
| `(Hash, Challenge Start ms)` | 2466 | 2 |
| `(Hash, shots, hits, miss, score, kills, overshots)` | 2388 | 72 |
| `(Hash, shots, hits)` | 2385 | 75 |

The filename stem is the natural choice — unique on disk by construction, stable, and
never rewritten — with the caveat in **Known gaps** below. Note it is unique per
*file*, so a CSV and its perf can disagree; identity and joining are separate jobs.

## Should partial runs be analysed?

**Ingest them, flag them, and keep them off every performance axis.**

Not because the data is bad. The counters are intact and coherent. The problem is
selection: a player resets *because* the attempt was going badly or the seed was bad,
which correlates directly with the metric being trended. Mixing abandoned attempts
into a progression chart does not add noise, it adds a systematic pull that tracks
reroll habits rather than aim.

They carry real signal that completed runs cannot:

- **Reroll rate is a confound on every score that is kept.** A personal best set on
  the 16th attempt is not the same result as one set first try, and completed runs
  alone cannot tell those apart. The partial count is what allows correcting for it.
- **Reset timing separates two different acts.** A reset at 0.2 s is rejecting a seed
  before the run started; a reset 19 s in, mid-engagement, is abandoning a run in
  progress. Collapsing both to "aborted" loses that.
- **Reset rate is itself a trend** — rerolling a scenario less over months is
  improvement in consistency that never appears in score.

Treat them as attempts, not runs.

## Known gaps

- **Two files written in the same second.** If a player resets twice inside one
  second, both want the same filename; whether KovaaK's overwrites, suffixes, or is
  rate-limited by scenario reload is unknown. Deliberate reset-spamming produced
  nothing closer than 5 s apart, which suggests the reload rate-limits it, but that
  is a hypothesis from two data points. This is the one real threat to filename-as-key.
- **A run straddling midnight.** `Challenge Start` has no date, so the date comes
  from the filename — which is the *write* time. A run starting at 23:59:40 needs a
  rollover branch that no fixture exercises.
- **A partial on a click-heavy scenario.** Every partial captured is a tracking
  scenario, so "resets carry few kill rows" is observed here, not proven. A 10-second
  reset on a clicking scenario should carry ~10 kill rows and be worth reading.
- **Why an abort file is named after a different scenario.** The one abort in the
  corpus is named `RawMouseControl Reload` — a real scenario in the player's library,
  but not the one being played. The likely explanation is that teardown happens after
  the loaded scenario has already advanced, mirroring how a reset file is stamped
  with the next attempt's start. Unverified.
