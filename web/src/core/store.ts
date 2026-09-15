/** What the payload builder is allowed to know about storage.
 *
 * Two implementations: `memstore.ts` here, and the IndexedDB one in Plan B.
 * The payload builder must never be able to tell which it has -- that is the
 * property that lets it be verified against the Python with no browser
 * involved, and it is the reason Plan B writes no comparison logic at all.
 */

import type { Curve, Kill, RailRow, Run, Scenario, Shape } from './types';

export interface CandidateOpts {
  /** Restrict peers to the focused run's cm/360. */
  sameCfg: boolean;
  durationTol: number;
  /** Duration is the score on a race, so the tolerance filter is skipped. */
  shape: Shape;
}

export interface PageOpts {
  scenario?: string | null;
  /** A run id; the page starts at the run just older than it. */
  before?: string | null;
  sameCfg: boolean;
}

export interface ScenarioListRow {
  scenario: string;
  runs: number;
  pb: number | null;
  last_played: string;
  shape: Shape | null;
  pb_elapsed: number | null;
  recent_elapsed: number | null;
  recent_form: number | null;
}

export interface SessionRow {
  id: string;
  scenario: string;
  started_at: string;
  score: number | null;
  accuracy: number | null;
  spm: number | null;
}

export interface Counts {
  runs: number;
  curves: number;
  failed: number;
  scenarios: number;
}

/** Which "best" a slot lookup wants.
 *
 * A named metric rather than a SQL expression string: there are exactly two
 * callers -- fastest TTK for race splits, largest damage share for bot windows
 * -- and interpolating an expression into a query is a habit worth leaving
 * behind with the SQL.
 */
export type SlotMetric = 'ttk' | 'share';

/** Every method is async because IndexedDB has no synchronous read. The
 *  in-memory implementation answers from a Map and still returns a promise, so
 *  the payload builder cannot tell the two apart. */
export interface Store {
  getRun(id: string): Promise<Run | undefined>;
  getScenario(name: string): Promise<Scenario | undefined>;
  getCurve(id: string): Promise<Curve | undefined>;
  getKills(id: string): Promise<Kill[]>;

  /** Other runs of the same scenario this one can fairly be judged against,
   *  oldest first. Excludes the focused run. */
  candidates(id: string, opts: CandidateOpts): Promise<Run[]>;

  /** The rail: newest first, already marked against the whole history. */
  page(limit: number, opts: PageOpts): Promise<RailRow[]>;

  bestBySlot(ids: readonly string[], metric: SlotMetric): Promise<Map<number, number>>;

  scenarioList(): Promise<ScenarioListRow[]>;
  /** `day` is an ISO date, `YYYY-MM-DD`. */
  day(day: string): Promise<SessionRow[]>;
  /** Every date that has runs, ascending. */
  days(): Promise<string[]>;
  counts(): Promise<Counts>;
}
