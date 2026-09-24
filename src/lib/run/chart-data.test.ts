import { describe, expect, it } from 'vitest';
import { sample, unionGrid } from './chart-data';

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
