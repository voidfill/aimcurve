# KovaaK's Run Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `notes` placeholder schema with the run-history data layout from the spec — dimensions, the `run` spine, array-backed detail tables, the view layer, change notification — on a migrator that tracks hashes and can reset.

**Architecture:** Hand-written numbered SQL files in `src/db/sql/`, loaded by the existing `import.meta.glob` mechanism and applied in order by a reworked `src/db/migrate.ts`. Drizzle stays as a typed client; `drizzle-kit` and the generated `drizzle/` output go away, because the schema uses views, generated columns, exclusion constraints, partial and covering indexes, triggers, and arrays with alignment checks — almost none of which drizzle-kit models. Tests run the same migration files against an in-memory PGlite, so the test database and the browser database are identical by construction.

**Tech Stack:** PGlite 0.5.8 (PostgreSQL 18.3, WebAssembly), drizzle-orm 0.45 (typed client only), vitest 5, Astro 7, TypeScript 6, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-18-run-schema-design.md`

## Global Constraints

- Target: **PostgreSQL 18.3** via PGlite **0.5.8**. No extensions are loaded; `btree_gist` is deliberately not needed, because the exclusion constraint uses a pure range operator class.
- SQL files live in `src/db/sql/`, named `NNNN_<topic>.sql`, applied in ascending filename order. The filename is the migration's identity.
- **No `CREATE ... IF NOT EXISTS` in migration files.** A migration runs exactly once per database, or the whole database is reset; `IF NOT EXISTS` would hide a bookkeeping bug.
- SQL keywords lowercase, matching the spec's DDL. Copy the DDL from the spec **verbatim** — the comments in it record measurements and are part of the deliverable.
- Tests sit next to their source (`src/**/*.test.ts`); `test/helpers/` holds shared helpers. Run with `pnpm test`.
- Indentation is tabs in TypeScript (matching the existing files) and spaces in SQL (matching the spec's DDL).
- `run_kind` is exactly `('complete', 'reset')`. Aborts go to `unattributed_file`, never to `run`.
- Dimension text (`bot.name`, `weapon.name`) is trimmed before interning, enforced by `check (name = btrim(name) and name <> '')`.
- Callers must filter every window view on its partition key (`scenario_id`). The comment above each window view says so.
- Do not add tests beyond the ones written in this plan.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/db/migrate.ts` | Apply pending migrations; hash tracking; the five reset rules; atomic DDL+bookkeeping. Rewritten. |
| `src/db/migrations.ts` | Load `src/db/sql/*.sql` through `import.meta.glob`, ordered by filename. Glob path changes. |
| `src/db/migrate.test.ts` | The migrator, driven by synthetic migration arrays. New. |
| `src/db/sql/0001_dimensions.sql` | `run_kind` enum, `scenario`, `game_version`, `bot`, `weapon`, `config`. New. |
| `src/db/sql/0002_run.sql` | `run` with its constraints and indexes, plus `unattributed_file`. New. |
| `src/db/sql/0003_detail.sql` | `kill_series`, `run_weapon`, `run_bot`, `run_perf`, `run_series`. New. |
| `src/db/sql/0004_views.sql` | `tick`, `kill`, `run_complete`, `run_attempt`, `run_progress`, `run_session`. New. |
| `src/db/sql/0005_notify.sql` | `notify_run_ingested()` and its statement-level trigger. New. |
| `src/db/schema.test.ts` | Table constraints, grown across Tasks 2–4. New. |
| `src/db/views.test.ts` | The view layer and the worked-query shapes that depend on it. New. |
| `src/db/notify.test.ts` | One notification per statement. New. |
| `src/db/schema.ts` | Drizzle models. Emptied — `notes` is deleted and no model replaces it yet. |
| `src/db/client.ts` | Browser handle. Loses the `notes` schema; gains the worker in Task 7. |
| `src/db/worker.ts` | PGlite running in a Web Worker (D11). New in Task 7. |
| `src/db/db.test.ts` | Deleted — its migration tests move to `migrate.test.ts`, its `notes` tests go with `notes`. |
| `drizzle/`, `drizzle.config.ts` | Deleted. |

---

## Task 1: A migrator that tracks hashes and can reset

Everything else depends on this. It lands first and alone, while `drizzle/0000_massive_human_torch.sql` and `notes` are still in place — so the reset path is exercised against a real database that predates hash tracking, which is rule 5 and is the state every existing browser database is in.

**Files:**
- Modify: `src/db/migrate.ts` (full rewrite)
- Create: `src/db/migrate.test.ts`
- Modify: `src/db/db.test.ts` (remove the two `migrations` tests, which move to the new file)

**Interfaces:**
- Consumes: `Migration { name: string; sql: string }` from `src/db/migrations.ts` (shape unchanged).
- Produces: `applyMigrations(pg: PGliteInterface, migrations: Migration[]): Promise<MigrateResult>`, where
  `MigrateResult = { reset: boolean; reason: string | null; applied: string[] }`.
  `reset` is the signal the ingest layer needs to know its data is gone. `applied` lists the migration names this call executed, in order.

- [ ] **Step 1: Write the failing tests**

Create `src/db/migrate.test.ts`:

```ts
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, type Migration } from './migrate';

let pg: PGlite;

const one: Migration = { name: '0001_a.sql', sql: 'create table a (id int primary key);' };
const two: Migration = { name: '0002_b.sql', sql: 'create table b (id int primary key);' };

/** Table names in the public schema, for asserting what survived a reset. */
async function tables(): Promise<string[]> {
	const r = await pg.query<{ table_name: string }>(
		`select table_name from information_schema.tables
		 where table_schema = 'public' order by table_name`,
	);
	return r.rows.map((row) => row.table_name);
}

beforeEach(() => {
	pg = new PGlite();
});

describe('applyMigrations', () => {
	it('applies pending migrations in order and records them', async () => {
		const result = await applyMigrations(pg, [one, two]);
		expect(result).toMatchObject({
			reset: false,
			reason: null,
			applied: ['0001_a.sql', '0002_b.sql'],
		});
		expect(await tables()).toEqual(['_migrations', 'a', 'b']);
	});

	it('is idempotent', async () => {
		await applyMigrations(pg, [one, two]);
		const again = await applyMigrations(pg, [one, two]);
		expect(again).toMatchObject({ reset: false, applied: [] });
	});

	it('applies a newly added migration without resetting', async () => {
		await applyMigrations(pg, [one]);
		await pg.exec('insert into a values (1)');
		const result = await applyMigrations(pg, [one, two]);
		expect(result).toMatchObject({ reset: false, applied: ['0002_b.sql'] });
		// Rows survive: adding an index or a view must not cost a reingest.
		const rows = await pg.query('select id from a');
		expect(rows.rows).toEqual([{ id: 1 }]);
	});

	it('resets when a pending migration declares itself destructive (rule 1)', async () => {
		await applyMigrations(pg, [one]);
		await pg.exec('insert into a values (1)');
		const destructive: Migration = {
			name: '0002_b.sql',
			sql: '-- reset: adds a column nothing can backfill\ncreate table b (id int primary key);',
		};
		const result = await applyMigrations(pg, [one, destructive]);
		expect(result.reset).toBe(true);
		expect(result.reason).toContain('0002_b.sql');
		expect(result.applied).toEqual(['0001_a.sql', '0002_b.sql']);
		const rows = await pg.query('select id from a');
		expect(rows.rows).toEqual([]);
	});

	it('resets when an applied migration was edited (rule 2)', async () => {
		await applyMigrations(pg, [one]);
		const edited: Migration = {
			name: '0001_a.sql',
			sql: 'create table a (id int primary key, note text);',
		};
		const result = await applyMigrations(pg, [edited]);
		expect(result.reset).toBe(true);
		expect(result.reason).toContain('0001_a.sql');
		const cols = await pg.query(
			`select column_name from information_schema.columns
			 where table_name = 'a' order by column_name`,
		);
		expect(cols.rows).toEqual([{ column_name: 'id' }, { column_name: 'note' }]);
	});

	it('ignores line-ending and trailing-whitespace differences when hashing', async () => {
		await applyMigrations(pg, [one]);
		const crlf: Migration = { name: '0001_a.sql', sql: `${one.sql.replace(/\n/g, '\r\n')}\n\n` };
		const result = await applyMigrations(pg, [crlf]);
		expect(result).toMatchObject({ reset: false, applied: [] });
	});

	it('resets when an applied migration has disappeared (rule 3)', async () => {
		await applyMigrations(pg, [one, two]);
		const result = await applyMigrations(pg, [two]);
		expect(result.reset).toBe(true);
		expect(await tables()).toEqual(['_migrations', 'b']);
	});

	it('resets when migrations were reordered by a branch merge (rule 4)', async () => {
		await applyMigrations(pg, [two]);
		const result = await applyMigrations(pg, [one, two]);
		expect(result.reset).toBe(true);
		expect(result.applied).toEqual(['0001_a.sql', '0002_b.sql']);
	});

	it('resets a database whose bookkeeping predates hash tracking (rule 5)', async () => {
		await pg.exec(`
			create table _migrations (
				name text primary key,
				applied_at timestamptz not null default now()
			);
			insert into _migrations (name) values ('0001_a.sql');
			create table stale (id int);
		`);
		const result = await applyMigrations(pg, [one]);
		expect(result.reset).toBe(true);
		expect(result.applied).toEqual(['0001_a.sql']);
		expect(await tables()).toEqual(['_migrations', 'a']);
	});

	it('drops enum types too, so a replay does not collide', async () => {
		const withEnum: Migration = { name: '0001_a.sql', sql: "create type colour as enum ('red');" };
		await applyMigrations(pg, [withEnum]);
		const edited: Migration = {
			name: '0001_a.sql',
			sql: "create type colour as enum ('red', 'blue');",
		};
		const result = await applyMigrations(pg, [edited]);
		expect(result.reset).toBe(true);
		const labels = await pg.query<{ enumlabel: string }>(
			'select enumlabel from pg_enum order by enumsortorder',
		);
		expect(labels.rows.map((row) => row.enumlabel)).toEqual(['red', 'blue']);
	});

	it('records nothing when the DDL fails, so the next run retries cleanly', async () => {
		const broken: Migration = {
			name: '0001_a.sql',
			sql: 'create table a (id int); create table a (id int);',
		};
		await expect(applyMigrations(pg, [broken])).rejects.toThrow();
		const recorded = await pg.query('select name from _migrations');
		expect(recorded.rows).toEqual([]);
		// The failed DDL rolled back with its bookkeeping, so a fixed file applies normally.
		const fixed: Migration = { name: '0001_a.sql', sql: 'create table a (id int);' };
		await expect(applyMigrations(pg, [fixed])).resolves.toMatchObject({
			applied: ['0001_a.sql'],
		});
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/db/migrate.test.ts`
Expected: FAIL — `applyMigrations` returns `void`, so `toMatchObject` fails on the first test, and `Migration` is not exported from `./migrate`.

