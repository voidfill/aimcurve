/**
 * Queries for the scenario page (S8 of its design).
 * See docs/superpowers/specs/2026-09-25-scenario-page-design.md.
 */
import type { PGliteInterface } from '@electric-sql/pglite';
import type { SensConfig } from './config';
import type { ScenarioVersion } from './link';

export interface Scenario {
	id: number;
	name: string;
	hash: string;
}

/** One completed run of the scenario, as the page needs it. */
export interface HistoryRun {
	id: number;
	fileStem: string;
	score: number | null;
	/** Normalized ISO timestamp, so string order is chronological order. */
	startedAt: string;
	durationS: number;
	hasPerf: boolean;
	/** The best score before this run; null for the first. */
	pbBefore: number | null;
	/** `run_session`'s session id. */
	session: number;
	config: SensConfig;
}

export async function getScenario(pg: PGliteInterface, hash: string): Promise<Scenario | null> {
	const result = await pg.query<Scenario>(`select id, name, hash from scenario where hash = $1::text`, [hash]);
	return result.rows[0] ?? null;
}

/** Every version with completed runs that shares `name`, the given one included. */
export async function listVersions(pg: PGliteInterface, name: string): Promise<ScenarioVersion[]> {
	const result = await pg.query<{ id: number; hash: string; runs: number; last_played: string }>(
		`
		select s.id, s.hash, count(*)::integer as runs, max(r.started_at) as last_played
		from scenario s
		join run_complete r on r.scenario_id = s.id
		where s.name = $1::text
		group by s.id, s.hash
		order by max(r.started_at) desc
		`,
		[name],
	);
	return result.rows.map((row) => ({
		id: row.id,
		hash: row.hash,
		runs: row.runs,
		lastPlayed: new Date(row.last_played).toISOString(),
	}));
}

/**
 * Every completed run of one scenario, oldest first. `run_progress` is a
 * window view partitioned by scenario, so it is filtered on `scenario_id`,
 * which pushes the filter down. `run_session` windows over every run, which
 * is a single pass over the table.
 */
export async function listHistory(pg: PGliteInterface, scenarioId: number): Promise<HistoryRun[]> {
	const result = await pg.query<{
		id: number;
		file_stem: string;
		score: number | null;
		started_at: string;
		duration_s: number;
		has_perf: boolean;
		pb_before: number | null;
		session_id: number;
		sens_scale: string;
		horiz_sens: number;
		vert_sens: number;
		dpi: number;
		fov: number;
		fov_scale: string;
	}>(
		`
		select p.id, p.file_stem, p.score, p.started_at, p.duration_s, p.has_perf, p.pb_before,
		       s.session_id::integer as session_id,
		       c.sens_scale, c.horiz_sens, c.vert_sens, c.dpi, c.fov, c.fov_scale
		from run_progress p
		join config c on c.id = p.config_id
		join run_session s on s.id = p.id
		where p.scenario_id = $1::integer
		order by p.started_at, p.id
		`,
		[scenarioId],
	);
	return result.rows.map((row) => ({
		id: row.id,
		fileStem: row.file_stem,
		score: row.score,
		startedAt: new Date(row.started_at).toISOString(),
		durationS: row.duration_s,
		hasPerf: row.has_perf,
		pbBefore: row.pb_before,
		session: row.session_id,
		config: {
			sensScale: row.sens_scale,
			horizSens: row.horiz_sens,
			vertSens: row.vert_sens,
			dpi: row.dpi,
			fov: row.fov,
			fovScale: row.fov_scale,
		},
	}));
}

/** One scenario version with completed runs, as the Scenarios directory needs it. */
export interface ScenarioSummary {
	id: number;
	name: string;
	hash: string;
	/** Completed runs, scored or not. */
	runs: number;
	/** The highest completed score; null when no completed run has one. */
	pb: number | null;
	/** Normalized ISO timestamp of the latest completed run. */
	lastPlayed: string;
	/** The scores of the last 10 (the window) scored completed runs, newest first. */
	recent: number[];
}

/** How many of the latest scored runs make up recent form (L4). */
export const RECENT_WINDOW = 10;

/**
 * Every scenario version with completed runs (L7 of the scenarios directory
 * design). `run_complete` is read whole, so the window over it is one pass;
 * the last scores are aggregated per scenario and joined, never looked up
 * row by row.
 */
export async function listScenarios(pg: PGliteInterface, window = RECENT_WINDOW): Promise<ScenarioSummary[]> {
	const result = await pg.query<{
		id: number;
		name: string;
		hash: string;
		runs: number;
		pb: number | null;
		last_played: string;
		recent: number[] | null;
	}>(
		`
		with ranked as (
			select scenario_id, score,
			       row_number() over (partition by scenario_id order by started_at desc, id desc) as n
			from run_complete
			where score is not null
		), recent as (
			select scenario_id, array_agg(score order by n) as recent
			from ranked
			where n <= $1::integer
			group by scenario_id
		)
		select r.scenario_id as id, r.scenario_name as name, r.scenario_hash as hash,
		       count(*)::integer as runs, max(r.score) as pb, max(r.started_at) as last_played,
		       x.recent
		from run_complete r
		left join recent x on x.scenario_id = r.scenario_id
		group by r.scenario_id, r.scenario_name, r.scenario_hash, x.recent
		`,
		[window],
	);
	return result.rows.map((row) => ({
		id: row.id,
		name: row.name,
		hash: row.hash,
		runs: row.runs,
		pb: row.pb,
		lastPlayed: new Date(row.last_played).toISOString(),
		recent: row.recent ?? [],
	}));
}
