/**
 * Which import actions a connection state offers. The header's import control
 * and the Data page both render from this, so they can never disagree.
 *
 * Import once is not here because it is always offered: it is a file input,
 * which works in every browser and — unlike the directory picker — in Program
 * Files. Everything folder-shaped needs `showDirectoryPicker`, so it is gated
 * on `canPick`.
 */
import type { Connection } from './import-controller';

export interface ImportOptions {
	/** A folder is being watched; importing once would stop that. */
	live: boolean;
	/** A stored folder handle is waiting for permission again. */
	reconnect: boolean;
	/** `connect`, `another` (with a Reconnect beside it), or not offered. */
	connect: 'connect' | 'another' | null;
	/**
	 * A live watcher, a stored permission, or both exist to drop. `none` has
	 * neither, and neither does `snapshot`: its handle is already cleared.
	 */
	disconnect: boolean;
}

export function importOptions(connection: Connection, canPick: boolean): ImportOptions {
	const live = connection === 'connected';
	const reconnect = canPick && connection === 'reconnect';
	return {
		live,
		reconnect,
		connect: !canPick || live ? null : reconnect ? 'another' : 'connect',
		disconnect: connection !== 'none' && connection !== 'snapshot',
	};
}
