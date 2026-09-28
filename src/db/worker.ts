import { PGlite } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import { worker } from '@electric-sql/pglite/worker';
import { CLOSE_REQUEST, type CloseReply, DATA_DIR, removeLegacyOpfs } from './store';

// PGlite is single-threaded WebAssembly: a bulk ingest is ~4 s of solid CPU,
// which would freeze the UI thread outright.
//
// `idb://`, not the OPFS access-handle pool this used to run on. The pool
// keeps one sync access handle per Postgres file and opens all of them at
// startup: ~1,100 files plus its spare handles. Firefox opens each one slowly,
// and on a real history (2,703 runs, a 19 MB database) that took 17 s, against
// 0.55 s for IndexedDB. IndexedDB loads the whole data directory into memory
// first, so startup grows with the data, but slowly: 1.2 s at ten times that
// history.
//
// `relaxedDurability` returns from a query before its changes reach
// IndexedDB instead of waiting on the flush — ~220 ms per statement, measured,
// and an ingest chunk is about ten of them. A tab that dies mid-flush loses its
// last writes, which a re-import brings back. `close()` still flushes.

/** Set once this worker has won the election and opened the database. */
let db: PGlite | null = null;

// The dev reset's close (see `CLOSE_REQUEST`). A worker that is not the leader
// never opened the database, so it has nothing to release and says so.
addEventListener('message', (event: MessageEvent<{ type?: unknown }>) => {
	if (event.data?.type !== CLOSE_REQUEST) return;
	const held = db !== null;
	void (db?.close() ?? Promise.resolve()).finally(() => postMessage({ type: 'aimcurve:closed', held } satisfies CloseReply));
});

void worker({
	async init() {
		// Not awaited: nothing reads it, and a tab still running the old build
		// holds it locked. That removal fails and the next start tries again.
		void removeLegacyOpfs().catch(() => {});
		db = await PGlite.create({
			dataDir: `idb://${DATA_DIR}`,
			relaxedDurability: true,
			extensions: { live },
		});
		return db;
	},
});
