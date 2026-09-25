import type { PGlite } from '@electric-sql/pglite';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../../test/helpers/db';
import { curated } from '../../../test/helpers/fixtures';
import { ingest } from '../ingest';
import { nodeSource } from '../ingest/source-node';
import { buildCurve, killTimes, type RunCurve, type ScoringInput } from '../scoring';
import {
	bestSplits,
	botColors,
	clockRows,
	deadTime,
	encounters,
	engagements,
	fixedWindow,
	isClicking,
	type KillDetail,
	largestLoss,
	raceRows,
} from './bots';
import { getKillDetail, getScoringInputs, getSlotStats } from './queries';

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

describe('engagements', () => {
	it('start at kill − TTK, held between the previous kill and their own', () => {
		const kills = { bot: ['a', 'b', 'c'], hits: [0, 0, 0], shots: [0, 0, 0], ttk: [2, 10, 0] };
		expect(engagements(kills, [5, 8, 12])).toEqual([
			{ index: 0, bot: 'a', start: 3, end: 5 },
			{ index: 1, bot: 'b', start: 5, end: 8 }, // TTK reaches back past the last kill
			{ index: 2, bot: 'c', start: 12, end: 12 },
		]);
		expect(deadTime(engagements(kills, [5, 8, 12]))).toBe(3 + 0 + 4);
	});
});

describe('R6 race splits', () => {
	it('are engaged time, and with dead time sum to the elapsed time', () => {
		const { input, kills } = find('Air Pure Medium - Challenge - 2026.09.18-18.44.15');
		const engaged = engagements(kills, killTimes(input));
		expect(engaged).toHaveLength(5);
		const table = raceRows(engaged, null, bestSplits([engaged], 5));
		const total = table.rows.reduce((sum, row) => sum + row.split, 0) + table.dead.split;
		expect(total).toBeCloseTo(killTimes(input)!.at(-1)!, 6);
		expect(table.rows[1]!.split).toBeCloseTo(kills.ttk[1]!, 3);
		expect(table.dead.split).toBeGreaterThan(0);
		expect(table.rows[0]!.bot).toBe('AIR1_Short_close');
		expect(table.rows.every((row) => row.delta === null && row.deltaBest === 0)).toBe(true);
	});

	it('compares slot by slot against a baseline, positive when faster', () => {
		const { input, kills } = find('Air Pure Medium - Challenge - 2026.09.18-18.44.15');
		const engaged = engagements(kills, killTimes(input));
		// The same run slowed down by 10 %: every split and the dead time are 10 % longer.
		const slow = engaged.map((e) => ({ ...e, start: e.start * 1.1, end: e.end * 1.1 }));
		const table = raceRows(engaged, slow, bestSplits([engaged, slow], 5));
		for (const row of table.rows) {
			expect(row.delta).toBeCloseTo(row.split * 0.1, 9);
			expect(row.best).toBeCloseTo(row.split, 9);
		}
		expect(table.dead.delta).toBeCloseTo(table.dead.split * 0.1, 9);
	});

	it('place race encounters at k / N whatever the dead time', () => {
		const { input, curve, kills } = find('Air Pure Medium - Challenge - 2026.09.18-18.44.15');
		const spans = encounters(curve, engagements(kills, killTimes(input)));
		expect(spans.map((e) => [e.x0, e.x1])).toEqual([0, 1, 2, 3, 4].map((k) => [k / 5, (k + 1) / 5]));
	});
});

