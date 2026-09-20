# Browser import and Run shell implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with one implementation subagent per task and one final combined code/spec review. The user's requested workflow overrides per-task TDD and review gates: no new automated test suite, one final combined code/spec review, and human browser integration testing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import local Kovaak's files in the browser, retain them across reloads, represent connection state truthfully, and inspect/select completed attempts in a minimal Run page.

**Architecture:** Keep the existing PGlite database worker, ingest worker, source adapters, handle store, migrations, and deduplication untouched. Replace Astro with a standalone Vue 3 single-page application: one app instance mounts for the document lifetime and `vue-router` swaps views inside it. Shared browser state (database handle, import controller, connection status, remembered Run selection) lives in module-singleton composables, which outlive every route change because no page swap ever happens.

**Tech Stack:** Vue 3.5 SFC with `<script setup lang="ts">`, Vite, `vue-router` 4 in hash mode, `@vueuse/core`, TypeScript, PGlite, IndexedDB, native browser APIs, scoped CSS. Astro, `@astrojs/check`, and `<ClientRouter />` are removed.

**Spec:** [Product and page design](../specs/2026-09-20-product-and-page-design.md), first delivery slice only. The spec is stack-agnostic and needs no revision for this change. The user's approval applies to this slice despite the broader document's draft status.

## Global Constraints

- Node `>=22.12.0`; pnpm pinned by `package.json` (`pnpm@10.34.5`).
- Data is processed and stored in the current browser. No upload, device sync, backend, installation, or public sharing.
- No server and no server-side rendering. `vite build` emits static files only.
- Routing is **hash mode** (`createWebHashHistory`). No host rewrite rules, no `404.html` fallback, no per-route HTML generation.
- Reuse current infrastructure. Historical application code must not be inspected or ported.
- Defer charts, bot breakdown, comparisons/PB deltas, score conversions and their interfaces, rank mapping, benchmark definitions, Sessions, Scenarios, and general display/analysis settings. No dead navigation links or fake chart data.
- Do not infer race semantics from scenario names. Display recorded score and elapsed duration with neutral labels; race-specific result priority belongs with the later adapters.
- Resets and unattributed aborts remain ingested. This first rail is explicitly labeled completed attempts; reset inspection is deferred.
- Missing performance detail is compatible with a valid completed attempt. Null values are absent/unavailable, never fabricated zeroes.
- No database schema migration is needed. Do not edit old migrations, which can reset imported data.
- Retain existing tests. Add no new test suite, no automated browser suite, and no new benchmarks. Verification is `pnpm check`, `pnpm build`, `pnpm test`, and the human checklist in Task 5.

---

## Why this plan changed

The previous revision of this plan targeted Astro with `<ClientRouter />`. Roughly a third of its UI complexity existed only to keep a database worker, an ingest worker, and a folder watcher alive across Astro's document swaps: a module-cached `getAppRuntime()`, `astro:page-load`/`astro:before-swap` mount and unmount handlers, per-view idempotent cleanup contracts, generation tokens guarding stale mounts, `data-astro-reload` on attempt anchors so ClientRouter would stop intercepting clicks the Run controller already handled, and reasoning about `transition:persist`.

None of that is needed in a single-page Vue application, because there are no page swaps. Astro's compensating benefits — static rendering, partial hydration, zero-JS pages, SEO — are unusable here: every page's content is read from a local PGlite database at runtime, and the spec states there is no public sharing and that onboarding is an in-app empty state rather than a marketing site. Hash-mode routing removes the only remaining static-hosting concern.

The migration cost is near zero today: `src/pages/index.astro` is a bare heading, and the two Vite settings in `astro.config.mjs` port directly.

**Everything in this plan that concerns data correctness is unchanged from the previous revision** — serialized ingest passes, the source generation counter, user-activation preservation, permission handling, observer fallback, dedupe, cursor semantics, and truthful report labels. Only the UI delivery mechanism changed.

## Inspection findings and reuse

| Existing interface | Use and implications |
| --- | --- |
| `src/db/client.ts`: `getDb()`, `getLastMigration()` | Cached browser initialization and migration result. Add a typed accessor to the same underlying PGlite worker; do not create a second database connection just for ingest. |
| `src/db/worker.ts` | Existing `idb://aimcurve` persistence and live extension. Keep its storage identity and worker configuration. |
| `ingest(source, pg, { build, onProgress })` in `src/lib/ingest/index.ts` | Main-thread coordinator, stem-based dedupe, chunk commits, failed-file reporting, late perf retry. Call it rather than rebuilding parsing or SQL. Progress counts work files, not all scanned files. |
| `workerBuilder(worker)` in `src/lib/ingest/worker.ts` | Browser parsing/chunk construction with transferred buffers. Reuse one worker per controller lifetime. |
| `handleSource(root)` / `bulkSource(files)` | Recursive connected folder versus immutable snapshot; only the former watches. Existing debounce is 250 ms; polling fallback is 10 seconds. |
| `source-handle.ts` observer startup | `observe()` currently runs without rejection handling. Catch synchronous construction and asynchronous observation failures and start the existing polling strategy instead. |
| `handle-store.ts` | Save/load/clear the folder handle; query permission on load, request permission only from a click. No silent permission prompt. |
| `IngestReport` | `runs` includes resets, `aborts` are unattributed files, `skipped` combines known stems and unsupported suffixes. Do not label these counts as completed runs, duplicate-only counts, or invalid runs. |
| `run_complete`, `scenario`, `config` | Completed summaries and scenario-version identity. `run_complete.has_perf` is the detail-availability flag. No need to fetch series arrays for this slice. |
| `run.file_stem` / `run.id` | Stem is persistent source identity; numeric IDs can be reused after a migration reset. Use stem in local links, ID internally. |
| `run_ingested` notification | Fires on inserted run rows, not perf attachment. Refresh after an ingest pass as well so late detail attachment updates the selected summary. |
| `run_progress` | Assumes score maxima for PB. Do not consume it for generic improvement labels while scoring direction/conversions are deferred. |
| `applyChunk()` | Uses shared staging tables and explicit transactions. Serialize ingest passes; source switches must not launch a second pass while the old one is finishing. |
| `src/lib/ingest/worker.test.ts` | Uses a hand-rolled `FailingWorker` stub, not a real `Worker`. The suite therefore has no dependency on Vite worker configuration and should survive the toolchain swap unchanged. |

