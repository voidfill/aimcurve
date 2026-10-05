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
let loaded: Snapshot | null = null;

/**
 * The snapshot if it has already loaded. A component mounted after that starts
 * from it, so its first frame already has ranks instead of popping them in a
 * microtask later.
 */
export function loadedSnapshot(): Snapshot | null {
	return loaded;
}

/**
 * The snapshot, loaded once and shared by every user of it. A failed load is
 * not cached, so the next user tries again.
 */
export function loadSnapshot(): Promise<Snapshot> {
	shared ??= import('../data/benchmarks.json').then(
		(module) => (loaded = module.default as unknown as Snapshot),
		(err: unknown) => {
			shared = null;
			throw err;
		},
	);
	return shared;
}

/**
 * Trimmed scenario name → picked KovaaK's benchmark ID, or null for none. No
 * storage argument: VueUse resolves `localStorage` inside a try, where naming
 * the global here would throw outright when site data is blocked.
 */
export function usePicks(): Ref<Record<string, number | null>> {
	return useStorage<Record<string, number | null>>('aimcurve.benchmark-pick', {});
}

/** The stored picks, or none when storage holds something else. */
export function storedPicks(picks: Record<string, number | null>): Record<string, number | null> {
	return typeof picks === 'object' && picks !== null ? picks : {};
}

export interface BenchmarkRankApi {
	/** The benchmarks containing the scenario, default first. */
	candidates: ComputedRef<Candidate[]>;
	/** Null without candidates, or when none is picked. */
	selected: ComputedRef<Candidate | null>;
	/** The score's rank in the selected benchmark; null without a score. */
	rank: ComputedRef<RankResult | null>;
	/** Stores an explicit pick for the scenario: a KovaaK's benchmark ID, or null for none. */
	setPick: (benchmarkId: number | null) => void;
}

export interface BenchmarkRankOptions {
	load?: () => Promise<Snapshot>;
	/** Trimmed scenario name → picked KovaaK's benchmark ID, or null for none. */
	picks?: Ref<Record<string, number | null>>;
	/**
	 * A benchmark to show instead of the stored pick while it is a candidate,
	 * such as the one a Benchmarks page linked from. Never stored.
	 */
	preferred?: Ref<number | null>;
}

export function useBenchmarkRank(
	name: Ref<string | null>,
	score: Ref<number | null>,
	options: BenchmarkRankOptions = {},
): BenchmarkRankApi {
	const snapshot = shallowRef<Snapshot | null>(options.load ? null : loadedSnapshot());
	const picks = options.picks ?? usePicks();

	if (snapshot.value === null)
		(options.load ?? loadSnapshot)().then(
			(loaded) => (snapshot.value = loaded),
			(err: unknown) => console.error('The benchmark snapshot could not be loaded', err),
		);

	const candidates = computed(() => (snapshot.value && name.value !== null ? candidatesOf(snapshot.value, name.value) : []));
	/** The stored picks, or none when storage holds something else. */
	const stored = computed(() => storedPicks(picks.value));
	const selected = computed(() => {
		if (name.value === null) return null;
		const preferred = options.preferred?.value ?? null;
		if (preferred !== null) {
			const linked = candidates.value.find((c) => c.benchmark.id === preferred);
			if (linked) return linked;
		}
		const id = stored.value[name.value.trim()];
		return pick(candidates.value, typeof id === 'number' || id === null ? id : undefined);
	});
	const rank = computed(() => {
		const s = score.value;
		const c = selected.value;
		return c === null || s === null ? null : rankOf(c.thresholds, s);
	});

	function setPick(benchmarkId: number | null): void {
		if (name.value === null) return;
		picks.value = { ...stored.value, [name.value.trim()]: benchmarkId };
	}

	return { candidates, selected, rank, setPick };
}
