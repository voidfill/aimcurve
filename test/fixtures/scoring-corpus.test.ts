/**
 * Scoring-model invariants swept over the full dump, through the real ingest
 * and query path. The counts are the measurements in
 * docs/superpowers/specs/2026-09-24-scoring-model-design.md; they guard on
 * `raw.available` and skip on a fresh clone.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingest } from '../../src/lib/ingest';
import { nodeSource } from '../../src/lib/ingest/source-node';
import { getScoringInputs } from '../../src/lib/run/queries';
import { buildCurve, classify, paceLines, type ScoringInput } from '../../src/lib/scoring';
import { makeTestDb } from '../helpers/db';
import { raw } from '../helpers/fixtures';

describe.skipIf(!raw.available)('scoring model over the full dump', () => {
	it('classifies, ends on the real score and keeps races monotone', async () => {
		const { pg } = await makeTestDb();
		await ingest(nodeSource(join(raw.dir, 'stats'), join(raw.dir, 'performances')), pg);
		const rows = await pg.query<{ id: number; hash: string }>(`
			select r.id, s.hash from run r
			join scenario s on s.id = r.scenario_id
			join run_perf p on p.run_id = r.id
			where r.kind = 'complete'
		`);
		const hashOf = new Map(rows.rows.map((row) => [row.id, row.hash]));
		const inputs: ScoringInput[] = [...(await getScoringInputs(pg, [...hashOf.keys()])).values()];

		const counts = { clock: 0, race: 0, unsupported: 0, killCapped: 0 };
		const kindsByHash = new Map<string, Set<string>>();
		const endpointMisses: string[] = [];
		const nonMonotone: string[] = [];

		for (const input of inputs) {
			const params = classify(input);
			counts[params.kind]++;
			if (params.kind === 'clock' && params.durationFrom === 'kill-cap') counts.killCapped++;
			const hash = hashOf.get(input.runId)!;
			kindsByHash.set(hash, (kindsByHash.get(hash) ?? new Set()).add(params.kind));
			if (params.kind === 'unsupported') continue;

			const curve = buildCurve(input)!;
			const lines = paceLines(curve);
			const last = lines.accumulated[lines.accumulated.length - 1]!;
			const tolerance = params.kind === 'race' ? 0.05 : 1e-3 * Math.max(1, Math.abs(input.score));
			if (!(Math.abs(last - input.score) <= tolerance)) {
				endpointMisses.push(`${input.fileStem}: ${last} vs ${input.score}`);
			}
			if (params.kind === 'race') {
				for (let i = 1; i < curve.x.length; i++) {
					if (curve.x[i]! < curve.x[i - 1]! || curve.u[i]! < curve.u[i - 1]!) {
						nonMonotone.push(`${input.fileStem} at t=${curve.t[i]}`);
						break;
					}
				}
			}
		}

		expect(counts).toEqual({ clock: 2011, race: 153, unsupported: 0, killCapped: 2 });
		expect([...kindsByHash].filter(([, kinds]) => kinds.size > 1)).toEqual([]);
		expect(endpointMisses).toEqual([]);
		expect(nonMonotone).toEqual([]);
	}, 600_000);
});
