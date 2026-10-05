import { describe, expect, it, vi } from 'vitest';
import { createApp, effectScope, nextTick, ref, shallowRef } from 'vue';
import { smallSnapshot } from '../../test/helpers/arc';
import type { DataSource } from '../lib/data-source';
import type { CoverageMode } from '../lib/arc/aggregate';
import type { StreamRows } from '../lib/arc/history';
import { type BenchmarkPageOptions, indexFamilies, useBenchmarkIndex, STALE_MS, useBenchmarkPage } from './useBenchmarkPage';
import { SOURCE_KEY } from './useSource';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 5);

interface Run {
	scenario: number;
	score: number;
	at: number;
}

/** A source over scenario ids 1 (A), 2 (B), 3 (B, second hash) and 4 (C). */
function source(runs: Run[]): DataSource {
	const scenarios = [
		{ id: 1, name: 'A', hash: 'a' },
		{ id: 2, name: 'B', hash: 'b1' },
		{ id: 3, name: 'B', hash: 'b2' },
		{ id: 4, name: 'C', hash: 'c' },
		{ id: 5, name: 'Unrated', hash: 'u' },
	];
	return {
		listArcRuns: async (): Promise<StreamRows> => {
			const sorted = [...runs].sort((p, q) => p.at - q.at);
			return {
				scenarios,
				scenarioId: Int32Array.from(sorted.map((r) => r.scenario)),
				runId: Int32Array.from(sorted.map((_, i) => i + 1)),
				t: Float64Array.from(sorted.map((r) => r.at)),
				score: Float64Array.from(sorted.map((r) => r.score)),
			};
		},
		getRunLink: async () => null,
	} as unknown as DataSource;
}

function mount(id: number, data: Run[], options: Partial<BenchmarkPageOptions> = {}) {
	const app = createApp({});
	const revision = ref(0);
	const runs = [...data];
	app.provide(SOURCE_KEY, { source: shallowRef(source(runs)), revision });
	const settings = {
		runWindow: ref(20),
		mode: ref<CoverageMode>('provisional'),
	};
	const idRef = ref(id);
	const api = app.runWithContext(() =>
		effectScope().run(() => useBenchmarkPage(idRef, { load: async () => smallSnapshot(), now: () => NOW, ...settings, ...options }))!,
	);
	return { api, runs, revision, settings, id: idRef };
}

const played = [
	...[110, 120, 130, 140, 150, 160].map((score, i) => ({ scenario: 1, score, at: NOW - (40 - i) * DAY })),
	{ scenario: 2, score: 250, at: NOW - 3 * DAY },
	{ scenario: 3, score: 260, at: NOW - 2 * DAY },
];

describe('row model', () => {
	it('lists the tree in order with its levels, unplayed and unrated rows', async () => {
		const { api } = mount(458, played);
		await vi.waitFor(() => expect(api.state.value).toBe('ready'));
		expect(api.rows.value.map((r) => [r.level, r.name, r.state])).toEqual([
			['overall', 'Overall', 'played'],
			['category', 'Clicking', 'played'],
			['subcategory', 'Dynamic', 'played'],
			['scenario', 'A', 'played'],
			['scenario', 'B', 'played'],
			['subcategory', 'Static', 'unplayed'],
			['scenario', 'C', 'unplayed'],
			['category', 'Tracking', 'played'],
			['subcategory', 'Precise', 'unplayed'],
			['scenario', 'D', 'unplayed'],
			['scenario', 'Unrated', 'unrated'],
			['subcategory', 'Dynamic', 'played'],
			['scenario', 'B', 'played'],
		]);
		expect(new Set(api.rows.value.map((r) => r.key)).size).toBe(api.rows.value.length);
		expect(api.coverage.value?.scenarios).toEqual([2, 4]);
	});

	it('links each row to its parents and its category colour', async () => {
		const { api } = mount(458, played);
		await vi.waitFor(() => expect(api.state.value).toBe('ready'));
		const by = new Map(api.rows.value.map((r) => [r.key, r]));
		expect(by.get('s0.0')!.parents).toEqual(['overall', 'c0', 's0']);
		expect(by.get('s0')!.parents).toEqual(['overall', 'c0']);
		expect(by.get('c0')!.color).toBe('#c00');
		expect(by.get('overall')!.color).toBeNull();
	});

	it('counts an unrated scenario as played, though it has no arc', async () => {
		const { api } = mount(458, [...played, { scenario: 5, score: 7, at: NOW - DAY }]);
		await vi.waitFor(() => expect(api.state.value).toBe('ready'));
		const unrated = api.rows.value.find((r) => r.name === 'Unrated')!;
		expect(unrated.state).toBe('unrated');
		expect(unrated.facts).toMatchObject({ runs: 1, pb: 7 });
		expect(unrated.hash).toBe('u');
		expect(unrated.spread).toBeNull();
	});

	it('gives an unnamed subcategory no row, but keeps its scenarios', async () => {
		const snapshot = smallSnapshot();
		snapshot.benchmarks[1]!.tree![0]!.subs[1]!.name = '';
		const { api } = mount(458, played, { load: async () => snapshot });
		await vi.waitFor(() => expect(api.state.value).toBe('ready'));
		const names = api.rows.value.map((r) => r.name);
		expect(names).not.toContain('');
		expect(names.slice(0, 6)).toEqual(['Overall', 'Clicking', 'Dynamic', 'A', 'B', 'C']);
	});

	it('draws a body from 5 runs, ticks below, and links the hash with the most runs', async () => {
		const { api } = mount(458, played);
		await vi.waitFor(() => expect(api.state.value).toBe('ready'));
		const [a, b] = api.rows.value.filter((r) => r.level === 'scenario');
		expect(a!.body).toBe(true);
		expect(b!.body).toBe(false);
		expect(b!.ticks).toHaveLength(2);
		expect(a!.hash).toBe('a');
	});

	it('counts the unplayed as 0 in strict mode', async () => {
		const { api, settings } = mount(458, played);
		await vi.waitFor(() => expect(api.state.value).toBe('ready'));
		const provisional = api.rows.value[0]!.spread!.pb;
		settings.mode.value = 'strict';
		await nextTick();
		expect(api.rows.value[0]!.spread!.pb).toBeLessThan(provisional);
		expect(api.rows.value.find((r) => r.name === 'Static')!.state).toBe('played');
	});

	it('changing the run window changes the candle and median, not the PB', async () => {
		const { api, settings } = mount(458, played);
		await vi.waitFor(() => expect(api.state.value).toBe('ready'));
		const before = api.rows.value[3]!.spread!;
		settings.runWindow.value = 10;
		await nextTick();
		expect(api.rows.value[3]!.spread).toEqual(before);
		settings.runWindow.value = 2 as never;
		await nextTick();
		const after = api.rows.value[3]!.spread!;
		expect(after.pb).toBe(before.pb);
		expect(after.median).toBeGreaterThan(before.median);
	});

	it('picks up a newly ingested run and the aggregates above it', async () => {
		const { api, runs, revision } = mount(458, played);
		await vi.waitFor(() => expect(api.state.value).toBe('ready'));
		const before = api.rows.value[0]!.spread!.pb;
		runs.push({ scenario: 4, score: 390, at: NOW - DAY });
		revision.value++;
		await vi.waitFor(() => expect(api.rows.value.find((r) => r.name === 'C')!.state).toBe('played'));
		expect(api.state.value).toBe('ready');
		expect(api.rows.value[0]!.spread!.pb).toBeGreaterThan(before);
	});
});

