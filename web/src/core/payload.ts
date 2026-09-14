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
  DURATION_TOLERANCE, pySum, raceDelta, raceGrid, resampleRace, smooth,
} from './compare';
import { RACE, TIMED } from './shapes';
import type { Store } from './store';
import type { Curve, Kill, Run, Scenario, SeriesName } from './types';

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

/** Progress axis, damage rate, seconds-based delta, shared kill marks. */
function fillRace(
  store: Store, payload: Payload, run: Run, scenario: Scenario,
  curve: Curve | null, base: Baselines, smoothing: number, sameCfg: boolean,
): void {
  const bots = scenario.bots || 1;
  const steps = raceGrid(bots);
  payload.axis = { kind: 'progress', label: '% of pool', n: steps };
  payload.rate.metric = 'damage';
  payload.rate.unit = 'dmg/s';
  payload.delta.unit = 'seconds';
  // Kill k always lands at damage k*pool/bots, so the marks are the same for
  // every run of the scenario -- which is the whole point of this axis.
  payload.marks = {
    kills: Array.from({ length: bots }, (_, i) => (i + 1) / bots),
    labels: [],
    aligned: true,
  };

  let mineEdges: number[] = [];
  if (curve && run.elapsed_s) {
    const [edges, rate] = resampleRace(curve.series.hits, run.elapsed_s, steps);
    mineEdges = edges;
    payload.rate.mine = smooth(rate, smoothing);
  }

  const pbRun = base.pb && base.pb.curve ? store.getRun(base.pb.run_id) : undefined;
  if (mineEdges.length && base.pb?.curve && pbRun?.elapsed_s) {
    const [baseEdges, baseRate] = resampleRace(
      base.pb.curve.series.hits, pbRun.elapsed_s, steps);
    payload.rate.pb = smooth(baseRate, smoothing);
    const values = raceDelta(mineEdges, baseEdges);
    payload.delta.values = values;
    payload.delta.final = values.length ? values[values.length - 1] : null;
    // Both runs span the whole pool by definition, so there is no region where
    // only one of them has data.
    payload.delta.compare_until = 1.0;
    payload.delta.baseline = {
      run_id: base.pb.run_id, score: base.pb.score, is_true_pb: base.pb.is_true_pb,
    };
  }

  if (mineEdges.length && base.recent.curve && base.recent.run_ids) {
    const curves: number[][] = [];
    // Each recent run is resampled against its OWN elapsed_s, not the focused
    // run's: scaling every band member onto someone else's clock moves a real
    // Air Pure Medium run by up to ~15%, hiding a slow run inside a band that
    // looks normal.
    base.recent.curve.forEach((recent, i) => {
      const recentRun = store.getRun(base.recent.run_ids![i]);
      if (!recentRun?.elapsed_s) return;
      const [, recentRate] = resampleRace(
        recent.series.hits, recentRun.elapsed_s, steps);
      if (recentRate.length) curves.push(recentRate);
    });
    if (curves.length) {
      const raw = makeBand(curves);
      payload.rate.band = {
        mean: smooth(raw.mean, smoothing),
        lo: smooth(raw.lo, smoothing),
        hi: smooth(raw.hi, smoothing),
      };
    }
  }

  payload.splits = raceSplits(store, run, base, sameCfg);
  // Name the boundaries after the bots that hold them, reusing the rows the
  // split table already loaded. A run that quit early names fewer bots than the
  // scenario has; the chart falls back to the ordinal for the rest.
  payload.marks.labels = payload.splits
    .filter((s) => s.idx !== null)
    .map((s) => s.bot)
    .slice(0, bots);
}

/** Every run this one can fairly be judged against, and itself.
 *
 * Itself because `best` is a ceiling: on the run that set it the column has to
 * read that run's own number and the gap has to be zero, not blank.
 */
function peerIds(
  store: Store, run: Run, sameCfg: boolean, shape: Scenario['shape'],
): string[] {
  const rows = store.candidates(run.id, {
    sameCfg, durationTol: DURATION_TOLERANCE, shape,
  });
  return [...rows.map((r) => r.id), run.id];
}

/** Total TTK the way the Python's builtin `sum` totals it.
 *
 * A null TTK is carried as zero rather than skipped, which is the same number
 * either way -- the Python sums the generator without a guard, so a null there
 * raises instead of choosing. Neumaier-compensated because the residual it
 * feeds is subtracted from `elapsed_s` and shown to six decimals.
 */
function sumTtk(kills: Iterable<Kill>): number {
  return pySum(Array.from(kills, (k) => k.ttk ?? 0));
}

/** Per-bot rows plus the dead-time residual, so the table reconciles.
 *
 * Dead time is not modelled as a scenario constant: it is stable within a game
 * version but moved by up to a second across versions, so it is carried as this
 * run's own residual and simply shown.
 */
