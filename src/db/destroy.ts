/**
 * Putting this browser back to its first-visit state: the Data page's
 * "Delete local data". Only aimcurve's own stores; the user's KovaaK's files
 * are never touched, and neither is anything else on the origin.
 *
 * Three stores persist independently and none of them knows about the others:
 * the IndexedDB database PGlite runs on, the IndexedDB database holding the
 * picked folder handle, and aimcurve's localStorage keys (the import record,
 * display settings, and whether About was seen). A reset that clears two of the
 * three is worse than none at all — the app comes back claiming a connection or
 * an import that no longer has data behind it.
 *
 * So every step runs even when an earlier one throws, and what failed is
 * returned rather than thrown: the caller reloads the page afterwards, and an
 * error that vanishes into a reload is an error nobody ever sees.
 */
import { closePg } from './client';
import { PG_IDB_NAME, removeLegacyOpfs } from './store';
import { HANDLE_DB_NAME } from '../lib/ingest/handle-store';
import { errorText } from '../lib/error';
import { clearOwnKeys } from '../lib/storage';

/** Empty when everything is gone. Each entry names one store that survived. */
export type DestroyResult = string[];

/**
 * `deleteDatabase` neither resolves nor rejects while another connection is
 * open; it fires `blocked` and waits. `handle-store` closes its connection
 * after every operation, and `closePg()` has PGlite close its own, so this
 * should not happen — but "should not" is not a reason to hang the reset
 * forever, so a block is reported and moved past.
 */
function deleteDb(name: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error ?? new Error('delete failed'));
		request.onblocked = () => reject(new Error('another tab still has it open'));
	});
}

export async function destroyLocalData(): Promise<DestroyResult> {
	const failed: DestroyResult = [];

	// First, and on its own: deleting the database is blocked for as long as
	// PGlite holds a connection to it.
	try {
		await closePg();
	} catch (err) {
		failed.push(`connection: ${errorText(err)}`);
	}

	try {
		await deleteDb(PG_IDB_NAME);
	} catch (err) {
		failed.push(`database: ${errorText(err)}`);
	}

	// The worker removes it on every start too, but a reset should not leave
	// it behind if that removal has not got to it yet.
	try {
		await removeLegacyOpfs();
	} catch (err) {
		failed.push(`old database: ${errorText(err)}`);
	}

	try {
		await deleteDb(HANDLE_DB_NAME);
	} catch (err) {
		failed.push(`folder handle: ${errorText(err)}`);
	}

	try {
		clearOwnKeys(localStorage);
	} catch (err) {
		failed.push(`settings: ${errorText(err)}`);
	}

	return failed;
}
