/**
 * The props `ProgressChart` draws a Benchmarks page row's history with.
 * See docs/benchmarks.md.
 *
 * A scenario row plots every complete run of every hash of its name, on this
 * difficulty's ladder. An aggregate row plots ARC: its PB and form
 * after each run inside it, over rank bands at 100, 200, … `n × 100`.
 */
import type { ProgressTip } from '../../components/ProgressChart.vue';
import { chartColor } from '../benchmarks/format';
import type { RankLadder } from '../benchmarks/paint';
import { rankOf } from '../benchmarks/rank';
import { formatScore, formatSigned, timeFormat } from '../run/format';
import { pbSteps, rollingMedian } from '../scenario/series';
import type { ArcTree } from './aggregate';
import { type History, nodeScenarios, nodeValue } from './history';
import type { RunStream } from './history';
import { UNRANKED } from './axis';
import { describeRank, arcText } from './name';
import { fractionalRank } from './rank';

export interface RowChart {
	/** Attempt numbers, or epoch seconds on the date axis. */
	x: number[];
	y: (number | null)[];
	best: (number | null)[];
	median: (number | null)[];
	medianFull: boolean[];
	colors: (string | null)[];
	ranks: RankLadder & { next: number | null };
	formatY: (v: number) => string;
	tipFor: (i: number) => ProgressTip | null;
	/** Each point's run, for opening it in Run; null on an aggregate chart. */
	runIds: number[] | null;
	label: string;
}

function xs(stream: RunStream, events: ArrayLike<number>, dateAxis: boolean): number[] {
	return Array.from(events, (e, j) => (dateAxis ? stream.t[e]! / 1000 : j + 1));
}

function when(stream: RunStream, e: number): string {
	return timeFormat.format(new Date(stream.t[e]!));
}

/** A scenario row's chart: every run of the name, coloured on this difficulty's ladder. */
export function scenarioChart(tree: ArcTree, stream: RunStream, i: number, formWindow: number, dateAxis: boolean): RowChart {
	const thresholds = tree.thresholds[i]!;
	const events = stream.runsOf[i]!;
	const y = events.map((e) => stream.score[e]!);
	const best = pbSteps(y, 'higher');
	const median = rollingMedian(y, formWindow);
	const colors = y.map((s) => {
		const k = rankOf(thresholds, s).k;
		return k < 0 ? UNRANKED : chartColor(tree.ranks[k]!.color);
	});
	return {
		x: xs(stream, events, dateAxis),
		y,
		best,
		median: median.value,
		medianFull: median.full,
		colors,
		ranks: { ranks: tree.ranks, thresholds, next: y.length === 0 ? null : rankOf(thresholds, best[best.length - 1]!).next },
		formatY: formatScore,
		tipFor: (j) => {
			const e = events[j];
			if (e === undefined) return null;
			const score = y[j]!;
			const before = j === 0 ? null : best[j - 1]!;
			const rows: ProgressTip['rows'] = [
				{ label: 'score', value: formatScore(score), tone: 'strong' },
				{ label: 'rank', value: describeRank(fractionalRank(thresholds, score), tree.ranks) },
			];
			if (before === null) rows.push({ label: 'vs PB before', value: 'first run' });
			else {
				const diff = score - before;
				rows.push({
					label: 'vs PB before',
					value: `${formatSigned(diff, 1)} pts`,
					tone: diff > 0 ? 'ahead' : diff < 0 ? 'behind' : undefined,
				});
			}
			const m = median.value[j];
			if (m != null) rows.push({ label: median.full[j] ? `form · median of last ${formWindow}` : 'form · median so far', value: formatScore(m) });
			return { head: `#${j + 1} · ${when(stream, e)}`, sub: null, rows };
		},
		runIds: events.map((e) => stream.runId[e]!),
		label: `Score of every completed run of ${tree.names[i]}`,
	};
}

/** The rank bands of ARC: rank `i` from `i × 100`. */
export function arcBands(tree: ArcTree): RankLadder & { next: null } {
	return { ranks: tree.ranks, thresholds: tree.ranks.map((_, i) => (i + 1) * 100), next: null };
}

/** An aggregate row's chart: PB and form arc after each run inside the node. */
export function aggregateChart(
	tree: ArcTree,
	stream: RunStream,
	history: History,
	node: number,
	dateAxis: boolean,
	name: string,
): RowChart {
	const { events } = history.nodes[node]!;
	const n = events.length;
	const arc = (input: 'pb' | 'form') =>
		Array.from({ length: n }, (_, j) => {
			const r = nodeValue(history, node, j, input);
			return r === null ? null : 100 * r;
		});
	const best = arc('pb');
	const form = arc('form');
	const inside = [...nodeScenarios(tree, node)];
	return {
		x: xs(stream, events, dateAxis),
		y: new Array<number | null>(n).fill(null),
		best,
		median: form,
		medianFull: new Array<boolean>(n).fill(true),
		colors: new Array<string | null>(n).fill(null),
		ranks: arcBands(tree),
		formatY: (v) => String(Math.round(v)),
		tipFor: (j) => {
			const e = events[j];
			if (e === undefined) return null;
			const rows: ProgressTip['rows'] = [];
			const pb = best[j];
			const f = form[j];
			if (pb != null) rows.push({ label: 'PB arc', value: `${arcText(pb / 100)} · ${describeRank(pb / 100, tree.ranks)}`, tone: 'base' });
			if (f != null) rows.push({ label: `form arc · last ${history.window}`, value: `${arcText(f / 100)} · ${describeRank(f / 100, tree.ranks)}`, tone: 'strong' });
			const played = inside.filter((i) => history.firstEvent[i]! >= 0 && history.firstEvent[i]! <= e).length;
			rows.push({ label: 'scenarios played', value: `${played}/${inside.length}` });
			rows.push({ label: 'this run', value: tree.names[stream.sid[e]!]! });
			return { head: `#${j + 1} · ${when(stream, e)}`, sub: history.mode, rows };
		},
		runIds: null,
		label: `ARC of ${name} after each of its runs`,
	};
}
