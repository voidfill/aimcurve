/**
 * Running one chunk against the database: COPY the staged rows in, run the
 * batch script, check the two assertions `docs/ingest.md` demands, truncate.
 *
 * Explicit begin/commit rather than `pg.transaction()`, because the COPY calls
 * need the `blob` query option on the same connection as the script.
 */
import type { PGliteInterface } from '@electric-sql/pglite';
import batchSql from './batch.sql?raw';
import { STAGE_TABLES, type ChunkResult } from './chunk';

export interface BatchResult {
	runs: number;
	aborts: number;
	perfsMatched: number;
	/** Perfs whose probe matched no run. Transient in watch mode; see the orchestrator. */
	orphanPerfs: string[];
	/** Perfs whose probe matched more than one run. Should be impossible. */
	ambiguousPerfs: string[];
	/** Perfs whose scenario hash disagrees with the run they matched. */
	hashMismatches: string[];
}

/**
 * The join, evaluated as a left join so one query answers the ambiguity
 * assertion: `n > 1` is ambiguous. Orphans are derived from the outcome
 * instead — see ORPHAN_SQL below.
 */
const PROBE_SQL = `
	select p.perf_file_stem as stem, count(r.id)::int as n
	from stage_perf p
	left join run r on r.kind = 'complete'
	               and r.span && tstzrange(p.challenge_start_utc,
	                                       p.challenge_start_utc + interval '1 second')
	group by p.perf_file_stem
	having count(r.id) <> 1
`;

/**
 * A perf that was staged but did not land in run_perf: either its probe
 * matched no run, or it matched a run that already had a perf and lost the
 * `on conflict do nothing` race. Stronger than `PROBE_SQL`'s `n = 0` arm,
 * which only catches the first case and silently drops the second forever,
 * since a stem that never reaches run_perf is never learned by knownStems().
 */
const ORPHAN_SQL = `
	select p.perf_file_stem as stem
	from stage_perf p
	left join run_perf rp on rp.perf_file_stem = p.perf_file_stem
	where rp.perf_file_stem is null
`;

/**
 * The CSV is the source of record for scenario identity, so a perf that matched
 * a run of a different scenario means the join is wrong, not that the hash is.
 */
const HASH_SQL = `
	select p.perf_file_stem as stem
	from stage_perf p
	join run      r on r.kind = 'complete'
	               and r.span && tstzrange(p.challenge_start_utc,
	                                       p.challenge_start_utc + interval '1 second')
	join scenario s on s.id = r.scenario_id
	where s.hash <> p.scenario_hash
`;

async function count(pg: PGliteInterface, sql: string): Promise<number> {
	const result = await pg.query<{ n: number }>(sql);
	return result.rows[0]?.n ?? 0;
}

export async function applyChunk(pg: PGliteInterface, chunk: ChunkResult): Promise<BatchResult> {
	await pg.exec('begin');
	try {
		for (const table of STAGE_TABLES) {
			const bytes = chunk.payloads[table];
			if (!bytes || bytes.length === 0) continue;
			await pg.query(`copy ${table} from '/dev/blob'`, [], { blob: new Blob([bytes]) });
		}

		const before = {
			runs: await count(pg, 'select count(*)::int as n from run'),
			aborts: await count(pg, 'select count(*)::int as n from unattributed_file'),
			perfs: await count(pg, 'select count(*)::int as n from run_perf'),
		};

		await pg.exec(batchSql);

		// PROBE_SQL and HASH_SQL run here, after batchSql and before the truncate,
		// not before batchSql as an earlier draft had it: before batchSql runs,
		// this chunk's own runs are not yet in `run`, so every perf staged
		// alongside its own CSV would probe against zero runs and be reported as
		// an orphan. At this point `run` holds this chunk's rows and the
		// stage_* tables are still populated, which is what both queries need.
		// Do not move these back above batchSql.
		const probe = await pg.query<{ stem: string; n: number }>(PROBE_SQL);
		const orphans = await pg.query<{ stem: string }>(ORPHAN_SQL);
		const hashes = await pg.query<{ stem: string }>(HASH_SQL);

		const result: BatchResult = {
			runs: (await count(pg, 'select count(*)::int as n from run')) - before.runs,
			aborts: (await count(pg, 'select count(*)::int as n from unattributed_file')) - before.aborts,
			perfsMatched: (await count(pg, 'select count(*)::int as n from run_perf')) - before.perfs,
			orphanPerfs: orphans.rows.map((row) => row.stem),
			ambiguousPerfs: probe.rows.filter((row) => row.n > 1).map((row) => row.stem),
			hashMismatches: hashes.rows.map((row) => row.stem),
		};

		await pg.exec(`truncate ${STAGE_TABLES.join(', ')}`);
		await pg.exec('commit');
		return result;
	} catch (err) {
		try {
			await pg.exec('rollback');
		} catch {
			// The rollback failing must not mask the original error.
		}
		throw err;
	}
}
