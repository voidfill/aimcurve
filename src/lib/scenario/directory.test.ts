import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../benchmarks/snapshot';
import {
	benchmarkOptions,
	DEFAULT_STATE,
	directoryQuery,
	directoryRows,
	type DirectoryRow,
	filterRows,
	inBenchmark,
	nextSort,
	pbRanks,
	parseDirectoryQuery,
	sortRows,
} from './directory';
import type { ScenarioSummary } from './queries';

function summary(over: Partial<ScenarioSummary>): ScenarioSummary {
	return {
		id: 1,
		name: 'A',
		hash: 'aaaaaaaaaaaa',
		runs: 1,
		pb: 100,
		lastPlayed: '2026-09-01T00:00:00.000Z',
		recent: [100],
		...over,
	};
}

describe('L2 and L4 rows', () => {
	it('tag only names shared by several versions', () => {
		const rows = directoryRows([
			summary({ id: 1, name: 'Pasu', hash: '1111111111aa' }),
			summary({ id: 2, name: 'Pasu', hash: '2222222222bb' }),
			summary({ id: 3, name: 'Ground', hash: '3333333333cc' }),
		]);
		expect(rows.map((r) => r.tag)).toEqual(['11111111', '22222222', null]);
	});

	it('take the median of the recent scores and its gap to the PB', () => {
		const [row] = directoryRows([summary({ pb: 200, recent: [180, 190, 170, 185, 175, 160, 200, 150, 190, 180] })]);
		expect(row).toMatchObject({ median: 180, full: true, gap: -0.1 });
	});

	it('mark a window under 10 runs as not full', () => {
		const [row] = directoryRows([summary({ pb: 100, recent: [100, 80] })]);
		expect(row).toMatchObject({ median: 90, full: false, gap: -0.1 });
	});

	it('leave out the gap on a zero PB, and everything without scores', () => {
		const [zero, none] = directoryRows([
			summary({ pb: 0, recent: [0, -10] }),
			summary({ id: 2, name: 'B', pb: null, recent: [] }),
		]);
		expect(zero).toMatchObject({ median: -5, gap: null });
		expect(none).toMatchObject({ median: null, full: false, gap: null });
	});

	it('measure the gap against the size of a negative PB', () => {
		const [row] = directoryRows([summary({ pb: -100, recent: [-150] })]);
		expect(row!.gap).toBeCloseTo(-0.5);
	});
});

describe('L6 search', () => {
	const rows = directoryRows([summary({ id: 1, name: 'VT Pasu Novice' }), summary({ id: 2, name: '1w4ts Ground' })]);

	it('match a trimmed, case-insensitive substring of the name', () => {
		expect(filterRows(rows, '  pasu ').map((r) => r.id)).toEqual([1]);
		expect(filterRows(rows, 'GROUND').map((r) => r.id)).toEqual([2]);
		expect(filterRows(rows, '').length).toBe(2);
		expect(filterRows(rows, 'nothing')).toEqual([]);
	});
});

describe('L6 sort', () => {
	const rows = directoryRows([
		summary({ id: 1, name: 'b', hash: 'h1', runs: 5, pb: 300, lastPlayed: '2026-09-03T00:00:00.000Z', recent: [270] }),
		summary({ id: 2, name: 'A', hash: 'h2', runs: 9, pb: null, lastPlayed: '2026-09-01T00:00:00.000Z', recent: [] }),
		summary({ id: 3, name: 'c', hash: 'h3', runs: 5, pb: 100, lastPlayed: '2026-09-02T00:00:00.000Z', recent: [99] }),
	]);
	const ranks = new Map<string, number | null>([
		['h1', 2],
		['h2', null],
		['h3', -1],
	]);
	const rankOf = (r: DirectoryRow) => ranks.get(r.hash) ?? null;
	const ids = (key: Parameters<typeof sortRows>[1], dir: 'asc' | 'desc') => sortRows(rows, key, dir, rankOf).map((r) => r.id);

	it('sort names case-insensitively', () => {
		expect(ids('name', 'asc')).toEqual([2, 1, 3]);
		expect(ids('name', 'desc')).toEqual([3, 1, 2]);
	});

	it('keep blanks last in either direction', () => {
		expect(ids('pb', 'desc')).toEqual([1, 3, 2]);
		expect(ids('pb', 'asc')).toEqual([3, 1, 2]);
		expect(ids('form', 'desc')).toEqual([3, 1, 2]);
		expect(ids('form', 'asc')).toEqual([1, 3, 2]);
	});

	it('put unranked below the lowest rank and no benchmark last', () => {
		expect(ids('rank', 'desc')).toEqual([1, 3, 2]);
		expect(ids('rank', 'asc')).toEqual([3, 1, 2]);
	});

	it('break ties by last played, newest first', () => {
		expect(ids('runs', 'desc')).toEqual([2, 1, 3]);
		expect(ids('runs', 'asc')).toEqual([1, 3, 2]);
	});

	it('sort by last played', () => {
		expect(ids('played', 'desc')).toEqual([1, 3, 2]);
		expect(ids('played', 'asc')).toEqual([2, 3, 1]);
	});

	it('start a new column in its default direction and flip the current one', () => {
		expect(nextSort(DEFAULT_STATE, 'name')).toEqual({ sort: 'name', dir: 'asc' });
		expect(nextSort(DEFAULT_STATE, 'pb')).toEqual({ sort: 'pb', dir: 'desc' });
		expect(nextSort(DEFAULT_STATE, 'played')).toEqual({ sort: 'played', dir: 'asc' });
	});
});