describe('R6 clock bot rows', () => {
	it('with dead time, sum to the duration and the final score', () => {
		const { input, curve, kills } = find('VT Aether Novice S5 Hard Bot 1 90% - Challenge - 2026.09.18-18.59.40');
		const engaged = engagements(kills, killTimes(input));
		expect(engaged.length).toBe(kills.bot.length);
		const table = clockRows(curve, engaged, kills, null);
		expect(table.rows).toHaveLength(1);
		const [row] = table.rows;
		expect(row!.encounters).toBe(engaged.length);
		expect(row!.hits).toBe(kills.hits.reduce((a, b) => a + b, 0));
		expect(row!.points + table.dead.points).toBeCloseTo(input.score, 3);
		const duration = curve.params.kind === 'clock' ? curve.params.durationS : 0;
		expect(row!.time + table.dead.time).toBeCloseTo(duration, 6);
		// The Python version's residual: the duration less every TTK, the
		// time after the last window included.
		expect(table.dead.time).toBeCloseTo(duration - kills.ttk.reduce((a, b) => a + b, 0), 6);
	});

	it('takes the per-bot difference against the baseline', () => {
		const { input, curve, kills } = find('VT Aether Novice S5 Hard Bot 1 90% - Challenge - 2026.09.18-18.59.40');
		const engaged = engagements(kills, killTimes(input));
		const table = clockRows(curve, engaged, kills, { curve, engaged });
		expect(table.rows[0]!.delta).toBe(0);
		expect(largestLoss(table.rows)).toBeNull();
	});

	it('has no encounters without kills', () => {
		const { curve } = find('VT Aether Intermediate S5 - Challenge - 2026.09.18-19.10.23');
		const none = { bot: [], hits: [], shots: [], ttk: [] };
		expect(encounters(curve, engagements(none, []))).toEqual([]);
		expect(clockRows(curve, [], none, null).rows).toEqual([]);
	});
});

/** Each slot's TTK over every curated run of the named scenario. */
async function windowOf(name: string): Promise<number | null> {
	const { rows } = await pg.query<{ id: number }>('select id from scenario where name = $1', [name]);
	expect(rows).toHaveLength(1);
	return fixedWindow(await getSlotStats(pg, rows[0]!.id));
}

describe('fixed windows', () => {
	it('hold every slot to the same TTK run to run, and the first slot is the live time', async () => {
		// One curated run of it has kills, and one run shows nothing fixed.
		expect(await windowOf('VT Aether Intermediate S5')).toBeNull();
		// 18.99 s for bot 1, 20.39 s after: the 1.4 s reset hides in the later TTKs.
		expect(await windowOf('VT Aether Novice S5 Hard Bot 1 90%')).toBeCloseTo(18.99, 1);
		// Killable bots: TTK is how long it took.
		expect(await windowOf('Air Pure Medium')).toBeNull();
	});

	it('need two runs of a slot and a tight spread', () => {
		const slot = (s: number, runs: number, mean: number, spread: number) => ({ slot: s, runs, mean, spread });
		expect(fixedWindow([slot(0, 1, 19, 0)])).toBeNull();
		expect(fixedWindow([slot(0, 5, 19, 0.001), slot(1, 5, 20.4, 0.001), slot(2, 1, 3, 0)])).toBe(19);
		expect(fixedWindow([slot(0, 5, 19, 0.001), slot(1, 5, 2, 0.5)])).toBeNull();
	});

	it('cut an engagement to the window, the rest of its TTK dead time', () => {
		const kills = { bot: ['a', 'b'], hits: [0, 0], shots: [0, 0], ttk: [19, 20.4] };
		expect(engagements(kills, [19, 39.4], 19)).toEqual([
			{ index: 0, bot: 'a', start: 0, end: 19 },
			{ index: 1, bot: 'b', start: 20.4, end: 39.4 },
		]);
	});

	it('leave Aether with the resets between bots and the time after the last as dead time', async () => {
		const { input, curve, kills } = find('VT Aether Novice S5 Hard Bot 1 90% - Challenge - 2026.09.18-18.59.40');
		const window = (await windowOf('VT Aether Novice S5 Hard Bot 1 90%'))!;
		const table = clockRows(curve, engagements(kills, killTimes(input), window), kills, null);
		// Two resets of ~1.4 s and ~0.2 s after the last window.
		expect(table.dead.time).toBeGreaterThan(2.9);
		expect(table.dead.time).toBeLessThan(3.2);
	});
});

describe('click scenarios', () => {
	it('are told apart by shots per kill', () => {
		expect(isClicking(find('1w2ts Perfected - Challenge').kills)).toBe(true);
		expect(isClicking(find('VT 1w3ts Intermediate S5 Clusters').kills)).toBe(true);
		expect(isClicking(find('Air Pure Medium - Challenge - 2026.09.18-18.44.15').kills)).toBe(false);
		expect(isClicking(find('VT Aether Intermediate S5 - Challenge - 2026.09.18-19.10.23').kills)).toBe(false);
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
