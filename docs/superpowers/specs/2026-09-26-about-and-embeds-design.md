# aimcurve: About walkthrough, link embeds, and README

Status: design approved in conversation; this document is for written review.

## Purpose

aimcurve has no pitch. A first-time visitor sees "No runs yet" and an import
button, with nothing that shows what they would get for their trouble. People
mostly arrive through links shared in Discord and aim-training communities, and
those links currently unfurl as a bare title.

This work gives the product three front doors:

1. **An About page** (`#/about`) with a short walkthrough of the most visually
   compelling charts, rendered live from bundled sample data. It must look good
   enough that the visitor wants to import their own stats right away.
2. **A link-preview card** for search engines, Discord, X/Twitter and Slack: one
   pretty graphic and a short line on why the app is useful.
3. **A README** that leads with the product, not the build setup.

Success: someone who clicks a shared link lands on the walkthrough instantly (no
database wait), understands what aimcurve shows within a few seconds of
scrolling, and has one obvious action — import their stats.

## Constraints

- **Hash routing, static host.** Link unfurlers do not run JavaScript and never
  see the fragment, so every URL unfurls from `index.html`'s static meta. One
  site-wide card is the goal anyway; per-page cards are out of scope.
- **Runs are local.** A shared run link cannot preview that run; the card is
  generic.
- **Absolute URLs.** `og:image` and `og:url` must be absolute. The site deploys
  to `https://voidfill.github.io/aimcurve/`; a custom domain may follow.
- **No database on About.** Opening PGlite and migrating takes seconds. About
  must render its charts without it.

## Non-goals

- A per-page or per-run embed card, or a separate `about.html` entry.
- A full-app demo mode (demo data in the Run, Scenario or Scenarios views).
- The attempt rail, run header, stats strip or chart controls on About.
- Scrubbing the demo runs' settings (sens, DPI, FOV, resolution, crosshair):
  the author accepts publishing them. If that changes, the snapshot script drops
  those fields; nothing else is affected.

## Architecture

The pipeline today:

```
PGlite ──► src/lib/{run,scenario}/queries.ts ──► pure lib ──► composables ──► components
```

Components (`UnifiedChart`, `BotTable`, `ProgressChart`) are already pure: props
in, pixels out. The pure lib (`curveFor`, `resolveBaseline`, bot tables, series)
is already database-free. Only the query functions touch PGlite, and they return
plain JSON-safe data (`ScoringInput` is plain `number[]` arrays, dates are
strings). Two things block reuse from About:

1. Composables reach the database through `useDb().pg` directly.
2. `RunDetail.vue` and `ProgressPanel.vue` assemble chart props inline, so the
   assembly cannot be reused without the rest of the component.

The design adds one seam at each point.

### D1. `DataSource`: queries without `pg`

`src/lib/source.ts` defines an interface whose methods are the existing query
functions with the `pg` argument removed, same arguments and return types:

| method | wraps |
| --- | --- |
| `listAttempts`, `getAttempt`, `getLatestAttempt`, `listScenarioOptions` | `lib/run/queries.ts` (`listScenarios` there is renamed in the interface to avoid the clash below) |
| `getScoringInputs`, `listScenarioRuns`, `getSlotStats`, `getKillDetail` | `lib/run/queries.ts` |
| `getScenario`, `listVersions`, `listHistory`, `listScenarioSummaries` | `lib/scenario/queries.ts` |

Plus any query currently issued inline by a composable the About page uses
(audit `useHasRuns` and `useBenchmarkRank`; lift inline SQL into
`queries.ts` first if About needs it, otherwise leave it).

Two implementations:

- **`pgSource(pg)`** — `src/lib/source-pg.ts`, binds each method to its query
  function. No behaviour change for the app.
- **`snapshotSource(snapshot)`** — `src/lib/source-snapshot.ts`, answers from a
  `DemoSnapshot` holding **complete tables**, not recorded calls: every
  `Attempt`, every `ScenarioRun`, `ScoringInput` and `KillDetail` keyed by run
  id, slot stats and history per scenario, scenario rows and versions. Each
  method filters by its arguments (id subsets, scenario id, pagination and
  filters as the SQL does). This matters because `useRunAnalysis` fetches in
  data-dependent batches; replaying recorded calls would break whenever that
  walk changes. Methods whose answer the snapshot does not hold throw a clear
  `DemoUnsupported` error rather than returning empty data.

`snapshotSource` must not import anything under `src/db/`.

### D2. Injecting the source

`src/composables/useSource.ts`:

```ts
interface SourceApi {
  source: ShallowRef<DataSource | null>; // null until ready
  revision: Ref<number>;                 // bumps when the data changes
}
provideSource(api: SourceApi): void
useSource(): SourceApi
```

- `App.vue` provides the pg-backed source: `source` follows `useDb().pg`,
  `revision` is `useImport().revision`. Every view renders under `App.vue`, so
  existing components need no provider change.
