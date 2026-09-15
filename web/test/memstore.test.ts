import { describe, expect, it } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { readPerf, readStats, statsIds } from './fixtures';

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const SPECTRAL_B = 'Air Spectral Easy - Challenge - 2026.09.11-18.37.39';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';

const all = () => statsIds().map((id) => ingest(id, readStats(id), readPerf(id)));
const store = () => buildStore(all());

describe('ingest', () => {
  it('fills what only the curve knows', () => {
    const row = ingest(AIR_B, readStats(AIR_B), readPerf(AIR_B));
    expect(row.run.has_perf).toBe(true);
    expect(row.run.duration_s).toBeCloseTo(85.98716735839844, 10);
    expect(row.run.spm).toBeCloseTo(637.7688176588566, 8);
    // damage_possible is not a summary key; it comes from the curve.
    expect(row.run.damage_possible).toBe(8501);
    expect(row.curve!.buckets).toBe(86);
  });

  it('leaves a run without a .perf curve-less rather than failed', () => {
    const row = ingest(SPECTRAL_B, readStats(SPECTRAL_B), undefined);
    expect(row.run.has_perf).toBe(false);
    expect(row.run.duration_s).toBeNull();
    expect(row.run.spm).toBeNull();
    expect(row.curve).toBeNull();
    expect(row.error).toBeUndefined();
    expect(row.run.score).toBeCloseTo(927.416626, 6);
  });

  it('survives a truncated .perf and says why', () => {
    const bad = new Uint8Array([0x0a, 0x40, 0x01]);
    const row = ingest(AIR_B, readStats(AIR_B), bad);
    expect(row.run.has_perf).toBe(false);
    expect(row.curve).toBeNull();
    expect(row.error).toContain('truncated');
  });

  it('reads the kill rows', () => {
    expect(ingest(AIR_B, readStats(AIR_B), readPerf(AIR_B)).kills).toHaveLength(5);
    expect(ingest(TRACKING, readStats(TRACKING), readPerf(TRACKING)).kills).toEqual([]);
  });
});

