import type { PGliteInterface } from '@electric-sql/pglite';
import type { ScoringInput } from '../scoring';
import type { ScenarioRun } from './baseline';
import type { KillDetail, SlotStats } from './bots';

/**
 * A completed attempt, assembled from `run_complete` joined to `config`.
 * `id` is the internal, migration-reset-able primary key; `fileStem` is the
 * persistent identity to use in links.
 */
export interface Attempt {
	id: number;
	fileStem: string;
	scenarioId: number;
	scenarioName: string;
	scenarioHash: string;
	writtenAt: string; // ISO timestamp, normalize at query boundary
	startedAt: string;
	score: number | null;
	durationS: number;
	accuracy: number | null;
	hits: number;
	shots: number;
	hasPerf: boolean;
	sensScale: string;
	horizSens: number;
	vertSens: number;
	/** CSV totals; null where the CSV did not record them. */
	kills: number | null;
	avgTtkS: number | null;
	efficiency: number | null;
	damageTaken: number | null;
	overshots: number | null;
	avgFps: number | null;
}

/**
 * A rail row: an attempt with the scenario history around it, read from the
 * database so it holds even when the runs it refers to are not loaded.
 */
export interface RailAttempt extends Attempt {
	/** The scenario's previous completed score, in any session; null for its first. */
	prevScore: number | null;
	/** The scenario's best score before this attempt; null for its first. */
	pbBefore: number | null;
	/** `run_session`'s session id. */
	sessionId: number;
}

export interface AttemptCursor {
	writtenAt: string;
	id: number;
}

export interface ScenarioOption {
	id: number;
	name: string;
	hash: string;
}

export interface AttemptPage {
	items: RailAttempt[];
	next: AttemptCursor | null;
}

/**
 * The columns pulled off `run_complete r join config c on c.id = r.config_id`
 * for every query below, aliased to the DTO's field names.
 */
const ATTEMPT_COLUMNS = `
	r.id                as id,
	r.file_stem         as file_stem,
	r.scenario_id        as scenario_id,
	r.scenario_name      as scenario_name,
	r.scenario_hash      as scenario_hash,
	r.written_at         as written_at,
	r.started_at         as started_at,
	r.score              as score,
	r.duration_s         as duration_s,
	r.accuracy           as accuracy,
	r.hit_count          as hits,
	r.shots              as shots,
	r.has_perf           as has_perf,
	c.sens_scale         as sens_scale,
	c.horiz_sens         as horiz_sens,
	c.vert_sens          as vert_sens,
	r.kills              as kills,
	r.avg_ttk_s          as avg_ttk_s,
	r.efficiency         as efficiency,
	r.damage_taken       as damage_taken,
	r.total_overshots    as total_overshots,
	r.avg_fps            as avg_fps
`;

interface AttemptRow {
	id: number;
	file_stem: string;
	scenario_id: number;
	scenario_name: string;
	scenario_hash: string;
	written_at: string;
	started_at: string;
	score: number | null;
	duration_s: number;
	accuracy: number | null;
	hits: number;
	shots: number;
	has_perf: boolean;
	sens_scale: string;
	horiz_sens: number;
	vert_sens: number;
	kills: number | null;
	avg_ttk_s: number | null;
	efficiency: number | null;
	damage_taken: number | null;
	total_overshots: number | null;
	avg_fps: number | null;
}

interface RailAttemptRow extends AttemptRow {
	prev_score: number | null;
	pb_before: number | null;
	session_id: number;
}

function toRailAttempt(row: RailAttemptRow): RailAttempt {
	return { ...toAttempt(row), prevScore: row.prev_score, pbBefore: row.pb_before, sessionId: row.session_id };
}

function toAttempt(row: AttemptRow): Attempt {
	return {
		id: row.id,
		fileStem: row.file_stem,
		scenarioId: row.scenario_id,
		scenarioName: row.scenario_name,
		scenarioHash: row.scenario_hash,
		writtenAt: new Date(row.written_at).toISOString(),
		startedAt: new Date(row.started_at).toISOString(),
		score: row.score,
		durationS: row.duration_s,
		accuracy: row.accuracy,
		hits: row.hits,
		shots: row.shots,
		hasPerf: row.has_perf,
		sensScale: row.sens_scale,
		horizSens: row.horiz_sens,
		vertSens: row.vert_sens,
		kills: row.kills,
		avgTtkS: row.avg_ttk_s,
		efficiency: row.efficiency,
		damageTaken: row.damage_taken,
		overshots: row.total_overshots,
		avgFps: row.avg_fps,
	};
}

