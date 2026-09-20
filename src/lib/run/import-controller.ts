/**
 * The import lifecycle: which folder or snapshot we are ingesting, whether a
 * pass is running, and what the last settled pass did.
 *
 * This module imports nothing from Vue — not even `@vueuse/core`, which pulls
 * Vue in transitively. A composable mirrors `onState` into a reactive object;
 * everything here is plain TypeScript so the lifecycle can be reasoned about
 * (and, later, driven) without a component tree.
 *
 * Two invariants carry most of the weight:
 *
 * 1. Passes are serialized. `applyChunk` writes through *shared* staging
 *    tables inside explicit transactions, so two overlapping passes corrupt
 *    each other's staging rows. One in-flight promise plus one dirty flag
 *    coalesces a watcher burst into at most one trailing pass.
 * 2. Sources are replaced under a generation counter. The previous watcher
 *    stops immediately, its in-flight pass is allowed to finish (the worker it
 *    depends on is never torn down under it), and only then does the
 *    replacement become active. A stale pass still reloads committed data —
 *    its rows are in the database — but never writes to the UI state.
 */
import type { PGliteInterface } from '@electric-sql/pglite';
import { bulkSource } from '../ingest/source-bulk';
import { handleSource } from '../ingest/source-handle';
import {
	clearDirectoryHandle,
	hasReadPermission,
	loadDirectoryHandle,
	requestReadPermission,
	saveDirectoryHandle,
} from '../ingest/handle-store';
import { ingest } from '../ingest/index';
import type { IngestReport } from '../ingest/report';
import type { FileSource } from '../ingest/source';
import { workerBuilder } from '../ingest/worker';
import type { ChunkBuilder } from '../ingest/index';

/**
 * - `none`: nothing is connected. Connect and Import files are both offered.
 * - `connected`: a folder is connected and is being checked for newly
 *   completed attempts while this page is open.
 * - `reconnect`: a folder handle exists but is not readable without a user
 *   gesture. Automatic scanning is stopped; imported rows are untouched.
 * - `snapshot`: a one-time set of files was imported. Nothing is watched.
 * - `error`: the last pass failed for a reason that is not permission loss.
 *   Imported rows are untouched and Retry is offered.
 */
export type Connection = 'none' | 'connected' | 'reconnect' | 'snapshot' | 'error';

export interface ImportState {
	connection: Connection;
	busy: boolean;
	progress: { done: number; total: number } | null;
	/**
	 * The report of this session's latest settled pass, held in memory only.
	 * Its counts are not what they look like: `runs` includes resets, `aborts`
	 * are unattributed files, and `skipped` combines already-known stems with
	 * unsupported suffixes.
	 */
	report: IngestReport | null;
	lastImportAt: string | null;
	message: string | null;
}

export interface ImportController {
	restore(): Promise<void>;
	connect(): Promise<void>;
	reconnect(): Promise<void>;
	importFiles(files: FileList | File[]): Promise<void>;
	disconnect(): Promise<void>;
	retryScan(): Promise<void>;
	dispose(): void;
}

export function initialImportState(): ImportState {
	return {
		connection: 'none',
		busy: false,
		progress: null,
		report: null,
		lastImportAt: null,
		message: null,
	};
}

/* -------------------------------------------------------------------------- */
/* Persisted metadata                                                          */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = 'aimcurve.import';
const SCHEMA_VERSION = 1;

type SourceMode = 'folder' | 'snapshot';

interface PersistedMeta {
	version: typeof SCHEMA_VERSION;
	lastImportAt: string | null;
	mode: SourceMode | null;
}

/**
 * Only what survives a reload: a timestamp and which kind of source produced
 * it. Report details stay in memory — they describe this session's latest
 * pass, and a stale one read back from storage would be a lie about the
 * current session. An unrecognized `version` is discarded rather than
 * migrated; there is nothing here worth migrating.
 */
