/** How the scenario page shows results, deltas and configs. */
import { formatScore, formatSigned, formatValue } from '../run/format';
import type { SensConfig } from './config';

/** A race is known by its budget: its result is `budget − score` seconds. */
export type ResultKind = { kind: 'clock' } | { kind: 'race'; budget: number } | { kind: 'unknown' };

/** A CSV score as its result: a race's time to the hundredth, a score as recorded. */
export function formatResult(score: number, kind: ResultKind): string {
	return kind.kind === 'race' ? `${formatValue(kind.budget - score, 2)} s` : formatScore(score);
}

/**
 * A score difference, positive better. On a race it is a time difference in
 * seconds, positive when faster.
 */
export function formatDelta(diff: number, kind: ResultKind): string {
	return kind.kind === 'race' ? `${formatSigned(diff, 2)} s` : `${formatSigned(diff, 1)} pts`;
}

/** `30` or `30 / 25`, then the scale: the Run header's form. */
export function formatSens(c: SensConfig): string {
	const sens = c.horizSens === c.vertSens ? formatValue(c.horizSens, 3) : `${formatValue(c.horizSens, 3)} / ${formatValue(c.vertSens, 3)}`;
	return `${sens} ${c.sensScale}`;
}

export function formatFov(c: SensConfig): string {
	return `${formatValue(c.fov, c.fov % 1 === 0 ? 0 : 1)} ${c.fovScale}`;
}

/** Total play time: `3 h 12 min`, or `12 min` under an hour. */
export function formatPlayed(seconds: number): string {
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

const DAY_MS = 86_400_000;

/** `today`, `1 day`, `12 days` since `iso`, as of `now`. */
export function formatSince(iso: string, now: Date): string {
	const days = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
	return days <= 0 ? 'today' : `${days} ${days === 1 ? 'day' : 'days'}`;
}