const PAGE_SIZE = 50;

/**
 * The most recent completed attempts, newest first, optionally scoped to one
 * scenario and paginated by a `(writtenAt, id)` cursor. Fetches one row past
 * the page so `next` is only populated when there really is more to load.
 */
export async function listAttempts(
	pg: PGliteInterface,
	scenarioId: number | null,
	before: AttemptCursor | null,
): Promise<AttemptPage> {
	const conditions: string[] = [];
	const params: unknown[] = [];

	if (scenarioId !== null) {
		params.push(scenarioId);
		conditions.push(`r.scenario_id = $${params.length}::integer`);
	}
	if (before !== null) {
		params.push(before.writtenAt, before.id);
		conditions.push(
			`(r.written_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::integer)`,
		);
	}

	const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
	params.push(PAGE_SIZE + 1);

	// `run_progress` is `run_complete` plus the per-scenario history columns.
	const result = await pg.query<RailAttemptRow>(
		`
		select ${ATTEMPT_COLUMNS},
		       r.prev_score          as prev_score,
		       r.pb_before           as pb_before,
		       s.session_id::integer as session_id
		from run_progress r
		join config c on c.id = r.config_id
		join run_session s on s.id = r.id
		${where}
		order by r.written_at desc, r.id desc
		limit $${params.length}
		`,
		params,
	);

	const hasMore = result.rows.length > PAGE_SIZE;
	const rendered = result.rows.slice(0, PAGE_SIZE);
	const items = rendered.map(toRailAttempt);
	const last = rendered[rendered.length - 1];
	const next = hasMore && last ? { writtenAt: items[items.length - 1]!.writtenAt, id: last.id } : null;

	return { items, next };
}

/** How many earlier completed runs of a scenario make up a session's baseline. */
export const BASELINE_RUNS = 20;

/** One scenario's scored runs within one session. */
export interface SessionScenario {
	scenarioId: number;
	median: number;
	best: number;
	/** The median of the scenario's last `BASELINE_RUNS` scored runs in earlier sessions; null without any. */
	baseline: number | null;
	/** The scenario's best score in the latest earlier session that played it; null without one. */
	prevBest: number | null;
}

export interface SessionSummary {
	sessionId: number;
	/** Normalized ISO timestamps of the first start and the last write. */
	startedAt: string;
	endedAt: string;
	/** Completed runs, scoped to the scenario when one is given. */
	runs: number;
	/** Only scenarios with at least one scored run. */
	scenarios: SessionScenario[];
}

/**
 * Whole-session totals for the given sessions, however much of each the rail
 * has loaded. With `scenarioId`, every figure is scoped to that scenario.
 * Sessions are `run_session`'s, so "earlier" means an earlier session, not
 * merely an earlier start.
 */
