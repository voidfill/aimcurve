/**
 * What one ingest pass did.
 *
 * `failures` is reported and never stored: a failed file is not in the dedupe
 * set, so a later parser fix picks it up on the next pass with no cache to
 * clear. That is the reason there is no `ingest_failure` table.
 */
export interface IngestReport {
	/** Run files (Stats CSVs and perfs) the source listed; anything else is ignored. */
	scanned: number;
	/** Run files excluded from ingest because their stem was already imported. */
	skipped: number;
	runs: number;
	aborts: number;
	perfsMatched: number;
	failures: { name: string; error: string }[];
	/** Perfs that matched nothing even after the end-of-pass retry. */
	orphanPerfs: string[];
	ambiguousPerfs: string[];
	hashMismatches: string[];
}
