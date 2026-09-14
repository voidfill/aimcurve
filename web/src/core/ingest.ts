/** Turning one run's files into rows.
 *
 * The unit both stores index with: the in-memory one here and the IndexedDB
 * one in Plan B. Keeping it shared is what stops the two drifting on the four
 * fields that only the curve knows.
 */

import { pySum } from './compare';
import { parsePerf, PerfError } from './perf';
import { parseKills, parseStats } from './statscsv';
import type { Curve, Kill, Run } from './types';

export interface Ingested {
  run: Run;
  curve: Curve | null;
  kills: Kill[];
  /** Why the `.perf` was rejected, when one was offered and failed. A parse
   *  that failed because the file was still being written is a retry, not a
   *  failure -- Plan B's `failed` store and its try budget consume this. */
  error?: string;
}

export function ingest(
  id: string, statsText: string, perfBytes?: Uint8Array,
): Ingested {
  const run = parseStats(id, statsText);
  const kills = parseKills(statsText);
  let curve: Curve | null = null;
  let error: string | undefined;

  if (perfBytes) {
    try {
      const parsed = parsePerf(perfBytes);
      curve = { buckets: parsed.buckets, duration_s: parsed.duration_s, series: parsed.series };
    } catch (e) {
      if (!(e instanceof PerfError)) throw e;
      error = e.message;
    }
  }

  if (curve) {
    run.has_perf = true;
    run.duration_s = curve.duration_s || null;
    run.spm = run.duration_s && run.score !== null
      ? (run.score / run.duration_s) * 60
      : null;
    // damage_possible is not a summary key; the curve is the only source.
    // Summed the way the index's `float(sum(...))` sums it -- binary32 addends
    // into a double make the compensation term zero in practice, but the
    // reason is arithmetic that happens to hold here, not a rule.
    run.damage_possible = pySum(curve.series.dmg_possible);
  }

  return error === undefined ? { run, curve, kills } : { run, curve, kills, error };
}
