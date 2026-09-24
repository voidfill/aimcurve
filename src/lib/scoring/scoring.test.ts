import type { PGlite } from '@electric-sql/pglite';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../../test/helpers/db';
import { curated } from '../../../test/helpers/fixtures';
import { ingest } from '../ingest';
import { nodeSource } from '../ingest/source-node';
import { getScoringInputs } from '../run/queries';
import {
	buildCurve,
	classify,
	comparable,
	curveFor,
	paceFor,
	paceLines,
	readout,
	recentRange,
	type RunCurve,
	type ScoringInput,
	uAtX,
} from '.';

let pg: PGlite;
const inputs = new Map<string, ScoringInput>();

/** The curated completed run whose file stem starts with `prefix`. */
function run(prefix: string): ScoringInput {
	const matches = [...inputs.values()].filter((input) => input.fileStem.startsWith(prefix));
	if (matches.length !== 1) throw new Error(`${matches.length} curated runs match ${prefix}`);
	return matches[0]!;
}

function curve(input: ScoringInput): RunCurve {
	const built = buildCurve(input);
	if (!built) throw new Error(`${input.fileStem} has no curve`);
	return built;
}

beforeAll(async () => {
	({ pg } = await makeTestDb());
	await ingest(nodeSource(join(curated.dir, 'stats'), join(curated.dir, 'performances')), pg);
	const ids = await pg.query<{ id: number }>(
		`select r.id from run r join run_perf p on p.run_id = r.id where r.kind = 'complete'`,
	);
	for (const input of (await getScoringInputs(pg, ids.rows.map((row) => row.id))).values()) {
		inputs.set(input.fileStem, input);
	}
});

/** A hand-built clock run: one tick per second, `score` added at each. */
function clockInput(scores: number[], overrides: Partial<ScoringInput> = {}): ScoringInput {
	return {
		runId: 1,
		fileStem: 'clock',
		score: scores.reduce((a, b) => a + b, 0),
		damageDone: null,
		timeLimit: scores.length,
		timescale: 1,
		endChallengeAfterKills: null,
		endChallengeAfterDamage: null,
		t: scores.map((_, i) => i + 1),
		scoreTicks: scores,
		damageTicks: null,
		killOffsets: [],
		...overrides,
	};
}

/**
 * A hand-built race: `damage` per one-second tick against a pool split over
 * `kills.length` bots, score counting down from a budget of 1000.
 */
function raceInput(damage: number[], kills: number[], overrides: Partial<ScoringInput> = {}): ScoringInput {
	const end = kills[kills.length - 1]!;
	return {
		runId: 2,
		fileStem: 'race',
		score: 1000 - end,
		damageDone: damage.reduce((a, b) => a + b, 0),
		timeLimit: 1000,
		timescale: 1,
		endChallengeAfterKills: null,
		endChallengeAfterDamage: null,
		t: damage.map((_, i) => Math.min(i + 1, end)),
		scoreTicks: damage.map((_, i) => (i === 0 ? 999 : -1)),
		damageTicks: damage,
		killOffsets: kills,
		...overrides,
	};
}

describe('D3 classification', () => {
	it('reads a race from the 1000 sentinel and the countdown together', () => {
		const params = classify(run('Air Pure Medium - Challenge - 2026.09.18-18.44.15'));
		expect(params).toMatchObject({ kind: 'race', budget: 1000, bots: 5 });
	});

	it('takes a clock duration in real seconds from time_limit / timescale', () => {
		// time_limit 60 at timescale 0.7: 85.7 s of real time.
		const params = classify(run('Air Angelic 4 Voltaic Easy 70% - Challenge - 2026.07.26-13.13.11'));
		expect(params.kind).toBe('clock');
		if (params.kind !== 'clock') return;
		expect(params.durationFrom).toBe('time-limit');
		expect(params.durationS).toBeCloseTo(60 / 0.7, 3);
	});

	it('takes a kill-capped clock duration from the run itself', () => {
		const params = classify(run('VT Air Novice - Challenge - 2026.05.09-12.39.04'));
		expect(params).toMatchObject({ kind: 'clock', durationFrom: 'kill-cap' });
		if (params.kind !== 'clock') return;
		expect(params.durationS).toBeCloseTo(57.18, 1);
	});

	it('is unsupported when the sentinel and the countdown disagree', () => {
		expect(classify(clockInput([10, 10, 10], { timeLimit: 1000 }))).toEqual({
			kind: 'unsupported',
			reason: 'signals-disagree',
		});
		expect(classify(raceInput([10, 10], [1, 2], { timeLimit: 60 }))).toEqual({
			kind: 'unsupported',
			reason: 'signals-disagree',
		});
	});

	it('is unsupported without a score series', () => {
		expect(classify(clockInput([1, 2], { scoreTicks: null }))).toEqual({
			kind: 'unsupported',
			reason: 'no-score-series',
		});
		expect(buildCurve(clockInput([1, 2], { scoreTicks: null }))).toBeNull();
	});
});

