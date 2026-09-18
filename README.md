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
