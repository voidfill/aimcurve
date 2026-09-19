const modules = import.meta.glob('./sql/*.sql', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;

export interface Migration {
	name: string;
	sql: string;
}

/**
 * Migrations, ordered by their numeric filename prefix.
 *
 * Not `localeCompare`: it is ICU- and locale-dependent, and reset rule 4
 * drops the database when the applied order diverges from the file order —
 * so ordering must be identical between Node and every browser regardless of
 * locale, not merely identical today because the filenames are plain digits.
 */
export const migrations: Migration[] = Object.entries(modules)
	.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
	.map(([path, sql]) => ({ name: path.split('/').pop()!, sql }));
