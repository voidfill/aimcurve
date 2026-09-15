/** Choosing what a run is judged against.
 *
 * Port of `compare.baselines`. The only thing it needs from storage is the
 * candidate set, and it takes that through the Store interface.
 */

import { DEFAULT_RECENT_N, DURATION_TOLERANCE, pyFsum } from './compare';
import type { Store } from './store';
import type { Curve, Shape } from './types';

export interface PbBaseline {
  run_id: string;
  score: number | null;
  started_at: string;
  is_true_pb: boolean;
  curve: Curve | null;
}

export interface Baselines {
  pb: PbBaseline | null;
  true_pb: { run_id: string; score: number | null; started_at: string } | null;
  recent: {
    n: number;
    mean_score: number | null;
    curve: Curve[] | null;
    run_ids: string[] | null;
  };
  candidates: number;
}

export interface BaselineOpts {
  recentN?: number;
  sameCfg?: boolean;
  durationTol?: number;
  shape?: Shape;
}

export async function baselines(
  store: Store, id: string, opts: BaselineOpts = {},
): Promise<Baselines> {
  const {
    recentN = DEFAULT_RECENT_N,
    sameCfg = true,
    durationTol = DURATION_TOLERANCE,
    shape = 'timed',
  } = opts;

  const focus = await store.getRun(id);
  if (!focus) throw new Error(`no such run: ${id}`);
  const rows = await store.candidates(id, { sameCfg, durationTol, shape });

  const result: Baselines = {
    pb: null,
    true_pb: null,
    recent: { n: 0, mean_score: null, curve: null, run_ids: null },
    candidates: rows.length,
  };
  if (!rows.length) return result;

  const scored = rows.filter((r) => r.score !== null);
  if (scored.length) {
    const truePb = scored.reduce((a, b) =>
      (b.score as number) > (a.score as number) ? b : a);
    result.true_pb = {
      run_id: truePb.id, score: truePb.score, started_at: truePb.started_at,
    };

    // The overlay must be a run we can actually draw. 35 of 316 real scenarios
    // have a PB with no .perf, so falling back is the norm.
    const drawable = scored.filter((r) => r.has_perf);
    if (drawable.length) {
      const pb = drawable.reduce((a, b) =>
        (b.score as number) > (a.score as number) ? b : a);
      result.pb = {
        run_id: pb.id,
        score: pb.score,
        started_at: pb.started_at,
        is_true_pb: pb.id === truePb.id,
        curve: (await store.getCurve(pb.id)) ?? null,
      };
    }
  }

  const prior = rows.filter((r) => r.started_at < focus.started_at);
  // Clamp here rather than trusting a caller: a non-positive count is a slice
  // quirk in the Python, not a request for every prior run.
  const n = Math.max(recentN, 0);
  const recent = n ? prior.slice(-n) : [];
  if (recent.length) {
    result.recent.n = recent.length;
    const scores = recent
      .map((r) => r.score)
      .filter((s): s is number => s !== null);
    // `statistics.fmean` in the Python, which is `math.fsum(scores) / n` -- and
    // the Python falls back to `fmean([0.0])` when every recent score is null.
    result.recent.mean_score = scores.length ? pyFsum(scores) / scores.length : 0;

    // Built in one pass so the two lists stay index-aligned -- a race curve is
    // later resampled against its own run's elapsed_s, not the focused run's.
    const curves: Curve[] = [];
    const runIds: string[] = [];
    for (const r of recent) {
      if (!r.has_perf) continue;
      const curve = await store.getCurve(r.id);
      if (curve) {
        curves.push(curve);
        runIds.push(r.id);
      }
    }
    if (curves.length) {
      result.recent.curve = curves;
      result.recent.run_ids = runIds;
    }
  }
  return result;
}