Vue guides worth consulting: [SFC `<script setup>`](https://vuejs.org/api/sfc-script-setup.html), [reactivity API](https://vuejs.org/api/reactivity-core.html) (specifically `shallowRef` and `markRaw`), [vue-router history modes](https://router.vuejs.org/guide/essentials/history-mode.html), [Vite static asset and worker handling](https://vite.dev/guide/assets.html), and [VueUse](https://vueuse.org/functions.html).

## File structure

### Removed

| File | Reason |
| --- | --- |
| Delete `astro.config.mjs` | Its two Vite settings move to `vite.config.ts`. |
| Delete `src/pages/index.astro` | Replaced by `index.html` + `src/main.ts` + the Run route. |

### Toolchain

| File | Responsibility |
| --- | --- |
| Create `index.html` | Vite entry document: favicons, viewport, title, `#app` mount point, `src/main.ts` module script. |
| Create `vite.config.ts` | Vue plugin, PGlite prebundle exclusion, ES worker format, fixed dev port. |
| Modify `vitest.config.ts` | Drop `astro/config`; use `defineConfig` from `vitest/config` with the same test settings. |
| Modify `tsconfig.json` | Drop `astro/tsconfigs/strict`; explicit strict config for Vue + Vite. |
| Modify `package.json` | Swap dependencies and scripts. |
| Modify `README.md` | Stack description, script table, layout, and toolchain notes. |
| Modify `AGENTS.md` | Dev-server commands and framework documentation links. |

### Application

| File | Responsibility |
| --- | --- |
| Create `src/main.ts` | Create the app, install the router, mount to `#app`. |
| Create `src/router.ts` | Hash-history router with the Run and Data routes. |
| Create `src/App.vue` | Shell: header, `<RouterView />`, global live region. |
| Create `src/components/AppHeader.vue` | Brand, Run link honouring the remembered Run route, persistent data-status link to Data. |
| Create `src/views/RunView.vue` | Run page composition: onboarding/empty states, summary, filter, rail. |
| Create `src/views/DataView.vue` | Data page composition: connection controls, progress, report, Return to Run. |
| Create `src/components/RunSummary.vue` | Selected attempt result and missing-detail labelling. |
| Create `src/components/ScenarioFilter.vue` | Scenario-version select bound to the `scenario` query parameter. |
| Create `src/components/AttemptRail.vue` | Scrolling completed-attempt list, Load older, new-attempt indicator, Resume latest. |
| Create `src/components/AttemptRow.vue` | One rail entry as a `RouterLink` with `aria-current`. |
| Create `src/components/ConnectionStatus.vue` | Connection state, migration-reset notice, database-failure retry. |
| Create `src/components/ImportControls.vue` | Connect, Reconnect, Disconnect, snapshot inputs, Retry scan, Reimport. |
| Create `src/components/ImportReport.vue` | Truthful counts, named failures, and the separate perf-detail section. |

### Framework-free logic

Kept outside Vue so it stays testable without a component harness.

| File | Responsibility |
| --- | --- |
| Modify `src/db/client.ts` | Export the shared migrated PGlite interface alongside the existing Drizzle accessor. |
| Create `src/lib/run/queries.ts` | Typed completed-attempt list, exact lookup, latest attempt, and scenario options. |
| Modify `src/lib/ingest/source-handle.ts` | Observer startup failure fallback and complete unsubscribe cleanup. |
| Create `src/lib/run/import-controller.ts` | Connection lifecycle, serialized ingest, progress/report state, metadata persistence, cleanup. Imports no Vue. |

### Composables

| File | Responsibility |
| --- | --- |
| Create `src/composables/useDb.ts` | Module-singleton database initialization, migration notice, retry. |
| Create `src/composables/useImport.ts` | Module-singleton import controller, its reactive state mirror, and the data revision counter. |
| Create `src/composables/useAttempts.ts` | Rail paging, selected-attempt fetch, scenario options, generation-guarded refresh. |
| Create `src/composables/useSelection.ts` | Route-backed inspection/follow mode, filter, latest-seen cursor, remembered Run route. |

### Styles

| File | Responsibility |
| --- | --- |
| Create `src/styles/app.css` | Reset, design tokens, typography, focus-visible styles, live-region utility. Imported once by `main.ts`. |

Component-specific layout lives in each SFC's `<style scoped>`. There is no separate `run.css`.

Keep these boundaries. Do not introduce Pinia, a generic store layer, a design system, or a service framework.

---

## Task 1: Replace the Astro toolchain with Vue + Vite

**Files:**
- Create: `index.html`, `vite.config.ts`, `src/main.ts`, `src/router.ts`, `src/App.vue`, `src/styles/app.css`
- Create (placeholders, filled in Task 4): `src/views/RunView.vue`, `src/views/DataView.vue`, `src/components/AppHeader.vue`
- Modify: `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`, `AGENTS.md`
- Delete: `astro.config.mjs`, `src/pages/index.astro`

**Interfaces:**
- Consumes: nothing.
- Produces: a mounted Vue application at `#app` with hash routes `#/` (`RunView`) and `#/data` (`DataView`); `pnpm dev`, `pnpm build`, `pnpm check`, and `pnpm test` all succeed.

- [ ] **Step 1: Swap dependencies**

```sh
pnpm remove astro @astrojs/check
pnpm add vue vue-router @vueuse/core
pnpm add -D vite @vitejs/plugin-vue vue-tsc
```

- [ ] **Step 2: Rewrite the `scripts` block in `package.json`**

```json
{
  "dev": "vite",
  "build": "vue-tsc --noEmit && vite build",
  "preview": "vite preview",
  "check": "vue-tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "bench": "vitest bench --reporter=verbose",
  "gen:proto": "buf generate"
}
```

Remove the now-meaningless `"astro": "astro"` script. Leave `allowScripts`, `engines`, and `packageManager` alone.

- [ ] **Step 3: Create `vite.config.ts`**

Both Vite settings are carried over from `astro.config.mjs` and are load-bearing. `strictPort` matters more than it looks: the human persistence checks in Task 5 read IndexedDB, which is keyed by origin, so a dev server that silently moves to another port makes previously imported data look lost.

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
	plugins: [vue()],
	server: {
		// IndexedDB is origin-scoped. A silently reassigned port looks
		// identical to lost data during persistence testing.
		port: 4321,
		strictPort: true,
	},
	// PGlite ships wasm + a worker; pre-bundling it breaks both.
	optimizeDeps: { exclude: ['@electric-sql/pglite'] },
	worker: { format: 'es' },
});
```

- [ ] **Step 4: Delete `astro.config.mjs` and `src/pages/index.astro`**

```sh
git rm astro.config.mjs src/pages/index.astro
```

- [ ] **Step 5: Create `index.html` at the repository root**

Vite resolves its entry from the project root, not from `src/`. The favicon links keep the existing `public/` assets working.

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
		<link rel="icon" href="/favicon.ico" />
		<meta name="viewport" content="width=device-width" />
		<title>aimcurve</title>
	</head>
	<body>
		<div id="app"></div>
		<script type="module" src="/src/main.ts"></script>
	</body>
</html>
```

