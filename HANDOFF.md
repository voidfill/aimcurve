# Handoff — start here for Plan B

**Plan A is merged.** `da5f5f5` on `master`. Worktree and branch are gone.
**Plan B has not started.** It was reviewed first; 40+ defects found. They are
indexed by task below — read your task's entry before dispatching its implementer.

Plan B: `docs/superpowers/plans/2026-09-14-aimcurve-browser-storage.md`

## Verify the baseline before you change anything

```
cd web && npm install                  # a fresh clone has no node_modules
cd web && npm test                     185 passed
cd web && npx astro check              0 errors
nix shell nixpkgs#python3 --command python3 -m unittest discover -s tests    104 passed
nix shell nixpkgs#python3 --command bash -c 'cd web && npm run oracle'         9 passed
```

All four confirmed green on `da5f5f5` on 2026-09-15.

## How to run Plan B

Use `superpowers:subagent-driven-development`. Per task: dispatch **one**
implementer subagent with the task's **full text pasted in** — never make it
read the plan file. Reviews only at the plan's own checkpoints (**Tasks 5, 7,
10**), not per task.

**Tasks 4–6 were renumbered on 2026-09-15** to put the source boundary ahead of
the indexer that imports it. The order is now **4 source boundary · 5 indexer ·
6 writer election**; Tasks 1–3 and 7–10 are untouched. The sections below and
the plan file both use the new numbers.

**The rule that caught all nine of Plan A's defects — repeat it verbatim in
every implementer prompt:** stop and report **BLOCKED** on a failing
expectation, with evidence. Never adjust a test to make it pass. Verify the
claim yourself before authorizing any change.

**Paste the relevant per-task findings below into each implementer's prompt.**
They were found by running the plan's code, not reading it — an implementer who
hits one cold will lose hours re-deriving it.

Two process notes learned the hard way:
- **Never run two subagents in the same worktree at once.** Two reviewers both
  ran `git checkout -- .` and clobbered each other's scratch files.
- **Give reviewers the real source and make them run the plan's code.** Every
  confirmed finding came from execution; reading alone produced only speculation.

---

# Plan B defects, indexed by task

Severity: **[BLOCKER]** breaks the task's own verification · **[BUG]** ships
broken behaviour · **[NOTE]** wrong docs, wrong expectations, or a trap.

## Task 1 — The database

- **[BUG] No `onversionchange` anywhere in the plan.** `openDatabase` rejects on
  `onblocked`, but nothing sets `db.onversionchange = () => db.close()`. A
  schema bump while another tab is open deadlocks the new tab, which shows a raw
  error string and no instruction. Add the standard handler and make the
  `onblocked` message actionable.

## Task 2 — Packing kills

**Confirmed clean.** All 6 tests pass as written; every concrete number checked
against the real fixtures. The pack/unpack round trip is sound including
`NaN`↔`null` and `dmg_possible: 0`. It is typed arrays, not a hand-rolled binary
layout, so there are no field widths or endianness to get wrong. Don't re-audit.

## Task 3 — The IndexedDB Store

- **[BUG] `days()` returns truncated filenames, not dates.**
  `IDBIndex.getAllKeys()` returns **primary** keys, not index keys. The primary
  key of `runs` is the basename, so `String(k).slice(0, 10)` gives
  `'Air Pure M'` where `memstore` gives `'2026-04-06'`. It cascades:
  `api.getSession` takes `days[days.length - 1]`, so the session panel asks for
  day `'VT Ground '` and gets zero rows. **Fix:** open a key cursor on the index
  and read `cursor.key`. Verified to reproduce `memstore.days()` exactly.

- **[BUG] `page()` with an unknown cursor returns the whole newest page.** This
  is Plan A's worst bug, reprised verbatim — infinite scroll wraps and repeats
  for ever. `memstore.ts:129-140` carries a comment about having fixed it once;
  read it. **Fix:** `if (opts.before != null && !cursorRun) return [];`

