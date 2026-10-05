// @vitest-environment happy-dom
/**
 * The sheet's load-bearing behaviour (P9 of the benchmarks page design):
 * which rows fold open, and that an open chart survives unrelated changes.
 * How rows look is checked by eye, not here. The chart is stubbed: uPlot
 * needs a real canvas.
 */
import { describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, reactive } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { BenchmarkRow } from '../composables/useBenchmarkPage';
import type { RowChart } from '../lib/energy/chart';
import BenchmarkTable from './BenchmarkTable.vue';

vi.mock('./ProgressChart.vue', () => ({
	default: defineComponent({ name: 'ProgressChart', setup: () => () => h('div', { 'data-stub': 'chart' }) }),
}));

const ranks = [
	{ name: 'Platinum', color: '#2FCFC2' },
	{ name: 'Nova', color: '#7900FF' },
];

function row(over: Partial<BenchmarkRow>): BenchmarkRow {
	return {
		key: 'x',
		level: 'scenario',
		name: 'X',
		node: null,
		scenario: 0,
		state: 'played',
		spread: { worst: 0.5, p10: 0.8, median: 1.2, p90: 1.6, pb: 2.4 },
		body: true,
		ticks: [],
		stale: null,
		hash: 'h',
		color: '#CC0000',
		parents: ['overall', 'c0'],
		facts: null,
		played: null,
		...over,
	};
}

const rows = [
	row({ key: 'overall', level: 'overall', name: 'Overall', node: 0, scenario: null, hash: null, color: null, parents: [] }),
	row({ key: 'c0', level: 'category', name: 'Clicking', node: 1, scenario: null, hash: null, parents: ['overall'] }),
	row({ key: 's0.0', name: 'Pasu' }),
	row({ key: 's0.1', name: 'Popcorn', state: 'unplayed', spread: null, body: false, hash: null }),
];

const chart = () => ({ x: [1], y: [null], runIds: null }) as unknown as RowChart;

function router() {
	return createRouter({
		history: createMemoryHistory(),
		routes: [
			{ path: '/', component: { render: () => null } },
			{ path: '/scenario/:hash', name: 'scenario', component: { render: () => null } },
		],
	});
}

describe('BenchmarkTable', () => {
	it('draws every row, a chart under each open one, and asks to toggle a clicked row', async () => {
		const toggled: string[] = [];
		const el = document.createElement('div');
		const app = createApp({
			render: () =>
				h(BenchmarkTable, {
					rows,
					ranks,
					open: new Set(['overall']),
					chartFor: chart,
					dateAxis: false,
					runWindow: 20,
					benchmarkId: 458,
					onToggle: (key: string) => toggled.push(key),
				}),
		});
		app.use(router()).mount(el);
		await nextTick();
		const drawn = el.querySelectorAll<HTMLElement>('[data-row]');
		expect([...drawn].map((r) => r.dataset.row)).toEqual(rows.map((r) => r.key));
		expect(el.querySelectorAll('[data-stub="chart"]')).toHaveLength(1);
		expect(el.querySelector('[data-row="overall"] [aria-expanded]')!.getAttribute('aria-expanded')).toBe('true');
		drawn[2]!.click();
		expect(toggled).toEqual(['s0.0']);
	});

	it('keeps an open chart when the rows change but its row does not', async () => {
		const chartFor = vi.fn(chart);
		const state = reactive({ rows, open: new Set(['overall']), runWindow: 20 });
		const app = createApp({
			render: () => h(BenchmarkTable, { ...state, ranks, chartFor, dateAxis: false, benchmarkId: 458 }),
		});
		app.use(router()).mount(document.createElement('div'));
		await nextTick();
		expect(chartFor).toHaveBeenCalledTimes(1);
		state.rows = rows.map((r) => ({ ...r }));
		state.runWindow = 10;
		await nextTick();
		expect(chartFor).toHaveBeenCalledTimes(1);
		state.open = new Set(['overall', 's0.0']);
		await nextTick();
		expect(chartFor).toHaveBeenCalledTimes(2);
	});
});
