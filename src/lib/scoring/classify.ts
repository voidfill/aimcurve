/**
 * D3 of the scoring model design: a run classifies itself from its own `.perf`.
 * See docs/superpowers/specs/2026-09-24-scoring-model-design.md.
 */

/** One completed, perf-backed run as the scoring model reads it. */
export interface ScoringInput {
	runId: number;
	/** Persistent identity; `runId` is reset by a destructive migration. */
	fileStem: string;
	/** The CSV `Score:` — the authoritative endpoint. */
	score: number;
	/** CSV `Damage Done:`; a completed race consumes its whole pool. */
	damageDone: number | null;
	timeLimit: number | null;
	timescale: number | null;
	endChallengeAfterKills: number | null;
	endChallengeAfterDamage: number | null;
	/** Tick times, seconds since challenge start, ascending. */
	t: readonly number[];
	/** Per-tick change of the running score; `null` where it did not change. */
	scoreTicks: readonly (number | null)[] | null;
	/** Per-tick damage done; `null` where there was none. */
	damageTicks: readonly (number | null)[] | null;
	/**
	 * Kill times in kill order, seconds since challenge start, as the `kill`
	 * view's `t_offset` gives them — not wrapped at midnight.
	 */
	killOffsets: readonly number[];
}

export type ScoringParams =
	| { kind: 'clock'; durationS: number; durationFrom: 'time-limit' | 'kill-cap' | 'damage-cap' }
	| { kind: 'race'; budget: number; pool: number; bots: number }
	| {
			kind: 'unsupported';
			reason: 'signals-disagree' | 'no-score-series' | 'bad-time-limit' | 'no-race-pool' | 'bad-kill-times';
	  };

export type ScoringKind = ScoringParams['kind'];

/** KovaaK's "no time limit" value for `time_limit`, and a race's budget. */
const NO_LIMIT = 1000;

const DAY_S = 86_400;

/**
 * A race's score series is a countdown: the budget minus the first tick, then
 * minus each tick's duration. The 10 % slack absorbs the ~1 Hz cadence jitter.
 */
function isCountdown(t: readonly number[], score: readonly (number | null)[]): boolean {
	if (!((score[0] ?? 0) > 0) || t.length < 2) return false;
	let matching = 0;
	for (let i = 1; i < t.length; i++) {
		if (Math.abs((score[i] ?? 0) + (t[i]! - t[i - 1]!)) < 0.02) matching++;
	}
	return matching / (t.length - 1) >= 0.9;
}

/**
 * Kill times on the run's own clock, or `null` if they cannot be. Offsets are
 * ms-since-local-midnight differences, so a kill after midnight comes out a
 * day short and is unwrapped here. What remains must be in order and inside
 * the run, allowing one tick of slack past the last tick.
 */
export function killTimes(input: ScoringInput): number[] | null {
	const end = input.t[input.t.length - 1] ?? 0;
	const times = input.killOffsets.map((offset) => (offset < 0 ? offset + DAY_S : offset));
	for (let i = 0; i < times.length; i++) {
		const time = times[i]!;
		if (time < 0 || time > end + 1 || (i > 0 && time < times[i - 1]!)) return null;
	}
	return times;
}

export function classify(input: ScoringInput): ScoringParams {
	if (!input.scoreTicks || input.t.length === 0) return { kind: 'unsupported', reason: 'no-score-series' };

	// Two independent signals; requiring both means a format change degrades
	// to "unsupported" rather than to the wrong axis.
	const sentinel = input.timeLimit === NO_LIMIT;
	const countdown = isCountdown(input.t, input.scoreTicks);
	if (sentinel !== countdown) return { kind: 'unsupported', reason: 'signals-disagree' };

	if (sentinel) {
		const bots = input.killOffsets.length;
		if (!input.damageTicks || !input.damageDone || input.damageDone <= 0 || bots === 0) {
			return { kind: 'unsupported', reason: 'no-race-pool' };
		}
		if (!killTimes(input)) return { kind: 'unsupported', reason: 'bad-kill-times' };
		return { kind: 'race', budget: input.timeLimit!, pool: input.damageDone, bots };
	}

	const limit = input.timeLimit;
	const timescale = input.timescale ?? 1;
	if (limit === null || !(limit > 0 && limit < NO_LIMIT) || !(timescale > 0)) {
		return { kind: 'unsupported', reason: 'bad-time-limit' };
	}
	// Capped runs end on a condition, not on the limit: a kill cap ends on a
	// bot rotation, so the run's own length is its duration.
	const last = input.t[input.t.length - 1]!;
	if (input.endChallengeAfterKills !== null) return { kind: 'clock', durationS: last, durationFrom: 'kill-cap' };
	if (input.endChallengeAfterDamage !== null) return { kind: 'clock', durationS: last, durationFrom: 'damage-cap' };
	return { kind: 'clock', durationS: limit / timescale, durationFrom: 'time-limit' };
}
