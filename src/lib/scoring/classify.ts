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
	/** Tick times, seconds since challenge start, ascending. */
	t: readonly number[];
	/** Per-tick change of the running score; `null` where it did not change. */
	scoreTicks: readonly (number | null)[] | null;
	/** Per-tick damage done; `null` where there was none. */
	damageTicks: readonly (number | null)[] | null;
	/** Kill times, seconds since challenge start, in kill order. */
	killOffsets: readonly number[];
}

export type ScoringParams =
	| { kind: 'clock'; durationS: number; durationFrom: 'time-limit' | 'kill-cap' }
	| { kind: 'race'; budget: number; pool: number; bots: number }
	| {
			kind: 'unsupported';
			reason: 'signals-disagree' | 'no-score-series' | 'no-time-limit' | 'no-race-pool';
	  };

export type ScoringKind = ScoringParams['kind'];

/** KovaaK's "no time limit" value for `time_limit`, and a race's budget. */
const NO_LIMIT = 1000;

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

export function classify(input: ScoringInput): ScoringParams {
	if (!input.scoreTicks || input.t.length === 0) return { kind: 'unsupported', reason: 'no-score-series' };

	// Two independent signals; requiring both means a format change degrades
	// to "unsupported" rather than to the wrong axis.
	const sentinel = input.timeLimit === NO_LIMIT;
	const countdown = isCountdown(input.t, input.scoreTicks);
	if (sentinel !== countdown) return { kind: 'unsupported', reason: 'signals-disagree' };

	if (sentinel) {
		const bots = input.killOffsets.length;
		if (!input.damageDone || input.damageDone <= 0 || bots === 0) {
			return { kind: 'unsupported', reason: 'no-race-pool' };
		}
		return { kind: 'race', budget: input.timeLimit!, pool: input.damageDone, bots };
	}

	// Kill-capped runs end on a bot rotation, not on the limit.
	if (input.endChallengeAfterKills !== null) {
		return { kind: 'clock', durationS: input.t[input.t.length - 1]!, durationFrom: 'kill-cap' };
	}
	if (input.timeLimit === null) return { kind: 'unsupported', reason: 'no-time-limit' };
	return { kind: 'clock', durationS: input.timeLimit / (input.timescale ?? 1), durationFrom: 'time-limit' };
}
