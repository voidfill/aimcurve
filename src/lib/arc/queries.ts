/**
 * Queries for ARC and the Benchmarks pages. SQL only narrows; the ARC math
 * is done in JS over the stream. See docs/arc.md.
 */
import type { PGliteInterface } from '@electric-sql/pglite';
import type { PlayedScenario } from '../benchmarks/catalog';
import type { StreamRows } from './history';

/**
 * A scenario name trimmed as JavaScript's `trim()` does it, every kind of
 * whitespace at either end: the snapshot's names were trimmed that way, and
 * SQL's own `trim` strips only spaces.
 */
const TRIMMED = (column: string) => `regexp_replace(${column}, '^[\\s\u00a0\ufeff]+|[\\s\u00a0\ufeff]+$', '', 'g')`;

/**
 * Every complete scored run of every scenario whose trimmed name is in
 * `names`, ordered by `started_at, id`. Scenarios are matched by trimmed
 * name, so all hashes of a name come along. Scores are read as stored, as the
 * scenario page reads them: a cast to float8 would widen the `real` into
 * digits the CSV never had (881.858 as 881.8579711914062).
 */
export async function listArcRuns(pg: PGliteInterface, names: readonly string[]): Promise<StreamRows> {
	const scenarios = await pg.query<{ id: number; name: string; hash: string }>(
		`select id, ${TRIMMED('name')} as name, hash from scenario where ${TRIMMED('name')} = any($1::text[])`,
		[[...names]],
	);
	const ids = scenarios.rows.map((s) => s.id);
	const runs =
		ids.length === 0
			? { rows: [] as [number, number, number, number][] }
			: await pg.query<[number, number, number, number]>(
					`
					select scenario_id, id, (extract(epoch from started_at) * 1000)::float8, score
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

/**
 * Every trimmed scenario name with a complete scored run, its best score and
 * its last such run (epoch ms), across all hashes: the index's ranks and order.
 */
export async function listPlayedBests(pg: PGliteInterface): Promise<Map<string, PlayedScenario>> {
	const result = await pg.query<[string, number, number]>(
		`
		select ${TRIMMED('s.name')}, max(r.pb), (extract(epoch from max(r.last)) * 1000)::float8
		from (
			select scenario_id, max(score) as pb, max(started_at) as last
			from run
			where kind = 'complete' and score is not null
			group by scenario_id
		) r
		join scenario s on s.id = r.scenario_id
		group by 1
		`,
		[],
		{ rowMode: 'array' },
	);
	return new Map(result.rows.map(([name, pb, last]) => [name, { pb, last }]));
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
