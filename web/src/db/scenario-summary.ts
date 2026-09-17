import { pySum } from '../core/compare';
import type { ScenarioListRow } from '../core/store';
import type { Run, Scenario } from '../core/types';

/** Rebuilt only when classification revisits this scenario. */
export function scenarioSummary(scenario: Scenario, runs: readonly Run[]): ScenarioListRow {
  const rows = [...runs].sort((a, b) => a.started_at < b.started_at ? -1
    : a.started_at > b.started_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const scored = rows.filter((r) => r.score !== null)
    .sort((a, b) => b.score! - a.score!);
  const recent = rows.slice(-10);
  const mean = (values: (number | null)[]) => {
    const present = values.filter((v): v is number => v !== null);
    return present.length ? pySum(present) / present.length : null;
  };
  return {
    scenario: scenario.name, runs: rows.length, pb: scored[0]?.score ?? null,
    last_played: rows.at(-1)!.started_at, shape: scenario.shape,
    pb_elapsed: scored[0]?.elapsed_s ?? null,
    recent_elapsed: mean(recent.map((r) => r.elapsed_s)),
    recent_form: mean(recent.map((r) => r.score)),
  };
}
