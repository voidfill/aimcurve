/**
 * Each directory row's PB rank (L3 of the scenarios directory design), from
 * the same snapshot, picks and lookup as Run and the scenario page. Every row
 * is unranked-blank until the snapshot has loaded, and stays so if it fails.
 */
import { computed, shallowRef, type ComputedRef, type Ref } from 'vue';
import { candidates, pick } from '../lib/benchmarks/pick';
import { rankOf } from '../lib/benchmarks/rank';
import type { Snapshot } from '../lib/benchmarks/snapshot';
import type { DirectoryRow } from '../lib/scenario/directory';
import { loadSnapshot, storedPicks, usePicks } from './useBenchmarkRank';

export interface PbRank {
	/** The rank index; −1 below the first threshold. */
	k: number;
	name: string;
	color: string | null;
}

/** Hash → the PB's rank; absent without a picked benchmark or a PB. */
export function usePbRanks(rows: Ref<readonly DirectoryRow[]>): ComputedRef<Map<string, PbRank>> {
	const snapshot = shallowRef<Snapshot | null>(null);
	const picks = usePicks();

	loadSnapshot().then(
		(loaded) => (snapshot.value = loaded),
		(err: unknown) => console.error('The benchmark snapshot could not be loaded', err),
	);

	return computed(() => {
		const ranks = new Map<string, PbRank>();
		const snap = snapshot.value;
		if (snap === null) return ranks;
		const stored = storedPicks(picks.value);
		for (const row of rows.value) {
			if (row.pb === null) continue;
			const id = stored[row.name.trim()];
			const c = pick(candidates(snap, row.name), typeof id === 'number' || id === null ? id : undefined);
			if (c === null) continue;
			const { k } = rankOf(c.thresholds, row.pb);
			const rank = c.benchmark.ranks[k];
			ranks.set(row.hash, k < 0 || rank === undefined ? { k: -1, name: 'Unranked', color: null } : { k, name: rank.name, color: rank.color });
		}
		return ranks;
	});
}
