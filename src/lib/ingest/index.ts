/**
 * The orchestrator, which runs on the main thread.
 *
 * It lists filenames, diffs them against the stems already in the database,
 * hands chunks of bytes to a builder — inline in tests, a worker in the browser
 * — and writes what comes back. The builder is a pure function, so the thread
 * split is an injection point rather than a structural commitment.
 */
import type { PGliteInterface } from '@electric-sql/pglite';
import { applyChunk } from './batch';
import { buildChunk, type ChunkResult } from './chunk';
import { fileStem, isPerf, isStats, parseFilenameTime } from './classify';
import type { IngestReport } from './report';
import type { FileSource, SourceEntry } from './source';

export type { IngestReport } from './report';
export type { FileSource, SourceEntry } from './source';

export type ChunkBuilder = (files: { name: string; bytes: Uint8Array }[]) => Promise<ChunkResult>;

export interface IngestOptions {
	/** Files per transaction. 200 is the measured sweet spot between commit overhead and blast radius. */
	chunkSize?: number;
	build?: ChunkBuilder;
	onProgress?: (done: number, total: number) => void;
}

const inlineBuilder: ChunkBuilder = async (files) => buildChunk(files);

/** Every stem already written, across all three places a file can land. */
async function knownStems(pg: PGliteInterface): Promise<{ csv: Set<string>; perf: Set<string> }> {
	const csv = await pg.query<{ file_stem: string }>(
		`select file_stem from run union all select file_stem from unattributed_file`,
	);
	const perf = await pg.query<{ perf_file_stem: string }>(`select perf_file_stem from run_perf`);
	return {
		csv: new Set(csv.rows.map((row) => row.file_stem)),
		perf: new Set(perf.rows.map((row) => row.perf_file_stem)),
	};
}

async function readAll(entries: SourceEntry[]): Promise<{ name: string; bytes: Uint8Array }[]> {
	return Promise.all(
		entries.map(async (entry) => ({
			name: entry.name,
			bytes: new Uint8Array(await (await entry.open()).arrayBuffer()),
		})),
	);
}

export async function ingest(
	source: FileSource,
	pg: PGliteInterface,
	options: IngestOptions = {},
): Promise<IngestReport> {
	const chunkSize = options.chunkSize ?? 200;
	const build = options.build ?? inlineBuilder;

	const entries = await source.list();
	const known = await knownStems(pg);
	const work = entries
		.filter((entry) =>
			(isStats(entry.name) && !known.csv.has(fileStem(entry.name))) ||
			(isPerf(entry.name) && !known.perf.has(fileStem(entry.name))),
		)
		// Sorted by filename timestamp so a CSV and its perf — written 1.6 ms
		// apart — land in the same chunk except at a boundary. D7's end-of-pass
		// retry covers the boundary.
		.sort((a, b) => (parseFilenameTime(a.name)?.getTime() ?? 0) - (parseFilenameTime(b.name)?.getTime() ?? 0));

	const report: IngestReport = {
		scanned: entries.length,
		skipped: entries.length - work.length,
		runs: 0,
		aborts: 0,
		perfsMatched: 0,
		failures: [],
		orphanPerfs: [],
		ambiguousPerfs: [],
		hashMismatches: [],
	};

	const unmatched = new Map<string, SourceEntry>();
	let done = 0;

	for (let at = 0; at < work.length; at += chunkSize) {
		const slice = work.slice(at, at + chunkSize);
		const orphans = await runChunk(slice, pg, build, report);
		for (const stem of orphans) {
			const entry = slice.find((e) => fileStem(e.name) === stem);
			if (entry) unmatched.set(stem, entry);
		}
		done += slice.length;
		options.onProgress?.(done, work.length);
	}

	// Re-stage the perfs that matched nothing, once, now that every CSV in the
	// pass is committed. In watch mode an orphan is usually just the 1.6 ms race
	// between the CSV and its perf; only what survives this is a real orphan.
	if (unmatched.size > 0) {
		report.orphanPerfs = await runChunk([...unmatched.values()], pg, build, report);
	}

	return report;
}

/**
 * One chunk. Returns the perf stems that matched nothing.
 *
 * A chunk is one transaction, so one bad row takes the whole chunk with it. On a
 * failure the chunk is re-run one file at a time, which is the only way a
 * constraint violation surfaces as "this file, this constraint" rather than
 * "your import failed".
 */
async function runChunk(
	entries: SourceEntry[],
	pg: PGliteInterface,
	build: ChunkBuilder,
	report: IngestReport,
): Promise<string[]> {
	const files = await readAll(entries);
	const chunk = await build(files);
	const failuresBefore = report.failures.length;
	report.failures.push(...chunk.failures);

	try {
		const result = await applyChunk(pg, chunk);
		report.runs += result.runs;
		report.aborts += result.aborts;
		report.perfsMatched += result.perfsMatched;
		report.ambiguousPerfs.push(...result.ambiguousPerfs);
		report.hashMismatches.push(...result.hashMismatches);
		return result.orphanPerfs;
	} catch (err) {
		if (entries.length === 1) {
			report.failures.push({
				name: entries[0]!.name,
				error: err instanceof Error ? err.message : String(err),
			});
			return [];
		}
		// The per-file retries rebuild the same files and would report the same
		// parse failures a second time, so drop this chunk's before recursing.
		report.failures.length = failuresBefore;
		const orphans: string[] = [];
		for (const entry of entries) orphans.push(...(await runChunk([entry], pg, build, report)));
		return orphans;
	}
}
