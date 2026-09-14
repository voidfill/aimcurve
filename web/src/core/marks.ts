/** `best_before` and `played_before`, materialised.
 *
 * The rail's marks have to obey exactly the rules baseline selection obeys, or
 * the same pair of runs reads as a personal best in one panel and a loss in the
 * other. The Python expresses them once as SQL over the whole history; here
 * they are expressed once as this fold, and both the in-memory store and the
 * IndexedDB indexer call it.
 *
 * Materialised rather than computed per row because the browser design measured
 * the correlated-subquery equivalent at 296 ms against 4.2 ms over 12k runs.
 * Recomputing is a forward pass costing ~41 ms over that corpus, so the rule
 * can simply be: detect an out-of-order insert or a shape change, refold, done.
 */

import { DURATION_TOLERANCE } from './compare';
import { RACE } from './shapes';
import type { MarkSet, Run, RunMarks, Shape } from './types';

const EMPTY: MarkSet = { best_before: null, played_before: 0 };

export function materialiseMarks(
  runs: readonly Run[],
  shapeOf: (scenario: string) => Shape,
  durationTol: number = DURATION_TOLERANCE,
): Map<string, RunMarks> {
  const byScenario = new Map<string, Run[]>();
  for (const run of runs) {
    const group = byScenario.get(run.scenario);
    if (group) group.push(run);
    else byScenario.set(run.scenario, [run]);
  }

  const out = new Map<string, RunMarks>();
  for (const [scenario, group] of byScenario) {
    const isRace = shapeOf(scenario) === RACE;
    // Sorted by (started_at, id) rather than started_at alone: the timestamp
    // has second resolution and no uniqueness constraint, so time alone is not
    // a total order.
    const sorted = [...group].sort(
      (a, b) => (a.started_at < b.started_at ? -1
        : a.started_at > b.started_at ? 1
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    for (const focus of sorted) {
      const cfg: MarkSet = { ...EMPTY };
      const any: MarkSet = { ...EMPTY };
      for (const prior of sorted) {
        // Strictly earlier, matching the SQL. Two runs sharing a timestamp are
        // not priors of each other.
        if (!(prior.started_at < focus.started_at)) continue;
        // Duration is the score on a race, so judging peers by it throws the
        // comparison away.
        if (!isRace
          && focus.duration_s !== null && prior.duration_s !== null
          && Math.abs(prior.duration_s - focus.duration_s)
             > focus.duration_s * durationTol) continue;

        any.played_before += 1;
        if (prior.score !== null
          && (any.best_before === null || prior.score > any.best_before)) {
          any.best_before = prior.score;
        }

        // The sensitivity filter applies only when the focused run has a
        // sensitivity to filter on.
        if (focus.cfg_key !== null && prior.cfg_key !== focus.cfg_key) continue;
        cfg.played_before += 1;
        if (prior.score !== null
          && (cfg.best_before === null || prior.score > cfg.best_before)) {
          cfg.best_before = prior.score;
        }
      }
      out.set(focus.id, { cfg, any });
    }
  }
  return out;
}
