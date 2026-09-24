/**
 * R2 of the Run view design: which run the inspected run is compared with.
 * See docs/superpowers/specs/2026-09-24-run-view-design.md.
 *
 * Pure and synchronous over already-loaded curves. The caller decides which
 * curves to load from `walkOrder`, and a run whose curve has not been loaded
 * counts as "no curve".
 */
import { comparable, type RunCurve, uAtX } from '../scoring';

export type BaselineOption = 'pb-before' | 'pb' | 'best-charted' | 'previous';

export const BASELINE_OPTIONS: readonly { value: BaselineOption; label: string }[] = [
	{ value: 'pb-before', label: 'PB before this run' },
	{ value: 'pb', label: 'All-time PB' },
	{ value: 'best-charted', label: 'Best charted before this run' },
	{ value: 'previous', label: 'Previous run' },
];

/** A completed run of the inspected run's scenario, metadata only. */
export interface ScenarioRun {
	id: number;
	fileStem: string;
	score: number | null;
	/** Normalized ISO timestamp, so string order is chronological order. */
	startedAt: string;
	hasPerf: boolean;
}

/** Looks up a loaded curve: `null` for no curve, `undefined` for not loaded. */
export type CurveOf = (fileStem: string) => RunCurve | null | undefined;

export type Baseline =
	| { kind: 'charted'; option: BaselineOption; label: string; run: ScenarioRun; score: number; curve: RunCurve }
	| {
			kind: 'flat';
			option: BaselineOption;
			label: string;
			run: ScenarioRun;
			score: number;
			/** Why only the score is used. */
			reason: 'no-perf' | 'incomparable';
	  }
	| { kind: 'none'; option: BaselineOption; reason: 'first-run' | 'no-comparable' | 'is-pb' };

const LABEL: Record<BaselineOption, string> = {
	'pb-before': 'PB before',
	pb: 'PB',
	'best-charted': 'best charted',
	previous: 'previous',
};

type Scored = ScenarioRun & { score: number };

function scored(run: ScenarioRun): run is Scored {
	return run.score !== null && Number.isFinite(run.score);
}

function before(run: ScenarioRun, inspected: ScenarioRun): boolean {
	return run.fileStem !== inspected.fileStem && run.startedAt < inspected.startedAt;
}

/** Higher score first; a tie goes to the earlier run. */
function byScore(a: Scored, b: Scored): number {
	return b.score - a.score || (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0);
}

function byRecency(a: ScenarioRun, b: ScenarioRun): number {
	return a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0;
}

/**
 * The run a PB option chooses, by CSV score alone and curve or not, or `null`.
 * `pb` excludes the inspected run; whether that makes the inspected run the PB
 * is `resolveBaseline`'s call.
 */
export function pbRun(option: 'pb-before' | 'pb', inspected: ScenarioRun, runs: readonly ScenarioRun[]): Scored | null {
	const pool = runs
		.filter(scored)
		.filter((run) => (option === 'pb' ? run.fileStem !== inspected.fileStem : before(run, inspected)));
	return pool.sort(byScore)[0] ?? null;
}

/**
 * The order in which a curve-backed option looks for its run: perf-backed runs
 * before the inspected one, best first for `best-charted`, most recent first for
 * `previous` and the recent set. The first comparable one wins.
 */
export function walkOrder(
	option: 'best-charted' | 'previous' | 'recent',
	inspected: ScenarioRun,
	runs: readonly ScenarioRun[],
): ScenarioRun[] {
	const pool = runs.filter((run) => run.hasPerf && before(run, inspected));
	return option === 'best-charted' ? pool.filter(scored).sort(byScore) : pool.sort(byRecency);
}

/**
 * Whether `curve` can be drawn against the inspected run. With no inspected
 * curve there is nothing to align with, so any curve qualifies: only the score
 * is used then.
 */
function candidate(current: RunCurve | null, curve: RunCurve | null | undefined): curve is RunCurve {
	return curve != null && (current === null || comparable(current.params, curve.params));
}

/** Up to `limit` most recent candidates before the inspected run. */
export function recentRuns(
	inspected: ScenarioRun,
	runs: readonly ScenarioRun[],
	current: RunCurve | null,
	curveOf: CurveOf,
	limit = 10,
): RunCurve[] {
	const out: RunCurve[] = [];
	for (const run of walkOrder('recent', inspected, runs)) {
		const curve = curveOf(run.fileStem);
		if (candidate(current, curve)) out.push(curve);
		if (out.length === limit) break;
	}
	return out;
}

export function resolveBaseline(
	option: BaselineOption,
	inspected: ScenarioRun,
	runs: readonly ScenarioRun[],
	current: RunCurve | null,
	curveOf: CurveOf,
): Baseline {
	const label = LABEL[option];
	const earlier = runs.some((run) => before(run, inspected));

	if (option === 'pb-before' || option === 'pb') {
		const run = pbRun(option, inspected, runs);
		if (run === null) return { kind: 'none', option, reason: option === 'pb' || !earlier ? 'first-run' : 'no-comparable' };
		if (option === 'pb' && scored(inspected) && byScore(inspected, run) < 0) {
			return { kind: 'none', option, reason: 'is-pb' };
		}
		const curve = run.hasPerf ? curveOf(run.fileStem) : null;
		if (candidate(current, curve)) return { kind: 'charted', option, label, run, score: run.score, curve };
		return {
			kind: 'flat',
			option,
			label: `${label} · no curve`,
			run,
			score: run.score,
			reason: run.hasPerf ? 'incomparable' : 'no-perf',
		};
	}

	for (const run of walkOrder(option, inspected, runs)) {
		const curve = curveOf(run.fileStem);
		if (scored(run) && candidate(current, curve)) {
			return { kind: 'charted', option, label, run, score: run.score, curve };
		}
	}
	return { kind: 'none', option, reason: earlier ? 'no-comparable' : 'first-run' };
}

/**
 * The exact comparison against a flat baseline at progress `x`: the PB spread
 * evenly over progress, not where the PB actually stood. Clock:
 * `S(x) − PB · x` points. Race: `PB time · x − t(x)` seconds. Positive is ahead,
 * and at `x = 1` it is the CSV score difference.
 */
export function flatReadout(current: RunCurve, score: number, x: number): number {
	const u = uAtX(current, x);
	if (current.params.kind === 'race') return (current.params.budget - score) * x - u;
	return u - score * x;
}
