# KovaaK's `.perf` file format

Reverse-engineered from the 2139 `.perf` files in `test/fixtures/raw/performances/`,
validated against the 2131 of them that have a paired `... Stats.csv` in
`test/fixtures/raw/stats/`.

Schema lives in [`proto/perf.proto`](../proto/perf.proto); generated TypeScript in
`src/gen/perf_pb.ts` (`pnpm gen:proto`). The validation sweep is
`src/lib/parse/perf.test.ts`.

## How this was worked out

1. A generic protobuf wire walker (throwaway, not in the repo) dumped every field
   number / wire type / length at every nesting level across all 2139 files, so
   cardinality and rarity were measured rather than guessed.
2. Wire-type-2 payloads were disambiguated three ways: does the payload re-parse
   as a valid submessage, is it valid UTF-8, does it decode as packed varints of
   an arity that matches a sibling repeated field.
3. Every numeric field was cross-correlated against every numeric metric in the
   paired CSV (exact match and relative-tolerance match), across the whole corpus.
4. **After** the structure was fully derived this way, it was checked against the
   schema KovaaK's publishes at
   <https://wiki.kovaaks.com/home/KovaaK's/PerformanceFiles> (the actual file is at
   <https://wiki.kovaaks.com/performance.proto>, `package gst`, "schema version 1 as
   of 5/21/2026"). **The independently derived structure matched the vendor schema
   field-for-field.** Field numbers and semantics in `proto/perf.proto` are
   therefore identical to upstream; only the package name (`aimcurve.v1`) and one
   message name (`MbsPoints` vs upstream `MBSPoints`, for buf lint) differ.

Because of step 4, "confirmed" below means *we verified it numerically against the
CSVs ourselves*, not merely that the vendor says so. Fields the vendor documents
but which never appear in our corpus are marked `[vendor]` and are untested.

## Where field documentation lives

Per-field intent is documented **inline** rather than here:

- `.perf` fields → comments in [`proto/perf.proto`](../proto/perf.proto), the schema
  itself. Prose marked `Vendor:` is from the wiki page; the rest is our measurement.
- `Stats.csv` fields → doc comments in
  [`src/lib/parse/stats-csv.ts`](../src/lib/parse/stats-csv.ts).

Two things about provenance are worth knowing before trusting any of it:

1. **The upstream `performance.proto` carries no comments at all.** Every statement
   of intent comes from the prose on the wiki page, not from the schema file.
2. **The `Stats.csv` format has no vendor documentation.** The wiki's performance
   page says it "is documented separately", but no such page exists — the wiki has
   33 pages (enumerated via its GraphQL API) and none covers the CSV. Everything in
   `stats-csv.ts` is inferred from the corpus and from the `.perf` fields each
   column lines up with, and is labelled accordingly.

Two vendor notes that change how you compute things, both recorded at the fields
they affect:

- **Projectile weapons desynchronise `shots_fired` and `shots_hit` across ticks.**
  Per-tick accuracy is unreliable on those scenarios; aggregate over the run.
- **An absent event type means "not applicable to this scenario", not zero.**
  Tracking scenarios omit `reloads`; semi-auto clicking scenarios omit `overshots`.

## Wire structure

```
PerformanceFile
├── 1  header : Header
└── 2  events : repeated Event        (238..754 per file; 804,692 total in the corpus)

Header
├── 1  scenario_name        string
├── 2  scenario_hash        string  (32 hex chars)
├── 3  challenge_start_utc  int64   (ms since epoch, UTC)
├── 4  schema_version       uint32  (always 1)
└── 5  challenge_profile    ChallengeProfileSnapshot

Event
├── 1  timestamp  float   (fixed32, seconds since challenge start, real time)
└── oneof payload         (exactly one of fields 2..18, each a 1-field submessage)
```

Every `Event` submessage in the corpus contains field 1 plus exactly one other
field — 804,692 for 804,692. The oneof is not an inference from one file; no
`Event` ever carries two payloads or none.

Payload submessages come in three shapes, all with the inner field numbered 1:

| shape   | inner type       | meaning                              |
| ------- | ---------------- | ------------------------------------ |
| `count` | `int32` (varint) | integer increment for this tick      |
| `delta` | `float` (fixed32)| float increment for this tick        |
| `value` | `float` (fixed32)| instantaneous reading at this tick   |

Counts and deltas are **per-tick increments, not running totals**. Ticks fire at
~1 Hz and only accumulate while the game world is running; an `Event` is emitted
only for metrics that actually changed during that tick, which is why e.g.
`shots_missed` appears 1..125 times per file while `shots_fired` appears 45..125.

## `ChallengeProfileSnapshot` (header field 5)

