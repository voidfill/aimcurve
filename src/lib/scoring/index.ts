/**
 * The scoring model: one comparable curve for every run.
 * See docs/superpowers/specs/2026-09-24-scoring-model-design.md.
 */
import type { ScoringInput } from './classify';
import { buildCurve, type RunCurve } from './curve';
import { DEFAULT_WINDOW_S, type PaceLines, paceLines } from './pace';

export { classify, type ScoringInput, type ScoringKind, type ScoringParams } from './classify';
export { comparable, type Readout, readout, type RecentRange, recentRange } from './compare';
export { atTime, atX, buildCurve, type RunCurve, uAtX } from './curve';
export { DEFAULT_WINDOW_S, type PaceLines, paceLines, project } from './pace';

// Runs never change after ingest, so results are cached by file stem — the
// persistent identity, which a destructive migration cannot reassign the way
// it can a run id.
const curves = new Map<string, RunCurve | null>();
const paces = new Map<string, PaceLines>();

export function curveFor(input: ScoringInput): RunCurve | null {
	if (!curves.has(input.fileStem)) curves.set(input.fileStem, buildCurve(input));
	return curves.get(input.fileStem)!;
}

export function paceFor(curve: RunCurve, windowS = DEFAULT_WINDOW_S): PaceLines {
	const key = `${curve.fileStem}\0${windowS}`;
	let lines = paces.get(key);
	if (!lines) {
		lines = paceLines(curve, windowS);
		paces.set(key, lines);
	}
	return lines;
}
