/** A Store held entirely in memory.
 *
 * Not a test double. It is how the oracle diff runs, and it is the read path
 * for a bootstrap whose database has not been written yet. Plan B's IndexedDB
 * store answers the same questions from disk.
 */

import type { Ingested } from './ingest';
import { materialiseMarks } from './marks';
import { refreshScenario, type ScenarioInput } from './scenario';
import { RACE } from './shapes';
import type {
  CandidateOpts, Counts, PageOpts, ScenarioListRow, SessionRow, SlotMetric, Store,
} from './store';
import type { Curve, Kill, RailRow, Run, RunMarks, Scenario, Shape } from './types';

const RECENT_FORM_N = 10;

function byTimeThenId(a: Run, b: Run): number {
  if (a.started_at !== b.started_at) return a.started_at < b.started_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildStore(rows: readonly Ingested[]): Store {
  const runs = new Map<string, Run>();
  const curves = new Map<string, Curve>();
  const kills = new Map<string, Kill[]>();
  let failed = 0;

  // A repeated id is dropped whole rather than merged: `run.stats_file` is
  // UNIQUE and the index inserts OR IGNORE, so the first row wins there too.
  // Letting the second through would count it twice in `scenarioList` and fold
  // it twice into the scenario's shape while `counts` stayed right.
  const seen = rows.filter((row) => {
    if (runs.has(row.run.id)) return false;
    runs.set(row.run.id, row.run);
    if (row.curve) curves.set(row.run.id, row.curve);
    kills.set(row.run.id, row.kills);
    // Not `SELECT COUNT(*) FROM failed`: the Python's table is keyed by path,
    // outlives a bootstrap and also records CSVs that never became runs. This
    // counts the perf failures of the rows in hand, which is all a store built
    // from a single pass can know.
    if (row.error !== undefined) failed += 1;
    return true;
  });

  // Classification is a fold over every run of a scenario, so it happens after
  // all of them are in. Doing it per run would classify a race scenario from
  // its first run alone, before the evidence that settles it has landed.
  const byScenario = new Map<string, ScenarioInput[]>();
  for (const row of seen) {
    const input: ScenarioInput = {
      run: row.run,
      score: row.curve?.series.score ?? null,
      kills: row.kills,
    };
    const group = byScenario.get(row.run.scenario);
    if (group) group.push(input);
    else byScenario.set(row.run.scenario, [input]);
  }
  const scenarios = new Map<string, Scenario>();
  for (const [name, inputs] of byScenario) {
    const scenario = refreshScenario(name, inputs);
    if (scenario) scenarios.set(name, scenario);
  }

  const shapeOf = (name: string): Shape => scenarios.get(name)?.shape ?? 'timed';
  const marks: Map<string, RunMarks> = materialiseMarks([...runs.values()], shapeOf);

  const newestFirst = [...runs.values()].sort((a, b) => -byTimeThenId(a, b));

  const railRow = (run: Run, sameCfg: boolean): RailRow => {
    const mark = marks.get(run.id)!;
    const set = sameCfg ? mark.cfg : mark.any;
    return {
      id: run.id,
      scenario: run.scenario,
      started_at: run.started_at,
      score: run.score,
      accuracy: run.accuracy,
      spm: run.spm,
      cfg_key: run.cfg_key,
      // NULL means no per-second data, which is what the rail draws with.
      buckets: curves.get(run.id)?.buckets ?? null,
      shape: scenarios.get(run.scenario)?.shape ?? null,
      best_before: set.best_before,
      played_before: set.played_before,
    };
  };

  const mean = (values: readonly number[]): number | null =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  return {
    getRun: (id) => runs.get(id),
    getScenario: (name) => scenarios.get(name),
    getCurve: (id) => curves.get(id),
    getKills: (id) => kills.get(id) ?? [],

    candidates(id: string, opts: CandidateOpts): Run[] {
      const focus = runs.get(id);
      if (!focus) throw new Error(`no such run: ${id}`);
      let rows2 = newestFirst
        .filter((r) => r.scenario === focus.scenario && r.id !== id)
        .sort(byTimeThenId);
      if (opts.sameCfg && focus.cfg_key !== null) {
        rows2 = rows2.filter((r) => r.cfg_key === focus.cfg_key);
      }
      // Duration is the score on a race scenario, so filtering baselines by it
      // throws away the comparison.
      const target = focus.duration_s;
      if (target && opts.shape !== RACE) {
        rows2 = rows2.filter((r) =>
          // Unknown duration means no .perf. Such a run still counts toward
          // score baselines; it simply cannot supply a curve.
          r.duration_s === null
          || Math.abs(r.duration_s - target) <= target * opts.durationTol);
      }
      return rows2;
    },

    page(limit: number, opts: PageOpts): RailRow[] {
      let rows2 = newestFirst;
      if (opts.scenario) rows2 = rows2.filter((r) => r.scenario === opts.scenario);
      if (opts.before != null) {
        const cursor = runs.get(opts.before);
        // The cursor is the whole (started_at, id) pair: started_at has second
        // resolution and no uniqueness constraint, so a cursor on time alone
        // would drop a run whose timestamp straddled a page boundary.
        //
        // An unknown cursor pages to nothing, not to everything: the SQL's
        // subquery yields NULL, `(started_at, id) < NULL` is NULL, and no row
        // survives. Dropping the predicate instead would wrap an infinite
        // scroll back to the newest rows and repeat them for ever.
        rows2 = cursor ? rows2.filter((r) => byTimeThenId(r, cursor) < 0) : [];
      }
      // SQLite reads a negative LIMIT as no limit at all; slice(0, -1) would
      // quietly drop the last row instead.
      return (limit < 0 ? rows2 : rows2.slice(0, limit))
        .map((r) => railRow(r, opts.sameCfg));
    },

    bestBySlot(ids: readonly string[], metric: SlotMetric): Map<number, number> {
      const best = new Map<number, number>();
      for (const id of ids) {
        for (const kill of kills.get(id) ?? []) {
          let value: number | null;
          if (metric === 'ttk') {
            value = kill.ttk;
          } else {
            // SQLite's `dmg_done * 1.0 / dmg_possible IS NOT NULL` filters a
            // row out when either operand is NULL or dmg_possible is zero --
            // a missing dmg_done is a hole, not a zero-damage share.
            value = kill.dmg_possible && kill.dmg_done !== null
              ? kill.dmg_done / kill.dmg_possible
              : null;
          }
          if (value === null) continue;
          const current = best.get(kill.idx);
          const better = current === undefined
            || (metric === 'ttk' ? value < current : value > current);
          if (better) best.set(kill.idx, value);
        }
      }
      return best;
    },

    scenarioList(): ScenarioListRow[] {
      const out: ScenarioListRow[] = [];
      for (const [name, group] of byScenario) {
        const scenarioRuns = group.map((g) => g.run).sort(byTimeThenId);
        const scored = scenarioRuns.filter((r) => r.score !== null);
        const pb = scored.length ? Math.max(...scored.map((r) => r.score as number)) : null;
        // The PB run's elapsed, by score descending -- the same order the SQL
        // takes its LIMIT 1 in.
        const byScore = [...scored].sort((a, b) => (b.score as number) - (a.score as number));
        const recent = scenarioRuns.slice(-RECENT_FORM_N);
        out.push({
          scenario: name,
          runs: scenarioRuns.length,
          pb,
          last_played: scenarioRuns[scenarioRuns.length - 1].started_at,
          shape: scenarios.get(name)?.shape ?? null,
          pb_elapsed: byScore.length ? byScore[0].elapsed_s : null,
          recent_elapsed: mean(
            recent.map((r) => r.elapsed_s).filter((v): v is number => v !== null)),
          recent_form: mean(
            recent.map((r) => r.score).filter((v): v is number => v !== null)),
        });
      }
      return out.sort((a, b) =>
        a.last_played === b.last_played ? 0 : a.last_played < b.last_played ? 1 : -1);
    },

    day(day: string): SessionRow[] {
      return newestFirst
        .filter((r) => r.started_at.slice(0, 10) === day)
        .sort(byTimeThenId)
        .map((r) => ({
          id: r.id, scenario: r.scenario, started_at: r.started_at,
          score: r.score, accuracy: r.accuracy, spm: r.spm,
        }));
    },

    days(): string[] {
      return [...new Set(newestFirst.map((r) => r.started_at.slice(0, 10)))].sort();
    },

    counts(): Counts {
      return {
        runs: runs.size, curves: curves.size, failed, scenarios: scenarios.size,
      };
    },
  };
}
