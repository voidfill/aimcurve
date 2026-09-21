import { PGlite } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import { OpfsAhpFS } from '@electric-sql/pglite/opfs-ahp';
import { worker } from '@electric-sql/pglite/worker';

// PGlite is single-threaded WebAssembly: a bulk ingest is ~4 s of solid CPU,
// which would freeze the UI thread outright.
//
// OPFS access-handle-pool, not `idb://`: the IndexedDB filesystem hydrates the
// *entire* database into the in-memory Emscripten FS before the first query can
// run, so startup scaled with everything ever imported. The pool does real
// paged reads instead, which is why a dedicated worker is not just a nicety
// here — sync access handles are only available off the main thread.
//
// The filesystem is constructed by hand rather than named as
// `opfs-ahp://aimcurve`, because the URL form takes the pool defaults and there
// is no way to pass options through it. Passing `fs` bypasses dataDir parsing
// entirely and lands on the same OPFS directory, so an existing database is
// picked up unchanged — the resume check is `PG_VERSION` on the filesystem, not
// the dataDir string.
//
// Why both sizes are raised: a backing file leaves the pool the moment Postgres
// creates a relation, WAL segment or sort spill, and the pool is only refilled
// *between* protocol messages — `execProtocolRawSync` is one synchronous trip
// into wasm with no chance to allocate more. Run out mid-statement and the
// write path throws "No more file handles available in the pool".
//
// The numbers below are measured, not guessed. A fresh data directory is 971
// files, and the six migrations bring it to 1073:
//
//     $ find <fresh pglite datadir> -type f | wc -l   # 971, 1073 after schema
//
// That makes an *empty* database the worst case, not the best one. The first
// startup restores initdb's output through one uninterrupted `loadTar` loop
// with no sync point in it, so those 971 files come out of the pool in a single
// go — against PGlite's `initialPoolSize` default of 1000. A margin of 29 files
// is gone before the first migration runs.
//
// `initialPoolSize` therefore has to clear the restore with room for the schema
// behind it. `maintainedPoolSize` is a different ceiling: it is the free pool
// any one *later* statement gets, and the default of 100 is well under what an
// ingest chunk needs — six staging tables truncated (a TRUNCATE allocates a
// fresh relfilenode per relation, plus toast relations and their indexes), 200
// files COPYed in, then array_agg inserts large enough to spill to disk and
// churn WAL.
//
// Steady-state open handles are roughly 1073 + INGEST_HEADROOM. Both numbers
// trade startup latency for headroom; raise them if the error ever returns.
const FIRST_START = 2000;
const INGEST_HEADROOM = 1000;

void worker({
	async init() {
		return await PGlite.create({
			fs: new OpfsAhpFS('aimcurve', {
				initialPoolSize: FIRST_START,
				maintainedPoolSize: INGEST_HEADROOM,
			}),
			extensions: { live },
		});
	},
});
