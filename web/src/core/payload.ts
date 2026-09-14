/** Building the payload the dashboard reads.
 *
 * Port of `aimcurve/payload.py`. The queries were the easy half; this is the
 * part that carries the decisions -- metric selection, smoothing, baseline
 * resolution, the tail marking, the dead-time residual, the weighted window
 * share. Every comment here records something learned from real data.
 */

import { baselines, type Baselines } from './baselines';
import {
  band as makeBand, compareUntil, cumulativeDelta, DEFAULT_RECENT_N,
  DURATION_TOLERANCE, pySum, smooth,
} from './compare';
import { RACE, TIMED } from './shapes';
import type { Store } from './store';
import type { Curve, Run, Scenario, SeriesName } from './types';

/** Metric name -> (numerator, denominator). Order is the button order. */
const METRICS: Record<string, [SeriesName, SeriesName | null]> = {
  score: ['score', null],
  shots: ['shots', null],
  hits: ['hits', null],
  kills: ['kills', null],
  accuracy: ['hits', 'shots'],
  efficiency: ['dmg_done', 'dmg_possible'],
};
const METRIC_ORDER = ['score', 'shots', 'hits', 'kills', 'accuracy', 'efficiency'];

export interface SplitRow {
  idx: number | null;
  bot: string;
  mine: number | null;
  base: number | null;
  best: number | null;
  delta: number | null;
  delta_adj: number | null;
}

export interface WindowRow {
  idx: number;
  bot: string;
  window_s: number | null;
  mine: number | null;
  base: number | null;
  best: number | null;
  recent: number | null;
  delta: number | null;
  delta_recent: number | null;
}

export interface Payload {
  run: Run & { buckets: number };
  scenario: Scenario;
  metrics: string[];
  axis: { kind: 'time' | 'progress'; label: string; n: number };
  rate: {
    metric: string;
    unit: string;
    mine: number[];
    pb: number[] | null;
    band: { mean: number[]; lo: number[]; hi: number[] } | null;
  };
  delta: {
    unit: 'points' | 'seconds';
    values: number[] | null;
    final: number | null;
    compare_until: number | null;
    baseline: { run_id: string; score: number | null; is_true_pb: boolean } | null;
  };
  marks: { kills: number[]; labels: string[]; aligned: boolean };
  splits: SplitRow[];
  windows: WindowRow[];
  window_summary: { mine: number | null; base: number | null } | null;
  baselines: {
    true_pb: Baselines['true_pb'];
    candidates: number;
    recent_n: number;
    recent_mean_score: number | null;
    pb: { run_id: string; score: number | null; started_at: string; is_true_pb: boolean } | null;
  };
}

export interface PayloadOpts {
  metric?: string;
  smoothing?: number;
  recentN?: number;
  sameCfg?: boolean;
}

function ratio(numerator: ArrayLike<number>, denominator: ArrayLike<number>): number[] {
  const out: number[] = [];
  const n = Math.min(numerator.length, denominator.length);
  for (let i = 0; i < n; i++) out.push(denominator[i] ? numerator[i] / denominator[i] : 0);
  return out;
}

function series(curve: Curve, metric: string): number[] {
  const [top, bottom] = METRICS[metric];
  if (bottom === null) return Array.from(curve.series[top]);
  return ratio(curve.series[top], curve.series[bottom]);
}

/** Which metric buttons are worth offering for this run.
 *
 * Damage is booked per tick on some scenarios and only at kill time on others.
 * Where it is per-kill, dmg_possible is a couple of units against thousands of
 * shots and `efficiency` draws a flat zero -- so it is withheld rather than
 * shown as though it were a measurement.
 */
function usableMetrics(curve: Curve | null): string[] {
  const usable = METRIC_ORDER.filter((name) => name !== 'efficiency');
  if (curve) {
    // Summed the way the Python's builtin sums a float series, so a run
    // sitting on the 0.5 threshold falls the same side of it in both.
    const possible = pySum(curve.series.dmg_possible);
    const shots = pySum(curve.series.shots);
    if (possible > 0 && possible >= 0.5 * shots) usable.push('efficiency');
  }
  return usable;
}

const DEFAULT_SCENARIO = (name: string): Scenario => ({
  name, shape: TIMED, penalising: 0, budget: null, pool: null, bots: null,
  clock_s: null, windowed: 0, evidence: 'default',
});

