/**
 * The inspected run's benchmark rank (B8 of the benchmark ranks design).
 *
 * The snapshot is loaded on first use, as its own chunk, and the loading
 * promise is shared. Everything is null or empty until it has loaded, and stays
 * so if the import fails.
 */
import { computed, shallowRef, type ComputedRef, type Ref } from 'vue';
import { useStorage } from '@vueuse/core';
import { type Candidate, candidates as candidatesOf, pick } from '../lib/benchmarks/pick';
import { rankOf, type RankResult } from '../lib/benchmarks/rank';
import type { Snapshot } from '../lib/benchmarks/snapshot';

let shared: Promise<Snapshot> | null = null;

function loadSnapshot(): Promise<Snapshot> {
	shared ??= import('../data/benchmarks.json').then((module) => module.default as unknown as Snapshot);
	return shared;
}

export interface BenchmarkRankApi {
	/** The benchmarks containing the scenario, default first. */
	candidates: ComputedRef<Candidate[]>;
	selected: ComputedRef<Candidate | null>;
	/** The score's rank in the selected benchmark; null without a score. */
	rank: ComputedRef<RankResult | null>;
	/** Stores an explicit pick for the scenario, keyed by KovaaK's benchmark ID. */
	setPick: (benchmarkId: number) => void;
}

export interface BenchmarkRankOptions {
	load?: () => Promise<Snapshot>;
	/** Trimmed scenario name → picked KovaaK's benchmark ID. */
	picks?: Ref<Record<string, number>>;
}

export function useBenchmarkRank(
	name: Ref<string | null>,
	score: Ref<number | null>,
	options: BenchmarkRankOptions = {},
): BenchmarkRankApi {
	const snapshot = shallowRef<Snapshot | null>(null);
	const picks = options.picks ?? useStorage<Record<string, number>>('aimcurve.benchmark-pick', {}, localStorage);

	(options.load ?? loadSnapshot)().then(
		(loaded) => (snapshot.value = loaded),
		(err: unknown) => console.error('The benchmark snapshot could not be loaded', err),
	);

	const candidates = computed(() => (snapshot.value && name.value !== null ? candidatesOf(snapshot.value, name.value) : []));
	/** The stored picks, or none when storage holds something else. */
	const stored = computed(() => (typeof picks.value === 'object' && picks.value !== null ? picks.value : {}));
	const selected = computed(() => {
		if (name.value === null) return null;
		const id = stored.value[name.value.trim()];
		return pick(candidates.value, typeof id === 'number' ? id : undefined);
	});
	const rank = computed(() => {
		const s = score.value;
		const c = selected.value;
		return c === null || s === null ? null : rankOf(c.thresholds, s);
	});

	function setPick(benchmarkId: number): void {
		if (name.value === null) return;
		picks.value = { ...stored.value, [name.value.trim()]: benchmarkId };
	}

	return { candidates, selected, rank, setPick };
}