- **[BUG] `scenarioList`'s mean is an uncompensated left-to-right sum.**
  `values.reduce((a, b) => a + b, 0) / n` where `memstore` uses `pySum`, because
  SQLite's `AVG` has summed with Neumaier compensation since 3.42. Invisible on
  the fixtures (no scenario has enough runs), fails against a real install.
  **Fix:** `import { pySum } from '../core/compare'`.

- **[BUG] `scenarioList`'s sort comparator returns `-1` for equal keys.**
  Inconsistent comparator; `memstore.ts:195-196` returns `0` on equality
  specifically, and the oracle compares the list positionally.

- **[NOTE] `bestBySlot` uses a sequential `await` inside a transaction**, which
  the preamble forbids. It passed under `fake-indexeddb`, and per spec awaiting
  an *IDB request* is actually safe — the preamble's rule is over-broad; the real
  hazard is awaiting a **non-IDB** promise. Either restate the rule correctly or
  rewrite `bestBySlot` in the issue-then-`Promise.all` form. Decide once, because
  as written the plan contradicts itself.

- **[NOTE] Step 4 says `npm run oracle` → "Expected: 5 passed". It is 9.**

## Task 4 — The source boundary

- **[BUG] `readAll` keeps draining the list after it has already rejected.**
  The other `width - 1` workers are detached and keep calling `work` on every
  remaining item after the caller has unwound and possibly torn down its
  database. **It is width-dependent:** at `width: 1` a throw on item 1 processes
  nothing further; at `width: 2` it processes everything — so one unreadable
  file gives a **nondeterministic partial index**. Fix with a shared `failed`
  flag checked at the top of each worker loop, or `Promise.allSettled`.

- **[NOTE] `readAll` returns results in completion order, not input order.**
  Confirmed by running it. The indexer downstream will be tempted to `push` into
  an array and assume otherwise. Put it in the doc comment.

- **[BUG] `upload.ts` and `picker.ts` enumerate different file sets**, violating
  the task's own headline ("the indexer must never be able to tell which source
  it has"). `pickerSource` reads strictly `stats/` and `performances/` and
  throws if the folder is wrong. `uploadSource` uses only `file.name` and
  **never reads `webkitRelativePath`** — despite a comment saying it does — so
  it indexes any `* Stats.csv` anywhere in the tree (a backup folder, a second
  install), and on a name collision the last `File` silently wins. Picking the
  wrong folder yields `list() === []` and no error, rendered as "No runs yet."

- **[NOTE] `DEFAULT_CONCURRENCY = 12` is justified as "the middle of 8 to 128".**
  The middle of that range is ~68. The value is probably right; the stated
  reason is not the reason, and a later reader will propagate it.

**Confirmed clean:** the concurrency bound is exact (peak 12 for 12), empty
input is safe, no off-by-one, no never-settling promise. Suffix constants
(`" Stats.csv"` / `" Performance.perf"`) and directory names verified against
the Python.

## Task 5 — The incremental indexer

- **[FIXED 2026-09-15] The source boundary now precedes the indexer.** This task
  imports `../source/pool` and `../source/types`, which used to be created by a
  later task, so Step 2 would have failed on `../source/pool` rather than on
  `../src/db/indexer`. Resolved by renumbering: the source boundary is **Task 4**
  and the indexer is **Task 5**. Every import in this task now resolves from an
  earlier one — verified import by import. Nothing to do; do not "restore" the
  old order. The contract the indexer assumes is unchanged: `read()` returns
  `{ stats?: string; perf?: Uint8Array }`, `stats` **optional**.

- **[BUG] A parse failure is marked indexed, so it is never retried.**
  `known.add(row.run.id)` runs unconditionally, after the error branch, so
  `tries` can never exceed 1 and `MAX_TRIES` is unreachable dead code — against
  this task's own stated rule 2. **The plan's test is named `'records a parse
  failure with a try count and retries it'` and calls `indexInto` once, so it
  passes while proving the opposite of its title.** Also: a recovered file
  leaves a permanent `failed` row, so `counts().failed` never returns to 0.

- **[BUG] One unreadable file discards the entire batch.** `source.read`
  rejecting propagates out of `readAll` before the write transaction opens.
  Measured: 12 of 12 still pending, nothing written. On a 12k bootstrap one
  file deleted mid-index costs the whole 22-second pass. **Fix:** catch per id
  inside the `readAll` callback and record it as a failure — which is what the
  `failed` store and `MAX_TRIES` exist for.

