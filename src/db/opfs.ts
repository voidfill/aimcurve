/**
 * The OPFS directory PGlite lives in.
 *
 * Its own module because `worker.ts` is the only other place that names it,
 * and importing *that* from the main thread would pull PGlite and its wasm
 * into the main bundle. A wipe that misses because the two strings drifted
 * apart is the failure this exists to prevent.
 */
export const OPFS_DIR = 'aimcurve';

/**
 * Asks the database worker to close PGlite, which releases every sync access
 * handle of the pool before the worker answers. `worker.terminate()` alone
 * releases them only some time later: measured, the directory stayed locked
 * for about 2 s after it returned.
 */
export const CLOSE_REQUEST = 'aimcurve:close';

/** The worker's answer: whether this worker held the database. */
export interface CloseReply {
	type: 'aimcurve:closed';
	held: boolean;
}
