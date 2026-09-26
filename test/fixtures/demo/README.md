# Demo fixtures

The About page's sample data: all 39 completed **Air Spectral Easy** runs from
2026-09-03 to 2026-09-18, each with its `.csv` and `.perf`, copied unchanged
from a real install. Tracked with Git LFS, like `curated/`.

They are not parser edge cases. They are here so the About walkthrough can show
real charts without a database: `src/lib/demo/snapshot.test.ts` ingests them
into a test PGlite, reads everything the About charts query, and matches the
result against the committed `src/data/demo-snapshot.json`. After changing
these files, ingest, migrations or queries, regenerate it with `pnpm gen:demo`.

The CSVs carry the recording player's settings (sensitivity, DPI, FOV,
resolution, crosshair). Publishing them is intended.
