/**
 * KovaaK's `... Stats.csv` — the companion file written alongside every `.perf`.
 *
 * `parseStatsCsv` is at the bottom of this file; the types and their field
 * documentation come first. Every field, column and key below was measured
 * across all 2449 files in `test/fixtures/raw/stats/`.
 *
 * ## Provenance — read this before trusting a comment
 *
 * Unlike `proto/perf.proto`, **none of this is vendor-documented.** KovaaK's
 * wiki says the CSV format "is documented separately", but no such page exists:
 * the wiki has 33 pages and none of them covers it. Meanings below are inferred
 * from the data, from the `.perf` fields they line up with, and from the wiki's
 * adjacent pages (Custom Sensitivity Scales, Character/Bot/Weapon Profiles).
 *
 * Confidence labels:
 * - `[cross-checked]` — equals a `.perf` field we validated across the corpus;
 *   see `src/lib/parse/perf.test.ts` and `proto/perf.proto`.
 * - `[measured]` — shape/range measured across all 2449 files, meaning inferred
 *   from the name and context. Reasonable, not proven.
 * - `[unknown]` — constant in our corpus, so it carries no information here.
 *
 * ## File layout
 *
 * Three sections separated by blank lines. All 2449 files share byte-identical
 * header rows, so there are no format variants to negotiate:
 *
 * ```
 * Kill #,Timestamp,Bot,Weapon,TTK,Shots,...     <- per-kill table, may be empty
 * <rows>
 *                                                <- blank
 * Weapon,Shots,Hits,Damage Done,...              <- per-weapon table
 * <rows>
 *                                                <- blank
 * Kills:,70                                      <- `Key:,value` block
 * ...
 * ```
 *
 * Caveat on the per-weapon header: it advertises 18 columns, but every data row
 * in the corpus has exactly 6 cells (5 values plus a trailing empty one). The
 * settings columns it names — `Sens Scale`, `FOV`, `Crosshair`, … — are never
 * filled in; those values appear only in the `Key:,value` block. Parse the
 * weapon rows positionally against the first five names, not against the header.
 */

/**
 * One row of the per-kill table — one target engagement that ended in the
 * target's destruction.
 *
 * Absent entirely in 1129 of 2449 files: tracking scenarios score continuous
 * damage rather than kills, so the section is empty and the file jumps straight
 * to the weapon table. An empty kill table is normal, not a parse failure.
 *
 * Row count usually equals `RunTotals.kills`, but not always — see `index`.
 * Destructible targets produce rows without incrementing the kill counter.
 */
export interface KillRow {
	/**
	 * `Kill #` — 1-based index within the run in 1314 of the 1320 files that
	 * have kill rows.
	 *
	 * The exception is destructible-target scenarios, where every row is
	 * numbered `0` and `Kills:` stays 0 — the only case in this corpus is
	 * "Happy Easter!" (6 files), whose targets are `Egg` rather than a bot. So
	 * this is not a reliable unique key; use the array position instead.
	 * [measured]
	 */
	index: number;

	/**
	 * `Timestamp` — local wall-clock time of day, `HH:MM:SS.mmm`, no date
	 * component. Compare against the `Challenge Start` key to get an offset into
	 * the run; the date has to come from `challenge_start_utc` in the `.perf` or
	 * from the filename. [measured]
	 */
	timestamp: string;

	/**
	 * `Bot` — the bot profile instance killed, e.g. `air1_far_short`, `target`.
	 * 124 distinct values in the corpus. Relates to `added_bots` in the `.perf`
	 * challenge profile, but is an instance name rather than the `.bot` filename.
	 * [measured]
	 */
	bot: string;

	/** `Weapon` — weapon used for the kill; 18 distinct values. [measured] */
	weapon: string;

	/**
	 * `TTK` — time to kill. Written with a trailing `s` (`0.444000s`) in every
	 * row, so strip the suffix before parsing. `0.000000s` is common and means
	 * the target died to a single shot rather than that no time elapsed.
	 * [measured]
	 */
	timeToKillSeconds: number;

	/** `Shots` — shots fired at this target. [measured] */
	shots: number;

	/** `Hits` — shots that connected with it. [measured] */
	hits: number;

