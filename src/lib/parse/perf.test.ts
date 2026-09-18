import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { raw } from '../../../test/helpers/fixtures';
import { type Event, PerformanceFileSchema } from '../../gen/perf_pb';

const PERF_SUFFIX = ' Performance.perf';
const STATS_SUFFIX = ' Stats.csv';

/** `<base> Performance.perf` -> `<base>`. */
function baseName(perfFile: string): string {
	return perfFile.slice(0, -PERF_SUFFIX.length);
}

/** Pull the trailing `Key:,value` block out of a Stats.csv. */
function statsKeyValues(text: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const line of text.split(/\r?\n/)) {
		const at = line.indexOf(':,');
		if (at > 0 && !line.slice(0, at).includes(',')) out.set(line.slice(0, at), line.slice(at + 2));
	}
	return out;
}

/** Sum a column of the `Weapon,Shots,Hits,...` table. */
function weaponTotals(text: string): { shots: number; hits: number; damagePossible: number } {
	const lines = text.split(/\r?\n/);
	const header = lines.findIndex((l) => l.startsWith('Weapon,Shots'));
	const totals = { shots: 0, hits: 0, damagePossible: 0 };
	if (header < 0) return totals;
	for (const line of lines.slice(header + 1)) {
		if (line.trim() === '') break;
		const cells = line.split(',');
		totals.shots += Number(cells[1]);
		totals.hits += Number(cells[2]);
		totals.damagePossible += Number(cells[4]);
	}
	return totals;
}

type PayloadCase = NonNullable<Event['payload']['case']>;

function sumOf(events: Event[], want: PayloadCase): number {
	let total = 0;
	for (const event of events) {
		if (event.payload.case !== want) continue;
		const inner = event.payload.value as { count?: number; delta?: number; value?: number };
		total += inner.count ?? inner.delta ?? inner.value ?? 0;
	}
	return total;
}

const perfFiles = raw.available ? raw.list('performances') : [];
const statsFiles = new Set(raw.available ? raw.list('stats') : []);