| # | name | type | confidence | evidence |
| - | ---- | ---- | ---------- | -------- |
| 1 | `time_limit` | float | **confirmed** | Challenge duration in *scenario* seconds (already multiplied by `timescale`). `time_limit / timescale` equals the last event timestamp within 1.6 s for 1985/1987 files that have a finite limit. `1000.0` is the "no time limit" sentinel (144 files). |
| 2 | `player_profile` | string | partial | Character profile name. 17 distinct values (`Player` 1219×, `A` 344×, `Clicker` 126×, …). Meaning taken from vendor doc; nothing in the CSV to check it against. |
| 3 | `added_bots` | repeated string | **confirmed** | 1..12 per file, `.bot` (4302) and `.rot` (810) filenames. Confirmed as the ordering key for fields 5 and 7. |
| 4 | `player_max_lives` | int32 | `[vendor]` | Never observed — always the proto3 default, so never on the wire. |
| 5 | `bot_max_lives` | repeated int32 (packed) | partial | Packed length equals `added_bots` length in 2131/2131 files — that arity match is solid. Values 0,1,4,5,6,8; non-zero almost exclusively on `.rot` entries and on "Invincible N" scenarios, which is consistent with a lives cap but is not independently provable from the CSV. |
| 6 | `player_team` | int32 | partial | Only 1 (2112 files) and 2 (19). The 19 twos are dodge/reload/reactive scenarios where bots shoot back. Consistent with a team id; not independently provable. |
| 7 | `bot_teams` | repeated int32 (packed) | partial | Packed length equals `added_bots` length in 2131/2131. Values 0, 1, 2. |
| 8 | `map_name` | string | partial | `.json` (1722) or `.map` (409). Always present. |
| 9 | `map_scale` | float | partial | 1.0..10.0, constant per scenario (0 of 284 scenarios vary). **Not** target scale: it does not track the CSV's `Avg Target Scale`, and `1w2ts Perfected` / `1w2ts Perfected 30% Larger` share the same value. We could not derive its meaning from the data; the name is the vendor's. |
| 10 | `timescale` | float | **confirmed** | 0.55..2.0. Confirmed by the `time_limit / timescale == real duration` identity above — e.g. `Air Angelic 4 Voltaic Easy 70%` has `time_limit=60`, `timescale=0.7`, and a real duration of 85.7 s. |
| 11 | `end_challenge_after_kills` | float | partial | Observed twice, value 5.0 (`VT Air Novice`, `VT Plaza Novice`). Both runs end well before `time_limit / timescale`, which is consistent with an early-stop condition. |
| 12 | `end_challenge_after_damage` | float | `[vendor]` | Never observed. |

Field-number order within the snapshot is always ascending, and fields 1,2,3+,5,6,7,8,9,10
are present in every file.

## Events (the `oneof`)

Counts are over all 2139 files; the CSV validation is over the 2131 paired ones.

| # | name | shape | files | events | confidence | validated against |
| - | ---- | ----- | ----: | -----: | ---------- | ----------------- |
| 2 | `shots_fired` | count | 2139 | 131,048 | **confirmed** | sum == weapon table `Shots`, exact, 2131/2131 |
| 3 | `shots_hit` | count | 2139 | 128,364 | **confirmed** | sum == `Hit Count:`, exact, 2131/2131 |
| 4 | `shots_missed` | count | 2139 | 107,602 | **confirmed** | sum == `Miss Count:`, exact, 2131/2131 |
| 5 | `damage_done` | delta | 2139 | 128,364 | **confirmed** | sum == `Damage Done:`, 2131/2131 within float tolerance |
| 6 | `damage_possible` | delta | 2139 | 131,048 | **confirmed** | sum == weapon table `Damage Possible`, 2131/2131 |
| 7 | `score` | delta | 2139 | 128,581 | **confirmed** | sum == `Score:`, 2131/2131 within float tolerance |
| 8 | `kills` | count | 1189 | 42,370 | **confirmed** | sum == `Kills:`, exact, 1186/1186 paired |
| 9 | `deaths` | count | 0 | 0 | `[vendor]` | `Deaths:` is 0 in every paired CSV, so the event never fires |
| 10 | `overshots` | count | 272 | 6,320 | **confirmed** | see quirk below |
| 11 | `player_damage_taken` | delta | 53 | 501 | **confirmed** | sum == `Damage Taken:`, 53/53 |
| 12 | `reloads` | count | 19 | 23 | **confirmed** | sum == `Reloads:`, 19/19 (count is always 1) |
| 13 | `pause_count` | count | 3 | 3 | **confirmed** | sum == `Pause Count:`, 3/3 (count always 1). `Pause Duration:` is *not* recoverable from this event |
| 14 | `distance_traveled` | delta | 65 | 298 | **confirmed** | sum == `Distance Traveled:`, 65/65 |
| 15 | `mbs_points` | delta | 4 | 170 | **confirmed** | sum == `MBS Points:`, 4/4 |
| 16 | `target_size` | value | 0 | 0 | `[vendor]` | never observed (needs adaptive-size scenarios) |
| 17 | `target_speed` | value | 0 | 0 | `[vendor]` | never observed |
| 18 | `random_sens_scale` | value | 0 | 0 | `[vendor]` | never observed (needs Random Sensitivity mode) |