describe('buildStore', () => {
  it('holds every run', async () => {
    expect(await store().counts()).toEqual({
      runs: 11, curves: 7, failed: 0, scenarios: 8,
    });
  });

  it('classifies each scenario over all of its runs', async () => {
    const s = store();
    expect((await s.getScenario('Air Pure Medium'))!.shape).toBe('race');
    expect((await s.getScenario('Air Spectral Easy'))!.evidence)
      .toBe('csv-constant-budget');
    expect((await s.getScenario('VT Ground Intermediate S5'))!.windowed).toBe(1);
    expect((await s.getScenario('VT 1w2ts Horizontal Small'))!.penalising).toBe(1);
  });

  it('serves the rail newest first, with its marks', async () => {
    const rail = await store().page(100, { sameCfg: true });
    expect(rail).toHaveLength(11);
    expect(rail[0]).toMatchObject({
      id: AIR_B, scenario: 'Air Pure Medium', shape: 'race',
      best_before: 906.138184, played_before: 1, buckets: 86,
    });
    expect(rail[1]).toMatchObject({
      id: SPECTRAL_B, best_before: 914.885254, played_before: 1, buckets: null,
    });
    expect(rail.map((r) => r.id)).toEqual([
      AIR_B, SPECTRAL_B, TRACKING,
      'Air Spectral Easy - Challenge - 2026.09.05-08.20.43',
      AIR_A,
      'Pasu Voltaic Reload Easier - Challenge - 2026.07.27-16.50.01',
      'VT 1w2ts Horizontal Small - Challenge - 2026.06.22-18.48.41',
      GROUND_B, GROUND_A,
      'Happy Easter! - Challenge - 2026.04.06-18.13.05',
      '1w2ts Pasu Perfected Easy - Challenge - 2025.12.29-22.57.12',
    ]);
  });

  it('marks a run with no per-second data with a null bucket count', async () => {
    // Roughly one run in seven. NULL is the marker the rail draws with, so it
    // must come from the absence of a curve rather than be inferred.
    const rail = await store().page(100, { sameCfg: true });
    expect(rail.find((r) => r.id === SPECTRAL_B)!.buckets).toBeNull();
  });

  it('pages from a cursor without repeating or skipping', async () => {
    const s = store();
    const first = await s.page(3, { sameCfg: true });
    const next = await s.page(3, { sameCfg: true, before: first[2].id });
    expect(first.map((r) => r.id)).not.toContain(next[0].id);
    expect(next[0].id).toBe('Air Spectral Easy - Challenge - 2026.09.05-08.20.43');
    expect(next).toHaveLength(3);
  });

  it('pages an unknown cursor to nothing, not to everything', async () => {
    // `(started_at, id) < (SELECT ... WHERE id = ?)` is NULL when the subquery
    // matches nothing, so the SQL returns no rows. Dropping the predicate
    // instead would wrap the infinite scroll back to the newest page and
    // repeat it for ever. Verified against compare.page(conn, 100, before=999).
    expect(await store().page(100, { sameCfg: true, before: 'no-such-run' }))
      .toEqual([]);
  });

  it('reads a negative limit as no limit, the way SQLite does', async () => {
    // slice(0, -1) would silently drop the last run instead.
    expect(await store().page(-1, { sameCfg: true })).toHaveLength(11);
  });

  it('ignores a repeated run rather than folding it in twice', async () => {
    // run.stats_file is UNIQUE and the index inserts OR IGNORE. Counting the
    // duplicate would inflate the scenario's run count and feed refreshScenario
    // the same curve twice.
    const rows = all();
    const doubled = buildStore([...rows, rows.find((r) => r.run.id === AIR_B)!]);
    expect((await doubled.counts()).runs).toBe(11);
    expect((await doubled.scenarioList())
      .find((s) => s.scenario === 'Air Pure Medium')!.runs)
      .toBe(2);
  });

  it('filters the rail by scenario', async () => {
    const rail = await store().page(
      100, { sameCfg: true, scenario: 'Air Pure Medium' });
    expect(rail.map((r) => r.id)).toEqual([AIR_B, AIR_A]);
  });

  it('picks peers by scenario, excluding the focused run', async () => {
    const peers = await store().candidates(AIR_B, {
      sameCfg: true, durationTol: 0.1, shape: 'race',
    });
    expect(peers.map((r) => r.id)).toEqual([AIR_A]);
  });

  it('skips the duration filter on a race', async () => {
    // 85.99 s against 93.85 s is a 9.15% gap: inside the default +-10%, so the
    // tolerance is tightened here to 5% to make the two shapes differ at all.
    // On a timed scenario the peer is then dropped; on a race it must not be,
    // because duration IS the score there.
    const s = store();
    expect(await s.candidates(
      AIR_B, { sameCfg: true, durationTol: 0.05, shape: 'race' }))
      .toHaveLength(1);
    expect(await s.candidates(
      AIR_B, { sameCfg: true, durationTol: 0.05, shape: 'timed' }))
      .toHaveLength(0);
  });

  it('finds the best value per slot', async () => {
    const s = store();
    const fastest = await s.bestBySlot([AIR_A, AIR_B], 'ttk');
    expect(fastest.get(1)).toBeCloseTo(14.137001, 6);
    expect(fastest.get(5)).toBeCloseTo(20.050001, 6);
    const share = await s.bestBySlot([GROUND_A, GROUND_B], 'share');
    expect(share.get(1)).toBeCloseTo(0.4465956140687721, 10);
    expect(share.get(3)).toBeCloseTo(0.35538311842688974, 10);
  });

  it('aggregates the scenario list newest-played first', async () => {
    const list = await store().scenarioList();
    expect(list.map((r) => r.scenario)).toEqual([
      'Air Pure Medium', 'Air Spectral Easy', 'Air Voltaic Invincible 4 Medium',
      'Pasu Voltaic Reload Easier', 'VT 1w2ts Horizontal Small',
      'VT Ground Intermediate S5', 'Happy Easter!', '1w2ts Pasu Perfected Easy',
    ]);
    expect(list[0]).toMatchObject({
      runs: 2, pb: 913.998901, shape: 'race',
      last_played: '2026-09-12T16:04:49',
    });
    expect(list[0].recent_form).toBeCloseTo(910.0685425, 6);
    expect(list[0].recent_elapsed).toBeCloseTo(89.92150000000038, 6);
    expect(list[0].pb_elapsed).toBeCloseTo(85.99399999999878, 6);
  });

  it('serves one day at a time, oldest first within the day', async () => {
    const s = store();
    expect((await s.day('2026-09-12')).map((r) => r.id)).toEqual([AIR_B]);
    expect((await s.day('2026-06-16')).map((r) => r.id))
      .toEqual([GROUND_A, GROUND_B]);
    expect(await s.day('1999-01-01')).toEqual([]);
    expect((await s.days()).at(-1)).toBe('2026-09-12');
  });
});