function loadMeta(): PersistedMeta | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw === null) return null;
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return null;
		const record = parsed as Record<string, unknown>;
		if (record.version !== SCHEMA_VERSION) return null;
		return {
			version: SCHEMA_VERSION,
			lastImportAt: typeof record.lastImportAt === 'string' ? record.lastImportAt : null,
			mode: record.mode === 'folder' || record.mode === 'snapshot' ? record.mode : null,
		};
	} catch {
		// Blocked site data, a quota error, or corrupt JSON. Starting from
		// nothing is correct: this record is a convenience, not data.
		return null;
	}
}

/** False when the write was refused. Never throws: this is not import data. */
function saveMeta(meta: PersistedMeta): boolean {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
		return true;
	} catch {
		return false;
	}
}

/* -------------------------------------------------------------------------- */
/* Directory picker                                                            */
/* -------------------------------------------------------------------------- */

type DirectoryPicker = (options?: {
	id?: string;
	mode?: 'read' | 'readwrite';
}) => Promise<FileSystemDirectoryHandle>;

/**
 * Not typed by stock lib.dom, and absent entirely in Firefox and Safari — and
 * in Chromium wherever the picker's blocklist covers the path the user would
 * pick. Resolved through a cast rather than a global declaration so no other
 * module inherits an optimistic type for it.
 */
