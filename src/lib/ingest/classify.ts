/**
 * Deciding what a `Stats.csv` *is*, from its filename and its key/value block.
 *
 * The rules are `docs/ingest.md`'s, and the one that matters is negative: never
 * classify on `Avg FPS`. A reset's `Avg FPS` is uninitialised memory — observed
 * at 7.3e9 and 8.9e9 — so testing `== 0` misclassifies 3 of 22 resets as
 * completed runs. Classify on the interval instead.
 */
import type { StatsCsv } from '../parse/stats-csv';

export type RunKind = 'complete' | 'reset' | 'abort';

const STATS_SUFFIX = ' Stats.csv';
const PERF_SUFFIX = ' Performance.perf';

const FILENAME = /(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/;
const CLOCK = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;

export interface Timing {
	kind: RunKind;
	/** Filename timestamp at the end of its second, matching `run.written_at`. */
	writtenAt: Date;
	/** `Challenge Start` resolved to an instant. Null unless complete. */
	startedAt: Date | null;
	/** The same instant as ms since local midnight. Null unless complete. */
	startMs: number | null;
	durationS: number | null;
}

/** `<base> Stats.csv` or `<base> Performance.perf` -> `<base>`. */
export function fileStem(name: string): string {
	if (name.endsWith(STATS_SUFFIX)) return name.slice(0, -STATS_SUFFIX.length);
	if (name.endsWith(PERF_SUFFIX)) return name.slice(0, -PERF_SUFFIX.length);
	return name;
}

export function isStats(name: string): boolean {
	return name.endsWith(STATS_SUFFIX);
}

export function isPerf(name: string): boolean {
	return name.endsWith(PERF_SUFFIX);
}

/** `HH:MM:SS.mmm` -> ms since local midnight. */
export function clockToMs(clock: string): number | null {
	const parts = CLOCK.exec(clock.trim());
	if (!parts) return null;
	return (+parts[1]! * 3600 + +parts[2]! * 60 + +parts[3]!) * 1000 + +parts[4]!;
}

/** The `YYYY.MM.DD-HH.MM.SS` in a filename stem, as a local instant. */
export function parseFilenameTime(name: string): Date | null {
	const parts = FILENAME.exec(fileStem(name));
	if (!parts) return null;
	return new Date(+parts[1]!, +parts[2]! - 1, +parts[3]!, +parts[4]!, +parts[5]!, +parts[6]!);
}

export function classify(name: string, csv: StatsCsv): Timing {
	const second = parseFilenameTime(name);
	if (!second) throw new Error(`filename carries no timestamp: ${name}`);
	// The file is written at some point *within* that second, so the interval
	// ends at the end of it. run.written_at holds the same value.
	const writtenAt = new Date(second.getTime() + 999);

	// An abort has no scenario identity at all, so there is nothing to join and
	// nothing to attribute. Its tell is the empty field, never the interval: an
	// abort keeps a perfectly normal Avg FPS and a wide interval.
	if (csv.settings.scenario === '' || csv.settings.hash === '') {
		return { kind: 'abort', writtenAt, startedAt: null, startMs: null, durationS: null };
	}

	const startMs = clockToMs(csv.settings.challengeStart);
	if (startMs === null) {
		return { kind: 'abort', writtenAt, startedAt: null, startMs: null, durationS: null };
	}

	const midnight = new Date(second.getFullYear(), second.getMonth(), second.getDate());
	let startedAt = new Date(midnight.getTime() + startMs);
	// `Challenge Start` has no date, so the date comes from the filename — which
	// is the *write* time. A run starting at 23:59:40 is written the next day.
	// No fixture exercises this; docs/ingest.md lists it as an open gap.
	if (startedAt.getTime() - writtenAt.getTime() > 60_000) startedAt = new Date(startedAt.getTime() - 86_400_000);

	const durationMs = writtenAt.getTime() - startedAt.getTime();
	// A reset file is stamped with the *next* attempt's start but written now,
	// so it spans almost nothing. This caught 22 of 22 resets in the dump.
	if (durationMs < 1000) {
		return { kind: 'reset', writtenAt, startedAt: null, startMs: null, durationS: null };
	}

	return { kind: 'complete', writtenAt, startedAt, startMs, durationS: durationMs / 1000 };
}
