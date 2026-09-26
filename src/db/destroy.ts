/**
 * Putting this browser back to its first-visit state. Development only.
 *
 * Three stores persist independently and none of them knows about the others:
 * the OPFS data directory PGlite runs on, the IndexedDB database holding the
 * picked folder handle, and the localStorage record of the last import. A
 * reset that clears two of the three is worse than none at all — the app comes
 * back claiming a connection or an import that no longer has data behind it.
 *
 * So every step runs even when an earlier one throws, and what failed is
 * returned rather than thrown: the caller reloads the page afterwards, and an
 * error that vanishes into a reload is an error nobody ever sees.
 */
import { closePg } from './client';
import { OPFS_DIR } from './opfs';
import { HANDLE_DB_NAME } from '../lib/ingest/handle-store';
import { errorText } from '../lib/error';
import { STORAGE_KEY } from '../lib/run/import-controller';

/** Empty when everything is gone. Each entry names one store that survived. */
export type DestroyResult = string[];

/** A missing directory is the state we are trying to reach, not a failure. */
async function removeDataDir(): Promise<void> {
	try {
		await (await navigator.storage.getDirectory()).removeEntry(OPFS_DIR, { recursive: true });
	} catch (err) {
		if (err instanceof DOMException && err.name === 'NotFoundError') return;
		throw err;
	}
}

/**
 * `deleteDatabase` neither resolves nor rejects while another connection is
 * open; it fires `blocked` and waits. `handle-store` closes its connection
 * after every operation, so this should not happen — but "should not" is not a
 * reason to hang the reset forever, so a block is reported and moved past.
 */
function deleteHandleDb(): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(HANDLE_DB_NAME);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error ?? new Error('delete failed'));
		request.onblocked = () => reject(new Error('another tab still has it open'));
	});
}

export async function destroyLocalData(): Promise<DestroyResult> {
	const failed: DestroyResult = [];

	// First, and on its own: the rest is harmless, but removing the data
	// directory while the access-handle pool still holds it is not.
	try {
		await closePg();
	} catch (err) {
		failed.push(`connection: ${errorText(err)}`);
	}

	try {
		await removeDataDir();
	} catch (err) {
		failed.push(`database: ${errorText(err)}`);
	}

	try {
		await deleteHandleDb();
	} catch (err) {
		failed.push(`folder handle: ${errorText(err)}`);
	}

	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch (err) {
		failed.push(`import record: ${errorText(err)}`);
	}

	return failed;
}