	/** `Accuracy` — `hits / shots` for this kill. [measured] */
	accuracy: number;

	/** `Damage Done` — damage dealt to this target. [measured] */
	damageDone: number;

	/**
	 * `Damage Possible` — damage the shots fired could have dealt. The
	 * denominator of `efficiency`, mirroring `DamagePossible` in the `.perf`.
	 * [measured]
	 */
	damagePossible: number;

	/** `Efficiency` — `damageDone / damagePossible`. [measured] */
	efficiency: number;

	/** `Cheated` — 0 in every row we have; presumably an anti-cheat flag. [unknown] */
	cheated: number;

	/**
	 * `OverShots` — shots in the post-kill grace window; see `Overshots` in
	 * `proto/perf.proto` for the full definition. [measured]
	 */
	overShots: number;
}

/**
 * One row of the per-weapon table. 1 row in 2443 files, 2 in the remaining 6.
 *
 * A weapon can appear with all-zero counts (it was available but unused), so
 * do not treat presence as evidence that it was fired.
 */
export interface WeaponRow {
	/** `Weapon` — e.g. `pistol`, `LG`, `Track Master 100`. [measured] */
	weapon: string;

	/** `Shots` — sums across rows to the `.perf` `shots_fired` total. [cross-checked] */
	shots: number;

	/** `Hits` — sums across rows to `Hit Count:` and to `.perf` `shots_hit`. [cross-checked] */
	hits: number;

	/** `Damage Done` — sums to `Damage Done:` and to `.perf` `damage_done`. [cross-checked] */
	damageDone: number;

	/** `Damage Possible` — sums to `.perf` `damage_possible`. [cross-checked] */
	damagePossible: number;
}

/**
 * The trailing `Key:,value` block: 42 keys, all present in all 2449 files.
 *
 * Grouped below for readability; the file itself is flat and ordered
 * totals-then-settings. The split into `RunTotals` / `RunSettings` is ours.
 */
export interface RunTotals {
	/** `Kills:` — equals `.perf` `kills` summed. [cross-checked] */
	kills: number;

	/** `Deaths:` — 0 in every file here, and `.perf` never emits the event. [unknown] */
	deaths: number;

	/** `Fight Time:` — seconds spent in combat, well under the run duration. [measured] */
	fightTimeSeconds: number;

	/** `Time Remaining:` — seconds left on the clock; 0.0 for a run played out. [measured] */
	timeRemainingSeconds: number;

	/** `Avg TTK:` — mean of the kill table's TTK column. [measured] */
	averageTimeToKillSeconds: number;

	/** `Damage Done:` — equals `.perf` `damage_done` summed. [cross-checked] */
	damageDone: number;

	/**
	 * `Total Overshots:` — equals the sum of the POSITIVE `.perf` `overshots`
	 * increments. Summing the raw `.perf` events naively yields 0, because each
	 * run ends with a negative event that zeroes the counter. [cross-checked]
	 */
	totalOvershots: number;

	/** `Damage Taken:` — equals `.perf` `player_damage_taken` summed. [cross-checked] */
	damageTaken: number;

	/** `Hit Count:` — equals `.perf` `shots_hit` summed. [cross-checked] */
	hitCount: number;

	/** `Miss Count:` — equals `.perf` `shots_missed` summed. [cross-checked] */
	missCount: number;

	/** `Midairs:` — projectile kills on airborne targets. 0 throughout. [unknown] */
	midairs: number;

	/** `Midaired:` — the same done to the player. 0 throughout. [unknown] */
	midaired: number;

	/** `Directs:` — direct projectile hits. 0 throughout. [unknown] */
	directs: number;

	/** `Directed:` — the same done to the player. 0 throughout. [unknown] */
	directed: number;

	/** `Reloads:` — equals `.perf` `reloads` summed. [cross-checked] */
	reloads: number;

	/**
	 * `Distance Traveled:` — equals `.perf` `distance_traveled` summed. The
	 * vendor describes that field as "points awarded for distance the player
	 * moved" rather than a distance, and the values here are tiny (1e-6), which
	 * is consistent with points rather than metres. [cross-checked]
	 */
	distanceTraveled: number;

