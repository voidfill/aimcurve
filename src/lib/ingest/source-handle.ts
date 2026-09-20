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
			// `observe()` is asynchronous and can reject long after this call
			// returns — after an unsubscribe, even. `disposed` is what keeps a
			// late rejection from resurrecting a watcher that is already gone.
			let disposed = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let interval: ReturnType<typeof setInterval> | undefined;
			let observer: { disconnect(): void } | undefined;

			const fire = () => {
				if (disposed) return;
				clearTimeout(timer);
				timer = setTimeout(() => {
					if (!disposed) onChange();
				}, DEBOUNCE_MS);
			};

			/** The same code path the unsupported case uses; never doubled up. */
			const poll = () => {
				if (disposed || interval !== undefined) return;
				interval = setInterval(fire, POLL_MS);
			};

			if (canWatch()) {
				try {
					const Observer = (globalThis as unknown as {
						FileSystemObserver: new (cb: () => void) => { observe(h: FileSystemDirectoryHandle, o?: { recursive?: boolean }): Promise<void>; disconnect(): void };
					}).FileSystemObserver;
					const instance = new Observer(fire);
					observer = instance;
					// A rejection here — an unsupported filesystem, a revoked
					// permission, a handle the implementation will not observe
					// — means no change will ever fire. Falling back to the
					// interval is the difference between a stale view and a
					// working one, and catching it is also what keeps it from
					// surfacing as an unhandled rejection.
					instance.observe(root, { recursive: true }).catch(() => {
						try {
							instance.disconnect();
						} catch {
							// Already gone; nothing to release.
						}
						if (observer === instance) observer = undefined;
						poll();
					});
				} catch {
					// Synchronous construction failure: the constructor exists
					// but refuses this environment.
					observer = undefined;
					poll();
				}
			}
			// No observer at all, or construction failed above.
			if (observer === undefined) poll();

			return () => {
				disposed = true;
				clearTimeout(timer);
				timer = undefined;
				if (interval !== undefined) clearInterval(interval);
				interval = undefined;
				observer?.disconnect();
				observer = undefined;
			};
		},
	};
}
