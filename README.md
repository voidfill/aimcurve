# aimcurve

Static Astro site with a client-side Postgres (PGlite + Drizzle) and protobuf codegen.

## Setup

```sh
nix develop      # node 22 + corepack; pnpm pinned by package.json
pnpm install
```

## Scripts

| script             | what                                                   |
| ------------------ | ------------------------------------------------------ |
| `pnpm dev`         | astro dev server                                        |
| `pnpm build`       | static build to `dist/`                                 |
| `pnpm check`       | `astro check` (needs TypeScript 6.x, see below)         |
| `pnpm test`        | vitest, node environment                                |
| `pnpm db:generate` | drizzle-kit → SQL in `drizzle/`                         |
| `pnpm gen:proto`   | buf + protoc-gen-es → `src/gen/`                        |

## Layout

```
src/lib/     core calculation logic — pure, runs in the browser and in vitest
src/db/      schema, migrations, and the browser PGlite client
src/gen/     generated protobuf code
src/pages/   astro pages
test/helpers shared test helpers (node-only)
test/fixtures  curated/ is committed, raw/ is the gitignored dump
```

**The core takes bytes, not paths.** Parsers accept `string` / `Uint8Array`, and
anything touching a database accepts a `Db` rather than importing `src/db/client.ts`.
That is what lets the same code run under vitest and in the browser — the only part
that differs is where the bytes come from (node `fs` in tests, a file picker in the
browser).

Tests sit next to their source (`src/**/*.test.ts`); `test/` holds only helpers and
fixtures, plus their own tests.

## Fixtures

`test/fixtures/raw/` is the full KovaaK's dump — ~32MB, 4590 files, gitignored. Unzip
an export into it to get `raw/performances/*.perf` and `raw/stats/*.csv`.

`test/fixtures/curated/` is the hand-picked, committed subset. Everything that must
pass on a fresh clone reads from there. Sweeps over the full dump guard on
`raw.available`:

```ts
import { curated, raw } from '../../test/helpers/fixtures';

describe.skipIf(!raw.available)('every stats file parses', () => { /* ... */ });
```

Data formats: `stats/*.csv` has three sections (kill table, weapon/settings table, a
`Key:,value` block). `performances/*.perf` is binary protobuf with no published
schema — a header message followed by repeated event records.

## Database

No server. `src/db/client.ts` opens PGlite against IndexedDB (`idb://aimcurve`) in the
browser; tests open an in-memory instance. Both share `src/db/schema.ts` and apply the
same generated SQL.

`drizzle-kit`'s node migrator is filesystem-bound, so migrations are loaded through
`import.meta.glob('../../drizzle/*.sql', { query: '?raw' })` in `src/db/migrations.ts` and
applied by `src/db/migrate.ts`, which tracks what has run in a `_migrations` table — the
browser database persists, so migration runs must be idempotent.

Adding a table: edit `src/db/schema.ts` → `pnpm db:generate` → commit the new SQL file.

## Protobuf

`proto/*.proto` → `pnpm gen:proto` → `src/gen/*_pb.ts` (committed, so a fresh clone needs
no codegen). Uses `@bufbuild/protobuf`'s schema API: `create`, `toBinary`, `fromBinary`.

## Notes

- `typescript` is pinned to 6.x: `@astrojs/check` relies on a programmatic API that
  TypeScript 7 does not ship yet.
- PGlite is excluded from Vite's dep pre-bundling (`astro.config.mjs`) because it ships
  wasm and a worker. The `eval` warnings during build come from its wasm loader.
