import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../test/helpers/db';

let pg: PGlite;

beforeEach(async () => {
	({ pg } = await makeTestDb());
	await pg.exec(`
		insert into scenario (hash, name) values ('${'a'.repeat(32)}', 'Air Voltaic');
		insert into game_version (label) values ('3.9.5');
		insert into config (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov,
			fov_scale, hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
			resolution_scale, max_fps_config, input_lag)
		values ('cm/360', 0.0123, 1.5, 1.5, 1600, 103, 'Overwatch', false,
			'blank.png', 1.0, '010101FF', '3440x1440', 100, 999, 0);
	`);
});

describe('run_ingested', () => {
	it('fires once per statement, not once per row', async () => {
		const payloads: string[] = [];
		await pg.listen('run_ingested', (payload) => payloads.push(payload));

		await pg.exec(`
			insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
				written_at, hit_count, miss_count, shots)
			values ('r1', 1, 1, 1, 'reset', '2026-01-01 10:00:00Z', 1, 1, 2),
			       ('r2', 1, 1, 1, 'reset', '2026-01-01 10:01:00Z', 1, 1, 2),
			       ('r3', 1, 1, 1, 'reset', '2026-01-01 10:02:00Z', 1, 1, 2)
		`);
		await new Promise((resolve) => setTimeout(resolve, 150));

		expect(payloads).toHaveLength(1);
		expect(JSON.parse(payloads[0]!)).toEqual({ count: 3, max_id: 3 });
	});
});
