# Curated fixtures

Hand-picked files from the full dump, committed to the repo via **Git LFS**. Anything
that has to pass on a fresh clone reads from here through `test/helpers/fixtures.ts`.

Layout mirrors the dump:

```
curated/
  performances/*.perf
  stats/*.csv
```

The full dump lives in `../raw/` (gitignored, ~4600 files) and is only used by sweep
tests guarded on `raw.available`.

## Git LFS

`.gitattributes` at the repo root routes `curated/**/*.perf` and `curated/**/*.csv`
through LFS. A fresh clone needs `git lfs install` once; without it you get pointer
files and the fixture tests fail loudly rather than silently reading garbage.

These are opaque test inputs — never hand-edited, only re-copied from a real install —
so losing readable diffs costs nothing, and the pack file stays flat as the set grows.

## What earns a file a place here

**Any scenario from `../raw/` is fair game if it pins down something a parser or an
importer has to get right.** The old "keep it minimal" rule was about not dumping 32 MB
of noise into git; LFS solves that, so the bar is now *does this document something*,
not *is the set small*.

Concretely, add a file when it is the only example, or a clear representative, of:

- a **file shape** (partial writes, missing counterparts, filename anomalies),
- a **rare `.perf` event type** or challenge-profile field,
- a **CSV section variant** (empty kill table, odd kill indices, unusual weapon rows),
- a **bug or quirk** that a test needs to assert against.

When you add one, add a row below saying *why*. A file with no stated reason is noise
and should be deleted.

Current set: **41 runs — 41 CSVs, 29 perfs, 525 KB.** The perf count is lower because
partial writes and pre-3.9.0 runs have no `.perf` at all, which is itself the point of
several entries.

---

## Contents

### Partial writes

KovaaK's has a setting controlling when `.perf`/`.csv` are written: *none*, *on
completion*, *on completion/reset*, and *always*. Under **always**, files are also
written when a run does **not** complete. Every file below was captured deliberately
with that setting on, and they are the only examples in a ~2475-file corpus.

Files are written **once, atomically, at a terminal event** — there is no incremental
or partial-write window to defend against. What varies is *which* events flush a file.

