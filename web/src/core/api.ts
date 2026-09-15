/** What the dashboard asks for.
 *
 * These are exactly the five endpoints `app.js` fetches today, with the same
 * payload shapes. Keeping the shapes identical is what lets the oracle diff
 * compare the Python and this directly, and it is what reduces Plan B's wiring
 * to a routing table.
 */

import { buildRunPayload, type Payload, type PayloadOpts } from './payload';
import type { ScenarioListRow, SessionRow, Store } from './store';
import type { RailRow } from './types';

const DEFAULT_LIMIT = 50;
/** `server.py`'s ceiling. The rail never asks for more than a page, but the
 *  limit is reachable from a URL, and SQLite reads a negative one as "no
 *  limit" -- so an unchecked `?limit=-1` is a request for the whole table. */
const MAX_LIMIT = 100_000;

export interface RunsOpts {
  limit?: number;
  scenario?: string | null;
  before?: string | null;
  sameCfg?: boolean;
}

export interface Health {
  runs: number;
  curves: number;
  failed: number;
  scenarios: number;
  /** Runs indexed from their CSV whose `.perf` has not arrived. Always 0 until
   *  Plan B adds an observer; the field exists so the shape does not change. */
  awaiting_perf: number;
  watcher_errors: number;
}

export async function getRuns(store: Store, opts: RunsOpts): Promise<RailRow[]> {
  const { limit = DEFAULT_LIMIT, scenario = null, before = null, sameCfg = true } = opts;
  // The same bounds `server.py` puts on the query string, kept here rather than
  // in Plan B's shim: a range is what the answer means, not how it was asked
  // for. An absent `before` is not checked -- an id that simply is not indexed
  // is a valid question with an empty answer.
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_LIMIT) {
    throw new RangeError(`limit out of range [0, ${MAX_LIMIT}]: ${limit}`);
  }
  return store.page(limit, { scenario, before, sameCfg });
}

export function getRun(store: Store, id: string, opts: PayloadOpts): Promise<Payload> {
  return buildRunPayload(store, id, opts);
}

export function getScenarios(store: Store): Promise<ScenarioListRow[]> {
  return store.scenarioList();
}

export async function getSession(
  store: Store, day?: string,
): Promise<{ day: string | null; runs: SessionRow[] }> {
  // No day means the most recent one that has runs, which is what
  // `MAX(substr(started_at,1,10))` answers in the Python -- null on an empty
  // index rather than today's date, because an empty day is not a session.
  const days = await store.days();
  const target = day ?? days[days.length - 1] ?? null;
  return { day: target, runs: target === null ? [] : await store.day(target) };
}

export async function getHealth(store: Store): Promise<Health> {
  return { ...(await store.counts()), awaiting_perf: 0, watcher_errors: 0 };
}
