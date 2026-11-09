import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../benchmarks/snapshot';
import type { SessionScenario } from './queries';
import { formatChange, formatDelta, groupBySession, isPb, rankLookup, scoreDelta, sessionChange } from './rail';

function scenario(median: number, baseline: number | null): SessionScenario {
	return { scenarioId: 1, median, best: median, baseline, prevBest: null };
}

const snapshot: Snapshot = {
	version: 2,
	generatedAt: '2026-09-25T00:00:00Z',
	benchmarks: [
		{ id: 10, name: 'A S2', difficulty: 'Medium', sharecode: null, color: '', ranks: [{ name: 'Gold', color: '#CAB148' }, { name: 'Diamond', color: '#B9F2FF' }], tree: null },
		{ id: 20, name: 'A S1', difficulty: 'Medium', sharecode: null, color: '', ranks: [{ name: 'Gold', color: '#CAB148' }, { name: 'Diamond', color: '#B9F2FF' }], tree: null },
	],
	scenarios: {
		Pasu: [
			[0, [100, 200]],
			[1, [150, 300]],
		],
	},
};

describe('groupBySession', () => {
	it('groups consecutive rows and keeps list order', () => {
		const rows = [3, 3, 2, 1, 1].map((sessionId, i) => ({ sessionId, i }));
		expect(groupBySession(rows).map((g) => [g.sessionId, g.rows.map((r) => r.i)])).toEqual([
			[3, [0, 1]],
			[2, [2]],
			[1, [3, 4]],
		]);
	});
});

describe('sessionChange', () => {
	it('averages each scenario’s change, so one scenario played often does not dominate', () => {
		expect(sessionChange([scenario(110, 100), scenario(45, 50)])).toBeCloseTo(0, 10);
	});

	it('leaves out scenarios without a positive baseline', () => {
		expect(sessionChange([scenario(120, 100), scenario(10, null), scenario(5, 0)])).toBeCloseTo(0.2, 10);
	});

	it('is null when no scenario has a baseline', () => {
		expect(sessionChange([scenario(10, null)])).toBeNull();
		expect(sessionChange([])).toBeNull();
	});
});

describe('scoreDelta and isPb', () => {
	it('compare against the previous score and the prior best', () => {
		expect(scoreDelta({ score: 72.5, prevScore: 70 })).toBeCloseTo(2.5, 10);
		expect(scoreDelta({ score: 72.5, prevScore: null })).toBeNull();
		expect(scoreDelta({ score: null, prevScore: 70 })).toBeNull();
		expect(isPb({ score: 81, pbBefore: 80 })).toBe(true);
		expect(isPb({ score: 80, pbBefore: 80 })).toBe(false);
		expect(isPb({ score: 50, pbBefore: null })).toBe(false);
	});
});

describe('formatting', () => {
	it('signs deltas and changes with a true minus', () => {
		expect(formatDelta(1.76)).toBe('+1.8');
		expect(formatDelta(-2.3)).toBe('−2.3');
		expect(formatDelta(-240.4)).toBe('−240');
		expect(formatChange(0.0412)).toBe('+4.1%');
	});
});

describe('rankLookup', () => {
	it('uses the default benchmark, or the stored pick', () => {
		expect(rankLookup(snapshot, {})('Pasu', 150)).toMatchObject({ name: 'Gold', fill: 0.5, text: '50%' });
		expect(rankLookup(snapshot, { Pasu: 20 })('Pasu', 150)).toMatchObject({ name: 'Gold', fill: 0 });
	});

	it('is null without a snapshot, a score, a benchmark, or after an explicit none', () => {
		expect(rankLookup(null, {})('Pasu', 150)).toBeNull();
		expect(rankLookup(snapshot, {})('Pasu', null)).toBeNull();
		expect(rankLookup(snapshot, {})('Other', 150)).toBeNull();
		expect(rankLookup(snapshot, { Pasu: null })('Pasu', 150)).toBeNull();
	});
});
