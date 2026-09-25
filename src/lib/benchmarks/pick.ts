/**
 * Which benchmarks a scenario is in, and which one is shown (B3, B4 of the
 * benchmark ranks design).
 */
import type { Snapshot, SnapshotBenchmark } from './snapshot';

export interface Candidate {
	benchmark: SnapshotBenchmark;
	thresholds: number[];
	/** The first candidate: the one shown without a stored pick. */
	isDefault: boolean;
}

/** The benchmarks containing the scenario, default first; the name is trimmed and matched exactly. */
export function candidates(snapshot: Snapshot, name: string): Candidate[] {
	const list = Object.hasOwn(snapshot.scenarios, name.trim()) ? snapshot.scenarios[name.trim()]! : [];
	return list.map(([index, thresholds], i) => ({
		benchmark: snapshot.benchmarks[index]!,
		thresholds,
		isDefault: i === 0,
	}));
}

/**
 * The stored pick when it still contains the scenario, else the default. A
 * stored `null` is an explicit choice of no benchmark. Null without candidates.
 */
export function pick(list: readonly Candidate[], storedId: number | null | undefined): Candidate | null {
	if (storedId === null) return null;
	if (storedId !== undefined) {
		const stored = list.find((c) => c.benchmark.id === storedId);
		if (stored) return stored;
	}
	return list[0] ?? null;
}
