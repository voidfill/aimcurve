/**
 * A PB or median pill (P8 of the benchmarks page design): the rank name on
 * the left, progress on the right, filled toward the next rank.
 * See docs/superpowers/specs/2026-10-05-benchmarks-page-design.md.
 */
import { chartColor, inkFor } from '../benchmarks/format';
import type { RankStep } from '../benchmarks/snapshot';
import { UNRANKED } from './axis';
import { rankName } from './name';

export interface Pill {
	name: string;
	/** `62%`, or the overflow at the top rank: `+29`. */
	text: string;
	/** The filled share, 0 to 1. */
	fill: number;
	/** The fill: the rank colour as is. */
	color: string;
	/** Background, outline and the unfilled text: the colour made readable on the dark page. */
	tint: string;
	/** Text over the fill: black or white by contrast with it. */
	ink: string;
}

export function pill(r: number, ranks: readonly RankStep[]): Pill {
	const name = rankName(r, ranks);
	const color = name.color ?? UNRANKED;
	const percent = Math.floor(name.progress * 100);
	return {
		name: name.name,
		text: name.next === null ? `+${percent}` : `${percent}%`,
		fill: name.progress,
		color,
		tint: name.color === null ? UNRANKED : chartColor(color),
		ink: inkFor(color),
	};
}
