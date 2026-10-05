/**
 * The sheet's brace connectors: in a narrow gutter left of the names, a line
 * from each aggregate row down to its last child row, with an elbow into each
 * child. They say "these rows make up that one" without indenting the names.
 *
 * The gutter has two columns: the outer joins a category to its subcategories
 * (or straight to its scenarios, where a subcategory has no row of its own),
 * the inner a subcategory to its scenarios. The overall needs no brace: the
 * category blocks are its parts.
 */

/** What one gutter column draws on one row. */
export type BraceMark =
	/** The parent: a node, and the line from it down. */
	| 'node'
	/** A child with more below: the line through, and an elbow in. */
	| 'tee'
	/** The last child: the line from above, and an elbow in. */
	| 'end'
	/** A row inside the brace that is not this parent's child: the line through. */
	| 'pass'
	| null;

export interface BraceRow {
	key: string;
	level: 'overall' | 'category' | 'subcategory' | 'scenario';
	/** Ancestor keys, overall first; ones without a row are skipped. */
	parents: readonly string[];
}

/** Gutter columns: the category's, then the subcategory's. */
export const BRACE_COLUMNS = 2;

/** Per row, one mark per gutter column. */
export function braces(rows: readonly BraceRow[]): BraceMark[][] {
	const index = new Map(rows.map((r, i) => [r.key, i]));
	const marks: BraceMark[][] = rows.map(() => new Array<BraceMark>(BRACE_COLUMNS).fill(null));
	const children = new Map<number, number[]>();
	rows.forEach((row, i) => {
		// The nearest ancestor with a row, the overall aside.
		const parent = [...row.parents].reverse().find((k) => k !== 'overall' && index.has(k));
		if (parent === undefined) return;
		const p = index.get(parent)!;
		let list = children.get(p);
		if (!list) children.set(p, (list = []));
		list.push(i);
	});
	for (const [p, list] of children) {
		const column = rows[p]!.level === 'category' ? 0 : 1;
		const last = list[list.length - 1]!;
		const own = new Set(list);
		marks[p]![column] = 'node';
		for (let i = p + 1; i <= last; i++) {
			if (own.has(i)) marks[i]![column] = i === last ? 'end' : 'tee';
			else if (marks[i]![column] === null) marks[i]![column] = 'pass';
		}
	}
	return marks;
}

/** What continues through a fold-open chart under a row: every line that goes on below it. */
export function continuation(marks: readonly BraceMark[]): BraceMark[] {
	return marks.map((m) => (m === 'node' || m === 'tee' || m === 'pass' ? 'pass' : null));
}
