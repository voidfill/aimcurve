import { describe, expect, it } from 'vitest';
import {
	DEFAULT_STATE,
	directoryQuery,
	directoryRows,
	type DirectoryRow,
	filterRows,
	nextSort,
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
		expect(directoryQuery({ q: 'pasu', sort: 'name', dir: 'asc' })).toEqual({ q: 'pasu', sort: 'name' });
		expect(directoryQuery({ q: '', sort: 'played', dir: 'asc' })).toEqual({ dir: 'asc' });
	});

	it('round-trip every state', () => {
		for (const state of [
			DEFAULT_STATE,
			{ q: 'a b', sort: 'rank', dir: 'asc' },
			{ q: '', sort: 'name', dir: 'desc' },
			{ q: 'x', sort: 'form', dir: 'desc' },
		] as const)
			expect(parseDirectoryQuery(directoryQuery(state))).toEqual(state);
	});

	it('fall back to the default on unknown values', () => {
		expect(parseDirectoryQuery({ sort: 'bogus', dir: 'sideways' })).toEqual(DEFAULT_STATE);
		expect(parseDirectoryQuery({ sort: 'name', dir: 'sideways' })).toEqual({ q: '', sort: 'name', dir: 'asc' });
		expect(parseDirectoryQuery({ q: ['one', 'two'] })).toEqual({ ...DEFAULT_STATE, q: 'one' });
	});
});
