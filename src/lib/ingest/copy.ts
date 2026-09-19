/**
 * A writer for PostgreSQL's COPY *text* format, which is what `COPY … FROM
 * '/dev/blob'` reads by default.
 *
 * Text format is tab-separated with `\N` for null, and four characters have to
 * be escaped or they terminate a cell or a row. Scenario names are user-authored
 * and do contain punctuation, so this is not theoretical.
 */
const ESCAPES: Record<string, string> = {
	'\\': '\\\\',
	'\t': '\\t',
	'\n': '\\n',
	'\r': '\\r',
};

function cell(value: unknown): string {
	if (value === null || value === undefined) return '\\N';
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'boolean') return value ? 't' : 'f';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '\\N';
	return String(value).replace(/[\\\t\n\r]/g, (char) => ESCAPES[char]!);
}

export class CopyWriter {
	#parts: string[] = [];

	/** One row, in the table's column order. */
	row(cells: unknown[]): void {
		this.#parts.push(cells.map(cell).join('\t'), '\n');
	}

	bytes(): Uint8Array {
		return new TextEncoder().encode(this.#parts.join(''));
	}
}
