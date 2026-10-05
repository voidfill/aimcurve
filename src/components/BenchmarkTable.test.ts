// @vitest-environment happy-dom
/**
 * The sheet's rows as drawn (P3, P6–P9 of the benchmarks page design). The
 * chart is stubbed: uPlot needs a real canvas.
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
		...over,
	};
}

const rows = [
	row({ key: 'overall', level: 'overall', name: 'Overall', node: 0, scenario: null, hash: null, color: null, parents: [] }),
	row({ key: 'c0', level: 'category', name: 'Clicking', node: 1, scenario: null, hash: null, parents: ['overall'] }),
	row({ key: 's0.0', name: 'Pasu', stale: '4 mo ago' }),
	row({ key: 's0.1', name: 'Popcorn', state: 'unplayed', spread: null, body: false, hash: null }),
];

async function mount(open: Set<string>, chartFor: () => RowChart = () => ({ x: [1], y: [null], runIds: null }) as unknown as RowChart) {
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [
			{ path: '/', component: { render: () => null } },
			{ path: '/scenario/:hash', name: 'scenario', component: { render: () => null } },
		],
	});
	const toggled: string[] = [];
	const el = document.createElement('div');
	document.body.append(el);
	const app = createApp({
		render: () =>
			h(BenchmarkTable, {
				rows,
				ranks,
				open,
				chartFor,
				dateAxis: false,
				runWindow: 20,
				onToggle: (key: string) => toggled.push(key),
			}),
	});
	app.use(router);
	app.mount(el);
	await router.isReady();
	await nextTick();
	return { el, toggled };
}

describe('BenchmarkTable', () => {
	it('folds open the charts asked for, with a labelled chevron', async () => {
		const { el, toggled } = await mount(new Set(['overall']));
		expect(el.querySelectorAll('[data-stub="chart"]')).toHaveLength(1);
		const chevrons = [...el.querySelectorAll<HTMLButtonElement>('button.chevron')];
		expect(chevrons[0]!.getAttribute('aria-expanded')).toBe('true');
		expect(chevrons[0]!.getAttribute('aria-label')).toBe('Hide Overall');
		expect(chevrons[2]!.getAttribute('aria-label')).toBe('Show Pasu');
		chevrons[2]!.click();
		el.querySelectorAll<HTMLElement>('[role="row"].row')[2]!.click();
		expect(toggled).toEqual(['s0.0', 's0.0']);
	});

	it('keeps an open chart when the rows change but its row does not', async () => {
		const chartFor = vi.fn(() => ({ x: [1], y: [null], runIds: null }) as unknown as RowChart);
		const state = reactive({ rows, open: new Set(['overall']), runWindow: 20 });
		const el = document.createElement('div');
		const app = createApp({
			render: () => h(BenchmarkTable, { ...state, ranks, chartFor, dateAxis: false }),
		});
		app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }, { path: '/scenario/:hash', name: 'scenario', component: { render: () => null } }] }));
		app.mount(el);
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

	it('fades a stale candle and median, never its PB, and marks only that scenario', async () => {
		const { el } = await mount(new Set());
		const lines = el.querySelectorAll<HTMLElement>('[role="row"].row');
		const pasu = lines[2]!;
		expect(pasu.querySelector('.age')!.textContent).toBe('4 mo ago');
		expect(pasu.querySelector('svg g:not(.parts)')!.getAttribute('opacity')).toBe('0.5');
		const [pb, median] = [...pasu.querySelectorAll<HTMLElement>('[role="cell"]')].slice(1);
		expect(pb!.classList.contains('dim')).toBe(false);
		expect(median!.classList.contains('dim')).toBe(true);
		expect(lines[0]!.querySelector('.age')).toBeNull();
	});

	it('says not played with empty pills', async () => {
		const { el } = await mount(new Set());
		const popcorn = el.querySelectorAll<HTMLElement>('[role="row"].row')[3]!;
		expect(popcorn.querySelector('.empty')!.textContent).toBe('not played');
		expect([...popcorn.querySelectorAll('.pill')].map((p) => p.textContent)).toEqual(['—', '—']);
	});

	it('paints the candle with its lane’s rank gradient and the hatch per column', async () => {
		const { el } = await mount(new Set());
		const lane = el.querySelectorAll('[role="row"].row')[2]!;
		const gradient = lane.querySelector('linearGradient')!;
		expect(gradient.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
		expect(gradient.querySelectorAll('stop')).toHaveLength(6);
		expect(el.querySelectorAll('pattern')).toHaveLength(3);
		const body = lane.querySelector('rect[rx="3"]')!;
		expect(body.getAttribute('fill')).toBe(`url(#${gradient.id})`);
	});
});