describe.skipIf(!raw.available)('KovaaK .perf decoding', () => {
	it('has a corpus to check', () => {
		expect(perfFiles.length).toBeGreaterThan(0);
	});

	it('decodes and re-encodes every file byte-identically', () => {
		const decodeFailures: string[] = [];
		const encodeMismatches: string[] = [];
		const unknownFields: string[] = [];

		for (const name of perfFiles) {
			const bytes = raw.bytes('performances', name);
			let reencoded: Uint8Array;
			try {
				const decoded = fromBinary(PerformanceFileSchema, bytes);
				if (decoded.$unknown?.length) unknownFields.push(name);
				reencoded = toBinary(PerformanceFileSchema, decoded);
			} catch (error) {
				decodeFailures.push(`${name}: ${String(error)}`);
				continue;
			}
			if (Buffer.compare(Buffer.from(reencoded), Buffer.from(bytes)) !== 0) {
				encodeMismatches.push(name);
			}
		}

		expect(decodeFailures.slice(0, 5)).toEqual([]);
		expect(encodeMismatches.slice(0, 5)).toEqual([]);
		// Nothing in the corpus uses a field our schema does not model.
		expect(unknownFields.slice(0, 5)).toEqual([]);
	});

	it('agrees with the paired Stats.csv', () => {
		const problems: string[] = [];
		let paired = 0;

		for (const name of perfFiles) {
			const stats = `${baseName(name)}${STATS_SUFFIX}`;
			if (!statsFiles.has(stats)) continue;
			paired++;

			const file = fromBinary(PerformanceFileSchema, raw.bytes('performances', name));
			const header = file.header;
			const csv = raw.text('stats', stats);
			const kv = statsKeyValues(csv);
			const weapons = weaponTotals(csv);

			const check = (label: string, actual: number, expected: number, tolerance = 0) => {
				if (!Number.isFinite(expected)) return;
				if (Math.abs(actual - expected) > tolerance) {
					problems.push(`${name}: ${label} ${actual} != ${expected}`);
				}
			};

			if (header?.scenarioName !== kv.get('Scenario')) {
				problems.push(`${name}: scenario_name ${header?.scenarioName} != ${kv.get('Scenario')}`);
			}
			if (header?.scenarioHash !== kv.get('Hash')) {
				problems.push(`${name}: scenario_hash ${header?.scenarioHash} != ${kv.get('Hash')}`);
			}
			if (header?.schemaVersion !== 1) problems.push(`${name}: schema_version ${header?.schemaVersion}`);

			check('shots_fired', sumOf(file.events, 'shotsFired'), weapons.shots);
			check('shots_hit', sumOf(file.events, 'shotsHit'), Number(kv.get('Hit Count')));
			check('shots_missed', sumOf(file.events, 'shotsMissed'), Number(kv.get('Miss Count')));
			check('kills', sumOf(file.events, 'kills'), Number(kv.get('Kills')));
			check('reloads', sumOf(file.events, 'reloads'), Number(kv.get('Reloads')));
			check('pause_count', sumOf(file.events, 'pauseCount'), Number(kv.get('Pause Count')));

			// Float deltas accumulate rounding, so compare relatively.
			const relative = (expected: number) => Math.max(0.01, Math.abs(expected) * 1e-4);
			const damageDone = Number(kv.get('Damage Done'));
			check('damage_done', sumOf(file.events, 'damageDone'), damageDone, relative(damageDone));
			check(
				'damage_possible',
				sumOf(file.events, 'damagePossible'),
				weapons.damagePossible,
				relative(weapons.damagePossible),
			);
			const score = Number(kv.get('Score'));
			check('score', sumOf(file.events, 'score'), score, relative(score));
			const taken = Number(kv.get('Damage Taken'));
			check('player_damage_taken', sumOf(file.events, 'playerDamageTaken'), taken, relative(taken));
			const distance = Number(kv.get('Distance Traveled'));
			check('distance_traveled', sumOf(file.events, 'distanceTraveled'), distance, relative(distance));
			const mbs = Number(kv.get('MBS Points'));
			check('mbs_points', sumOf(file.events, 'mbsPoints'), mbs, relative(mbs));
		}

		expect(paired).toBeGreaterThan(100);
		expect(problems.slice(0, 10)).toEqual([]);
	});

	it('models the challenge profile and event timeline', () => {
		const problems: string[] = [];

		for (const name of perfFiles) {
			const file = fromBinary(PerformanceFileSchema, raw.bytes('performances', name));
			const profile = file.header?.challengeProfile;
			if (!profile) {
				problems.push(`${name}: no challenge_profile`);
				continue;
			}

			// bot_max_lives / bot_teams are parallel arrays over added_bots.
			if (profile.botMaxLives.length !== profile.addedBots.length) {
				problems.push(`${name}: bot_max_lives arity`);
			}
			if (profile.botTeams.length !== profile.addedBots.length) {
				problems.push(`${name}: bot_teams arity`);
			}

			// Every event carries a payload and a monotonic timestamp.
			let previous = 0;
			for (const event of file.events) {
				if (event.payload.case === undefined) problems.push(`${name}: empty payload`);
				if (event.timestamp < previous) problems.push(`${name}: timestamp went backwards`);
				previous = event.timestamp;
			}

			// challenge_start_utc is milliseconds at whole-second resolution.
			const start = Number(file.header?.challengeStartUtc ?? 0n);
			if (start % 1000 !== 0 || start < 1_500_000_000_000) {
				problems.push(`${name}: challenge_start_utc ${start}`);
			}

			// Real duration is time_limit / timescale, unless the scenario has no
			// time limit (the 1000.0 sentinel) or ended early on a kill/damage cap.
			const last = file.events.at(-1)?.timestamp ?? 0;
			const endsEarly = profile.endChallengeAfterKills > 0 || profile.endChallengeAfterDamage > 0;
			if (!endsEarly && profile.timeLimit > 0 && profile.timeLimit !== 1000 && profile.timescale > 0) {
				if (Math.abs(profile.timeLimit / profile.timescale - last) > 2) {
					problems.push(`${name}: duration ${last} vs ${profile.timeLimit / profile.timescale}`);
				}
			}
		}

		expect(problems.slice(0, 10)).toEqual([]);
	});

	it('closes out the overshot counter at end of run', () => {
		// Files that record overshots always end with a single negative Overshots
		// event that zeroes the running total. Documented in docs/perf-format.md.
		let filesWithOvershots = 0;

		for (const name of perfFiles) {
			const file = fromBinary(PerformanceFileSchema, raw.bytes('performances', name));
			const counts = file.events
				.filter((e) => e.payload.case === 'overshots')
				.map((e) => (e.payload.value as { count: number }).count);
			if (counts.length === 0) continue;
			filesWithOvershots++;

			expect(counts.filter((c) => c < 0)).toHaveLength(1);
			expect(counts.at(-1)).toBe(-counts.slice(0, -1).reduce((a, b) => a + b, 0));
		}

		expect(filesWithOvershots).toBeGreaterThan(0);
	});
});
