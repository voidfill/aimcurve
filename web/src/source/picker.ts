/** A directory the user granted through showDirectoryPicker().
 *
 * Preferred where it works: it is the same code past this boundary, it reads
 * without copying every file into the page, and the handle can be stored so the
 * folder is chosen once rather than per visit. It leaves the door open for step
 * two, which adds `subscribe` here and nowhere else.
 *
 * It does not work on a default Windows install -- Chrome refuses any directory
 * under Program Files, by every route -- so it must never be required. On Linux
 * the default Steam path is not on Chromium's blocklist, so it works directly.
 */

import { statsIdOf, type RunFiles, type RunSource } from './types';

export function supportsPicker(): boolean {
  return typeof (globalThis as any).showDirectoryPicker === 'function';
}

/** Ask for the KovaaK's folder. Returns null if the user cancelled or the
 *  browser refused the directory. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsPicker()) return null;
  try {
    return await (globalThis as any).showDirectoryPicker({
      id: 'aimcurve-kovaaks',
      // Read-only, always. aimcurve never writes to the game's folder.
      mode: 'read',
    });
  } catch {
    return null;
  }
}

async function subdirectory(
  root: FileSystemDirectoryHandle, name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(name);
  } catch {
    // performances/ is genuinely optional: a fresh install has not created it,
    // and 318 runs in a real install have no `.perf` at all.
    return null;
  }
}

export async function pickerSource(
  root: FileSystemDirectoryHandle,
): Promise<RunSource> {
  const statsDir = await subdirectory(root, 'stats');
  if (!statsDir) throw new Error('that folder has no stats/ directory');
  let perfDir = await subdirectory(root, 'performances');
  const pickedAt = Date.now();

  return {
    kind: 'picker',
    rootName: root.name,
    pickedAt,
    async list() {
      // A fresh installation may create performances/ after its first CSV.
      // Re-resolve it for each snapshot, including a previously absent folder.
      perfDir = await subdirectory(root, 'performances');
      const ids: string[] = [];
      // .keys(), never .entries(): a names-only enumeration is the cheap one,
      // and at 12k runs even that costs ~2.2 s per directory.
      for await (const name of (statsDir as any).keys()) {
        const id = statsIdOf(name);
        if (id !== null) ids.push(id);
      }
      return ids.sort();
    },
    async read(id: string): Promise<RunFiles> {
      const out: RunFiles = {};
      try {
        const handle = await statsDir.getFileHandle(`${id} Stats.csv`);
        out.stats = await (await handle.getFile()).text();
      } catch { /* the file went away between listing and reading */ }
      if (perfDir) {
        try {
          const handle = await perfDir.getFileHandle(`${id} Performance.perf`);
          out.perf = new Uint8Array(await (await handle.getFile()).arrayBuffer());
        } catch { /* no .perf, which is the normal case for ~1 run in 7 */ }
      }
      return out;
    },
    // No subscribe. This plan ships no live updates; step two adds it here.
  };
}
