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
