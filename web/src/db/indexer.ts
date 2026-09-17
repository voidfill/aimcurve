/** Indexing N basenames into an existing database.
 *
 * There is one indexing path and a bootstrap is it over an empty database.
 * That is not tidiness: this is exactly the function an observer calls in step
 * two, and a bootstrap written separately would be a second implementation to
 * keep in agreement with it.
 */

import { ingest } from '../core/ingest';
import { materialiseMarks } from '../core/marks';
import { refreshScenario, type ScenarioInput } from '../core/scenario';
import { SERIES, type Curve, type Kill, type Run, type Shape } from '../core/types';
import { readAll } from '../source/pool';
import type { RunSource } from '../source/types';
import { pack, unpack, type PackedKills } from './packed';
import { scenarioSummary } from './scenario-summary';
import {
  done, MAX_TRIES, META_INDEXED, META_PENDING_SCENARIOS, META_READ_AT, req,
  type StoredCurve, type StoredFailure, type StoredRun, type StoredScenario,
} from './schema';

export interface IndexProgress {
  phase: 'reading' | 'writing' | 'classifying';
  done: number;
  total: number;
}

export interface IndexResult {
  runs: number;
  curves: number;
  failed: number;
  skipped: number;
}

export interface IndexOptions {
  /** Re-read basenames already in the `indexed` set. Used to upgrade a run
   *  whose `.perf` arrived after its CSV. */
  force?: boolean;
  /** A manual folder refresh also retries exhausted failures and runs missing
   *  a curve or a complete CSV summary. Ordinary automatic passes stay bounded. */
  refreshIncomplete?: boolean;
  concurrency?: number;
}

// Web Locks serialize tabs, not calls within the elected tab. Key by database
// name so separate connections in this realm share the same queue as recovery.
const writes = new Map<string, Promise<unknown>>();
function serialize<T>(db: IDBDatabase, work: () => Promise<T>): Promise<T> {
  const next = (writes.get(db.name) ?? Promise.resolve()).then(work, work);
  const tail = next.catch(() => {});
  writes.set(db.name, tail);
  void tail.then(() => { if (writes.get(db.name) === tail) writes.delete(db.name); });
  return next;
}

/** Resume committed work without touching the source or changing its age.
 *  The caller must hold this origin's writer lock. */
export function recoverClassification(db: IDBDatabase): Promise<void> {
  return serialize(db, async () => drain(db, await pendingClassification(db)));
}

/** Includes records from caches predating maintained list summaries. */
export async function pendingClassification(db: IDBDatabase): Promise<string[]> {
  const pending = await pendingScenarios(db);
  const scenarios = await req<StoredScenario[]>(
    db.transaction('scenarios').objectStore('scenarios').getAll());
  return [...new Set([...pending, ...scenarios.filter((s) => !s.summary).map((s) => s.name)])];
}

async function indexedSet(db: IDBDatabase): Promise<Set<string>> {
  const row = await req<{ key: string; value: string[] } | undefined>(
    db.transaction('meta').objectStore('meta').get(META_INDEXED));
  return new Set(row?.value ?? []);
}

/** Which of the source's basenames are not in the database yet. */
export async function pendingIds(db: IDBDatabase, source: RunSource): Promise<string[]> {
  const known = await indexedSet(db);
  return (await source.list()).filter((id) => !known.has(id));
}

