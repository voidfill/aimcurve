import type { PGlite } from '@electric-sql/pglite';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../../test/helpers/db';
import { curated } from '../../../test/helpers/fixtures';
import { ingest } from '../ingest';
import { nodeSource } from '../ingest/source-node';
import { clockRows, engagements, fixedWindow, type KillDetail, raceRows } from '../run/bots';
import { getKillDetail, getScoringInputs, getSlotStats } from '../run/queries';
import { curveFor, killTimes, type ScoringInput } from '../scoring';
import { botSeries, botTabs } from './bots';
import { CONFIG_COLORS, configGroups, configKey, type SensConfig } from './config';
import { isNewestVersion, kovaaksLink, versionLabel } from './link';
import { getScenario, type HistoryRun, listHistory, listVersions } from './queries';
import { pbSteps, rollingMedian, sessionBreaks } from './series';

const base: SensConfig = { sensScale: 'cm/360', horizSens: 30, vertSens: 30, dpi: 1600, fov: 103, fovScale: 'Overwatch' };

describe('S4 config groups', () => {
	it('key on sens, DPI and FOV only', () => {
		expect(configKey(base)).toBe(configKey({ ...base }));
		expect(configKey(base)).not.toBe(configKey({ ...base, fov: 90 }));
		expect(configKey(base)).not.toBe(configKey({ ...base, vertSens: 31 }));
	});

	it('label in first-use order, colour the three most recently used, and mark the current one', () => {
		const configs = [30, 31, 32, 33, 30].map((horizSens) => ({ ...base, horizSens }));
		const runs = configs.map((config, i) => ({ config, score: 100 + i, startedAt: `2026-09-0${i + 1}T00:00:00.000Z` }));
		const { groups, groupOf } = configGroups(runs);
		expect(groups.map((g) => g.label)).toEqual(['C1', 'C2', 'C3', 'C4']);
		expect(groupOf).toEqual([0, 1, 2, 3, 0]);
		// C2 is the least recently used, so it is the neutral one.
		expect(groups.map((g) => g.color)).toEqual([CONFIG_COLORS[0], null, CONFIG_COLORS[1], CONFIG_COLORS[2]]);
		expect(groups.find((g) => g.current)?.label).toBe('C1');
		expect(groups[0]).toMatchObject({ runs: 2, best: 104, median: 102, lastUsed: '2026-09-05T00:00:00.000Z' });
	});

	it('leave a group without scores with no best or median', () => {
		const { groups } = configGroups([{ config: base, score: null, startedAt: '2026-09-01T00:00:00.000Z' }]);
		expect(groups[0]).toMatchObject({ runs: 1, best: null, median: null, current: true });
	});
});

describe('S5 lines', () => {
	it('step the best so far in either direction, through gaps', () => {
		expect(pbSteps([null, 3, 1, null, 5, 4], 'higher')).toEqual([null, 3, 3, 3, 5, 5]);
		expect(pbSteps([3, 4, 1, 2], 'lower')).toEqual([3, 3, 1, 1]);
	});

	it('take a rolling median over the values present, marking a partial window', () => {
		const { value, full } = rollingMedian([1, 5, null, 3, 10], 3);
		expect(value).toEqual([1, 3, null, 3, 5]);
		expect(full).toEqual([false, false, false, true, true]);
	});

	it('break sessions where the session id changes', () => {
		expect(sessionBreaks([4, 4, 5, 5, 5, 9])).toEqual([2, 5]);
		expect(sessionBreaks([])).toEqual([]);
	});
});

describe('S1 and S7 links', () => {
	it('encode the name into the documented Kovaak’s deep link', () => {
		expect(kovaaksLink('voxTS Pure')).toBe('steam://run/824270/?action=jump-to-scenario;name=voxTS%20Pure');
		expect(kovaaksLink('SYW (Smooth Your Wrist) #5')).toBe(
			'steam://run/824270/?action=jump-to-scenario;name=SYW%20(Smooth%20Your%20Wrist)%20%235',
		);
	});

	it('label and rank versions', () => {
		const versions = [
			{ id: 1, hash: 'aaaaaaaaaaaa', runs: 1, lastPlayed: '2026-09-01T12:00:00.000Z' },
			{ id: 2, hash: 'bbbbbbbbbbbb', runs: 42, lastPlayed: '2026-09-03T12:00:00.000Z' },
		];
		expect(versionLabel(versions[0]!)).toMatch(/^aaaaaaaa · 1 run · last /);
		expect(versionLabel(versions[1]!)).toMatch(/^bbbbbbbb · 42 runs · last /);
		expect(isNewestVersion('bbbbbbbbbbbb', versions)).toBe(true);
		expect(isNewestVersion('aaaaaaaaaaaa', versions)).toBe(false);
	});
});

