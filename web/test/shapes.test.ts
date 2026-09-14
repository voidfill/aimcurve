import { describe, expect, it } from 'vitest';
import { parsePerf } from '../src/core/perf';
import {
  budgetFromTotals, classify, countdownBudget, fixedWindows, isPenalising,
} from '../src/core/shapes';
import { parseKills } from '../src/core/statscsv';
import { readPerf, readStats } from './fixtures';

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const PENALISING = 'VT 1w2ts Horizontal Small - Challenge - 2026.06.22-18.48.41';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';

const score = (id: string) => parsePerf(readPerf(id)!).series.score;
const ttks = (id: string) => parseKills(readStats(id)).map((k) => k.ttk);

describe('countdownBudget', () => {
  it('recognises a race scenario countdown', () => {
    expect(countdownBudget(score(AIR_B))).toBeCloseTo(999.9973754882812, 10);
    expect(countdownBudget(score(AIR_A))).toBeCloseTo(999.9983520507812, 10);
  });

  it('does not fire on a fixed-clock scenario', () => {
    expect(countdownBudget(score(GROUND_A))).toBeNull();
    expect(countdownBudget(score(TRACKING))).toBeNull();
  });

  it('does not mistake a penalising scenario for a countdown', () => {
    // Negative buckets are not a clock. A countdown is negative in *every*
    // interior bucket by construction; a penalty is occasional.
    expect(countdownBudget(score(PENALISING))).toBeNull();
  });

  it('tolerates jitter but not a wrong shape', () => {
    // >=90%, not 100%: bucketing by floor(timestamp) occasionally merges two
    // ticks into one bucket, producing a 0 beside a -2. One such merge needs a
    // body of at least 20 to still clear 90% (18/20 = 0.9 exactly) -- the
    // plan's original 10-body literal only reached 8/10 = 0.8 and, checked
    // against the Python oracle, returns None there too. This is 20 long so
    // the single merge still clears the threshold.
    const jittery = [999, ...Array(9).fill(-1), 0, -2, ...Array(9).fill(-1), -0.4];
    expect(countdownBudget(jittery)).toBeCloseTo(1000, 6);
    const half = [999, -1, -1, 5, 5, 5, 5, -1, -1, -1, -1, -0.4];
    expect(countdownBudget(half)).toBeNull();
  });

  it('needs a positive seed and enough buckets', () => {
    expect(countdownBudget([999, -1, -1])).toBeNull();
    expect(countdownBudget([-1, -1, -1, -1, -1])).toBeNull();
  });
});

describe('budgetFromTotals', () => {
  it('settles a race scenario with no .perf at all', () => {
    // Air Spectral Easy: two runs, no performance files. Constant budget,
    // 12.5 s of duration spread.
    expect(budgetFromTotals([[914.885254, 85.093], [927.416626, 72.567]]))
      .toBeCloseTo(999.98094, 5);
  });

  it('refuses a single run', () => {
    // One run landing near a round hundred minus its clock is a coincidence;
    // 6 of 2360 fixed-clock runs do it.
    expect(budgetFromTotals([[914.885254, 85.093]])).toBeNull();
  });

  it('refuses when the budget is not constant', () => {
    expect(budgetFromTotals([[900, 85], [950, 72]])).toBeNull();
  });

  it('refuses when the duration barely varies', () => {
    expect(budgetFromTotals([[940.0, 60.0], [940.2, 59.8]])).toBeNull();
  });

  it('ignores pairs it cannot use', () => {
    expect(budgetFromTotals([[914.885254, 85.093], [927.416626, null], [null, 72.567]]))
      .toBeNull();
  });
});

describe('fixedWindows', () => {
  it('recognises slots whose length the scenario fixes', () => {
    // Invincible bots never die; KovaaK's still writes a kill row per bot and
    // the TTK is the window the scenario gave it, identical run to run.
    const bySlot = new Map<number, (number | null)[]>([
      [1, [ttks(GROUND_A)[0], ttks(GROUND_B)[0]]],
      [2, [ttks(GROUND_A)[1], ttks(GROUND_B)[1]]],
      [3, [ttks(GROUND_A)[2], ttks(GROUND_B)[2]]],
    ]);
    expect(fixedWindows(bySlot)).toBe(3);
  });

  it('rejects slots that record how long a kill actually took', () => {
    const bySlot = new Map<number, (number | null)[]>([
      [1, [ttks(AIR_A)[0], ttks(AIR_B)[0]]],
      [2, [ttks(AIR_A)[1], ttks(AIR_B)[1]]],
    ]);
    expect(fixedWindows(bySlot)).toBeNull();
  });

  it('needs two runs before it will call a slot fixed', () => {
    expect(fixedWindows(new Map([[1, [18.996]]]))).toBeNull();
  });

  it('skips slots too thin to judge rather than failing the scenario', () => {
    // A run quit part-way leaves later slots with one sample.
    const bySlot = new Map<number, (number | null)[]>([
      [1, [18.996, 18.993]],
      [2, [20.392, 20.390001]],
      [3, [20.398001]],
    ]);
    expect(fixedWindows(bySlot)).toBe(2);
  });

  it('returns null when nothing is judgeable', () => {
    expect(fixedWindows(new Map())).toBeNull();
    expect(fixedWindows(new Map([[1, [null, null]]]))).toBeNull();
  });
});

describe('isPenalising', () => {
  it('is true when a second cost points outright', () => {
    expect(isPenalising(score(PENALISING))).toBe(true);
  });

  it('is false for a scenario that only ever gains', () => {
    expect(isPenalising(score(TRACKING))).toBe(false);
  });

  it('is true of a countdown too, which is why it is only asked of timed', () => {
    // A countdown is negative every bucket by construction. That is the clock,
    // not a penalty, so refreshScenario never asks this of a race.
    expect(isPenalising(score(AIR_B))).toBe(true);
  });
});

describe('classify', () => {
  it('prefers curve evidence, which settles a scenario from one run', () => {
    expect(classify([Array.from(score(AIR_B))], [[913.998901, 85.994]])).toEqual({
      shape: 'race',
      budget: expect.closeTo(999.9973754882812, 8),
      evidence: 'perf-countdown',
    });
  });

  it('falls back to totals when there is no curve', () => {
    const verdict = classify([], [[914.885254, 85.093], [927.416626, 72.567]]);
    expect(verdict.shape).toBe('race');
    expect(verdict.evidence).toBe('csv-constant-budget');
  });

  it('defaults to timed, which is the safe direction', () => {
    const verdict = classify([Array.from(score(GROUND_A))], [[1814, 59.801]]);
    expect(verdict).toEqual({ shape: 'timed', budget: null, evidence: 'default' });
  });
});
