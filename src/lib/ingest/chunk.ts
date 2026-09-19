/**
 * The pure half of ingest: files in, COPY payloads out.
 *
 * Nothing here touches the database or the DOM, which is what lets it run in a
 * worker and be tested by importing it directly. Column order in each `row()`
 * call is the column order in `src/db/sql/0006_stage.sql`; they have to be read
 * together.
 */
import { parsePerf, TICK_METRICS } from '../parse/perf';
import { parseStatsCsv, type StatsCsv } from '../parse/stats-csv';
import { classify, clockToMs, fileStem, isPerf, isStats } from './classify';
import { CopyWriter } from './copy';

export const STAGE_TABLES = [
	'stage_run',
	'stage_kill',
	'stage_weapon',
	'stage_perf',
	'stage_tick',
	'stage_unattributed',
] as const;

export type StageTable = (typeof STAGE_TABLES)[number];

export interface InputFile {
	name: string;
	bytes: Uint8Array;
}

export interface ChunkResult {
	payloads: Record<StageTable, Uint8Array<ArrayBuffer>>;
	failures: { name: string; error: string }[];
	csvStems: string[];
	perfStems: string[];
}

/**
 * `run.extra` — only what is non-default, so it costs nothing on a normal run.
 *
 * `raw` holds the two values a reset discards. They are kept because they are
 * the evidence for the classification, not because anything reads them.
 */
function buildExtra(csv: StatsCsv, kind: string): Record<string, unknown> {
	const extra: Record<string, unknown> = {};
	const totals = csv.totals;
	const counters = {
		deaths: totals.deaths,
		midairs: totals.midairs,
		midaired: totals.midaired,
		directs: totals.directs,
		directed: totals.directed,
	};
	for (const [key, value] of Object.entries(counters)) if (value !== 0) extra[key] = value;
	// Per-run measurements, not settings: putting a measurement in a dimension
	// key is how a dimension explodes, so they live here instead of in `config`.
	if (csv.settings.averageTargetScale !== 1) extra.averageTargetScale = csv.settings.averageTargetScale;
	if (csv.settings.averageTimeDilation !== 1) extra.averageTimeDilation = csv.settings.averageTimeDilation;
	if (kind === 'reset') {
		extra.raw = { challengeStart: csv.settings.challengeStart, avgFps: csv.settings.averageFps };
	}
	return extra;
}

export function buildChunk(files: InputFile[]): ChunkResult {
	const writers = Object.fromEntries(STAGE_TABLES.map((t) => [t, new CopyWriter()])) as Record<StageTable, CopyWriter>;
	const failures: ChunkResult['failures'] = [];
	const csvStems: string[] = [];
	const perfStems: string[] = [];
	const decoder = new TextDecoder();

	for (const file of files) {
		try {
			if (isStats(file.name)) {
				addStats(writers, file, decoder.decode(file.bytes));
				csvStems.push(fileStem(file.name));
			} else if (isPerf(file.name)) {
				addPerf(writers, file);
				perfStems.push(fileStem(file.name));
			}
		} catch (err) {
			failures.push({ name: file.name, error: err instanceof Error ? err.message : String(err) });
		}
	}

	const payloads = Object.fromEntries(
		STAGE_TABLES.map((t) => [t, writers[t].bytes()]),
	) as Record<StageTable, Uint8Array<ArrayBuffer>>;
	return { payloads, failures, csvStems, perfStems };
}

function addStats(writers: Record<StageTable, CopyWriter>, file: InputFile, text: string): void {
	const csv = parseStatsCsv(text);
	const stem = fileStem(file.name);
	const timing = classify(file.name, csv);

	// An abort has no scenario identity, so it cannot become a run. The whole
	// parsed document goes to the payload, not just the key/value block: the one
	// abort in the dump has an empty kill table but a real weapon row.
	if (timing.kind === 'abort') {
		writers.stage_unattributed.row([stem, timing.writtenAt, JSON.stringify(csv)]);
		return;
	}

	const t = csv.totals;
	const s = csv.settings;
	// Not from the key/value block: run.shots and run.damage_possible are the
	// sum of the weapon table.
	const shots = csv.weapons.reduce((sum, w) => sum + w.shots, 0);
	const damagePossible = csv.weapons.reduce((sum, w) => sum + w.damagePossible, 0);
	// Nulled for a reset, and only these two: `Avg FPS` is uninitialised memory
	// that would poison any average, and `Challenge Start` is the *next*
	// attempt's, which is actively wrong for ordering and for `span`. Everything
	// else survives — Score is non-zero in 16 of 21 resets.
	const avgFps = timing.kind === 'complete' ? s.averageFps : null;

	writers.stage_run.row([
		stem, s.hash, s.scenario, s.gameVersion, timing.kind,
		timing.startedAt, timing.startMs, timing.writtenAt, timing.durationS,
		t.score, t.kills, t.hitCount, t.missCount, shots, t.damageDone, damagePossible,
		t.damageTaken, t.totalOvershots, t.reloads, t.distanceTraveled, t.mbsPoints,
		t.fightTimeSeconds, t.timeRemainingSeconds, t.averageTimeToKillSeconds,
		t.pauseCount, t.pauseDuration, avgFps, JSON.stringify(buildExtra(csv, timing.kind)),
		s.sensScale, s.sensIncrement, s.horizontalSens, s.verticalSens, s.dpi, s.fov,
		s.fovScale, s.hideGun, s.crosshair, s.crosshairScale, s.crosshairColor,
		s.resolution, s.resolutionScale, s.maxFpsConfig, s.inputLag,
	]);

	for (const weapon of csv.weapons) {
		writers.stage_weapon.row([
			stem, weapon.weapon.trim(), weapon.shots, weapon.hits, weapon.damageDone, weapon.damagePossible,
		]);
	}

	csv.kills.forEach((kill, idx) => {
		const atMs = clockToMs(kill.timestamp);
		if (atMs === null) throw new Error(`kill ${idx} has an unreadable timestamp: ${kill.timestamp}`);
		// Trimmed here, not in SQL: the dump contains both " speedswitch " and
		// "speedswitch" alternating within one file, and bot_name_trimmed exists
		// to catch an ingester that forgot rather than to be worked around.
		writers.stage_kill.row([
			stem, idx, atMs, kill.bot.trim(), kill.weapon.trim(), kill.timeToKillSeconds,
			kill.shots, kill.hits, kill.damageDone, kill.damagePossible, kill.overShots, kill.cheated,
		]);
	});
}

function addPerf(writers: Record<StageTable, CopyWriter>, file: InputFile): void {
	const { header, ticks } = parsePerf(file.bytes);
	const stem = fileStem(file.name);

	writers.stage_perf.row([
		stem, header.scenarioHash, header.schemaVersion, new Date(header.challengeStartUtcMs),
		header.timeLimit, header.timescale, header.mapName, header.mapScale,
		header.playerProfile, header.playerTeam, header.playerMaxLives,
		header.endChallengeAfterKills, header.endChallengeAfterDamage,
		JSON.stringify(header.addedBots),
		header.botMaxLives === null ? null : JSON.stringify(header.botMaxLives),
		header.botTeams === null ? null : JSON.stringify(header.botTeams),
	]);

	ticks.t.forEach((t, idx) => {
		writers.stage_tick.row([
			stem, idx, t, ...TICK_METRICS.map((key) => ticks.metrics[key]?.[idx] ?? null),
		]);
	});
}