describe('stale', () => {
	it('marks a scenario at 31 days, not at 30, and never an aggregate', async () => {
		const at = (days: number) => [{ scenario: 1, score: 150, at: NOW - days * DAY }];
		const fresh = mount(458, at(30)).api;
		const old = mount(458, at(31)).api;
		await vi.waitFor(() => expect(old.state.value).toBe('ready'));
		await vi.waitFor(() => expect(fresh.state.value).toBe('ready'));
		expect(fresh.rows.value[3]!.stale).toBeNull();
		expect(old.rows.value[3]!.stale).toBe('31 d ago');
		expect(old.rows.value.filter((r) => r.level !== 'scenario').every((r) => r.stale === null)).toBe(true);
		expect(STALE_MS).toBe(30 * DAY);
	});
});

describe('difficulty route', () => {
	it('an unknown id or a difficulty without a tree is missing', async () => {
		for (const id of [999, 1]) {
			const { api } = mount(id, played);
			await vi.waitFor(() => expect(api.state.value).toBe('missing'));
			expect(api.tree.value).toBeNull();
		}
	});

	it('the difficulty control lists only that family', async () => {
		const snapshot = smallSnapshot();
		snapshot.benchmarks.push({ ...snapshot.benchmarks[1]!, id: 459, difficulty: 'Novice' });
		const { api } = mount(458, played, { load: async () => snapshot });
		await vi.waitFor(() => expect(api.state.value).toBe('ready'));
		expect(api.family.value.map((b) => b.id)).toEqual([458, 459]);
	});
});

describe('recovery', () => {
	it('retries a failed snapshot load', async () => {
		let fail = true;
		const load = async () => {
			if (fail) throw new Error('offline');
			return smallSnapshot();
		};
		const { api } = mount(458, played, { load });
		await vi.waitFor(() => expect(api.state.value).toBe('error'));
		fail = false;
		api.retry();
		await vi.waitFor(() => expect(api.state.value).toBe('ready'));
	});

	it('clears an index error once a later read succeeds', async () => {
		let fail = true;
		const app = createApp({});
		const revision = ref(0);
		const src = {
			listPlayedNames: async () => {
				if (fail) throw new Error('busy');
				return new Set(['A']);
			},
		} as unknown as DataSource;
		app.provide(SOURCE_KEY, { source: shallowRef(src), revision });
		const index = app.runWithContext(() => effectScope().run(() => useBenchmarkIndex(async () => smallSnapshot()))!);
		await vi.waitFor(() => expect(index.error.value).toBe('busy'));
		fail = false;
		revision.value++;
		await vi.waitFor(() => expect(index.error.value).toBeNull());
		expect(index.families.value![0]!.difficulties[0]!.played).toBe(1);
	});
});

describe('index', () => {
	it('lists families and difficulties in snapshot order with played counts, leaving out treeless ones', () => {
		const snapshot = smallSnapshot();
		snapshot.benchmarks.push({ ...snapshot.benchmarks[1]!, id: 459, difficulty: 'Novice' });
		// The same ladders on the second difficulty.
		for (const list of Object.values(snapshot.scenarios)) {
			const own = list.find(([i]) => i === 1);
			if (own) list.push([2, own[1]]);
		}
		const families = indexFamilies(snapshot, new Set(['A', 'Unrated', 'Elsewhere']));
		expect(families.map((f) => [f.name, f.difficulties.map((d) => [d.benchmark.id, d.played, d.total])])).toEqual([
			['Voltaic S5', [[458, 1, 4], [459, 1, 4]]],
		]);
		expect(indexFamilies(snapshot, new Set())[0]!.difficulties[0]!.played).toBe(0);
	});
});
