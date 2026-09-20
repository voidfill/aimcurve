/**
 * The shared database handle, as reactive state.
 *
 * A module singleton: `getPg()` already caches its own initialization, and
 * this wraps that one promise so every component observes the same readiness,
 * the same failure, and the same migration result.
 */
import { markRaw, ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import type { PGliteInterface } from '@electric-sql/pglite';
import { getLastMigration, getPg } from '../db/client';
import type { MigrateResult } from '../db/migrate';

export interface DbApi {
	/**
	 * The live connection, or null until ready. A `shallowRef` holding a
	 * `markRaw`-wrapped handle: `reactive()` would wrap the driver's methods in
	 * a deep proxy and break them, and this object is not state to diff anyway.
	 */
	pg: ShallowRef<PGliteInterface | null>;
	ready: Ref<boolean>;
	error: ShallowRef<Error | null>;
	/** The result of the migration run that produced `pg`. Null until ready. */
	migration: ShallowRef<MigrateResult | null>;
	/** Clears the failure and tries again. `getPg()` drops its cache on failure. */
	retry: () => void;
}

let api: DbApi | undefined;

function create(): DbApi {
	const pg = shallowRef<PGliteInterface | null>(null);
	const ready = ref(false);
	const error = shallowRef<Error | null>(null);
	const migration = shallowRef<MigrateResult | null>(null);
	let starting = false;

	function start(): void {
		if (starting || ready.value) return;
		starting = true;
		getPg()
			.then((handle) => {
				pg.value = markRaw(handle);
				migration.value = getLastMigration() ?? null;
				ready.value = true;
			})
			.catch((err: unknown) => {
				error.value = err instanceof Error ? err : new Error(String(err));
			})
			.finally(() => {
				starting = false;
			});
	}

	start();

	return {
		pg,
		ready,
		error,
		migration,
		retry: () => {
			error.value = null;
			start();
		},
	};
}

export function useDb(): DbApi {
	api ??= create();
	return api;
}

if (import.meta.hot) {
	// Re-running this module would create a second DB worker, ingest worker,
	// and watcher beside the live ones. Escalate to a full reload instead.
	import.meta.hot.accept(() => import.meta.hot!.invalidate());
}