describe('L6 URL', () => {
	it('omit defaults', () => {
		expect(directoryQuery(DEFAULT_STATE)).toEqual({});
		expect(directoryQuery({ ...DEFAULT_STATE, q: 'pasu', sort: 'name', dir: 'asc' })).toEqual({ q: 'pasu', sort: 'name' });
		expect(directoryQuery({ ...DEFAULT_STATE, dir: 'asc' })).toEqual({ dir: 'asc' });
	});

	it('round-trip every state', () => {
		for (const state of [
			DEFAULT_STATE,
			{ q: 'a b', sort: 'rank', dir: 'asc', bench: null },
			{ q: '', sort: 'name', dir: 'desc', bench: 7 },
			{ q: 'x', sort: 'form', dir: 'desc', bench: null },
		] as const)
			expect(parseDirectoryQuery(directoryQuery(state))).toEqual(state);
	});

	it('fall back to the default on unknown values', () => {
		expect(parseDirectoryQuery({ sort: 'bogus', dir: 'sideways' })).toEqual(DEFAULT_STATE);
		expect(parseDirectoryQuery({ sort: 'name', dir: 'sideways' })).toEqual({ ...DEFAULT_STATE, sort: 'name', dir: 'asc' });
		expect(parseDirectoryQuery({ q: ['one', 'two'] })).toEqual({ ...DEFAULT_STATE, q: 'one' });
		expect(parseDirectoryQuery({ bench: 'x12' }).bench).toBeNull();
	});

	it('round-trip a benchmark', () => {
		expect(directoryQuery({ ...DEFAULT_STATE, bench: 42 })).toEqual({ bench: '42' });
		expect(parseDirectoryQuery({ bench: '42' })).toEqual({ ...DEFAULT_STATE, bench: 42 });
	});
});

describe('L8 benchmark select', () => {
	const ranks = (names: string[]) => names.map((name, i) => ({ name, color: `#00000${i}` }));
	const snapshot = {
		version: 1,
		generatedAt: '2026-09-01T00:00:00.000Z',
		benchmarks: [
			{ id: 10, name: 'Voltaic S5', difficulty: 'Novice', ranks: ranks(['Iron', 'Bronze']) },
			{ id: 11, name: 'Voltaic S5', difficulty: 'Intermediate', ranks: ranks(['Platinum', 'Diamond']) },
			{ id: 20, name: 'Other', difficulty: 'All', ranks: ranks(['Seal', 'Master']) },
			{ id: 30, name: 'Unplayed', difficulty: 'All', ranks: ranks(['X']) },
		],
		scenarios: {
			Pasu: [
				[0, [100, 200]],
				[1, [300, 400]],
			],
			Ground: [[2, [10, 20]]],
			Nobody: [[3, [1]]],
		},
	} as unknown as Snapshot;
	const rows = directoryRows([
		summary({ id: 1, name: 'Pasu', hash: 'p1', pb: 350 }),
		summary({ id: 2, name: 'Pasu ', hash: 'p2', pb: 150 }),
		summary({ id: 3, name: 'Ground', hash: 'g1', pb: 5 }),
		summary({ id: 4, name: 'Loose', hash: 'l1', pb: 5 }),
	]);

	it('offer the benchmarks with played scenarios, grouped by name in snapshot order', () => {
		expect(benchmarkOptions(snapshot, rows)).toEqual([
			{
				name: 'Voltaic S5',
				options: [
					{ id: 10, label: 'Novice' },
					{ id: 11, label: 'Intermediate' },
				],
			},
			{ name: 'Other', options: [{ id: 20, label: 'All' }] },
		]);
	});

	it('filter to a benchmark’s scenarios, every version, and ignore an unknown one', () => {
		expect(inBenchmark(rows, snapshot, 11).map((r) => r.hash)).toEqual(['p1', 'p2']);
		expect(inBenchmark(rows, snapshot, 20).map((r) => r.hash)).toEqual(['g1']);
		expect(inBenchmark(rows, snapshot, 999)).toEqual(rows);
	});

	it('rank on the stored pick, or the default, without a benchmark', () => {
		const got = pbRanks(rows, snapshot, { Pasu: 11 }, null);
		expect(got.get('p1')).toEqual({ k: 0, name: 'Platinum', color: '#000000' });
		expect(got.get('p2')).toEqual({ k: -1, name: 'Unranked', color: null });
		expect(got.get('g1')).toEqual({ k: -1, name: 'Unranked', color: null });
		expect(got.has('l1')).toBe(false);
		expect(pbRanks(rows, snapshot, { Pasu: null }, null).has('p1')).toBe(false);
	});

	it('rank every row on the selected benchmark, over the stored picks', () => {
		const got = pbRanks(rows, snapshot, { Pasu: 11 }, 10);
		expect(got.get('p1')).toEqual({ k: 1, name: 'Bronze', color: '#000001' });
		expect(got.get('p2')).toEqual({ k: 0, name: 'Iron', color: '#000000' });
		expect(got.has('g1')).toBe(false);
		expect(pbRanks(rows, snapshot, { Pasu: null }, 10).get('p1')?.name).toBe('Bronze');
	});
});
