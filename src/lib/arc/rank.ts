/**
 * A score's fractional rank on its ladder (E2 of the custom energy design).
 * See docs/superpowers/specs/2026-10-04-custom-energy-design.md.
 *
 * The ladder `t₁ … tₙ` is extended by one step at each end, so a difficulty
 * with `n` ranks spans `r ∈ [0, n + 1]`: `[0, 1)` is the step below rank 1,
 * `[n, n + 1]` the top rank and its overflow. Custom energy is `100 r`.
 */

/** The first non-zero step from either end; a single rank steps by a tenth of its threshold. */
function steps(t: readonly number[]): { low: number; high: number } {
	const single = t.length === 1 || t[0] === t[t.length - 1];
	if (single) {
		const step = t[0] === 0 ? 1 : 0.1 * Math.abs(t[0]!);
		return { low: step, high: step };
	}
	let low = 0;
	for (let i = 1; i < t.length && low === 0; i++) low = t[i]! - t[i - 1]!;
	let high = 0;
	for (let i = t.length - 1; i > 0 && high === 0; i--) high = t[i]! - t[i - 1]!;
	return { low, high };
}

/**
 * `r` for `score` on the ladder `thresholds` (non-decreasing, at least one).
 * A tied step is jumped, never divided by, and reaches the higher tied rank.
 */
export function fractionalRank(thresholds: readonly number[], score: number): number {
	const { low, high } = steps(thresholds);
	return rankOn(thresholds, thresholds[0]! - low, thresholds[thresholds.length - 1]! + high, score);
}

function rankOn(thresholds: readonly number[], t0: number, top: number, score: number): number {
	const n = thresholds.length;
	if (score < t0) return 0;
	if (score >= top) return n + 1;
	// The largest i in 0..n with tᵢ ≤ score; t₀ ≤ score holds here.
	let i = 0;
	while (i < n && thresholds[i]! <= score) i++;
	const lo = i === 0 ? t0 : thresholds[i - 1]!;
	const hi = i === n ? top : thresholds[i]!;
	return i + (score - lo) / (hi - lo);
}

/** A fractional-rank function for one ladder, with its extended ends worked out once. */
export function rankScale(thresholds: readonly number[]): (score: number) => number {
	const t = [...thresholds];
	const { low, high } = steps(t);
	const t0 = t[0]! - low;
	const top = t[t.length - 1]! + high;
	return (score) => rankOn(t, t0, top, score);
}
