import { describe, expect, it } from 'vitest';
import { getHealth, getRun, getRuns, getScenarios, getSession } from '../src/core/api';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { readPerf, readStats, statsIds } from './fixtures';

const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';

const store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));

describe('api', () => {
  it('serves the rail with a default limit', async () => {
    expect(await getRuns(store, {})).toHaveLength(11);
    expect(await getRuns(store, { limit: 2 })).toHaveLength(2);
    expect((await getRuns(store, {}))[0].id).toBe(AIR_B);
  });

  it('pages from a cursor, and answers an unknown one with nothing', async () => {
    // The oracle diff pages from every run id, so this is no longer the only
    // thing holding the cursor to the Python's -- but it runs offline, and the
    // unknown cursor is a case the diff cannot reach: the dump can only page
    // from ids that exist.
    const first = await getRuns(store, { limit: 3 });
    expect((await getRuns(store, { limit: 3, before: first[2].id }))[0].id)
      .toBe('Air Spectral Easy - Challenge - 2026.09.05-08.20.43');
    expect(await getRuns(store, { before: 'no such run' })).toEqual([]);
  });

  it('refuses a limit outside the range the Python bounds it to', async () => {
    // SQLite reads a negative limit as no limit, so an unchecked -1 from a URL
    // is a request for the whole table rather than an error.
    await expect(getRuns(store, { limit: -1 })).rejects.toThrow(/out of range/);
    await expect(getRuns(store, { limit: 100_001 })).rejects.toThrow(/out of range/);
  });

  it('serves one run', async () => {
    expect((await getRun(store, AIR_B, {})).run.id).toBe(AIR_B);
  });

  it('serves the scenario list', async () => {
    expect(await getScenarios(store)).toHaveLength(8);
    expect((await getScenarios(store))[0].scenario).toBe('Air Pure Medium');
  });

  it('defaults the session to the most recent day with runs', async () => {
    const s = await getSession(store);
    expect(s.day).toBe('2026-09-12');
    expect(s.runs.map((r) => r.id)).toEqual([AIR_B]);
  });

  it('serves a named day', async () => {
    expect((await getSession(store, '2026-06-16')).runs.map((r) => r.id))
      .toEqual([GROUND_A, GROUND_B]);
  });

  it('answers an empty day without inventing one', async () => {
    const s = await getSession(store, '1999-01-01');
    expect(s).toEqual({ day: '1999-01-01', runs: [] });
  });

  it('has no day at all on an empty index', async () => {
    expect(await getSession(buildStore([]))).toEqual({ day: null, runs: [] });
  });

  it('reports health', async () => {
    expect(await getHealth(store)).toEqual({
      runs: 11, curves: 7, failed: 0, scenarios: 8,
      awaiting_perf: 0, watcher_errors: 0,
    });
  });
});
