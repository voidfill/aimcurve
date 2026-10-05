import { describe, expect, it } from 'vitest';
import { syntheticRows, syntheticSnapshot } from '../../../test/helpers/energy';
import { energyTree } from './aggregate';
import { type StreamRows, toStream } from './history';
import { fractionalRank } from './rank';
import { aggregateSpread, percentile, spreadPass, windowSpread } from './spread';

const tree = energyTree(syntheticSnapshot(), 0)!;
const r = (score: number) => fractionalRank([100, 200, 300, 400], score);

function rows(scores: number[], ids = scores.map(() => 1)): StreamRows {
	return {
		scenarios: [
			{ id: 1, name: 'S0', hash: 'a' },
			{ id: 2, name: 'S0', hash: 'b' },
		],
		scenarioId: Int32Array.from(ids),
		runId: Int32Array.from(scores.map((_, i) => i + 1)),
		t: Float64Array.from(scores.map((_, i) => i * 1000)),
		score: Float64Array.from(scores),
	};
}

describe('P5 percentiles', () => {
	it('interpolates between closest ranks', () => {
		const sorted = [10, 20, 30, 40, 50];
		expect(percentile(sorted, 0.5)).toBe(30);
		expect(percentile(sorted, 0.1)).toBeCloseTo(14, 12);
		expect(percentile(sorted, 0.9)).toBeCloseTo(46, 12);
		expect(percentile([7], 0.9)).toBe(7);
	});

	it.each([10, 20, 50])('takes exactly the last W = %d, or fewer, or one', (W) => {
		const scores = Array.from({ length: 60 }, (_, i) => i);
		const full = windowSpread(scores, W, 100)!;
		expect(full.runs).toBe(W);
		expect(full.worst).toBe(60 - W);
		expect(windowSpread(scores.slice(0, 3), W, 100)!.runs).toBe(3);
		const one = windowSpread([42], W, 42)!;
		expect([one.worst, one.p10, one.median, one.p90, one.pb]).toEqual([42, 42, 42, 42, 42]);
	});
});

describe('P5 spreadPass', () => {
	it('ranks each statistic and keeps the all-time PB outside the window', () => {
		const scores = [390, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
		const [s] = spreadPass(tree, toStream(tree, rows(scores)), 10);
		expect(s!.runs).toBe(10);
		expect(s!.pb).toBeCloseTo(r(390), 12);
		expect(s!.worst).toBeCloseTo(r(110), 12);
		expect(s!.median).toBeCloseTo(r(155), 12);
		expect(s!.p10).toBeCloseTo(r(119), 12);
		expect(s!.p90).toBeCloseTo(r(191), 12);
		expect(s!.window).toHaveLength(10);
	});

	it('merges every id of one trimmed name into one scenario', () => {
		const spreads = spreadPass(tree, toStream(tree, rows([100, 300, 200], [1, 2, 1])), 20);
		expect(spreads[0]!.runs).toBe(3);
		expect(spreads[0]!.pb).toBeCloseTo(r(300), 12);
		expect(spreads.slice(1).every((s) => s === null)).toBe(true);
	});

	it('changing W changes the window, not the PB', () => {
		const stream = toStream(tree, rows([400, 100, 200, 300, 150, 250]));
		const [a] = spreadPass(tree, stream, 2);
		const [b] = spreadPass(tree, stream, 20);
		expect(a!.pb).toBe(b!.pb);
		expect(a!.median).not.toBe(b!.median);
	});
});

describe('P5 aggregateSpread', () => {
	const stream = toStream(tree, syntheticRows(500, 12, 3));
	const spreads = spreadPass(tree, stream, 20);

	it.each(['provisional', 'strict'] as const)('never inverts at any level when %s', (mode) => {
		for (const s of aggregateSpread(tree, spreads, mode)) {
			if (s === null) continue;
			expect(s.worst).toBeLessThanOrEqual(s.p10 + 1e-12);
			expect(s.p10).toBeLessThanOrEqual(s.median + 1e-12);
			expect(s.median).toBeLessThanOrEqual(s.p90 + 1e-12);
			expect(s.p90).toBeLessThanOrEqual(s.pb + 1e-12);
		}
	});

	it('agrees in both modes at full coverage, and differs with gaps', () => {
		const full = spreadPass(tree, toStream(tree, syntheticRows(2000, tree.names.length, 5)), 20);
		expect(full.every((s) => s !== null)).toBe(true);
		expect(aggregateSpread(tree, full, 'strict')).toEqual(aggregateSpread(tree, full, 'provisional'));
		const strict = aggregateSpread(tree, spreads, 'strict')[0]!;
		const provisional = aggregateSpread(tree, spreads, 'provisional')[0]!;
		expect(strict.median).toBeLessThan(provisional.median);
	});
});
