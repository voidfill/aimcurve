/**
 * Whether this browser's database holds any completed run: the one test every
 * page uses to decide between its content and the shared empty state.
 *
 * Null until the first answer. A failed read counts as having runs, so the
 * page shows its content and reports the failure itself rather than claiming
 * the database is empty. Reread
 * when an import adds runs. A module singleton, so moving between pages never
 * flashes a loading state for an answer already known.
 */
import { effectScope, shallowRef, watch, type Ref } from 'vue';
import { useDb } from './useDb';
import { useImport } from './useImport';

function create(): Ref<boolean | null> {
	const { pg } = useDb();
	const { revision } = useImport();
	const hasRuns = shallowRef<boolean | null>(null);
	let gen = 0;

	async function load(): Promise<void> {
		const handle = pg.value;
		const mine = ++gen;
		if (handle === null) return;
		try {
			const result = await handle.query<{ present: boolean }>(`select exists (select 1 from run where kind = 'complete') as present`);
			if (mine === gen) hasRuns.value = result.rows[0]?.present ?? false;
		} catch {
			if (mine === gen) hasRuns.value = true;
		}
	}

	watch([pg, revision], () => void load(), { immediate: true });
	return hasRuns;
}

let hasRuns: Ref<boolean | null> | undefined;

export function useHasRuns(): Ref<boolean | null> {
	// Detached: created inside whichever view asks first, its watcher would
	// otherwise stop when that view unmounts, e.g. on the trip to Data to import.
	hasRuns ??= effectScope(true).run(create)!;
	return hasRuns;
}
