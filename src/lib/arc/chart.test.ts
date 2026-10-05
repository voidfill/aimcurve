import { describe, expect, it } from 'vitest';
import { syntheticSnapshot } from '../../../test/helpers/arc';
import { chartColor } from '../benchmarks/format';
import { rollingMedian } from '../scenario/series';
import { categoryNode, arcTree } from './aggregate';
import { UNRANKED } from './axis';
import { aggregateChart, scenarioChart } from './chart';
import { historyPass, type StreamRows, toStream } from './history';

const tree = arcTree(syntheticSnapshot(), 0)!;
const DAY = 86_400_000;

/** S0 under two hashes, then S6 (another category), interleaved in time. */
const rows: StreamRows = {
	scenarios: [
		{ id: 1, name: 'S0', hash: 'old' },
		{ id: 2, name: 'S0', hash: 'new' },
		{ id: 3, name: 'S6', hash: 'six' },
	],
	scenarioId: Int32Array.from([1, 3, 2, 2, 3, 2]),
	runId: Int32Array.from([11, 12, 13, 14, 15, 16]),
	t: Float64Array.from([0, 1, 2, 3, 4, 5].map((d) => Date.UTC(2026, 0, 1) + d * DAY)),
	score: Float64Array.from([50, 150, 250, 120, 350, 450]),
};
const stream = toStream(tree, rows);

describe('scenario charts', () => {
	it('merge every hash of the name in time order', () => {
		const c = scenarioChart(tree, stream, 0, 10, false);
		expect(c.y).toEqual([50, 250, 120, 450]);
		expect(c.runIds).toEqual([11, 13, 14, 16]);
		expect(c.x).toEqual([1, 2, 3, 4]);
		expect(stream.topHash[0]).toBe('new');
	});

	it('put runs at started_at on the date axis', () => {
		const c = scenarioChart(tree, stream, 0, 10, true);
		expect(c.x[0]).toBe(rows.t[0]! / 1000);
		expect(c.x[3]).toBe(rows.t[5]! / 1000);
	});

	it('colour dots on this difficulty’s ladder, with its thresholds as bands', () => {
		const c = scenarioChart(tree, stream, 0, 10, false);
		expect(c.colors[0]).toBe(UNRANKED);
		expect(c.colors[1]).toBe(chartColor(tree.ranks[1]!.color));
		expect(c.colors[3]).toBe(chartColor(tree.ranks[3]!.color));
		expect(c.ranks.thresholds).toEqual([100, 200, 300, 400]);
	});

	it('take the median over the form window N', () => {
		for (const n of [5, 20]) expect(scenarioChart(tree, stream, 0, n, false).median).toEqual(rollingMedian([50, 250, 120, 450], n).value);
	});
});

describe('aggregate charts', () => {
	const h = historyPass(tree, stream, 10, 'provisional');

	it('count the runs inside the node on the runs axis', () => {
		expect(aggregateChart(tree, stream, h, 0, false, 'Overall').x).toEqual([1, 2, 3, 4, 5, 6]);
		expect(aggregateChart(tree, stream, h, categoryNode(0), false, 'C0').x).toEqual([1, 2, 3, 4]);
		expect(aggregateChart(tree, stream, h, categoryNode(1), false, 'C1').x).toEqual([1, 2]);
	});

	it('plot arc with bands at 100 … n × 100, and no dots', () => {
		const c = aggregateChart(tree, stream, h, 0, true, 'Overall');
		expect(c.ranks.thresholds).toEqual([100, 200, 300, 400]);
		expect(c.y.every((v) => v === null)).toBe(true);
		expect(c.medianFull.every(Boolean)).toBe(true);
		expect(c.x[1]).toBe(rows.t[1]! / 1000);
		for (let j = 1; j < c.best.length; j++) expect(c.best[j]!).toBeGreaterThanOrEqual(c.best[j - 1]!);
		expect(c.tipFor(5)!.rows.map((r) => r.label)).toContain('scenarios played');
	});
});