describe('D3 classification guards', () => {
	it('takes a damage-capped clock duration from the run itself', () => {
		const params = classify(clockInput([1, 1, 1], { timeLimit: 60, endChallengeAfterDamage: 500 }));
		expect(params).toEqual({ kind: 'clock', durationS: 3, durationFrom: 'damage-cap' });
	});

	it('rejects a time limit or timescale outside the valid range', () => {
		const bad = { kind: 'unsupported', reason: 'bad-time-limit' };
		expect(classify(clockInput([1, 1], { timeLimit: 1200 }))).toEqual(bad);
		expect(classify(clockInput([1, 1], { timeLimit: 0 }))).toEqual(bad);
		expect(classify(clockInput([1, 1], { timescale: 0 }))).toEqual(bad);
		expect(classify(clockInput([1, 1], { timeLimit: null }))).toEqual(bad);
	});

	it('rejects a race without a damage series', () => {
		expect(classify(raceInput([100, 100], [1, 2], { damageTicks: null }))).toEqual({
			kind: 'unsupported',
			reason: 'no-race-pool',
		});
	});

	it('unwraps kill times that crossed local midnight', () => {
		// Offsets are ms since local midnight minus the start: after midnight
		// they come out a day short.
		const input = raceInput([100, 100, 100, 100], [2, 4], { killOffsets: [2 - 86_400, 4 - 86_400] });
		expect(classify(input).kind).toBe('race');
		const lines = paceLines(curve(input), 1);
		expect(lines.accumulated[lines.accumulated.length - 1]).toBeCloseTo(996, 6);
	});

	it('rejects kill times out of order or past the end of the run', () => {
		const bad = { kind: 'unsupported', reason: 'bad-kill-times' };
		expect(classify(raceInput([100, 100, 100, 100], [2, 4], { killOffsets: [3, 2] }))).toEqual(bad);
		expect(classify(raceInput([100, 100], [1, 2], { killOffsets: [1, 9] }))).toEqual(bad);
	});
});

