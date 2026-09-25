/** Rank bands painted on a uPlot canvas (B7 of the benchmark ranks design), shared by every chart that shows them. */
import uPlot from 'uplot';
import { chartColor } from './format';
import type { RankStep } from './snapshot';

export interface RankLadder {
	ranks: readonly RankStep[];
	thresholds: readonly number[];
}

/**
 * Each rank's band from its threshold up to the next, open at the top, with a
 * line on each threshold and the rank's name at the right edge. Tied ranks have
 * no band, and their higher rank's name is the one labelled. Labels are drawn
 * upward and one within 12 px of the last is dropped.
 */
export function paintRanks(u: uPlot, ladder: RankLadder): void {
	const ctx = u.ctx;
	const ratio = uPlot.pxRatio;
	const { left, top, width, height } = u.bbox;
	const t = ladder.thresholds;
	const Y = (v: number) => u.valToPos(v, 'y', true);
	const size = 9.5 * ratio;
	ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
	ctx.textAlign = 'right';
	ctx.textBaseline = 'bottom';
	// Only labels that fit inside the plot are drawn, and only they block others.
	let lastLabel = top + height;
	for (let k = 0; k < t.length; k++) {
		if (t[k + 1] === t[k]) continue;
		const color = chartColor(ladder.ranks[k]?.color ?? '');
		const y0 = Y(t[k]!);
		const y1 = k + 1 < t.length ? Y(t[k + 1]!) : top;
		if (y1 < y0) {
			ctx.globalAlpha = 0.08;
			ctx.fillStyle = color;
			ctx.fillRect(left, y1, width, y0 - y1);
		}
		ctx.globalAlpha = 0.55;
		ctx.fillStyle = color;
		ctx.fillRect(left, Math.round(y0), width, ratio);
		ctx.globalAlpha = 0.9;
		const fits = y0 <= top + height && y0 - 2 * ratio - size >= top;
		if (fits && lastLabel - y0 >= 12 * ratio) {
			ctx.fillText(ladder.ranks[k]?.name ?? '', left + width - 4 * ratio, y0 - 2 * ratio);
			lastLabel = y0;
		}
	}
	ctx.globalAlpha = 1;
}
