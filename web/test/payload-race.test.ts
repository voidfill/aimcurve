import { describe, expect, it } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { buildRunPayload } from '../src/core/payload';
import { readPerf, readStats, statsIds } from './fixtures';

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const SPECTRAL_A = 'Air Spectral Easy - Challenge - 2026.09.05-08.20.43';

const store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));
const build = (id: string, o = {}) => buildRunPayload(store, id, o);

describe('buildRunPayload, race', () => {
  it('charts against progress through the damage pool', async () => {
    const p = await build(AIR_B);
    expect(p.axis).toEqual({ kind: 'progress', label: '% of pool', n: 200 });
    expect(p.rate.metric).toBe('damage');
    expect(p.rate.unit).toBe('dmg/s');
    expect(p.rate.mine).toHaveLength(200);
    // Full precision, not four places: rounding here would swallow exactly
    // the drift the compensated sums exist to prevent.
    expect(p.rate.mine.slice(0, 4)).toEqual([
      89.00620973556421, 88.89550549459958, 88.71763238833056, 88.51761843386862,
    ]);
  });

  it('shares kill marks across every run of the scenario', async () => {
    // Kill k lands at damage k*pool/bots in every run, so the boundaries
    // coincide. On a seconds axis they never would.
    const p = await build(AIR_B);
    expect(p.marks.aligned).toBe(true);
    expect(p.marks.kills).toEqual([0.2, 0.4, 0.6, 0.8, 1.0]);
    expect(p.marks.labels).toEqual([
      'AIR1_Short_close', 'AIR1_Short_far', 'AIR2_Long3D_mid',
      'AIR2_Short_close', 'AIR2_Mid_UFO',
    ]);
  });

  it('measures the delta in seconds over the whole pool', async () => {
    const p = await build(AIR_B);
    expect(p.delta.unit).toBe('seconds');
    expect(p.delta.values).toHaveLength(200);
    expect(p.delta.values![0]).toBe(0.08617719803760315);
    expect(p.delta.final).toBe(7.855000000003201);
    // Both runs cover the whole pool by definition: no tail to shade.
    expect(p.delta.compare_until).toBe(1.0);
    expect(p.delta.baseline).toEqual({
      run_id: AIR_A, score: 906.138184, is_true_pb: true,
    });
  });

  it('lands within the CSV timestamp resolution of the score difference', async () => {
    const p = await build(AIR_B);
    const scoreDiff = 913.998901 - 906.138184;
    expect(Math.abs(p.delta.final! - scoreDiff)).toBeLessThan(0.02);
  });

  it('reconciles the split table', async () => {
    // sum(ttk) + dead == elapsed. If this does not hold the code is wrong --
    // it catches a per-kill parse error, a dead-time sign error and a budget
    // error at once.
    const p = await build(AIR_B);
    const bots = p.splits.filter((s) => s.idx !== null);
    const dead = p.splits.find((s) => s.idx === null)!;
    expect(bots).toHaveLength(5);
    expect(dead.bot).toBe('dead time');
    const total = bots.reduce((a, s) => a + (s.mine as number), 0) + (dead.mine as number);
    expect(total).toBeCloseTo(p.run.elapsed_s!, 6);
    expect(dead.mine).toBe(1.044994999998778);
  });

  it('names the fastest each bot has ever gone down, this run included', async () => {
    const p = await build(AIR_B);
    expect(p.splits[0]).toMatchObject({ idx: 1, bot: 'AIR1_Short_close' });
    expect(p.splits[0].mine).toBe(14.137001);
    expect(p.splits[0].base).toBe(15.48);
    expect(p.splits[0].best).toBe(14.137001);
    expect(p.splits[0].delta).toBe(-1.3429990000000007);
  });

  it('adjusts each split by the run\'s own mean, so they sum to zero', async () => {
    const p = await build(AIR_B);
    const adj = p.splits
      .filter((s) => s.delta_adj !== null)
      .map((s) => s.delta_adj as number);
    expect(adj).toHaveLength(5);
    expect(adj.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
    expect(adj[0]).toBe(0.22880079999999947);
    expect(adj[4]).toBe(-6.697201199999999);
  });

  it('reads the same dead-time pair from either side of the comparison', async () => {
    // Symmetric by construction: each run's dead time is its own residual, so
    // swapping which run is focused swaps the two columns and nothing else.
    const p = await build(AIR_A);
    const dead = p.splits.find((s) => s.idx === null)!;
    expect(dead.mine).toBe(1.0409960000019822);
    expect(dead.base).toBe(1.044994999998778);
  });

  it('works on a race with no curve at all', async () => {
    // Air Spectral Easy is classified from CSV totals; neither run has a
    // .perf. The axis, the marks and the split table still mean something.
    const p = await build(SPECTRAL_A);
    expect(p.axis).toEqual({ kind: 'progress', label: '% of pool', n: 240 });
    expect(p.rate.mine).toEqual([]);
    expect(p.rate.pb).toBeNull();
    expect(p.delta.values).toBeNull();
    expect(p.marks.kills).toHaveLength(6);
    expect(p.splits.filter((s) => s.idx !== null)).toHaveLength(6);
    // Exactly, because this is where the Python's compensated sum shows: its
    // six TTKs total 85.034005 and a left-to-right loop gives
    // 85.03400500000001, and the difference lands in this residual.
    expect(p.splits.find((s) => s.idx === null)!.mine).toBe(0.0589950000007633);
  });

  it('builds the band from each run\'s own clock', async () => {
    // Scaling a band member onto the focused run's clock moves a real run by
    // up to ~15%, which hides a slow run inside a band that looks normal.
    const p = await build(AIR_B);
    expect(p.rate.band).not.toBeNull();
    expect(p.rate.band!.mean).toHaveLength(200);
    // One member, so the band collapses onto the PB's own resampled rate.
    expect(p.rate.band!.mean[0]).toBe(p.rate.pb![0]);
  });
});
