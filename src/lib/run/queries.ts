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
	/** The scenario's previous scored completion, in any session; null without one. */
	prevScore: number | null;
	/** The scenario's best score before this attempt; null without an earlier score. */
	pbBefore: number | null;
	/** The session, named by the id of its first run of any kind (see `SESSION_START`). */
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
 * A run that starts a session: no other run, of any kind, in the 30 minutes
 * before it in `(written_at, id)` order. The same rule as `run_session`,
 * but asked of one run through the `written_at` index instead of numbering
 * every run.
 */
function startsSession(x: string): string {
	return `not exists (
		select 1 from run y
		where y.written_at >= ${x}.written_at - interval '30 minutes' and y.written_at <= ${x}.written_at
		  and (y.written_at, y.id) < (${x}.written_at, ${x}.id))`;
}

/**
 * The first run, of any kind, of the session holding the run at `(written,
 * id)`: the latest session start at or before it. Selects `id` and
 * `written_at`; costs one probe per run of that session before the given one.
 */
function SESSION_START(written: string, id: string): string {
	return `select x.id, x.written_at from run x
		where x.written_at <= ${written} and (x.written_at, x.id) <= (${written}, ${id})
		  and ${startsSession('x')}
		order by x.written_at desc, x.id desc
		limit 1`;
}

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

	// The page is cut first, from `run_complete`'s own order, and only its rows
	// look up their history: every lookup is an index range bounded by the
	// scenario or the session, never a pass over the whole history.
	const result = await pg.query<RailAttemptRow>(
		`
		select ${ATTEMPT_COLUMNS},
		       (select p.score from run p
		        where p.kind = 'complete' and p.scenario_id = r.scenario_id and p.score is not null
		          and p.started_at <= r.started_at and (p.started_at, p.id) < (r.started_at, r.id)
		        order by p.started_at desc, p.id desc
		        limit 1) as prev_score,
		       (select p.score from run p
		        where p.kind = 'complete' and p.scenario_id = r.scenario_id and p.score is not null
		          and (p.started_at, p.id) < (r.started_at, r.id)
		        order by p.score desc
		        limit 1) as pb_before,
		       (select x.id from (${SESSION_START('r.written_at', 'r.id')}) x) as session_id
		from (
			select r.* from run_complete r
			${where}
			order by r.written_at desc, r.id desc
			limit $${params.length}
		) r
		join config c on c.id = r.config_id
		order by r.written_at desc, r.id desc
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
 * Sessions are named by their first run's id, as `listAttempts` names them;
 * "earlier" means written before the session's first run.
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
		-- Every step is an index range bounded by one session or one scenario.
		with keys as (
			select x.id as session_id, x.written_at as s
			from run x
			where x.id = any($1::integer[])
		),
		-- Where each session ends: the next session's first run, if any.
		edges as (
			select k.session_id, k.s, nx.written_at as next_s, nx.id as next_id
			from keys k
			left join lateral (
				select n.written_at, n.id from run n
				where n.written_at >= k.s and (n.written_at, n.id) > (k.s, k.session_id)
				  and ${startsSession('n')}
				order by n.written_at, n.id
				limit 1
			) nx on true
		),
		played as (
			select e.session_id, e.s, r.id, r.scenario_id, r.score, r.started_at, r.written_at
			from edges e
			join run_complete r
			  on r.written_at >= e.s and r.written_at <= coalesce(e.next_s, 'infinity')
			 and (r.written_at, r.id) >= (e.s, e.session_id)
			 and (e.next_s is null or (r.written_at, r.id) < (e.next_s, e.next_id))
			where $2::integer is null or r.scenario_id = $2::integer
		),
		bounds as (
			select session_id, s, min(started_at) as started_at, max(written_at) as ended_at, count(*)::integer as runs
			from played
			group by session_id, s
		),
		per as (
			select session_id, s, scenario_id,
			       percentile_cont(0.5) within group (order by score) as median,
			       max(score) as best
			from played
			where score is not null
			group by session_id, s, scenario_id
		)
		select b.session_id, b.started_at, b.ended_at, b.runs,
		       p.scenario_id, p.median, p.best, base.median as baseline, prev.best as prev_best
		from bounds b
		left join per p on p.session_id = b.session_id
		-- The scenario's last scored runs written before this session.
		left join lateral (
			select percentile_cont(0.5) within group (order by h.score) as median
			from (
				select r.score from run r
				where r.kind = 'complete' and r.scenario_id = p.scenario_id and r.score is not null
				  and r.started_at < p.s and (r.written_at, r.id) < (p.s, p.session_id)
				order by r.started_at desc, r.id desc
				limit $3::integer
			) h
		) base on true
		-- The previous session that scored this scenario: the session of its last score before this one.
		left join lateral (
			select q.written_at, q.id from run q
			where q.kind = 'complete' and q.scenario_id = p.scenario_id and q.score is not null
			  and q.started_at < p.s and (q.written_at, q.id) < (p.s, p.session_id)
			order by q.started_at desc, q.id desc
			limit 1
		) last on true
		left join lateral (${SESSION_START('last.written_at', 'last.id')}) ps on true
		left join lateral (
			-- A run written in that session started at most a day before it began.
			select max(r.score) as best from run r
			where r.kind = 'complete' and r.scenario_id = p.scenario_id and r.score is not null
			  and r.started_at >= ps.written_at - interval '1 day' and r.started_at < p.s
			  and (r.written_at, r.id) >= (ps.written_at, ps.id) and (r.written_at, r.id) < (p.s, p.session_id)
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