- Composables used by About — `useRunAnalysis`, `useScenario` and anything
  they call — switch from `useDb()`/`useImport()` to `useSource()`. Their watch
  lists change from `[pg, revision]` to `[source, revision]`. Other composables
  may migrate too but are not required to.
- The About view provides a snapshot source whose `revision` never changes.

`useSource.ts` must not import `useDb` or `db/client`, so About's chunk stays
free of them. There is no default: `useSource()` without a provider throws.
`App.vue` always provides the pg source; About provides its own, which
overrides `App.vue`'s for its subtree. (The app shell still opens the database
in the background on About, as it does today; About simply never waits on it.)

### D3. Chart assembly as composables

- **`useRunCharts(analysis, baseline, options)`** — extracted from
  `RunDetail.vue`: `chart` (`chartData`), `readoutAt`, `timeAt`, encounters and
  `spans`, bot `colors`, bot `table`, `chartBaseline`, `chartRanks`, `layers`.
  `options` carries the layer toggles and pace window as refs, so the Run view
  passes its persisted `settings` and About passes fixed values.
  `RunDetail.vue` keeps its template, loading/stale handling and settings
  controls, and calls `useRunCharts` for everything it passes to the chart and
  table. Behaviour is unchanged.
- **Progression props** — the parts of `ProgressPanel.vue` that turn
  `ScenarioData` into `ProgressChart` props for the Overall tab (x, y, best,
  median, `medianFull`, breaks, colours, `tipFor`, `formatY`, ranks) move to
  `useProgressChart(data, options)`. `ProgressPanel` keeps tabs, axis toggle,
  legend and bot tabs.

About must not read or write the user's persisted chart settings
(`aimcurve.run-chart`) or axis choice (`aimcurve.scenario-axis`). It may read
`aimcurve.benchmark-pick` through `useBenchmarkRank` but must not write it; if
`useBenchmarkRank` writes on read, About passes a fixed benchmark instead.

### D4. The demo snapshot

- **Source files:** the 39 completed Air Spectral Easy runs (2026-09-03 to
  2026-09-18, all with `.perf`) move from the gitignored raw dump into
  `test/fixtures/demo/{stats,performances}/`, committed through the existing
  Git LFS rules (extend `.gitattributes` to cover `demo/`). About 300 KB.
  A `test/fixtures/demo/README.md` states what the set is for.
- **Generation:** `scripts/gen-demo.ts` creates an in-memory PGlite (as
  `test/helpers/db.ts` does), applies migrations, runs the real ingest
  (`buildChunk` → `applyChunk`) over the demo files, then calls the real query
  functions to fill a `DemoSnapshot`, and writes
  `src/data/demo-snapshot.json` (gitignored, generated).
