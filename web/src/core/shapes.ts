/** Scenario scoring shapes.
 *
 * Most scenarios are scored on a fixed clock. Ten in the reference install are
 * not: they spawn a fixed number of bots and score on elapsed time, writing the
 * score series as a literal countdown. Telling the two apart is what lets the
 * dashboard pick an axis that means something.
 *
 * Everything here is pure over already-parsed values.
 */

import type { Scenario, Shape } from './types';

export const RACE = 'race' as const;
export const TIMED = 'timed' as const;

// >=90%, not 100%: the .perf buckets samples by floor(timestamp), so timing
// jitter occasionally merges two ticks into one bucket (a 0 beside a -2). A
// strict rule scores 123/126 on real runs; this one scores 126/126 with no
// false positives.
const COUNTDOWN_MIN_FRACTION = 0.9;
// The series round-trips through float32, which moves -1 by up to ~0.0025.
const COUNTDOWN_TOLERANCE = 0.01;

const BUDGET_TOLERANCE = 0.1;
const MIN_DURATION_SPREAD = 1.0;

// A bot whose window the scenario fixes writes the same TTK every run; a bot
// you actually kill writes how long it took you. Measured over the reference
// install, the widest relative spread among fixed-window slots is 0.0001 and
// the tightest among real kills is 0.081. This sits in the empty 800x between
// them, so it is a threshold in name only.
const WINDOW_MAX_SPREAD = 0.02;
// One run cannot show a TTK is fixed rather than merely what happened once.
const WINDOW_MIN_RUNS = 2;

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pstdev(values: number[]): number {
  const mu = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - mu) ** 2)));
}

/** The budget if `score` is a countdown clock, else null.
 *
 * A race scenario's score arrives as [budget-1, -1, -1, ...]: the first bucket
 * seeds the clock and every later one is a second ticking off. The final bucket
 * is a partial second, so it is excluded rather than tested.
 */
export function countdownBudget(score: ArrayLike<number>): number | null {
  const values = Array.from(score);
  if (values.length < 4 || values[0] <= 0) return null;
  const body = values.slice(1, -1);
  if (!body.length) return null;
  const ticks = body.filter((v) => Math.abs(v + 1) < COUNTDOWN_TOLERANCE).length;
  if (ticks / body.length < COUNTDOWN_MIN_FRACTION) return null;
  return values[0] + 1;
}

/** The budget if (score, elapsed) pairs show a constant budget over varying
 *  time, else null.
 *
 * The fallback for race scenarios with no .perf. Two runs minimum, and that
 * minimum is the whole point: 6 of 2360 fixed-clock runs have a score that
 * lands near a round hundred minus their clock, so one run is a coincidence.
 * Two runs agreeing on a budget while disagreeing on time is not.
 */
export function budgetFromTotals(
  pairs: readonly (readonly [number | null, number | null])[],
): number | null {
  const usable = pairs.filter(
    (p): p is [number, number] => p[0] !== null && !!p[1],
  );
  if (usable.length < 2) return null;
  const budgets = usable.map(([s, e]) => s + e);
  const elapsed = usable.map(([, e]) => e);
  if (Math.max(...budgets) - Math.min(...budgets) > BUDGET_TOLERANCE) return null;
  if (Math.max(...elapsed) - Math.min(...elapsed) < MIN_DURATION_SPREAD) return null;
  return mean(budgets);
}

/** The bot count if every slot's length is fixed by the scenario, else null.
 *
 * `ttkBySlot` maps a kill's index to that slot's TTK across every run of the
 * scenario. Invincible bots never die: KovaaK's still writes one kill row per
 * bot, but the TTK is the window the scenario gave it, identical run to run.
 * Slots too thin to judge are skipped rather than failing the scenario, since
 * a run quit part-way leaves later slots with one sample.
 */
export function fixedWindows(
  ttkBySlot: ReadonlyMap<number, readonly (number | null)[]>,
): number | null {
  const slots = new Map<number, number[]>();
  for (const [idx, values] of ttkBySlot) {
    const usable = values.filter((t): t is number => !!t);
    if (usable.length >= WINDOW_MIN_RUNS) slots.set(idx, usable);
  }
  if (!slots.size) return null;
  for (const values of slots.values()) {
    const mu = mean(values);
    if (mu <= 0) return null;
    if (pstdev(values) / mu > WINDOW_MAX_SPREAD) return null;
  }
  return Math.max(...slots.keys());
}

/** Whether any second of the run cost points outright. */
export function isPenalising(score: ArrayLike<number>): boolean {
  return Array.from(score).some((v) => v < 0);
}

export interface Verdict {
  shape: Shape;
  budget: number | null;
  evidence: Scenario['evidence'];
}

/** `curves` is every score series available for the scenario, `totals` every
 *  (score, elapsed) pair. Curve evidence wins outright: it settles a scenario
 *  from a single run, where the totals test needs two. */
export function classify(
  curves: readonly ArrayLike<number>[],
  totals: readonly (readonly [number | null, number | null])[],
): Verdict {
  for (const series of curves) {
    const budget = countdownBudget(series);
    if (budget !== null) {
      return { shape: RACE, budget, evidence: 'perf-countdown' };
    }
  }
  const budget = budgetFromTotals(totals);
  if (budget !== null) {
    return { shape: RACE, budget, evidence: 'csv-constant-budget' };
  }
  return { shape: TIMED, budget: null, evidence: 'default' };
}
