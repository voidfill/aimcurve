import { PGlite } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import { worker } from '@electric-sql/pglite/worker';

// PGlite is single-threaded WebAssembly: a bulk ingest is ~4 s of solid CPU,
// which would freeze the UI thread outright.
void worker({
	async init() {
		return await PGlite.create('idb://aimcurve', { extensions: { live } });
	},
});
