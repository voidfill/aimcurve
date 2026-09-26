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
plain data: ISO date strings, `number[]` ticks, and two `Map`s (see D1). Two
things block reuse from About:

1. Composables reach the database through `useDb().pg` directly.
2. `RunDetail.vue` and `ProgressPanel.vue` assemble chart props inline, so the
   assembly cannot be reused without the rest of the component.

The design adds one seam at each point.

### D1. `DataSource`: queries without `pg`

`src/lib/source.ts` defines an interface holding **only the queries About
needs**, each the existing query function with the `pg` argument removed, same
arguments and return types:

| method | wraps |
| --- | --- |
| `getAttempt`, `listScenarioRuns`, `getSlotStats`, `getScoringInputs`, `getKillDetail` | `lib/run/queries.ts` |
| `getScenario`, `listVersions`, `listHistory` | `lib/scenario/queries.ts` |

Everything else (`listAttempts` and its cursor, `getLatestAttempt`, the two
`listScenarios`, `useHasRuns`'s inline count) stays `pg`-only. Widening the
interface is a later decision, made when a second consumer needs it.

Two implementations:

- **`pgSource(pg)`** — `src/lib/source-pg.ts`, binds each method to its query
  function. No behaviour change for the app.
- **`snapshotSource(snapshot)`** — `src/lib/source-snapshot.ts`, answers from a
  `DemoSnapshot` of **precomputed answers keyed by the query's natural key**,
  not recorded calls and not re-implemented SQL:
  - `attempts: Record<fileStem, Attempt>`
  - `scoringInputs`, `killDetail: Record<runId, …>` — the methods take an id
    list and rebuild a `Map` of the ids present, exactly like the SQL `WHERE id
    = ANY(…)`. This is the only "filtering" the source does, and it is why
    `useRunAnalysis`'s data-dependent batching works unchanged.
  - `scenarioRuns`, `slotStats`, `history: Record<scenarioId, …[]>`
  - `scenarios: Record<hash, Scenario>`, `versions: Record<name, …[]>`

  A key the snapshot does not hold returns what the SQL would return for an
  unknown key (`null`, `[]`, or a `Map` without it). The snapshot holds every
  run of the demo set in full; nothing is trimmed, because a missing input would
  make baseline and recent selection differ from the real app.

Query results are JSON-safe apart from the two `Map`s: dates are already ISO
strings and ticks are plain `number[]`. The snapshot stores those as records
and `snapshotSource` rebuilds the `Map`s.

`source-snapshot.ts` must not import anything under `src/db/`.

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
- `useRunAnalysis` and `useScenario` switch from `useDb()`/`useImport()` to
  `useSource()`. Their watch lists change from `[pg, revision]` to
  `[source, revision]`. No other composable migrates in this work.
- **Vue's `inject` never sees the calling component's own `provide`.** So
  `AboutView.vue` provides the snapshot source and renders the charts through a
  child, `AboutDemo.vue`, which is where `useRunAnalysis`, `useScenario` and
  the chart composables are called. A test mounts `AboutView` with a pg source
  that throws on any call and asserts it is never called.

`useSource.ts` must not import `useDb` or `db/client`. There is no default:
`useSource()` without a provider throws.

### D3. Chart assembly as composables, and settings out of the loaders

**`useRunAnalysis` stops owning chart settings.** Today it creates
`aimcurve.run-chart` via `useStorage`, which writes defaults on first read, and
reads `settings.option` for the baseline. It instead takes
`option: Ref<BaselineOption>` as a parameter and no longer returns `settings`.
`RunDetail.vue` owns the `useStorage` call and passes `option` in.

**`useBenchmarkRank` takes its picks store.** Today `usePicks()` calls
`useStorage('aimcurve.benchmark-pick', {})`, which also writes on read. It gains
an optional `picks: Ref<Record<string, number | null>>` parameter; the app
passes nothing (persisted, as today), About always passes `ref({})` so the
default benchmark is used and nothing is written.

- **`useRunCharts(analysis, baseline, bench, options)`** — extracted from
  `RunDetail.vue`: `chart` (`chartData`), `readoutAt`, `timeAt`, engagements,
  encounters and `spans`, bot `colors`, bot `table`, `chartBaseline`,
  `chartRanks`, `layers`, **and the bot hover/pin highlight state** (`active`,
  `pinned`, the highlighted encounters, and the hover/toggle handlers Beat 2
  needs). `bench` is a `useBenchmarkRank` result passed in. `options` carries
  layer toggles and pace window as refs: the Run view passes its persisted
  settings, About passes constants. `RunDetail.vue` keeps its template,
  loading/stale handling and settings controls. Behaviour is unchanged.
- **`useProgressChart(data, { activeTab, bots, bench, dateAxis })`** — the
  prop assembly from `ProgressPanel.vue` (`series`, `lines`, `top`, `ranks`,
  x, breaks, colours, `tipFor`, `formatY`), which branches on the active tab
  and bot series, so those are inputs, not assumptions. `ProgressPanel` keeps
  the tabs, its persisted `aimcurve.scenario-axis` toggle, legend and bot
  loading. About passes the Overall tab, `bots: null` and
  `dateAxis: ref(false)` (see D5, beat 3).

Net rule, tested: rendering About writes no `localStorage` key except
`aimcurve.seen-about`.

### D4. The demo snapshot

- **Source files:** every completed run of the demo scenarios (Air Spectral
  Easy for the run, VT Aether Intermediate S5 for progression), each CSV with
  its `.perf`, in `test/fixtures/demo/{stats,performances}/`, committed through
  Git LFS. `pnpm gen:demo-fixtures` writes the set from the raw dump; the
  refresh procedure is in `docs/preview-assets.md`.
- **Generation is a vitest file snapshot.** `src/lib/demo/snapshot.test.ts`
  makes a test PGlite (`makeTestDb`), runs the real ingest (`buildChunk` →
  `applyChunk`) over the demo files, fills a `DemoSnapshot` by calling the real
  query functions, and asserts
  `expect(json).toMatchFileSnapshot('../../data/demo-snapshot.json')`.
  Running inside vitest is required: migrations use `import.meta.glob` and
  ingest imports `?raw` SQL, both Vite-only.
- **Committed, drift-checked.** `src/data/demo-snapshot.json` is committed
  (not LFS, so the deploy checkout needs no LFS), marked
  `linguist-generated -diff` in `.gitattributes`. `pnpm gen:demo` is
  `vitest run -u src/lib/demo/snapshot.test.ts`. Any change to ingest,
  migrations, queries or the demo files that alters the data fails `pnpm test`
  in CI until the snapshot is regenerated and committed. A fresh clone
  typechecks, tests and builds with no generation step.
- **Loud failure.** The test asserts the files are real (not LFS pointer
  files) and that every fixture became a completed, charted run, before
  comparing.
- **Loading:** the demo view imports the JSON dynamically, so it is its own
  chunk and loads only on About. The JSON is written compactly (no
  indentation) with numbers as the queries return them. Expect roughly
  1–2 MB raw, a few hundred KB gzipped; if it lands far above 500 KB gzipped,
  that is a finding to raise, not a reason to trim silently.

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
4. **Beat 3 — "Watch the curve bend."** The Overall progression chart for VT
   Aether Intermediate S5 across all its runs, by attempt: dots, PB step line,
   rolling median, rank bands, session breaks. A different scenario from beats
   1–2, chosen for its steady three-month climb; by attempt because its runs
   cluster into stretches months apart, which a date axis would leave as gaps.
5. **Closing CTA.** Repeat **Import your stats**, the privacy line (see
   *Privacy copy* below), and a short "what you need": KovaaK's with stats
   output on (the default).

**Privacy copy.** One line, used verbatim wherever the product states it:
*"Fully local: your stats stay in this browser. No server, no account, no
tracking."* It replaces "Nothing is uploaded", which reads wrong next to an
import button that feels like uploading. The About closing CTA,
`EmptyState.vue:26` and `ImportControls.vue:54` all use it; the last two are
existing copy updated in this work.

Each beat carries a small "Sample data: Air Spectral Easy" label so no one
mistakes it for their own runs. The pinned run is a named constant
(`DEMO_RUN_STEM`) chosen during implementation by inspecting the data for the
clearest early-lead/late-loss shape.

Loading: the page shell and copy render immediately; charts show a
chart-shaped placeholder until **both** the snapshot chunk and the benchmark
data have arrived, so rank bands never pop in after the chart. A failed load
shows a one-line error with a retry, and the CTAs still work.

Database: About never reads it, but the app shell still starts and migrates it
in the background, including `preload.ts`'s early prefetch, so it is ready by
the time the visitor clicks Import. The snapshot is ~31 KB gzipped, too small
for the wasm download to delay it meaningfully.

Narrow screens: beats stack; charts take full width; the bot table scrolls
horizontally, per the existing responsive rules.

App bar: an **About** link at the right, beside the import control, styled as
a quiet text link rather than a primary tab. `document.title` is
`About — aimcurve`, set by a new `about` branch in `App.vue`'s `afterEach`
(which otherwise falls through to "Run — aimcurve").

### D6. First-visit redirect

A `router.beforeEach` guard registered at module scope beside `App.vue`'s
`afterEach`, acting only on the **initial** navigation
(`from === START_LOCATION`):

- If the target is the root run route with no query, and the visitor has not
  been marked as having seen About, redirect to `#/about`.
- "Seen About" is true when `localStorage['aimcurve.seen-about']` is set, **or**
  any other `aimcurve.*` key exists (a returning user from before this
  shipped).
- Rendering `AboutView` sets `aimcurve.seen-about`, however the visitor got
  there.
- Deep links (`#/scenario/…`, `#/?run=…`, `#/data`) are never redirected.
- All storage access is wrapped in try/catch; if storage throws, no redirect.
- Unknown paths hit the catch-all redirect to `run` first, so a first-time
  visitor on `#/garbage` also lands on About. That is intended.
- No interaction with `useSelection`'s remembered Run route: it records only
  visits to the `run` route, and a redirected visit never reaches it.

The guard is synchronous and runs before any database access, so a first-time
visitor sees About with no wait. The pure decision lives in
`shouldShowAbout(target, keys)` in `src/lib/about.ts` (no Vue, no storage), so
tests can cover it.

### D7. Link-preview card

In `index.html`:

- `<title>aimcurve — KovaaK's run analysis</title>`
- `<meta name="description">` — draft: *"Free KovaaK's run analysis in your
  browser: see where each run gained or lost pace, which bots cost you, and how
  you're improving. Fully local, no account."*
- `og:type` `website`, `og:site_name`, `og:title`, `og:description`,
  `og:url`, `og:image` (+ `og:image:width` 1200, `og:image:height` 630,
  `og:image:alt`).
- `twitter:card` `summary_large_image` (X reads the `og:` tags for the rest).
- `theme-color` — the app's accent, used by Discord for the embed stripe.
- `<link rel="canonical">`.

Absolute URLs use Vite's built-in `%VITE_SITE_URL%` HTML replacement. A
committed `.env` cannot hold the default (`.env` is gitignored), so
`vite.config.ts` sets
`process.env.VITE_SITE_URL ??= 'https://voidfill.github.io/aimcurve/'` before
config resolution. The value always ends in `/`, and tags join paths without a
leading slash: `%VITE_SITE_URL%og.png`. A custom domain later means setting
`VITE_SITE_URL` in the deploy workflow.

**`public/og.png`** — 1200×630, committed. Composition: the Beat 1 pace chart
cropped to its most dramatic stretch (rank bands, both accumulated lines, the
gap fill) on the app background, with the wordmark and the pitch line. Made by
screenshotting a **dev-only** route (`#/dev/card`, registered only when
`import.meta.env.DEV`) that renders just that composition at 1200×630, then
committing the PNG. A dev-only route rather than a query on `#/about`, so
making the card never sets `aimcurve.seen-about` or ships to users.
Regenerated by hand when the chart look changes materially. Under 300 KB.

### D8. README

Rewritten product-first:

1. Wordmark/one-liner and a hero image (`og.png` or the Beat 1 screenshot).
2. **Open aimcurve →** link to the live site.
3. What it shows: three short items mirroring the beats, each with a
   screenshot from About, in `docs/images/`.
4. How to use: open the site, import your KovaaK's `stats` folder, and
   import again after a session to add new runs. (Live folder connection is
   switched off behind `LIVE_FOLDER_ENABLED`; neither the README nor About
   promises live updates while it is.)
5. Privacy: fully local. Files are read and stored in your browser; there is
   no backend, no account and no analytics, so data also does not sync
   across devices.
6. **Development** — the current README content, unchanged except for the
   new `gen-demo` script in the scripts table and the demo fixtures in the
   layout section.

## Testing

- **Snapshot and drift:** `src/lib/demo/snapshot.test.ts` (D4) regenerates the
  snapshot and matches the committed file; it also asserts real files, that
  every fixture is a charted run, and that `DEMO_RUN_STEM` exists and has a
  curve.
- **Source parity:** in the same suite, `snapshotSource(snapshot).m(args)`
  deep-equals `pgSource(pg).m(args)` for each of the eight methods, including
  the rebuilt `Map`s, over all ids, a subset, and an unknown id or key.
- **Analysis parity:** `useRunAnalysis` driven by each source for
  `DEMO_RUN_STEM` yields the same `current`, baseline and `recent` curves.
- **Redirect:** unit tests for `shouldShowAbout` — fresh visitor, flag set,
  legacy key present, deep link, query present, storage throwing.
- **Extraction:** existing `RunDetail`/`ProgressPanel`-adjacent tests stay
  green; `useRunCharts` gets a test that its output for the demo run matches
  what `chartData` etc. produce directly.
- **About isolation:** mounting `AboutView` under a provider whose pg source
  throws on every call renders the charts without calling it (D2), and writes
  no `localStorage` key but `aimcurve.seen-about` (D3).
- **Import graph:** a build assertion that the modules bundled into About's
  own lazy chunks (excluding the shared entry, which legitimately holds
  `useDb`) include neither `src/db/client.ts` nor `@electric-sql/pglite`.
- **Manual:** About renders with no network wait for the database (check with
  OPFS empty and throttled CPU); Discord and X card validators show the image
  and text for the deployed URL.

## Delivery order

1. `DataSource`, `pgSource`, `useSource`; migrate `useRunAnalysis` and
   `useScenario`; move settings out of `useRunAnalysis` and the picks store
   into a `useBenchmarkRank` parameter. App unchanged in behaviour.
2. Extract `useRunCharts` and `useProgressChart`.
3. Demo fixtures, snapshot test and committed JSON, `snapshotSource`, parity
   tests, `gen:demo` script.
4. `AboutView`, route, app-bar link, first-visit redirect.
5. `index.html` meta, `SITE_URL` plugin, `og.png`.
6. README and screenshots.