export async function listSessionSummaries(
	pg: PGliteInterface,
	sessionIds: readonly number[],
	scenarioId: number | null,
): Promise<SessionSummary[]> {
	if (sessionIds.length === 0) return [];
	const result = await pg.query<{
		session_id: number;
		started_at: string;
		ended_at: string;
		runs: number;
		scenario_id: number | null;
		median: number | null;
		best: number | null;
		baseline: number | null;
		prev_best: number | null;
	}>(
		`
		-- run_session windows over every run, so it is read once here rather
		-- than once per session and scenario in the lookups below.
		with completed as materialized (
			select r.id, s.session_id::integer as session_id, r.scenario_id, r.score, r.started_at, r.written_at
			from run_session s
			join run_complete r on r.id = s.id
		),
		played as (
			select * from completed
			where session_id = any($1::integer[])
			  and ($2::integer is null or scenario_id = $2::integer)
		),
		bounds as (
			select session_id, min(started_at) as started_at, max(written_at) as ended_at, count(*)::integer as runs
			from played
			group by session_id
		),
		per as (
			select session_id, scenario_id,
			       percentile_cont(0.5) within group (order by score) as median,
			       max(score) as best
			from played
			where score is not null
			group by session_id, scenario_id
		)
		select b.session_id, b.started_at, b.ended_at, b.runs,
		       p.scenario_id, p.median, p.best, base.median as baseline, prev.best as prev_best
		from bounds b
		left join per p on p.session_id = b.session_id
		left join lateral (
			select percentile_cont(0.5) within group (order by h.score) as median
			from (
				select c.score
				from completed c
				where c.scenario_id = p.scenario_id and c.score is not null and c.session_id < p.session_id
				order by c.written_at desc, c.id desc
				limit $3::integer
			) h
		) base on true
		left join lateral (
			select max(c.score) as best
			from completed c
			where c.scenario_id = p.scenario_id and c.score is not null
			  and c.session_id = (
				select max(c2.session_id)
				from completed c2
				where c2.scenario_id = p.scenario_id and c2.score is not null and c2.session_id < p.session_id
			  )
		) prev on true
		order by b.session_id desc, p.scenario_id
		`,
		[sessionIds, scenarioId, BASELINE_RUNS],
	);

	const summaries = new Map<number, SessionSummary>();
	for (const row of result.rows) {
		let summary = summaries.get(row.session_id);
		if (!summary) {
			summary = {
				sessionId: row.session_id,
				startedAt: new Date(row.started_at).toISOString(),
				endedAt: new Date(row.ended_at).toISOString(),
				runs: row.runs,
				scenarios: [],
			};
			summaries.set(row.session_id, summary);
		}
		if (row.scenario_id === null || row.median === null || row.best === null) continue;
		summary.scenarios.push({
			scenarioId: row.scenario_id,
			median: row.median,
			best: row.best,
			baseline: row.baseline,
			prevBest: row.prev_best,
		});
	}
	return [...summaries.values()];
}

/** Exact lookup by the persistent file-stem identity, independent of filters or pagination. */
export async function getAttempt(pg: PGliteInterface, fileStem: string): Promise<Attempt | null> {
	const result = await pg.query<AttemptRow>(
		`
		select ${ATTEMPT_COLUMNS}
		from run_complete r
		join config c on c.id = r.config_id
		where r.file_stem = $1::text
		`,
		[fileStem],
	);
	const row = result.rows[0];
	return row ? toAttempt(row) : null;
}

/** The single most recent completed attempt, optionally scoped to one scenario. */
export async function getLatestAttempt(
	pg: PGliteInterface,
	scenarioId: number | null,
): Promise<Attempt | null> {
	const where = scenarioId !== null ? 'where r.scenario_id = $1::integer' : '';
	const params = scenarioId !== null ? [scenarioId] : [];

	const result = await pg.query<AttemptRow>(
		`
		select ${ATTEMPT_COLUMNS}
		from run_complete r
		join config c on c.id = r.config_id
		${where}
		order by r.written_at desc, r.id desc
		limit 1
		`,
		params,
	);
	const row = result.rows[0];
	return row ? toAttempt(row) : null;
}

/**
 * Scenarios that have at least one completed run, for a filter dropdown.
 * The full hash is returned alongside the name so a caller can build a
 * label (e.g. a short hash suffix) that keeps scenarios which share a
 * display name (an edited scenario re-ingested under a new hash)
 * distinguishable; their ids are never merged.
 */
export async function listScenarios(pg: PGliteInterface): Promise<ScenarioOption[]> {
	const result = await pg.query<{ id: number; name: string; hash: string }>(`
		select distinct s.id as id, s.name as name, s.hash as hash
		from scenario s
		join run_complete r on r.scenario_id = s.id
		order by s.name, s.hash
	`);
	return result.rows.map((row) => ({
		id: row.id,
		name: row.name,
		hash: row.hash,
	}));
}

interface ScoringRow {
	id: number;
	file_stem: string;
	score: number;
	damage_done: number | null;
	time_limit: number | null;
	timescale: number | null;
	end_challenge_after_kills: number | null;
	end_challenge_after_damage: number | null;
	t: number[];
	score_ticks: (number | null)[] | null;
	damage_ticks: (number | null)[] | null;
	kill_offsets: number[];
}

