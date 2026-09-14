import { describe, expect, it } from 'vitest';
import { parsePerf } from '../src/core/perf';
import { refreshScenario, type ScenarioInput } from '../src/core/scenario';
import { parseKills, parseStats } from '../src/core/statscsv';
import { readPerf, readStats } from './fixtures';

function input(id: string): ScenarioInput {
  const run = parseStats(id, readStats(id));
  const bytes = readPerf(id);
  const curve = bytes ? parsePerf(bytes) : null;
  if (curve) {
    run.has_perf = true;
    run.duration_s = curve.duration_s || null;
  }
  return { run, score: curve?.series.score ?? null, kills: parseKills(readStats(id)) };
}

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const SPECTRAL_A = 'Air Spectral Easy - Challenge - 2026.09.05-08.20.43';
const SPECTRAL_B = 'Air Spectral Easy - Challenge - 2026.09.11-18.37.39';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const PENALISING = 'VT 1w2ts Horizontal Small - Challenge - 2026.06.22-18.48.41';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';

describe('refreshScenario', () => {
  it('classifies a race from its countdown and sizes the pool', () => {
    const s = refreshScenario('Air Pure Medium', [input(AIR_A), input(AIR_B)])!;
    expect(s.shape).toBe('race');
    expect(s.evidence).toBe('perf-countdown');
    expect(s.budget).toBeCloseTo(999.9973754882812, 8);
    expect(s.pool).toBe(5000);
    expect(s.bots).toBe(5);
    expect(s.clock_s).toBeNull();
    // Negative every bucket by construction; that is the clock, not a penalty.
    expect(s.penalising).toBe(0);
  });

  it('classifies a race with no .perf from its totals', () => {
    const s = refreshScenario('Air Spectral Easy', [input(SPECTRAL_A), input(SPECTRAL_B)])!;
    expect(s.shape).toBe('race');
    expect(s.evidence).toBe('csv-constant-budget');
    expect(s.budget).toBeCloseTo(999.98094, 4);
    expect(s.pool).toBe(4800);
    expect(s.bots).toBe(6);
  });

  it('holds a curveless race at timed until a second run arrives', () => {
    // The safe direction, and self-correcting.
    const s = refreshScenario('Air Spectral Easy', [input(SPECTRAL_A)])!;
    expect(s.shape).toBe('timed');
  });

  it('detects fixed bot windows on a timed scenario', () => {
    const s = refreshScenario('VT Ground Intermediate S5',
      [input(GROUND_A), input(GROUND_B)])!;
    expect(s.shape).toBe('timed');
    expect(s.windowed).toBe(1);
    expect(s.bots).toBe(3);
    expect(s.clock_s).toBeCloseTo(59.994062423706055, 8);
  });

  it('detects a penalising scenario', () => {
    const s = refreshScenario('VT 1w2ts Horizontal Small', [input(PENALISING)])!;
    expect(s.shape).toBe('timed');
    expect(s.penalising).toBe(1);
    expect(s.windowed).toBe(0);
  });

  it('leaves a plain tracking scenario alone', () => {
    const s = refreshScenario('Air Voltaic Invincible 4 Medium', [input(TRACKING)])!;
    expect(s).toEqual({
      name: 'Air Voltaic Invincible 4 Medium',
      shape: 'timed', penalising: 0, budget: null, pool: null, bots: null,
      clock_s: expect.closeTo(59.985897064208984, 8),
      windowed: 0, evidence: 'default',
    });
  });

  it('sizes a race from the best run, not the average of a partial one', () => {
    // max, not median: a run quit part-way undercounts, and the median of two
    // would halve `bots` and put every kill mark at the wrong fraction.
    const full = input(AIR_B);
    const partial = input(AIR_A);
    partial.run.kills = 2;
    partial.run.hits = 2000;
    const s = refreshScenario('Air Pure Medium', [full, partial])!;
    expect(s.bots).toBe(5);
    expect(s.pool).toBe(5000);
  });

  it('returns null for a scenario with no runs', () => {
    expect(refreshScenario('nothing', [])).toBeNull();
  });
});
