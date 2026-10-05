/**
 * A fractional rank named on the difficulty's ladder (E5 of the custom energy
 * design): Unranked below rank 1, then the rank reached with its progress to
 * the next, and at the top the overflow.
 */
import type { RankStep } from '../benchmarks/snapshot';

export interface RankName {
	/** 0 is Unranked, else the rank reached, from 1. */
	k: number;
	name: string;
	/** The rank's colour; null for Unranked. */
	color: string | null;
	/** Progress toward the next rank in [0, 1); at the top, the overflow in [0, 1]. */
	progress: number;
	/** The next rank's name; null at the top. */
	next: string | null;
}

export function rankName(r: number, ranks: readonly RankStep[]): RankName {
	const n = ranks.length;
	const clamped = Math.min(Math.max(r, 0), n + 1);
	const k = Math.min(Math.floor(clamped), n);
	const progress = clamped - k;
	if (k === 0) return { k, name: 'Unranked', color: null, progress, next: ranks[0]?.name ?? null };
	return { k, name: ranks[k - 1]!.name, color: ranks[k - 1]!.color, progress, next: ranks[k]?.name ?? null };
}

/** `Gold, 60 % to Platinum`, `Unranked, 40 % to Iron` or `Master +0.4`. */
export function describeRank(r: number, ranks: readonly RankStep[]): string {
	const name = rankName(r, ranks);
	if (name.next === null) return `${name.name} +${name.progress.toFixed(1)}`;
	return `${name.name}, ${Math.floor(name.progress * 100)} % to ${name.next}`;
}

/** Custom energy, whole: `100 r`. */
export function energyText(r: number): string {
	return String(Math.round(100 * r));
}