- [ ] **Step 3: Rewrite the migrator**

Replace `src/db/migrate.ts` entirely:

```ts
import type { PGliteInterface } from '@electric-sql/pglite';
import type { Migration } from './migrations';

export type { Migration };

export interface MigrateResult {
	/** True when the database was dropped and rebuilt from the migration list. */
	reset: boolean;
	/** Why it was reset. Null when no reset happened. */
	reason: string | null;
	/** Migrations executed by this call, in order. */
	applied: string[];
}

/** A migration opts into a reset with `-- reset: <reason>` on its first line. */
const RESET_MARKER = /^--\s*reset:\s*(.*)$/;

/**
 * Hashes the migration's *text*, not its bytes: `core.autocrlf` is on in this
 * repo and `.gitattributes` has no `*.sql` rule, so what the bundler hands us
 * depends on the checkout. Without normalising, a Linux CI build or a
 * `.gitattributes` addition would change every hash and reset every database.
 */
async function hashMigration(sql: string): Promise<string> {
	const text = sql.replace(/\r\n/g, '\n').trim();
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function declaredDestructive(sql: string): string | null {
	const firstLine = sql.replace(/^﻿/, '').trimStart().split(/\r?\n/, 1)[0] ?? '';
	const match = RESET_MARKER.exec(firstLine.trim());
	return match ? match[1]!.trim() || 'no reason given' : null;
}

/**
 * Decides whether the existing database can be migrated forward, or has to be
 * dropped and replayed. Returns the reason for a reset, or null to go forward.
 */
async function resetReason(
	pg: PGliteInterface,
	migrations: Migration[],
	hashes: string[],
): Promise<string | null> {
	const shape = await pg.query<{ has_hash: boolean | null }>(`
		select bool_or(column_name = 'hash') as has_hash
		from information_schema.columns
		where table_schema = 'public' and table_name = '_migrations'
	`);
	const hasHash = shape.rows[0]?.has_hash ?? null;

	// No bookkeeping table at all: a fresh database, nothing to reconcile.
	if (hasHash === null) return null;

	// Rule 5. Written by the pre-hash migrator, so there is no way to know
	// whether its schema matches the files. Resetting is the only sound answer.
	if (!hasHash) return '_migrations predates hash tracking';

	const recorded = await pg.query<{ name: string; hash: string }>(
		'select name, hash from _migrations order by applied_at, name',
	);

	for (const [i, row] of recorded.rows.entries()) {
		const migration = migrations[i];
		// Rules 3 and 4: the applied migrations must be a prefix of the file
		// list, in the same order. A deleted file, and a branch merge that
		// inserts a lower number, both land here.
		if (!migration || migration.name !== row.name) {
			return (
				`applied migrations diverge from the files at position ${i + 1}: ` +
				`recorded ${row.name}, found ${migration?.name ?? 'nothing'}`
			);
		}
		// Rule 2: an already-applied migration was edited.
		if (hashes[i] !== row.hash) return `${migration.name} changed after it was applied`;
	}

	// Rule 1: a pending migration declares itself destructive.
	for (const [i, migration] of migrations.entries()) {
		if (i < recorded.rows.length) continue;
		const reason = declaredDestructive(migration.sql);
		if (reason !== null) return `${migration.name} declares a reset: ${reason}`;
	}

	return null;
}

/**
 * Applies pending migrations, tracking what ran in `_migrations`.
 *
 * The browser database persists in IndexedDB, so this has to be idempotent —
 * and because reingesting the corpus takes a few seconds, a schema change that
 * cannot be applied forward drops the database and replays the whole list
 * rather than trying to patch it. There is deliberately no separate "current
 * schema" file: a freshly-built database and a migrated one are identical by
 * construction.
 */
export async function applyMigrations(
	pg: PGliteInterface,
	migrations: Migration[],
): Promise<MigrateResult> {
	const hashes = await Promise.all(migrations.map((migration) => hashMigration(migration.sql)));
	const reason = await resetReason(pg, migrations, hashes);

	if (reason !== null) {
		// Takes the enum types with it, so a replay does not collide on `run_kind`.
		await pg.exec('drop schema public cascade; create schema public;');
	}

	await pg.exec(`
		create table if not exists _migrations (
			name text primary key,
			hash text not null,
			applied_at timestamptz not null default now()
		);
	`);

	const recorded = await pg.query<{ name: string }>('select name from _migrations');
	const seen = new Set(recorded.rows.map((row) => row.name));

	const applied: string[] = [];
	for (const [i, migration] of migrations.entries()) {
		if (seen.has(migration.name)) continue;
		// One transaction around the DDL *and* its bookkeeping. Separately, a
		// tab closed between the two would replay the DDL on next load, which
		// fails with "already exists" while no reset rule fires — a state with
		// no recovery path.
		await pg.transaction(async (tx) => {
			await tx.exec(migration.sql);
			await tx.query('insert into _migrations (name, hash) values ($1, $2)', [
				migration.name,
				hashes[i],
			]);
		});
		applied.push(migration.name);
	}

	return { reset: reason !== null, reason, applied };
}
```

- [ ] **Step 4: Move the migration tests out of `db.test.ts`**

Delete the whole `describe('migrations', …)` block from `src/db/db.test.ts`, along with the now-unused `applyMigrations` and `migrations` imports. Leave the `describe('notes', …)` block alone — Task 2 deletes the file.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`
Expected: PASS. `migrate.test.ts` is green, and `db.test.ts`'s `notes` tests still pass — the existing browser-shaped `_migrations` hits rule 5, resets, and replays `0000_massive_human_torch.sql`.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrate.ts src/db/migrate.test.ts src/db/db.test.ts
git commit -m "Track migration hashes, and reset when replay is the only sound option"
```

---

## Task 2: Retire `notes` and drizzle-kit; add the dimension tables

The first migration file of the new schema lands together with the removal of the old one, because `src/db/migrations.ts` cannot point at an empty directory and still produce a database.

**Files:**
- Create: `src/db/sql/0001_dimensions.sql`
- Create: `src/db/schema.test.ts`
- Modify: `src/db/migrations.ts` (glob path)
- Modify: `src/db/schema.ts` (empty it)
- Modify: `package.json` (drop `db:generate` and `drizzle-kit`)
- Delete: `src/db/db.test.ts`, `drizzle/0000_massive_human_torch.sql`, `drizzle/meta/0000_snapshot.json`, `drizzle/meta/_journal.json`, `drizzle.config.ts`

**Interfaces:**
- Consumes: `applyMigrations` from Task 1; `makeTestDb()` from `test/helpers/db.ts`.
- Produces: the type `run_kind`, and tables `scenario(id integer, hash char(32), name text)`, `game_version(id smallint, label text)`, `bot(id smallint, name text)`, `weapon(id smallint, name text)`, `config(id integer, + 15 setting columns)`.

- [ ] **Step 1: Write the failing test**

Create `src/db/schema.test.ts`:

```ts
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../test/helpers/db';

let pg: PGlite;

/** 32 hex characters, the shape of a KovaaK's scenario hash. */
const HASH = 'a'.repeat(32);

/** The 15 client-configuration keys, as one row. */
const CONFIG_VALUES = `'cm/360', 0.0123, 1.5, 1.5, 1600, 103, 'Overwatch', false,
	'blank.png', 1.0, '010101FF', '3440x1440', 100, 999, 0`;

const INSERT_CONFIG = `
	insert into config (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov,
		fov_scale, hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
		resolution_scale, max_fps_config, input_lag)
	values (${CONFIG_VALUES})
	on conflict do nothing
	returning id
