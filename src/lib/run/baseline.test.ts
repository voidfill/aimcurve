import { describe, expect, it } from 'vitest';
import { buildCurve, type RunCurve, type ScoringInput } from '../scoring';
import { type CurveOf, flatReadout, pbRun, recentRuns, resolveBaseline, type ScenarioRun, walkOrder } from './baseline';

/** A clock run of `seconds` one-second ticks scoring `perTick` each. */
function clock(stem: string, perTick: number, seconds = 60): RunCurve {
	const scores = new Array<number>(seconds).fill(perTick);
	const input: ScoringInput = {
		runId: 0,
		fileStem: stem,
		score: perTick * seconds,
		damageDone: null,
		timeLimit: seconds,
		timescale: 1,
		endChallengeAfterKills: null,
		endChallengeAfterDamage: null,
		t: scores.map((_, i) => i + 1),
		scoreTicks: scores,
		damageTicks: null,
		killOffsets: [],
	};
	return buildCurve(input)!;
}

function run(stem: string, day: number, score: number | null, hasPerf = true): ScenarioRun {
	return { id: day, fileStem: stem, score, startedAt: new Date(Date.UTC(2026, 8, day)).toISOString(), hasPerf };
}

/**
 * Five runs, oldest first. `b` is the best before `e`, `d` has no .perf, `c`
 * is 30 s long and so does not compare with the 60 s runs.
 */
const runs = [run('a', 1, 600), run('b', 2, 900), run('c', 3, 1500), run('d', 4, 1200, false), run('e', 5, 700)];
const curves = new Map<string, RunCurve | null>([
	['a', clock('a', 10)],
	['b', clock('b', 15)],
	['c', clock('c', 50, 30)],
	['e', clock('e', 700 / 60)],
]);
const curveOf: CurveOf = (stem) => curves.get(stem);
const at = (stem: string) => runs.find((r) => r.fileStem === stem)!;
const current = curves.get('e')!;

describe('R2 baseline choice', () => {
	it('picks PB-before by score alone, curve or not', () => {
		expect(pbRun('pb-before', at('e'), runs)?.fileStem).toBe('c');
		expect(pbRun('pb-before', at('c'), runs)?.fileStem).toBe('b');
		expect(pbRun('pb-before', at('a'), runs)).toBeNull();
	});

	it('draws a PB flat when it has no .perf', () => {
		const later = [...runs, run('f', 6, 1000)];
		const baseline = resolveBaseline('pb-before', at('e'), later.filter((r) => r.fileStem !== 'c'), current, curveOf);
		expect(baseline).toMatchObject({ kind: 'flat', reason: 'no-perf', score: 1200, label: 'PB before · no curve' });
	});

	it('draws a PB flat when its curve does not compare', () => {
		const baseline = resolveBaseline('pb-before', at('e'), runs, current, curveOf);
		expect(baseline).toMatchObject({ kind: 'flat', reason: 'incomparable', score: 1500 });
	});

	it('charts a comparable PB', () => {
		const baseline = resolveBaseline('pb-before', at('c'), runs, curves.get('c')!, curveOf);
		// c's own curve does not compare with b, so b is flat from c's point of view.
		expect(baseline.kind).toBe('flat');
		const fromE = resolveBaseline('pb-before', at('e'), runs.slice(0, 2).concat(at('e')), current, curveOf);
		expect(fromE).toMatchObject({ kind: 'charted', label: 'PB before', score: 900 });
	});

	it('finds best charted and previous among comparable curve-backed runs only', () => {
		expect(resolveBaseline('best-charted', at('e'), runs, current, curveOf)).toMatchObject({
			kind: 'charted',
			label: 'best charted',
			run: { fileStem: 'b' },
		});
		// d has no .perf and c does not compare, so previous skips both.
		expect(resolveBaseline('previous', at('e'), runs, current, curveOf)).toMatchObject({
			kind: 'charted',
			run: { fileStem: 'b' },
		});
		expect(walkOrder('previous', at('e'), runs).map((r) => r.fileStem)).toEqual(['c', 'b', 'a']);
	});

	it('breaks score ties toward the earlier run', () => {
		const tied = [run('x', 1, 900), run('y', 2, 900), run('z', 3, 100)];
		expect(pbRun('pb-before', tied[2]!, tied)?.fileStem).toBe('x');
	});

	it('says why there is no baseline', () => {
		expect(resolveBaseline('pb-before', at('a'), runs, curves.get('a')!, curveOf)).toMatchObject({
			kind: 'none',
			reason: 'first-run',
		});
		expect(resolveBaseline('pb', at('c'), runs, curves.get('c')!, curveOf)).toMatchObject({
			kind: 'none',
			reason: 'is-pb',
		});
		const onlyShort = [run('c', 3, 1500), run('e', 5, 700)];
		expect(resolveBaseline('previous', at('e'), onlyShort, current, curveOf)).toMatchObject({
			kind: 'none',
			reason: 'no-comparable',
		});
	});

	it('uses the all-time PB even when it came later', () => {
		expect(resolveBaseline('pb', at('a'), runs, curves.get('a')!, curveOf)).toMatchObject({
			kind: 'flat',
			score: 1500,
		});
	});

	it('collects recent comparable runs, most recent first', () => {
		expect(recentRuns(at('e'), runs, current, curveOf).map((c) => c.fileStem)).toEqual(['b', 'a']);
		expect(recentRuns(at('e'), runs, current, curveOf, 1).map((c) => c.fileStem)).toEqual(['b']);
	});

	it('reads a flat baseline as the PB spread evenly: zero at the start, the score gap at the end', () => {
		expect(flatReadout(current, 1200, 0)).toBe(0);
		expect(flatReadout(current, 1200, 1)).toBeCloseTo(700 - 1200, 6);
		expect(flatReadout(current, 600, 0.5)).toBeCloseTo(350 - 300, 6);
	});
});
