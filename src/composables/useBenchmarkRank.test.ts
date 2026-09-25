import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';
import type { Snapshot } from '../lib/benchmarks/snapshot';
import { useBenchmarkRank } from './useBenchmarkRank';

const snapshot: Snapshot = {
	version: 1,
	generatedAt: '2026-09-25T00:00:00Z',
	benchmarks: [
		{ id: 10, name: 'A S2', difficulty: 'Medium', ranks: [{ name: 'Gold', color: '#CAB148' }, { name: 'Diamond', color: '#B9F2FF' }] },
		{ id: 20, name: 'A S1', difficulty: 'Medium', ranks: [{ name: 'Gold', color: '#CAB148' }, { name: 'Diamond', color: '#B9F2FF' }] },
	],
	scenarios: {
		Pasu: [
			[0, [100, 200]],
			[1, [150, 300]],
		],
		Popcorn: [[1, [50, 60]]],
	},
};

describe('useBenchmarkRank', () => {
	it('stays empty until the snapshot resolves, then follows the scenario', async () => {
		let resolve!: (s: Snapshot) => void;
		const load = () => new Promise<Snapshot>((r) => (resolve = r));
		const name = ref<string | null>('Pasu');
		const score = ref<number | null>(160);
		const picks = ref<Record<string, number>>({});
		const api = useBenchmarkRank(name, score, { load, picks });

		expect(api.candidates.value).toEqual([]);
		expect(api.selected.value).toBeNull();
		expect(api.rank.value).toBeNull();

		resolve(snapshot);
		await nextTick();
		await Promise.resolve();
		expect(api.candidates.value).toHaveLength(2);
		expect(api.selected.value?.benchmark.id).toBe(10);
		expect(api.rank.value).toEqual({ k: 0, next: 200, nextRank: 1, gap: 40 });

		api.setPick(20);
		expect(picks.value).toEqual({ Pasu: 20 });
		expect(api.rank.value).toEqual({ k: 0, next: 300, nextRank: 1, gap: 140 });

		name.value = 'Popcorn';
		score.value = 55;
		expect(api.selected.value?.benchmark.id).toBe(20);
		expect(api.rank.value?.k).toBe(0);

		name.value = 'Nothing';
		expect(api.candidates.value).toEqual([]);
		expect(api.rank.value).toBeNull();
	});

	it('shows no rank without a score', async () => {
		const api = useBenchmarkRank(ref('Pasu'), ref(null), { load: async () => snapshot, picks: ref({}) });
		await Promise.resolve();
		await Promise.resolve();
		expect(api.selected.value).not.toBeNull();
		expect(api.rank.value).toBeNull();
	});
});