- **[BUG] An empty or fully-indexed folder writes no `meta` at all.**
  `if (!wanted.length) return result;` returns before `META_READ_AT` is written,
  so staleness has nothing to read. Compounds with Task 9's `read_at` bug.

- **[BUG] A basename that doesn't match `FILENAME` is re-read for ever.**
  `if (!row.run.scenario || !row.run.started_at) continue;` skips `known.add`,
  and the file is counted in neither `runs` nor `failed` nor `skipped`.

- **[NOTE] The "Produces" block omits the fifth `options` parameter** that the
  implementation takes and the test passes (`{ force: true }`).

**Confirmed clean:** all 8 indexer tests pass as written, and every concrete
number is right against the real fixtures — 11 stats / 7 perf / 8 scenarios,
`AIR_A` score `906.138184`, `duration_s === 93.85209655761719` exactly, the
out-of-order marks expectations. Transaction lifetime in the write loop and in
`reclassify` is correct. Don't re-audit those.

## Task 6 — Writer election

- **[BUG] The no-Web-Locks fallback elects every tab.** Returns
  `{ elected: true }` unconditionally, so N tabs all become writers — precisely
  the lost update the task exists to prevent, now guaranteed rather than racy.
  Its stated reason ("no other tab can be detected either") is **false**:
  `BroadcastChannel` and the `storage` event both predate Web Locks everywhere.
  And the premise is stale — Safari 15.4+ and Firefox 96+ both ship Web Locks.
  **The real trigger is a non-secure context**: `navigator.locks` is undefined
  over plain `http://`, i.e. exactly how you'd serve the static build on a LAN.

