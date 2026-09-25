/**
 * S6 of the scenario page design: the bot-tab budget, measured over the full
 * dump through the real ingest and query path. Guards on `raw.available`.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingest } from '../../src/lib/ingest';
import { nodeSource } from '../../src/lib/ingest/source-node';
import { fixedWindow } from '../../src/lib/run/bots';
import { getKillDetail, getScoringInputs, getSlotStats } from '../../src/lib/run/queries';
import { botSeries, botTabs } from '../../src/lib/scenario/bots';
import { listHistory } from '../../src/lib/scenario/queries';
import { makeTestDb } from '../helpers/db';
import { raw } from '../helpers/fixtures';

describe.skipIf(!raw.available)('scenario bot tabs over the full dump', () => {
	it('load and compute within budget for the scenarios with kills and the most runs', async () => {
		const { pg } = await makeTestDb();
		await ingest(nodeSource(join(raw.dir, 'stats'), join(raw.dir, 'performances')), pg);
		const top = await pg.query<{ id: number; name: string; runs: number }>(`
			select s.id, s.name, count(*)::integer as runs
			from run_complete r join scenario s on s.id = r.scenario_id
			where exists (select 1 from kill k where k.run_id = r.id)
			group by s.id, s.name order by runs desc limit 5
		`);
		const report: string[] = [];
		for (const scenario of top.rows) {
			const start = performance.now();
			const history = await listHistory(pg, scenario.id);
			const ids = history.filter((r) => r.hasPerf).map((r) => r.id);
			const [inputs, kills, slots] = await Promise.all([
				getScoringInputs(pg, ids),
				getKillDetail(pg, ids),
				getSlotStats(pg, scenario.id),
			]);
			const loaded = performance.now();
			const idOf = new Map(history.map((r) => [r.fileStem, r.id]));
			const inputOf = (stem: string) => inputs.get(idOf.get(stem)!);
			const killsOf = (stem: string) => kills.get(idOf.get(stem)!);
			const window = fixedWindow(slots);
			const stems = history.map((r) => r.fileStem);
			const ref = [...stems].reverse().find((s) => inputOf(s) && killsOf(s));
			const tabs = ref ? botTabs(inputOf(ref)!, killsOf(ref)!, window) : null;
			const series = tabs ? botSeries(stems, tabs, inputOf, killsOf, window) : null;
			const done = performance.now();
			report.push(
				`${scenario.name}: ${scenario.runs} runs, ${tabs?.tabs.length ?? 0} ${tabs?.kind ?? 'no'} tabs, ` +
					`${series?.covered ?? 0} covered · queries ${(loaded - start).toFixed(0)} ms, compute ${(done - loaded).toFixed(0)} ms`,
			);
			expect(done - start).toBeLessThan(300);
		}
		console.log(report.join('\n'));
	}, 600_000);
});
