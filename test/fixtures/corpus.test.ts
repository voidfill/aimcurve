/**
 * Ingest-level invariants swept over the full dump.
 *
 * These are properties of the *corpus*, not of any one file, so they cannot be
 * pinned by a curated fixture. They guard on `raw.available` and skip on a fresh
 * clone; `curated.test.ts` holds the same claims against the committed subset.
 */
import { fromBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { PerformanceFileSchema } from '../../src/gen/perf_pb';
import { raw } from '../helpers/fixtures';

const FILENAME = /^(.*?) - (?:Challenge - )?(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}) Stats\.csv$/;

interface Row {
	name: string;
	hash: string;
	startedAt: number;
	writtenAt: number;
	partial: boolean;
}

function rows(): Row[] {
	return raw.list('stats').flatMap((name) => {
		const text = raw.text('stats', name);
		const get = (key: string) => (new RegExp(`^${key}:,(.*)$`, 'm').exec(text) || [])[1]?.replace(/\r$/, '') ?? '';
		const parts = FILENAME.exec(name);
		if (!parts) return [];
		const clock = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(get('Challenge Start'));
		if (!clock) return [];
		const writtenAt = new Date(+parts[2]!, +parts[3]! - 1, +parts[4]!, +parts[5]!, +parts[6]!, +parts[7]!).getTime();
		let startedAt = new Date(+parts[2]!, +parts[3]! - 1, +parts[4]!, +clock[1]!, +clock[2]!, +clock[3]!, +clock[4]!).getTime();
		if (startedAt > writtenAt + 60_000) startedAt -= 86_400_000;
		const partial = get('Hash') === '' || get('Scenario') === '' || writtenAt + 999 - startedAt < 1_000;
		return [{ name, hash: get('Hash'), startedAt, writtenAt, partial }];
	});
}

describe.skipIf(!raw.available)('corpus invariants', () => {
	const all = rows();
	const complete = all.filter((row) => !row.partial);
	const perfs = raw.list('performances').map((name) => ({
		name,
		header: fromBinary(PerformanceFileSchema, raw.bytes('performances', name)).header!,
	}));

	const ownerOf = (hash: string, start: number) =>
		complete.filter((row) => row.hash === hash && start >= row.startedAt - 1_000 && start <= row.writtenAt + 999);

	it('has no perf-only runs — `.perf` is a subset of `.csv`', () => {
		// If this ever fails, the join regressed or something deleted a CSV
		// without considering its perf. Both are bugs; neither is data to
		// salvage. See "The CSV is the spine" in docs/ingest.md.
		const orphans = perfs.filter((perf) => ownerOf(perf.header.scenarioHash, Number(perf.header.challengeStartUtc)).length === 0);
		expect(orphans.map((perf) => perf.name)).toEqual([]);
	});

	it('assigns every perf to exactly one run', () => {
		const ambiguous = perfs.filter((perf) => ownerOf(perf.header.scenarioHash, Number(perf.header.challengeStartUtc)).length > 1);
		expect(ambiguous.map((perf) => perf.name)).toEqual([]);
	});

	it('never lets one run claim two perfs', () => {
		const claims = new Map<string, number>();
		for (const perf of perfs) {
			const owner = ownerOf(perf.header.scenarioHash, Number(perf.header.challengeStartUtc))[0];
			if (owner) claims.set(owner.name, (claims.get(owner.name) ?? 0) + 1);
		}
		expect([...claims.entries()].filter(([, count]) => count > 1)).toEqual([]);
	});

	it('keeps CSV-only runs, which are normal rather than broken', () => {
		const claimed = new Set(perfs.map((perf) => ownerOf(perf.header.scenarioHash, Number(perf.header.challengeStartUtc))[0]?.name));
		const csvOnly = complete.filter((row) => !claimed.has(row.name));
		// Pre-3.9.0, before .perf existed. Not a defect, and not droppable:
		// it is the earliest history, where progression is most visible.
		expect(csvOnly.length).toBeGreaterThan(100);
	});

	it('never writes two runs of different scenarios in the same second', () => {
		// Note what this does NOT show. The write timestamp is read back out of
		// the filename, so two writes of the SAME scenario in one second would
		// have produced one filename, and we would be looking at a single
		// surviving file. That collision is unobservable after the fact — no
		// corpus scan can rule it out, only a watcher catching the write.
		//
		// What it does show: across scenarios, where the filenames differ and a
		// collision would be visible, it has never happened.
		const seen = new Map<string, string>();
		for (const row of all) {
			const key = String(row.writtenAt);
			expect(seen.get(key), `${row.name} collides with ${seen.get(key)}`).toBeUndefined();
			seen.set(key, row.name);
		}
	});
});
