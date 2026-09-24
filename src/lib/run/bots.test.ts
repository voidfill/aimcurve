import type { PGlite } from '@electric-sql/pglite';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../../test/helpers/db';
import { curated } from '../../../test/helpers/fixtures';
import { ingest } from '../ingest';
import { nodeSource } from '../ingest/source-node';
import { buildCurve, killTimes, type RunCurve, type ScoringInput, uAtX } from '../scoring';
import { bestSplits, botColors, clockRows, encounters, type KillDetail, largestLoss, raceRows } from './bots';
import { getKillDetail, getScoringInputs } from './queries';

let pg: PGlite;
const inputs = new Map<string, ScoringInput>();
const details = new Map<string, KillDetail>();

function find(prefix: string): { input: ScoringInput; curve: RunCurve; kills: KillDetail } {
	const matches = [...inputs.values()].filter((input) => input.fileStem.startsWith(prefix));
	if (matches.length !== 1) throw new Error(`${matches.length} curated runs match ${prefix}`);
	const input = matches[0]!;
	return { input, curve: buildCurve(input)!, kills: details.get(input.fileStem)! };
}

beforeAll(async () => {
	({ pg } = await makeTestDb());
	await ingest(nodeSource(join(curated.dir, 'stats'), join(curated.dir, 'performances')), pg);
	const ids = (
		await pg.query<{ id: number }>(`select r.id from run r join run_perf p on p.run_id = r.id where r.kind = 'complete'`)
	).rows.map((row) => row.id);
	const scoring = await getScoringInputs(pg, ids);
	const kills = await getKillDetail(pg, ids);
	for (const [id, input] of scoring) {
		inputs.set(input.fileStem, input);
		const detail = kills.get(id);
		if (detail) details.set(input.fileStem, detail);
	}
});

describe('R6 race splits', () => {
	it('sum to the elapsed time and match uAtX differences at the kill knots', () => {
		const { input, curve, kills } = find('Air Pure Medium - Challenge - 2026.09.18-18.44.15');
		const spans = encounters(curve, kills, killTimes(input));
		expect(spans).toHaveLength(5);
		const rows = raceRows(curve, spans, null, bestSplits([curve], 5));
		const total = rows.reduce((sum, row) => sum + row.split, 0);
		expect(total).toBeCloseTo(uAtX(curve, 1), 6);
		expect(rows[2]!.split).toBeCloseTo(uAtX(curve, 3 / 5) - uAtX(curve, 2 / 5), 9);
		expect(rows[0]!.bot).toBe('AIR1_Short_close');
		expect(rows.every((row) => row.delta === null && row.deltaBest === 0)).toBe(true);
	});

	it('compares slot by slot against a baseline, positive when faster', () => {
		const { input, curve, kills } = find('Air Pure Medium - Challenge - 2026.09.18-18.44.15');
		const spans = encounters(curve, kills, killTimes(input));
		// The same run slowed down by 10 %: every slot is 10 % slower.
		const slow: RunCurve = { ...curve, fileStem: 'slow', t: curve.t.map((t) => t * 1.1), u: curve.u.map((u) => u * 1.1) };
		const rows = raceRows(curve, spans, slow, bestSplits([curve, slow], 5));
		for (const row of rows) {
			expect(row.delta).toBeCloseTo(row.split * 0.1, 9);
			expect(row.best).toBeCloseTo(row.split, 9);
		}
	});
});

describe('R6 clock bot rows', () => {
	it('aggregate repeated encounters and sum to the final score with the tail', () => {
		const { input, curve, kills } = find('VT Aether Novice S5 Hard Bot 1 90% - Challenge - 2026.09.18-18.59.40');
		const spans = encounters(curve, kills, killTimes(input));
		expect(spans.length).toBe(kills.bot.length);
		const table = clockRows(curve, spans, kills, null);
		expect(table.rows).toHaveLength(1);
		const [row] = table.rows;
		expect(row!.encounters).toBe(spans.length);
		expect(row!.hits).toBe(kills.hits.reduce((a, b) => a + b, 0));
		expect(row!.points + table.tail.points).toBeCloseTo(input.score, 3);
		const duration = curve.params.kind === 'clock' ? curve.params.durationS : 0;
		expect(row!.time + table.tail.time).toBeCloseTo(duration, 6);
	});

	it('takes the per-bot difference against the baseline', () => {
		const { input, curve, kills } = find('VT Aether Novice S5 Hard Bot 1 90% - Challenge - 2026.09.18-18.59.40');
		const spans = encounters(curve, kills, killTimes(input));
		const table = clockRows(curve, spans, kills, { curve, spans });
		expect(table.rows[0]!.delta).toBe(0);
		expect(largestLoss(table.rows)).toBeNull();
	});

	it('has no encounters without kills', () => {
		const { curve } = find('VT Aether Intermediate S5 - Challenge - 2026.09.18-19.10.23');
		const none = encounters(curve, { bot: [], hits: [], shots: [] }, []);
		expect(none).toEqual([]);
		expect(clockRows(curve, none, { bot: [], hits: [], shots: [] }, null).rows).toEqual([]);
	});
});

describe('bot colors', () => {
	it('follow sorted names, so they are stable across runs', () => {
		const a = botColors(['zeta', 'alpha', 'zeta']);
		const b = botColors(['alpha', 'zeta']);
		expect([...a]).toEqual([...b]);
	});
});

describe('largest loss', () => {
	it('is the most negative delta', () => {
		expect(largestLoss([{ delta: 1 }, { delta: -3 }, { delta: null }, { delta: -1 }])).toBe(1);
	});
});
