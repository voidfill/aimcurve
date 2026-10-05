/**
 * Queries for custom energy and the Benchmarks page (E8 of the custom energy
 * design, P12 of the benchmarks page design). SQL only narrows; the energy
 * math is done in JS over the stream.
 */
import type { PGliteInterface } from '@electric-sql/pglite';
import type { StreamRows } from './history';

/**
 * Every complete scored run of every scenario whose trimmed name is in
 * `names`, ordered by `started_at, id`. Scenarios are matched by trimmed
 * name, so all hashes of a name come along.
 */
export async function listEnergyRuns(pg: PGliteInterface, names: readonly string[]): Promise<StreamRows> {
	const scenarios = await pg.query<{ id: number; name: string; hash: string }>(
		`select id, trim(name) as name, hash from scenario where trim(name) = any($1::text[])`,
		[[...names]],
	);
	const ids = scenarios.rows.map((s) => s.id);
	const runs =
		ids.length === 0
			? { rows: [] as [number, number, number, number][] }
			: await pg.query<[number, number, number, number]>(
					`
					select scenario_id, id, (extract(epoch from started_at) * 1000)::float8, score::float8
					from run
					where kind = 'complete' and score is not null and scenario_id = any($1::integer[])
					order by started_at, id
					`,
					[ids],
					{ rowMode: 'array' },
				);
	const n = runs.rows.length;
	const out: StreamRows = {
		scenarios: scenarios.rows,
		scenarioId: new Int32Array(n),
		runId: new Int32Array(n),
		t: new Float64Array(n),
		score: new Float64Array(n),
	};
	runs.rows.forEach(([scenario, id, t, score], i) => {
		out.scenarioId[i] = scenario;
		out.runId[i] = id;
		out.t[i] = t;
		out.score[i] = score;
	});
	return out;
}

/** The trimmed names of every scenario with a complete scored run: the index's "n/m played". */
export async function listPlayedNames(pg: PGliteInterface): Promise<Set<string>> {
	const result = await pg.query<{ name: string }>(
		`
		select distinct trim(s.name) as name
		from scenario s
		where exists (select 1 from run r where r.scenario_id = s.id and r.kind = 'complete' and r.score is not null)
		`,
	);
	return new Set(result.rows.map((r) => r.name));
}

/** What a link into Run needs for one run: its file stem and scenario hash. */
export interface RunLink {
	fileStem: string;
	hash: string;
}

export async function getRunLink(pg: PGliteInterface, runId: number): Promise<RunLink | null> {
	const result = await pg.query<{ file_stem: string; hash: string }>(
		`select r.file_stem, s.hash from run r join scenario s on s.id = r.scenario_id where r.id = $1::integer`,
		[runId],
	);
	const row = result.rows[0];
	return row ? { fileStem: row.file_stem, hash: row.hash } : null;
}
