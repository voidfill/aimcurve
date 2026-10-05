/**
 * The candle's statistics: per scenario,
 * the worst, p10, median and p90 of its last `W` complete runs and its
 * all-time PB, and each statistic aggregated through the tree.
 * See docs/benchmarks.md.
 *
 * Everything is in fractional rank. `fractionalRank` is monotone, so taking
 * the percentiles of scores and then ranking them is the same as the reverse.
 */
import { type CoverageMode, type ArcTree, evaluate } from './aggregate';
import type { RunStream } from './history';
import { rankScale } from './rank';

/** Below this many runs in the window, the candle has no body. */
export const BODY_MIN = 5;

export interface Spread {
	worst: number;
	p10: number;
	median: number;
	p90: number;
	pb: number;
}

export interface ScenarioSpread extends Spread {
	/** Runs in the window. */
	runs: number;
	/** Each run in the window, oldest first: the ticks drawn without a body. */
	window: number[];
	/** The last run's `started_at`, epoch ms. */
	last: number;
	/** The same statistics as scores, for the tooltip: a rank past either end of the ladder has no score. */
	scores: Spread;
}

/** Linear interpolation between closest ranks: position `(len − 1) × p` of `sorted`. */
export function percentile(sorted: readonly number[], p: number): number {
	const at = (sorted.length - 1) * p;
	const lo = Math.floor(at);
	const hi = Math.ceil(at);
	return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** The window statistics of `scores` (oldest first), the last `W` of them; null for none. */
export function windowSpread(scores: readonly number[], W: number, pb: number): (Spread & { runs: number }) | null {
	if (scores.length === 0) return null;
	const window = scores.slice(-W);
	const sorted = [...window].sort((a, b) => a - b);
	return {
		worst: sorted[0]!,
		p10: percentile(sorted, 0.1),
		median: percentile(sorted, 0.5),
		p90: percentile(sorted, 0.9),
		pb,
		runs: window.length,
	};
}

/** Each scenario's spread in `r`, from the run stream; null when unplayed. */
export function spreadPass(tree: ArcTree, stream: RunStream, W: number): (ScenarioSpread | null)[] {
	return tree.names.map((_, i) => {
		const thresholds = tree.thresholds[i] ?? null;
		const runs = stream.runsOf[i]!;
		if (thresholds === null || runs.length === 0) return null;
		const r = rankScale(thresholds);
		let pb = Number.NEGATIVE_INFINITY;
		for (const e of runs) pb = Math.max(pb, stream.score[e]!);
		const scores = runs.slice(-W).map((e) => stream.score[e]!);
		const s = windowSpread(scores, W, pb)!;
		return {
			worst: r(s.worst),
			p10: r(s.p10),
			median: r(s.median),
			p90: r(s.p90),
			pb: r(pb),
			runs: s.runs,
			window: scores.map(r),
			last: stream.t[runs[runs.length - 1]!]!,
			scores: { worst: s.worst, p10: s.p10, median: s.median, p90: s.p90, pb },
		};
	});
}

const STATS = ['worst', 'p10', 'median', 'p90', 'pb'] as const;

/**
 * Every node's spread, each statistic aggregated on its own with the tree's rules
 * and `mode`. Mean and `G` are non-decreasing in every argument, so the
 * order worst ≤ p10 ≤ median ≤ p90 ≤ PB holds at every level.
 */
export function aggregateSpread(tree: ArcTree, spreads: readonly (ScenarioSpread | null)[], mode: CoverageMode): (Spread | null)[] {
	const columns = STATS.map((stat) => evaluate(tree, spreads.map((s) => (s === null ? null : s[stat])), mode).nodes);
	return columns[0]!.map((_, node) => {
		if (columns[0]![node] === null) return null;
		return { worst: columns[0]![node]!, p10: columns[1]![node]!, median: columns[2]![node]!, p90: columns[3]![node]!, pb: columns[4]![node]! };
	});
}
