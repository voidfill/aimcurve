# Scenarios directory: search, PB, rank and recent form

One page that lists every scenario played in this browser. It serves two uses
equally: jumping to a known scenario by name, and scanning what has been played
recently and how close recent form is to the PB. Each row opens the existing
scenario page.

Prerequisites: [product and page design](2026-09-20-product-and-page-design.md)
("Scenarios directory and detail"), [scenario page](2026-09-25-scenario-page-design.md)
(S1 versions, S2 navigation, S5 rolling median), [benchmark ranks](2026-09-25-benchmark-ranks-design.md)
(B4 pick, B5 rank), [run schema](2026-09-18-run-schema-design.md) (D3 scenario
identity, `run_complete`).

Out of scope: per-row sparklines (unreadable at row height for the work they
cost), race results shown as times, a trend indicator, filters beyond name
search and the benchmark select (L8), unplayed benchmark scenarios as rows
(the Benchmarks page's scorecard), Sessions and Benchmarks pages.

## Summary of decisions

| | |
| --- | --- |
| L1 | Route `#/scenarios` and a Scenarios nav tab, also active on scenario pages |
| L2 | One row per scenario version; a short hash tag only where names collide |
| L3 | Columns: Scenario, Rank, PB, Recent form, Runs, Last played |
| L4 | Recent form is the median of the last 10 completed runs and its gap to the PB |
| L5 | Scores are shown as recorded, for every scenario kind |
| L6 | Name search and column sort, both kept in the URL |
| L7 | One aggregate query, pure row functions, one composable |
| L8 | A benchmark select filters to that benchmark and ranks every row on its ladder |

---

### L1. Route `#/scenarios` and a Scenarios nav tab

The route is `#/scenarios`, named `scenarios`, lazy-loaded like Data and
Scenario. The header gains a **Scenarios** tab after Run, linking to the last
directory location visited (L6), so returning restores the search and sort.

The Scenarios tab is active on `#/scenarios` and on `#/scenario/:hash`. This
revises S2 of the scenario page design, which had no tab and no active tab on
scenario pages. The Run tab keeps pointing at `rememberedRunRoute`. The
`AppHeader` comment that calls the directory a later slice is updated.

The page title in the tab is "Scenarios".

### L2. One row per scenario version

A row is one scenario hash with at least one completed run. Versions that share
a display name are never merged (D3, S1). When two or more rows share a name,
each of them shows `shortHash(hash)` after the name as a muted mono tag; a
unique name shows no tag.

Clicking a row, or pressing Enter on a focused row, opens `#/scenario/:hash`.
Rows are focusable in table order. The scenario name is a real link, so
middle-click and copy-link work.

### L3. Columns

| Column | Content | Blank when |
| --- | --- | --- |
| Scenario | Name, plus the hash tag of L2 | never |
| Rank | The PB's rank as a dot and name, in the style of `PbCard`; "Unranked" below the first threshold | no benchmark is picked for the name, or there is no PB |
| PB | Highest completed score | no completed run has a score |
| Recent form | `1,240 · −8%` (L4) | no completed run has a score |
| Runs | Completed runs | never |
| Last played | Relative date of the latest completed run, full timestamp on hover | never |

Rank uses the same snapshot, the same `pick` and the same stored picks
(`aimcurve.benchmark-pick`, keyed by trimmed name) as Run and the scenario page,
and `rankOf` on the selected candidate's thresholds. The pick itself is changed
on Run or the scenario page; the directory's benchmark select (L8) overrides it
for display without changing it. Until the
snapshot has loaded, or if it fails to load, the Rank column is blank and the
rest of the table is unaffected.

Resets are not counted or shown anywhere on the page.

### L4. Recent form

The median of the last 10 completed runs with a score, by `started_at`, using
the same `median` as the scenario page's rolling median (S5), so the number
matches the right end of that page's typical line.

The gap is `(median − PB) / |PB|`, shown as a signed whole percentage (`−8%`,
`0%`). It is omitted, leaving the median alone, when the PB is 0.

With fewer than 10 scored runs the median is over the runs there are and the
cell is dimmed, matching S5's not-full window, with a title "median of N runs".

### L5. Scores as recorded

PB and recent form are the CSV score for every scenario, races included.
Telling a race from a clock scenario needs perf data and a scoring curve per
scenario (as `useScenario` does for one), which is too heavy for a list. The
scenario page still shows times for races.

### L6. Search and sort, kept in the URL

- **Search:** a text input above the table, focused on arrival. A
  case-insensitive substring match on the name, applied as you type. Leading
  and trailing whitespace is ignored.
- **Sort:** clicking a column header sorts by it; clicking it again reverses
  the direction. The sorted header shows an arrow and `aria-sort`. Defaults per
  column on first click: Scenario ascending, everything else descending.
  - Scenario: by name, locale-aware, case-insensitive; ties by hash.
  - Rank: by rank index; unranked below the lowest rank, blank (no benchmark)
    always last in either direction. Without a benchmark selected (L8), rows
    can be on different ladders, so this order is only approximate.
  - Recent form: by gap; rows without a gap always last.
  - PB, Runs, Last played: by value; blanks always last.
  - Every sort breaks ties by last played, newest first.
- **Default:** last played, newest first.
- **URL:** `?q=<search>&sort=<key>&dir=asc|desc&bench=<id>`, keys `name`,
  `rank`, `pb`, `form`, `runs`, `played`; `bench` as in L8. Defaults are omitted from the URL. Typing replaces
  the history entry rather than pushing one. Unknown keys fall back to the
  default.

States:

- Starting the database and query errors follow Run: "Starting the local
  database…", and a danger notice with the error and a retry.
- No scenarios at all: an empty state saying no runs are imported yet, with a
  link to Data ("Import your stats"), as on Run.
- A search with no matches: "No scenarios match '<q>'" with a Clear search
  action.

### L7. Structure

- **Query** `listScenarios(pg)` in `src/lib/scenario/queries.ts`: one pass over
  `run_complete` grouped by `scenario_id`, returning id, name, hash, completed
  run count, `max(score)`, `max(started_at)`, and the scores of the last 10
  scored runs (a `row_number()` over `scenario_id` by `started_at desc, id desc`,
  filtered to `<= 10`, aggregated into an array). Timestamps are normalized to
  ISO at the query boundary like the other queries.
- **Pure functions** in `src/lib/scenario/directory.ts`:
  - `directoryRows(scenarios)`: attaches the median, whether its window is
    full, the gap, and the hash tag for colliding names.
  - `filterRows(rows, q)` and `sortRows(rows, key, dir, rankIndex)`.
  - `parseDirectoryQuery(query)` and `directoryQuery(state)`: URL ↔ state, with
    defaults omitted.
  - `benchmarkOptions(snapshot, rows)` and `inBenchmark(rows, snapshot, id)`:
    the L8 select's options and filter.
- **Ranks** `usePbRanks(rows, bench)`: loads the shared snapshot once (the
  loader exported by `useBenchmarkRank`) and maps each row to its candidate and
  `RankResult`: the stored pick's, or the selected benchmark's (L8). It exposes
  the snapshot for the select's options.
- **Composable** `useScenarioDirectory()`: runs the query and reruns it when
  the import `revision` changes, as `useScenario` does; exposes state, error,
  rows and retry.
- **View** `src/views/ScenariosView.vue` and a `ScenarioTable.vue` component.
  The directory location is remembered for the nav tab the way
  `rememberedRunRoute` is for Run.

Testing: vitest for the pure functions (collisions, medians under and at 10
runs, zero PB, every sort's blank ordering, URL round trips, benchmark options,
filter and forced rank) and for
`listScenarios` against PGlite like the existing query tests (versions kept
apart, resets and partials excluded, only the last 10 scores). The page is
checked by eye in the dev server.

### L8. A benchmark select

Rank across scenarios compares positions on different ladders (a Seal on one
benchmark above a Master on another), so the directory offers one ladder at a
time.

- **Select:** in the panel header beside the search. The first option is
  *All scenarios*, the default. Then every benchmark that contains at least one
  scenario with a row here, as an `optgroup` per benchmark name with one option
  per difficulty, in snapshot order. Until the snapshot has loaded only *All
  scenarios* is offered.
- **Filter:** with a benchmark selected, only rows whose trimmed name is one of
  its scenarios are shown (the B3 lookup); every version of such a name
  appears. Search applies within it. Scenarios of the benchmark with no rows are
  not shown: the gaps are the Benchmarks page's scorecard.
- **Rank:** every row's Rank is its PB on the selected benchmark's ladder,
  ignoring the stored picks. The picks are never written from here, so going
  back to *All scenarios* shows them again. The Rank header's title names the
  benchmark, and the rank sort compares positions on one ladder.
- **URL:** `bench=<KovaaK's benchmark ID>`, omitted for *All scenarios*. An ID
  not in the snapshot, or not a number, is treated as *All scenarios*. While
  the snapshot loads, a URL with `bench` shows "Loading benchmarks…" instead of
  the table, so it never flashes unfiltered rows; if the snapshot fails to load,
  it is treated as *All scenarios*.
