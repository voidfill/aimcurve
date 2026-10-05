/** Synthetic difficulties and run streams for the energy tests and bench. */
import type { Snapshot } from '../../src/lib/benchmarks/snapshot';
import type { StreamRows } from '../../src/lib/energy/history';

/**
 * One difficulty (`id` 458, snapshot index 0) of `categories × subs × per`
 * scenarios named `S0`, `S1`, …, each on the ladder 100, 200, 300, 400.
 */
export function syntheticSnapshot(categories = 3, subs = 3, per = 2): Snapshot {
	const ranks = ['Platinum', 'Diamond', 'Jade', 'Master'].map((name, i) => ({ name, color: ['#2FCFC2', '#B9F2FF', '#85FA85', '#EC44CA'][i]! }));
	let n = 0;
	const tree = Array.from({ length: categories }, (_, c) => ({
		name: `C${c}`,
		color: '#888888',
		subs: Array.from({ length: subs }, (_, s) => ({
			name: `C${c}.${s}`,
			color: '#888888',
			scenarios: Array.from({ length: per }, () => `S${n++}`),
		})),
	}));
	const scenarios: Snapshot['scenarios'] = {};
	for (let i = 0; i < n; i++) scenarios[`S${i}`] = [[0, [100, 200, 300, 400]]];
	return {
		version: 2,
		generatedAt: '',
		benchmarks: [{ id: 458, name: 'Voltaic S5', difficulty: 'Intermediate', color: '#02A2DA', ranks, tree }],
		scenarios,
	};
}

const ranks = [
	{ name: 'Gold', color: '#CAB148' },
	{ name: 'Platinum', color: '#2FCFC2' },
	{ name: 'Diamond', color: '#B9F2FF' },
];

/**
 * Index 1 (`id` 458) of a two-difficulty snapshot; index 0 has no tree.
 * Clicking: Dynamic [A, B], Static [C]; Tracking: Precise [D, Unrated]; and
 * `B` again in a second subcategory named Dynamic.
 */
export function smallSnapshot(): Snapshot {
	const ladder = [100, 200, 300];
	return {
		version: 2,
		generatedAt: '',
		benchmarks: [
			{ id: 1, name: 'Other', difficulty: 'x', color: '', ranks, tree: null },
			{
				id: 458,
				name: 'Voltaic S5',
				difficulty: 'Intermediate',
				color: '#02A2DA',
				ranks,
				tree: [
					{ name: 'Clicking', color: '#c00', subs: [
						{ name: 'Dynamic', color: '', scenarios: ['A', 'B'] },
						{ name: 'Static', color: '', scenarios: ['C'] },
					] },
					{ name: 'Tracking', color: '#15c', subs: [
						{ name: 'Precise', color: '', scenarios: ['D', 'Unrated'] },
						{ name: 'Dynamic', color: '', scenarios: ['B'] },
					] },
				],
			},
		],
		scenarios: {
			A: [[1, ladder]],
			B: [[0, [1, 2, 3]], [1, ladder]],
			C: [[1, ladder]],
			D: [[1, ladder]],
			Unrated: [[0, [1, 2, 3]]],
		},
	};
}

/** A deterministic PRNG in [0, 1). */
export function random(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * `runs` runs over scenario ids `1 … scenarios` (two ids per name past the
 * first ten, so names share ids), a minute apart, with slowly rising scores.
 */
export function syntheticRows(runs: number, scenarios: number, seed = 1): StreamRows {
	const next = random(seed);
	const list = [];
	for (let i = 0; i < scenarios; i++) {
		list.push({ id: i + 1, name: `S${i}`, hash: `h${i}` });
		if (i >= 10) list.push({ id: 1000 + i, name: `S${i}`, hash: `h${i}b` });
	}
	const scenarioId = new Int32Array(runs);
	const runId = new Int32Array(runs);
	const t = new Float64Array(runs);
	const score = new Float64Array(runs);
	for (let e = 0; e < runs; e++) {
		const s = list[Math.floor(next() * list.length)]!;
		scenarioId[e] = s.id;
		runId[e] = e + 1;
		t[e] = Date.UTC(2026, 0, 1) + e * 60_000;
		score[e] = 50 + (350 * e) / runs + next() * 120;
	}
	return { scenarios: list, scenarioId, runId, t, score };
}
