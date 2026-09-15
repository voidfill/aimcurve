# Handoff — start here for Plan B

**Plan A is merged.** `da5f5f5` on `master`. Worktree and branch are gone.
**Plan B has not started**, but it has been reviewed and corrected.

Plan B: `docs/superpowers/plans/2026-09-14-aimcurve-browser-storage.md`

## The review findings are now in the plan, not in this file

Plan B was reviewed before execution and 40+ defects were found — by running
its code against the fixtures, not by reading it. **All of them have been
applied to the plan itself**, on branch `plan-b-corrections`. The per-task
defect index that used to live here is gone because it would now be a list of
things already done, which is worse than no list at all.

To see what changed and why, read the commits:

```
git log --oneline master..plan-b-corrections
```

Three were task-ordering defects that stopped a task dead rather than merely
shipping a bug, and they are worth knowing about because they changed the task
numbers: **Tasks 4–6 are now source boundary · indexer · writer election**, and
the review checkpoint that used to be "after Task 4" is now **after Task 5**.
Tasks 1–3 and 7–10 kept their numbers.

## Verify the baseline before you change anything

```
cd web && npm install                  # a fresh clone has no node_modules
cd web && npm test                     185 passed
cd web && npx astro check              0 errors
nix shell nixpkgs#python3 --command python3 -m unittest discover -s tests    104 passed
nix shell nixpkgs#python3 --command bash -c 'cd web && npm run oracle'         9 passed
```

All four confirmed green on `da5f5f5` on 2026-09-15. Run the Python one from
the repo root, not from `web/`.

## How to run Plan B

Use `superpowers:subagent-driven-development`. Per task: dispatch **one**
implementer subagent with the task's **full text pasted in** — never make it
read the plan file. Reviews only at the plan's own checkpoints (**Tasks 5, 7,
10**), not per task.

**The rule that caught all nine of Plan A's defects — repeat it verbatim in
every implementer prompt:** stop and report **BLOCKED** on a failing
expectation, with evidence. Never adjust a test to make it pass. Verify the
claim yourself before authorizing any change.

Two process notes learned the hard way:
- **Never run two subagents in the same worktree at once.** Two reviewers both
  ran `git checkout -- .` and clobbered each other's scratch files.
- **Give reviewers the real source and make them run the plan's code.** Every
  confirmed finding came from execution; reading alone produced only
  speculation.

## Still open — decisions, not defects

Two things in Task 9 were deliberately left for a human, because any answer
invents product behaviour rather than fixing a stated one. The plan says so at
the point where it matters:

- **No "replace" option when a different folder is picked.** Task 9 now detects
  it and asks before merging, so the silent permanent merge is gone — but the
  only choices are merge or cancel. Starting over still means clearing site
  data.
- **Deleted runs never leave the index.** `pendingIds` is a pure set difference
  that only ever grows, so a run deleted from disk stays in the rail for ever.
  Fixing it means diffing the full listing against `META_INDEXED` every pass,
  which is a real change to the indexing contract.

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