- [ ] **Step 6: Rewrite `tsconfig.json`**

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"lib": ["ES2023", "DOM", "DOM.Iterable"],
		"module": "ESNext",
		"moduleResolution": "bundler",
		"types": ["vite/client"],
		"jsx": "preserve",
		"strict": true,
		"noUncheckedIndexedAccess": true,
		"noUnusedLocals": true,
		"noUnusedParameters": true,
		"noEmit": true,
		"isolatedModules": true,
		"verbatimModuleSyntax": true,
		"skipLibCheck": true,
		"resolveJsonModule": true
	},
	"include": ["src/**/*.ts", "src/**/*.vue", "test/**/*.ts", "*.config.ts"],
	"exclude": ["dist"]
}
```

- [ ] **Step 7: Rewrite `vitest.config.ts` without Astro**

The Vue plugin is not needed: no test imports an SFC, and `environment: 'node'` stays. Keep the existing comments — the reasons they record are still true.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		// Tests sit next to their source; `test/` holds shared helpers and fixtures.
		include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
		// A cold PGlite WASM boot does not fit in the 5 s default, and several
		// suites now boot one, so the default flakes under parallel load. The
		// same boot inside a beforeAll/beforeEach hook does not fit vitest's
		// 10 s hookTimeout default either.
		testTimeout: 30000,
		hookTimeout: 30000,
	},
});
```

- [ ] **Step 8: Run the existing suite before writing any application code**

Run: `pnpm test`
Expected: the same passes as before the swap. This is the single riskiest point of the migration — `vitest.config.ts` was the only test-side Astro coupling. If a suite fails here, fix the configuration rather than the tests, and do not proceed to Step 9 until it is green.

- [ ] **Step 9: Create `src/styles/app.css`**

Global only: a reset, colour/spacing tokens as custom properties, base typography, a `:focus-visible` outline that is never removed, and a visually-hidden `.sr-only` utility for the live region. No component layout. Respect `@media (prefers-reduced-motion: reduce)` by disabling transitions globally.

- [ ] **Step 10: Create `src/router.ts`**

```ts
import { createRouter, createWebHashHistory } from 'vue-router';
import RunView from './views/RunView.vue';

export const router = createRouter({
	// Hash mode: deep links resolve on any static host with no rewrite
	// rules and no generated per-route HTML.
	history: createWebHashHistory(),
	routes: [
		{ path: '/', name: 'run', component: RunView },
		{ path: '/data', name: 'data', component: () => import('./views/DataView.vue') },
		{ path: '/:pathMatch(.*)*', redirect: { name: 'run' } },
	],
});
```

