import { describe, expect, it } from 'vitest';
import { materialiseMarks } from '../src/core/marks';
import type { Run, Shape } from '../src/core/types';

function run(over: Partial<Run> & Pick<Run, 'id'>): Run {
  return {
    scenario: 'S', started_at: '2026-01-01T00:00:00', has_perf: true,
    score: 100, kills: null, hits: null, misses: null, shots: null,
    accuracy: null, damage_done: null, damage_possible: null,
    avg_ttk: null, fight_time: null, pause_count: null,
    duration_s: 60, spm: null, elapsed_s: null,
    overshots: null, reloads: null, damage_taken: null,
    hash: null, game_version: null, sens_raw: null, sens_scale: null,
    dpi: null, sens_increment: null, cm360: null, cfg_key: '30.0',
    fov: null, fov_scale: null, resolution: null, avg_fps: null,
    ...over,
  } as Run;
}

const timed = () => 'timed' as Shape;

describe('materialiseMarks', () => {
  it('is empty for a debut', () => {
    const marks = materialiseMarks([run({ id: 'a' })], timed);
    expect(marks.get('a')).toEqual({
      cfg: { best_before: null, played_before: 0 },
      any: { best_before: null, played_before: 0 },
    });
  });

  it('carries the best prior run and how many there were', () => {
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 100 }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 300 }),
      run({ id: 'c', started_at: '2026-01-03T00:00:00', score: 200 }),
    ], timed);
    expect(marks.get('c')!.cfg).toEqual({ best_before: 300, played_before: 2 });
    expect(marks.get('b')!.cfg).toEqual({ best_before: 100, played_before: 1 });
  });

  it('does not let one scenario mark another', () => {
    const marks = materialiseMarks([
      run({ id: 'a', scenario: 'S', started_at: '2026-01-01T00:00:00', score: 999 }),
      run({ id: 'b', scenario: 'T', started_at: '2026-01-02T00:00:00', score: 1 }),
    ], timed);
    expect(marks.get('b')!.cfg.played_before).toBe(0);
  });

  it('separates the same-sensitivity variant from the relaxed one', () => {
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900, cfg_key: '45.0' }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 100, cfg_key: '30.0' }),
    ], timed);
    expect(marks.get('b')!.cfg).toEqual({ best_before: null, played_before: 0 });
    expect(marks.get('b')!.any).toEqual({ best_before: 900, played_before: 1 });
  });

  it('ignores the sensitivity filter when the focused run has none', () => {
    // Mirrors the SQL: the filter applies only when there is something to
    // filter on.
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900, cfg_key: '45.0' }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 100, cfg_key: null }),
    ], timed);
    expect(marks.get('b')!.cfg).toEqual({ best_before: 900, played_before: 1 });
  });

  it('drops a prior run whose duration is out of tolerance', () => {
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900, duration_s: 30 }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 100, duration_s: 60 }),
    ], timed);
    expect(marks.get('b')!.cfg).toEqual({ best_before: null, played_before: 0 });
  });

  it('keeps a prior run with no duration at all', () => {
    // No .perf means no duration. Such a run still counts toward score
    // baselines; it simply cannot supply a curve.
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900, duration_s: null }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 100, duration_s: 60 }),
    ], timed);
    expect(marks.get('b')!.cfg).toEqual({ best_before: 900, played_before: 1 });
  });

  it('skips the duration filter entirely on a race', () => {
    // Duration is the score there, so filtering by it throws the comparison
    // away: on the slowest real Air Pure Medium run the tolerance floor
    // excludes its own PB.
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900, duration_s: 94 }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 910, duration_s: 81 }),
    ], () => 'race');
    expect(marks.get('b')!.cfg).toEqual({ best_before: 900, played_before: 1 });
  });

  it('counts a prior run whose score is missing but does not rank it', () => {
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: null }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 100 }),
    ], timed);
    expect(marks.get('b')!.cfg).toEqual({ best_before: null, played_before: 1 });
  });

  it('excludes a run with an identical timestamp from its twin', () => {
    // The SQL compares started_at strictly, and it has second resolution with
    // no uniqueness constraint.
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900 }),
      run({ id: 'b', started_at: '2026-01-01T00:00:00', score: 100 }),
    ], timed);
    expect(marks.get('b')!.cfg.played_before).toBe(0);
  });

  it('does not care what order the runs arrive in', () => {
    // An out-of-order insert -- a restored backup, a re-pick -- must produce
    // the same marks as append order, which is why this is a fold over all
    // runs rather than something maintained incrementally.
    const rows = [
      run({ id: 'c', started_at: '2026-01-03T00:00:00', score: 200 }),
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 100 }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 300 }),
    ];
    expect(materialiseMarks(rows, timed).get('c')!.cfg)
      .toEqual({ best_before: 300, played_before: 2 });
  });
});
