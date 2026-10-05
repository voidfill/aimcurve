import { describe, expect, it } from 'vitest';
import { syntheticRows, syntheticSnapshot } from '../../../test/helpers/energy';
import { energyTree, evaluate } from './aggregate';
import { historyPass, type StreamRows, toStream, valueAt } from './history';
import { fractionalRank } from './rank';
import { median } from '../scenario/config';

const tree = energyTree(syntheticSnapshot(), 0)!;

function rows(runs: [scenarioId: number, score: number][], scenarios = [{ id: 1, name: 'S0', hash: 'a' }]): StreamRows {
	return {
		scenarios,
		scenarioId: Int32Array.from(runs.map(([s]) => s)),
		runId: Int32Array.from(runs.map((_, i) => i + 1)),
		t: Float64Array.from(runs.map((_, i) => i * 1000)),
		score: Float64Array.from(runs.map(([, v]) => v)),
	};
}

describe('E8 toStream', () => {
	it('merges every id of a name into one scenario and drops unknown names', () => {
		const stream = toStream(
			tree,
			rows(
				[[1, 10], [2, 20], [3, 30], [2, 40]],
				[
					{ id: 1, name: 'S0', hash: 'a' },
					{ id: 2, name: 'S0', hash: 'b' },
					{ id: 3, name: 'Elsewhere', hash: 'c' },
				],
			),
		);
		expect([...stream.sid]).toEqual([0, 0, 0]);
		expect([...stream.score]).toEqual([10, 20, 40]);
		expect(stream.runsOf[0]).toEqual([0, 1, 2]);
		expect(stream.topHash[0]).toBe('b');
		expect(stream.topHash[1]).toBeNull();
	});
});

describe('E8 historyPass', () => {
	it('keeps PB monotone while form can fall', () => {
		const stream = toStream(tree, rows([[1, 350], [1, 120], [1, 110], [1, 100]]));
		const h = historyPass(tree, stream, 3, 'provisional');
		const pb = [0, 1, 2, 3].map((e) => valueAt(h, e, 0, 'pb')!);
		const form = [0, 1, 2, 3].map((e) => valueAt(h, e, 0, 'form')!);
		for (let e = 1; e < 4; e++) expect(pb[e]).toBeGreaterThanOrEqual(pb[e - 1]!);
		expect(form[3]).toBeLessThan(form[0]!);
	});

	it('takes form over fewer than N runs, then the last N', () => {
		const stream = toStream(tree, rows([[1, 100], [1, 300], [1, 200], [1, 400]]));
		const sub = 1 + tree.categories.length; // the first subcategory: S0 and S1
		const r = (score: number) => fractionalRank([100, 200, 300, 400], score);
		const h = historyPass(tree, stream, 3, 'provisional');
		expect(valueAt(h, 1, sub, 'form')).toBeCloseTo(r(200), 12);
		expect(valueAt(h, 3, sub, 'form')).toBeCloseTo(r(300), 12);
		expect(valueAt(historyPass(tree, stream, 3, 'strict'), 3, sub, 'form')).toBeCloseTo(r(300) / 2, 12);
	});

	it('takes form over the form window N, PB regardless (P13)', () => {
		const stream = toStream(tree, rows([[1, 400], [1, 100], [1, 120], [1, 140], [1, 160], [1, 180]]));
		const [five, twenty] = [5, 20].map((n) => historyPass(tree, stream, n, 'provisional'));
		expect(valueAt(five!, 5, 0, 'form')).not.toBeCloseTo(valueAt(twenty!, 5, 0, 'form')!, 6);
		expect(valueAt(five!, 5, 0, 'pb')).toBe(valueAt(twenty!, 5, 0, 'pb'));
	});

	it('keeps each node to the runs inside it', () => {
		const stream = toStream(tree, rows([[1, 100], [2, 200], [1, 300]], [{ id: 1, name: 'S0', hash: 'a' }, { id: 2, name: 'S6', hash: 'b' }]));
		const h = historyPass(tree, stream, 5, 'strict');
		const C = tree.categories.length;
		expect([...h.nodes[0]!.events]).toEqual([0, 1, 2]);
		expect([...h.nodes[1]!.events]).toEqual([0, 2]); // S0 is in C0
		expect([...h.nodes[2]!.events]).toEqual([1]); // S6 is in C1
		expect([...h.nodes[1 + C + 2]!.events]).toEqual([]);
		expect(valueAt(h, 2, 1 + C + 2, 'pb')).toBe(0);
	});

	it('equals tree evaluation of the as-of state at sampled events', () => {
		const stream = toStream(tree, syntheticRows(600, tree.names.length, 7));
		const N = 5;
		const passes = { provisional: historyPass(tree, stream, N, 'provisional'), strict: historyPass(tree, stream, N, 'strict') };
		const ladder = [100, 200, 300, 400];
		for (const e of [0, 3, 17, 120, 599]) {
			const pb: (number | null)[] = tree.names.map(() => null);
			const recent: number[][] = tree.names.map(() => []);
			for (let j = 0; j <= e; j++) {
				const i = stream.sid[j]!;
				pb[i] = Math.max(pb[i] ?? -Infinity, stream.score[j]!);
				recent[i]!.push(stream.score[j]!);
			}
			const inputs = {
				pb: pb.map((s) => (s === null ? null : fractionalRank(ladder, s))),
				form: recent.map((xs) => (xs.length === 0 ? null : fractionalRank(ladder, median(xs.slice(-N))!))),
			};
			for (const input of ['pb', 'form'] as const) {
				for (const mode of ['provisional', 'strict'] as const) {
					const expected = evaluate(tree, inputs[input], mode).nodes;
					expected.forEach((v, node) => {
						const got = valueAt(passes[mode], e, node, input);
						if (v === null) expect(got).toBeNull();
						else expect(got).toBeCloseTo(v, 9);
					});
				}
			}
		}
	});

	it('counts several scenario ids sharing one trimmed name as one scenario', () => {
		const scenarios = [
			{ id: 1, name: 'S0', hash: 'a' },
			{ id: 2, name: 'S0', hash: 'b' },
		];
		const h = historyPass(tree, toStream(tree, rows([[1, 300], [2, 100]], scenarios)), 5, 'provisional');
		expect(h.firstEvent[0]).toBe(0);
		// One scenario at its PB 300, not two scenarios.
		expect(valueAt(h, 1, 0, 'pb')).toBeCloseTo(fractionalRank([100, 200, 300, 400], 300), 12);
	});
});
