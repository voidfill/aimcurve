/**
 * D4: every run reduces to a progress/spend pair `(x, u)`.
 *
 *   clock  x = min(1, t / T)  u = running score
 *   race   x = damage / pool  u = seconds spent
 */
import { classify, killTimes, type ScoringInput, type ScoringParams } from './classify';

export interface RunCurve {
	params: Exclude<ScoringParams, { kind: 'unsupported' }>;
	fileStem: string;
	/** Seconds since challenge start, ascending; starts at 0. */
	t: Float64Array;
	/** Progress, 0 → 1, non-decreasing. */
	x: Float64Array;
	/** Clock: running score. Race: seconds spent. */
	u: Float64Array;
	/** The CSV score, the authoritative endpoint. */
	score: number;
}

/**
 * A completed clock run ran for its whole duration, even when its last tick is
 * stamped up to a second early, so the curve closes at `(T, 1, final score)`.
 * Without that point the endpoint would over-project by `T / last tick`.
 */
function clockCurve(input: ScoringInput, durationS: number) {
	const ticks = input.t.length;
	const short = input.t[ticks - 1]! < durationS;
	const n = ticks + 1 + (short ? 1 : 0);
	const t = new Float64Array(n);
	const x = new Float64Array(n);
	const u = new Float64Array(n);
	for (let i = 1; i <= ticks; i++) {
		t[i] = input.t[i - 1]!;
		x[i] = Math.min(1, t[i]! / durationS);
		u[i] = u[i - 1]! + (input.scoreTicks![i - 1] ?? 0);
	}
	if (short) {
		t[n - 1] = durationS;
		x[n - 1] = 1;
		u[n - 1] = u[n - 2]!;
	}
	return { t, x, u };
}

/**
 * Tick samples of cumulative damage, merged with the exact kill knots
 * `(t_k, k / N)` from the millisecond kill table. The kill table is
 * authoritative: per-tick damage often reaches `k / N` a little before kill k
 * is logged (up to ~0.23 s), and float sums can overshoot the pool. So a tick
 * is held between the previous point and the next knot, and a tick that has
 * already reached the next knot adds nothing and is dropped. The run ends at
 * the last kill, so later ticks are dropped too.
 */
function raceCurve(input: ScoringInput, pool: number) {
	const kills = killTimes(input)!;
	const n = kills.length;
	const end = kills[n - 1]!;
	const points: { t: number; x: number }[] = [{ t: 0, x: 0 }];
	let damage = 0;
	let k = 0;
	for (let i = 0; i < input.t.length; i++) {
		const time = input.t[i]!;
		damage += input.damageTicks![i] ?? 0;
		for (; k < n && kills[k]! <= time; k++) points.push({ t: kills[k]!, x: (k + 1) / n });
		if (time >= end) break;
		const previous = points[points.length - 1]!;
		const x = Math.max(previous.x, damage / pool);
		if (previous.t !== time && x < (k + 1) / n) points.push({ t: time, x });
	}
	for (; k < n; k++) points.push({ t: kills[k]!, x: (k + 1) / n });

	const t = Float64Array.from(points, (p) => p.t);
	return { t, x: Float64Array.from(points, (p) => p.x), u: t.slice() };
}

/** `null` for an unsupported run: it gets no pace lines. */
export function buildCurve(input: ScoringInput): RunCurve | null {
	const params = classify(input);
	if (params.kind === 'unsupported') return null;
	const arrays = params.kind === 'clock' ? clockCurve(input, params.durationS) : raceCurve(input, params.pool);
	return { params, fileStem: input.fileStem, score: input.score, ...arrays };
}

/** First index whose value is `>= target`, or `values.length`. */
function lowerBound(values: Float64Array, target: number): number {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (values[mid]! < target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function lerp(from: Float64Array, to: Float64Array, i: number, target: number): number {
	const f0 = from[i - 1]!;
	return to[i - 1]! + ((to[i]! - to[i - 1]!) * (target - f0)) / (from[i]! - f0);
}

/**
 * `u` where the run first reached progress `x`. On a race that is the time the
 * pool fraction was first reached, so a flat respawn gap resolves to its start.
 */
export function uAtX(curve: RunCurve, x: number): number {
	return atX(curve, x).u;
}

/** `(t, u)` where the run first reached progress `x`. */
export function atX(curve: RunCurve, x: number): { t: number; u: number } {
	const i = lowerBound(curve.x, x);
	if (i === 0) return { t: curve.t[0]!, u: curve.u[0]! };
	if (i === curve.x.length) return { t: curve.t[curve.t.length - 1]!, u: curve.u[curve.u.length - 1]! };
	return { t: lerp(curve.x, curve.t, i, x), u: lerp(curve.x, curve.u, i, x) };
}

/** `(x, u)` at time `time`, linear between points. */
export function atTime(curve: RunCurve, time: number): { x: number; u: number } {
	const i = lowerBound(curve.t, time);
	if (i === 0) return { x: curve.x[0]!, u: curve.u[0]! };
	if (i === curve.t.length) return { x: curve.x[curve.x.length - 1]!, u: curve.u[curve.u.length - 1]! };
	return { x: lerp(curve.t, curve.x, i, time), u: lerp(curve.t, curve.u, i, time) };
}
