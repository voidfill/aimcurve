const modules = import.meta.glob('../../drizzle/*.sql', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;

export interface Migration {
	name: string;
	sql: string;
}

/** Generated migrations, ordered by their numeric filename prefix. */
export const migrations: Migration[] = Object.entries(modules)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([path, sql]) => ({ name: path.split('/').pop()!, sql }));
