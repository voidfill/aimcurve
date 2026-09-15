/** A one-shot directory snapshot from <input type="file" webkitdirectory>.
 *
 * The entry point for anyone whose install is where Chrome refuses to let a
 * page look: unlike the File System Access API this is not subject to the
 * sensitive-path blocklist, so it reads a default
 * `C:\Program Files (x86)\Steam\...` install directly, and it works in Firefox
 * and Safari, which have no File System Access API at all.
 *
 * What it cannot do is look again without another user gesture. That is why
 * there is no `subscribe` here and why the UI has to report the data's age.
 */

import { perfIdOf, statsIdOf, type RunFiles, type RunSource } from './types';

export function uploadSource(files: FileList | readonly File[]): RunSource {
  const stats = new Map<string, File>();
  const perfs = new Map<string, File>();
  let sawStatsDir = false;

  for (const file of Array.from(files)) {
    // webkitRelativePath is the whole path under the chosen folder, e.g.
    // "FPSAimTrainer/stats/Foo - Challenge - 2026.09.03-19.08.37 Stats.csv",
    // and it is the parent directory that has to be checked -- not just the
    // filename. Matching on the name alone indexes every "* Stats.csv"
    // anywhere in the tree: a backup folder, or a second install, with the last
    // File silently winning a name collision. The picker source reads strictly
    // stats/ and performances/, and the indexer must never be able to tell the
    // two sources apart.
    const parts = file.webkitRelativePath.split('/');
    if (parts.length < 2) continue;  // no directory information: not ours
    const dir = parts[parts.length - 2];
    const name = parts[parts.length - 1];
    if (dir === 'stats') {
      sawStatsDir = true;
      const statsId = statsIdOf(name);
      if (statsId !== null) stats.set(statsId, file);
    } else if (dir === 'performances') {
      const perfId = perfIdOf(name);
      if (perfId !== null) perfs.set(perfId, file);
    }
  }

  // The same error the picker source raises for the same mistake. Returning an
  // empty source instead renders as "No runs yet", which reads as "you have not
  // played" rather than "you picked the wrong folder".
  if (!sawStatsDir) throw new Error('that folder has no stats/ directory');

  const pickedAt = Date.now();

  return {
    kind: 'upload',
    pickedAt,
    async list() {
      // Stats files only: an orphan `.perf` with no CSV is not a run. Eight
      // were observed in a real install.
      return [...stats.keys()].sort();
    },
    async read(id: string): Promise<RunFiles> {
      const out: RunFiles = {};
      const csv = stats.get(id);
      if (csv) out.stats = await csv.text();
      const perf = perfs.get(id);
      if (perf) out.perf = new Uint8Array(await perf.arrayBuffer());
      return out;
    },
  };
}
