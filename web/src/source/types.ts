/** Where runs come from.
 *
 * Two implementations today and a third shape in mind. The indexer must never
 * be able to tell which it has: step two implements `subscribe` on the picker
 * source and changes nothing above this line.
 */

export interface RunFiles {
  /** The Stats.csv text, absent if the run has no CSV (an orphan `.perf`). */
  stats?: string;
  /** The Performance.perf bytes, absent for the ~1 run in 7 that has none. */
  perf?: Uint8Array;
}

export interface RunSource {
  readonly kind: 'upload' | 'picker';
  /** The selected folder's display name. This is not a durable identity; it is
   *  the guardrail that catches an accidental pick of a different install. */
  readonly rootName: string;
  /** When the folder was enumerated, in epoch milliseconds. The app knows this
   *  and nothing about what has happened since, which is exactly what the
   *  staleness notice reports. */
  readonly pickedAt: number;
  /** The run basenames this source can offer -- a stats basename with
   *  " Stats.csv" removed. */
  list(): Promise<string[]>;
  read(id: string): Promise<RunFiles>;
  /** Absent in this plan. Step two implements it with a FileSystemObserver. */
  subscribe?(fn: (ids: string[]) => void): () => void;
}

export const STATS_SUFFIX = ' Stats.csv';
export const PERF_SUFFIX = ' Performance.perf';

export function statsIdOf(filename: string): string | null {
  return filename.endsWith(STATS_SUFFIX)
    ? filename.slice(0, -STATS_SUFFIX.length) : null;
}

export function perfIdOf(filename: string): string | null {
  return filename.endsWith(PERF_SUFFIX)
    ? filename.slice(0, -PERF_SUFFIX.length) : null;
}
