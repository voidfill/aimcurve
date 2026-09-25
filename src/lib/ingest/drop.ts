/**
 * The files inside a drag-and-drop, folders included.
 *
 * A dropped folder arrives as a `FileSystemDirectoryEntry`, not as files, so it
 * has to be walked. The entries must be taken from the `DataTransferItemList`
 * synchronously inside the `drop` handler — the list is emptied the moment the
 * handler yields — which is why this takes entries rather than the event.
 *
 * Like `source-handle`, it selects on suffix rather than assuming a layout, so
 * dropping the KovaaK's folder, its `stats` folder, or a handful of loose files
 * all work.
 */
import { isPerf, isStats } from './classify';

/** The slice of `FileSystemEntry` this needs; structural so tests can fake it. */
export interface DropEntry {
	name: string;
	isFile: boolean;
	isDirectory: boolean;
}

interface FileEntry extends DropEntry {
	file(success: (file: File) => void, failure?: (err: unknown) => void): void;
}

interface DirectoryEntry extends DropEntry {
	createReader(): {
		readEntries(success: (entries: DropEntry[]) => void, failure?: (err: unknown) => void): void;
	};
}

function readFile(entry: FileEntry): Promise<File> {
	return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/**
 * `readEntries` hands back at most a batch at a time (100 in Chromium) and
 * signals the end with an empty batch, so a single call silently truncates any
 * folder bigger than one batch — which a year of stats always is.
 */
async function readAll(dir: DirectoryEntry): Promise<DropEntry[]> {
	const reader = dir.createReader();
	const all: DropEntry[] = [];
	for (;;) {
		const batch = await new Promise<DropEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
		if (batch.length === 0) return all;
		all.push(...batch);
	}
}

async function walk(entry: DropEntry, into: File[]): Promise<void> {
	if (entry.isDirectory) {
		for (const child of await readAll(entry as DirectoryEntry)) await walk(child, into);
	} else if (entry.isFile && (isStats(entry.name) || isPerf(entry.name))) {
		into.push(await readFile(entry as FileEntry));
	}
}

export async function filesFromEntries(entries: readonly DropEntry[]): Promise<File[]> {
	const files: File[] = [];
	for (const entry of entries) await walk(entry, files);
	return files;
}

/** Whether a drag carries files at all, as opposed to text or a link. */
export function dragHasFiles(types: readonly string[]): boolean {
	return types.includes('Files');
}
