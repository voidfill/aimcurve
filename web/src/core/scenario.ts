/** Recomputing one scenario's shape from every run the index holds for it.
 *
 * A fold over rows the caller already has, so it is cheap enough to run on
 * every new run rather than only at bootstrap -- which matters, because a
 * second run is exactly what promotes a curveless race scenario out of 'timed'.
 *
 * Port of `index.refresh_scenario`, with the SQL lifted out: the caller passes
 * the rows in, so this stays free of storage.
 */

import { classify, fixedWindows, isPenalising, RACE } from './shapes';
import type { Kill, Run, Scenario } from './types';

export interface ScenarioInput {
  run: Run;
  /** The `.perf` score series, or null for a run with no curve. */
  score: Float32Array | null;
  kills: Kill[];
}

function median(values: readonly (number | null)[]): number | null {
  const usable = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!usable.length) return null;
  const mid = Math.floor(usable.length / 2);
  return usable.length % 2
    ? usable[mid]
    : (usable[mid - 1] + usable[mid]) / 2;
}

function maximum(values: readonly (number | null)[]): number | null {
  const usable = values.filter((v): v is number => v !== null);
  return usable.length ? Math.max(...usable) : null;
}

/** `index.refresh_scenario`'s `SELECT ... WHERE scenario=?` carries no
 *  ORDER BY, but it is not order-*free*: for this exact shape, SQLite always
 *  resolves it via the `run_scen_score` index (`scenario, score DESC` --
 *  `index.py` schema, the index built for the run rail) rather than a table
 *  scan, confirmed with EXPLAIN QUERY PLAN against every scenario in the
 *  fixture corpus. `classify` returns on the first curve with a valid
 *  countdown budget, so which run's countdown wins the race verdict is
 *  decided by score, not by insertion order. Reproduced here so `curves`
 *  does not silently depend on the order the caller happens to hand rows in.
 */
function byScoreDescending(inputs: readonly ScenarioInput[]): readonly ScenarioInput[] {
  return [...inputs].sort(
    (a, b) => (b.run.score ?? -Infinity) - (a.run.score ?? -Infinity),
  );
}

export function refreshScenario(
  name: string, inputs: readonly ScenarioInput[],
): Scenario | null {
  if (!inputs.length) return null;

  const curves = byScoreDescending(inputs)
    .map((i) => i.score)
    .filter((s): s is Float32Array => s !== null);

  const verdict = classify(
    curves,
    inputs.map((i) => [i.run.score, i.run.elapsed_s] as const),
  );

  let pool: number | null = null;
  let bots: number | null = null;
  let clock_s: number | null = null;
  let penalising: 0 | 1 = 0;
  let windowed: 0 | 1 = 0;

  if (verdict.shape === RACE) {
    // Hits are the damage pool: every hit is one damage in these scenarios, and
    // the total is identical in every run that ran to the end.
    //
    // max, not median: a run quit part-way records fewer kills and fewer hits,
    // and tier 1 still classifies the scenario race from any one good curve.
    // With two runs the median is the mean, so a single abort would halve
    // `bots` and put every kill mark at the wrong fraction. A partial run can
    // only ever undercount, so max cannot be contaminated by one.
    pool = maximum(inputs.map((i) => i.run.hits));
    const count = maximum(inputs.map((i) => i.run.kills));
    bots = count === null ? null : Math.trunc(count);
  } else {
    clock_s = median(inputs.map((i) => i.run.duration_s));
    // A countdown is negative every bucket by construction; that is the clock,
    // not a penalty, so this is only asked of timed scenarios.
    penalising = curves.some((c) => isPenalising(c)) ? 1 : 0;
    // Some fixed-clock scenarios spend that clock on a rotation of bots that
    // never die. One grouped fold rather than one lookup per run: this runs
    // on every new run, not just at bootstrap.
    const bySlot = new Map<number, (number | null)[]>();
    for (const { kills } of inputs) {
      for (const kill of kills) {
        const slot = bySlot.get(kill.idx);
        if (slot) slot.push(kill.ttk);
        else bySlot.set(kill.idx, [kill.ttk]);
      }
    }
    const slots = fixedWindows(bySlot);
    if (slots) {
      bots = slots;
      windowed = 1;
    }
  }

  return {
    name,
    shape: verdict.shape,
    penalising,
    budget: verdict.budget,
    pool,
    bots,
    clock_s,
    windowed,
    evidence: verdict.evidence,
  };
}
