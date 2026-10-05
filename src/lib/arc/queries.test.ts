import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../../../test/helpers/db';
import { listEnergyRuns } from './queries';

describe('listEnergyRuns', () => {
	it('matches names trimmed as JavaScript trims them, letters untouched', async () => {
		const { pg } = await makeTestDb();
		await pg.query(`insert into scenario (hash, name) values ($1, $2), ($3, $4), ($5, $6)`, [
			'a'.repeat(32), 'Pasu\t',
			'b'.repeat(32), ' Pasu ',
			'c'.repeat(32), 'Pasus',
		]);
		const { scenarios } = await listEnergyRuns(pg, ['Pasu', 'Pasus']);
		expect(scenarios.map((s) => s.name).sort()).toEqual(['Pasu', 'Pasu', 'Pasus']);
	});
});
