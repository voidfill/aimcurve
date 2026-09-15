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
    expect(p.windows[0].window_s).toBe(18.993);
    expect(p.windows[0].mine).toBe(0.4465956140687721);
    expect(p.windows[0].base).toBe(0.29825678986109133);
    expect(p.windows[0].delta).toBe(0.14833882420768074);
  });

  it('names the most of a window anyone has taken, this run included', () => {
    const p = build(GROUND_B);
    expect(p.windows[0].best).toBe(0.4465956140687721);
    // The third window was better on the other run, so the ceiling is theirs.
    expect(p.windows[2].best).toBe(0.35538311842688974);
  });

  it('uses the same recent set the band is built from', () => {
    const p = build(GROUND_B);
    expect(p.windows[0].recent).toBe(0.29825678986109133);
    expect(p.windows[0].delta_recent).toBe(0.14833882420768074);
    // Move the stepper and both move together.
    expect(build(GROUND_B, { recentN: 0 }).windows[0].recent).toBeNull();
  });

  it('weights the whole-run summary by damage, not by window', () => {
    // The windows are 18.99 s and 20.39 s, so an unweighted mean of the three
    // shares over-counts the short one.
    const p = build(GROUND_B);
    expect(p.window_summary).not.toBeNull();
    expect(p.window_summary!.mine).toBe(0.3358887148407242);
    expect(p.window_summary!.base).toBe(0.3070336947352315);
    const unweighted = p.windows.reduce((a, w) => a + (w.mine as number), 0) / 3;
    expect(p.window_summary!.mine).not.toBeCloseTo(unweighted, 6);
  });

  it('reverses cleanly when the baseline is the other run', () => {
    const p = build(GROUND_A);
    expect(p.window_summary!.mine).toBe(0.3070336947352315);
    expect(p.window_summary!.base).toBe(0.3358887148407242);
  });

  it('keeps a window with no damage recorded out of the numerator only', () => {
    // The two filters differ on purpose: a null `dmg_done` leaves the
    // numerator but its window still counts as damage offered, so a hole
    // reads as "offered and not taken". Dropping the window from both instead
    // would raise this run's figure to 0.36690282938533414 -- better than it
    // really went, from missing data.
    const rows = statsIds().map((id) => ingest(id, readStats(id), readPerf(id)));
    rows.find((r) => r.run.id === GROUND_B)!.kills[1].dmg_done = null;
    const p = buildRunPayload(buildStore(rows), GROUND_B);
    expect(p.window_summary!.mine).toBe(0.24175958849061785);
    // And the window itself has no share at all, rather than a share of zero.
    expect(p.windows[1].mine).toBeNull();
    expect(p.windows[1].delta).toBeNull();
  });

  it('is absent on a scenario whose bots actually die', () => {
    const p = build(RELOAD);
    expect(p.windows).toEqual([]);
    expect(p.window_summary).toBeNull();
    expect(p.marks.aligned).toBe(false);
  });
});
