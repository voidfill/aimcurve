# Benchmark ranks: thresholds, rank badge and chart bands

Every scenario that appears in a known benchmark shows its benchmark rank
automatically. Opening a run shows the rank of its score, the gap to the next
rank and the rank bands on the chart. There is no separate view, and no benchmark
has to be picked first.

Prerequisites: [product and page design](2026-09-20-product-and-page-design.md)
("Show next-rank target only when a verified benchmark mapping exists"),
[scoring model](2026-09-24-scoring-model-design.md) (D5 y-axis, D7 thresholds as
horizontal lines), [Run view](2026-09-24-run-view-design.md) (R1 header, R3–R4
chart and layers).

Out of scope: the Benchmarks page, overall and per-category benchmark rank
(Evxl's `rankCalculation`), leaderboard position, a PB rank separate from the
inspected run's rank, and any runtime network access.

Measured on 2026-09-25 against the live upstreams:

- **Evxl index:** 130 benchmarks, 264 difficulties, 1 hidden. No two difficulties
  share a `kovaaksBenchmarkId`.
- **KovaaK's sample** of five difficulties (Voltaic S4 and S5 Intermediate,
  Voltaic S5.5 Intermediate, Viscose S1 and S2 Medium): 106 unique scenario
  names, 24 of them in more than one difficulty.
  - Voltaic S5 and S5.5 share their Intermediate ladders unchanged.
  - Viscose S1 and S2 share scenarios with different thresholds, for example
    `1w3ts Pasu Perfected Micro Goated Larger` at `900..1600` in S1 and
    `790..1650` in S2.
  - `VT Bounceshot Intermediate` has a 4-rank ladder in Voltaic S4 and an
    8-rank ladder in Viscose S1.
  - A scenario being in several benchmarks with different thresholds is the
    normal case, not an edge case.

## Summary of decisions

| | |
| --- | --- |
| B1 | Thresholds come from a committed snapshot; the app makes no network requests |
| B2 | The generator makes one Evxl request and one KovaaK's request per difficulty, nothing else |
| B3 | One JSON, deterministic and diffable, loaded by dynamic import |
| B4 | Default benchmark is the newest season of the earliest-listed family; a pick is stored per scenario |
| B5 | Rank is the count of thresholds at or below the score |
| B6 | The header gets a rank badge, the gap to the next rank, and a benchmark select |
| B7 | Rank bands are painted under the chart as a layer; the y range reaches only a near target |
| B8 | Pure functions for build, lookup, pick, rank and y bounds; one composable joins them |

---

### B1. Thresholds come from a committed snapshot; the app makes no network requests

Neither Evxl nor KovaaK's can answer "which benchmarks contain scenario X?".
The Evxl index lists only per-category scenario counts, and KovaaK's benchmark
endpoint needs a benchmark ID. A lazy per-scenario lookup would therefore have to
fetch every benchmark first. Instead a script builds the whole
scenario → benchmarks mapping ahead of time, and the result is committed.

Benchmark thresholds rarely change. When they do, or when Evxl adds a benchmark,
the update is to rerun `pnpm gen:benchmarks` by hand and commit the result. There
is no CI workflow for it. The app works offline and gives the same result for
everyone, and it never sends per-user traffic to KovaaK's.

Both upstreams allow CORS (checked 2026-09-25), so live fetching remains possible
later. This spec does not use it.

### B2. The generator makes one Evxl request and one KovaaK's request per difficulty

`scripts/gen-benchmarks.ts` runs with `pnpm gen:benchmarks`
(`node --experimental-strip-types`; Node 22.22 is installed).

1. `GET https://evxl.app/data/benchmarks`. Drop benchmarks with `hidden: true`.
   Keep each benchmark's `benchmarkName` and, for each difficulty in listed order,
   `difficultyName`, `kovaaksBenchmarkId` and `rankColors`. `rankColors` is an
   object from rank name to colour whose key order is the ladder order. The
   generator fails if a rank name is integer-like, because JavaScript reorders
   those keys. None exist today. Other Evxl fields, such as `scenarioSelection`,
   are ignored. Single-rank ladders are valid.
2. For each difficulty, `GET https://kovaaks.com/webapp-backend/benchmarks/player-progress-rank-benchmark?benchmarkId=<id>&steamId=00000000000000000`.
   The placeholder steam ID needs no identity. Read
   `categories.*.scenarios.<name>.rank_maxes`. Some difficulties (2108, 2487
   on 2026-09-25) send these as numeric strings (`"1750"`), which are read as
   numbers; any other non-number makes the ladder unusable.

