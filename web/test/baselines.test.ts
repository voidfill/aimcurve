import { describe, expect, it } from 'vitest';
import { baselines } from '../src/core/baselines';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { readPerf, readStats, statsIds } from './fixtures';

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const SPECTRAL_A = 'Air Spectral Easy - Challenge - 2026.09.05-08.20.43';
const SPECTRAL_B = 'Air Spectral Easy - Challenge - 2026.09.11-18.37.39';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const EASTER = 'Happy Easter! - Challenge - 2026.04.06-18.13.05';

const store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));
const opts = { recentN: 10, sameCfg: true, durationTol: 0.1 };

describe('baselines', () => {
  it('resolves the PB and the recent form of a race run', async () => {
    const b = await baselines(store, AIR_B, { ...opts, shape: 'race' });
    expect(b.candidates).toBe(1);
    expect(b.true_pb).toEqual({
      run_id: AIR_A, score: 906.138184, started_at: '2026-09-03T19:08:37',
    });
    expect(b.pb!.run_id).toBe(AIR_A);
    expect(b.pb!.is_true_pb).toBe(true);
    expect(b.pb!.curve).not.toBeNull();
    expect(b.recent.n).toBe(1);
    expect(b.recent.mean_score).toBeCloseTo(906.138184, 6);
    expect(b.recent.run_ids).toEqual([AIR_A]);
  });

  it('has no recent form on the oldest run of a scenario', async () => {
    const b = await baselines(store, AIR_A, { ...opts, shape: 'race' });
    // The newer run is still a candidate and still the PB -- "recent" means
    // prior, but "best" means best.
    expect(b.candidates).toBe(1);
    expect(b.true_pb!.run_id).toBe(AIR_B);
    expect(b.pb!.run_id).toBe(AIR_B);
    expect(b.recent.n).toBe(0);
    expect(b.recent.mean_score).toBeNull();
    expect(b.recent.run_ids).toBeNull();
  });

  it('reports a true PB it cannot draw', async () => {
    // Neither Air Spectral Easy run has a .perf, so there is a real PB and no
    // overlay. Presenting a non-PB as the PB is the failure this avoids.
    const b = await baselines(store, SPECTRAL_A, { ...opts, shape: 'race' });
    expect(b.true_pb!.run_id).toBe(SPECTRAL_B);
    expect(b.pb).toBeNull();
    expect(b.recent.curve).toBeNull();
  });

  it('resolves a timed run against its prior', async () => {
    const b = await baselines(store, GROUND_B, { ...opts, shape: 'timed' });
    expect(b.true_pb!.run_id).toBe(GROUND_A);
    expect(b.pb!.run_id).toBe(GROUND_A);
    expect(b.recent.n).toBe(1);
    expect(b.recent.mean_score).toBe(1814);
    expect(b.recent.curve).toHaveLength(1);
    expect(b.recent.run_ids).toEqual([GROUND_A]);
  });

  it('keeps curves and their run ids index-aligned', async () => {
    // A race curve is resampled against its own run's elapsed_s. Misaligning
    // these two lists rescales a slow run onto someone else's clock, which
    // hides it inside a band that looks normal.
    const b = await baselines(store, AIR_B, { ...opts, shape: 'race' });
    expect(b.recent.curve).toHaveLength(b.recent.run_ids!.length);
    expect(b.recent.curve![0].buckets)
      .toBe((await store.getCurve(b.recent.run_ids![0]))!.buckets);
  });

  it('degrades to nothing for a scenario with one run', async () => {
    const b = await baselines(store, EASTER, { ...opts, shape: 'timed' });
    expect(b).toEqual({
      pb: null, true_pb: null,
      recent: { n: 0, mean_score: null, curve: null, run_ids: null },
      candidates: 0,
    });
  });

  it('treats a non-positive recent_n as none, not as all', async () => {
    // Python's prior[-0:] is every prior run and a negative slice drops from
    // the front. Neither is a request; both are clamped.
    for (const recentN of [0, -5]) {
      const b = await baselines(store, AIR_B, { ...opts, recentN, shape: 'race' });
      expect(b.recent.n).toBe(0);
    }
  });

  it('drops peers at a different sensitivity when asked to', async () => {
    // Every run of a fixture scenario shares its cm/360, so the flag has to be
    // given something to bite on: asserting `candidates` on the corpus as it
    // stands passes with the filter deleted.
    const rows = statsIds().map((id) => ingest(id, readStats(id), readPerf(id)));
    rows.find((r) => r.run.id === AIR_A)!.run.cfg_key = '45.0';
    const mixed = buildStore(rows);
    expect((await baselines(mixed, AIR_B, { ...opts, shape: 'race' })).candidates)
      .toBe(0);
    expect((await baselines(
      mixed, AIR_B, { ...opts, sameCfg: false, shape: 'race' })).candidates)
      .toBe(1);
  });
});