- **When:** `pnpm build` and `pnpm dev` run it first when the output is missing
  or older than any demo file or `src/db/sql/*` (a `predev`/`prebuild` script,
  or a small Vite plugin — implementer's choice). CI builds regenerate it, so
  the snapshot cannot drift from the ingest and query code.
- **Loading:** the About view imports the JSON dynamically, so it is its own
  chunk and loads only on About. Target under 300 KB gzipped; if the raw JSON
  is far larger, trim per-tick arrays to the runs About actually charts plus
  what their baseline/recent walk needs, and document the trim.

### D5. The About page

Route `#/about` (`name: 'about'`), a lazy-loaded `AboutView.vue`. It is the
only page that never shows the empty state: it does not depend on the user's
database.

Layout, top to bottom, a single readable column (max ~960 px) in the app's
existing dark style:

1. **Hero.** Wordmark, one-line pitch (draft: *"See where your KovaaK's runs
   are won and lost."*), one sentence of support, primary CTA **Import your
   stats** (to `#/data`), and a secondary "or scroll to see how it works".
2. **Beat 1 — "See where the run slipped."** The unified pace chart for one
   pinned demo run that led its PB-before baseline early and fell behind late,
   with rank bands, local and accumulated pace, and the baseline line on.
   Tooltip and crosshair are live. One or two sentences explain accumulated
   versus local pace and the rank bands in plain words.
3. **Beat 2 — "Find the bot that costs you."** The same run's bot table beside
   or under the same chart instance; hovering or pinning a row highlights its
   encounters, as in the Run view. Prefer sharing the Beat 1 chart over a
   second chart if the layout reads well; otherwise a second instance.
4. **Beat 3 — "Watch the curve bend."** The Overall progression chart for Air
   Spectral Easy across all 39 runs: dots, PB step line, rolling median, rank
   bands, session breaks.
5. **Closing CTA.** Repeat **Import your stats**, the privacy line
   (*"Everything stays in this browser. Nothing is uploaded."*), and a short
   "what you need": KovaaK's with stats output on (the default).

Each beat carries a small "Sample data: Air Spectral Easy" label so no one
mistakes it for their own runs. The pinned run is a named constant
(`DEMO_RUN_STEM`) chosen during implementation by inspecting the data for the
clearest early-lead/late-loss shape.

Loading: the page shell and copy render immediately; charts show a
chart-shaped placeholder until the snapshot chunk arrives. A failed chunk load
shows a one-line error with a retry, and the CTAs still work.

Narrow screens: beats stack; charts take full width; the bot table scrolls
horizontally, per the existing responsive rules.

App bar: an **About** link at the right, beside the import control, styled as
a quiet text link rather than a primary tab. `document.title` is
`About — aimcurve`.

### D6. First-visit redirect

A `router.beforeEach` guard, on the **initial** navigation only:

- If the target is the root run route with no query, and the visitor has not
  been marked as having seen About, redirect to `#/about`.
- "Seen About" is true when `localStorage['aimcurve.seen-about']` is set, **or**
  any other `aimcurve.*` key exists (a returning user from before this
  shipped).
- Rendering `AboutView` sets `aimcurve.seen-about`, however the visitor got
  there.
- Deep links (`#/scenario/…`, `#/?run=…`, `#/data`) are never redirected.
- All storage access is wrapped in try/catch; if storage throws, no redirect.

The guard is synchronous and runs before any database access, so a first-time
visitor sees About with no wait. The pure decision lives in a function
`shouldShowAbout(target, keys)` for testing.

### D7. Link-preview card

In `index.html`:

- `<title>aimcurve — KovaaK's run analysis</title>`
- `<meta name="description">` — draft: *"Free KovaaK's run analysis in your
  browser: see where each run gained or lost pace, which bots cost you, and how
  you're improving. Nothing is uploaded."*
- `og:type` `website`, `og:site_name`, `og:title`, `og:description`,
  `og:url`, `og:image` (+ `og:image:width` 1200, `og:image:height` 630,
  `og:image:alt`).
- `twitter:card` `summary_large_image` (X reads the `og:` tags for the rest).
- `theme-color` — the app's accent, used by Discord for the embed stripe.
- `<link rel="canonical">`.

Absolute URLs come from a `%SITE_URL%` placeholder replaced by a small inline
plugin in `vite.config.ts` (`transformIndexHtml`), reading
`process.env.SITE_URL` with default `https://voidfill.github.io/aimcurve/`.
A custom domain later means setting one variable in the deploy workflow.

**`public/og.png`** — 1200×630, committed. Composition: the Beat 1 pace chart
cropped to its most dramatic stretch (rank bands, both accumulated lines, the
gap fill) on the app background, with the wordmark and the pitch line. Made by
rendering a card-sized layout of the About chart and screenshotting it (a
`?card` query on `#/about` that hides everything but the composition, or a
one-off dev-only route — implementer's choice), then committing the PNG.
Regenerated by hand when the chart look changes materially. Under 300 KB.

### D8. README

Rewritten product-first:

1. Wordmark/one-liner and a hero image (`og.png` or the Beat 1 screenshot).
2. **Open aimcurve →** link to the live site.
3. What it shows: three short items mirroring the beats, each with a
   screenshot from About, in `docs/images/`.
4. How to use: open the site, import your KovaaK's `stats` folder, play —
   new runs appear as they land (where folder access is supported).
5. Privacy: processed in the browser, stored locally, nothing uploaded, no
   sync across devices.
6. **Development** — the current README content, unchanged except for the
   new `gen-demo` script in the scripts table and the demo fixtures in the
   layout section.

## Testing

- **Source parity:** a vitest suite ingests the demo files into a test PGlite,
  builds a snapshot with the generator's code, and asserts
  `snapshotSource(snapshot).m(args)` deep-equals `pgSource(pg).m(args)` for
  each method over representative arguments (all ids, a subset, an unknown id,
  pagination edges, filters).
- **Snapshot generator:** runs in the same suite; asserts the snapshot holds 39
  runs and the pinned `DEMO_RUN_STEM` exists and has a curve.
- **Redirect:** unit tests for `shouldShowAbout` — fresh visitor, flag set,
  legacy key present, deep link, query present, storage throwing.
- **Extraction:** existing `RunDetail`/`ProgressPanel`-adjacent tests stay
  green; `useRunCharts` gets a test that its output for the demo run matches
  what `chartData` etc. produce directly.
- **Import graph:** a test (or build assertion) that the About chunk's module
  graph contains neither `src/db/client.ts` nor `@electric-sql/pglite`.
- **Manual:** About renders with no network wait for the database (check with
  OPFS empty and throttled CPU); Discord and X card validators show the image
  and text for the deployed URL.

## Delivery order

1. `DataSource`, `pgSource`, `useSource`; migrate `useRunAnalysis` and
   `useScenario`. App unchanged in behaviour.
2. Extract `useRunCharts` and `useProgressChart`.
3. Demo fixtures, generator, `snapshotSource`, parity tests.
4. `AboutView`, route, app-bar link, first-visit redirect.
5. `index.html` meta, `SITE_URL` plugin, `og.png`.
6. README and screenshots.
