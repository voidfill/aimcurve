import { fromBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { raw } from '../../../test/helpers/fixtures';
import { PerformanceFileSchema } from '../../gen/perf_pb';
import { parseStatsCsv, StatsCsvError } from './stats-csv';

/** A minimal but complete file, CRLF like the real thing. */
function sample(overrides: { kills?: string[]; weapons?: string[] } = {}): string {
	const kills = overrides.kills ?? [
		'1,22:56:13.670,air1_far_short,pistol,0.444000s,2,1,0.500000,1000.000000,4000.000000,0.250000,0,0',
		'2,22:56:14.524,air1_far_short,pistol,0.000000s,1,1,1.000000,1000.000000,2000.000000,0.500000,0,0',
	];
	const weapons = overrides.weapons ?? ['pistol,90,70,70000.0,180000.0,'];
	return [
		'Kill #,Timestamp,Bot,Weapon,TTK,Shots,Hits,Accuracy,Damage Done,Damage Possible,Efficiency,Cheated,OverShots',
		...kills,
		'',
		'Weapon,Shots,Hits,Damage Done,Damage Possible,,Sens Scale,Horiz Sens,Vert Sens,FOV,Hide Gun,Crosshair,Crosshair Scale,Crosshair Color,ADS Sens,ADS Zoom Scale,Avg Target Scale,Avg Time Dilation',
		...weapons,
		'',
		'Kills:,70',
		'Deaths:,0',
		'Fight Time:,7.56',
		'Time Remaining:,0.0',
		'Avg TTK:,0.857055',
		'Damage Done:,70000.0',
		'Total Overshots:,0',
		'Damage Taken:,0.0',
		'Hit Count:,70',
		'Miss Count:,20',
		'Midairs:,0',
		'Midaired:,0',
		'Directs:,0',
		'Directed:,0',
		'Reloads:,0',
		'Distance Traveled:,0.0',
		'MBS Points:,0.0',
		'Score:,70.0',
		'Scenario:,1w2ts Pasu Perfected Easy',
		'Hash:,96fef74e7b12ff786b2e2621da400adc',
		'Game Version:,3.8.2.2025-12-12-11-43-29-d73835388838',
		'Challenge Start:,22:56:12.039',
		'Pause Count:,0',
		'Pause Duration:,0',
		'Avg Target Scale:,1.0',
		'Avg Time Dilation:,1.0',
		'',
		'Input Lag:,0',
		'Max FPS (config):,999.0',
		'Sens Scale:,The FINALS',
		'Sens Increment:,0.471429',
		'Horiz Sens:,33.0',
		'Vert Sens:,33.0',
		'DPI:,400',
		'FOV:,80.0',
		'FOVScale:,The FINALS',
		'Hide Gun:,false',
		'Crosshair:,blank.png',
		'Crosshair Scale:,0.1',
		'Crosshair Color:,010101FF',
		'Resolution:,3440x1440',
		'Avg FPS:,423.093353',
		'Resolution Scale:,100.0',
		'',
	].join('\r\n');
}

describe('parseStatsCsv', () => {
	it('parses the kill table', () => {
		const { kills } = parseStatsCsv(sample());

		expect(kills).toHaveLength(2);
		expect(kills[0]).toEqual({
			index: 1,
			timestamp: '22:56:13.670',
			bot: 'air1_far_short',
			weapon: 'pistol',
			timeToKillSeconds: 0.444,
			shots: 2,
			hits: 1,
			accuracy: 0.5,
			damageDone: 1000,
			damagePossible: 4000,
			efficiency: 0.25,
			cheated: 0,
			overShots: 0,
		});
	});

	it('strips the trailing "s" from TTK', () => {
		expect(parseStatsCsv(sample()).kills[1]!.timeToKillSeconds).toBe(0);
	});

	it('parses the weapon table positionally, ignoring the vestigial header columns', () => {
		expect(parseStatsCsv(sample()).weapons).toEqual([
			{ weapon: 'pistol', shots: 90, hits: 70, damageDone: 70000, damagePossible: 180000 },
		]);
	});

	it('handles multiple weapon rows, including unused weapons', () => {
		const { weapons } = parseStatsCsv(
			sample({ weapons: ['pistol,90,70,70000.0,180000.0,', 'Track Master 100,0,0,0.0,0.0,'] }),
		);
		expect(weapons.map((w) => w.weapon)).toEqual(['pistol', 'Track Master 100']);
		expect(weapons[1]!.shots).toBe(0);
	});

	it('accepts an empty kill table, as tracking scenarios produce', () => {
		const { kills, weapons } = parseStatsCsv(sample({ kills: [] }));
		expect(kills).toEqual([]);
		expect(weapons).toHaveLength(1);
	});

	it('parses totals and settings', () => {
		const { totals, settings } = parseStatsCsv(sample());

		expect(totals.score).toBe(70);
		expect(totals.hitCount).toBe(70);
		expect(totals.missCount).toBe(20);
		expect(totals.fightTimeSeconds).toBe(7.56);

		expect(settings.scenario).toBe('1w2ts Pasu Perfected Easy');
		expect(settings.hash).toBe('96fef74e7b12ff786b2e2621da400adc');
		expect(settings.sensScale).toBe('The FINALS');
		expect(settings.sensIncrement).toBe(0.471429);
		expect(settings.hideGun).toBe(false);
		expect(settings.resolution).toBe('3440x1440');
	});

	it('keeps commas inside a key value', () => {
		const text = sample().replace('Scenario:,1w2ts Pasu Perfected Easy', 'Scenario:,Wide, Wider');
		expect(parseStatsCsv(text).settings.scenario).toBe('Wide, Wider');
	});

	describe('rejects malformed input', () => {
		it('with no kill table header', () => {
			expect(() => parseStatsCsv('nothing here')).toThrow(StatsCsvError);
		});

		it('with unexpected kill table columns', () => {
			const text = sample().replace('Kill #,Timestamp,Bot', 'Kill #,Timestamp,Robot');
			expect(() => parseStatsCsv(text)).toThrow(/unexpected kill table columns/);
		});

		it('with a missing key rather than yielding NaN', () => {
			const text = sample().replace('Score:,70.0\r\n', '');
			expect(() => parseStatsCsv(text)).toThrow(/missing key "Score:"/);
		});

		it('with a non-numeric value', () => {
			const text = sample().replace('Hit Count:,70', 'Hit Count:,lots');
			expect(() => parseStatsCsv(text)).toThrow(/Hit Count: expected a number/);
		});

		it('with a short kill row', () => {
			const text = sample({ kills: ['1,22:56:13.670,air1_far_short'] });
			expect(() => parseStatsCsv(text)).toThrow(/expected 13 cells, got 3/);
		});
	});

	it('ignores unknown extra keys, so added fields do not break ingest', () => {
		const text = sample().replace('Score:,70.0', 'Score:,70.0\r\nSome New Stat:,42');
		expect(parseStatsCsv(text).totals.score).toBe(70);
	});
});

describe.skipIf(!raw.available)('parseStatsCsv over the corpus', () => {
	const statsFiles = raw.list('stats');

	it('parses every file', () => {
		const failures: string[] = [];
		for (const name of statsFiles) {
			try {
				parseStatsCsv(raw.text('stats', name));
			} catch (error) {
				failures.push(`${name}: ${String(error)}`);
			}
		}
		expect(failures.slice(0, 5)).toEqual([]);
		expect(statsFiles.length).toBeGreaterThan(2000);
	});

	it('produces internally consistent totals', () => {
		const problems: string[] = [];

		for (const name of statsFiles) {
			const { kills, weapons, totals } = parseStatsCsv(raw.text('stats', name));

			const weaponShots = weapons.reduce((sum, w) => sum + w.shots, 0);
			const weaponHits = weapons.reduce((sum, w) => sum + w.hits, 0);
			if (weaponHits !== totals.hitCount) problems.push(`${name}: weapon hits vs Hit Count`);
			if (weaponShots !== totals.hitCount + totals.missCount) {
				problems.push(`${name}: weapon shots vs hits+misses`);
			}
			// The kill table normally agrees with the kill total and is numbered
			// 1..n. Destructible-target scenarios are the documented exception:
			// every row is numbered 0 and `Kills:` stays 0.
			if (kills.length > 0) {
				const destructible = kills.every((kill) => kill.index === 0);
				if (destructible) {
					if (totals.kills !== 0) problems.push(`${name}: zero-indexed rows but Kills: ${totals.kills}`);
				} else {
					if (kills.length !== totals.kills) {
						problems.push(`${name}: ${kills.length} kill rows vs Kills: ${totals.kills}`);
					}
					if (kills.some((kill, i) => kill.index !== i + 1)) {
						problems.push(`${name}: kill rows not numbered 1..n`);
					}
				}
			}
		}

		expect(problems.slice(0, 10)).toEqual([]);
	});

	it('agrees with the paired .perf', () => {
		const perfFiles = new Set(raw.list('performances'));
		const problems: string[] = [];
		let paired = 0;

		for (const name of statsFiles) {
			const perf = `${name.slice(0, -' Stats.csv'.length)} Performance.perf`;
			if (!perfFiles.has(perf)) continue;
			paired++;

			const { totals, settings } = parseStatsCsv(raw.text('stats', name));
			const file = fromBinary(PerformanceFileSchema, raw.bytes('performances', perf));

			if (settings.scenario !== file.header?.scenarioName) problems.push(`${name}: scenario`);
			if (settings.hash !== file.header?.scenarioHash) problems.push(`${name}: hash`);

			let hits = 0;
			for (const event of file.events) {
				if (event.payload.case === 'shotsHit') hits += event.payload.value.count;
			}
			if (hits !== totals.hitCount) problems.push(`${name}: hits ${hits} != ${totals.hitCount}`);
		}

		expect(paired).toBeGreaterThan(2000);
		expect(problems.slice(0, 10)).toEqual([]);
	});
});
