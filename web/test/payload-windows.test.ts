import { describe, expect, it } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { buildRunPayload } from '../src/core/payload';
import { readPerf, readStats, statsIds } from './fixtures';

const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const RELOAD = 'Pasu Voltaic Reload Easier - Challenge - 2026.07.27-16.50.01';

const store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));
const build = (id: string, o = {}) => buildRunPayload(store, id, o);

describe('bot windows', () => {
  it('reports each window as a share of the damage it offered', () => {
    const p = build(GROUND_B);
    expect(p.windows).toHaveLength(3);
    expect(p.windows[0]).toMatchObject({ idx: 1, bot: 'Ground 1 Bot' });
    expect(p.windows[0].window_s).toBeCloseTo(18.993, 6);
    expect(p.windows[0].mine).toBeCloseTo(0.4465956140687721, 12);
    expect(p.windows[0].base).toBeCloseTo(0.29825678986109133, 12);
    expect(p.windows[0].delta).toBeCloseTo(0.14833882420768074, 12);
  });

  it('names the most of a window anyone has taken, this run included', () => {
    const p = build(GROUND_B);
    expect(p.windows[0].best).toBeCloseTo(0.4465956140687721, 12);
    // The third window was better on the other run, so the ceiling is theirs.
    expect(p.windows[2].best).toBeCloseTo(0.35538311842688974, 12);
  });

  it('uses the same recent set the band is built from', () => {
    const p = build(GROUND_B);
    expect(p.windows[0].recent).toBeCloseTo(0.29825678986109133, 12);
    expect(p.windows[0].delta_recent).toBeCloseTo(0.14833882420768074, 12);
    // Move the stepper and both move together.
    expect(build(GROUND_B, { recentN: 0 }).windows[0].recent).toBeNull();
  });

  it('weights the whole-run summary by damage, not by window', () => {
    // The windows are 18.99 s and 20.39 s, so an unweighted mean of the three
    // shares over-counts the short one.
    const p = build(GROUND_B);
    expect(p.window_summary).not.toBeNull();
    expect(p.window_summary!.mine).toBeCloseTo(0.3358887148407242, 12);
    expect(p.window_summary!.base).toBeCloseTo(0.3070336947352315, 12);
    const unweighted = p.windows.reduce((a, w) => a + (w.mine as number), 0) / 3;
    expect(p.window_summary!.mine).not.toBeCloseTo(unweighted, 6);
  });

  it('reverses cleanly when the baseline is the other run', () => {
    const p = build(GROUND_A);
    expect(p.window_summary!.mine).toBeCloseTo(0.3070336947352315, 12);
    expect(p.window_summary!.base).toBeCloseTo(0.3358887148407242, 12);
  });

  it('is absent on a scenario whose bots actually die', () => {
    const p = build(RELOAD);
    expect(p.windows).toEqual([]);
    expect(p.window_summary).toBeNull();
    expect(p.marks.aligned).toBe(false);
  });
});
