/**
 * Tests over the committed fixture set in `curated/`.
 *
 * Unlike the sweeps in `src/lib/parse/*.test.ts`, nothing here guards on
 * `raw.available` — this is the suite that has to pass on a fresh clone, and it
 * is where the quirks documented in `curated/README.md` and
 * `docs/perf-format.md` are pinned to concrete files.
 *
 * Needs Git LFS. Without it the fixtures are pointer files and the first parse
 * throws, which is the intended failure: loud, not silent.
 */
import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { type Event, type PerformanceFile, PerformanceFileSchema } from '../../src/gen/perf_pb';
import { parseStatsCsv, type StatsCsv } from '../../src/lib/parse/stats-csv';
import { curated } from '../helpers/fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATS_SUFFIX = ' Stats.csv';
const PERF_SUFFIX = ' Performance.perf';

/**
 * `<scenario> - Challenge - YYYY.MM.DD-HH.MM.SS`. The ` - Challenge - ` infix is
 * optional because abort-written files do not have it — see `classify`.
 */
const FILENAME = /^(.*?) - (?:Challenge - )?(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/;

interface Run {
	stem: string;
	/** Scenario as it appears in the *filename*, which is not always the field. */
	filenameScenario: string;
	csv: StatsCsv;
	/** Local ms of the filename timestamp: the moment the file was written. */
	writtenAt: number;
	/** Local ms of `Challenge Start:`, dated from the filename. */
	startedAt: number;
	/** `writtenAt` end-of-second minus `startedAt`. */
	durationMs: number;
}

function readRun(statsFile: string): Run {
	const stem = statsFile.slice(0, -STATS_SUFFIX.length);
	const parts = FILENAME.exec(stem);
	if (!parts) throw new Error(`unparseable fixture name: ${stem}`);
	const [, filenameScenario, year, month, day, hour, minute, second] = parts;

	const csv = parseStatsCsv(curated.text('stats', statsFile));
	const clock = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(csv.settings.challengeStart);
	if (!clock) throw new Error(`unparseable Challenge Start: ${csv.settings.challengeStart}`);

	// The filename timestamp is the WRITE time, truncated to the second, so the
	// run ended somewhere in that second — take its end as the upper bound.
	const writtenAt = new Date(+year!, +month! - 1, +day!, +hour!, +minute!, +second!).getTime();
	let startedAt = new Date(+year!, +month! - 1, +day!, +clock[1]!, +clock[2]!, +clock[3]!, +clock[4]!).getTime();
	// `Challenge Start:` carries no date, so a run that straddled midnight reads
	// as starting later than it was written.
	if (startedAt > writtenAt + 60_000) startedAt -= 86_400_000;

	return { stem, filenameScenario: filenameScenario!, csv, writtenAt, startedAt, durationMs: writtenAt + 999 - startedAt };
}

type Kind = 'complete' | 'reset' | 'abort';

/**
 * Classifies a run by the interval it claims to occupy.
 *
 * A reset-written file is stamped with the *next* attempt's start but written
 * now, so it spans almost nothing. An abort-written file has no scenario
 * identity at all and its `Challenge Start` is stale, throwing the interval
 * absurdly wide.
 */
function classify(run: Run): Kind {
	if (run.csv.settings.hash === '' || run.csv.settings.scenario === '') return 'abort';
	if (run.durationMs < 1_000) return 'reset';
	return 'complete';
}

interface Perf {
	name: string;
	stem: string;
	file: PerformanceFile;
	bytes: Uint8Array;
}

function readPerf(perfFile: string): Perf {
	const bytes = curated.bytes('performances', perfFile);
	return { name: perfFile, stem: perfFile.slice(0, -PERF_SUFFIX.length), file: fromBinary(PerformanceFileSchema, bytes), bytes };
}

type PayloadCase = NonNullable<Event['payload']['case']>;

function eventsOf(events: Event[], want: PayloadCase): number[] {
	return events
		.filter((event) => event.payload.case === want)
		.map((event) => {
			const inner = event.payload.value as { count?: number; delta?: number; value?: number };
			return inner.count ?? inner.delta ?? inner.value ?? 0;
		});
}

const sumOf = (events: Event[], want: PayloadCase) => eventsOf(events, want).reduce((a, b) => a + b, 0);

const runs = curated.list('stats').map(readRun);
const perfs = curated.list('performances').map(readPerf);
const byKind = (kind: Kind) => runs.filter((run) => classify(run) === kind);
const find = (fragment: string) => {
	const hits = runs.filter((run) => run.stem.includes(fragment));
	if (hits.length !== 1) throw new Error(`${fragment}: expected 1 fixture, found ${hits.length}`);
	return hits[0]!;
};
const findPerf = (fragment: string) => {
	const hits = perfs.filter((perf) => perf.stem.includes(fragment));
	if (hits.length !== 1) throw new Error(`${fragment}: expected 1 perf, found ${hits.length}`);
	return hits[0]!;
};

// ---------------------------------------------------------------------------
// Broad validity
// ---------------------------------------------------------------------------

describe('the curated set is readable', () => {
	it('is committed and non-empty', () => {
		expect(curated.available).toBe(true);
		expect(runs.length).toBeGreaterThan(30);
		expect(perfs.length).toBeGreaterThan(20);
	});

	it.each(curated.list('stats'))('parses %s', (name) => {
		const { csv } = readRun(name);
		// The weapon table is the one section that is never empty.
		expect(csv.weapons.length).toBeGreaterThanOrEqual(1);
		expect(csv.totals.hitCount + csv.totals.missCount).toBe(csv.weapons.reduce((a, w) => a + w.shots, 0));
		expect(csv.settings.resolution).toMatch(/^\d+x\d+$/);
		expect(csv.settings.gameVersion).toMatch(/^3\.\d+\.\d+/);
	});

	it.each(curated.list('performances'))('decodes and re-encodes %s byte-identically', (name) => {
		const { file, bytes } = readPerf(name);
		expect(file.header).toBeDefined();
		expect(file.events.length).toBeGreaterThan(0);
		expect(file.$unknown ?? []).toHaveLength(0);
		expect(toBinary(PerformanceFileSchema, file)).toEqual(bytes);
	});

	it('every event carries exactly one payload', () => {
		for (const { name, file } of perfs) {
			for (const event of file.events) {
				expect(event.payload.case, `${name}`).toBeDefined();
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Scenario diversity
// ---------------------------------------------------------------------------

describe('the set spans both CSV shapes', () => {
	it('includes tracking scenarios, whose kill table is empty', () => {
		const tracking = runs.filter((run) => run.csv.kills.length === 0 && classify(run) === 'complete');
		expect(tracking.length).toBeGreaterThanOrEqual(2);
		// An empty kill table is normal, not a parse failure: the run still scored.
		for (const run of tracking) expect(run.csv.totals.hitCount).toBeGreaterThan(0);
	});

	it('includes clicking scenarios with a populated kill table', () => {
		const clicking = runs.filter((run) => run.csv.kills.length > 40);
		expect(clicking.length).toBeGreaterThanOrEqual(2);
		for (const run of clicking) {
			for (const kill of run.csv.kills) {
				expect(kill.hits).toBeLessThanOrEqual(kill.shots);
				expect(kill.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
			}
		}
	});

	it('covers a wide spread of scenarios, not many runs of one', () => {
		const scenarios = new Set(runs.map((run) => run.filenameScenario));
		expect(scenarios.size).toBeGreaterThanOrEqual(20);
	});

	it('agrees with the filename on the scenario name', () => {
		// True for every file except abort writes, which have no scenario at all.
		for (const run of runs.filter((r) => classify(r) !== 'abort')) {
			expect(run.csv.settings.scenario, run.stem).toBe(run.filenameScenario);
		}
	});
});

describe('Happy Easter! — destructible targets', () => {
	const run = find('Happy Easter!');

	it('has kill rows even though the kill counter stays at zero', () => {
		expect(run.csv.kills.length).toBeGreaterThan(0);
		expect(run.csv.totals.kills).toBe(0);
	});

	it('numbers every row 0, so the kill index is not a key', () => {
		expect(run.csv.kills.every((kill) => kill.index === 0)).toBe(true);
		// Which is the whole point: use array position instead.
		expect(new Set(run.csv.kills.map((k) => k.index)).size).toBe(1);
	});

	it('kills a destructible target rather than a bot', () => {
		expect(new Set(run.csv.kills.map((kill) => kill.bot))).toEqual(new Set(['Egg']));
	});
});

// ---------------------------------------------------------------------------
// Partial writes
// ---------------------------------------------------------------------------

describe('partial writes', () => {
	it('finds the resets and the abort', () => {
		expect(byKind('reset')).toHaveLength(18);
		expect(byKind('abort')).toHaveLength(1);
	});

	it('detects every reset by its degenerate interval', () => {
		// The interval is the reliable signal: a reset file is stamped with the
		// next attempt's start but written now, so it spans almost nothing.
		for (const run of byKind('reset')) {
			expect(run.durationMs, run.stem).toBeLessThan(1_000);
		}
		for (const run of byKind('complete')) {
			expect(run.durationMs, run.stem).toBeGreaterThanOrEqual(1_000);
		}
	});

	it('cannot lean on `Avg FPS == 0`, which is garbage rather than zero', () => {
		// Avg FPS in a reset was never computed, so it holds whatever was in the
		// accumulator. Usually that reads 0.0 — but not always: values around
		// 7.3e9 and 8.9e9 occur. Testing `=== 0` misses those.
		const fps = byKind('reset').map((run) => run.csv.settings.averageFps);
		expect(fps.some((value) => value === 0)).toBe(true);
		expect(fps.some((value) => value > 1e6)).toBe(true);

		// What holds is the weaker claim: never a *plausible* frame rate. That
		// is still a usable cross-check on the interval rule, just not on its own.
		const plausible = (value: number) => value > 0 && value < 10_000;
		for (const run of byKind('reset')) expect(plausible(run.csv.settings.averageFps), run.stem).toBe(false);
		for (const run of byKind('complete')) expect(plausible(run.csv.settings.averageFps), run.stem).toBe(true);
	});

	it('does not detect the abort by the reset signals', () => {
		// The abort file keeps a normal Avg FPS and a wide interval, so neither
		// reset signal sees it — it needs the empty-identity check.
		const abort = byKind('abort')[0]!;
		expect(abort.csv.settings.averageFps).toBeGreaterThan(0);
		expect(abort.csv.settings.scenario).toBe('');
		expect(abort.csv.settings.hash).toBe('');
		expect(abort.stem).not.toContain(' - Challenge - ');
	});

	it('never has a .perf', () => {
		const perfStems = new Set(perfs.map((perf) => perf.stem));
		for (const run of [...byKind('reset'), ...byKind('abort')]) {
			expect(perfStems.has(run.stem), run.stem).toBe(false);
		}
	});

	it('keeps raw counters intact but never computes the derived ones', () => {
		for (const run of byKind('reset')) {
			// Counters accumulated during play are coherent...
			expect(run.csv.totals.hitCount + run.csv.totals.missCount).toBe(run.csv.weapons.reduce((a, w) => a + w.shots, 0));
			// ...but anything finalised at run end was never computed.
			expect(run.csv.totals.averageTimeToKillSeconds).toBe(0);
		}
	});

	it('keeps kill-row timestamps on the real clock, ignoring the broken start', () => {
		// The only partial in the corpus carrying a kill row. Its kill lands
		// 4.1s BEFORE the file's own Challenge Start, which is proof the kill
		// table is not rebased onto the (wrong) reset timestamp.
		const run = find('Air Pure Medium - Challenge - 2026.09.18-18.42.43');
		expect(classify(run)).toBe('reset');
		expect(run.csv.kills).toHaveLength(1);
		expect(run.csv.kills[0]!.timestamp).toBe('18:42:39.762');
		expect(run.csv.settings.challengeStart).toBe('18:42:43.841');
	});
});

describe('the reset off-by-one', () => {
	// A reset file is stamped with the start of the attempt that FOLLOWS it, so
	// its label is shifted one position along the chain of attempts.
	it('gives a reset file the following completed run’s Challenge Start', () => {
		const pairs: [string, string][] = [
			['Air Pure Medium - Challenge - 2026.09.18-18.42.50', 'Air Pure Medium - Challenge - 2026.09.18-18.44.15'],
			['Air Voltaic Invincible 4 Medium - Challenge - 2026.09.18-18.05.10', 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.18-18.06.09'],
			['VT Aether Novice S5 Hard Bot 1 90% - Challenge - 2026.09.18-18.58.40', 'VT Aether Novice S5 Hard Bot 1 90% - Challenge - 2026.09.18-18.59.40'],
		];
		for (const [resetStem, completeStem] of pairs) {
			const reset = find(resetStem);
			const complete = find(completeStem);
			expect(classify(reset)).toBe('reset');
			expect(classify(complete)).toBe('complete');
			expect(reset.csv.settings.challengeStart).toBe(complete.csv.settings.challengeStart);
			// The reset holds strictly less play than the run that followed it.
			expect(reset.csv.totals.hitCount).toBeLessThan(complete.csv.totals.hitCount);
		}
	});

	it('makes (scenario, Challenge Start) unusable as a key', () => {
		const key = (run: Run) => `${run.csv.settings.hash}|${run.csv.settings.challengeStart}`;
		expect(new Set(runs.map(key)).size).toBeLessThan(runs.length);

		// Dropping partials first restores uniqueness.
		const complete = byKind('complete');
		expect(new Set(complete.map(key)).size).toBe(complete.length);
	});
});

// ---------------------------------------------------------------------------
// Joining a CSV to its .perf
// ---------------------------------------------------------------------------

describe('CSV/perf timestamp truncation', () => {
	it('truncates challenge_start_utc to the whole second', () => {
		for (const { file } of perfs) {
			expect(Number(file.header!.challengeStartUtc) % 1000).toBe(0);
		}
	});

	it('leaves a sub-second delta that spans nearly a full second', () => {
		const deltas = perfs.map((perf) => {
			const run = runs.find((r) => r.csv.settings.hash === perf.file.header!.scenarioHash
				&& Math.abs(Number(perf.file.header!.challengeStartUtc) - r.startedAt) <= 2_000);
			return Number(perf.file.header!.challengeStartUtc) - run!.startedAt;
		});
		// Truncation, plus a few ms of jitter between the two subsystems sampling
		// the clock. This is why no exact timestamp join exists.
		expect(Math.min(...deltas)).toBeGreaterThan(-1_000);
		expect(Math.max(...deltas)).toBeLessThanOrEqual(10);
		expect(deltas.some((d) => d <= -500)).toBe(true);
	});

	it('leaves 8 pairs whose filenames disagree by a second', () => {
		const perfStems = new Set(perfs.map((perf) => perf.stem));
		const skewed = byKind('complete').filter((run) => !perfStems.has(run.stem));
		// Every one of these that postdates 3.9.0 has a perf; it is just named
		// a second later.
		expect(skewed.length).toBeGreaterThanOrEqual(8);
		for (const run of skewed) {
			const match = perfs.find((perf) => perf.file.header!.scenarioHash === run.csv.settings.hash
				&& Math.abs(Number(perf.file.header!.challengeStartUtc) - run.startedAt) <= 2_000);
			// Pre-3.9.0 runs genuinely have none; everything else must match.
			if (run.csv.settings.gameVersion.startsWith('3.8')) expect(match).toBeUndefined();
			else expect(match, run.stem).toBeDefined();
		}
	});
});

describe('interval containment join', () => {
	// A run occupies [Challenge Start, write time]. A player cannot be inside two
	// completed runs at once, so containment picks a unique owner — no tolerance
	// constant tuned against how fast someone can press reset.
	const complete = byKind('complete');

	it('never overlaps two completed runs of the same scenario', () => {
		const byHash = new Map<string, Run[]>();
		for (const run of complete) byHash.set(run.csv.settings.hash, [...(byHash.get(run.csv.settings.hash) ?? []), run]);
		for (const group of byHash.values()) {
			const sorted = [...group].sort((a, b) => a.startedAt - b.startedAt);
			for (let i = 1; i < sorted.length; i++) {
				expect(sorted[i]!.startedAt, sorted[i]!.stem).toBeGreaterThan(sorted[i - 1]!.writtenAt + 999);
			}
		}
	});

	it('claims every perf exactly once', () => {
		const claims = new Map<string, string[]>();
		for (const perf of perfs) {
			const start = Number(perf.file.header!.challengeStartUtc);
			const owners = complete.filter((run) => run.csv.settings.hash === perf.file.header!.scenarioHash
				// -1000ms absorbs the known truncation; it is a property of the
				// format, not a guess about player behaviour.
				&& start >= run.startedAt - 1_000 && start <= run.writtenAt + 999);
			expect(owners.map((o) => o.stem), perf.name).toHaveLength(1);
			claims.set(owners[0]!.stem, [...(claims.get(owners[0]!.stem) ?? []), perf.name]);
		}
		expect(perfs).toHaveLength([...claims.values()].flat().length);
		for (const [stem, owned] of claims) expect(owned, stem).toHaveLength(1);
	});

	// Classification is a PREREQUISITE of the join, not an emergent property of
	// it. A reset file is stamped with the following attempt's start, so when
	// that attempt completed, the -1000ms truncation slack is enough for the
	// reset's degenerate interval to touch that attempt's perf. Filtering
	// partials out first is what makes the join sound — the interval alone does
	// not do it.
	const reachable = (run: Run) => perfs.filter((perf) => {
		const start = Number(perf.file.header!.challengeStartUtc);
		return perf.file.header!.scenarioHash === run.csv.settings.hash
			&& start >= run.startedAt - 1_000 && start <= run.writtenAt + 999;
	});

	it('has no perf-only runs: every perf is owned by a CSV', () => {
		// The containment the data model rests on. `.perf ⊆ .csv`, because the CSV
		// is written first and on strictly more events. See docs/ingest.md.
		const orphans = perfs.filter((perf) => !complete.some((run) => {
			const start = Number(perf.file.header!.challengeStartUtc);
			return run.csv.settings.hash === perf.file.header!.scenarioHash
				&& start >= run.startedAt - 1_000 && start <= run.writtenAt + 999;
		}));
		expect(orphans.map((perf) => perf.name)).toEqual([]);
	});

	it('would let a reset reach the following run’s perf if it were not filtered', () => {
		const reset = find('Air Pure Medium - Challenge - 2026.09.18-18.42.50');
		const sibling = find('Air Pure Medium - Challenge - 2026.09.18-18.44.15');
		expect(classify(reset)).toBe('reset');
		// It reaches exactly the perf belonging to the run that followed it.
		expect(reachable(reset).map((perf) => perf.stem)).toEqual([sibling.stem]);
	});

	it('assigns that perf to the completed run, not the reset', () => {
		// Because `complete` is the only pool the join draws from.
		const sibling = find('Air Pure Medium - Challenge - 2026.09.18-18.44.15');
		expect(byKind('complete')).toContain(sibling);
		expect(byKind('complete')).not.toContain(find('Air Pure Medium - Challenge - 2026.09.18-18.42.50'));
	});

	it('leaves the abort reaching nothing, having no scenario identity', () => {
		expect(reachable(byKind('abort')[0]!)).toHaveLength(0);
	});
});

describe('a joined pair agrees on every shared total', () => {
	it.each(curated.list('performances'))('%s matches its CSV', (perfName) => {
		const perf = readPerf(perfName);
		const start = Number(perf.file.header!.challengeStartUtc);
		const run = byKind('complete').find((r) => r.csv.settings.hash === perf.file.header!.scenarioHash
			&& start >= r.startedAt - 1_000 && start <= r.writtenAt + 999);
		expect(run, perfName).toBeDefined();

		const { events } = perf.file;
		const { totals, weapons, settings } = run!.csv;
		expect(sumOf(events, 'shotsFired')).toBe(weapons.reduce((a, w) => a + w.shots, 0));
		expect(sumOf(events, 'shotsHit')).toBe(totals.hitCount);
		expect(sumOf(events, 'shotsMissed')).toBe(totals.missCount);
		expect(sumOf(events, 'kills')).toBe(totals.kills);
		expect(sumOf(events, 'reloads')).toBe(totals.reloads);
		expect(sumOf(events, 'pauseCount')).toBe(totals.pauseCount);
		expect(sumOf(events, 'damageDone')).toBeCloseTo(totals.damageDone, 1);
		expect(sumOf(events, 'score')).toBeCloseTo(totals.score, 1);
		expect(perf.file.header!.scenarioName).toBe(settings.scenario);
	});
});

// ---------------------------------------------------------------------------
// Documented quirks
// ---------------------------------------------------------------------------

describe('rare event types are represented', () => {
	it.each([
		['Horizontal Bounce Dodge', 'mbsPoints'],
		['Floating Heads Timing Novice', 'pauseCount'],
		['1w2ts reload smallflicks larger', 'reloads'],
		['VT Quadpulse Intermediate', 'playerDamageTaken'],
		['Air Spectral Easy', 'distanceTraveled'],
		['Aimerz+ Week #5 - Static Switching - Challenge - 2026.06.13-15.56.51', 'overshots'],
	] as [string, PayloadCase][])('%s carries %s', (fragment, payload) => {
		expect(eventsOf(findPerf(fragment).file.events, payload).length).toBeGreaterThan(0);
	});
});

describe('overshots closes itself out', () => {
	const perf = findPerf('Aimerz+ Week #5 - Static Switching - Challenge - 2026.06.13-15.56.51');
	const counts = eventsOf(perf.file.events, 'overshots');

	it('ends with a negative event cancelling the run', () => {
		expect(counts.length).toBeGreaterThan(1);
		expect(counts.at(-1)!).toBeLessThan(0);
		expect(counts.filter((count) => count < 0)).toHaveLength(1);
		expect(counts.at(-1)).toBe(-counts.slice(0, -1).reduce((a, b) => a + b, 0));
	});

	it('means a naive sum reports zero overshots', () => {
		// The trap this fixture exists to pin down.
		expect(counts.reduce((a, b) => a + b, 0)).toBe(0);
		expect(counts.slice(0, -1).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
	});
});

describe('challenge profile edge cases', () => {
	it('uses 1000.0 as the no-time-limit sentinel', () => {
		expect(findPerf('Air CELESTIAL No UFO Easier').file.header!.challengeProfile!.timeLimit).toBe(1_000);
	});

	it('scales real duration by timescale', () => {
		const perf = findPerf('Aimerz+ Week #5 - Static Switching - Challenge - 2026.06.13-15.56.51');
		const profile = perf.file.header!.challengeProfile!;
		expect(profile.timescale).not.toBe(1);
		// time_limit is in scenario seconds; divide by timescale for real seconds.
		expect(perf.file.events.at(-1)!.timestamp).toBeCloseTo(profile.timeLimit / profile.timescale, 0);
	});

	it('can end a challenge early on a kill count', () => {
		const perf = findPerf('VT Air Novice');
		const profile = perf.file.header!.challengeProfile!;
		expect(profile.endChallengeAfterKills).toBeGreaterThan(0);
		// So duration cannot be assumed from the time limit.
		expect(perf.file.events.at(-1)!.timestamp).toBeLessThan(profile.timeLimit / profile.timescale);
	});

	it('puts the player on team 2 when bots shoot back', () => {
		const perf = findPerf('FuglaaXYZ Voltaic No Blinks Intermediate');
		expect(perf.file.header!.challengeProfile!.playerTeam).toBe(2);
	});

	it('packs bot arrays in step with added_bots', () => {
		for (const { name, file } of perfs) {
			const profile = file.header!.challengeProfile!;
			expect(profile.botMaxLives.length, name).toBe(profile.addedBots.length);
			expect(profile.botTeams.length, name).toBe(profile.addedBots.length);
		}
		expect(findPerf('VT 1w3ts Intermediate S5 Clusters').file.header!.challengeProfile!.addedBots.length).toBeGreaterThanOrEqual(10);
	});

	it('names maps as .json or .map', () => {
		expect(findPerf('1w2ts Perfected - Challenge - 2026.06.22-18.54.05').file.header!.challengeProfile!.mapName).toMatch(/\.map$/);
		for (const { name, file } of perfs) {
			expect(file.header!.challengeProfile!.mapName, name).toMatch(/\.(json|map)$/);
		}
	});

	it('distinguishes shots_fired from damage_possible on projectile weapons', () => {
		const { events } = findPerf('CG Adjust Click Micro 2T Easy Small').file;
		expect(sumOf(events, 'shotsFired')).not.toBe(sumOf(events, 'damagePossible'));
	});
});

describe('runs with no .perf at all', () => {
	it('keeps pre-3.9.0 CSVs, which predate the format', () => {
		const legacy = runs.filter((run) => run.csv.settings.gameVersion.startsWith('3.8'));
		expect(legacy.length).toBeGreaterThanOrEqual(2);
		const perfStems = new Set(perfs.map((perf) => perf.stem));
		for (const run of legacy) {
			expect(perfStems.has(run.stem), run.stem).toBe(false);
			// Still complete, valid runs: a missing .perf is not a validity signal.
			expect(classify(run)).toBe('complete');
			expect(run.csv.settings.averageFps).toBeGreaterThan(0);
		}
	});

	it('records a pause duration the .perf cannot express', () => {
		const run = find('Controlsphere rAim Easy 90%');
		expect(run.csv.totals.pauseDuration).toBeGreaterThan(0);
	});
});

describe('reroll chains', () => {
	const chain = runs
		.filter((run) => run.stem.startsWith('VT Aether Intermediate S5') && classify(run) === 'reset')
		.sort((a, b) => a.writtenAt - b.writtenAt);

	it('captures a player rerolling a seed nine times', () => {
		expect(chain.length).toBeGreaterThanOrEqual(9);
	});

	it('never puts two writes in the same second', () => {
		// The gap floor is what makes filename-as-key survive: a reset reloads
		// the scenario, which appears to rate-limit how fast files can appear.
		// Tightest observed here is 2s. Not a proof — see docs/ingest.md.
		const gaps = chain.slice(1).map((run, i) => run.writtenAt - chain[i]!.writtenAt);
		expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1_000);
		expect(new Set(runs.map((run) => run.stem)).size).toBe(runs.length);
	});

	it('separates seed rejection from abandoning a run in progress', () => {
		// A reroll: nothing accumulated, no engagement finished.
		const reject = find('VT Aether Intermediate S5 - Challenge - 2026.09.18-19.09.19');
		expect(reject.csv.totals.hitCount).toBe(0);
		expect(reject.csv.totals.fightTimeSeconds).toBe(0);

		// An abandon: 19s of engagement and a completed kill before quitting.
		const abandon = find('VT Ground Intermediate S5 - Challenge - 2026.09.18-19.26.04');
		expect(classify(abandon)).toBe('reset');
		expect(abandon.csv.totals.hitCount).toBeGreaterThan(1_000);
		expect(abandon.csv.totals.fightTimeSeconds).toBeGreaterThan(18);
		expect(abandon.csv.totals.kills).toBe(1);
	});
});
