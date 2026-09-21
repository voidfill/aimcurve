/**
 * Starts the database before the app asks for it.
 *
 * PGlite is ~16 MB of wasm and packaged data. Left to `useDb()`, none of that
 * begins downloading until Vue has mounted — so this runs as its own module
 * script in `index.html`, ahead of `main.ts`. Its dependency graph is just the
 * client and the worker glue, so the worker spawns and starts pulling wasm
 * while the app bundle is still in flight.
 *
 * Deliberately not imported from `main.ts`: ES modules all resolve before any
 * body runs, so an import there would still wait on the whole app graph.
 */
import { getPg } from './client';

// `useDb()` joins this same cached promise and owns reporting failures to the
// UI, so a rejection here is not this module's to report. `init()` drops its
// cache on failure, which leaves the retry path intact.
void getPg().catch(() => {});