No other endpoints are called: no subscriber counts, no leaderboard totals, and
no Evxl internals.

Requests go one at a time, 0.5 s apart, with a generous 30 s timeout and a
`User-Agent` of `aimcurve-benchmarks (+https://github.com/voidfill/aimcurve)`.

**Scenario names** are trimmed with `.trim()` on both sides of the match. Both
are free text and the `scenario` table has no trim constraint, so the trim is
defensive. Across categories of one difficulty, a name seen twice
keeps its first occurrence. Within one category object, `JSON.parse` has already
kept the last one.

**Failure policy.** A 429, 5xx, timeout or network error is retried up to 3
times with backoff, honouring `Retry-After`. If it still fails, the whole run
fails and writes nothing. A partial snapshot would silently drop benchmarks. The
following are deterministic upstream data problems. They are skipped, listed in
the run summary, and do not fail the run:

- a difficulty whose response has no scenarios;
- a difficulty whose `rank_maxes` length differs from its `rankColors` count
  (Evxl and KovaaK's are maintained separately and can drift);
- a scenario whose thresholds decrease anywhere, or are all equal, which is no
  ladder at all. Ties are kept: B5 handles them, and B7 paints nothing for a
  zero-height band.

**Build/fetch split.** The transform from fetched payloads to the snapshot is a
pure function, `buildSnapshot(evxlIndex, responsesById)`, in
`src/lib/benchmarks/snapshot.ts`. It is tested (B8) and type-checked with the
app. That file has no relative imports, so the generator can import it through
Node's type stripping, which does not resolve extensionless specifiers. The
generator imports it as `../src/lib/benchmarks/snapshot.ts`. `tsconfig.json`
gains `"allowImportingTsExtensions": true` (valid because `noEmit` is set) and
`scripts/**/*.ts` in `include`, so `pnpm check` covers the generator.

### B3. One JSON, deterministic and diffable, loaded by dynamic import

`src/data/benchmarks.json`:

```jsonc
{
  "version": 1,
  "generatedAt": "2026-09-25T12:00:00Z",
  // Evxl index order: benchmarks as listed, then difficulties as listed.
  "benchmarks": [
    { "id": 598, "name": "Sparky (Voltaic) S1", "difficulty": "All",
      "ranks": [{ "name": "Silver", "color": "#CBD9E6" }, …] }
  ],
  // Trimmed scenario name → [benchmark index, thresholds], default first (B4).
  "scenarios": {
    "Popcorn Sparky": [[0, [70, 100, 150, 200, 250, 300, 370, 390]]]
  }
}
```

**Deterministic output.**
- `scenarios` keys are sorted by code unit.
- The file is written one benchmark and one scenario per line, so a regeneration
  diff shows exactly which ladders changed.
- Numbers are written as `JSON.stringify` gives them.
- `generatedAt` is carried over from the existing file unless the rest of the
  content, compared deep-equal, has changed. An unchanged run produces no diff.

The size is estimated from the five-difficulty sample (130 entries at ~70 bytes
each) extrapolated to 263 difficulties. That gives at most ~470 KB raw and about
140 KB gzipped (sample ratio 0.30), and less in practice, since shared scenarios
share one key. It is loaded with
`import('../data/benchmarks.json')`; Vite 8 emits it as its own chunk (verified).
The chunk is fetched only when a run view first asks for a rank, and the loading
promise is shared. The module is cast to `Snapshot` at that boundary. TypeScript's
inferred structural type of the JSON is not used.

**Matching.** The local scenario name is trimmed and looked up exactly. An
exact-name match counts as the "verified benchmark mapping" that the product spec
requires before showing a next-rank target.

A benchmark could carry a different version of a scenario under the same name,
with thresholds that do not fit the local runs. The select (B6) shows each
candidate's rank, which makes such a mismatch visible. No plausibility guard is
added.

### B4. The default benchmark is the newest season of the earliest-listed family; a pick is stored per scenario

**Family and season.** A benchmark's name splits into a family and a season. The
season is a trailing `S<n>`, `Season <n>` or `v<n>`, where `n` may have a
decimal part. The regex is `^(.*?)\s+(?:S|Season\s*|v)(\d+(?:\.\d+)?)$`,
case-insensitive. The family is the rest, compared case-insensitively. A name
without a suffix is season 1, and its whole name is the family.

On the live index this groups:
- Voltaic S3/S4/S5/S5.5
- Viscose Benchmarks / Viscose Benchmarks S2
- Revosect S1/S4/S5
- PureG S1/S2
- Sparky (Voltaic) S0/S1
- Anima Micro v1/v2
- Deadman's Static Benchmarks S1–S3
- Aimerz+ S0/S1
- Avasive S1/S2

Names such as `350fs`, `773TS Main β3.0` and `AimSpeed Benchmarks 2.0` stay
their own families, which is harmless.

**Order.** `buildSnapshot` stores each scenario's candidates default-first,
sorted by:
1. family, by the Evxl index position of the family's first-listed benchmark,
   so Voltaic stays ahead of later-listed families;
2. season, descending. The rule compares season numbers, not positions, because
   Evxl does not always list seasons in order (PureG S2 before S1, Sparky S1
   before S0);
3. Evxl index position, for difficulties of one benchmark and any remaining
   ties.

The default is the first candidate. For example,
`1w3ts Pasu Perfected Micro Goated Larger` defaults to Viscose Benchmarks S2
(`790..1650`), not S1 (`900..1600`). A Voltaic S5 Intermediate scenario that
is also in S5.5 defaults to S5.5.

The pick is stored with `useStorage('aimcurve.benchmark-pick', {}, localStorage)`
as `Record<trimmedScenarioName, kovaaksBenchmarkId>`:
- It is keyed by the KovaaK's benchmark ID because that ID is stable across
  regenerations, while indices are not.
- Every explicit pick is stored, including a pick of the current default. A
  later regeneration that changes the default therefore never moves a benchmark
  the user chose.
- A stored pick whose benchmark no longer contains the scenario is ignored, and
  the default is used.

### B5. Rank is the count of thresholds at or below the score

`rank_maxes[i]` is the minimum score for the `(i+1)`-th named rank. KovaaK's own
`ranks[]` starts with a "No Rank" entry that `rankColors` does not have, and a
score of 0 has `scenario_rank` 0 (benchmark 458, Voltaic S5 Intermediate: four
thresholds, four Evxl colours, five KovaaK's ranks).

For thresholds `t[0] ≤ … ≤ t[n−1]` and score `s`, the rank is
`k = |{ i : t[i] ≤ s }| − 1`:

- `k = −1` means **unranked**: below the first threshold.
- A score equal to a threshold reaches that rank. Upstream does not confirm this
  boundary; it is our choice.
- With ties, the higher of the tied ranks is reached.
- `next` is the first threshold strictly above `s`, and it names that rank.
  `gap = next − s`. At the top there is no next rank.

Thresholds are in the game's score units, which is the chart's y-axis (D5, D7).
For races that is `B − seconds`, and a higher score is better, so the math is the
same for both kinds.

**To verify during implementation:** confirm on the first generator run that
race-scenario ladders are ascending and sit in CSV score units. Check a race
scenario from `performances.zip` against its benchmark ladder. If a race ladder
turns out to be in seconds, `buildSnapshot` needs a conversion and this section
changes.

**Verified 2026-09-25:** all 10 race scenarios in the full dump (budget 1000)
have ascending ladders in CSV score units, for example `Air Pure Medium` scores
906–919 against Viscose Benchmarks S2 `870..930`. No conversion is needed. The
11 ladders skipped as decreasing are upstream typos in a single value, such as
`[…, 75, 74]`, not ladders in seconds.

The score is the inspected run's CSV `score`. A run with a null score shows no
rank.

### B6. The header gets a rank badge, the gap to the next rank, and a benchmark select

These are added to the Run view result header (R1), next to the scenario name.
Nothing is added when the scenario has no candidates or the snapshot has not
loaded. The header may shift once when the chunk arrives. That is accepted.

- **Badge.** The rank name on a swatch of its colour. The ink is black or white,
  whichever contrasts more with the swatch by relative luminance. An unranked run
  shows "Unranked" in neutral. The name is always text, so colour is never the only
  carrier.
- **Gap.** `47 to Gold`, unsigned, because elsewhere in the header a sign means
  ahead or behind. When the run's curve is a race, the gap reads `2.31 s to Gold`.
  When there is no curve (CSV-only or unsupported), it is in points. It is omitted
  at the top rank.
- **Benchmark select.** A native `<select>`, styled as a chip, so keyboard and
  Escape behaviour come from the platform. It shows only when there is more than
  one candidate. With a single candidate the benchmark is plain text. Each option
  reads `Voltaic S5 · Intermediate — Gold`: the candidate and this run's rank in
  it. The default option is suffixed "(default)". Choosing an option stores the
  pick (B4).

### B7. Rank bands are painted under the chart as a layer; the y range reaches only a near target

`ChartLayers`, and `ChartSettings`/`DEFAULTS` in `useRunAnalysis.ts`, gain
`ranks: true`. The existing `mergeDefaults` handles values already stored.

**Painting.** When a rank is shown and the layer is on, `paintUnder` paints
before the bot highlights, clipped to the plot:
- Each band `[t[k], t[k+1])` is filled in rank `k`'s colour at alpha 0.08. The top
  band is open to the top of the plot. The unranked region and zero-height (tied)
  bands are not filled.
- A 1 px line marks each threshold.
- The rank name is a small label at the right edge. Going upward, a label is
  dropped if it would sit within 12 px of the last label drawn. A flat baseline's
  label wins over rank labels.

**Colour on the dark theme.** Evxl ladders use `#000000` (20 times) and `#ffffff`
(22 times). The latter matches the "this run" line. Lines and labels therefore use
the rank colour with its HSL lightness clamped to [45 %, 80 %]. The badge swatch
uses the true colour, since it has its own ink. Some ladders repeat a colour, so
rank names, not colours, identify ranks everywhere. Green and red rank fills can
resemble the ahead/behind gap. At 0.08 alpha against the gap's stronger fill,
this is accepted.

**Y bounds.** `yBounds(dataMin, dataMax, rank, layerOn)` in `chart-data.ts` is
pure. Its upper bound is `max(dataMax, rank.next)`, but only when:
- the layer is on;
- a next rank exists;
- `rank.next − dataMax ≤ 0.5 × (dataMax − dataMin)`.

Otherwise it returns the existing bounds. The target is `rank.next` from B5, the
rank above the run's *score*, not the next threshold above the plotted data.
Local pace often peaks above the final score. An unranked run far below `t[0]` is
the same case: its target is `t[0]`, it is extended only when near, and no curve
is flattened.

The uPlot y `range` callback reads `yBounds`, then applies the existing
`rangeNum` padding. Changing the pick or toggling the layer re-ranges with
`u.setScale('y', …)`. The existing watchers only `redraw(false)`, which does not
rerun the range callback.

Race axis labels already show `B − y`, so thresholds need no conversion.

### B8. Pure functions for build, lookup, pick, rank and y bounds; one composable joins them

- `src/lib/benchmarks/snapshot.ts`: the snapshot types, `buildSnapshot`, and the
  deterministic serialiser. It has no relative imports (B2).
- `src/lib/benchmarks/rank.ts`: `rankOf(thresholds, score)` → `{ k, next, nextRank, gap }`.
- `src/lib/benchmarks/pick.ts`: `candidates(snapshot, name)` and
  `pick(candidates, storedId)`.
- `src/lib/run/chart-data.ts`: `yBounds` (B7).
- `src/composables/useBenchmarkRank.ts`: loads the snapshot lazily and takes a
  scenario name and score as refs. It returns
  `{ candidates, selected, rank, setPick }`, all null or empty until it has loaded.
  A failed import is logged, and the composable then stays empty.

## Testing

- `rank.ts`:
  - below the first threshold;
  - exactly on a threshold;
  - between two thresholds;
  - at and above the top;
  - ties, reaching the higher tied rank;
  - a single-rank ladder.
- `pick.ts`:
  - no stored pick;
  - a valid pick;
  - a pick of the default;
  - a stale pick;
  - a scenario with no candidates;
  - lookup of an untrimmed local name.
- `buildSnapshot` and the serialiser, on a small fixture:
  - a hidden benchmark;
  - a rank-count mismatch;
  - empty categories;
  - padded names, including padding that collides with an unpadded name;
  - a duplicate across categories;
  - a decreasing ladder, a tied ladder, and an all-equal ladder;
  - candidate order: family by first listing, season descending (including an
    out-of-order listing, an unsuffixed season 1, `v<n>` and a decimal season),
    then index position;
  - byte-identical output on a rerun;
  - `generatedAt` carried over when content is unchanged.
- `yBounds`:
  - a near target is extended to;
  - a far target is not;
  - the top rank;
  - the layer off;
  - unranked near and far.
- Gap formatting: points, race seconds, and no curve.
- `useBenchmarkRank`: stays empty until the snapshot resolves, then follows a
  change of scenario.
- Fetching and retries are not unit-tested. The first real generator run is the
  check, and its summary is reviewed in the commit.