| file | why |
| ---- | --- |
| `Air Pure Medium … 18.42.43` | **Reset.** The only partial anywhere with a kill row — proves kill-table timestamps stay on the real clock (kill at `18:42:39.762`, i.e. 4.1 s *before* the file's own `Challenge Start`). |
| `Air Pure Medium … 18.42.50` | **Reset**, 7 s later. Its `Challenge Start` collides with the completed `18.44.15` run — the off-by-one below. |
| `Air Voltaic Invincible 4 Medium … 18.05.10` | **Reset** where `Score` is a raw accumulator, so it survives (`142.0` == `Damage Done`) instead of being zeroed. Contrast the Air Pure resets, where `Score` is derived and lands at `0.0`. |
| `VT Aether Novice S5 … 18.58.35` / `18.58.40` / `19.03.45` / `19.03.50` | **Reset spam** — four rerolls of one scenario, as close as 5 s apart. One carries 7 hits (~0.2 s of play) and one carries 0, proving even a near-instant reset still produces a file. |
| `RawMouseControl Reload - 2026.09.18-18.45.05` | **Abort** (pause → leave the scenario). A shape of its own: no ` - Challenge - ` in the filename, empty `Scenario:` and `Hash:`, `Challenge Start` garbage (`20:19:26.991`), yet `Avg FPS` is *normal*. The reset detector does not catch this one. |

**The off-by-one.** A reset file carries the **next** attempt's `Challenge Start`, not
its own — the challenge clock restarts before the dead attempt is flushed. So
`(Scenario, Challenge Start)` is **not** a unique key; it collides with the following
completed run. These are the other halves of those collisions:

| file | why |
| ---- | --- |
| `Air Pure Medium … 18.44.15` | Completed run sharing `18:42:50.379` with the reset above. |
| `Air Voltaic Invincible 4 Medium … 18.06.09` | Completed run sharing `18:05:10.001`. |
| `VT Aether Novice S5 … 18.59.40`, `… 19.04.50` | Completed runs closing the two reset chains. |

### Filename / timestamp skew

`challenge_start_utc` in the `.perf` is the CSV's `Challenge Start` **truncated to the
whole second**, so the two differ by the discarded fraction — uniformly spread over
roughly −997 ms..+3 ms. About half of all runs therefore have a perf start that rounds
to a *different second* than the CSV start, and when the write lands near a second
boundary the two **filenames** disagree too.

Each pair below has a `.csv` and a `.perf` whose filenames are **one second apart**.
Any importer joining on filename stem silently drops these.

| file (csv ts → perf ts) | why |
| ---- | --- |
| `Centering II 180 Intermediate … 15.01.52 → .53` | |
| `Centering II 180 Novice … 21.23.33 → .34` | |
| `Plink Palace Easy … 18.55.22 → .23` | |
| `SYW (Smooth Your Wrist) Truly FIXED … 17.13.49 → .50` | `Challenge Start` is `…04.999`, the worst case for truncation. |
| `SYW (Smooth Your Wrist) Truly FIXED … 17.14.47 → .48` | Same, `…02.999`. |
| `VT Curveswitch Intermediate … 16.51.41 → .42` | |
| `VT Raw Control Intermediate S5 … 16.54.34 → .35` | |
| `aimerz+ Static Switching 6 Bot Slightly Larger … 13.59.12 → .13` | |

The parenthesised names also carry commas-free punctuation through the filename parser.

### CSV-only history

| file | why |
| ---- | --- |
| `1w2ts Pasu Perfected Easy … 2025.12.29`, `… 2026.01.28` | Game version 3.8.x, before `.perf` existed. 310 files in the dump look like this. A missing `.perf` is **not** a validity signal — these are complete, valid runs. |

### CSV section variants

| file | why |
| ---- | --- |
| `Air Angelic 4 Voltaic Easy 70% … 13.13.11`, `… 18.52.53` | Tracking scenario: **empty kill table**. 46% of the dump looks like this; an empty section is normal, not a parse failure. Also `timescale` 0.7 with `time_limit` 60 — the `time_limit / timescale == real duration` identity. |
| `1w2ts Pasu Perfected Goated … 17.00.59`, `… 17.02.07` | The opposite: **40+ kill rows**, exercising the per-kill table properly. |
| `Happy Easter! … 2026.04.06` | **Every `Kill #` is `0`** and `Kills:` stays 0 — destructible targets (`Egg`) rather than bots. The only case where the kill index is not a 1-based counter, so it cannot be used as a key. |
| `Controlsphere rAim Easy 90% … 2026.02.05` | Non-zero `Pause Duration:`, which has **no representation in the `.perf` at all**. |
| `CG Adjust Click Micro 2T Easy Small … 14.12.01` | Projectile weapon: `shots_fired` ≠ `damage_possible`, which is what makes those two fields distinguishable at all. |

### Rare `.perf` event types

Each of these is a payload that fires in only a handful of files corpus-wide.

| file | why |
| ---- | --- |
| `Horizontal Bounce Dodge … 15.21.15` | `mbs_points` — 4 files in the dump. |
| `Floating Heads Timing Novice … 13.15.35` | `pause_count` — 3 files. Also carries a `Pause Duration:` the perf cannot express. |
| `1w2ts reload smallflicks larger … 15.17.33` | `reloads` — 19 files. |
| `VT Quadpulse Intermediate … 17.43.42` | `player_damage_taken` — 53 files. |
| `Air Spectral Easy … 08.31.25` | `distance_traveled` — 65 files. |
| `Aimerz+ Week #5 - Static Switching … 15.56.51` | `overshots`, including the **negative closing event** that zeroes the counter at end of run. Naively summing overshots gives 0. Note the scenario name itself contains ` - `, which breaks naive filename splitting. |

### Challenge-profile edge cases

| file | why |
| ---- | --- |
| `Air CELESTIAL No UFO Easier … 13.21.09` | `time_limit == 1000.0`, the **no-time-limit sentinel** (144 files). Anything dividing by the limit must special-case it. |
| `Aimerz+ Week #5 - Static Switching … 15.56.51`, `… 15.58.01` | `timescale != 1.0`. |
| `FuglaaXYZ Voltaic No Blinks Intermediate … 21.10.44` | `player_team == 2` — 19 files, all scenarios where bots shoot back. |
| `VT Air Novice … 12.39.04` | `end_challenge_after_kills == 5.0`. Run ends well before `time_limit / timescale`, so duration cannot be assumed from the limit. |
| `VT 1w3ts Intermediate S5 Clusters … 19.05.39` | 10+ `added_bots`, with `bot_max_lives` / `bot_teams` packed arrays of matching length. |
| `1w2ts Perfected … 18.54.05` | `map_name` ending in `.map` rather than `.json` (409 vs 1722 in the dump). |

---

## Known gaps

Things no fixture here covers, because no example exists in the dump:

- **Two files written in the same second.** If a player resets twice inside one second
  both files want the same name; we do not know whether KovaaK's overwrites, suffixes,
  or is rate-limited by scenario reload. Closest observed pair is 5 s apart.
- **A run straddling midnight.** `Challenge Start` has no date component, so the date
  has to come from the filename — which is the *write* time. A run starting at 23:59:40
  would need the rollover branch that nothing currently exercises.
- **A partial on a click-heavy scenario.** Every partial captured is a tracking
  scenario, so "resets carry few kill rows" is observed here, not proven in general.
- **Six `.perf` event types** that never fire in this corpus: `deaths`, `target_size`,
  `target_speed`, `random_sens_scale`, plus `player_max_lives` and
  `end_challenge_after_damage` in the header.