/**
 * The scoring model's inputs for the given runs, keyed by run id: arrays only,
 * no per-tick rows. Runs without a `.perf` have no curve and are left out.
 */
export async function getScoringInputs(pg: PGliteInterface, runIds: number[]): Promise<Map<number, ScoringInput>> {
	const result = await pg.query<ScoringRow>(
		`
		select r.id, r.file_stem, r.score, r.damage_done,
		       p.time_limit, p.timescale, p.end_challenge_after_kills, p.end_challenge_after_damage,
		       s.t, s.score as score_ticks, s.damage_done as damage_ticks,
		       coalesce(
		         (select array_agg(k.t_offset order by k.ordinal) from kill k where k.run_id = r.id),
		         '{}'
		       ) as kill_offsets
		from run r
		join run_perf p on p.run_id = r.id
		join run_series s on s.run_id = r.id
		where r.id = any($1::integer[]) and r.kind = 'complete'
		`,
		[runIds],
	);
	return new Map(
		result.rows.map((row) => [
			row.id,
			{
				runId: row.id,
				fileStem: row.file_stem,
				score: row.score,
				damageDone: row.damage_done,
				timeLimit: row.time_limit,
				timescale: row.timescale,
				endChallengeAfterKills: row.end_challenge_after_kills,
				endChallengeAfterDamage: row.end_challenge_after_damage,
				t: row.t,
				scoreTicks: row.score_ticks,
				damageTicks: row.damage_ticks,
				killOffsets: row.kill_offsets,
			},
		]),
	);
}

/**
 * Every completed run of one scenario, metadata only, oldest first: what the
 * baseline choice (Run view R2) needs before any curve is loaded.
 */
export async function listScenarioRuns(pg: PGliteInterface, scenarioId: number): Promise<ScenarioRun[]> {
	const result = await pg.query<{
		id: number;
		file_stem: string;
		score: number | null;
		started_at: string;
		has_perf: boolean;
	}>(
		`
		select r.id, r.file_stem, r.score, r.started_at, r.has_perf
		from run_complete r
		where r.scenario_id = $1::integer
		order by r.started_at, r.id
		`,
		[scenarioId],
	);
	return result.rows.map((row) => ({
		id: row.id,
		fileStem: row.file_stem,
		score: row.score,
		startedAt: new Date(row.started_at).toISOString(),
		hasPerf: row.has_perf,
	}));
}

/** Each kill slot's TTK over every completed run of one scenario, for `fixedWindow`. */
export async function getSlotStats(pg: PGliteInterface, scenarioId: number): Promise<SlotStats[]> {
	const result = await pg.query<{ slot: number; runs: number; mean: number; spread: number }>(
		`
		select k.ordinal as slot, count(*)::integer as runs,
		       avg(k.ttk)::float8 as mean, stddev_pop(k.ttk)::float8 as spread
		from kill k
		join run_complete r on r.id = k.run_id
		where r.scenario_id = $1::integer and k.ttk > 0
		group by k.ordinal
		order by k.ordinal
		`,
		[scenarioId],
	);
	return result.rows;
}

/**
 * Per-kill bot name, hits, shots and TTK in kill order, keyed by run id. The order
 * matches `getScoringInputs`' kill offsets. Runs without kills are absent.
 */
export async function getKillDetail(pg: PGliteInterface, runIds: number[]): Promise<Map<number, KillDetail>> {
	const result = await pg.query<{ run_id: number; bots: string[]; hits: number[]; shots: number[]; ttk: number[] }>(
		`
		select k.run_id,
		       array_agg(b.name  order by k.ordinal) as bots,
		       array_agg(k.hits  order by k.ordinal) as hits,
		       array_agg(k.shots order by k.ordinal) as shots,
		       array_agg(k.ttk   order by k.ordinal) as ttk
		from kill k
		join bot b on b.id = k.bot_id
		where k.run_id = any($1::integer[])
		group by k.run_id
		`,
		[runIds],
	);
	return new Map(
		result.rows.map((row) => [row.run_id, { bot: row.bots, hits: row.hits, shots: row.shots, ttk: row.ttk }]),
	);
}