describe('D4 curve', () => {
	it('lets the kill knot win over a tick that already reached its progress', () => {
		// Damage reaches half the pool at t = 2, but the kill is logged at 2.5.
		const c = curve(raceInput([100, 100, 100, 100, 0], [2.5, 5]));
		expect(uAtX(c, 0.5)).toBeCloseTo(2.5, 9);
	});

	it('keeps race progress non-decreasing through tick noise on both sides of a knot', () => {
		// Tick 2 lags below kill 1's 0.5; tick 4 overshoots the pool before the last kill.
		const input = raceInput([100, 90, 110, 100.001], [1.5, 4.5], { damageDone: 400 });
		const c = curve(input);
		for (let i = 1; i < c.x.length; i++) expect(c.x[i]!).toBeGreaterThanOrEqual(c.x[i - 1]!);
		expect(Math.max(...c.x)).toBe(1);
		expect(uAtX(c, 1)).toBeCloseTo(4.5, 9);
	});

	it('uses the running score as u on a clock', () => {
		const c = curve(clockInput([5, -2, 7]));
		expect([...c.x]).toEqual([0, 1 / 3, 2 / 3, 1]);
		expect([...c.u]).toEqual([0, 5, 3, 10]);
	});

	it('closes a clock curve at the time limit when the last tick falls short', () => {
		// A completed clock run ran to its limit even if the last tick is stamped early.
		const c = curve(clockInput([30, 15], { timeLimit: 3 }));
		expect([...c.t]).toEqual([0, 1, 2, 3]);
		expect(c.x[c.x.length - 1]).toBe(1);
		expect(c.u[c.u.length - 1]).toBe(45);
	});

	it('never lets clock progress pass 1', () => {
		const c = curve(clockInput([1, 1, 1], { timeLimit: 2.5 }));
		expect(Math.max(...c.x)).toBe(1);
	});

	it('places race kill knots at exactly k / N', () => {
		const c = curve(run('Air Pure Medium - Challenge - 2026.09.18-18.44.15'));
		const input = run('Air Pure Medium - Challenge - 2026.09.18-18.44.15');
		input.killOffsets.forEach((offset, k) => {
			const i = [...c.t].indexOf(offset);
			expect(i).toBeGreaterThan(-1);
			expect(c.x[i]).toBeCloseTo((k + 1) / input.killOffsets.length, 9);
		});
		expect(c.x[c.x.length - 1]).toBe(1);
	});

	it('is non-decreasing in x and u on every curated race', () => {
		const races = [...inputs.values()].filter((input) => classify(input).kind === 'race');
		expect(races.length).toBeGreaterThanOrEqual(3);
		for (const input of races) {
			const c = curve(input);
			for (let i = 1; i < c.x.length; i++) {
				expect(c.x[i]!).toBeGreaterThanOrEqual(c.x[i - 1]!);
				expect(c.u[i]!).toBeGreaterThanOrEqual(c.u[i - 1]!);
			}
		}
	});

	it('interpolates u at a progress value', () => {
		const c = curve(clockInput([10, 20]));
		expect(uAtX(c, 0.25)).toBeCloseTo(5, 9);
		expect(uAtX(c, 0.75)).toBeCloseTo(20, 9);
	});

	it('reads the time a race first reached a progress value across a respawn gap', () => {
		// Bot 1 dies at 2 s, nothing is damaged until 3 s: x is flat on [2, 3].
		const c = curve(raceInput([50, 50, 0, 50, 50], [2, 5]));
		expect(uAtX(c, 0.5)).toBeCloseTo(2, 9);
	});
});

describe('D5 pace', () => {
	it('ends accumulated pace at the real score on every curated run', () => {
		for (const input of inputs.values()) {
			const params = classify(input);
			if (params.kind === 'unsupported') continue;
			const lines = paceLines(curve(input));
			const last = lines.accumulated[lines.accumulated.length - 1]!;
			const tolerance = params.kind === 'race' ? 0.05 : 1e-3 * Math.max(1, Math.abs(input.score));
			expect(Math.abs(last - input.score), input.fileStem).toBeLessThanOrEqual(tolerance);
		}
	});

	it('draws from the first tick, with a gap only at x = 0', () => {
		const lines = paceLines(curve(clockInput([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])), 5);
		expect(Number.isNaN(lines.accumulated[0]!)).toBe(true); // t = 0: 0 / 0
		expect(Number.isNaN(lines.local[0]!)).toBe(true);
		expect(lines.accumulated[1]).toBeCloseTo(10, 9); // t = 1, 1 point/s over 10 s
		expect(lines.local[5]).toBeCloseTo(10, 9);
	});

	it('uses the window played so far before a full window, so local equals accumulated', () => {
		const lines = paceLines(curve(clockInput([3, 1, 1, 1, 1, 1, 1, 1, 1, 1])), 5);
		for (const i of [1, 2, 3, 4]) expect(lines.local[i]).toBeCloseTo(lines.accumulated[i]!, 9);
		expect(lines.local[1]).toBeCloseTo(30, 9);
	});

	it('makes clock local pace the marginal score over the window', () => {
		// 2 points/s for 5 s, then 0: the window ending at t = 10 added nothing.
		const lines = paceLines(curve(clockInput([2, 2, 2, 2, 2, 0, 0, 0, 0, 0])), 5);
		expect(lines.local[10]).toBeCloseTo(0, 9);
		expect(lines.accumulated[10]).toBeCloseTo(10, 9);
	});

	it('projects race pace as budget minus projected seconds', () => {
		// 100 damage/s against a 400 pool: 4 s for the whole pool, 996 points.
		const lines = paceLines(curve(raceInput([100, 100, 100, 100], [2, 4])), 1);
		expect(lines.local[lines.local.length - 1]).toBeCloseTo(996, 6);
		expect(lines.accumulated[lines.accumulated.length - 1]).toBeCloseTo(996, 6);
	});

	it('leaves race local pace undefined over a window with no progress', () => {
		const c = curve(raceInput([100, 100, 0, 0, 100, 100], [2, 6]));
		const lines = paceLines(c, 1);
		const i = [...c.t].lastIndexOf(4);
		expect(Number.isNaN(lines.local[i]!)).toBe(true);
	});
});