	/** `MBS Points:` — Movement Based Scoring; equals `.perf` `mbs_points`. [cross-checked] */
	mbsPoints: number;

	/**
	 * `Score:` — the value posted to the leaderboard, equal to `.perf` `score`
	 * summed. This is the headline number for tracking progress. [cross-checked]
	 */
	score: number;

	/** `Pause Count:` — equals `.perf` `pause_count` summed. [cross-checked] */
	pauseCount: number;

	/**
	 * `Pause Duration:` — has NO representation in the `.perf`. If you need it,
	 * the CSV is the only source. Units unclear: observed 0, 10, 25, 90 in the
	 * three files that pause at all. [measured]
	 */
	pauseDuration: number;
}

/** Scenario identity and the client configuration a run was played under. */
export interface RunSettings {
	/** `Scenario:` — equals `.perf` `scenario_name`. [cross-checked] */
	scenario: string;

	/**
	 * `Hash:` — equals `.perf` `scenario_hash`, which the vendor describes as
	 * identifying "the scenario at the exact version that produced this run".
	 * Group runs by this, not by name, or an edited scenario silently pollutes
	 * a progress curve. [cross-checked]
	 */
	hash: string;

	/** `Game Version:` — e.g. `3.9.5.2026-07-06-16-10-18-f12d73508953`. [measured] */
	gameVersion: string;

	/**
	 * `Challenge Start:` — local wall-clock time of day, `HH:MM:SS.mmm`, no date.
	 * The `.perf` `challenge_start_utc` is the same instant with a date attached;
	 * note the FILENAME timestamp is neither — it is the write/end time. [measured]
	 */
	challengeStart: string;

	/** `Avg Target Scale:` — 1.0 throughout, so no target-scaling runs here. [unknown] */
	averageTargetScale: number;

	/** `Avg Time Dilation:` — 1.0 throughout. Relates to `.perf` `timescale`. [unknown] */
	averageTimeDilation: number;

	/** `Input Lag:` — configured artificial input delay; 0 throughout. [unknown] */
	inputLag: number;

	/** `Max FPS (config):` — the configured cap (999.0 or 1000.0), not achieved FPS. [measured] */
	maxFpsConfig: number;

	/**
	 * `Sens Scale:` — the named sensitivity scale, e.g. `The FINALS`, `cm/360`,
	 * `Overwatch`. Per the wiki's Custom Sensitivity Scales page, each scale
	 * carries an `IncrementFormula` over the user's Sens and FOV. Raw
	 * `Horiz Sens` is therefore NOT comparable across different scales —
	 * use `sensIncrement` for that. [measured]
	 */
	sensScale: string;

	/**
	 * `Sens Increment:` — degrees the player rotates per single mouse pixel,
	 * resolved from the scale's formula. This is the scale-independent
	 * sensitivity, and the right field to detect that a player changed sens
	 * between runs. [measured]
	 */
	sensIncrement: number;

	/** `Horiz Sens:` — raw in-game value, meaningful only alongside `sensScale`. [measured] */
	horizontalSens: number;

	/** `Vert Sens:` — as above. Equal to `horizontalSens` in every file here. [measured] */
	verticalSens: number;

	/** `DPI:` — mouse DPI as configured in-game. `sensIncrement` already folds this in. [measured] */
	dpi: number;

	/** `FOV:` — field of view, in the units of `fovScale`. [measured] */
	fov: number;

	/** `FOVScale:` — named FOV scale, e.g. `The FINALS`, `Overwatch`. [measured] */
	fovScale: string;

	/** `Hide Gun:` — `false` throughout; `"true"`/`"false"` text. [unknown] */
	hideGun: boolean;

	/** `Crosshair:` — crosshair image filename, e.g. `blank.png`. [measured] */
	crosshair: string;

	/** `Crosshair Scale:` — size multiplier. [measured] */
	crosshairScale: number;

	/** `Crosshair Color:` — 8 hex digits, RGBA, e.g. `010101FF`. [measured] */
	crosshairColor: string;

	/** `Resolution:` — `WIDTHxHEIGHT`, e.g. `3440x1440`. [measured] */
	resolution: string;

