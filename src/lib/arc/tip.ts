/**
 * The tooltip of a Benchmarks row's candle lane: the numbers behind the candle.
 * The lane is drawn in rank; the tooltip gives a scenario's scores and the
 * score of the next rank, an aggregate's arc. Built like the
 * progress charts' tooltips, so it reads the same.
 */
import type { ProgressTip } from '../../components/ProgressChart.vue';
import type { BenchmarkRow } from '../../composables/useBenchmarkPage';
import { ageText } from '../../composables/useBenchmarkPage';
import type { RankStep } from '../benchmarks/snapshot';
import { formatScore, formatSigned } from '../run/format';
import { arcText, percentOf, rankName } from './name';

/** `Nova 78 %`, or at the top `Master 40 % over`. */
export function shortRank(r: number, ranks: readonly RankStep[]): string {
	const name = rankName(r, ranks);
	return `${name.name} ${percentOf(name.progress)} %${name.next === null ? ' over' : ''}`;
}

/** The tooltip for `row`, or null when there is nothing behind its lane. */
export function laneTip(row: BenchmarkRow, ranks: readonly RankStep[], now: number): ProgressTip | null {
	if (row.state === 'unrated') return null;
	const facts = row.facts;
	if (facts !== null) {
		if (row.state === 'unplayed') {
			if (facts.ladder === null) return null;
			return {
				head: row.name,
				sub: 'not played',
				rows: facts.ladder.map((at, k) => ({ label: ranks[k]?.name ?? `rank ${k + 1}`, value: formatScore(at) })),
			};
		}
		const spread = row.spread;
		const scores = facts.scores;
		if (spread === null || scores === null) return null;
		const at = (score: number, r: number) => `${formatScore(score)} · ${shortRank(r, ranks)}`;
		const rows: ProgressTip['rows'] = [
			{ label: 'PB', value: at(scores.pb, spread.pb), tone: 'base' },
			{ label: 'median', value: at(scores.median, spread.median), tone: 'strong' },
		];
		if (row.body) {
			rows.push({ label: 'p10 – p90', value: `${formatScore(scores.p10)} – ${formatScore(scores.p90)}` });
			rows.push({ label: 'worst', value: at(scores.worst, spread.worst) });
		}
		if (facts.next !== null) {
			rows.push({ label: 'next rank', value: `${facts.next.name} at ${formatScore(facts.next.at)}` });
			rows.push({ label: 'from PB', value: `${formatSigned(facts.next.at - scores.pb, 1)} pts` });
			rows.push({ label: 'from median', value: `${formatSigned(facts.next.at - scores.median, 1)} pts` });
		}
		if (facts.last !== null) {
			const age = now - facts.last;
			rows.push({ label: 'last played', value: age < 86_400_000 ? 'today' : ageText(age) });
		}
		rows.push({ label: 'runs', value: String(facts.runs) });
		return { head: row.name, sub: `last ${facts.window} run${facts.window === 1 ? '' : 's'}`, rows };
	}
	const spread = row.spread;
	if (spread === null) return null;
	const arc = (r: number) => `${arcText(r)} · ${shortRank(r, ranks)}`;
	const rows: ProgressTip['rows'] = [
		{ label: 'PB', value: arc(spread.pb), tone: 'base' },
		{ label: 'median', value: arc(spread.median), tone: 'strong' },
		{ label: 'p10 – p90', value: `${arcText(spread.p10)} – ${arcText(spread.p90)}` },
		{ label: 'worst', value: arc(spread.worst) },
	];
	const next = rankName(spread.pb, ranks);
	if (next.next !== null) {
		const target = next.k + 1;
		rows.push({ label: 'next rank', value: `${next.next} at ${arcText(target)}` });
		rows.push({ label: 'from PB', value: `${formatSigned(100 * (target - spread.pb))} arc` });
		rows.push({ label: 'from median', value: `${formatSigned(100 * (target - spread.median))} arc` });
	}
	if (row.played !== null) rows.push({ label: 'scenarios played', value: `${row.played[0]}/${row.played[1]}` });
	return { head: row.name, sub: 'ARC', rows };
}
