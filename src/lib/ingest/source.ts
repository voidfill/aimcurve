/**
 * Where files come from. Three implementations, one ingester.
 *
 * `list()` returns names only and opens nothing: listing 5,000 names costs
 * microseconds, and the whole dedupe strategy rests on never opening a file
 * whose stem is already in the database.
 */
export interface SourceEntry {
	/** The filename, with its ` Stats.csv` or ` Performance.perf` suffix. */
	name: string;
	open(): Promise<File>;
}

export interface FileSource {
	/** Every file present now. Names only. */
	list(): Promise<SourceEntry[]>;
	/**
	 * Fires when the folder changes; returns an unsubscribe. Absent when the
	 * source cannot watch, which is every source but `source-handle`.
	 */
	watch?(onChange: () => void): () => void;
}
