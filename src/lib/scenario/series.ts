/**
 * S5 of the scenario page design: the progression chart's lines.
 * See docs/superpowers/specs/2026-09-25-scenario-page-design.md.
 *
 * Values are in run order, oldest first. `null` is a run without a value: it
 * is skipped by both lines, never read as zero.
 */
import { median } from './config';

export type Better = 'higher' | 'lower';

/** The best value so far at each run; null until the first value. */
export function pbSteps(values: readonly (number | null)[], better: Better): (number | null)[] {
	let best: number | null = null;
	return values.map((v) => {
		if (v !== null && Number.isFinite(v) && (best === null || (better === 'higher' ? v > best : v < best))) best = v;
		return best;
	});
}

export interface RollingMedian {
	value: (number | null)[];
	/** Whether the window behind the point held `window` values. */
	full: boolean[];
}

/**
 * The median of the last `window` values at each run, over the values present.
 * A run without a value has no point of its own. Before the window fills, the
 * median is of what is there and is marked not full.
 */
export function rollingMedian(values: readonly (number | null)[], window = 10): RollingMedian {
	const seen: number[] = [];
	const value: (number | null)[] = [];
	const full: boolean[] = [];
	for (const v of values) {
		if (v === null || !Number.isFinite(v)) {
			value.push(null);
			full.push(false);
			continue;
		}
		seen.push(v);
		const tail = seen.slice(-window);
		value.push(median(tail));
		full.push(tail.length === window);
	}
	return { value, full };
}

/** Indices where a new session starts, the first run excluded. */
export function sessionBreaks(sessions: readonly number[]): number[] {
	const out: number[] = [];
	for (let i = 1; i < sessions.length; i++) if (sessions[i] !== sessions[i - 1]) out.push(i);
	return out;
}
