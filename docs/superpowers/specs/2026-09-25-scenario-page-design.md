# Scenario page: progression, configs, PB and recent runs

One page per scenario version that answers "am I improving on this scenario, and
with which settings?". It shows score progression with rank bands, per-bot
progression, the sens configs used, the PB, and recent runs. It also replaces
the Scenario select on Run, which moves the rail filter to links and a chip.

Prerequisites: [product and page design](2026-09-20-product-and-page-design.md)
("Scenarios directory and detail"), [Run view](2026-09-24-run-view-design.md)
(R2 baseline, R6 bot table), [scoring model](2026-09-24-scoring-model-design.md),
[benchmark ranks](2026-09-25-benchmark-ranks-design.md) (B4 pick, B5 rank, B7
bands and y bounds), [run schema](2026-09-18-run-schema-design.md) (D3 scenario
identity, D4 `config`, `run_session`).

Out of scope: the Scenarios directory and a Scenarios nav tab (to be specced
once detail-page usage settles), accuracy/TTK toggles on bot tabs, a time-range
filter, cm/360 conversion, rail rework beyond the filter chip, and an "Open in
Kovaak's" button on Run.

## Summary of decisions

| | |
| --- | --- |
| S1 | Route `#/scenario/:hash`; one scenario version per page, never merged by name |
| S2 | Reached from Run only; no nav tab; the Scenario select on Run is removed |
| S3 | Layout: header, progression chart, configs + PB, recent runs |
| S4 | A config group is sens scale, H/V sens, DPI, FOV and FOV scale |
| S5 | Overall tab: runs by attempt number, PB step, rolling median, rank bands |
| S6 | Bot tabs plot each bot's pace on the score scale, with rank bands, computed on demand |
| S7 | Open in Kovaak's uses the documented Steam deep link, by name |
| S8 | Pure functions for grouping, series and links; one composable joins them |

---

### S1. Route `#/scenario/:hash`; one scenario version per page

The route param is the full scenario hash (D3). Every figure on the page belongs
to that hash only. Scenarios that share a display name with a different hash are
other versions: they are never merged, but they are listed in a version switcher
next to the title, one entry each as `<short hash> · <n> runs · last <date>`,
linking to that hash's page. The switcher is absent when there is only one
version.

A hash with no completed runs in this browser shows a notice in the style of
Run's missing-run notice ("That scenario is not in this browser", with the short
hash, and why that can happen) and links to Run and Data. The page never shows a
different scenario in its place.

The page title in the tab is the scenario name.

### S2. Reached from Run only; the Scenario select on Run is removed

There is no Scenarios nav tab. On the Scenario page the Run tab keeps pointing at
the last Run location (`rememberedRunRoute`) and no tab is active.

Entry points:

- The scenario name in the Run header links to the scenario page for the
  inspected run's hash.

Changes to Run:

- `ScenarioFilter` (the select) is deleted. The `?scenario=<hash>` query
  parameter keeps filtering the rail, unchanged in meaning.
- While a filter is on, the rail's first element is a chip:
  `<scenario name> · Show all runs`. Show all runs clears the filter (the same
  `setFilter(null)` the select used). An unknown hash shows
  `Unknown scenario · <short hash> · Show all runs`.
- **Enter** on the row of the run being shown filters the rail to that row's
  scenario. That row is already selected, so following its link would change
  nothing; Enter on any other row follows its link and selects it, as a click
  does.
- The empty state's "Show all scenarios" action stays.

The rail is otherwise untouched; it gets its own rework later.

### S3. Layout

A single column, no rail, full main width. Top to bottom:

1. **Header.** Scenario name, short hash and the version switcher (S1). The
   PB's rank badge and gap to the next rank when a benchmark is mapped, from the
   same pick and lookup as Run (B4, B5), and the same benchmark select. A mono
   meta line: completed runs, time played (sum of completed run durations),
   last played. On the right: **Play in Run** (opens Run with
   `?scenario=<hash>` in follow mode) and **Open in Kovaak's** (S7).
