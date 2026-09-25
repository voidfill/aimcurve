import { describe, expect, it } from 'vitest';
import { buildSnapshot, type EvxlBenchmark, familySeason, type KovaaksResponse, serialize } from './snapshot';

const colors = (...names: string[]) => Object.fromEntries(names.map((n, i) => [n, `#00000${i}`]));
const two = colors('Gold', 'Diamond');

function bench(name: string, ...ids: number[]): EvxlBenchmark {
	return {
		benchmarkName: name,
		difficulties: ids.map((id) => ({ difficultyName: `D${id}`, kovaaksBenchmarkId: id, rankColors: two })),
	};
}

function response(...categories: Record<string, number[]>[]): KovaaksResponse {
	return {
		categories: Object.fromEntries(
			categories.map((scenarios, i) => [
				`C${i}`,
				{ scenarios: Object.fromEntries(Object.entries(scenarios).map(([n, t]) => [n, { rank_maxes: t }])) },
			]),
		),
	};
}

describe('B4 family and season', () => {
	it.each([
		['Voltaic S5', 'voltaic', 5],
		['Voltaic S5.5', 'voltaic', 5.5],
		['Anima Micro v2', 'anima micro', 2],
		['xyz Smoothness V2', 'xyz smoothness', 2],
		['Viscose Benchmarks', 'viscose benchmarks', 1],
		['Foo Season 3', 'foo', 3],
		['pAim Benchmarks ', 'paim benchmarks', 1],
		['350fs', '350fs', 1],
	])('%s', (name, family, season) => {
		expect(familySeason(name)).toEqual({ family, season });
	});
});

describe('B2 buildSnapshot', () => {
	it('drops hidden benchmarks', () => {
		const hidden = { ...bench('Hidden', 1), hidden: true };
		const built = buildSnapshot([hidden, bench('Shown', 2)], new Map([
			[1, response({ A: [1, 2] })],
			[2, response({ A: [3, 4] })],
		]));
		expect(built.benchmarks.map((b) => b.id)).toEqual([2]);
		expect(built.scenarios).toEqual({ A: [[0, [3, 4]]] });
	});

	it('skips a rank-count mismatch and an empty difficulty', () => {
		const built = buildSnapshot([bench('X', 1, 2, 3)], new Map([
			[1, response({ A: [1, 2, 3] })],
			[2, response({})],
			[3, response({ A: [5, 6] })],
		]));
		expect(built.benchmarks.map((b) => b.id)).toEqual([3]);
		expect(built.skipped).toHaveLength(2);
		expect(built.skipped[0]).toContain('rank colours');
		expect(built.skipped[1]).toContain('no scenarios');
	});

	it('trims names and keeps the first occurrence across categories', () => {
		const built = buildSnapshot([bench('X', 1)], new Map([
			[1, response({ ' A ': [1, 2], B: [3, 4] }, { A: [9, 10], ' B': [11, 12] })],
		]));
		expect(built.scenarios).toEqual({ A: [[0, [1, 2]]], B: [[0, [3, 4]]] });
	});

	it('skips decreasing and all-equal ladders, keeps ties', () => {
		const three = { benchmarkName: 'X', difficulties: [{ difficultyName: 'D', kovaaksBenchmarkId: 1, rankColors: colors('a', 'b', 'c') }] };
		const built = buildSnapshot([three], new Map([
			[1, response({ Down: [1, 3, 2], Flat: [5, 5, 5], Tied: [1, 2, 2] })],
		]));
		expect(Object.keys(built.scenarios)).toEqual(['Tied']);
		expect(built.skipped.join('\n')).toMatch(/Down.*decreasing[\s\S]*Flat.*all thresholds equal/);
	});

	it('reads numeric-string thresholds and skips other strings', () => {
		const built = buildSnapshot([bench('X', 1)], new Map([
			[1, { categories: { C: { scenarios: { A: { rank_maxes: ['1750', '2000.5'] }, B: { rank_maxes: ['1', 'x'] } } } } }],
		]));
		expect(built.scenarios).toEqual({ A: [[0, [1750, 2000.5]]] });
		expect(built.skipped[0]).toContain('"B" has non-numeric thresholds');
	});

	it('fails on an integer-like rank name', () => {
		const bad = { benchmarkName: 'X', difficulties: [{ difficultyName: 'D', kovaaksBenchmarkId: 1, rankColors: { '1': '#fff' } }] };
		expect(() => buildSnapshot([bad], new Map([[1, response({ A: [1] })]]))).toThrow(/integer-like/);
	});

	it('orders candidates by family listing, season descending, then position', () => {
		const index = [
			bench('PureG S2', 1),
			bench('Voltaic S4', 2),
			bench('PureG S1', 3),
			bench('Voltaic S5.5', 4, 5),
			bench('Viscose Benchmarks', 6),
			bench('Anima v1', 7),
			bench('Viscose Benchmarks S2', 8),
			bench('Anima v2', 9),
		];
		const responses = new Map([1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => [id, response({ S: [id, id + 1] })]));
		const built = buildSnapshot(index, responses);
		const ids = built.scenarios.S!.map(([i]) => built.benchmarks[i]!.id);
		expect(ids).toEqual([1, 3, 4, 5, 2, 8, 6, 9, 7]);
	});

	it('sorts scenario keys by code unit', () => {
		const built = buildSnapshot([bench('X', 1)], new Map([[1, response({ b: [1, 2], B: [1, 2], a: [1, 2] })]]));
		expect(Object.keys(built.scenarios)).toEqual(['B', 'a', 'b']);
	});
});

describe('B3 serialize', () => {
	const built = buildSnapshot([bench('X', 1)], new Map([[1, response({ A: [1, 2.5], B: [3, 4] })]]));

	it('writes one benchmark and one scenario per line, and parses back', () => {
		const text = serialize(built, null, '2026-09-25T00:00:00Z');
		expect(text.split('\n')).toEqual([
			'{',
			'\t"version": 1,',
			'\t"generatedAt": "2026-09-25T00:00:00Z",',
			'\t"benchmarks": [',
			'\t\t{"id":1,"name":"X","difficulty":"D1","ranks":[{"name":"Gold","color":"#000000"},{"name":"Diamond","color":"#000001"}]}',
			'\t],',
			'\t"scenarios": {',
			'\t\t"A": [[0,[1,2.5]]],',
			'\t\t"B": [[0,[3,4]]]',
			'\t}',
			'}',
			'',
		]);
		expect(JSON.parse(text).scenarios.A).toEqual([[0, [1, 2.5]]]);
	});

	it('is byte-identical on a rerun and carries generatedAt over', () => {
		const first = serialize(built, null, '2026-09-25T00:00:00Z');
		expect(serialize(built, first, '2026-10-01T00:00:00Z')).toBe(first);
	});

	it('takes a new generatedAt when the content changed', () => {
		const first = serialize(built, null, '2026-09-25T00:00:00Z');
		const changed = buildSnapshot([bench('X', 1)], new Map([[1, response({ A: [1, 3] })]]));
		expect(serialize(changed, first, '2026-10-01T00:00:00Z')).toContain('"generatedAt": "2026-10-01T00:00:00Z"');
	});
});
