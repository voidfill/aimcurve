/**
 * What the attempt rail shows beyond the attempt itself: session groups, each
 * session's change against the player's recent form, a row's change from the
 * previous attempt, and its rank on the picked benchmark.
 */
import type { Snapshot } from '../benchmarks/snapshot';
import { candidates, pick } from '../benchmarks/pick';
import { rankScale } from '../arc/rank';
import { describeRank } from '../arc/name';
import { pill, type Pill } from '../arc/pill';
import { formatSigned } from './format';
import type { RailAttempt, SessionScenario } from './queries';

export interface SessionGroup<T> {
	sessionId: number;
	rows: T[];
}

/** Consecutive rows of one session, in list order; a session split by paging stays one group. */
export function groupBySession<T extends { sessionId: number }>(rows: readonly T[]): SessionGroup<T>[] {
	const groups: SessionGroup<T>[] = [];
	for (const row of rows) {
		const last = groups[groups.length - 1];
		if (last && last.sessionId === row.sessionId) last.rows.push(row);
		else groups.push({ sessionId: row.sessionId, rows: [row] });
	}
	return groups;
}

/**
 * The session's change against recent form: for each scenario with a positive
 * baseline, (session median − baseline) / baseline, averaged so every scenario
 * counts once however often it was played. Null when no scenario has one.
 */
export function sessionChange(scenarios: readonly SessionScenario[]): number | null {
	const changes = scenarios
		.filter((s) => s.baseline !== null && s.baseline > 0)
		.map((s) => (s.median - s.baseline!) / s.baseline!);
	return changes.length === 0 ? null : changes.reduce((sum, c) => sum + c, 0) / changes.length;
}

/** A row's change from the scenario's previous attempt; null without either score. */
export function scoreDelta(attempt: Pick<RailAttempt, 'score' | 'prevScore'>): number | null {
	return attempt.score === null || attempt.prevScore === null ? null : attempt.score - attempt.prevScore;
}

/** Beat every earlier score. A scenario's first attempt has nothing to beat. */
export function isPb(attempt: Pick<RailAttempt, 'score' | 'pbBefore'>): boolean {
	return attempt.score !== null && attempt.pbBefore !== null && attempt.score > attempt.pbBefore;
}

/** A score change: one decimal below 100, whole points above, signed with a true minus. */
export function formatDelta(delta: number): string {
	return formatSigned(delta, Math.abs(delta) >= 100 ? 0 : 1);
}

/** A ratio as a signed percent with one decimal. */
export function formatChange(change: number): string {
	return `${formatSigned(change * 100, 1)}%`;
}

export interface RowRank extends Pill {
	/** `Gold, 60 % to Platinum`, for the row's accessible label. */
	label: string;
}

export type RankOf = (scenarioName: string, score: number | null) => RowRank | null;

/**
 * A rank lookup for many rows: each scenario's benchmark is picked once, as
 * the run header picks it, and its ladder worked out once. Null without a
 * score or a benchmark.
 */
export function rankLookup(snapshot: Snapshot | null, picks: Readonly<Record<string, number | null>>): RankOf {
	const scales = new Map<string, { scale: (score: number) => number; ranks: Snapshot['benchmarks'][number]['ranks'] } | null>();
	return (scenarioName, score) => {
		if (snapshot === null || score === null) return null;
		const name = scenarioName.trim();
		let entry = scales.get(name);
		if (entry === undefined) {
			const id = picks[name];
			const chosen = pick(candidates(snapshot, name), typeof id === 'number' || id === null ? id : undefined);
			entry = chosen === null ? null : { scale: rankScale(chosen.thresholds), ranks: chosen.benchmark.ranks };
			scales.set(name, entry);
		}
		if (entry === null) return null;
		const r = entry.scale(score);
		return { ...pill(r, entry.ranks), label: describeRank(r, entry.ranks) };
	};
}