- [ ] **Step 11: Create placeholder `src/views/RunView.vue` and `src/views/DataView.vue`**

Each is a `<script setup lang="ts">` SFC rendering a single heading. Task 4 fills them.

- [ ] **Step 12: Create `src/App.vue` and a minimal `src/components/AppHeader.vue`**

```vue
<script setup lang="ts">
import AppHeader from './components/AppHeader.vue';
</script>

<template>
	<AppHeader />
	<main>
		<RouterView />
	</main>
</template>
```

`AppHeader.vue` gets the brand, a `RouterLink` to `{ name: 'run' }`, and a `RouterLink` to `{ name: 'data' }`. Task 4 adds the remembered-route behaviour and status.

- [ ] **Step 13: Create `src/main.ts`**

```ts
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './styles/app.css';

createApp(App).use(router).mount('#app');
```

- [ ] **Step 14: Update `README.md`**

Change the summary line from "Static Astro site" to "Static Vue 3 single-page application". In the script table, `pnpm dev` becomes "vite dev server (port 4321, strict)" and `pnpm check` becomes `vue-tsc --noEmit`. In the layout block, replace `src/pages/   astro pages` with the new `src/views/`, `src/components/`, and `src/composables/` entries. In Notes, replace the `astro.config.mjs` reference with `vite.config.ts`, and re-examine the TypeScript 6.x pin: it existed because `@astrojs/check` needed a programmatic API TypeScript 7 does not ship. `@astrojs/check` is gone, but `vue-tsc` has its own supported-TypeScript range, so **verify against the installed `vue-tsc` before changing the pin** rather than assuming it can be lifted. If the pin stays, rewrite the note to give `vue-tsc` as the reason.

- [ ] **Step 15: Update `AGENTS.md`**

Replace the Astro dev-server section. Vite has no `--background` flag, so background operation is the harness's job:

```
## Development

Run the dev server in background mode; it binds port 4321 with `strictPort`,
so the origin stays constant and IndexedDB data survives restarts.

    pnpm dev
```