describe('on the curated fixtures', () => {
	let pg: PGlite;

	beforeAll(async () => {
		({ pg } = await makeTestDb());
		await ingest(nodeSource(join(curated.dir, 'stats'), join(curated.dir, 'performances')), pg);
	});

	async function load(name: string) {
		const id = (await pg.query<{ id: number }>(`select id from scenario where name = $1`, [name])).rows[0]!.id;
		const hash = (await pg.query<{ hash: string }>(`select hash from scenario where id = $1`, [id])).rows[0]!.hash;
		const history = await listHistory(pg, id);
		const ids = history.map((r) => r.id);
		const inputs = await getScoringInputs(pg, ids);
		const kills = await getKillDetail(pg, ids);
		const window = fixedWindow(await getSlotStats(pg, id));
		const byStem = (map: Map<number, unknown>) => (stem: string) => map.get(history.find((r) => r.fileStem === stem)!.id);
		return {
			id,
			hash,
			history,
			window,
			inputOf: byStem(inputs) as (stem: string) => ScoringInput | undefined,
			killsOf: byStem(kills) as (stem: string) => KillDetail | undefined,
		};
	}

	it('list a scenario’s completed runs oldest first, with PB before and sessions', async () => {
		const { id, hash, history } = await load('VT Aether Novice S5 Hard Bot 1 90%');
		expect(await getScenario(pg, hash)).toEqual({ id, name: 'VT Aether Novice S5 Hard Bot 1 90%', hash });
		expect(await getScenario(pg, 'no-such-hash')).toBeNull();
		expect(history.length).toBeGreaterThan(1);
		const starts = history.map((r) => r.startedAt);
		expect(starts).toEqual([...starts].sort());
		expect(history[0]!.pbBefore).toBeNull();
		for (let i = 1; i < history.length; i++) {
			const best = Math.max(...history.slice(0, i).map((r: HistoryRun) => r.score ?? -Infinity));
			expect(history[i]!.pbBefore).toBe(best);
		}
		const versions = await listVersions(pg, 'VT Aether Novice S5 Hard Bot 1 90%');
		expect(versions).toEqual([expect.objectContaining({ id, hash, runs: history.length })]);
	});

	it('give clock bot values equal to Run’s bot-table pace and points', async () => {
		const { history, window, inputOf, killsOf } = await load('VT Aether Novice S5 Hard Bot 1 90%');
		const stems = history.map((r) => r.fileStem);
		const ref = [...stems].reverse().find((s) => inputOf(s) && killsOf(s))!;
		const tabs = botTabs(inputOf(ref)!, killsOf(ref)!, window)!;
		expect(tabs.kind).toBe('clock');
		const series = botSeries(stems, tabs, inputOf, killsOf, window);
		expect(series.covered).toBeGreaterThan(0);
		for (const [i, stem] of stems.entries()) {
			const input = inputOf(stem);
			const kills = killsOf(stem);
			if (!input || !kills) {
				for (const values of series.values.values()) expect(values[i]).toBeNull();
				continue;
			}
			const curve = curveFor(input)!;
			const table = clockRows(curve, engagements(kills, killTimes(input), window), kills, null);
			for (const row of table.rows) {
				expect(series.values.get(row.bot)![i]).toBe(row.pace);
				expect(series.raw.get(row.bot)![i]).toBe(row.points);
			}
		}
	});

	it('give race bot values equal to Run’s pace on the score scale and its splits, slot by slot', async () => {
		const { history, window, inputOf, killsOf } = await load('Air Pure Medium');
		const stems = history.map((r) => r.fileStem);
		const ref = [...stems].reverse().find((s) => inputOf(s) && killsOf(s))!;
		const tabs = botTabs(inputOf(ref)!, killsOf(ref)!, window)!;
		expect(tabs.kind).toBe('race');
		expect(tabs.tabs[0]!.label).toBe('1 · AIR1_Short_close');
		const series = botSeries(stems, tabs, inputOf, killsOf, window);
		expect(series.covered).toBe(stems.filter((s) => inputOf(s) && killsOf(s)).length);
		for (const [i, stem] of stems.entries()) {
			const input = inputOf(stem);
			const kills = killsOf(stem);
			if (!input || !kills) continue;
			const curve = curveFor(input)!;
			const budget = curve.params.kind === 'race' ? curve.params.budget : Number.NaN;
			const rows = raceRows(engagements(kills, killTimes(input), window), null, []).rows;
			for (const row of rows) {
				expect(series.values.get(String(row.slot))![i]).toBe(budget - row.pace);
				expect(series.raw.get(String(row.slot))![i]).toBe(row.split);
			}
		}
	});
});
