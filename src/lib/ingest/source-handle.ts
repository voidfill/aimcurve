/**
 * A source over a `FileSystemDirectoryHandle`, and the only one that can watch.
 *
 * It recurses from the picked root and selects on suffix rather than assuming a
 * directory layout, so the user picks once regardless of where KovaaK's puts
 * its two output folders.
 */
import { isPerf, isStats } from './classify';
import type { FileSource, SourceEntry } from './source';

const DEBOUNCE_MS = 250;
const POLL_MS = 10_000;

/** True when this browser has `FileSystemObserver`. Chromium-only, and recent. */
export function canWatch(): boolean {
	return typeof (globalThis as { FileSystemObserver?: unknown }).FileSystemObserver === 'function';
}

async function walk(dir: FileSystemDirectoryHandle, into: SourceEntry[]): Promise<void> {
	for await (const entry of dir.values()) {
		if (entry.kind === 'directory') {
			await walk(entry, into);
		} else if (isStats(entry.name) || isPerf(entry.name)) {
			into.push({ name: entry.name, open: () => entry.getFile() });
		}
	}
}

export function handleSource(root: FileSystemDirectoryHandle): FileSource {
	return {
		async list(): Promise<SourceEntry[]> {
			const entries: SourceEntry[] = [];
			await walk(root, entries);
			return entries;
		},

		/**
		 * The observer is a *trigger*, not a data source: its records can be
		 * `unknown` — coalesced changes carrying no usable path — so a correct
		 * handler has to be able to rescan anyway. Given that, the records are
		 * not read at all, and the polling fallback becomes the same code path
		 * rather than a second implementation.
		 *
		 * The debounce coalesces a burst. It is not a wait for the write to
		 * settle: docs/ingest.md establishes that files are written once,
		 * atomically, and that a file which exists is finished.
		 */
		watch(onChange: () => void): () => void {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const fire = () => {
				clearTimeout(timer);
				timer = setTimeout(onChange, DEBOUNCE_MS);
			};

			if (canWatch()) {
				const Observer = (globalThis as unknown as {
					FileSystemObserver: new (cb: () => void) => { observe(h: FileSystemDirectoryHandle, o?: { recursive?: boolean }): Promise<void>; disconnect(): void };
				}).FileSystemObserver;
				const observer = new Observer(fire);
				void observer.observe(root, { recursive: true });
				return () => {
					clearTimeout(timer);
					observer.disconnect();
				};
			}

			const interval = setInterval(fire, POLL_MS);
			return () => {
				clearTimeout(timer);
				clearInterval(interval);
			};
		},
	};
}