- **[BUG] The loser is never promoted.** Election happens once, at boot, with
  `ifAvailable: true`. Open two tabs, close the first, and the survivor is
  permanently read-only — no indexing, ever. On a fresh origin that is an empty
  dashboard for ever. The module comment claims the opposite ("the loser is not
  broken: it sees the winner's writes") — once the winner is gone there are
  none. **Fix:** fire a second *blocking* request in parallel and promote on
  grant, with `elected` mutable rather than a frozen boolean.

- **[BUG] `electWriter()` never settles if `locks.request` rejects.** The
  returned promise resolves only from inside the granted callback, and
  `request()`'s own promise is discarded with no `.catch`. It rejects when the
  document is not fully active, on an opaque origin, and on `InvalidStateError`.
  Boot hangs on a blank shell with the rejection only in the console.
  **Fail closed** (`elected: false`) — a degraded reader beats two writers.

- **[NOTE] `Writer.elected` stays `true` after `release()`.** It is a snapshot.
  Either make it a getter over a mutable flag, or drop `release()` — nothing in
  the plan calls it, since the lock is meant to be held for the tab's lifetime.

## Task 7 — Move the dashboard and repoint its fetch layer

- **[BUG] `loadRun()` interpolates a raw run id into the request path.** The
  nine-edit table fixes `formatHash` and `loadMore` but misses `app.js:782`. Run
  ids are KovaaK's basenames, so `%`, `?` and `#` are all reachable:

  ```
  "Pokeball Frenzy 100% - ..."  -> URIError: URI malformed
  "Is it a hit? - ..."          -> id truncated to "Is it a hit"
                                   AND all four options revert to shim defaults
  ```

  The `?` case is silent: `getRun` throws `UnknownRunError`, `applyRoute`
  swallows it and falls back to `A.runs[0]`, so the user sees the **wrong run
  with the wrong smoothing and no error.** `loadRun` has no `catch` on three of
  its five call sites. **Fix:** add a tenth edit wrapping `id` in
  `encodeURIComponent`.

- **[BUG] `git mv aimcurve/web/vendor web/src/ui/vendor` breaks uPlot.** Its
  IIFE build publishes the global only as a classic top-level `<script>`. Astro
  serves `public/`, not `src/`, so the only route left is a bundled `import`,
  where `var uPlot` is module-scoped. `app.js:194` runs `uPlot.sync('kv')` at
  module evaluation and dies with `ReferenceError` before a pixel renders.
  **It belongs in `web/public/vendor`** — update the preamble's file structure too.

- **[BUG] Two escape sites missed in Step 5.** Bot names are game data on the
  same footing as scenario names and reach the DOM unescaped at `app.js:528`
  (`renderSplits`) and `app.js:571` (`renderWindows`).

- **[NOTE] Step 7 says to delete `(function () {`.** The file actually says
  `(() => {` at `app.js:3`. A literal search-and-delete fails. Every other line
  number in Steps 4 and 5 is exactly right, so this is an isolated slip.

- **[NOTE] `from '../core/api.ts'`** is the only `.ts`-extensioned import in the
  codebase and will hard-error as TS5097 if anyone enables `checkJs`.

- **[NOTE] `app.js` does DOM work at module evaluation** (`ro.observe` at :477,
  `loadCtrl()`/`buildSegs()` at :896, `hashchange` at :828) — all *before*
  `start()`. So `boot.ts` must call `useStore()` **before importing `app.js`**,
  not merely before calling `start()`.

- **[NOTE] Cross-task tension:** `api.ts` calls `store.page()`, `days()`,
  `day()` **synchronously** — `getSession` does `days[days.length - 1]` on the
  return value directly. Task 3 makes `Store` async while `core/` stays frozen.
  The shim absorbs a promise-returning `getRuns` fine, but `getSession` would
  silently return `{day: undefined, runs: []}`. Resolve this at Task 3.

**Confirmed clean:** all six API call sites map correctly apart from the id
encoding; error signalling needs no change (`api.ts` throws exactly where
`server.py` 4xx'd, and the old `api()` only ever checked `r.ok`);
`esc`/`cssEscape` round-trip correctly; `MAX_LIMIT` matches.

## Task 8 — The shell, and the first run

- **[FIXED 2026-09-15] `git add -A web aimcurve/web` aborted** (reproduced: exit
  128) because Step 4 had just `git rm`'d the last file under `aimcurve/web`, so
  the pathspec matched nothing and the commit never happened. Step 6 now reads
  `git add -A web`, and Step 4 says why. Nothing to do.

- **[BUG] Empty database + not the elected writer is a terminal dead end.**
  `showDashboard` is skipped so `#app` stays hidden, and the early `return`
  skips all control wiring. The upload `<label class="button">` is visible and
  **does** open the directory dialog, but no `change` listener was ever bound —
  so choosing a folder does nothing, silently, for ever. Meanwhile the
  "another tab is indexing" message is written into `#status`, which is inside
  the hidden `#app`.

- **[BUG] Wrapping the dashboard in `<main id="app">` severs the layout.**
  `style.css` sizes everything off a body grid (`grid-template-rows: auto
  minmax(0,1fr)`); `#app` is a plain block, so the `minmax(0,1fr)` chain that
  bounds the charts and the rail is broken. Step 3's CSS list doesn't mention
  the wrapper. Also nests `<main>` inside `<main>`, which the spec forbids.

- **[BUG] The status badge ships reading "live" in green.** The carried-over
  markup is `data-state="live"` and nothing changes the default until
  `setSnapshotAge` runs *after* `await start()` — hundreds of ms on a real
  corpus, and permanently if `start()` rejects.

- **[BUG] No re-pick control exists at Task 8's commit** (`#repick` arrives in
  Task 9), and `showDashboard` hides `#pick`. A returning visitor's only option
  is to clear site data — against the plan's own "at every earlier commit there
  is still something that runs".

- **[NOTE] Vendor is duplicated** into both `src/ui/vendor` and
  `public/ui/vendor`; two committed copies of uPlot that can drift. See the
  Task 7 fix — there should be one, in `public/`.

- **[NOTE] Two identical "Choose your KovaaK's folder" controls** are visible at
  once when `supportsPicker()` is true, and the picker's error handler says
  "Try the folder button below instead", referring to an indistinguishable twin.

- **[NOTE] Task 8 never runs `astro check`** — and `astro build` does **not**
  type-check. `boot.ts` has the most cross-module type surface in Plan B. Add it
  here, to Task 9, and to the "Done when" list.

## Task 9 — Staleness and re-picking

- **[BUG] Once the index goes stale it can never go fresh again.** Two
  compounding causes: `indexInto` records `source.pickedAt` (set once when the
  handle opened) rather than the read time, and `repick()` reuses the same
  source object; and the "nothing new" path skips the meta write entirely.
  Pick at 09:00, refresh at 14:00 → `read_at` is rewritten to **09:00**, the
  badge reads "5 h ago" and is unclearable by any action the UI offers.
  **Fix:** write `read_at` in `indexFrom` after a successful pass, including
  the "nothing new" branch.

- **[BUG] The re-pick violates the "nothing is uploaded" constraint.**
  `repick()` clicks `#pickUpload` while `#pick` is hidden, so Chrome's
  *"Upload 11,000 files to this site?"* fires with nothing on screen answering
  it. The preamble is emphatic that this text must precede the dialog, and
  re-pick is *every* read after the first.

- **[BUG] The picker handle is never persisted.** `current` is a module-level
  `let`. After any reload it is `null`, so `repick()` falls through to the
  upload path and a picker user is silently downgraded to `webkitdirectory`,
  re-enumerating the whole install. The comment claiming the handle "stays
  usable" is false. A restored handle also needs `requestPermission`, which can
  return `'denied'` — unhandled, and absent from all three plan files.

- **[BUG] Re-picking a *different* folder merges two installs** into one rail,
  permanently, with no way to separate them — and deleted runs never leave the
  index. `pendingIds` is a pure set-difference and `indexInto` only ever grows
  it; no folder identity is recorded anywhere. This contradicts the preamble's
  "IndexedDB is a cache, not a record." **Fix:** fingerprint the folder
  (`root.name` plus `isSameEntry`) and offer replace-vs-merge.

- **[BUG] Progress and errors render inside `#pick`, which is hidden.** A 22-second
  re-index gives zero feedback; `fail()` writes to `#pickError`, also hidden, so
  any post-`showDashboard` failure is invisible.

- **[NOTE] `describeAge` rounds, `renderAge` doesn't.** At 59 min 40 s the label
  reads "1 h ago" while the styling says not-stale. Also `describeAge(null)`
  renders as "read no data", and a future `readAt` gives negative minutes that
  pass `< 2` and render "just now" — correct only by accident.

- **[NOTE] `#pickUpload.value` is never reset**, so re-picking the *same*
  directory may not fire `change` in Chrome — the most common re-pick case.

## Task 10 — Retire the Python's HTTP surface

- **[FIXED 2026-09-15] The `git rm` aborted and deleted nothing.** It named
  `aimcurve/web`, which Tasks 7 and 8 have already removed; `git rm` validates
  every pathspec before removing anything, so the whole command failed
  (reproduced: exit 128, with `drive-client.mjs` still present afterwards).
  `aimcurve/web` is now dropped from both the `git rm` and the Files header, and
  the task says why. Nothing to do.

- **[NOTE] The Python suite legitimately drops 104 → 79.** `test_server.py`
  contributes 21 and `test_watch.py` 4. Any checklist carrying 104 will read a
  correct outcome as a regression.

- **The oracle survives Task 10 — confirmed by simulating the deletions.**
  `dump.py → index, paths, payload → compare, shapes, perf, statscsv` never
  touches `server` or `watch`. Post-deletion: 79 Python OK, oracle 9/9.

- **[NOTE] Step 5 expects "5 passed" from the oracle. It is 9.**

- **[NOTE] Step 1's safety grep is useless as written.**
  `grep -rn "server\|watch"` matches 30+ lines of **prose**, including in
  `dump.py` — the very file the step names as its tripwire. Grep for imports,
  not words.

- **[NOTE] Step 6's README rewrite misses three passages** outside "installation
  and layout": the whole **Tests** subsection on `drive-client.mjs`
  (`README.md:83-100`), the "Where this is going" blockquote (`:19-25`), and the
  new layout block drops `web/test/` and `web/public/`.

- **[BUG] "The one lie the page could tell" is left in `app.js`.** Step 6 calls
  out *"about a second after a run ends"* and then only fixes the README. Both
  `app.js:873` ("The next run you finish lands here about a second after it
  ends") and `:864` ("aimcurve is watching your stats folder") are **always**
  rendered, because `getHealth` hardcodes `awaiting_perf: 0` so the true branch
  is dead. Add both strings to Task 7's edit list.

---

# Plan A reference — what the engine guarantees

## The oracle diff is the contract

It compares **63,471 leaf values at exact equality, no tolerance** — 187 run
payloads (11 defaults plus an 11×16 option matrix), 24 rails, the scenario list,
every day, the health counts and the default session. Zero differences.
Confirmed sensitive: a one-ulp perturbation inside the plan's original `1e-12`
window fails it. **It must never skip** — an unreachable Python fails the run.

Nothing in Plan B should weaken this. If a Plan B change makes the oracle fail,
that is a real divergence, not a reason to add a tolerance.

## Summation — read before touching any sum

| Python call site | Port |
| --- | --- |
| builtin `sum()` over floats | `pySum` (Neumaier; CPython 3.12+) |
| `statistics.fmean` | `pyFsum` (Shewchuk exact) |
| `statistics.pstdev` / `median` | **neither** |

`pstdev` sums squared deviations exactly over `Fraction`s before anything
reaches a float, and **no float algorithm reproduces it — fsum included.** It is
unreachable on this corpus (a band needs three comparable curves) and is the one
field that may legitimately need an exact-rational implementation later.
**Do not "fix" it with a tolerance.**

Both compensated sums were bugs found by review, not by tests — they were
latent, because short inputs are where the algorithms coincide. They surface
first against a real install, which is Plan B's territory.

## Known, deliberate divergences from the Python

- `payload.share()` returns null for a null `dmg_done`; the Python raises
  `TypeError`. A browser cannot answer a data quirk with a traceback.
- `payload.sumTtk` carries a null TTK as 0; numerically identical to skipping.
- `api.getRuns` bounds `limit` and throws; the Python bounded it in
  `server.py`'s query parsing and answered 400.
- `perf.ts` — a corrupt (not truncated) `.perf` whose timestamp bit-flips large
  throws `RangeError`, not `PerfError`. Inherited from `perf.py`. **This one
  belongs to Plan B's ingestion loop** — it was left alone in Plan A only
  because fixing it there would diverge from the oracle.
- `memstore` breaks a `started_at` tie by basename where the SQL breaks it by
  row id. Unreconcilable given the deliberate id change, and no fixture has a
  tie — do not read it as a defect on the first full-corpus run.

## Constraints that still hold

- `web/src/core/` must import nothing from the DOM, `node:fs`, or storage.
  Storage only via the `Store` interface. **If a Plan B task needs to edit a
  core module, the `Store` boundary was drawn wrong — stop and say so.**
- No bare `python3`. Always `nix shell nixpkgs#python3 --command python3 ...`,
  including the oracle:
  `nix shell nixpkgs#python3 --command bash -c 'cd web && npm run oracle'`.
- Run `npm test` / `npx astro check` from `web/`, not the repo root.
- Until Task 10, `python -m aimcurve` must still run at every commit.

## What is still unproven, and only a real install can settle

- IndexedDB, both sources, the UI, and **the full-corpus oracle diff** — the
  browser design's stated exit criterion, and the only thing that settles the
  `cfg_key` banker's-rounding question, non-ASCII scenario names and malformed
  CSVs. Extending `web/test/oracle/` to read a dump from a path rather than
  shelling out is a small job; do it on the machine with the data.
- No fixture has a scenario with two sensitivities, so `same_cfg=0` compares
  against numbers that coincide with `same_cfg=1`.
- No fixture scenario has three comparable prior curves, so `band.lo`/`band.hi`
  never take a real standard deviation. See the `pstdev` note above.
- The null-`dmg_done` and null-TTK branches are unreachable here and raise on
  the Python side, so the oracle can never settle them either way.
- Firefox and Safari have **never been tried**, despite cross-browser reach
  being half of this tier's case.