	/**
	 * `Avg FPS:` — mean frames per second actually achieved. Worth keeping: a
	 * big drop is a plausible confound when a score regresses. [measured]
	 */
	averageFps: number;

	/** `Resolution Scale:` — render scale percentage; 100.0 throughout. [unknown] */
	resolutionScale: number;
}

/** A parsed `... Stats.csv`. */
export interface StatsCsv {
	/** Per-kill table. Empty for tracking scenarios (1129 of 2449 files). */
	kills: KillRow[];
	/** Per-weapon table. 1 row usually, 2 occasionally; never 0. */
	weapons: WeaponRow[];
	totals: RunTotals;
	settings: RunSettings;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Thrown when the input does not look like a Stats.csv we know how to read. */
export class StatsCsvError extends Error {
	override readonly name = 'StatsCsvError';
}

const KILL_HEADER = 'Kill #,Timestamp,Bot,Weapon,TTK,Shots,Hits,Accuracy,Damage Done,Damage Possible,Efficiency,Cheated,OverShots';
const WEAPON_HEADER_PREFIX = 'Weapon,Shots';

/**
 * Parses a `... Stats.csv`.
 *
 * Deliberately strict: a missing section or key throws rather than yielding a
 * record full of `NaN`. These files feed a long-running history, so a KovaaK's
 * update that renames a key should fail loudly at ingest rather than quietly
 * poison the data. Unknown *extra* keys are ignored, which keeps us
 * forward-compatible with versions that only add fields.
 *
 * No quote handling: no file in the corpus contains a `"`, and every row splits
 * to a fixed cell count, so fields cannot contain commas. Values in the
 * `Key:,value` block take the rest of the line, so commas there are fine.
 *
 * @throws {StatsCsvError}
 */
export function parseStatsCsv(text: string): StatsCsv {
	const lines = text.split(/\r?\n/);

	const killHeader = lines.findIndex((line) => line.startsWith('Kill #,'));
	const weaponHeader = lines.findIndex((line) => line.startsWith(WEAPON_HEADER_PREFIX));
	if (killHeader < 0) throw new StatsCsvError('no kill table header');
	if (weaponHeader < killHeader) throw new StatsCsvError('no weapon table header');
	if (lines[killHeader] !== KILL_HEADER) {
		throw new StatsCsvError(`unexpected kill table columns: ${lines[killHeader]}`);
	}

	const afterWeaponHeader = lines.slice(weaponHeader + 1);
	const keyValues = parseKeyValues(afterWeaponHeader);

	return {
		kills: parseKillRows(lines.slice(killHeader + 1, weaponHeader)),
		weapons: parseWeaponRows(takeUntilBlank(afterWeaponHeader)),
		totals: parseTotals(keyValues),
		settings: parseSettings(keyValues),
	};
}

function takeUntilBlank(lines: string[]): string[] {
	const end = lines.findIndex((line) => line.trim() === '');
	return end < 0 ? lines : lines.slice(0, end);
}

function parseKillRows(lines: string[]): KillRow[] {
	// Tracking scenarios have no kills at all, leaving the section empty.
	return takeUntilBlank(lines).map((line, index) => {
		const cells = line.split(',');
		if (cells.length !== 13) {
			throw new StatsCsvError(`kill row ${index + 1}: expected 13 cells, got ${cells.length}`);
		}
		const at = (column: number, label: string) => number(cells[column]!, `kill row ${index + 1} ${label}`);
		return {
			index: at(0, 'index'),
			timestamp: cells[1]!,
			bot: cells[2]!,
			weapon: cells[3]!,
			timeToKillSeconds: number(
				stripSuffix(cells[4]!, 's'),
				`kill row ${index + 1} TTK`,
			),
			shots: at(5, 'Shots'),
			hits: at(6, 'Hits'),
			accuracy: at(7, 'Accuracy'),
			damageDone: at(8, 'Damage Done'),
			damagePossible: at(9, 'Damage Possible'),
			efficiency: at(10, 'Efficiency'),
			cheated: at(11, 'Cheated'),
			overShots: at(12, 'OverShots'),
		};
	});
}

function parseWeaponRows(lines: string[]): WeaponRow[] {
	if (lines.length === 0) throw new StatsCsvError('weapon table is empty');
	return lines.map((line, index) => {
		// The header advertises 18 columns but rows only ever fill the first five
		// (plus a trailing empty cell), so read positionally rather than by header.
		const cells = line.split(',');
		if (cells.length < 5) {
			throw new StatsCsvError(`weapon row ${index + 1}: expected 5 values, got ${cells.length}`);
		}
		const at = (column: number, label: string) =>
			number(cells[column]!, `weapon row ${index + 1} ${label}`);
		return {
			weapon: cells[0]!,
			shots: at(1, 'Shots'),
			hits: at(2, 'Hits'),
			damageDone: at(3, 'Damage Done'),
			damagePossible: at(4, 'Damage Possible'),
		};
	});
}

/** Reads the trailing `Key:,value` block. Lines outside that shape are skipped. */
function parseKeyValues(lines: string[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const line of lines) {
		const at = line.indexOf(':,');
		// A key never contains a comma; this also rejects the tables above, whose
		// rows can carry a `:` inside a timestamp but never the `:,` pair.
		if (at > 0 && !line.slice(0, at).includes(',')) out.set(line.slice(0, at), line.slice(at + 2));
	}
	return out;
}

function parseTotals(kv: Map<string, string>): RunTotals {
	const n = (key: string) => number(required(kv, key), key);
	return {
		kills: n('Kills'),
		deaths: n('Deaths'),
		fightTimeSeconds: n('Fight Time'),
		timeRemainingSeconds: n('Time Remaining'),
		averageTimeToKillSeconds: n('Avg TTK'),
		damageDone: n('Damage Done'),
		totalOvershots: n('Total Overshots'),
		damageTaken: n('Damage Taken'),
		hitCount: n('Hit Count'),
		missCount: n('Miss Count'),
		midairs: n('Midairs'),
		midaired: n('Midaired'),
		directs: n('Directs'),
		directed: n('Directed'),
		reloads: n('Reloads'),
		distanceTraveled: n('Distance Traveled'),
		mbsPoints: n('MBS Points'),
		score: n('Score'),
		pauseCount: n('Pause Count'),
		pauseDuration: n('Pause Duration'),
	};
}

function parseSettings(kv: Map<string, string>): RunSettings {
	const n = (key: string) => number(required(kv, key), key);
	const s = (key: string) => required(kv, key);
	return {
		scenario: s('Scenario'),
		hash: s('Hash'),
		gameVersion: s('Game Version'),
		challengeStart: s('Challenge Start'),
		averageTargetScale: n('Avg Target Scale'),
		averageTimeDilation: n('Avg Time Dilation'),
		inputLag: n('Input Lag'),
		maxFpsConfig: n('Max FPS (config)'),
		sensScale: s('Sens Scale'),
		sensIncrement: n('Sens Increment'),
		horizontalSens: n('Horiz Sens'),
		verticalSens: n('Vert Sens'),
		dpi: n('DPI'),
		fov: n('FOV'),
		fovScale: s('FOVScale'),
		hideGun: boolean(s('Hide Gun'), 'Hide Gun'),
		crosshair: s('Crosshair'),
		crosshairScale: n('Crosshair Scale'),
		crosshairColor: s('Crosshair Color'),
		resolution: s('Resolution'),
		averageFps: n('Avg FPS'),
		resolutionScale: n('Resolution Scale'),
	};
}

function required(kv: Map<string, string>, key: string): string {
	const value = kv.get(key);
	if (value === undefined) throw new StatsCsvError(`missing key "${key}:"`);
	return value;
}

function number(raw: string, label: string): number {
	const value = Number(raw);
	if (!Number.isFinite(value)) throw new StatsCsvError(`${label}: expected a number, got "${raw}"`);
	return value;
}

function boolean(raw: string, label: string): boolean {
	if (raw === 'true') return true;
	if (raw === 'false') return false;
	throw new StatsCsvError(`${label}: expected true or false, got "${raw}"`);
}

function stripSuffix(raw: string, suffix: string): string {
	return raw.endsWith(suffix) ? raw.slice(0, -suffix.length) : raw;
}
