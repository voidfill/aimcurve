import { describe, expect, it } from 'vitest';
import { atX, type RunCurve } from '../scoring';
import { sample, scrubGrid, unionGrid, yBounds } from './chart-data';

const f = (values: number[]) => Float64Array.from(values);

describe('R3 shared grid', () => {
	it('is the sorted union without duplicates', () => {
		expect(unionGrid(f([0, 0.5, 1]), f([0, 0.25, 0.5, 1]))).toEqual([0, 0.25, 0.5, 1]);
	});

	it('is exact at source points and linear between them', () => {
		expect(sample(f([0, 0.5, 1]), f([0, 10, 30]), [0, 0.25, 0.5, 0.75, 1])).toEqual([0, 5, 10, 20, 30]);
	});

	it('uses the first value where a source repeats a point', () => {
		expect(sample(f([0, 0.5, 0.5, 1]), f([0, 10, 12, 20]), [0.5])).toEqual([10]);
	});

	it('keeps a source gap as a gap on both sides', () => {
		const ys = f([Number.NaN, Number.NaN, 10, 20]);
		expect(sample(f([0, 0.2, 0.4, 1]), ys, [0, 0.1, 0.3, 0.4, 0.7])).toEqual([null, null, null, 10, 15]);
	});

	it('does not extrapolate past a source', () => {
		expect(sample(f([0.2, 0.8]), f([1, 2]), [0, 0.2, 1])).toEqual([null, 1, null]);
	});
});

describe('scrub grid', () => {
	it('has a point every hundredth of a second of the run, between its ticks', () => {
		const curve: RunCurve = {
			params: { kind: 'race', budget: 1000, pool: 1, bots: 1 },
			fileStem: 'synthetic',
			t: f([0, 0.99, 1.99]),
			x: f([0, 0.2, 1]),
			u: f([0, 0.99, 1.99]),
			score: 998.01,
		};
		const grid = scrubGrid(curve);
		expect(grid).toHaveLength(200);
		grid.forEach((x, k) => expect(atX(curve, x).t).toBeCloseTo(k / 100, 9));
	});
});

describe('B7 y bounds', () => {
	it('extends to a near target', () => {
		expect(yBounds(0, 100, { next: 140 }, true)).toEqual([0, 140]);
	});

	it('does not extend to a far target', () => {
		expect(yBounds(0, 100, { next: 151 }, true)).toEqual([0, 100]);
	});

	it('keeps the bounds at the top rank and with the layer off', () => {
		expect(yBounds(0, 100, { next: null }, true)).toEqual([0, 100]);
		expect(yBounds(0, 100, { next: 120 }, false)).toEqual([0, 100]);
		expect(yBounds(0, 100, null, true)).toEqual([0, 100]);
	});

	it('extends for an unranked run only when its first threshold is near', () => {
		expect(yBounds(200, 400, { next: 480 }, true)).toEqual([200, 480]);
		expect(yBounds(200, 400, { next: 900 }, true)).toEqual([200, 400]);
	});

	it('keeps the data max when the target is already inside the data', () => {
		expect(yBounds(0, 100, { next: 80 }, true)).toEqual([0, 100]);
	});
});
