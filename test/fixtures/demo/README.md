# Demo fixtures

The About page's sample data, each run's `.csv` (and for charted runs its `.perf`) copied unchanged
from a real install. Tracked with Git LFS, like `curated/`.

- Every completed **Air Spectral Easy** run: the pace chart and bot table
  show one of them (`DEMO_RUN_STEM`).
- Every completed run of the six scenarios of Viscose Benchmarks S2 Medium's
  **Reactive Tracking** category: the benchmark sheet. CSVs only; ARC needs
  nothing but scores.

Resets are left out; they are not runs. The set is written by
`pnpm gen:demo-fixtures` from `../raw/`, never by hand; see
[docs/preview-assets.md](../../../docs/preview-assets.md).

They are not parser edge cases. They are here so the About walkthrough can show
real charts without a database: `src/lib/demo/snapshot.test.ts` ingests them
into a test PGlite, reads everything the About charts query, and matches the
result against the committed `src/data/demo-snapshot.json`. After changing
these files, ingest, migrations or queries, regenerate it with `pnpm gen:demo`.

The CSVs carry the recording player's settings (sensitivity, DPI, FOV,
resolution, crosshair). Publishing them is intended.
