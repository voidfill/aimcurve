/** The shapes every other core module speaks in.
 *
 * These mirror the Python's `run`, `curve`, `kill` and `scenario` tables, with
 * two deliberate differences: `id` is the run's basename rather than a row
 * counter, and there is no `stats_file` or `perf_file` because the browser has
 * no absolute paths. `has_perf` carries what those columns were actually used
 * for -- whether this run can supply a curve.
 */

export const SERIES = [
  'shots', 'hits', 'misses', 'dmg_done', 'dmg_possible', 'score', 'kills',
] as const;
export type SeriesName = (typeof SERIES)[number];

export type Series = Record<SeriesName, Float32Array>;

export interface Curve {
  buckets: number;
  duration_s: number;
  series: Series;
}

export interface PerfHeader {
  scenario: string | null;
  hash: string | null;
  started_ms: number | null;
}

export type Shape = 'timed' | 'race';

export interface Run {
  id: string;
  scenario: string;
  started_at: string;
  has_perf: boolean;

  score: number | null;
  kills: number | null;
  hits: number | null;
  misses: number | null;
  shots: number | null;
  accuracy: number | null;
  damage_done: number | null;
  damage_possible: number | null;
  avg_ttk: number | null;
  fight_time: number | null;
  pause_count: number | null;

  duration_s: number | null;
  spm: number | null;
  elapsed_s: number | null;
  overshots: number | null;
  reloads: number | null;
  damage_taken: number | null;

  hash: string | null;
  game_version: string | null;
  sens_raw: number | null;
  sens_scale: string | null;
  dpi: number | null;
  sens_increment: number | null;
  cm360: number | null;
  cfg_key: string | null;
  fov: number | null;
  fov_scale: string | null;
  resolution: string | null;
  avg_fps: number | null;
}

export interface Kill {
  idx: number;
  t: number;
  bot: string;
  weapon: string;
  ttk: number | null;
  shots: number | null;
  hits: number | null;
  overshots: number | null;
  dmg_done: number | null;
  dmg_possible: number | null;
}

export interface Scenario {
  name: string;
  shape: Shape;
  penalising: 0 | 1;
  budget: number | null;
  pool: number | null;
  bots: number | null;
  clock_s: number | null;
  windowed: 0 | 1;
  evidence: 'perf-countdown' | 'csv-constant-budget' | 'default';
}

/** What `best_before` / `played_before` are, in both filter variants.
 *
 * Materialised rather than computed per row: the browser design measured the
 * correlated-subquery equivalent at 296 ms against 4.2 ms over 12k runs.
 */
export interface MarkSet {
  best_before: number | null;
  played_before: number;
}
export interface RunMarks {
  /** Peers restricted to the same cm/360. */
  cfg: MarkSet;
  /** Peers at any sensitivity. */
  any: MarkSet;
}

export interface RailRow {
  id: string;
  scenario: string;
  started_at: string;
  score: number | null;
  accuracy: number | null;
  spm: number | null;
  cfg_key: string | null;
  /** null when the run has no per-second data. Roughly one run in seven. */
  buckets: number | null;
  shape: Shape | null;
  best_before: number | null;
  played_before: number;
}