Replace the six Astro documentation links with: [Vue SFC syntax](https://vuejs.org/api/sfc-script-setup.html), [Vue reactivity](https://vuejs.org/api/reactivity-core.html), [vue-router essentials](https://router.vuejs.org/guide/essentials/navigation.html), [Vite configuration](https://vite.dev/config/), and [VueUse](https://vueuse.org/functions.html).

- [ ] **Step 16: Verify the toolchain end to end**

Run: `pnpm check` — Expected: PASS, no errors.
Run: `pnpm build` — Expected: PASS, emits `dist/index.html` and hashed assets.
Run: `pnpm test` — Expected: the same passes as Step 8.
Run: `pnpm dev`, open `http://localhost:4321/`, and confirm the shell renders, `#/data` reaches the Data placeholder, and browser Back returns to Run.

- [ ] **Step 17: Commit**

```sh
git add -A
git commit -m "build: replace Astro with a Vue 3 + Vite single-page app

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Deliverable:** a routed, mounted Vue shell with the full toolchain green and the existing test suite unaffected.

---

## Task 2: Expose the database and completed-attempt queries

Unchanged from the previous revision. This task contains no Vue code.

**Files:**
- Modify: `src/db/client.ts`
- Create: `src/lib/run/queries.ts`

**Interfaces:**
- Consumes: `getDb()`, `getLastMigration()`, `applyMigrations`, `migrations`.
- Produces: `getPg(): Promise<PGliteInterface>`; the `Attempt`, `AttemptCursor`, `ScenarioOption`, and `AttemptPage` types; `listAttempts`, `getAttempt`, `getLatestAttempt`, `listScenarios`.

- [ ] **Step 1: Refactor cached initialization in `src/db/client.ts`**

Retain both the worker interface and the Drizzle wrapper from one shared initialization promise. Preserve `getDb(): Promise<Db>` and `getLastMigration()` exactly as they behave today; add `getPg(): Promise<PGliteInterface>`. Both accessors await the same promise, and initialization failure clears it for retry — keep the existing comment explaining why. Close a partially initialized worker on failure where the actual installed interface supports it.

- [ ] **Step 2: Define the query DTOs in `src/lib/run/queries.ts`**

```ts
export interface Attempt {
	id: number;
	fileStem: string;
	scenarioId: number;
	scenarioName: string;
	scenarioHash: string;
	writtenAt: string; // ISO timestamp, normalize at query boundary
	startedAt: string;
	score: number | null;
	durationS: number;
	accuracy: number | null;
	hits: number;
	shots: number;
	hasPerf: boolean;
	sensScale: string;
	horizSens: number;
	vertSens: number;
}
export interface AttemptCursor { writtenAt: string; id: number }
export interface ScenarioOption { id: number; name: string; hash: string }
export interface AttemptPage { items: Attempt[]; next: AttemptCursor | null }
// All functions receive the shared PGliteInterface as their first argument.
// listAttempts(pg, scenarioId: number | null, before: AttemptCursor | null): Promise<AttemptPage>
// getAttempt(pg, fileStem: string): Promise<Attempt | null>
// getLatestAttempt(pg, scenarioId: number | null): Promise<Attempt | null>
// listScenarios(pg): Promise<ScenarioOption[]>
```

- [ ] **Step 3: Write the queries**

Select explicit columns from `run_complete r join config c on c.id = r.config_id`, aliasing into the DTO. Query scenario options from scenarios that have completed runs. Include a short hash in option labels so identical names stay distinct; never merge their IDs.

- [ ] **Step 4: Parameterize and paginate**

Use parameters for filters, cursor values, and stems. Sort rail and latest by `written_at DESC, id DESC`; fetch 51 rows, render 50, and derive the next cursor from the last rendered row only if an extra row exists. The cursor predicate is `(r.written_at, r.id) < ($timestamp::timestamptz, $id::integer)`. Exact stem lookup is independent of filters and rail pagination.

- [ ] **Step 5: Respect the scope boundary**

Do not join `run_progress`, series, or bot tables. Do not add Drizzle schema models solely to duplicate the existing SQL views.

- [ ] **Step 6: Verify and commit**

Run: `pnpm check` — Expected: PASS.
Run: `pnpm test` — Expected: existing suites still pass.

```sh
git add src/db/client.ts src/lib/run/queries.ts
git commit -m "feat: expose the shared PGlite handle and attempt queries

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Deliverable:** a single persistent database connection and bounded summary queries usable by the views.

---

## Task 3: Import lifecycle, truthful connection state, and its composables

The controller's behaviour is unchanged from the previous revision. What changed: it no longer publishes state through an `onState` subscription API consumed by a hand-rolled runtime; a thin composable mirrors its state into a `reactive` object instead.

**Files:**
- Create: `src/lib/run/import-controller.ts`
- Create: `src/composables/useDb.ts`, `src/composables/useImport.ts`
- Modify: `src/lib/ingest/source-handle.ts`

**Interfaces:**
- Consumes: `getPg()` from Task 2; `ingest`, `workerBuilder`, `handleSource`, `bulkSource`, `handle-store`, `IngestReport`, `getLastMigration()`.
- Produces: `useDb()` returning `{ pg, ready, error, migration, retry }`; `useImport()` returning `{ state, revision, connect, reconnect, importFiles, disconnect, retryScan }`, where `state` is a `reactive<ImportState>` and `revision` is a `Ref<number>`.

- [ ] **Step 1: Define the controller state and actions in `import-controller.ts`**

This module imports nothing from Vue.

```ts
type Connection = 'none' | 'connected' | 'reconnect' | 'snapshot' | 'error';
interface ImportState {
	connection: Connection;
	busy: boolean;
	progress: { done: number; total: number } | null;
	report: IngestReport | null;
	lastImportAt: string | null;
	message: string | null;
}
// createImportController(pg, onState, onCommitted):
// { restore(): Promise<void>, connect(): Promise<void>, reconnect(): Promise<void>,
//   importFiles(files: FileList | File[]): Promise<void>,
//   disconnect(): Promise<void>, retryScan(): Promise<void>, dispose(): void }
// onState receives ImportState; the composable copies it into its reactive mirror.
// onCommitted returns Promise<void> and increments the data revision after each
// settled pass, including a partly committed failed pass.
```

- [ ] **Step 2: Wire the ingest worker and serialize passes**

Create the existing ingest worker with `new Worker(new URL('../ingest/worker.ts', import.meta.url), { type: 'module' })` and pass `workerBuilder(worker)` to `ingest`. Serialize all passes with one in-flight promise plus one dirty/rescan flag. Coalesce watcher bursts into at most one trailing pass, and release the busy state in `finally`.

- [ ] **Step 3: Handle source replacement and disconnect**

Use a source generation counter. Stop the previous watcher immediately, let its in-flight pass finish, then activate the replacement. Ignore stale UI callbacks but still reload committed database data. Never terminate the worker while a live ingest promise depends on it, and never on a route change — the worker lives for the document lifetime. Disable repeat picker actions while a switch is pending.

- [ ] **Step 4: Preserve user activation on picker actions**

On Connect, invoke the directory picker **before awaiting anything else**; a Vue `@click` handler does not change this requirement, and an `await` before `showDirectoryPicker()` loses the activation. On Reconnect, call `requestReadPermission` directly against the already-loaded handle. Picker cancellation leaves the prior state intact. Unsupported or blocked pickers and denied permission expose snapshot import and retry/reselect actions.

- [ ] **Step 5: Implement restore and permission loss**

On restore, load the handle and query permission. Granted permission may resume scanning and watching; otherwise show Reconnect **without** requesting permission. On read permission loss, stop automatic scans, preserve imported rows, and show Reconnect. Because ingest reports individual read failures rather than throwing, recheck permission after failed folder passes before classifying the connection.

- [ ] **Step 6: Make the watcher survive a failing observer (`source-handle.ts`)**

Catch both constructor and `observe()` rejection failures and start the existing interval fallback. Keep a disposed flag so a late `observe()` rejection cannot resurrect a stopped watcher. Disconnect the observer and clear debounce and interval on unsubscribe. Register watching before the initial scan so changes during that scan schedule a trailing pass. Label the connection as checking for newly completed attempts while the page is open; do not promise active-run telemetry or a fixed background-tab latency. `useDebounceFn` and `useIntervalFn` from `@vueuse/core` may replace the hand-rolled timers **only if** this module stays free of component lifecycle assumptions; otherwise keep the existing timers.

- [ ] **Step 7: Implement snapshot input**

Support folder selection (`webkitdirectory`) and ordinary multiple-file selection (`accept=".csv,.perf"`). Feed both to `bulkSource`; reset the input value after copying the `FileList` so the same selection can be reimported. A successful explicit snapshot switch stops folder watching and clears the saved handle; a reload must not unexpectedly reactivate that connection.

- [ ] **Step 8: Persist only the metadata that survives reload**

Store last import time and source mode in a versioned `localStorage` record via `useStorage` from `@vueuse/core`, with a schema version field and a guarded parse that discards unrecognized versions. Keep report details in memory and label them as the current session's latest pass. Failure to save the folder handle or metadata is a recoverable warning, not a failed committed import. A snapshot reload retains its time and Reimport control but cannot reuse the old `FileList`.

- [ ] **Step 9: Write `src/composables/useDb.ts`**

Module-singleton. Calls `getPg()` once, exposes `pg` as a `shallowRef` holding a `markRaw`-wrapped handle, plus `ready`, `error`, the `getLastMigration()` result, and a `retry()` that clears the failure. **Never pass the PGlite handle to `reactive()`** — Vue's deep proxy wraps its methods and breaks the driver.

- [ ] **Step 10: Write `src/composables/useImport.ts`**

Module-singleton. Creates exactly one controller once `useDb()` is ready, calls `restore()` once per document lifetime, mirrors `onState` into a `reactive<ImportState>`, and increments a `revision` ref from `onCommitted`. Hold the `Worker` and any `FileSystemDirectoryHandle` in `shallowRef` with `markRaw`, for the same reason as Step 9. Guard the singleton against hot-module replacement, which would otherwise re-run the module and create a second worker and watcher alongside the first — a fault that presents exactly like a duplicate-import bug:

```ts
if (import.meta.hot) {
	// Re-running this module would create a second DB worker, ingest worker,
	// and watcher beside the live ones. Escalate to a full reload instead.
	import.meta.hot.accept(() => import.meta.hot!.invalidate());
}
```

- [ ] **Step 11: Verify and commit**

Run: `pnpm check` — Expected: PASS.
Run: `pnpm test` — Expected: existing ingest suites still pass. If the `source-handle.ts` change breaks an existing test, that test is the regression signal; fix the source.

```sh
git add src/lib/run/import-controller.ts src/composables/useDb.ts src/composables/useImport.ts src/lib/ingest/source-handle.ts
git commit -m "feat: browser import lifecycle with truthful connection state

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Deliverable:** browser import uses the existing ingest pipeline, preserves committed data on recoverable failures, and cannot overlap its own staging writes.

---

## Task 4: Views, routing, and Run selection behaviour

**Files:**
- Create: `src/composables/useSelection.ts`, `src/composables/useAttempts.ts`
- Create: `src/components/RunSummary.vue`, `ScenarioFilter.vue`, `AttemptRail.vue`, `AttemptRow.vue`, `ConnectionStatus.vue`, `ImportControls.vue`, `ImportReport.vue`
- Modify: `src/views/RunView.vue`, `src/views/DataView.vue`, `src/components/AppHeader.vue`, `src/App.vue`

**Interfaces:**
- Consumes: `useDb()`, `useImport()` from Task 3; the query functions and DTOs from Task 2; `router` from Task 1.
- Produces: the complete first slice.

- [ ] **Step 1: Write `src/composables/useSelection.ts`**

Back inspection and filtering with the route query, not with manual `popstate` listeners. `useRoute()` is reactive, so Back and Forward are handled by vue-router with no listener of your own and no duplicate-registration hazard.

Hash-mode URLs are `#/?run=<fileStem>&scenario=<hash>`. Absent `run` means Follow latest; a present `run` means inspection. The `scenario` parameter carries a scenario **content hash**, resolved to the current scenario ID after initialization — this is unrelated to hash-mode routing despite the shared word.

Expose: `mode` (`'follow' | 'inspect'`), `fileStem`, `scenarioHash`, a `latestSeen` cursor ref, `selectAttempt(stem)` (router `push`, which pauses following even when the target is currently newest), `resumeLatest()` (router `replace` removing `run`, clearing the new-attempt indicator), and `setFilter(hash)`.

Also hold `rememberedRunRoute`: the last Run route location, so the header Run link and the Data page's Return to Run link restore inspection, filter, and follow mode. A directly opened Run URL always takes precedence over memory; a newly opened document at `#/` follows latest.

- [ ] **Step 2: Write `src/composables/useAttempts.ts`**

Owns the rail page, the selected attempt, scenario options, and `hasNewer`. Re-runs when the filter, the selection, or `useImport().revision` changes.

Vue's reactivity does not order async results, so keep a per-concern request generation counter: increment on dispatch, and discard a resolved result whose generation is stale. Fetch the exact linked attempt independently of the rail so a deep link resolves even when its row is outside the loaded page. Provide `loadOlder()` using the `AttemptCursor` from Task 2.

`hasNewer` is true when the latest eligible `(written_at, id)` advances past `latestSeen` while in inspection mode. Backfilled older imports and perf-only updates do not count as newer attempts. Never derive this from report counts or from the maximum database ID.

After an import commits, refresh the first rail page and the selected detail; refresh already-loaded older rows in place rather than appending duplicates. A newer eligible attempt advances the selection only in following mode. After a partial import failure, reload the available committed summaries. After perf-only attachment, update `hasPerf` without moving the selection.

- [ ] **Step 3: Build `AttemptRow.vue` and `AttemptRail.vue`**

`AttemptRow.vue` renders a `RouterLink` to `{ path: '/', query: { run: fileStem, ...filter } }` with `aria-current="true"` when selected. Because this is a real link, modified clicks and open-in-new-tab keep working; vue-router already excludes them.

`AttemptRail.vue` renders the list with **`:key="attempt.fileStem"`** — keying by index makes a refresh destroy and recreate rows, losing keyboard focus mid-list. It also renders Load older, the "Newer attempt available" notice with Resume latest, and an explicit empty state.

- [ ] **Step 4: Build `RunSummary.vue` and `ScenarioFilter.vue`**

`RunSummary.vue` shows scenario, timestamp, recorded score, elapsed duration, accuracy, hits, shots, and sensitivity when available, with a separate label when performance detail is missing. Use neutral labels; do not infer race semantics. Omit graph and bot placeholders and PB/delta cells. Never render a null as `0`.

`ScenarioFilter.vue` is a labelled `<select>` bound to the `scenario` query parameter, including a short hash so identical names stay distinct.

Interpolation escapes by default, so file names, scenario names, and error text need no manual handling. **Do not use `v-html` anywhere in this slice.**

- [ ] **Step 5: Compose `RunView.vue`**

Result column plus an independently scrolling rail of roughly 320 px. Below 800 px — detected with `useMediaQuery` — the rail follows the result as an ordinary section.

In inspection mode, a filter change updates the rail without discarding the selected attempt; if the selection falls outside the filter or the loaded page, say so alongside the detail. In following mode, a filter change selects that filter's latest completed attempt or shows an empty-filter state.

Unknown filters and missing runs get explicit recovery controls. Never silently substitute another run for a failed exact link.

Include the onboarding empty state with a link to Data explaining local processing and no device sync.

- [ ] **Step 6: Build the Data components and compose `DataView.vue`**

`ConnectionStatus.vue` shows connection state, surfaces `getLastMigration().reset/reason` with reimport and reconnect guidance, and gives a Retry for database startup failure that keeps import disabled — a failed database must never look like an empty successful one.

`ImportControls.vue` holds Connect, Reconnect, Disconnect, both file inputs, Retry scan for connected-folder file failures, and Reimport for snapshots. Disconnect removes connection permission metadata and watch activity, not run rows. Add no data-deletion control.

`ImportReport.vue` renders added attempts (including resets), unattributed files, matched detail files, skipped known and unsupported files, and named failures, with orphan, ambiguous, and hash-mismatch perf information in a separate detail section. Missing perf is not an invalid CSV. Do not erase an actionable report on every unchanged background poll; update it when a pass contains new work or actionable issues.

`DataView.vue` composes these plus progress, last import time, and a Return to Run link targeting `rememberedRunRoute`. An import that commits while Data is open updates shared state without rewriting the Data route.

- [ ] **Step 7: Finish `AppHeader.vue` and the live region**

Brand, a Run link targeting `rememberedRunRoute`, a persistent data-status link to Data, and `aria-current` on the active route. Add one restrained `aria-live="polite"` region in `App.vue` for import completion and errors — not for every progress tick. Give each route a meaningful `document.title` via a router `afterEach` hook.

- [ ] **Step 8: Confirm continuity across route changes**

Run: `pnpm dev`. Start an import on Data, navigate to Run and back while it runs.
Expected: the import continues, progress and report are retained, and the browser console shows exactly one ingest worker created. This is the property the whole framework change exists to make free; confirm it rather than assuming it.

- [ ] **Step 9: Verify and commit**

Run: `pnpm check` — Expected: PASS.
Run: `pnpm build` — Expected: PASS.

```sh
git add src/composables src/components src/views src/App.vue
git commit -m "feat: Run and Data views with linkable attempt selection

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Deliverable:** a real imported attempt can be inspected, linked, refreshed, and followed without conflating connection state with selection.

---

## Task 5: Final checks, one review, and human integration testing

- [ ] **Step 1: Run the full verification set once after integration**

Run: `pnpm check`, `pnpm build`, `pnpm test`. Fix failures introduced by this slice. Add no new test suite and no per-task review loop. If an existing ingest behaviour changed, run its relevant existing tests as a regression check; do not expand testing without evidence of a problem.

- [ ] **Step 2: Perform one final combined code and spec review over the completed diff**

Scope it to this slice. Check: shared-connection reuse; serialized writes; user activation preserved before every `await` on picker paths; observer fallback cleanup; persisted state; exact-link identity; stale async results guarded by generation counters; importer continuity across route changes; **no `reactive()` wrapping of the PGlite handle, any `Worker`, or a `FileSystemDirectoryHandle`**; `v-for` keyed by `fileStem`; no `v-html`; the HMR singleton guard present; and scope boundaries. Fix findings without starting another review gate.

- [ ] **Step 3: Hand the slice to a human for the checklist below**

Start the dev server in background mode with `pnpm dev`. It binds port 4321 with `strictPort`, so the origin stays constant across restarts — confirm the actual origin before starting and keep it constant for every persistence check. No agent-claimed browser acceptance in place of human execution.

### Human browser integration checklist

Use an isolated browser profile and origin and a disposable folder containing copies of current `test/fixtures/curated` data (materialized LFS files, not pointer text). Keep original fixture names and contents unchanged. For watching, start with the older `Air Pure Medium` reset CSVs and the completed `18.44.15` CSV/perf pair, then copy the later `VT Aether Novice S5 Hard Bot 1 90%` completed `18.59.40` and `19.04.50` pairs into the selected folder in separate steps. Include an existing pre-3.9.0 CSV for summary-only coverage. Use a separate, intentionally malformed ` Stats.csv` for failure reporting; never edit committed fixtures.

| Check | Human actions | Expected evidence |
| --- | --- | --- |
| Import and inspect | Connect the disposable folder in a browser exposing the picker; inspect a completed result and open the report. | Progress settles; recorded score/time agree with the CSV; resets and abort counts are not presented as completed-result counts; the local-data message is visible. |
| Route continuity | Start a sufficiently large import on Data, navigate to Run and back while it runs. Select an older run and a filter, visit Data, add a newer eligible pair, and return using the header Run link and Back/Forward. Also open `#/data` directly in a fresh tab and reload it. | Import continues across route changes; progress and report are retained; inspection and filter remain intact; the new-attempt indicator appears on return; exactly one worker, importer, and watcher exist and no action fires twice. A directly opened Data route initializes successfully. |
| Persistence | Copy the selected attempt URL; reload, then reopen the same origin and profile. | The exact attempt and its summary survive; the URL remains meaningful; a permission-dependent Reconnect is clearly distinct from lost data. |
| Duplicate handling | Record the completed rail entries and the report; rescan and reselect the same files twice, including once after a reload. | Zero added attempts or perfs for previously imported valid files; no repeated rows and no changed result; the skipped count is truthfully labelled. |
| Late detail | Import a valid completed CSV alone, then its original matching perf file. | The summary is available immediately with a missing-detail message; the detail later attaches to the same attempt with no duplicate and no selection jump. |
| Live and inspection | Follow latest and copy in the next completed pair. Then select an older row and copy the next pair. Resume latest. | The first copy becomes selected automatically; the second updates the rail and indicator while the older selection holds; Resume selects the latest. Reset-only additions never become selected completions. |
| Filter and local links | Filter a scenario version, select by keyboard, copy the URL, and navigate Back and Forward. Open a run outside the first rail page, then try a nonexistent stem. | The filter stays explicit; exact links resolve independently of pagination; a missing link is recoverable; selection and focus are clear. Use a larger real import if pagination needs it. |
| Hash-route deep links | Open `#/?run=<stem>&scenario=<hash>` directly in a new tab. Then run `pnpm build && pnpm preview` and repeat against the built output. | Both resolve without any server configuration; no 404; no blank page. |
| Reload and reconnect | Reload where permission requires a gesture, deny reconnect, then grant or reselect. | No automatic permission prompt; stored data stays visible; reconnect and fallback are actionable; a successful reconnect catches up with no duplicates. |
| Polling fallback | In a browser or context without `FileSystemObserver` but with a folder picker, connect and copy in a later pair. | The new attempt appears via the existing roughly 10-second foreground polling cadence. No duplicate watchers after disconnect and reconnect. |
| Observer startup failure | In a disposable session, use a DevTools snippet before clicking Connect to replace `window.FileSystemObserver` with a constructor whose `observe()` returns `Promise.reject(new Error('verification'))` and whose `disconnect()` is a no-op. Restore by reloading afterwards. | No unhandled rejection; polling still imports a newly copied pair. Disconnect prevents a late failure from restarting scans. No permanent application test hook. |
| Snapshot fallback | Use a browser without the picker, or choose fallback explicitly; import via the folder and multiple-file controls. Add another file on disk, reload, then reimport. | Snapshot status and last import time survive the reload; nothing promises automatic updates; the new file appears only after reimport; existing data stays deduplicated. |
| Cancellation and errors | Cancel the picker, import valid files alongside malformed input, disconnect and reconnect during a large pass, and exercise denied folder access. | Cancellation preserves the prior state; valid data commits despite a named bad-file failure; no overlapping writes and no stuck busy state; retries recover. |
| Responsive and accessible | Keyboard only; move between Run and Data; narrow the viewport below 800 px; enable reduced motion; use empty filters. | Every control is reachable; route and focus changes are meaningful; result and rail stay readable; empty states are explicit; reduced motion is respected; nothing relies on colour alone. |
| Dev-only HMR guard | With `pnpm dev` running and a folder connected, edit `src/composables/useImport.ts` and save. | The page fully reloads rather than hot-patching; afterwards exactly one ingest worker and one watcher exist. |

Record browser and version, source mode, pass or fail, and the failing action for each applicable row. A permission path that cannot be reproduced stays explicitly unverified rather than marked passed. Migration-reset messaging can be inspected in a disposable database by changing a stored `_migrations.hash` through DevTools and reloading; never alter the real profile or the committed migration files for this check.

Acceptance requires the human to confirm import, refresh persistence, duplicate handling, follow and inspection behaviour, uninterrupted importing across Run and Data navigation, hash deep links against the built output, and reconnect, snapshot, and polling fallback. Stop after the final review and this handoff; do not proceed into the chart or other page milestones.