2. **Progression chart** with tabs (S5, S6).
3. **Configs** and **PB** side by side; stacked below 800 px.
   - *Configs* (S4): one row per config group with sens (`H` or `H / V` plus
     scale, as in the Run header), DPI, FOV, runs, best, median and last used,
     most recently used first. The first row is marked *current*. The table
     says in a caption that it describes what happened under each config and
     does not isolate the effect of the config: later configs benefit from
     practice. Hovering or selecting a row highlights its runs in the chart
     (S5).
   - *PB*: score (or time for a race), date, how long it has stood ("standing
     for 12 days, 84 runs"), its rank when mapped, and a link that opens Run
     inspecting it. If the PB has no `.perf`, say so ("no curve recorded") rather
     than hiding it.
4. **Recent runs.** The last 20 completed runs, newest first: time, score, Δ to
   the PB before that run (the Run R2 *PB before* meaning, labelled as such),
   rank when mapped, and the config group marker. Each row links to Run
   inspecting that run, with the rail filtered to this scenario (the chip clears
   it). **Show more** appends the next 20.

Loading and error states follow Run: "Starting the local database…", a danger
notice with the error and a retry when a query fails. Resets are not listed or
counted anywhere on the page; the page is about completed results.

### S4. A config group is sens scale, H/V sens, DPI, FOV and FOV scale

The `config` row has 15 keys, most of which (crosshair, resolution scale, max
FPS, input lag) do not change how aiming feels. Grouping by the whole row would
split one sens into several near-identical groups. A group's key is:

`sens_scale, horiz_sens, vert_sens, dpi, fov, fov_scale`

Runs whose `config` rows differ only in other keys share a group. The group's
other keys are not shown in this slice.

Each group gets a stable label in order of first use (`C1`, `C2`, …), so colour
is never the only carrier. The three most recently used groups get a colour,
in the order of their labels; the rest share a neutral grey. Three is the most a
scatter can carry: the first three dark slots of the dataviz reference palette
(`#3987e5`, `#d95926`, `#199e70`) validate all-pairs on the chart surface
(worst CVD ΔE 9.4, normal-vision ΔE 20.9, all ≥ 3:1), and no fourth does.

### S5. Overall tab

- **x-axis:** completed attempt number (1-based, oldest first) by default; a
  toggle switches to date. The choice is persisted per browser. Session
  boundaries from `run_session` are faint vertical rules. The axis is padded
  so the first and last runs sit clear of the edges: half an attempt, each run
  centred in its slot, or on dates 2 % of the range, at least an hour.
- **Zoom and pan:** as Run's pace chart (Run R3), through `useChartZoom`; y
  fits the runs in view. The click that ends a drag opens no run. A click
  opens a run, so a double-click is no reset here: Escape and the *reset zoom*
  button are, and keys on that button are its own (Enter resets, not opens).
  Switching between attempt and date resets the zoom.
- **Dots:** one per completed run, coloured by config group (S4).
- **PB line:** a step line of the best result so far.
- **Typical line:** a rolling median of the last 10 completed runs, drawn
  thicker than the PB line. The first 9 points use the runs available, and are
  drawn lighter until the window is full.
- **Direction:** up is always better. A race plots completion time
  (`B − score`, as in Run R1) on a flipped axis, labelled in seconds.
- **Rank bands:** painted behind the dots when the scenario is mapped, with the
  same pick, colours and y bounds as Run (B4, B7). No mapping, no bands, and
  nothing in their place.
- **Hover/focus:** date and time, result, rank when mapped, config group, Δ to
  the PB before that run, and session. Keyboard focus steps between dots.
  **Click** or Enter opens Run inspecting that run.
- **Config highlight:** hovering a Configs row emphasises that group's dots and
  dims the rest; selecting a row pins it, selecting again clears.

A scenario with a single completed run shows its dot and no median line.

### S6. Bot tabs plot the pace in Run's bot table

Tabs: `Overall`, then one per bot for a clock scenario in the order Run's bot
table uses, or one per kill slot for a race (labelled `<slot> · <bot name>`).
Click scenarios (`isClicking`) get no bot tabs, as Run shows no breakdown there.
The tab set is decided from the latest completed run with kill detail.

A bot's own figure, its points or a race slot's split, is a fraction of the
run's result, so it cannot sit on the rank thresholds' scale: on VT Ground
Intermediate S5 a bot scores about 1,000 points against thresholds from about
2,600. The thresholds are not extrapolated. Instead each dot is the bot's
**pace**, the whole-run result at that bot's rate, which is what Run's pace
lines show over that bot's stretch:

- clock: `points / engaged seconds × duration`, a score;
- race: `split × slots`, a race time, plotted as `budget − time` on the same
  score scale as the Overall tab.

Run's bot table gains a **pace** column with the same figure, so every value on
a bot tab appears on Run. Both come from the same functions (`engagements`,
`clockRows`, `raceRows`, `fixedWindow`), and a dot's tooltip also shows the
table's points or split. Bot tabs share the Overall tab's axis, "best so far"
step line, rolling median and rank bands; the bands mean rank-equivalent pace,
not a rank achieved.

Time outside every engagement is left out of a bot's pace, so bot paces need
not add up to the final result, and the tab says so. On VT Ground, where the
time between bots scores little, the latest run's bots averaged about 2,985
pace in a run that scored 2,864. On a fixed-window scenario whose resets still
score, pace can sit at or below the result.

Runs without a `.perf` or kill detail leave a gap, never a zero. The tab header
says the coverage ("212 of 240 runs have bot detail").

**Cost.** Nothing bot-related loads until a bot tab is first opened. Then one
batch of `getScoringInputs` and `getKillDetail` over all runs of the scenario, one
`getSlotStats`, and the per-run computation. The result is kept for the page's
lifetime, so switching tabs is instant; curves are already memoised by file stem.
The tab shows a loading state meanwhile.

Budget: **under 300 ms** from opening a bot tab to drawn, for a 300-run
scenario.

Measured on 2026-09-25. The full dump's largest scenario with kills has 64
completed runs (`test/fixtures/scenario-corpus.test.ts`, Node, in-process
PGlite): VT Ground Intermediate S5, 64 runs, 3 tabs, 39 ms of queries and 3 ms
of computation; VT Aether Intermediate S5, 51 runs, 23 ms and 1 ms. Queries
grow with the runs' tick arrays, so 300 runs extrapolates to roughly 200 ms. In
the browser, on the same 78-run scenario, the first bot tab drew 29 ms after the
click with the database warm, and 479 ms when clicked straight after a cold page
load. Click scenarios never load bot detail, since the reference run already
shows they have no tabs. If it misses, the fallback is to persist per-run bot values at ingest (a
new table and a reimport), not to thin the data. A web worker is the step before
that if the cost is in computation rather than queries.

### S7. Open in Kovaak's uses the documented Steam deep link

Kovaak's 3.0 documents scenario deep links:

```
steam://run/824270/?action=jump-to-scenario;name=<name>
```

with spaces as `%20`. Tried by hand on 2026-09-25, that form opens the
scenario in freeplay, so the undocumented `;mode=challenge` suffix seen in
shared links is appended to open it as a challenge. The name is encoded
with `encodeURIComponent(name)`. The link is a plain `<a href>`, so the browser
handles the protocol prompt.

The link selects by name, not by hash. On a version that is not the newest by
last played among those sharing the name, the button's tooltip says Kovaak's
opens whatever it currently has under that name, which may differ from this
version.

### S8. Pure functions and one composable

In `src/lib/scenario/`, each unit-tested:

- `configKey(config)` and `configGroups(runs)`: the S4 key, groups with markers
  in first-use order, and per-group runs, best, median and last used.
- `pbSteps(values, better)` and `rollingMedian(values, window)`: the S5 lines,
  with direction handled by `better` and gaps (`null`) passed through.
- `botSeries(runs, inputOf, killsOf, window)`: per-tab series for S6, built only
  from the Run bot-table functions.
- `kovaaksLink(name)`: the S7 URL.
- `versionLabel(version)`: the S1 switcher entry.

Queries in `src/lib/run/queries.ts` (or a sibling `src/lib/scenario/queries.ts`):
scenario by hash with its sibling versions; completed runs of one scenario with
score, start, duration, `pb_before`, session and the S4 config columns. The
session and PB columns come from `run_session` and `run_progress`; `run_progress`
is filtered by `scenario_id` so the filter is pushed down (schema pushdown rule).

`useScenario(hash)` joins them: it loads the page's data, exposes the benchmark
rank through `useBenchmarkRank`, loads bot detail lazily on the first bot tab,
and reloads when an import adds runs of this scenario. `ScenarioView.vue` and
small components (`ScenarioHeader`, `ProgressChart`, `ConfigTable`, `PbCard`,
`RecentRuns`) render it. The rail chip is a small component in `AttemptRail`.

## Verification

1. A run's scenario name opens its scenario page; Play in Run returns to Run with
   the rail filtered and following; the rail chip clears it.
2. Enter on a rail row filters to its scenario; Show all runs restores the full
   rail.
3. Two scenarios sharing a name appear as separate versions with a working
   switcher; neither page counts the other's runs.
4. The Overall tab's PB line ends at the PB card's value; its dots match the
   recent-runs table; races read "up is better".
5. For a sample of runs, each bot tab's pace and points or split equal Run's bot
   table for that run and bot.
6. A bot tab on a 300-run scenario draws within the S6 budget; the measurement is
   recorded.
7. Configs group runs that differ only in crosshair; a sens change starts a new
   group and a new dot colour and label.
8. Unmapped scenarios show no bands and no rank; click scenarios show no bot
   tabs; runs without a `.perf` are gaps on bot tabs and counted in the coverage
   line.
9. Open in Kovaak's opens the scenario in Kovaak's through Steam.