`;

beforeEach(async () => {
	({ pg } = await makeTestDb());
});

describe('dimensions', () => {
	it('interns a scenario by hash', async () => {
		await pg.exec(`insert into scenario (hash, name) values ('${HASH}', 'Air Voltaic')`);
		const r = await pg.query<{ name: string }>('select name from scenario');
		expect(r.rows).toEqual([{ name: 'Air Voltaic' }]);
	});

	it('rejects an untrimmed or empty bot or weapon name', async () => {
		// " speedswitch " and "speedswitch" alternate within one corpus file;
		// interning verbatim would fork one bot into two dimension rows.
		await expect(pg.exec(`insert into bot (name) values (' speedswitch ')`)).rejects.toThrow(
			/bot_name_trimmed/,
		);
		await expect(pg.exec(`insert into bot (name) values ('')`)).rejects.toThrow(
			/bot_name_trimmed/,
		);
		await expect(pg.exec(`insert into weapon (name) values (' pistol')`)).rejects.toThrow(
			/weapon_name_trimmed/,
		);
	});

	it('deduplicates a config on the natural key over all 15 columns', async () => {
		const first = await pg.query<{ id: number }>(INSERT_CONFIG);
		expect(first.rows).toEqual([{ id: 1 }]);
		const second = await pg.query<{ id: number }>(INSERT_CONFIG);
		expect(second.rows).toEqual([]);
	});

	it('defines run_kind with exactly two values', async () => {
		const r = await pg.query<{ enumlabel: string }>(`
			select enumlabel from pg_enum e
			join pg_type t on t.oid = e.enumtypid
			where t.typname = 'run_kind' order by e.enumsortorder
		`);
		expect(r.rows.map((row) => row.enumlabel)).toEqual(['complete', 'reset']);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/db/schema.test.ts`
Expected: FAIL — `relation "scenario" does not exist`.

- [ ] **Step 3: Create the dimension migration**

Create `src/db/sql/0001_dimensions.sql`:

```sql
create type run_kind as enum ('complete', 'reset');

-- Hash identifies the scenario at the exact version that produced the run;
-- grouping by name lets an edited scenario silently pollute a progress curve.
create table scenario (
  id    integer generated always as identity primary key,
  hash  char(32) not null unique,
  name  text     not null
);

create index scenario_name on scenario (name);

create table game_version (
  id    smallint generated always as identity primary key,
  label text not null unique
);

-- smallint ids: these two are referenced from inside arrays, where element
-- width is multiplied by 75k kill rows. Measured cardinality 124 and 18.
-- btrim checks: the corpus contains both " speedswitch " and "speedswitch",
-- alternating within one file, so an ingest that forgets to trim must fail
-- loudly rather than quietly fork a dimension.
create table bot (
  id   smallint generated always as identity primary key,
  name text not null unique,
  constraint bot_name_trimmed check (name = btrim(name) and name <> '')
);

create table weapon (
  id   smallint generated always as identity primary key,
  name text not null unique,
  constraint weapon_name_trimmed check (name = btrim(name) and name <> '')
);

-- The 15 client-configuration keys: 53 distinct combinations for 2495 runs.
-- The bound is one row per run (Random Sensitivity), which costs exactly what
-- inlining the columns would have cost, plus a 4-byte foreign key.
--
-- A natural UNIQUE rather than a hash fingerprint: a generated hash would need
-- real::text, whose immutability depends on a GUC, and at this cardinality the
-- wide index costs nothing.
create table config (
  id               integer generated always as identity primary key,
  sens_scale       text             not null,
  sens_increment   double precision not null,
  horiz_sens       real             not null,
  vert_sens        real             not null,
  dpi              integer          not null,
  fov              real             not null,
  fov_scale        text             not null,
  hide_gun         boolean          not null,
  crosshair        text             not null,
  crosshair_scale  real             not null,
  crosshair_color  char(8)          not null,
  resolution       text             not null,
  resolution_scale real             not null,
  max_fps_config   real             not null,
  input_lag        real             not null,
  unique (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov, fov_scale,
          hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
          resolution_scale, max_fps_config, input_lag)
);
```

- [ ] **Step 4: Point the loader at the new directory**

In `src/db/migrations.ts`, change the glob and its comment; leave the rest of the file alone:

```ts
const modules = import.meta.glob('./sql/*.sql', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;
```

The doc comment on `migrations` says "Generated migrations"; they are hand-written now:

```ts
/** Migrations, ordered by their numeric filename prefix. */
```

- [ ] **Step 5: Delete the placeholder and its tooling**

```bash
git rm -r drizzle drizzle.config.ts src/db/db.test.ts
pnpm remove drizzle-kit
```

Remove the `db:generate` line from the `scripts` block in `package.json`, leaving:

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "gen:proto": "buf generate"
```

Then empty `src/db/schema.ts`, keeping the module so `drizzle(pg, { schema })` stays typed:

```ts
/**
 * Drizzle models. Empty for now: `notes` is gone, and the run schema lives in
 * `src/db/sql/`, where views, generated columns, exclusion constraints and
 * array alignment checks can be expressed. Models get added here as the ingest
 * and query layers need typed access to specific tables.
 */
export {};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

Run: `pnpm check`
Expected: no TypeScript errors. `client.ts` and `test/helpers/db.ts` still import `* as schema`, which is now an empty module — that is valid and keeps the `Db` type stable.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Replace the notes placeholder with the scenario, config and bot dimensions"
```

---

## Task 3: The `run` spine

**Files:**
- Create: `src/db/sql/0002_run.sql`
- Modify: `src/db/schema.test.ts` (add the shared run helpers and a `describe('run', …)` block)

**Interfaces:**
- Consumes: `scenario`, `config`, `game_version`, `run_kind` from Task 2.
- Produces: `run(id integer, file_stem text unique, scenario_id, config_id, game_version_id, kind run_kind, started_at, start_ms, written_at, duration_s, span tstzrange, score, kills, hit_count, miss_count, shots, damage_done, damage_possible, damage_taken, total_overshots, reloads, distance_traveled, mbs_points, fight_time_s, time_remaining_s, avg_ttk_s, pause_count, pause_duration, avg_fps, accuracy, efficiency, extra jsonb)`, carrying `unique (id, kind)` for Task 4's composite FK; and `unattributed_file(file_stem, written_at, payload jsonb)`.
- Produces for later tasks in this file: the test helpers `seedDimensions()` and `completeRun(stem, startedAt, writtenAt, score)`.

- [ ] **Step 1: Write the failing test**

Add these two helpers to `src/db/schema.test.ts`, below `INSERT_CONFIG` and above the first `describe`. Task 4 reuses both.

```ts
/**
 * A scenario, game version, two bots, a weapon and a config.
 *
 * Every identity column starts at 1 here because `beforeEach` builds a fresh
 * database per test. Identity sequences advance even on rejected inserts, so
 * seeding after a test that provokes a CHECK violation would not give id 1.
 */
async function seedDimensions(): Promise<void> {
	await pg.exec(`
		insert into scenario (hash, name) values ('${HASH}', 'Air Voltaic');
		insert into game_version (label) values ('3.9.5');
		insert into bot (name) values ('air1_far_short'), ('speedswitch');
		insert into weapon (name) values ('pistol');
	`);
	await pg.query(INSERT_CONFIG);
}