function directoryPicker(): DirectoryPicker | null {
	const fn = (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
	return typeof fn === 'function' ? (fn as DirectoryPicker) : null;
}

/** Whether Connect can work at all here. The UI offers snapshot import regardless. */
export function canPickDirectory(): boolean {
	return directoryPicker() !== null;
}

function isAbort(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'AbortError';
}

function errorText(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

const WATCHING =
	'Checking for newly completed attempts while this page is open.';
const SNAPSHOT =
	'Imported the files you selected. This is a one-time snapshot — new attempts will not appear until you import again.';
const SNAPSHOT_RESTORED =
	'The last import was a one-time snapshot. Import those files again to pick up attempts completed since.';
const NO_PICKER =
	'This browser cannot connect to a folder. Import a snapshot of your stats files instead.';
const HANDLE_WARNING =
	'Imported. The browser would not remember this folder, so you will have to pick it again after a reload.';
const META_WARNING = 'Imported. The browser would not remember when this import happened.';

/** A truthful one-liner about what the pass could not do. Null when it did it all. */
function warningFor(report: IngestReport): string | null {
	const parts: string[] = [];
	if (report.failures.length > 0) {
		parts.push(
			`${report.failures.length} ${report.failures.length === 1 ? 'file' : 'files'} could not be read or parsed`,
		);
	}
	if (report.orphanPerfs.length > 0) {
		parts.push(
			`${report.orphanPerfs.length} performance ${report.orphanPerfs.length === 1 ? 'file' : 'files'} matched no attempt`,
		);
	}
	if (report.hashMismatches.length > 0) parts.push(`${report.hashMismatches.length} hash mismatches`);
	if (parts.length === 0) return null;
	return `${parts.join('; ')}. Everything else was imported.`;
}

/* -------------------------------------------------------------------------- */
/* Controller                                                                  */
/* -------------------------------------------------------------------------- */

interface ActiveSource {
	gen: number;
	mode: SourceMode;
	source: FileSource;
	/** Present only for `mode === 'folder'`; the permission recheck needs it. */
	handle: FileSystemDirectoryHandle | null;
	stop: (() => void) | null;
}

export function createImportController(
	pg: PGliteInterface,
	onState: (state: ImportState) => void,
	onCommitted: () => Promise<void>,
): ImportController {
	const state = initialImportState();

	/**
	 * Bumped on every source replacement and on disconnect. A pass compares the
	 * generation it started under against this before touching `state`.
	 */
	let generation = 0;
	let active: ActiveSource | null = null;
	let savedHandle: FileSystemDirectoryHandle | null = null;

	let inFlight: Promise<void> | null = null;
	let dirty = false;
	/** A picker/source switch is running. Repeat picker actions are refused. */
	let switching = false;
	let restored = false;
	let disposed = false;

	let worker: Worker | null = null;
	let build: ChunkBuilder | null = null;

	function patch(next: Partial<ImportState>): void {
		Object.assign(state, next);
		onState({ ...state });
	}

	/**
	 * One worker for the controller's lifetime, which is the document's
	 * lifetime. It is never recreated per pass and never terminated on a route
	 * change: a live ingest promise resolves through it.
	 */
	function builder(): ChunkBuilder {
		if (build === null) {
			worker = new Worker(new URL('../ingest/worker.ts', import.meta.url), { type: 'module' });
			build = workerBuilder(worker);
		}
		return build;
	}

	function persist(mode: SourceMode | null, lastImportAt: string | null): boolean {
		return saveMeta({ version: SCHEMA_VERSION, lastImportAt, mode });
	}

	function idleMessage(): string | null {
		if (state.connection === 'connected') return WATCHING;
		if (state.connection === 'snapshot') return SNAPSHOT;
		return null;
	}

	/* ---------------------------------------------------------------- passes */

	/**
	 * At most one pass runs at a time. A request arriving while one runs sets
	 * the dirty flag, which the loop consumes once — a burst of watcher events
	 * therefore produces exactly one trailing pass, not one per event.
	 */
	function schedule(): Promise<void> {
		if (inFlight !== null) {
			dirty = true;
			return inFlight;
		}
		inFlight = (async () => {
			try {
				do {
					dirty = false;
					await runPass();
				} while (dirty && !disposed && active !== null);
			} finally {
				inFlight = null;
				// Released here and nowhere else, so no early return, throw, or
				// stale-generation bail can leave the UI stuck on "busy".
				if (!disposed) patch({ busy: false, progress: null });
			}
		})();
		return inFlight;
	}

	async function runPass(): Promise<void> {
		const current = active;
		if (current === null) return;
		const gen = current.gen;

		if (gen === generation) patch({ busy: true, progress: { done: 0, total: 0 }, message: idleMessage() });

		let report: IngestReport | null = null;
		let failure: unknown = null;
		try {
			report = await ingest(current.source, pg, {
				build: builder(),
				onProgress: (done, total) => {
					if (gen === generation && !disposed) patch({ progress: { done, total } });
				},
			});
		} catch (err) {
			failure = err;
		}

		// After *every* settled pass, including one that threw partway through:
		// the chunks that committed before the throw are in the database, and a
		// view that does not reload them is showing stale data.
		await onCommitted();

		// A superseded pass has already done the only thing that still matters.
		if (gen !== generation || disposed) return;

		// `ingest` reports per-file read failures rather than throwing, so a
		// revoked read permission can surface either as a thrown pass or as a
		// pass full of failures. Both are rechecked before classifying.
		if (current.mode === 'folder' && current.handle !== null) {
			const suspect = failure !== null || (report !== null && report.failures.length > 0);
			if (suspect && !(await hasReadPermission(current.handle))) {
				if (gen !== generation || disposed) return;
				stopActive();
				savedHandle = current.handle;
				patch({
					connection: 'reconnect',
					report,
					message:
						'Read access to this folder was lost. Everything already imported is still here — reconnect to resume checking.',
				});
				return;
			}
			if (gen !== generation || disposed) return;
		}

		if (failure !== null || report === null) {
			patch({
				connection: 'error',
				message: `The last scan failed: ${errorText(failure)}. Everything already imported is still here.`,
			});
			return;
		}

		const at = new Date().toISOString();
		const savedOk = persist(current.mode, at);
		patch({
			report,
			lastImportAt: at,
			message: warningFor(report) ?? (savedOk ? idleMessage() : META_WARNING),
		});
	}

	/* --------------------------------------------------------------- sources */

	function stopActive(): void {
		active?.stop?.();
		if (active !== null) active.stop = null;
		active = null;
	}

	/**
	 * Replace the active source. The previous watcher stops before anything is
	 * awaited, so no further events are queued against a source on its way out;
	 * the in-flight pass is then allowed to run to completion rather than being
	 * cut off mid-transaction.
	 */
	async function replaceSource(next: { mode: SourceMode; handle: FileSystemDirectoryHandle | null; source: FileSource }): Promise<void> {
		generation += 1;
		const gen = generation;
		stopActive();

		if (inFlight !== null) await inFlight.catch(() => {});
		// Another replacement won the race while the old pass drained.
		if (gen !== generation || disposed) return;

		const entry: ActiveSource = { gen, mode: next.mode, source: next.source, handle: next.handle, stop: null };
		active = entry;
		patch({
			connection: next.mode === 'folder' ? 'connected' : 'snapshot',
			report: null,
			message: next.mode === 'folder' ? WATCHING : SNAPSHOT,
		});

		// Registered *before* the first scan, so a file written during that scan
		// schedules a trailing pass instead of being missed until the next event.
		if (next.source.watch !== undefined) {
			entry.stop = next.source.watch(() => {
				if (active === entry && !disposed) void schedule();
			});
		}

		await schedule();
	}

	async function activateFolder(handle: FileSystemDirectoryHandle): Promise<void> {
		savedHandle = handle;
		await replaceSource({ mode: 'folder', handle, source: handleSource(handle) });
		// Failing to remember the folder is a recoverable warning about *next*
		// time, not a failed import: everything this pass committed is committed.
		try {
			await saveDirectoryHandle(handle);
		} catch {
			// Only replaces the idle label, never a message about what the pass
			// itself could not do.
			if (state.connection === 'connected' && state.message === WATCHING) patch({ message: HANDLE_WARNING });
		}
	}

	/* --------------------------------------------------------------- actions */

	async function restore(): Promise<void> {
		if (restored || disposed) return;
		restored = true;

		const meta = loadMeta();
		patch({ lastImportAt: meta?.lastImportAt ?? null });

		let handle: FileSystemDirectoryHandle | null = null;
		try {
			handle = await loadDirectoryHandle();
		} catch {
			handle = null;
		}
		if (handle === null) {
			// A snapshot's timestamp survives, but its `FileList` does not: the
			// UI offers Reimport, which is a fresh pick.
			patch({ connection: 'none', message: meta?.mode === 'snapshot' ? SNAPSHOT_RESTORED : null });
			return;
		}
		savedHandle = handle;

		// The last explicit choice was a snapshot, so this leftover handle is
		// not a connection the user asked to keep. Offer it; never resume it.
		if (meta?.mode === 'snapshot') {
			patch({ connection: 'reconnect', message: 'Reconnect to resume checking the folder you had connected.' });
			return;
		}

		// `queryPermission` is free and gesture-free. `requestPermission` is
		// not, and prompting on load without a gesture would be both a silent
		// prompt and a guaranteed denial.
		let granted = false;
		try {
			granted = await hasReadPermission(handle);
		} catch {
			granted = false;
		}
		if (!granted) {
			patch({ connection: 'reconnect', message: 'Reconnect to resume checking this folder for new attempts.' });
			return;
		}

		await replaceSource({ mode: 'folder', handle, source: handleSource(handle) });
	}

	async function connect(): Promise<void> {
		// Only a pending switch blocks a switch. A scan in progress does not:
		// `replaceSource` drains it, and refusing to let the user pick a
		// different folder during a long scan would be its own bug.
		if (disposed || switching) return;

		// Nothing may be awaited before this call: an `await` spends the user
		// activation the picker requires, and a Vue `@click` handler does not
		// change that. The permission check, the handle save, and every other
		// asynchronous step happen *after* the handle is in hand.
		const pick = directoryPicker();
		if (pick === null) {
			patch({ message: NO_PICKER });
			return;
		}
		// Set before the picker is awaited, so a second click cannot open a
		// second picker while this switch is pending.
		switching = true;
		let picked = false;
		try {
			const handle = await pick.call(globalThis, { id: 'aimcurve-stats', mode: 'read' });
			picked = true;
			await activateFolder(handle);
		} catch (err) {
			// Cancelling the picker is not an error and must leave whatever was
			// connected before exactly as it was.
			if (picked) patch({ connection: 'error', message: `Could not use that folder: ${errorText(err)}` });
			else if (!isAbort(err)) patch({ message: `${NO_PICKER} (${errorText(err)})` });
		} finally {
			switching = false;
		}
	}

	async function reconnect(): Promise<void> {
		if (disposed || switching) return;
		const handle = savedHandle;
		if (handle === null) {
			patch({ message: 'There is no saved folder to reconnect to. Connect a folder instead.' });
			return;
		}

		// Straight at the already-loaded handle, for the same activation reason
		// as the picker: no IndexedDB round-trip in front of it.
		switching = true;
		let granted = false;
		try {
			granted = await requestReadPermission(handle);
		} catch (err) {
			patch({ message: `Could not request access to the folder: ${errorText(err)}` });
			switching = false;
			return;
		}
		if (!granted) {
			switching = false;
			patch({
				connection: 'reconnect',
				message: 'Access to the folder was not granted. Everything already imported is still here.',
			});
			return;
		}

		try {
			await activateFolder(handle);
		} finally {
			switching = false;
		}
	}

	async function importFiles(files: FileList | File[]): Promise<void> {
		if (disposed || switching) return;
		// Copied immediately: the caller resets the input value right after, so
		// the same selection can be picked again, and a live `FileList` would go
		// empty underneath us.
		const selected = Array.from(files);
		if (selected.length === 0) return;

		switching = true;
		try {
			await replaceSource({ mode: 'snapshot', handle: null, source: bulkSource(selected) });
			// An explicit snapshot is a choice to stop watching a folder. The
			// watcher is already stopped by `replaceSource`; dropping the saved
			// handle is what stops the next reload from resuming it.
			savedHandle = null;
			try {
				await clearDirectoryHandle();
			} catch {
				// The snapshot still imported. `mode: 'snapshot'` in the
				// metadata keeps restore from resuming the stale handle anyway.
			}
			if (!persist('snapshot', state.lastImportAt)) {
				if (state.message === SNAPSHOT) patch({ message: META_WARNING });
			}
		} finally {
			switching = false;
		}
	}

	async function disconnect(): Promise<void> {
		if (disposed || switching) return;
		switching = true;
		generation += 1;
		stopActive();
		if (inFlight !== null) await inFlight.catch(() => {});

		savedHandle = null;
		try {
			await clearDirectoryHandle();
		} catch {
			// Nothing is watched either way; the handle simply outlives the
			// session. Restore re-offers it as Reconnect, never as a resume.
		}
		persist(null, state.lastImportAt);
		patch({
			connection: 'none',
			busy: false,
			progress: null,
			message: 'Disconnected. Everything already imported is still here.',
		});
		switching = false;
	}

	async function retryScan(): Promise<void> {
		if (disposed) return;
		if (active === null) {
			patch({ message: 'There is nothing to scan. Connect a folder or import files.' });
			return;
		}
		if (state.connection === 'error') patch({ connection: active.mode === 'folder' ? 'connected' : 'snapshot' });
		await schedule();
	}

	function dispose(): void {
		disposed = true;
		stopActive();
		// The worker outlives any single view and is torn down only once no
		// ingest promise can still be waiting on a reply from it.
		const pending = inFlight;
		const terminate = () => {
			worker?.terminate();
			worker = null;
			build = null;
		};
		if (pending === null) terminate();
		else void pending.catch(() => {}).then(terminate);
	}

	return { restore, connect, reconnect, importFiles, disconnect, retryScan, dispose };
}
