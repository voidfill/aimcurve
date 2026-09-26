/**
 * Each directory row's PB rank (L3, L8 of the scenarios directory design),
 * from the same snapshot, picks and lookup as Run and the scenario page, or
 * from the selected benchmark. Every row is blank until the snapshot has
 * loaded, and stays so if it fails.
 */
import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import type { Snapshot } from '../lib/benchmarks/snapshot';
import { type DirectoryRow, hasBenchmark, type PbRank, pbRanks } from '../lib/scenario/directory';
import { loadSnapshot, loadedSnapshot, storedPicks, usePicks } from './useBenchmarkRank';

export interface PbRanksApi {
	/** Null until loaded, and after a failed load. */
	snapshot: ShallowRef<Snapshot | null>;
	/** Whether the load has settled, either way. */
	settled: Ref<boolean>;
	/** The requested benchmark when the snapshot has it; otherwise null, for all scenarios. */
	bench: ComputedRef<number | null>;
	/** Hash → the PB's rank; absent without a benchmark or a PB. */
	ranks: ComputedRef<Map<string, PbRank>>;
}

/** `requested` is the URL's benchmark ID, which may be unknown to the snapshot. */
export function usePbRanks(rows: Ref<readonly DirectoryRow[]>, requested: Ref<number | null>): PbRanksApi {
	const snapshot = shallowRef<Snapshot | null>(loadedSnapshot());
	const settled = ref(snapshot.value !== null);
	const picks = usePicks();

	if (!settled.value)
		loadSnapshot().then(
			(loaded) => {
				snapshot.value = loaded;
				settled.value = true;
			},
			(err: unknown) => {
				console.error('The benchmark snapshot could not be loaded', err);
				settled.value = true;
			},
		);

	const bench = computed(() => {
		const id = requested.value;
		return id !== null && snapshot.value !== null && hasBenchmark(snapshot.value, id) ? id : null;
	});

	const ranks = computed(() =>
		snapshot.value === null ? new Map<string, PbRank>() : pbRanks(rows.value, snapshot.value, storedPicks(picks.value), bench.value),
	);

	return { snapshot, settled, bench, ranks };
}
