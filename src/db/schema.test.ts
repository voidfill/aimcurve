import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../test/helpers/db';

let pg: PGlite;

/** 32 hex characters, the shape of a KovaaK's scenario hash. */
const HASH = 'a'.repeat(32);

/** The 15 client-configuration keys, as one row. */
const CONFIG_VALUES = `'cm/360', 0.0123, 1.5, 1.5, 1600, 103, 'Overwatch', false,
	'blank.png', 1.0, '010101FF', '3440x1440', 100, 999, 0`;

const INSERT_CONFIG = `
	insert into config (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov,
		fov_scale, hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
		resolution_scale, max_fps_config, input_lag)
	values (${CONFIG_VALUES})
	on conflict do nothing
	returning id
`;

beforeEach(async () => {
	({ pg } = await makeTestDb());
});

describe('dimensions', () => {
	it('interns a scenario by hash', async () => {
		await pg.exec(`insert into scenario (hash, name) values ('${HASH}', 'Air Voltaic')`);
		const r = await pg.query<{ name: string }>('select name from scenario');
		expect(r.rows).toEqual([{ name: 'Air Voltaic' }]);
	});

	it('rejects an untrimmed or empty bot or weapon name', async () => {
		// " speedswitch " and "speedswitch" alternate within one corpus file;
		// interning verbatim would fork one bot into two dimension rows.
		await expect(pg.exec(`insert into bot (name) values (' speedswitch ')`)).rejects.toThrow(
			/bot_name_trimmed/,
		);
		await expect(pg.exec(`insert into bot (name) values ('')`)).rejects.toThrow(
			/bot_name_trimmed/,
		);
		await expect(pg.exec(`insert into weapon (name) values (' pistol')`)).rejects.toThrow(
			/weapon_name_trimmed/,
		);
	});

	it('deduplicates a config on the natural key over all 15 columns', async () => {
		const first = await pg.query<{ id: number }>(INSERT_CONFIG);
		expect(first.rows).toEqual([{ id: 1 }]);
		const second = await pg.query<{ id: number }>(INSERT_CONFIG);
		expect(second.rows).toEqual([]);
	});

	it('defines run_kind with exactly two values', async () => {
		const r = await pg.query<{ enumlabel: string }>(`
			select enumlabel from pg_enum e
			join pg_type t on t.oid = e.enumtypid
			where t.typname = 'run_kind' order by e.enumsortorder
		`);
		expect(r.rows.map((row) => row.enumlabel)).toEqual(['complete', 'reset']);
	});
});
