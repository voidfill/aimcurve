/**
 * D4/D5: which runs compare, the exact readout, and the recent range.
 */
import type { ScoringParams } from './classify';
import { type RunCurve, uAtX } from './curve';
import { accumulatedAt } from './pace';

/** Same kind and same parameters; runs are then aligned at equal `x`. */
export function comparable(a: ScoringParams, b: ScoringParams): boolean {
	if (a.kind === 'clock' && b.kind === 'clock') return Math.abs(a.durationS - b.durationS) < 0.5;
	if (a.kind === 'race' && b.kind === 'race') {
		return (
			a.budget === b.budget &&
			a.bots === b.bots &&
			Math.abs(a.pool - b.pool) <= 1e-3 * Math.max(a.pool, b.pool)
		);
	}
	return false;
}

export interface Readout {
	/** Positive means the current run is ahead. */
	value: number;
	unit: 'points' | 'seconds';
}

/**
 * The exact cumulative comparison, current against baseline. At rest (no `x`)
 * it is the CSV score difference; at `x` it is the difference in `u` — never
 * inferred from the shaded gap between pace lines.
 *
 * @throws {Error} when the runs do not compare; their `u` share no scale.
 */
export function readout(current: RunCurve, baseline: RunCurve, x?: number): Readout {
	if (!comparable(current.params, baseline.params)) {
		throw new Error(`${current.fileStem} does not compare with ${baseline.fileStem}`);
	}
	const race = current.params.kind === 'race';
	const unit = race ? 'seconds' : 'points';
	if (x === undefined) return { value: current.score - baseline.score, unit };
	const cur = uAtX(current, x);
	const base = uAtX(baseline, x);
	return { value: race ? base - cur : cur - base, unit };
}

export interface RecentRange {
	/** The inspected run's own progress values; no grid is invented. */
	x: Float64Array;
	mean: Float64Array;
	/** NaN where fewer than two runs contribute. */
	sd: Float64Array;
	/** Runs contributing at each point. */
	count: Uint16Array;
}

/**
 * Mean ± one standard deviation of accumulated pace over `others`, evaluated
 * at `current`'s points. The inspected run and runs that do not compare with
 * it are excluded even if passed in; choosing *prior* runs is the caller's job,
 * since it needs run dates this model does not carry.
 */
export function recentRange(current: RunCurve, others: readonly RunCurve[]): RecentRange {
	const pool = others.filter(
		(other) => other.fileStem !== current.fileStem && comparable(current.params, other.params),
	);
	const n = current.x.length;
	const mean = new Float64Array(n);
	const sd = new Float64Array(n);
	const count = new Uint16Array(n);
	for (let i = 0; i < n; i++) {
		const x = current.x[i]!;
		let sum = 0;
		let sumSq = 0;
		let k = 0;
		for (const other of pool) {
			const value = accumulatedAt(other, x, uAtX(other, x));
			if (Number.isNaN(value)) continue;
			sum += value;
			sumSq += value * value;
			k++;
		}
		count[i] = k;
		mean[i] = k > 0 ? sum / k : Number.NaN;
		sd[i] = k > 1 ? Math.sqrt(Math.max(0, (sumSq - (sum * sum) / k) / (k - 1))) : Number.NaN;
	}
	return { x: current.x, mean, sd, count };
}