/** Scenarios a previous pass wrote runs for but did not finish classifying. */
async function pendingScenarios(db: IDBDatabase): Promise<string[]> {
  const row = await req<{ key: string; value: string[] } | undefined>(
    db.transaction('meta').objectStore('meta').get(META_PENDING_SCENARIOS));
  return row?.value ?? [];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every recorded failure, read in one request before any write opens.
 *
 * Read up front rather than looked up inside the write loop: an await on a
 * second request mid-transaction deactivates it, and the puts after it fail.
 */
async function failures(db: IDBDatabase): Promise<Map<string, StoredFailure>> {
  const rows = await req<StoredFailure[]>(
    db.transaction('failed').objectStore('failed').getAll());
  return new Map(rows.map((f) => [f.basename, f]));
}

function toStoredCurve(runId: string, curve: Curve): StoredCurve {
  const series = Object.fromEntries(
    SERIES.map((name) => {
      const view = curve.series[name];
      // slice() so the stored buffer is exactly this series and not a view
      // into a larger one.
      return [name, view.slice().buffer];
    }),
  ) as StoredCurve['series'];
  return { run_id: runId, buckets: curve.buckets, duration_s: curve.duration_s, series };
}

export function indexInto(
  db: IDBDatabase,
  source: RunSource,
  ids: readonly string[],
  onProgress?: (p: IndexProgress) => void,
  options: IndexOptions = {},
): Promise<IndexResult> {
  return serialize(db, () => indexBatch(db, source, ids, onProgress, options));
}

async function indexBatch(
  db: IDBDatabase, source: RunSource, ids: readonly string[],
  onProgress: ((p: IndexProgress) => void) | undefined, options: IndexOptions,
): Promise<IndexResult> {
  const known = await indexedSet(db);
  const failed = await failures(db);
  const incomplete = new Set<string>();
  if (options.refreshIncomplete) {
    const rows = await req<StoredRun[]>(db.transaction('runs').objectStore('runs').getAll());
    for (const row of rows) {
      if (!row.has_perf || row.score === null || row.avg_fps === null) incomplete.add(row.id);
    }
    for (const id of failed.keys()) incomplete.add(id);
  }
  // Whatever a previous pass wrote runs for but never finished classifying.
  // Carried into this pass's `touched` set so it is reclassified alongside it.
  const carried = await pendingScenarios(db);
  // A basename repeated in one batch is one file, not two. memstore drops the
  // repeat whole for the same reason (core/memstore.ts:31-35): the index's
  // `run.stats_file` is UNIQUE and it inserts OR IGNORE, so the first row wins
  // there too. Letting the second through writes the same row twice and counts
  // it twice, so `IndexResult` stops agreeing with `counts()`.
  const requested = [...new Set(ids)];
  const wanted = requested.filter((id) => options.force || incomplete.has(id)
    || (!known.has(id) && (failed.get(id)?.tries ?? 0) < MAX_TRIES));
  const result: IndexResult = {
    runs: 0, curves: 0, failed: 0, skipped: requested.length - wanted.length,
  };
  if (!wanted.length) {
    // Record that we looked, even with nothing to do. Returning here without
    // writing read_at leaves the staleness badge with nothing to read -- on the
    // "nothing new" path, which is every refresh after the first.
    const meta = db.transaction('meta', 'readwrite');
    meta.objectStore('meta').put({ key: META_READ_AT, value: Date.now() });
    await done(meta);
    // An interrupted classification is repaired here too, and this is the path
    // it has to be repaired on: once the runs are marked known, "nothing new"
    // is every refresh from then on.
    await drain(db, carried, onProgress);
    return result;
  }

  // Reading dominates a bootstrap -- 15 s of the design's 22 s at 12k runs --
  // and it is the only phase worth parallelising. The pool size is not
  // hard-coded: 8 to 32 is right on one machine, and high concurrency does not
  // help on a spinning disk or a network-redirected profile.
  const parsed: { run: Run; curve: Curve | null; kills: Kill[]; error?: string }[] = [];
  const unreadable = new Map<string, string>();
  let read = 0;
  await readAll(wanted, async (id) => {
    // One unreadable file must not discard the batch. Letting this reject
    // propagates out of readAll before the write transaction is even opened, so
    // a single file deleted or locked mid-pass costs all 12k runs and writes
    // nothing at all. A file that went away between listing and reading is
    // exactly what the failed store and MAX_TRIES exist for.
    try {
      const { stats, perf } = await source.read(id);
      // The picker source answers a vanished file with an empty result rather
      // than a throw, so an absent CSV is the same condition, not a no-op.
      if (stats === undefined) {
        unreadable.set(id, 'the stats file could not be read');
      } else {
        const csv = ingest(id, stats);
        // The pure parser intentionally accepts sparse input for the oracle.
        // At the live file boundary require a summary and the final settings
        // field emitted by the supported CSV format before caching success.
        if (csv.run.scenario && csv.run.started_at
            && (csv.run.score === null || csv.run.avg_fps === null)) {
          throw new Error('the stats file is incomplete (missing Score or Avg FPS)');
        }
        if (perf === undefined) {
          parsed.push(csv);
          onProgress?.({ phase: 'reading', done: ++read, total: wanted.length });
          return;
        }
        try {
          parsed.push(ingest(id, stats, perf));
        } catch (error) {
          // `ingest` turns a rejected `.perf` into `error` only for the
          // failures `parsePerf` anticipated; it re-throws anything else, and a
          // bit-flipped timestamp is a RangeError out of `new Float32Array`.
          // Letting that reach the outer catch recorded the run as *unreadable*
          // -- "the stats file could not be read" -- when the CSV had parsed
          // perfectly, so no run was written at all. Past MAX_TRIES the
          // basename is then marked known, and repairing the file could never
          // bring the run back: only deleting the database could.
          //
          // Re-ingesting without the `.perf` puts it on the `error` path
          // instead, which is where the plan says a rejected `.perf` belongs:
          // the run and its kills are written, only the curve is missing, and
          // the basename stays out of `known` so a repaired file is retried. A
          // throw from `ingest(id, stats)` alone is still genuinely unreadable,
          // and falls through to the outer catch.
          parsed.push({ ...csv, error: message(error) });
        }
      }
    } catch (error) {
      unreadable.set(id, message(error));
    }
    onProgress?.({ phase: 'reading', done: ++read, total: wanted.length });
  }, options.concurrency);

  // One transaction for the batch. Per-file transactions turn a bootstrap into
  // one commit per run, which is the browser equivalent of the Python's
  // one-fsync-per-file mistake: 3.6 s becomes 68 s.
  const write = db.transaction(
    ['runs', 'curves', 'kills', 'failed', 'meta'], 'readwrite');
  const runsStore = write.objectStore('runs');
  const curvesStore = write.objectStore('curves');
  const killsStore = write.objectStore('kills');
  const failedStore = write.objectStore('failed');

  const now = new Date().toISOString();
  const recordFailure = (id: string, error: string) => {
    const previous = failed.get(id)?.tries ?? 0;
    // Manual refresh starts a new budget only after the previous one ran out.
    const tries = (previous >= MAX_TRIES ? 0 : previous) + 1;
    failedStore.put({ basename: id, tries, last_error: error, last_try: now });
    result.failed += 1;
    if (tries >= MAX_TRIES) known.add(id);
    else known.delete(id);
  };

  // A file whose basename does not match the expected shape parses to an empty
  // scenario and an empty started_at. That is permanent -- re-reading it will
  // never produce anything -- so it is marked known and counted as skipped.
  // Leaving it out of `known` re-reads it on every pass for ever, and counting
  // it nowhere makes it invisible in the totals.
  for (const row of parsed) {
    if (row.run.scenario && row.run.started_at) continue;
    known.add(row.run.id);
    result.skipped += 1;
  }

  // Files that could not be read at all. Not added to `known`: the whole point
  // is that the next pass tries again.
  for (const [id, message] of unreadable) {
    recordFailure(id, message);
  }

  const touched = new Set<string>(carried);
  for (const [i, row] of parsed.entries()) {
    if (!row.run.scenario || !row.run.started_at) continue;
    touched.add(row.run.scenario);

    if (row.error !== undefined) {
      // `error` means the .perf was rejected, not that the run is bad: the CSV
      // parsed, so the run and its kills below are good and get written. What
      // is missing is the curve, and a half-written .perf becomes readable on
      // the next pass -- which is why this id is deliberately NOT added to
      // `known` until the budget runs out. Adding it unconditionally is what
      // makes MAX_TRIES unreachable dead code and rule 2 a dead letter.
      //
      // The previous count comes from the map read before this transaction
      // opened. Looking it up here would mean awaiting a request mid-write,
      // which deactivates the transaction and fails every put after it.
      recordFailure(row.run.id, row.error);
    } else {
      known.add(row.run.id);
      // A file that used to fail and now parses must stop being reported as
      // failed, or counts().failed never returns to 0 once anything has ever
      // failed. delete() on an absent key is a no-op, so this is unconditional.
      failedStore.delete(row.run.id);
    }

    const storedRun: StoredRun = {
      ...row.run,
      buckets: row.curve ? row.curve.buckets : null,
      // Filled by the marks pass below; written now so the record is complete
      // even if that pass is interrupted.
      marks: { cfg: { best_before: null, played_before: 0 },
               any: { best_before: null, played_before: 0 } },
    };
    runsStore.put(storedRun);
    result.runs += 1;

    if (row.curve) {
      curvesStore.put(toStoredCurve(row.run.id, row.curve));
      result.curves += 1;
    }
    killsStore.put(pack(row.run.id, row.kills));
    onProgress?.({ phase: 'writing', done: i + 1, total: parsed.length });
  }

  // Written in the SAME transaction as the run rows and `indexed`, so the two
  // cannot disagree: either the runs are known and their scenarios are recorded
  // as owing a classification, or neither happened. Committing `indexed` alone
  // and classifying afterwards left an interrupted pass unrepairable, because
  // nothing after it ever looked at those scenarios again.
  write.objectStore('meta').put({ key: META_PENDING_SCENARIOS, value: [...touched] });
  write.objectStore('meta').put({ key: META_INDEXED, value: [...known] });
  // The time of THIS pass, not source.pickedAt. pickedAt is set once, when the
  // handle was opened, and a re-pick reuses the same source object -- so
  // recording it would rewrite read_at backwards to 09:00 on a 14:00 refresh
  // and leave the staleness badge permanently unclearable.
  write.objectStore('meta').put({ key: META_READ_AT, value: Date.now() });
  await done(write);

  await drain(db, [...touched], onProgress);
  return result;
}

/** Classify every scenario owing one, and only then forget that they owed it.
 *
 * Cleared in one write at the end rather than per scenario: an interruption
 * halfway then re-classifies the whole set on the next pass, which is redundant
 * work but never a wrong answer -- `reclassify` folds over all of a scenario's
 * runs, so running it twice lands on the same rows.
 */
async function drain(
  db: IDBDatabase, scenarios: readonly string[],
  onProgress?: (p: IndexProgress) => void,
): Promise<void> {
  if (!scenarios.length) return;
  await reclassify(db, scenarios, onProgress);
  const meta = db.transaction('meta', 'readwrite');
  meta.objectStore('meta').put({ key: META_PENDING_SCENARIOS, value: [] });
  await done(meta);
}

/** Recompute the shape and the marks of every scenario the batch touched.
 *
 * Over all of the scenario's runs, not just the new ones: a second run is
 * exactly what promotes a curveless race scenario out of 'timed', a scenario
 * becomes race on its first `.perf`, and a shape change moves which prior runs
 * count as peers -- so the marks move with it.
 */
async function reclassify(
  db: IDBDatabase, scenarios: readonly string[],
  onProgress?: (p: IndexProgress) => void,
): Promise<void> {
  let seen = 0;
  for (const name of scenarios) {
    const rows = await req<StoredRun[]>(
      db.transaction('runs').objectStore('runs').index('scen_time')
        .getAll(IDBKeyRange.bound([name, ''], [name, '￿'])));

    // Every request is issued synchronously and awaited together. Awaiting them
    // one at a time would let the transaction commit after the first, and the
    // rest would throw.
    const read = db.transaction(['curves', 'kills']);
    const curveRequests = rows.map((row) =>
      req<StoredCurve | undefined>(read.objectStore('curves').get(row.id)));
    const killRequests = rows.map((row) =>
      req<PackedKills | undefined>(read.objectStore('kills').get(row.id)));
    const [curves, packed] = await Promise.all([
      Promise.all(curveRequests), Promise.all(killRequests),
    ]);

    const inputs: ScenarioInput[] = rows.map((row, i) => ({
      run: row,
      score: curves[i] ? new Float32Array(curves[i]!.series.score) : null,
      kills: packed[i] ? unpack(packed[i]!) : [],
    }));

    const scenario = refreshScenario(name, inputs);
    if (!scenario) continue;
    const shapeOf = (): Shape => scenario.shape;
    const marks = materialiseMarks(rows, shapeOf);

    const write = db.transaction(['runs', 'scenarios'], 'readwrite');
    write.objectStore('scenarios').put({
      ...scenario, summary: scenarioSummary(scenario, rows),
    } satisfies StoredScenario);
    for (const row of rows) {
      const updated = marks.get(row.id);
      if (updated) write.objectStore('runs').put({ ...row, marks: updated });
    }
    await done(write);
    onProgress?.({ phase: 'classifying', done: ++seen, total: scenarios.length });
  }
}
