/**
 * R3 of the Run view design: every series on one shared x grid, for uPlot.
 * See docs/superpowers/specs/2026-09-24-run-view-design.md.
 *
 * The grid is the union of the inspected run's and the baseline's progress
 * values, plus a point every `SCRUB_STEP_S` of the run's own clock: the cursor
 * snaps to grid points, and the ~1 Hz ticks alone would only let it stop on
 * whole ticks. Each series is linearly interpolated between its own points. A gap
 * (NaN) in a source stays a gap (`null`), and nothing is extrapolated past a
 * source's ends.
 */
import { atTime, type PaceLines, type RecentRange, type RunCurve } from '../scoring';

export type Sampled = (number | null)[];

/** Sorted, de-duplicated union of progress values. */
export function unionGrid(...sources: readonly Float64Array[]): number[] {
	const all: number[] = [];
	for (const source of sources) for (const x of source) all.push(x);
	all.sort((a, b) => a - b);
	return all.filter((x, i) => i === 0 || x !== all[i - 1]);
}

/** Seconds between scrub points: the tooltip's time shows hundredths. */
export const SCRUB_STEP_S = 0.01;

/** Progress at every `SCRUB_STEP_S` of the run's clock, from 0 to its last tick. */
export function scrubGrid(curve: RunCurve): Float64Array {
	const end = curve.t[curve.t.length - 1] ?? 0;
	const perSecond = Math.round(1 / SCRUB_STEP_S);
	const steps = Math.floor(end * perSecond + 1e-9);
	const out = new Float64Array(steps + 1);
	// `k / 100` rather than `k * 0.01`, so the times land on exact hundredths.
	for (let k = 0; k <= steps; k++) out[k] = atTime(curve, k / perSecond).x;
	return out;
}

/**
 * `ys` sampled at each grid point. At an exact source point the first value
 * there is used (a run reaches that progress first there). Between points it
 * is linear, and `null` if either neighbour is a gap.
 */
export function sample(xs: Float64Array, ys: Float64Array, grid: readonly number[]): Sampled {
	const out: Sampled = new Array(grid.length);
	let i = 0;
	const n = xs.length;
	for (let g = 0; g < grid.length; g++) {
		const x = grid[g]!;
		while (i < n && xs[i]! < x) i++;
		if (i === n || (i === 0 && xs[0]! > x)) {
			out[g] = null;
			continue;
		}
		if (xs[i] === x) {
			const y = ys[i]!;
			out[g] = Number.isNaN(y) ? null : y;
			continue;
		}
		const y0 = ys[i - 1]!;
		const y1 = ys[i]!;
		if (Number.isNaN(y0) || Number.isNaN(y1)) {
			out[g] = null;
			continue;
		}
		const x0 = xs[i - 1]!;
		out[g] = y0 + ((y1 - y0) * (x - x0)) / (xs[i]! - x0);
	}
	return out;
}

export type ChartBaseline =
	| { kind: 'charted'; curve: RunCurve; pace: PaceLines }
	| { kind: 'flat'; score: number }
	| { kind: 'none' };

export interface ChartData {
	/** Progress, 0 → 1. */
	x: number[];
	/** The x axis in display units: seconds for clock, percent for race. */
	display: number[];
	/** Display units at `x = 1`: `T` seconds, or 100 %. */
	xMax: number;
	accumulated: Sampled;
	local: Sampled;
	baseAccumulated: Sampled;
	baseLocal: Sampled;
	recentMean: Sampled;
	recentLow: Sampled;
	recentHigh: Sampled;
}

/** Progress → display units for the run's axis. */
export function displayX(curve: RunCurve, x: number): number {
	return curve.params.kind === 'clock' ? x * curve.params.durationS : x * 100;
}

export function chartData(
	current: RunCurve,
	pace: PaceLines,
	baseline: ChartBaseline,
	recent: RecentRange | null,
): ChartData {
	const scrub = scrubGrid(current);
	const x =
		baseline.kind === 'charted' ? unionGrid(current.x, baseline.curve.x, scrub) : unionGrid(current.x, scrub);
	const empty = (): Sampled => new Array<number | null>(x.length).fill(null);
	let baseAccumulated = empty();
	let baseLocal = empty();
	if (baseline.kind === 'charted') {
		baseAccumulated = sample(baseline.pace.x, baseline.pace.accumulated, x);
		baseLocal = sample(baseline.pace.x, baseline.pace.local, x);
	} else if (baseline.kind === 'flat') {
		baseAccumulated = new Array<number | null>(x.length).fill(baseline.score);
	}

	let recentMean = empty();
	let recentLow = empty();
	let recentHigh = empty();
	if (recent) {
		recentMean = sample(recent.x, recent.mean, x);
		const low = recent.mean.map((m, i) => m - recent.sd[i]!);
		const high = recent.mean.map((m, i) => m + recent.sd[i]!);
		recentLow = sample(recent.x, low, x);
		recentHigh = sample(recent.x, high, x);
	}

	return {
		x,
		display: x.map((value) => displayX(current, value)),
		xMax: displayX(current, 1),
		accumulated: sample(pace.x, pace.accumulated, x),
		local: sample(pace.x, pace.local, x),
		baseAccumulated,
		baseLocal,
		recentMean,
		recentLow,
		recentHigh,
	};
}

/** A projected score as the axis shows it: seconds (`B − y`) on a race. */
export function axisValue(curve: RunCurve, y: number): number {
	return curve.params.kind === 'race' ? curve.params.budget - y : y;
}
