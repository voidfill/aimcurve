/** The Store, backed by IndexedDB.
 *
 * Every query here was written and timed against this layout at 12k runs by
 * the browser design; the comments carry the numbers so a future rewrite has
 * to beat something rather than guess.
 */

import { DURATION_TOLERANCE, pySum } from '../core/compare';
import { RACE } from '../core/shapes';
import type {
  CandidateOpts, Counts, PageOpts, ScenarioListRow, SessionRow, SlotMetric, Store,
} from '../core/store';
import { SERIES } from '../core/types';
import type { Curve, Kill, RailRow, Run, Scenario, Series } from '../core/types';
import { unpack, type PackedKills } from './packed';
import { done, req, type StoredCurve, type StoredRun } from './schema';

const RECENT_FORM_N = 10;

function compareRuns(a: { started_at: string; id: string },
                     b: { started_at: string; id: string }): number {
  if (a.started_at !== b.started_at) return a.started_at < b.started_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toRun(stored: StoredRun): Run {
  const { buckets, marks, ...run } = stored;
  return run;
}

function toCurve(stored: StoredCurve): Curve {
  const series = Object.fromEntries(
    SERIES.map((name) => [name, new Float32Array(stored.series[name])]),
  ) as Series;
  return { buckets: stored.buckets, duration_s: stored.duration_s, series };
}

export function createStore(db: IDBDatabase): Store {
  const get = <T>(store: string, key: IDBValidKey): Promise<T | undefined> =>
    req(db.transaction(store).objectStore(store).get(key) as IDBRequest<T | undefined>);

  const stored = (id: string) => get<StoredRun>('runs', id);

  /** Every run of one scenario, oldest first. Served directly by scen_time:
   *  2.0 ms at 12k runs. */
  async function ofScenario(scenario: string): Promise<StoredRun[]> {
    const index = db.transaction('runs').objectStore('runs').index('scen_time');
    const rows = await req<StoredRun[]>(
      index.getAll(IDBKeyRange.bound([scenario, ''], [scenario, '￿'])));
    return rows.sort(compareRuns);
  }

  return {
    async getRun(id) {
      const row = await stored(id);
      return row ? toRun(row) : undefined;
    },

    getScenario: (name) => get<Scenario>('scenarios', name),

    async getCurve(id) {
      const row = await get<StoredCurve>('curves', id);
      return row ? toCurve(row) : undefined;
    },

    async getKills(id) {
      const row = await get<PackedKills>('kills', id);
      return row ? unpack(row) : [];
    },

    async candidates(id: string, opts: CandidateOpts): Promise<Run[]> {
      const focus = await stored(id);
      if (!focus) throw new Error(`no such run: ${id}`);
      let rows = (await ofScenario(focus.scenario)).filter((r) => r.id !== id);
      if (opts.sameCfg && focus.cfg_key !== null) {
        rows = rows.filter((r) => r.cfg_key === focus.cfg_key);
      }
      // Duration is the score on a race scenario, so filtering baselines by it
      // throws away the comparison.
      const target = focus.duration_s;
      if (target && opts.shape !== RACE) {
        rows = rows.filter((r) =>
          r.duration_s === null
          || Math.abs(r.duration_s - target) <= target * opts.durationTol);
      }
      return rows.map(toRun);
    },

    /** The rail. With the marks materialised this is a cursor walk on
     *  started_at descending -- 4.2 ms at 12k runs, and 3.6 ms at 10,000 rows
     *  deep, so paging stays flat. Computing the marks per row instead costs
     *  296 ms. */
    async page(limit: number, opts: PageOpts): Promise<RailRow[]> {
      const cursorRun = opts.before != null ? await stored(opts.before) : undefined;
      // An unknown cursor pages to nothing, not to everything. The SQL's
      // subquery yields NULL, `(started_at, id) < NULL` is NULL, and no row
      // survives; dropping the predicate instead wraps an infinite scroll back
      // to the newest rows and repeats them for ever. See memstore.ts:129-140,
      // which carries the same comment because this was already fixed once.
      if (opts.before != null && !cursorRun) return [];
      const index = db.transaction('runs').objectStore('runs').index('started_at');
      const range = cursorRun
        ? IDBKeyRange.upperBound(cursorRun.started_at)
        : null;

      const out: RailRow[] = [];
      await new Promise<void>((resolve, reject) => {
        const request = index.openCursor(range, 'prev');
        request.onsuccess = () => {
          const cursor = request.result;
          // SQLite reads a negative LIMIT as no limit at all, and memstore
          // says so at core/memstore.ts:141. `out.length >= limit` is already
          // true at `0 >= -1`, so the walk stopped on the first row and
          // page(-1) answered [] where memstore answers every row.
          if (!cursor || (limit >= 0 && out.length >= limit)) return resolve();
          const row = cursor.value as StoredRun;
          // The cursor's bound is on started_at alone, which has second
          // resolution and no uniqueness constraint. The pair comparison is
          // what stops a run whose timestamp straddles a page boundary being
          // repeated or skipped.
          const past = !cursorRun || compareRuns(row, cursorRun) < 0;
          const wanted = !opts.scenario || row.scenario === opts.scenario;
          if (past && wanted) {
            const set = opts.sameCfg ? row.marks.cfg : row.marks.any;
            out.push({
              id: row.id, scenario: row.scenario, started_at: row.started_at,
              score: row.score, accuracy: row.accuracy, spm: row.spm,
              cfg_key: row.cfg_key, buckets: row.buckets,
              shape: null, // filled below
              best_before: set.best_before, played_before: set.played_before,
            });
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });

      // One pass for the shapes rather than a lookup per row.
      const names = [...new Set(out.map((r) => r.scenario))];
      const shapes = new Map<string, Scenario>();
      for (const name of names) {
        const scenario = await get<Scenario>('scenarios', name);
        if (scenario) shapes.set(name, scenario);
      }
      for (const row of out) row.shape = shapes.get(row.scenario)?.shape ?? null;
      return out;
    },

    /** GROUP BY idx becomes a get per peer and a loop over typed arrays:
     *  4.7 ms over 30 peers. */
    async bestBySlot(ids: readonly string[], metric: SlotMetric) {
      const store = db.transaction('kills').objectStore('kills');
      const best = new Map<number, number>();
      for (const id of ids) {
        const packed = await req<PackedKills | undefined>(store.get(id));
        if (!packed) continue;
        for (let i = 0; i < packed.n; i++) {
          let value: number;
          if (metric === 'ttk') {
            value = packed.ttk[i];
          } else {
            // No damage offered means no share, not a share of zero.
            if (!packed.dmg_possible[i]) continue;
            value = packed.dmg_done[i] / packed.dmg_possible[i];
          }
          if (Number.isNaN(value)) continue;
          const slot = i + 1;
          const current = best.get(slot);
          const better = current === undefined
            || (metric === 'ttk' ? value < current : value > current);
          if (better) best.set(slot, value);
        }
      }
      return best;
    },

    /** The maintained aggregate, read whole. The full scan this replaces is
     *  247 ms at 12k runs and is only the rebuild path. */
    async scenarioList(): Promise<ScenarioListRow[]> {
      const scenarios = await req<Scenario[]>(
        db.transaction('scenarios').objectStore('scenarios').getAll());
      const out: ScenarioListRow[] = [];
      for (const scenario of scenarios) {
        const rows = await ofScenario(scenario.name);
        if (!rows.length) continue;
        const scored = rows.filter((r) => r.score !== null);
        const byScore = [...scored].sort((a, b) => (b.score as number) - (a.score as number));
        const recent = rows.slice(-RECENT_FORM_N);
        // pySum, not reduce: SQLite's AVG has summed with Neumaier
        // compensation since 3.42, and memstore.ts:96 matches it. A plain
        // left-to-right sum is invisible on the fixtures -- no scenario has
        // enough runs -- and diverges against a real install.
        const mean = (values: number[]) =>
          values.length ? pySum(values) / values.length : null;
        out.push({
          scenario: scenario.name,
          runs: rows.length,
          pb: byScore.length ? (byScore[0].score as number) : null,
          last_played: rows[rows.length - 1].started_at,
          shape: scenario.shape,
          pb_elapsed: byScore.length ? byScore[0].elapsed_s : null,
          recent_elapsed: mean(
            recent.map((r) => r.elapsed_s).filter((v): v is number => v !== null)),
          recent_form: mean(
            recent.map((r) => r.score).filter((v): v is number => v !== null)),
        });
      }
      // 0 on equality, not -1: an inconsistent comparator sorts unpredictably,
      // and the oracle compares this list positionally. memstore.ts:195-196
      // spells the equal case out for the same reason.
      return out.sort((a, b) =>
        a.last_played === b.last_played ? 0 : a.last_played < b.last_played ? 1 : -1);
    },

    /** substr(started_at,1,10) = ? becomes a bounded range, since the field is
     *  a sortable ISO string. 1.0 ms. */
    async day(day: string): Promise<SessionRow[]> {
      const index = db.transaction('runs').objectStore('runs').index('started_at');
      const rows = await req<StoredRun[]>(index.getAll(
        IDBKeyRange.bound(`${day}T00:00:00`, `${day}T23:59:59`)));
      return rows.sort(compareRuns).map((r) => ({
        id: r.id, scenario: r.scenario, started_at: r.started_at,
        score: r.score, accuracy: r.accuracy, spm: r.spm,
      }));
    },

    async days(): Promise<string[]> {
      // A key cursor, not getAllKeys(): on an *index*, getAllKeys() returns the
      // PRIMARY keys, which here are the run basenames -- so slice(0, 10) would
      // yield 'Air Pure M' rather than '2026-04-06'. It cascades, because
      // api.getSession takes days[days.length - 1] and would then ask for a day
      // that matches no row at all. cursor.key is the index key.
      const index = db.transaction('runs').objectStore('runs').index('started_at');
      const days = new Set<string>();
      await new Promise<void>((resolve, reject) => {
        const request = index.openKeyCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return resolve();
          days.add(String(cursor.key).slice(0, 10));
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
      return [...days].sort();
    },

    async counts(): Promise<Counts> {
      const count = (name: string) =>
        req(db.transaction(name).objectStore(name).count());
      return {
        runs: await count('runs'),
        curves: await count('curves'),
        failed: await count('failed'),
        scenarios: await count('scenarios'),
      };
    },
  };
}
