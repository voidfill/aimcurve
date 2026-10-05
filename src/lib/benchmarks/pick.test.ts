import { describe, expect, it } from 'vitest';
import { candidates, pick } from './pick';
import type { Snapshot } from './snapshot';

const snapshot: Snapshot = {
	version: 2,
	generatedAt: '2026-09-25T00:00:00Z',
	benchmarks: [
		{ id: 10, name: 'Viscose Benchmarks S2', difficulty: 'Medium', color: '', ranks: [], tree: null },
		{ id: 20, name: 'Viscose Benchmarks', difficulty: 'Medium', color: '', ranks: [], tree: null },
	],
	scenarios: {
		Pasu: [
			[0, [790, 1650]],
			[1, [900, 1600]],
		],
	},
};

describe('B4 candidates and pick', () => {
	const list = candidates(snapshot, 'Pasu');

	it('lists candidates default first', () => {
		expect(list.map((c) => [c.benchmark.id, c.isDefault])).toEqual([
			[10, true],
			[20, false],
		]);
		expect(list[1]!.thresholds).toEqual([900, 1600]);
	});

	it('uses the default without a stored pick', () => {
		expect(pick(list, undefined)?.benchmark.id).toBe(10);
	});

	it('uses a valid stored pick', () => {
		expect(pick(list, 20)?.benchmark.id).toBe(20);
	});

	it('uses a stored pick of the default', () => {
		expect(pick(list, 10)?.benchmark.id).toBe(10);
	});

	it('picks no benchmark for a stored null', () => {
		expect(pick(list, null)).toBeNull();
	});

	it('ignores a stale pick', () => {
		expect(pick(list, 99)?.benchmark.id).toBe(10);
	});

	it('has nothing for a scenario in no benchmark', () => {
		expect(candidates(snapshot, 'Unknown')).toEqual([]);
		expect(candidates(snapshot, 'constructor')).toEqual([]);
		expect(pick([], 10)).toBeNull();
	});

	it('trims the local name before the lookup', () => {
		expect(candidates(snapshot, '  Pasu ')).toHaveLength(2);
	});
});