Note the disambiguation that mattered: `shots_fired`/`damage_possible` and
`shots_hit`/`damage_done` are numerically identical in 61% of files (1 damage per
shot) — they are distinguishable only because 39% of files have a weapon where
they diverge, and because the pairs use different wire types (varint vs fixed32).

### Quirk: `overshots` closes itself out

In all 272 files that record overshots, the very last `overshots` event carries a
**negative** count exactly equal to the negation of the sum of all preceding ones,
zeroing the running counter at end of run. There is exactly one negative event per
file, always last. Example (`Aimerz+ Week #5 - Static Switching`): 55 positive
increments summing to 1774, then a final `-1774` at t=59.98 s.

On the wire these negatives are `int32` sign-extended to a 10-byte varint, which is
why the `Event` submessage length distribution is `{9, 10, 12, 18}` rather than
`{9, 10, 12}`.

Consequence: **naively summing `overshots` gives 0, not the overshot total.** Sum
the positives (or drop the final event). Summed that way it equals `Total Overshots:`
exactly in the majority of files; where it differs the shortfall is at most one
tick's worth (max observed 250, median 0) because the reset event replaces the final
tick's increment.

## `challenge_start_utc` vs the filename

`challenge_start_utc` is epoch milliseconds, always at whole-second resolution
(`% 1000 == 0` in all 2139 files).

The vendor wiki says the filename timestamp "is local time at the moment the
challenge started". **Our data contradicts that.** Interpreting the filename
timestamp as local time, `challenge_start_utc` is consistently *earlier* by 44..149
seconds, median 60 — i.e. by one full run duration. So `challenge_start_utc` is the
start and the filename timestamp is the end/write time. Don't join the two on the
assumption they're equal.

Corroboration that the event timeline is real (not dilated) time: for the sampled
files, the wall-clock offset of the last row of the CSV kill table from
`Challenge Start:` matches the timestamp of the last `kills` event within one tick
(187/188).

## Round-trip fidelity

Decode with `fromBinary(PerformanceFileSchema, …)`, re-encode with `toBinary`:

- **2139 / 2139 files decode without error.**
- **2139 / 2139 re-encode byte-identically.**
- **0 files carry any unknown field** (`$unknown` is empty everywhere), so the
  schema covers the corpus exhaustively — the byte-identity is not being propped up
  by protobuf-es's unknown-field retention.

Byte-identity holds because the writer emits fields in ascending field-number order,
packs `bot_max_lives` / `bot_teams` (proto3 default for repeated scalars), and never
emits an empty payload submessage or a zero-valued scalar — which is exactly what
proto3 canonical encoding reproduces.

## What is still unknown

- **`map_scale` (snapshot field 9).** Constant per scenario, 1.0..10.0, but we could
  not tie it to anything observable. It is not `Avg Target Scale`, not bot count, not
  the map file, not the character profile, and not a function of `timescale`. Name is
  the vendor's; treat the *meaning* as unverified.
- **`player_profile`, `map_name`, `bot_max_lives`, `bot_teams`, `player_team`.** The
  structure (types, arity, parallelism to `added_bots`) is confirmed; the *semantics*
  rest on the vendor doc, because `Stats.csv` exposes nothing to check them against.
- **Six event types never fire in this corpus**: `deaths`, `target_size`,
  `target_speed`, `random_sens_scale` (and `player_max_lives` /
  `end_challenge_after_damage` in the header). Their field numbers and types come
  from the vendor schema and are untested here.
- **`Pause Duration:`** from the CSV has no representation in the `.perf` at all;
  `pause_count` only records that a pause happened.
- **Tick cadence** is "~1 Hz" but not uniform. Of 128,999 gaps between consecutive
  distinct timestamps: 128,491 are within 0.01 s of 1.0 s, 147 exceed 2 s (up to
  11.0 s), 144 are under 0.5 s (down to 0.0016 s), and the rest sit just off 1 s. We
  did not establish what produces the long and short gaps — pauses, world-stop, and a
  partial final tick are all plausible, but we did not prove it.
- The corpus is one player's recordings, so rare fields may be absent from this
  dataset rather than from the format. It does span 16 game versions
  (`3.8.2` through `3.9.9`, Dec 2025 – Sep 2026) with no structural change observed,
  which supports the vendor's forward-compatibility promise.
