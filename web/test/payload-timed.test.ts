import { describe, expect, it } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { buildRunPayload } from '../src/core/payload';
import { readPerf, readStats, statsIds } from './fixtures';

const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const RELOAD = 'Pasu Voltaic Reload Easier - Challenge - 2026.07.27-16.50.01';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';
const EASTER = 'Happy Easter! - Challenge - 2026.04.06-18.13.05';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';

const store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));
const build = (id: string, o = {}) => buildRunPayload(store, id, o);

describe('buildRunPayload, timed', () => {
  it('carries the run, its scenario and a seconds axis', () => {
    const p = build(GROUND_B);
    expect(p.run.id).toBe(GROUND_B);
    expect(p.run.buckets).toBe(60);
    expect(p.run.score).toBe(2009);
    expect(p.scenario.shape).toBe('timed');
    expect(p.scenario.windowed).toBe(1);
    expect(p.axis).toEqual({ kind: 'time', label: 'seconds', n: 60 });
  });

  it('smooths the rate series but never the delta', () => {
    const p = build(GROUND_B);
    expect(p.rate.metric).toBe('score');
    expect(p.rate.unit).toBe('score');
    expect(p.rate.mine.slice(0, 4).map((v) => +v.toFixed(4)))
      .toEqual([52.6667, 49.5, 44.6, 40.2]);
    expect(p.delta.values!.slice(0, 4)).toEqual([34, 66, 54, 52]);
  });

  it('ends the delta exactly at the score difference', () => {
    const p = build(GROUND_B);
    expect(p.delta.unit).toBe('points');
    expect(p.delta.final).toBe(2009 - 1814);
    expect(p.delta.compare_until).toBe(60);
    expect(p.delta.baseline).toEqual({
      run_id: GROUND_A, score: 1814, is_true_pb: true,
    });
  });

  it('names the same baseline in the delta and in the headline', () => {
    const p = build(GROUND_B);
    expect(p.delta.baseline!.run_id).toBe(p.baselines.pb!.run_id);
  });

  it('marks a windowed scenario with shared, named boundaries', () => {
    const p = build(GROUND_B);
    expect(p.marks.aligned).toBe(true);
    expect(p.marks.labels).toEqual(['Ground 1 Bot', 'Ground 2 Bot', 'Ground 3 Bot']);
    expect(p.marks.kills.map((v) => +v.toFixed(3)))
      .toEqual([18.997, 39.398, 59.8]);
  });

  it('marks an ordinary scenario with the run\'s own kills, unaligned', () => {
    const p = build(RELOAD);
    expect(p.marks.aligned).toBe(false);
    expect(p.marks.labels).toEqual([]);
    expect(p.marks.kills).toHaveLength(52);
  });

  it('renders zero kill marks when nothing ever dies', () => {
    // 1090 of 2360 real runs have no kill rows. It is the normal case.
    const p = build(TRACKING);
    expect(p.marks.kills).toEqual([]);
    expect(p.splits).toEqual([]);
    expect(p.windows).toEqual([]);
  });

  it('offers efficiency only where damage is booked per tick', () => {
    // 5928 shots against 5.93 damage possible: the per-second ratio is a flat
    // zero rather than a measurement.
    expect(build(GROUND_B).metrics).toEqual(['score', 'shots', 'hits', 'kills', 'accuracy']);
    expect(build(RELOAD).metrics)
      .toEqual(['score', 'shots', 'hits', 'kills', 'accuracy', 'efficiency']);
  });

  it('offers no metric buttons at all on a race', () => {
    // The shape fixes the y series; six buttons would redraw one line.
    expect(build(AIR_B).metrics).toEqual([]);
  });

  it('computes a ratio metric per bucket', () => {
    const p = build(RELOAD, { metric: 'accuracy', smoothing: 0 });
    expect(p.rate.metric).toBe('accuracy');
    expect(p.rate.mine.slice(0, 6)).toEqual([0, 1, 1, 0, 1, 1]);
  });

  it('rejects a metric it does not know', () => {
    expect(() => build(GROUND_B, { metric: 'nonsense' })).toThrow(/unknown metric/);
  });

  it('rejects a run it does not have', () => {
    expect(() => build('no such run')).toThrow(/no such run/);
  });

  it('charts alone when there is nothing to compare against', () => {
    const p = build(EASTER);
    expect(p.axis.n).toBe(0);
    expect(p.rate.mine).toEqual([]);
    expect(p.rate.pb).toBeNull();
    expect(p.rate.band).toBeNull();
    expect(p.delta.values).toBeNull();
    expect(p.delta.final).toBeNull();
    expect(p.baselines.candidates).toBe(0);
  });

  it('draws no band when there is only one prior run', () => {
    // The band exists but collapses; with no prior run at all it is absent.
    expect(build(GROUND_A).rate.band).toBeNull();
    expect(build(GROUND_B).rate.band).not.toBeNull();
    expect(build(GROUND_B, { recentN: 0 }).rate.band).toBeNull();
  });
});