export function buildRunPayload(
  store: Store, id: string, opts: PayloadOpts = {},
): Payload {
  const {
    metric = 'score', smoothing = 5, recentN = DEFAULT_RECENT_N, sameCfg = true,
  } = opts;
  if (!(metric in METRICS)) throw new Error(`unknown metric: ${metric}`);

  const run = store.getRun(id);
  if (!run) throw new Error(`no such run: ${id}`);

  const scenario = store.getScenario(run.scenario) ?? DEFAULT_SCENARIO(run.scenario);
  const isRace = scenario.shape === RACE;

  const curve = store.getCurve(id) ?? null;
  const buckets = curve ? curve.series.score.length : 0;
  // A race plots damage/s whatever `metric` says -- the shape fixes the y
  // series, so every one of the six buttons would redraw the identical line.
  // No button at all is the honest offer; `metric` stays a valid METRICS key
  // on the query string so that switching back to a timed run still works.
  const metrics = isRace ? [] : usableMetrics(curve);

  // `baselines` clamps a non-positive recentN itself -- the Python clamps in
  // both places, here and in `compare.baselines`, because the slice quirk it
  // guards against (recent_n=0 meaning "every prior run") is reachable from an
  // unvalidated query string.
  const base = baselines(store, id, {
    recentN, sameCfg, durationTol: DURATION_TOLERANCE, shape: scenario.shape,
  });

  const payload: Payload = {
    run: { ...run, buckets },
    scenario,
    metrics,
    axis: { kind: 'time', label: 'seconds', n: buckets },
    rate: { metric, unit: metric, mine: [], pb: null, band: null },
    delta: { unit: 'points', values: null, final: null, compare_until: null, baseline: null },
    marks: { kills: [], labels: [], aligned: false },
    splits: [],
    windows: [],
    window_summary: null,
    baselines: {
      true_pb: base.true_pb,
      candidates: base.candidates,
      recent_n: base.recent.n,
      recent_mean_score: base.recent.mean_score,
      pb: base.pb === null ? null : {
        run_id: base.pb.run_id, score: base.pb.score,
        started_at: base.pb.started_at, is_true_pb: base.pb.is_true_pb,
      },
    },
  };

  if (isRace) fillRace(store, payload, run, scenario, curve, base, smoothing, sameCfg);
  else fillTimed(store, payload, run, scenario, curve, base, metric, smoothing, sameCfg);
  return payload;
}

/** Native per-second grid, score units -- plus bot windows where the scenario
 *  spends its clock on a rotation of bots that never die. */
function fillTimed(
  store: Store, payload: Payload, run: Run, scenario: Scenario,
  curve: Curve | null, base: Baselines, metric: string, smoothing: number,
  sameCfg: boolean,
): void {
  const mine = curve ? series(curve, metric) : [];
  payload.rate.mine = smooth(mine, smoothing);
  const kills = store.getKills(run.id);
  payload.marks.kills = kills.map((k) => k.t);
  // A window boundary is the scenario's, not the player's, so it falls at the
  // same second in every run. That is what `aligned` means to the chart: draw
  // them as shared, named boundaries rather than this run's private events.
  if (scenario.windowed) {
    payload.marks.aligned = true;
    payload.marks.labels = kills.map((k) => k.bot);
    payload.windows = botWindows(store, run, base, sameCfg);
    payload.window_summary = windowSummary(store, run, base);
  }

  if (curve && base.pb && base.pb.curve) {
    const pbCurve = base.pb.curve;
    payload.rate.pb = smooth(series(pbCurve, metric), smoothing);
    // Always score units, and always on the RAW series: smoothing would blur
    // the invariant that the final value equals the score difference.
    const mineScore = Array.from(curve.series.score);
    const baseScore = Array.from(pbCurve.series.score);
    const values = cumulativeDelta(mineScore, baseScore);
    payload.delta.values = values;
    payload.delta.final = values.length ? values[values.length - 1] : null;
    payload.delta.compare_until = compareUntil(mineScore, baseScore);
    // What the delta is measured against, so the UI cannot label the chart
    // with one baseline and the headline percentage with another.
    payload.delta.baseline = {
      run_id: base.pb.run_id, score: base.pb.score, is_true_pb: base.pb.is_true_pb,
    };
  }

  if (curve && base.recent.curve) {
    const raw = makeBand(base.recent.curve.map((c) => series(c, metric)));
    payload.rate.band = {
      mean: smooth(raw.mean, smoothing),
      lo: smooth(raw.lo, smoothing),
      hi: smooth(raw.hi, smoothing),
    };
  }
}

/** Filled in Task 14. */
function fillRace(
  _store: Store, _payload: Payload, _run: Run, _scenario: Scenario,
  _curve: Curve | null, _base: Baselines, _smoothing: number, _sameCfg: boolean,
): void {
  throw new Error('race path not implemented yet');
}

/** Filled in Task 15. */
function botWindows(
  _store: Store, _run: Run, _base: Baselines, _sameCfg: boolean,
): WindowRow[] {
  return [];
}

/** Filled in Task 15. */
function windowSummary(
  _store: Store, _run: Run, _base: Baselines,
): { mine: number | null; base: number | null } | null {
  return null;
}
