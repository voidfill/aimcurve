/**
 * A score's rank on one ladder (B5 of the benchmark ranks design).
 *
 * `thresholds[i]` is the minimum score for rank `i`. A score on a threshold
 * reaches it, and with tied thresholds the higher of the tied ranks is reached.
 */

export interface RankResult {
	/** The rank reached, or −1 below the first threshold (unranked). */
	k: number;
	/** The first threshold strictly above the score; null at the top. */
	next: number | null;
	/** The rank `next` reaches; null at the top. */
	nextRank: number | null;
	/** `next − score`; null at the top. */
	gap: number | null;
}

/** How many thresholds are at or below `score`. */
function reached(thresholds: readonly number[], score: number): number {
	let n = 0;
	while (n < thresholds.length && thresholds[n]! <= score) n++;
	return n;
}

export function rankOf(thresholds: readonly number[], score: number): RankResult {
	const n = reached(thresholds, score);
	if (n === thresholds.length) return { k: n - 1, next: null, nextRank: null, gap: null };
	const next = thresholds[n]!;
	return { k: n - 1, next, nextRank: reached(thresholds, next) - 1, gap: next - score };
}
