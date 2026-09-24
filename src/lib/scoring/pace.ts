/**
 * D5: one y-axis, projected final score.
 *
 * A spend rate `r = Δu / Δx` projects to the score it would produce over a full
 * run: `r` on a clock, `budget − r` on a race. Higher is better in both.
 */
import { atTime, type RunCurve } from './curve';

/** Default rolling window, seconds of the run's own clock. */
export const DEFAULT_WINDOW_S = 5;

export interface PaceLines {
	x: Float64Array;
	/** Projected final score from the run so far; NaN is a gap. */
	accumulated: Float64Array;
	/** Projected final score from the last `w` seconds; NaN is a gap. */
	local: Float64Array;
}

export function project(curve: RunCurve, rate: number): number {
	return curve.params.kind === 'race' ? curve.params.budget - rate : rate;
}

/** Accumulated pace at one point: the run so far, projected. NaN only at x = 0. */
export function accumulatedAt(curve: RunCurve, x: number, u: number): number {
	return x <= 0 ? Number.NaN : project(curve, u / x);
}

/**
 * Local pace is marginal: the window's change in `u` over its change in `x`,
 * so for multiplier scoring it includes what a miss cost earlier kills. It is
 * undefined where the window made no progress, such as a race respawn gap.
 *
 * Before a full window has been played the window is `[0, t]`, so local pace
 * equals accumulated pace until then: the only value the data supports.
 */
export function paceLines(curve: RunCurve, windowS = DEFAULT_WINDOW_S): PaceLines {
	const n = curve.x.length;
	const accumulated = new Float64Array(n);
	const local = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const t = curve.t[i]!;
		const x = curve.x[i]!;
		const u = curve.u[i]!;
		accumulated[i] = accumulatedAt(curve, x, u);
		const start = atTime(curve, Math.max(0, t - windowS));
		const dx = x - start.x;
		local[i] = dx > 0 ? project(curve, (u - start.u) / dx) : Number.NaN;
	}
	return { x: curve.x, accumulated, local };
}
