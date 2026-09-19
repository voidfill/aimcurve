/**
 * A source over real directories. **Test plumbing — never shipped.**
 *
 * It exists so the full corpus can be driven through the real ingester under
 * vitest rather than through a test-local reimplementation of it. `File` is a
 * Node >= 20 global and `openAsBlob` returns a real `Blob`, so this is the whole
 * adapter.
 */
import { openAsBlob } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileSource, SourceEntry } from './source';

export function nodeSource(...dirs: string[]): FileSource {
	return {
		async list(): Promise<SourceEntry[]> {
			const entries: SourceEntry[] = [];
			for (const dir of dirs) {
				for (const name of await readdir(dir)) {
					const path = join(dir, name);
					entries.push({ name, open: async () => new File([await openAsBlob(path)], name) });
				}
			}
			return entries;
		},
	};
}
