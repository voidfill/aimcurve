/**
 * Persisting the picked directory across reloads.
 *
 * A `FileSystemDirectoryHandle` is structured-cloneable, so IndexedDB stores it
 * directly. Its own tiny database, separate from PGlite's `idb://aimcurve`,
 * because the two have nothing to do with each other and a migrator reset must
 * not cost the user their folder.
 *
 * The permission split matters: `queryPermission` is free and can be called on
 * load, but `requestPermission` **requires a user gesture**. Watch mode
 * therefore cannot silently resume — the UI needs a reconnect affordance. That
 * is a constraint on the feature, not an implementation detail.
 */

/**
 * `queryPermission`/`requestPermission` are part of the File System Access API
 * but are not declared by stock lib.dom, so they are ambiently declared here
 * rather than pulled in via an `@types` package or typed away with `any`.
 */
declare global {
	interface FileSystemHandle {
		queryPermission(descriptor: { mode: 'read' }): Promise<PermissionState>;
		requestPermission(descriptor: { mode: 'read' }): Promise<PermissionState>;
	}
}

const DB_NAME = 'aimcurve-handles';
const STORE = 'handles';
const KEY = 'stats-root';

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await open();
	try {
		return await new Promise<T>((resolve, reject) => {
			const request = body(db.transaction(STORE, mode).objectStore(STORE));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
	await run('readwrite', (store) => store.put(handle, KEY));
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
	return (await run<FileSystemDirectoryHandle | undefined>('readonly', (store) => store.get(KEY))) ?? null;
}

export async function clearDirectoryHandle(): Promise<void> {
	await run('readwrite', (store) => store.delete(KEY));
}

/** Free to call on page load. False means a gesture is needed. */
export async function hasReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
	return (await handle.queryPermission({ mode: 'read' })) === 'granted';
}

/** Must be called from a user gesture, or it resolves to false. */
export async function requestReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
	return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}