function raceSplits(
  store: Store, run: Run, base: Baselines, sameCfg: boolean,
): SplitRow[] {
  const mine = store.getKills(run.id);
  if (!mine.length || !run.elapsed_s) return [];

  const baseByIdx = new Map<number, Kill>();
  if (base.pb) {
    for (const k of store.getKills(base.pb.run_id)) baseByIdx.set(k.idx, k);
  }

  // Fastest this bot has ever gone down, this run included -- the column says
  // what the ceiling is, so the run that set it must show itself.
  const best = store.bestBySlot(peerIds(store, run, sameCfg, RACE), 'ttk');

  const rows: SplitRow[] = mine.map((kill) => {
    const other = baseByIdx.get(kill.idx);
    return {
      idx: kill.idx,
      bot: kill.bot,
      mine: kill.ttk,
      base: other ? other.ttk : null,
      best: best.get(kill.idx) ?? null,
      delta: other && other.ttk !== null && kill.ttk !== null
        ? kill.ttk - other.ttk : null,
      delta_adj: null,
    };
  });

  // How much this bot cost you *over and above how the run went generally*. A
  // plain delta against the PB ranks the bots you find hard; subtracting the
  // run's own mean delta takes the bad-day component out and leaves the bot
  // that actually broke. Sums to zero across the bots by construction.
  const deltas = rows
    .map((r) => r.delta)
    .filter((d): d is number => d !== null);
  const meanDelta = deltas.length ? pySum(deltas) / deltas.length : null;
  for (const row of rows) {
    row.delta_adj = row.delta === null || meanDelta === null
      ? null : row.delta - meanDelta;
  }

  const mineDead = run.elapsed_s - sumTtk(mine);
  let baseDead: number | null = null;
  if (baseByIdx.size && base.pb) {
    const baseRun = store.getRun(base.pb.run_id);
    if (baseRun?.elapsed_s) baseDead = baseRun.elapsed_s - sumTtk(baseByIdx.values());
  }
  // Dead time is the gap between bots, not a bot: it is part of the total but
  // it has no place in a ranking of which bot to work on.
  rows.push({
    idx: null, bot: 'dead time', mine: mineDead, base: baseDead, best: null,
    delta_adj: null,
    delta: baseDead === null ? null : mineDead - baseDead,
  });
  return rows;
}

/** Damage taken over damage offered, for one kill row.
 *
 * Null when the window offered no damage -- which is not the same as a share of
 * zero. A missing `dmg_done` is null for the same reason: it is a hole, not a
 * zero-damage window, and `bestBySlot` already drops such a row because the
 * Python's `dmg_done * 1.0 / dmg_possible IS NOT NULL` does. The Python's own
 * `_share` (payload.py:245-247) does neither -- it divides None by a float and
 * raises TypeError -- so no corpus with such a row can be built there at all;
 * absent is the reading the rest of the file already agrees on.
 */
function share(kill: Kill | undefined): number | null {
  if (!kill || !kill.dmg_possible || kill.dmg_done === null) return null;
  return kill.dmg_done / kill.dmg_possible;
}

/** Whole-run share for this run and for the PB run.
 *
 * Damage taken over damage offered, not the mean of the per-window shares: the
 * windows are not all the same length -- 18.99 s against 20.39 s on the VT
 * scenarios -- so an unweighted mean over-counts the short one.
 *
 * A null `dmg_done` drops out of the numerator while its window still counts
 * toward the denominator, which is the Python's explicit guard rather than
 * `share`'s: a hole here reads as damage offered and not taken.
 */
function windowSummary(
  store: Store, run: Run, base: Baselines,
): { mine: number | null; base: number | null } {
  const overall = (runId: string): number | null => {
    const kills = store.getKills(runId);
    // Totalled the way the Python's builtin sums a float series, so the two
    // cannot disagree in the last bits of a ratio shown to twelve places.
    const done = pySum(
      kills.map((k) => k.dmg_done).filter((v): v is number => v !== null));
    const possible = pySum(
      kills.map((k) => k.dmg_possible).filter((v): v is number => !!v));
    return possible ? done / possible : null;
  };
  return {
    mine: overall(run.id),
    base: base.pb ? overall(base.pb.run_id) : null,
  };
}

/** Per-bot share of the damage its window made available.
 *
 * Raw damage is unreadable across scenarios -- 0.009 a window on Plink Palace
 * against 0.86 on Aether -- and the window is a fixed length, so the damage it
 * offers is a constant. The share of it you took is the same number in every
 * scenario, and it is what the window was for.
 */
function botWindows(
  store: Store, run: Run, base: Baselines, sameCfg: boolean,
): WindowRow[] {
  const kills = store.getKills(run.id);
  if (!kills.length) return [];

  const baseByIdx = new Map<number, Kill>();
  if (base.pb) {
    for (const k of store.getKills(base.pb.run_id)) baseByIdx.set(k.idx, k);
  }

  // The same recent-N the chart's band is built from, so the stepper moves both
  // and the two cannot disagree about what "recent" means.
  const recentByIdx = new Map<number, number[]>();
  for (const recentId of base.recent.run_ids ?? []) {
    for (const k of store.getKills(recentId)) {
      const value = share(k);
      if (value === null) continue;
      const pool = recentByIdx.get(k.idx);
      if (pool) pool.push(value);
      else recentByIdx.set(k.idx, [value]);
    }
  }

  // The most of this window anyone has taken, this run included.
  const best = store.bestBySlot(peerIds(store, run, sameCfg, TIMED), 'share');

  return kills.map((kill) => {
    const mine = share(kill);
    const against = share(baseByIdx.get(kill.idx));
    const pool = recentByIdx.get(kill.idx) ?? [];
    const recent = pool.length ? pySum(pool) / pool.length : null;
    return {
      idx: kill.idx,
      bot: kill.bot,
      window_s: kill.ttk,
      mine,
      base: against,
      best: best.get(kill.idx) ?? null,
      recent,
      delta: mine === null || against === null ? null : mine - against,
      delta_recent: mine === null || recent === null ? null : mine - recent,
    };
  });
}
