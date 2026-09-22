/**
 * The OPFS directory PGlite lives in.
 *
 * Its own module because `worker.ts` is the only other place that names it,
 * and importing *that* from the main thread would pull PGlite and its wasm
 * into the main bundle. A wipe that misses because the two strings drifted
 * apart is the failure this exists to prevent.
 */
export const OPFS_DIR = 'aimcurve';
