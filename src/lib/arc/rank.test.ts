import { describe, expect, it } from 'vitest';
import { fractionalRank } from './rank';

describe('E2 fractionalRank', () => {
	const t = [500, 600, 700, 800];

	it.each([
		[380, 0],
		[400, 0],
		[450, 0.5],
		[500, 1],
		// The spec's table lists 650 → 1.5; its formula gives 2.5, since 650 is past t₂ = 600.
		[550, 1.5],
		[650, 2.5],
		[800, 4],
		[850, 4.5],
		[900, 5],
		[950, 5],
	])('the worked example: %d → %d', (score, r) => {
		expect(fractionalRank(t, score)).toBeCloseTo(r, 10);
	});

	it('jumps a tied step and reaches the higher tied rank', () => {
		const tied = [100, 200, 200, 300];
		expect(fractionalRank(tied, 200)).toBe(3);
		expect(fractionalRank(tied, 150)).toBe(1.5);
		expect(fractionalRank(tied, 250)).toBe(3.5);
	});

	it('skips zero steps at the ends for the extension', () => {
		// step_low = 100 (the first non-zero from the bottom), step_high = 50.
		const ends = [100, 100, 200, 250, 250];
		expect(fractionalRank(ends, 0)).toBe(0);
		expect(fractionalRank(ends, 50)).toBe(0.5);
		expect(fractionalRank(ends, 100)).toBe(2);
		expect(fractionalRank(ends, 275)).toBe(5.5);
		expect(fractionalRank(ends, 300)).toBe(6);
	});

	it('steps a single-rank ladder by a tenth of its threshold, or 1 at zero', () => {
		expect(fractionalRank([1000], 950)).toBe(0.5);
		expect(fractionalRank([1000], 1050)).toBe(1.5);
		expect(fractionalRank([1000], 1100)).toBe(2);
		expect(fractionalRank([0], -0.5)).toBe(0.5);
		expect(fractionalRank([0], 0.25)).toBe(1.25);
	});

	it('allows a negative t₀', () => {
		expect(fractionalRank([10, 100], -35)).toBe(0.5);
	});
});