/** A complete run. Times are explicit, so the exclusion constraint is testable. */
function completeRun(stem: string, startedAt: string, writtenAt: string, score: number): string {
	return `
		insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
			started_at, start_ms, written_at, duration_s, score, kills,
			hit_count, miss_count, shots, damage_done, damage_possible, avg_fps)
		values ('${stem}', 1, 1, 1, 'complete', '${startedAt}',
			37200503, '${writtenAt}', 60.5, ${score}, 2, 70, 30, 100, 700, 1000, 420)
	`;
}
```

Then append the block:

```ts
describe('run', () => {
	beforeEach(seedDimensions);

	it('accepts a complete run and derives accuracy, efficiency and span', async () => {
		await pg.exec(completeRun('r1', '2026-01-01 10:20:00.503Z', '2026-01-01 10:21:00.999Z', 900));
		const r = await pg.query<{ accuracy: number; efficiency: number; span: unknown }>(
			'select accuracy, efficiency, span from run where file_stem = $1',
			['r1'],
		);
		expect(r.rows[0]!.accuracy).toBeCloseTo(0.7);
		expect(r.rows[0]!.efficiency).toBeCloseTo(0.7);
		expect(r.rows[0]!.span).not.toBeNull();
	});

	it('accepts a reset with no start time, and leaves its span null', async () => {
		// Score survives: it is non-zero in 16 of the corpus's 21 resets, because
		// it is a raw accumulator rather than something derived at run end.
		await pg.exec(`
			insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
				written_at, score, kills, hit_count, miss_count, shots)
			values ('r2', 1, 1, 1, 'reset', '2026-01-01 10:25:00Z', 142.0, 0, 12, 4, 16)
		`);
		const r = await pg.query<{ span: unknown; score: number }>(
			'select span, score from run where file_stem = $1',
			['r2'],
		);
		expect(r.rows[0]).toMatchObject({ span: null, score: 142 });
	});

	it('rejects a reset that carries a start time', async () => {
		// A reset file is stamped with the *next* attempt's start; storing that
		// in a column named started_at is an invitation to use it.
		//
		// Only started_at is supplied: filling start_ms and duration_s too would
		// violate three CHECKs at once, and Postgres reports whichever it reaches
		// first, so the assertion could not name the constraint under test.
		await expect(
			pg.exec(`
				insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
					started_at, written_at, hit_count, miss_count, shots)
				values ('bad', 1, 1, 1, 'reset', '2026-01-01 11:00:00Z',
					'2026-01-01 11:00:30Z', 1, 1, 2)
			`),
		).rejects.toThrow(/complete_has_start/);
	});

	it('rejects an Avg FPS on a reset', async () => {
		// Uninitialised memory there, observed up to 8.9e9.
		await expect(
			pg.exec(`
				insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
					written_at, hit_count, miss_count, shots, avg_fps)
				values ('bad', 1, 1, 1, 'reset', '2026-01-01 11:00:00Z', 1, 1, 2, 7.3e9)
			`),
		).rejects.toThrow(/fps_only_when_complete/);
	});

	it('rejects shots that do not balance hits and misses', async () => {
		await expect(
			pg.exec(`
				insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
					written_at, hit_count, miss_count, shots)
				values ('bad', 1, 1, 1, 'reset', '2026-01-01 11:00:00Z', 70, 30, 99)
			`),
		).rejects.toThrow(/shots_balance/);
	});

	it('rejects a complete run that does not end after it starts', async () => {
		// The empty range would otherwise escape the exclusion constraint entirely.
		await expect(
			pg.exec(completeRun('bad', '2026-01-01 12:00:00Z', '2026-01-01 12:00:00Z', 10)),
		).rejects.toThrow(/complete_ends_after_start/);
	});

	it('rejects two overlapping complete runs but accepts an overlapping reset', async () => {
		await pg.exec(completeRun('r1', '2026-01-01 10:20:00.503Z', '2026-01-01 10:21:00.999Z', 900));
		await expect(
			pg.exec(completeRun('r3', '2026-01-01 10:20:30Z', '2026-01-01 10:21:30Z', 950)),
		).rejects.toThrow(/no_overlapping_runs/);
		await expect(
			pg.exec(`
				insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
					written_at, hit_count, miss_count, shots)
				values ('r2', 1, 1, 1, 'reset', '2026-01-01 10:20:30Z', 1, 1, 2)
			`),
		).resolves.toBeDefined();
	});

	it('finds the run a .perf belongs to, given a whole-second start', async () => {
		// challenge_start_utc is the CSV start truncated to the second, so it is
		// almost always *earlier* than started_at: containment finds nothing, and
		// the join needs the 1000 ms of lower-bound slack ingest.md specifies.
		// The kind predicate is required — the index is partial.
		await pg.exec(completeRun('r1', '2026-01-01 10:20:00.503Z', '2026-01-01 10:21:00.999Z', 900));
		const probe = '2026-01-01 10:20:00Z';
		const contained = await pg.query(
			`select file_stem from run where kind = 'complete' and span @> $1::timestamptz`,
			[probe],
		);
		expect(contained.rows).toEqual([]);
		const overlapped = await pg.query<{ file_stem: string }>(
			`select file_stem from run
			 where kind = 'complete'
			   and span && tstzrange($1::timestamptz, $1::timestamptz + interval '1 second')`,
			[probe],
		);
		expect(overlapped.rows).toEqual([{ file_stem: 'r1' }]);
	});

	it('keeps an abort out of run, with its whole document', async () => {
		await pg.exec(`
			insert into unattributed_file (file_stem, written_at, payload)
			values ('abort', '2026-01-01 13:00:00Z', '{"weapons":[{"shots":1306,"hits":827}]}')
		`);
		const r = await pg.query<{ shots: number }>(
			`select (payload -> 'weapons' -> 0 ->> 'shots')::int as shots from unattributed_file`,
		);
		expect(r.rows).toEqual([{ shots: 1306 }]);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/db/schema.test.ts`
Expected: FAIL — `relation "run" does not exist`.

- [ ] **Step 3: Create the run migration**

Create `src/db/sql/0002_run.sql`:

```sql
-- One row per Stats.csv, keyed by filename stem: .perf is a subset of .csv, so
-- the CSV is the row and the perf is an attachment. file_stem is unique on disk
-- by construction and never rewritten, which makes re-ingesting a file a no-op
-- rather than a duplicate. (Hash, shots, hits) collides 75 times in 2468 files.
create table run (
  id              integer generated always as identity primary key,
  file_stem       text not null unique,

  scenario_id     integer  not null references scenario,
  config_id       integer  not null references config,
  game_version_id smallint not null references game_version,

  kind        run_kind    not null,
  started_at  timestamptz,           -- Challenge Start; null unless complete
  start_ms    integer,               -- same instant as ms since local midnight
  written_at  timestamptz not null,  -- filename timestamp, end of second
  duration_s  real,                  -- null unless complete

  span tstzrange generated always as (
    case when kind = 'complete' then tstzrange(started_at, written_at, '[)') end
  ) stored,

  -- Run totals, from the CSV's own key/value block (never recomputed from the
  -- series). shots and damage_possible are the sum of the weapon table.
  score             real,
  kills             integer,
  hit_count         integer not null,
  miss_count        integer not null,
  shots             integer not null,
  damage_done       real,
  damage_possible   real,
  damage_taken      real,
  total_overshots   integer,
  reloads           integer,
  distance_traveled double precision,
  mbs_points        real,
  fight_time_s      real,
  time_remaining_s  real,
  avg_ttk_s         real,
  pause_count       integer,
  pause_duration    real,
  avg_fps           real,             -- null for a reset: uninitialised there

  accuracy   real generated always as (hit_count::real / nullif(shots, 0)) virtual,
  efficiency real generated always as (damage_done / nullif(damage_possible, 0)) virtual,

  extra jsonb not null default '{}',

  constraint complete_has_start
    check ((kind = 'complete') = (started_at is not null)),
  constraint complete_has_start_ms
    check ((kind = 'complete') = (start_ms is not null)),
  constraint complete_has_duration
    check ((kind = 'complete') = (duration_s is not null)),
  -- Rejects the empty range (started_at = written_at, which would escape the
  -- exclusion constraint entirely) and turns a midnight-rollover mistake into a
  -- named constraint violation instead of an opaque range error.
  constraint complete_ends_after_start
    check (kind <> 'complete' or written_at > started_at),
  -- Avg FPS in a reset is uninitialised memory, observed up to 8.9e9.
  constraint fps_only_when_complete
    check (kind = 'complete' or avg_fps is null),
  -- Holds in 2495/2495 measured CSVs; a KovaaK's change to any of the three
  -- should fail at ingest rather than quietly skew accuracy.
  constraint shots_balance
    check (shots = hit_count + miss_count),
  -- "A player cannot be inside two completed runs at once" — the precondition
  -- the CSV<->perf join rests on, checked on every insert instead of assumed.
  -- The GiST index behind it also serves that join, but only through overlap
  -- against a one-second probe range, never plain containment: the perf's
  -- challenge_start_utc is truncated to the second and so is almost always
  -- earlier than started_at (measured: >= in 4 of 2156 pairs).
  constraint no_overlapping_runs
    exclude using gist (span with &&) where (kind = 'complete'),
  -- Referenced by run_perf, so that a .perf can only attach to a complete run.
  constraint run_id_kind unique (id, kind)
);

create index run_scenario_time  on run (scenario_id, started_at) include (score)
                                where kind = 'complete';
create index run_scenario_score on run (scenario_id, score desc)
                                where kind = 'complete';
create index run_written        on run (written_at desc);
create index run_config         on run (config_id) where kind = 'complete';
-- Not partial: the reroll-rate and attempt-numbering queries span both kinds.
create index run_scenario_kind  on run (scenario_id, kind);

-- Abort files: empty Scenario and Hash, so no scenario identity and nothing to
-- join. payload is the whole parsed document, not just the key/value block: the
-- one abort in the corpus has an empty kill table but a real weapon row with
-- 1306 shots and 827 hits, which "nothing is silently dropped" has to cover.
create table unattributed_file (
  file_stem  text primary key,
  written_at timestamptz not null,
  payload    jsonb not null
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/sql/0002_run.sql src/db/schema.test.ts
git commit -m "Add the run spine, with ingest.md's invariants as constraints"
```

---

## Task 4: Array-backed detail tables and the perf attachment

**Files:**
- Create: `src/db/sql/0003_detail.sql`
- Modify: `src/db/schema.test.ts` (append a `describe('detail tables', …)` block)

**Interfaces:**
- Consumes: `run`, `run.unique (id, kind)`, `bot`, `weapon` from Tasks 2–3; the `seedDimensions()` and `completeRun()` helpers from Task 3.
- Produces: `kill_series(run_id, at_ms integer[], bot_id smallint[], weapon_id smallint[], ttk real[], shots smallint[], hits smallint[], damage_done real[], damage_possible real[], overshots smallint[], cheated smallint[])`; `run_weapon(run_id, weapon_id, shots, hits, damage_done, damage_possible)`; `run_bot(run_id, bot_id, kills, avg_ttk, shots, hits, damage_done, damage_possible, overshots, accuracy)`; `run_perf(run_id, kind, perf_file_stem, schema_version, challenge_start_utc, time_limit, timescale, map_name, map_scale, player_profile, player_team, player_max_lives, end_challenge_after_kills, end_challenge_after_damage, added_bots text[], bot_max_lives smallint[], bot_teams smallint[])`; `run_series(run_id, t real[], + 13 nullable metric arrays)`.
- **Column order in `kill_series` and `run_series` is load-bearing** — Task 4's `unnest` views pass the arrays positionally, so the view's output column names come from that order.

- [ ] **Step 1: Write the failing test**

Append to `src/db/schema.test.ts`:

```ts
describe('detail tables', () => {
	beforeEach(async () => {
		await seedDimensions();
		await pg.exec(completeRun('r1', '2026-01-01 10:20:00.503Z', '2026-01-01 10:21:00.999Z', 900));
	});

	it('accepts aligned kill arrays', async () => {
		await pg.exec(`
			insert into kill_series values
			(1, '{37200600,37201200}', '{1,2}', '{1,1}', '{0.44,0.31}', '{3,2}', '{2,2}',
			    '{100,100}', '{150,120}', '{0,1}', '{0,1}')
		`);
		const r = await pg.query<{ n: number }>(
			'select cardinality(at_ms) as n from kill_series where run_id = 1',
		);
		expect(r.rows).toEqual([{ n: 2 }]);
	});

	it('rejects misaligned kill arrays', async () => {
		await expect(
			pg.exec(`
				insert into kill_series values
				(1, '{1,2}', '{1}', '{1,1}', '{1,1}', '{1,1}', '{1,1}',
				    '{1,1}', '{1,1}', '{1,1}', '{0,0}')
			`),
		).rejects.toThrow(/kill_series_aligned/);
	});

	it('rejects misaligned tick arrays but accepts a wholly absent metric', async () => {
		await expect(
			pg.exec(`insert into run_series (run_id, t, score) values (1, '{1,2,3}', '{1,2}')`),
		).rejects.toThrow(/run_series_aligned/);
		// A tracking scenario emits no reloads at all, so that array stays null.
		await expect(
			pg.exec(`insert into run_series (run_id, t, score) values (1, '{1,2,3}', '{1,2,3}')`),
		).resolves.toBeDefined();
	});

	it('rejects a .perf attached to a reset', async () => {
		await pg.exec(`
			insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
				written_at, hit_count, miss_count, shots)
			values ('r2', 1, 1, 1, 'reset', '2026-01-01 10:25:00Z', 1, 1, 2)
		`);
		await expect(
			pg.exec(`
				insert into run_perf (run_id, perf_file_stem, schema_version,
					challenge_start_utc, added_bots)
				values (2, 'r2-perf', 1, '2026-01-01 10:25:00Z', '{air.bot}')
			`),
		).rejects.toThrow();
	});

	it('rejects perf bot arrays that do not align with added_bots', async () => {
		await expect(
			pg.exec(`
				insert into run_perf (run_id, perf_file_stem, schema_version,
					challenge_start_utc, added_bots, bot_teams)
				values (1, 'r1-perf', 1, '2026-01-01 10:20:00Z', '{air.bot}', '{0,1}')
			`),
		).rejects.toThrow(/bots_aligned/);
	});

	it('derives run_bot accuracy and cascades every detail row on delete', async () => {
		await pg.exec(`
			insert into kill_series values
			(1, '{37200600}', '{1}', '{1}', '{0.44}', '{3}', '{2}', '{100}', '{150}', '{0}', '{0}');
			insert into run_weapon values (1, 1, 100, 70, 700, 1000);
			insert into run_bot values (1, 1, 3, 0.44, 100, 70, 300, 450, 0);
			insert into run_perf (run_id, perf_file_stem, schema_version, challenge_start_utc, added_bots)
			values (1, 'r1-perf', 1, '2026-01-01 10:20:00Z', '{air.bot}');
			insert into run_series (run_id, t, score) values (1, '{1,2,3}', '{100,110,90}');
		`);
		const before = await pg.query<{ accuracy: number }>('select accuracy from run_bot');
		expect(before.rows[0]!.accuracy).toBeCloseTo(0.7);

		await pg.exec(`delete from run where file_stem = 'r1'`);
		const after = await pg.query<Record<string, number>>(`
			select (select count(*) from kill_series)::int as kills,
			       (select count(*) from run_weapon)::int  as weapons,
			       (select count(*) from run_bot)::int     as bots,
			       (select count(*) from run_perf)::int    as perfs,
			       (select count(*) from run_series)::int  as series
		`);
		expect(after.rows[0]).toEqual({ kills: 0, weapons: 0, bots: 0, perfs: 0, series: 0 });
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/db/schema.test.ts`
Expected: FAIL — `relation "kill_series" does not exist`.

- [ ] **Step 3: Create the detail migration**

Create `src/db/sql/0003_detail.sql`:

```sql
-- Per-run sequences, stored as aligned parallel arrays and read through the
-- unnest views in 0004. Measured 3-5x smaller than row-per-record, 2x faster to
-- ingest, and the same query cost. Alignment is a CHECK, so a misaligned write
-- is rejected rather than silently producing skewed rows through unnest.
create table kill_series (
  run_id          integer primary key references run on delete cascade,
  at_ms           integer[]  not null,  -- ms since local midnight, verbatim
  bot_id          smallint[] not null,
  weapon_id       smallint[] not null,
  ttk             real[]     not null,
  shots           smallint[] not null,
  hits            smallint[] not null,
  damage_done     real[]     not null,
  damage_possible real[]     not null,
  overshots       smallint[] not null,
  cheated         smallint[] not null,  -- 1 of 75,504 rows is non-zero
  constraint kill_series_aligned check (
    cardinality(cheated)   = cardinality(at_ms) and
    cardinality(bot_id)    = cardinality(at_ms) and
    cardinality(weapon_id) = cardinality(at_ms) and
    cardinality(ttk)       = cardinality(at_ms) and
    cardinality(shots)     = cardinality(at_ms) and
    cardinality(hits)      = cardinality(at_ms) and
    cardinality(damage_done)     = cardinality(at_ms) and
    cardinality(damage_possible) = cardinality(at_ms) and
    cardinality(overshots) = cardinality(at_ms)
  )
);

create table run_weapon (
  run_id          integer  not null references run on delete cascade,
  weapon_id       smallint not null references weapon,
  shots           integer not null,
  hits            integer not null,
  damage_done     real    not null,
  damage_possible real    not null,
  primary key (run_id, weapon_id)
);

-- Per-run, per-bot rollup. A run never changes after it is written, so this is
-- immutable and is maintained at ingest rather than refreshed. It is also the
-- fastest path for the bot-breakdown use case: 2.4 ms, against 3.1 ms from kill
-- rows and 4.5 ms from kill arrays.
create table run_bot (
  run_id          integer  not null references run on delete cascade,
  bot_id          smallint not null references bot,
  kills           integer not null,
  avg_ttk         real    not null,
  shots           integer not null,
  hits            integer not null,
  damage_done     real    not null,
  damage_possible real    not null,
  overshots       integer not null,
  accuracy real generated always as (hits::real / nullif(shots, 0)) virtual,
  primary key (run_id, bot_id)
);

create index run_bot_bot on run_bot (bot_id);

create table run_perf (
  run_id              integer primary key references run on delete cascade,
  -- A .perf is only written on completion, so it can only attach to a complete
  -- run. Enforced with a composite FK, since a CHECK cannot span tables.
  kind                run_kind not null default 'complete' check (kind = 'complete'),
  -- The perf's own filename stem, which can differ from the CSV's: 8 pairs in
  -- the corpus are named a second apart. Without it, ingest has no dedup key
  -- for perfs and "0 perfs claimed twice" is not re-derivable from the database.
  perf_file_stem      text not null unique,
  schema_version      smallint not null,
  challenge_start_utc timestamptz not null,  -- truncated to the second by the format
  time_limit                real,
  timescale                 real,
  map_name                  text,
  map_scale                 real,
  player_profile            text,
  player_team               smallint,
  player_max_lives          integer,
  end_challenge_after_kills real,
  end_challenge_after_damage real,
  added_bots     text[]     not null,
  bot_max_lives  smallint[],
  bot_teams      smallint[],
  constraint bots_aligned check (
    (bot_max_lives is null or cardinality(bot_max_lives) = cardinality(added_bots)) and
    (bot_teams     is null or cardinality(bot_teams)     = cardinality(added_bots))
  ),
  foreign key (run_id, kind) references run (id, kind) on delete cascade
);

-- The 13 event types observed in the corpus, one array each, tick-aligned.
-- A type outside this set makes ingest raise; adding one is a migration.
--
-- A whole metric array is NULL when the run never emitted that event, which the
-- vendor documents as "not applicable to this scenario" rather than zero, and
-- inside a non-NULL array a tick where the metric did not change is NULL too.
create table run_series (
  run_id integer primary key references run on delete cascade,
  t                   real[] not null,   -- seconds since challenge start
  shots_fired         integer[],
  shots_hit           integer[],
  shots_missed        integer[],
  damage_done         real[],
  damage_possible     real[],
  score               real[],
  kills               integer[],
  overshots           integer[],         -- includes the terminal negative closer
  player_damage_taken real[],
  reloads             integer[],
  pause_count         integer[],
  distance_traveled   real[],
  mbs_points          real[],
  constraint run_series_aligned check (
    (shots_fired     is null or cardinality(shots_fired)     = cardinality(t)) and
    (shots_hit       is null or cardinality(shots_hit)       = cardinality(t)) and
    (shots_missed    is null or cardinality(shots_missed)    = cardinality(t)) and
    (damage_done     is null or cardinality(damage_done)     = cardinality(t)) and
    (damage_possible is null or cardinality(damage_possible) = cardinality(t)) and
    (score           is null or cardinality(score)           = cardinality(t)) and
    (kills           is null or cardinality(kills)           = cardinality(t)) and
    (overshots       is null or cardinality(overshots)       = cardinality(t)) and
    (player_damage_taken is null or cardinality(player_damage_taken) = cardinality(t)) and
    (reloads         is null or cardinality(reloads)         = cardinality(t)) and
    (pause_count     is null or cardinality(pause_count)     = cardinality(t)) and
    (distance_traveled is null or cardinality(distance_traveled) = cardinality(t)) and
    (mbs_points      is null or cardinality(mbs_points)      = cardinality(t))
  )
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/sql/0003_detail.sql src/db/schema.test.ts
git commit -m "Store per-run kill and tick detail as aligned parallel arrays"
```

---

## Task 5: The view layer

The views are the query surface. Nothing outside ingest reads the array columns directly.

**Files:**
- Create: `src/db/sql/0004_views.sql`
- Create: `src/db/views.test.ts`

**Interfaces:**
- Consumes: every table from Tasks 2–4. The `unnest` argument order must match the column order in `kill_series` and `run_series`.
- Produces: `tick(run_id, tick_no, t, shots_fired, shots_hit, shots_missed, damage_done, damage_possible, score, kills, overshots, player_damage_taken, reloads, pause_count, distance_traveled, mbs_points)`; `kill(run_id, ordinal, at_ms, bot_id, weapon_id, ttk, shots, hits, damage_done, damage_possible, overshots, cheated boolean, accuracy, efficiency, t_offset)`; `run_complete(run.*, scenario_hash, scenario_name, game_version, has_perf)`; `run_attempt(id, scenario_id, kind, written_at, attempt_no, resets_before)`; `run_progress(run_complete.*, completion_no, prev_score, pb_before, best_so_far, config_changed)`; `run_session(id, scenario_id, kind, written_at, session_id, position_in_session)`.

- [ ] **Step 1: Write the failing test**

Create `src/db/views.test.ts`:

```ts
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../test/helpers/db';

let pg: PGlite;

/**
 * Three runs on scenario 1, in written order:
 * r1 (complete, 900) -> r2 (reset) -> r3 (complete, 1100),
 * with kill, bot, perf and tick detail on r1.
 */
beforeEach(async () => {
	({ pg } = await makeTestDb());
	await pg.exec(`
		insert into scenario (hash, name) values ('${'a'.repeat(32)}', 'Air Voltaic');
		insert into game_version (label) values ('3.9.5');
		insert into bot (name) values ('air1_far_short'), ('speedswitch');
		insert into weapon (name) values ('pistol');
		insert into config (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov,
			fov_scale, hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
			resolution_scale, max_fps_config, input_lag)
		values ('cm/360', 0.0123, 1.5, 1.5, 1600, 103, 'Overwatch', false,
			'blank.png', 1.0, '010101FF', '3440x1440', 100, 999, 0);

		insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
			started_at, start_ms, written_at, duration_s, score, kills,
			hit_count, miss_count, shots, damage_done, damage_possible, avg_fps)
		values ('r1', 1, 1, 1, 'complete', '2026-01-01 10:20:00.503Z', 37200503,
			'2026-01-01 10:21:00.999Z', 60.5, 900, 2, 70, 30, 100, 700, 1000, 420),
		       ('r3', 1, 1, 1, 'complete', '2026-01-01 10:30:00.100Z', 37800100,
			'2026-01-01 10:31:00.900Z', 60.8, 1100, 2, 80, 20, 100, 800, 1000, 430);

		insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
			written_at, score, kills, hit_count, miss_count, shots)
		values ('r2', 1, 1, 1, 'reset', '2026-01-01 10:25:00Z', 142.0, 0, 12, 4, 16);

		insert into kill_series values
		(1, '{37200600,37201200}', '{1,2}', '{1,1}', '{0.44,0.31}', '{3,2}', '{2,2}',
		    '{100,100}', '{150,120}', '{0,1}', '{0,1}');

		insert into run_bot values (1, 1, 1, 0.44, 3, 2, 100, 150, 0),
		                           (1, 2, 1, 0.31, 2, 2, 100, 120, 1),
		                           (3, 1, 1, 0.40, 3, 2, 100, 150, 0),
		                           (3, 2, 1, 0.29, 2, 2, 100, 120, 0);

		insert into run_perf (run_id, perf_file_stem, schema_version, challenge_start_utc, added_bots)
		values (1, 'r1-perf', 1, '2026-01-01 10:20:00Z', '{air.bot}');

		insert into run_series (run_id, t, score) values (1, '{1,2,3}', '{100,110,90}');
	`);
});

describe('tick', () => {
	it('numbers ticks from zero and leaves an absent metric null, not zero', async () => {
		const r = await pg.query<{ tick_no: number; score: number; reloads: number | null }>(
			'select tick_no, score, reloads from tick where run_id = 1 order by tick_no',
		);
		expect(r.rows.map((row) => row.tick_no)).toEqual([0, 1, 2]);
		expect(r.rows.map((row) => row.score)).toEqual([100, 110, 90]);
		expect(r.rows.every((row) => row.reloads === null)).toBe(true);
	});
});

describe('kill', () => {
	it('exposes cheated as a boolean and t_offset against Challenge Start', async () => {
		const r = await pg.query<{ ordinal: number; cheated: boolean; t_offset: number }>(
			'select ordinal, cheated, t_offset from kill where run_id = 1 order by ordinal',
		);
		expect(r.rows.map((row) => row.cheated)).toEqual([false, true]);
		expect(r.rows[0]!.t_offset).toBeCloseTo(0.097, 3);
		expect(r.rows[1]!.t_offset).toBeCloseTo(0.697, 3);
	});
});

describe('run_complete', () => {
	it('excludes resets, resolves dimensions, and derives has_perf', async () => {
		const r = await pg.query<{ file_stem: string; scenario_name: string; has_perf: boolean }>(
			'select file_stem, scenario_name, has_perf from run_complete order by file_stem',
		);
		expect(r.rows).toEqual([
			{ file_stem: 'r1', scenario_name: 'Air Voltaic', has_perf: true },
			{ file_stem: 'r3', scenario_name: 'Air Voltaic', has_perf: false },
		]);
	});
});

describe('run_attempt', () => {
	it('numbers every attempt and counts the resets that preceded each', async () => {
		const r = await pg.query<{ attempt_no: number; kind: string; resets_before: number }>(
			`select attempt_no, kind, resets_before::int as resets_before
			 from run_attempt where scenario_id = 1 order by attempt_no`,
		);
		expect(r.rows).toEqual([
			{ attempt_no: 1, kind: 'complete', resets_before: 0 },
			{ attempt_no: 2, kind: 'reset', resets_before: 0 },
			{ attempt_no: 3, kind: 'complete', resets_before: 1 },
		]);
	});
});

describe('run_progress', () => {
	it('numbers completions and reports the PB that preceded each', async () => {
		const r = await pg.query<{ completion_no: number; score: number; pb_before: number | null }>(
			`select completion_no::int as completion_no, score, pb_before
			 from run_progress where scenario_id = 1 order by completion_no`,
		);
		expect(r.rows).toEqual([
			{ completion_no: 1, score: 900, pb_before: null },
			{ completion_no: 2, score: 1100, pb_before: 900 },
		]);
	});

	it('pushes a partition-key filter down to the index', async () => {
		// Filtering on anything else computes the window over every row first;
		// this is the single easiest way to make the schema slow. Three rows is
		// far too few for the planner to choose an index on cost, so the point
		// being asserted is that the filter *can* reach the index at all.
		await pg.exec('set enable_seqscan = off');
		const plan = await pg.query<{ 'QUERY PLAN': string }>(
			'explain (costs off) select * from run_progress where scenario_id = 1',
		);
		await pg.exec('reset enable_seqscan');
		expect(plan.rows.map((row) => row['QUERY PLAN']).join('\n')).toMatch(/run_scenario_time/);
	});
});

describe('run_session', () => {
	it('segments on a gap of more than 30 minutes and includes resets', async () => {
		await pg.exec(`
			insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
				started_at, start_ms, written_at, duration_s, score, kills,
				hit_count, miss_count, shots)
			values ('r4', 1, 1, 1, 'complete', '2026-01-01 14:00:00Z', 50400000,
				'2026-01-01 14:01:00Z', 60, 1200, 2, 70, 30, 100)
		`);
		const r = await pg.query<{
			file_stem: string;
			session_id: number;
			position_in_session: number;
		}>(`
			select r.file_stem, s.session_id::int as session_id,
			       s.position_in_session::int as position_in_session
			from run_session s join run r on r.id = s.id order by s.written_at
		`);
		expect(r.rows).toEqual([
			{ file_stem: 'r1', session_id: 1, position_in_session: 1 },
			{ file_stem: 'r2', session_id: 1, position_in_session: 2 },
			{ file_stem: 'r3', session_id: 1, position_in_session: 3 },
			{ file_stem: 'r4', session_id: 2, position_in_session: 1 },
		]);
	});
});

describe('worked queries', () => {
	it('summarises a scenario distribution', async () => {
		const r = await pg.query<{ n: number; p50: number; best: number }>(
			`select count(*)::int as n,
			        percentile_cont(0.5) within group (order by score) as p50,
			        max(score) as best
			 from run_complete where scenario_id = $1`,
			[1],
		);
		expect(r.rows[0]).toMatchObject({ n: 2, p50: 1000, best: 1100 });
	});

	it('breaks a run down by bot against the rest of the scenario', async () => {
		const r = await pg.query<{ bot_id: number; avg_ttk: number; p50_ttk: number }>(
			`with target as (select id, scenario_id from run where id = $1),
			 mine as (
			   select b.bot_id, b.kills, b.avg_ttk, b.accuracy
			   from run_bot b join target t on t.id = b.run_id
			 ),
			 history as (
			   select b.bot_id,
			          count(*) as runs,
			          percentile_cont(0.5) within group (order by b.avg_ttk)  as p50_ttk,
			          percentile_cont(0.9) within group (order by b.avg_ttk)  as p90_ttk,
			          min(b.avg_ttk)                                          as best_ttk,
			          percentile_cont(0.5) within group (order by b.accuracy) as p50_accuracy,
			          percentile_cont(0.9) within group (order by b.accuracy) as p90_accuracy,
			          max(b.accuracy)                                         as best_accuracy
			   from run_bot b
			   join run_complete r on r.id = b.run_id
			   join target t on t.scenario_id = r.scenario_id
			   where b.run_id <> t.id
			   group by b.bot_id
			 )
			 select * from mine left join history using (bot_id) order by bot_id`,
			[1],
		);
		expect(r.rows.map((row) => [row.bot_id, row.avg_ttk])).toEqual([
			[1, 0.44],
			[2, 0.31],
		]);
		// The target run is excluded from its own comparison population, so the
		// percentiles come from r3 alone.
		expect(r.rows[0]!.p50_ttk).toBeCloseTo(0.4);
	});

	it('reports the reroll rate per scenario', async () => {
		const r = await pg.query<{ resets: number; completes: number }>(`
			select scenario_id,
			       count(*) filter (where kind = 'reset')::int    as resets,
			       count(*) filter (where kind = 'complete')::int as completes
			from run group by scenario_id
		`);
		expect(r.rows[0]).toMatchObject({ resets: 1, completes: 2 });
	});

	it('buckets the score curve on elapsed time, not tick_no', async () => {
		// The ~1 Hz cadence is not uniform, so tick_no is a per-run ordinal and
		// not a cross-run clock; the HAVING keeps the tail off a shrinking
		// population. One run here, so the support floor is 1.
		const r = await pg.query<{ second: number; n: number }>(
			`with cum as (
			   select run_id, floor(t)::int as second,
			          sum(score) over (partition by run_id order by t) as c
			   from tick
			   where run_id in (select id from run_complete where scenario_id = $2)
			 ),
			 band as (
			   select second, count(*)::int as n,
			          percentile_cont(0.5) within group (order by c) as p50,
			          percentile_cont(0.9) within group (order by c) as p90
			   from cum group by second
			   having count(*) >= 1
			 ),
			 mine as (
			   select floor(t)::int as second, sum(score) over (order by t) as c
			   from tick where run_id = $1
			 )
			 select * from mine full join band using (second) order by second`,
			[1, 1],
		);
		expect(r.rows.map((row) => row.second)).toEqual([1, 2, 3]);
		expect(r.rows.map((row) => row.n)).toEqual([1, 1, 1]);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/db/views.test.ts`
Expected: FAIL — `relation "tick" does not exist`.

- [ ] **Step 3: Create the views migration**

Create `src/db/sql/0004_views.sql`:

```sql
-- One row per tick. tick_no is the right key for a single run's ordering, but
-- NOT a cross-run clock: the ~1 Hz cadence is not uniform, and 17 of 284
-- scenarios spread >= 2 s at a common tick index. Pool runs on elapsed time.
create view tick as
select s.run_id, (x.ord - 1)::smallint as tick_no,
       x.t, x.shots_fired, x.shots_hit, x.shots_missed, x.damage_done,
       x.damage_possible, x.score, x.kills, x.overshots,
       x.player_damage_taken, x.reloads, x.pause_count,
       x.distance_traveled, x.mbs_points
from run_series s,
     unnest(s.t, s.shots_fired, s.shots_hit, s.shots_missed, s.damage_done,
            s.damage_possible, s.score, s.kills, s.overshots,
            s.player_damage_taken, s.reloads, s.pause_count,
            s.distance_traveled, s.mbs_points)
     with ordinality as x(t, shots_fired, shots_hit, shots_missed, damage_done,
                          damage_possible, score, kills, overshots,
                          player_damage_taken, reloads, pause_count,
                          distance_traveled, mbs_points, ord);

-- One row per kill. t_offset is null for a reset, where offsets against
-- Challenge Start are meaningless; inter-kill deltas from at_ms are not.
create view kill as
select k.run_id, (x.ord - 1)::smallint as ordinal, x.at_ms, x.bot_id, x.weapon_id,
       x.ttk, x.shots, x.hits, x.damage_done, x.damage_possible, x.overshots,
       x.cheated <> 0 as cheated,
       x.hits::real / nullif(x.shots, 0) as accuracy,
       x.damage_done / nullif(x.damage_possible, 0) as efficiency,
       -- A plain difference, deliberately not wrapped modulo a day: a negative
       -- value means either a midnight rollover or clock skew, and both should
       -- be visible rather than silently rendered as ~86399.99. Two integers on
       -- the same clock, so it does not depend on the session TimeZone.
       case when r.start_ms is not null
            then ((x.at_ms - r.start_ms) / 1000.0)::real
       end as t_offset
from kill_series k
join run r on r.id = k.run_id,
     unnest(k.at_ms, k.bot_id, k.weapon_id, k.ttk, k.shots, k.hits,
            k.damage_done, k.damage_possible, k.overshots, k.cheated)
     with ordinality as x(at_ms, bot_id, weapon_id, ttk, shots, hits,
                          damage_done, damage_possible, overshots, cheated, ord);

-- Complete runs with their dimensions resolved. The baseline for analysis:
-- partials are excluded here rather than in every downstream query.
create view run_complete as
select r.*, s.hash as scenario_hash, s.name as scenario_name, g.label as game_version,
       p.run_id is not null as has_perf
from run r
join scenario s on s.id = r.scenario_id
join game_version g on g.id = r.game_version_id
left join run_perf p on p.run_id = r.id
where r.kind = 'complete';

-- Attempt numbering over ALL runs of a scenario, resets included. run_progress
-- cannot answer this: it is defined over completions, so its completion_no is
-- n-th completion, while "a PB set on the 16th attempt" counts rerolls.
--
-- WINDOW VIEW: always filter this on scenario_id, its partition key. A filter
-- on anything else is applied only after the window has run over every row.
create view run_attempt as
select id, scenario_id, kind, written_at,
       row_number() over w as attempt_no,
       count(*) filter (where kind = 'reset')
         over (partition by scenario_id order by written_at
               rows between unbounded preceding and 1 preceding) as resets_before
from run
window w as (partition by scenario_id order by written_at);

-- Per-run position in its scenario's history.
--
-- WINDOW VIEW: always filter this on scenario_id, its partition key. Measured
-- on 100k rows: filtered by scenario_id, 334 rows touched in 5.2 ms; filtered
-- by score, all 100,000. To filter on anything else, filter inside a CTE first
-- and apply the window after.
create view run_progress as
select r.*,
       row_number() over w                                        as completion_no,
       lag(r.score)  over w                                             as prev_score,
       max(r.score)  over (partition by r.scenario_id order by r.started_at
                           rows between unbounded preceding and 1 preceding) as pb_before,
       max(r.score)  over w                                             as best_so_far,
       lag(r.config_id) over w is not null
         and lag(r.config_id) over w <> r.config_id                     as config_changed
from run_complete r
window w as (partition by r.scenario_id order by r.started_at);

-- Sessions: a gap of more than 30 minutes starts a new one. Includes partials,
-- because reroll behaviour is part of what a session is. Three levels, because
-- a window function may not be nested inside another window's PARTITION BY.
create view run_session as
select id, scenario_id, kind, written_at, session_id,
       row_number() over (partition by session_id order by written_at, id)
         as position_in_session
from (
  select id, scenario_id, kind, written_at,
         sum(is_new) over (order by written_at, id) as session_id
  from (
    select id, scenario_id, kind, written_at,
           case when written_at - lag(written_at) over (order by written_at, id)
                     > interval '30 minutes'
                 or lag(written_at) over (order by written_at, id) is null
                then 1 else 0 end as is_new
    from run
  ) flagged
) segmented;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/sql/0004_views.sql src/db/views.test.ts
git commit -m "Add the view layer: ticks, kills, progress, attempts and sessions"
```

---

## Task 6: Batch-level change notification

**Files:**
- Create: `src/db/sql/0005_notify.sql`
- Create: `src/db/notify.test.ts`

**Interfaces:**
- Consumes: `run` from Task 3.
- Produces: the channel `run_ingested`, whose payload is `{"count": <int>, "max_id": <int>}`, consumed with `pg.listen('run_ingested', handler)`. The payload carries counts and ids, never row contents — `pg_notify` caps at 8000 bytes.

- [ ] **Step 1: Write the failing test**

Create `src/db/notify.test.ts`:

```ts
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../test/helpers/db';

let pg: PGlite;

beforeEach(async () => {
	({ pg } = await makeTestDb());
	await pg.exec(`
		insert into scenario (hash, name) values ('${'a'.repeat(32)}', 'Air Voltaic');
		insert into game_version (label) values ('3.9.5');
		insert into config (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov,
			fov_scale, hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
			resolution_scale, max_fps_config, input_lag)
		values ('cm/360', 0.0123, 1.5, 1.5, 1600, 103, 'Overwatch', false,
			'blank.png', 1.0, '010101FF', '3440x1440', 100, 999, 0);
	`);
});

describe('run_ingested', () => {
	it('fires once per statement, not once per row', async () => {
		const payloads: string[] = [];
		await pg.listen('run_ingested', (payload) => payloads.push(payload));

		await pg.exec(`
			insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
				written_at, hit_count, miss_count, shots)
			values ('r1', 1, 1, 1, 'reset', '2026-01-01 10:00:00Z', 1, 1, 2),
			       ('r2', 1, 1, 1, 'reset', '2026-01-01 10:01:00Z', 1, 1, 2),
			       ('r3', 1, 1, 1, 'reset', '2026-01-01 10:02:00Z', 1, 1, 2)
		`);
		await new Promise((resolve) => setTimeout(resolve, 150));

		expect(payloads).toHaveLength(1);
		expect(JSON.parse(payloads[0]!)).toEqual({ count: 3, max_id: 3 });
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/db/notify.test.ts`
Expected: FAIL — `expected [] to have a length of 1`.

- [ ] **Step 3: Create the notification migration**

Create `src/db/sql/0005_notify.sql`:

```sql
-- Batch-level "something was ingested". A statement-level trigger with a
-- transition table, so a 500-row COPY fires once rather than 500 times.
-- pg_notify caps at 8000 bytes, so the payload carries counts and ids, never
-- row contents: a listener that needs the rows queries for them.
create function notify_run_ingested() returns trigger language plpgsql as $$
begin
  perform pg_notify('run_ingested',
    json_build_object('count', (select count(*) from inserted),
                      'max_id', (select max(id) from inserted))::text);
  return null;
end $$;

create trigger run_ingested
after insert on run
referencing new table as inserted
for each statement execute function notify_run_ingested();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/sql/0005_notify.sql src/db/notify.test.ts
git commit -m "Notify once per ingest statement, with counts rather than rows"
```

---

## Task 7: Move PGlite into a Web Worker

PGlite is single-threaded WebAssembly, so both a 40 ms query and a ~4 s bulk ingest block whatever thread they run on. D11 calls this the only significant performance risk in the design — the query plans are not.

Browser-only: vitest runs in `node`, which has no `Worker`, so this task has no unit test. It is verified by `pnpm check` and `pnpm build`, and the test helper keeps using a direct in-process `PGlite`.

**Files:**
- Create: `src/db/worker.ts`
- Modify: `src/db/client.ts`

**Interfaces:**
- Consumes: `applyMigrations(pg: PGliteInterface, …)` from Task 1 — already widened from `PGlite`, which is what lets a `PGliteWorker` be migrated.
- Produces: `getDb(): Promise<Db>`, unchanged in signature. The handle underneath is now a `PGliteWorker` with the `live` extension loaded.

- [ ] **Step 1: Write the worker entry point**

Create `src/db/worker.ts`:

```ts
import { PGlite } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import { worker } from '@electric-sql/pglite/worker';

// PGlite is single-threaded WebAssembly: a bulk ingest is ~4 s of solid CPU,
// which would freeze the UI thread outright.
void worker({
	async init() {
		return await PGlite.create('idb://aimcurve', { extensions: { live } });
	},
});
```

- [ ] **Step 2: Point the client at it**

Replace `src/db/client.ts`:

```ts
import type { PGlite } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { drizzle } from 'drizzle-orm/pglite';
import { applyMigrations } from './migrate';
import { migrations } from './migrations';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Promise<Db> | undefined;

/** Browser-only: PGlite in a worker, backed by IndexedDB, migrated on first use. */
export function getDb(): Promise<Db> {
	db ??= (async () => {
		const pg = await PGliteWorker.create(
			new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
			{ extensions: { live } },
		);
		await applyMigrations(pg, migrations);
		// PGliteWorker implements PGliteInterface but does not extend PGlite,
		// which is the concrete class drizzle's pglite driver is typed against.
		return drizzle(pg as unknown as PGlite, { schema });
	})();
	return db;
}
```

- [ ] **Step 3: Verify it typechecks and builds**

Run: `pnpm check`
Expected: no errors.

Run: `pnpm build`
Expected: a successful Astro build. `astro.config.mjs` already sets `worker: { format: 'es' }` and excludes `@electric-sql/pglite` from dependency pre-bundling, which is what makes the wasm and the worker load.

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS — `test/helpers/db.ts` still constructs a plain in-process `PGlite`, so nothing in the suite touches the worker.

- [ ] **Step 5: Commit**

```bash
git add src/db/worker.ts src/db/client.ts
git commit -m "Run PGlite in a worker, so ingest does not freeze the UI thread"
```

---

## Final review

One review of the whole change, after Task 7. The scope is small and the tasks form a single coherent deliverable, so there is nothing to gain from gating each one separately.

- [ ] **Step 1: Confirm the suite, the typecheck and the build are green**

```bash
pnpm test && pnpm check && pnpm build
```

- [ ] **Step 2: Confirm a fresh database and a replayed one agree**

"Identical by construction" is what justifies having no separate schema file, and
a reset replays the same list from the beginning. Check the two agree:

```bash
cat > "$TMPDIR/parity.mjs" <<'EOF'
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dir = 'src/db/sql';
const names = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const files = names.map((name) => readFileSync(`${dir}/${name}`, 'utf8'));

const catalogue = async (pg) =>
  JSON.stringify(
    (
      await pg.query(`select c.relname, c.relkind from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' order by c.relname, c.relkind`)
    ).rows,
  );

const build = async (replayAfterDrop) => {
  const pg = new PGlite();
  for (const sql of files) await pg.exec(sql);
  if (replayAfterDrop) {
    // What a reset does: drop the schema, then replay the same list.
    await pg.exec('drop schema public cascade; create schema public;');
    for (const sql of files) await pg.exec(sql);
  }
  return catalogue(pg);
};

const fresh = await build(false);
const replayed = await build(true);
console.log(fresh === replayed ? 'PARITY OK' : 'MISMATCH');
console.log(names.join(', '));
EOF
node "$TMPDIR/parity.mjs" && rm "$TMPDIR/parity.mjs"
```

Expected: `PARITY OK`, and the five filenames `0001_dimensions.sql … 0005_notify.sql`.
A `MISMATCH`, or a `type "run_kind" already exists` on the replay, means the drop is
not taking the enum types with it. Do not commit the script.

- [ ] **Step 3: Review the diff against the spec**

```bash
git log --oneline master..HEAD
git diff --stat master...HEAD
```

Check against `docs/superpowers/specs/2026-09-18-run-schema-design.md`:

- Every DDL block in the spec appears in `src/db/sql/`, with its comments intact.
- `run_kind` has exactly two values; `run` has no `has_perf` column; `run_progress` says `completion_no`, not `attempt_no`; `kill_series` has a `cheated` array; the perf join in the tests uses `&&` against a one-second range, not `@>`.
- Each of D10's five reset rules has a test in `migrate.test.ts`.
- The placeholder is gone: `git grep -n "drizzle-kit\|db:generate\|notes" -- ':!docs' ':!pnpm-lock.yaml'` returns nothing meaningful.

- [ ] **Step 4: Commit any fixes the review turns up**

---

## Not in this plan

Deliberately excluded, because the spec puts them out of scope:

- **Ingest** — file discovery, parsing, the CSV↔perf join, idempotency, batching, `COPY … FROM '/dev/blob'`. This plan builds the target ingest writes to.
- **The query/client API and the UI**, including `live.query` / `live.incrementalQuery` bindings. Task 7 loads the `live` extension so those bind without another schema change, but no queries are wired up.
- **Drizzle models for the new tables.** `schema.ts` is left empty; models get added alongside the code that needs typed access.
- **A retention policy for old perf series.** The series is 21 MB at the 10,000-run target, and dropping `run_series` rows later needs no schema change.
