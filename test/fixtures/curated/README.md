# Curated fixtures

Hand-picked files from the full dump, committed to the repo. Anything that has to
pass on a fresh clone reads from here via `test/helpers/fixtures.ts`.

Layout mirrors the dump:

```
curated/
  performances/*.perf
  stats/*.csv
```

Pick files when a parser needs them, not before, and keep the set small — one
representative file per shape, plus whatever edge case a test is actually pinning
down. Note in this file why each one earned its place.

The full dump lives in `../raw/` (gitignored, ~32MB, 4590 files) and is only used
by sweep tests guarded on `raw.available`.

## Contents

_Nothing yet._