describe('D9 memoisation', () => {
	it('caches curves and pace lines by file stem, not run id', () => {
		const a = curveFor(clockInput([1, 2, 3], { runId: 20, fileStem: 'memo' }));
		// A destructive migration can hand the same run a new id.
		const b = curveFor(clockInput([1, 2, 3], { runId: 21, fileStem: 'memo' }));
		expect(b).toBe(a);
		expect(paceFor(a!, 1)).toBe(paceFor(b!, 1));
		expect(paceFor(a!, 1)).not.toBe(paceFor(a!, 2));
	});
});

describe('D4/D5 comparison', () => {
	const slow = () => raceInput([50, 50, 50, 50], [2, 4], { runId: 3, fileStem: 'slow' });
	const fast = () => raceInput([100, 100], [1, 2], { runId: 4, fileStem: 'fast' });

	it('compares runs of one kind with the same parameters only', () => {
		const a = classify(clockInput([1, 2, 3]));
		expect(comparable(a, classify(clockInput([3, 2, 1])))).toBe(true);
		expect(comparable(a, classify(clockInput([1, 2, 3, 4])))).toBe(false);
		expect(comparable(a, classify(fast()))).toBe(false);
		expect(comparable(classify(slow()), classify(fast()))).toBe(true);
	});

	it('reads a faster race as seconds ahead', () => {
		const at = readout(curve(fast()), curve(slow()), 0.5);
		expect(at).toEqual({ value: 1, unit: 'seconds' });
		expect(readout(curve(fast()), curve(slow()))).toEqual({ value: 2, unit: 'seconds' });
	});

	it('reads a clock readout in points, from the CSV score at rest', () => {
		const a = run('VT Aether Novice S5 Hard Bot 1 90% - Challenge - 2026.09.18-18.59.40');
		const b = run('VT Aether Novice S5 Hard Bot 1 90% - Challenge - 2026.09.18-19.04.50');
		expect(comparable(classify(a), classify(b))).toBe(true);
		expect(readout(curve(a), curve(b))).toEqual({ value: a.score - b.score, unit: 'points' });
		expect(readout(curve(a), curve(b), 1).value).toBeCloseTo(a.score - b.score, 3);
	});

	it('refuses a readout between runs that do not compare', () => {
		expect(() => readout(curve(fast()), curve(clockInput([1, 2])))).toThrow();
		expect(() => readout(curve(clockInput([1, 2])), curve(clockInput([1, 2, 3])), 0.5)).toThrow();
	});

	it('leaves runs that do not compare out of the recent range', () => {
		const current = curve(clockInput([1, 1, 1, 1, 1, 1], { fileStem: 'current' }));
		const longer = curve(clockInput([2, 2, 2, 2, 2, 2, 2, 2], { fileStem: 'longer' }));
		const race = curve(fast());
		const range = recentRange(current, [longer, race]);
		expect([...range.count].every((n) => n === 0)).toBe(true);
	});

	it('builds the recent range from other runs only, at the inspected x', () => {
		const current = curve(clockInput([1, 1, 1, 1, 1, 1], { runId: 10, fileStem: 'current' }));
		const other = curve(clockInput([2, 2, 2, 2, 2, 2], { runId: 11, fileStem: 'other' }));
		const range = recentRange(current, [current, other]);
		expect(range.x).toBe(current.x);
		expect(range.count[6]).toBe(1);
		expect(range.mean[6]).toBeCloseTo(12, 9);
		// One run has a mean but no meaningful spread.
		expect(Number.isNaN(range.sd[6]!)).toBe(true);
	});
});
