/**
 * The lane's rank axis (P4 of the benchmarks page design): `n + 1` equal
 * columns, Unranked first, the top rank's column holding its overflow.
 * See docs/superpowers/specs/2026-10-05-benchmarks-page-design.md.
 */
import { chartColor, luminance, rgb } from '../benchmarks/format';
import type { RankStep } from '../benchmarks/snapshot';

/** Unranked's colour, on the lane and in the pills (P6). */
export const UNRANKED = '#8b9299';

export interface LaneColumn {
	/** The rank's name, or Unranked. */
	name: string;
	/** The rank's own colour, or the neutral one. */
	color: string;
	/** The column's left and right edges, as fractions of the lane. */
	from: number;
	to: number;
}

export function laneColumns(ranks: readonly RankStep[]): LaneColumn[] {
	const width = 1 / (ranks.length + 1);
	return [{ name: 'Unranked', color: UNRANKED }, ...ranks].map((rank, i) => ({
		name: rank.name,
		color: rank.color,
		from: i * width,
		to: (i + 1) * width,
	}));
}

/** Where `r` sits on the lane, as a fraction; clamped to `[0, n + 1]`. */
export function lanePosition(r: number, n: number): number {
	return Math.min(Math.max(r, 0), n + 1) / (n + 1);
}

/** The colour of the rank `r` reaches: its own, or neutral below rank 1. */
export function rankColorAt(r: number, ranks: readonly RankStep[]): string {
	const k = Math.min(Math.floor(Math.max(r, 0)), ranks.length);
	return k === 0 ? UNRANKED : ranks[k - 1]!.color;
}

/** `rankColorAt`, readable on the dark lane (P6). */
export function laneColorAt(r: number, ranks: readonly RankStep[]): string {
	return chartColor(rankColorAt(r, ranks));
}

export interface GradientStop {
	/** Fraction of the lane. */
	offset: number;
	color: string;
}

/**
 * The lane-wide gradient a candle is painted with: each column in its rank's
 * lane colour, blending into the next across `blend` of a column either side
 * of the boundary. Any part of the candle so takes the colour of the rank
 * under it, and a body spanning ranks shows each of them.
 */
export function laneGradient(ranks: readonly RankStep[], blend = 0.18): GradientStop[] {
	const columns = laneColumns(ranks);
	const width = 1 / columns.length;
	const stops: GradientStop[] = [];
	columns.forEach((c, i) => {
		const color = chartColor(c.color);
		stops.push({ offset: i === 0 ? 0 : c.from + blend * width, color });
		stops.push({ offset: i === columns.length - 1 ? 1 : c.to - blend * width, color });
	});
	return stops;
}

/**
 * How strongly a lane's rank box is tinted (P7): light colours fainter, dark
 * and saturated ones stronger, so every column reads about as strong.
 */
export function bandOpacity(color: string): number {
	const c = rgb(color);
	return c === null ? 0.14 : 0.18 - 0.07 * luminance(c);
}
