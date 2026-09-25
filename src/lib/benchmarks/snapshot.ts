/**
 * The benchmark snapshot: every known benchmark ladder, keyed by scenario name.
 * See docs/superpowers/specs/2026-09-25-benchmark-ranks-design.md (B2–B4).
 *
 * `buildSnapshot` turns the fetched Evxl index and KovaaK's responses into the
 * snapshot, and `serialize` writes it deterministically. Both are pure. This
 * file has no relative imports, so `scripts/gen-benchmarks.ts` can import it
 * through Node's type stripping.
 */

/* ------------------------------------------------------------------ */
/* Upstream payloads (only the fields read)                            */
/* ------------------------------------------------------------------ */

export interface EvxlDifficulty {
	difficultyName: string;
	kovaaksBenchmarkId: number;
	/** Rank name → colour; key order is the ladder order. */
	rankColors: Record<string, string>;
}

export interface EvxlBenchmark {
	benchmarkName: string;
	hidden?: boolean;
	difficulties: EvxlDifficulty[];
}

export interface KovaaksScenario {
	/** Numbers, or numeric strings in some benchmarks. */
	rank_maxes?: (number | string)[];
}

export interface KovaaksResponse {
	categories?: Record<string, { scenarios?: Record<string, KovaaksScenario> } | null> | null;
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

export interface RankStep {
	name: string;
	color: string;
}

export interface SnapshotBenchmark {
	/** KovaaK's benchmark ID: stable across regenerations. */
	id: number;
	name: string;
	difficulty: string;
	ranks: RankStep[];
}

/** An index into `benchmarks`, and that benchmark's thresholds for the scenario. */
export type SnapshotCandidate = [index: number, thresholds: number[]];

export interface Snapshot {
	version: 1;
	generatedAt: string;
	/** Evxl index order: benchmarks as listed, then difficulties as listed. */
	benchmarks: SnapshotBenchmark[];
	/** Trimmed scenario name → candidates, default first (B4). */
	scenarios: Record<string, SnapshotCandidate[]>;
}

export interface Built {
	benchmarks: SnapshotBenchmark[];
	scenarios: Record<string, SnapshotCandidate[]>;
	/** Deterministic upstream data problems that were skipped, for the run summary. */
	skipped: string[];
}

/* ------------------------------------------------------------------ */
/* Family and season (B4)                                              */
/* ------------------------------------------------------------------ */

const SEASON = /^(.*?)\s+(?:S|Season\s*|v)(\d+(?:\.\d+)?)$/i;

/** A benchmark name's family (lower-cased) and season; no suffix is season 1. */
export function familySeason(name: string): { family: string; season: number } {
	const trimmed = name.trim();
	const match = SEASON.exec(trimmed);
	if (match) return { family: match[1]!.toLowerCase(), season: Number(match[2]) };
	return { family: trimmed.toLowerCase(), season: 1 };
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

function label(benchmark: string, difficulty: string, id: number): string {
	return `${benchmark} · ${difficulty} (${id})`;
}

const NUMERIC = /^\s*-?\d+(?:\.\d+)?\s*$/;

/**
 * Thresholds as numbers. Some benchmarks send them as numeric strings
 * (`"1750"`); anything else becomes NaN.
 */
function toNumbers(raw: readonly unknown[]): number[] {
	return raw.map((t) => (typeof t === 'number' ? t : typeof t === 'string' && NUMERIC.test(t) ? Number(t) : Number.NaN));
}

/** Why a ladder is not usable, or null when it is. */
function ladderProblem(thresholds: readonly number[]): string | null {
	if (thresholds.some((t) => !Number.isFinite(t))) return 'non-numeric thresholds';
	for (let i = 1; i < thresholds.length; i++) {
		if (thresholds[i]! < thresholds[i - 1]!) return 'decreasing thresholds';
	}
	if (thresholds.length > 1 && thresholds[0] === thresholds[thresholds.length - 1]) return 'all thresholds equal';
	return null;
}

/**
 * The snapshot content from the Evxl index and the KovaaK's response for each
 * difficulty, keyed by KovaaK's benchmark ID. A difficulty with no response is
 * treated as having no scenarios.
 *
 * Throws on an integer-like rank name, whose key order JavaScript would not
 * keep.
 */
export function buildSnapshot(index: readonly EvxlBenchmark[], responses: ReadonlyMap<number, KovaaksResponse>): Built {
	const benchmarks: SnapshotBenchmark[] = [];
	const skipped: string[] = [];
	/** Per included benchmark: its sort key. */
	const keys: { familyOrder: number; season: number; position: number }[] = [];
	const familyOrder = new Map<string, number>();
	const byScenario = new Map<string, SnapshotCandidate[]>();

	let position = 0;
	index.forEach((benchmark, listed) => {
		if (benchmark.hidden === true) return;
		const name = benchmark.benchmarkName.trim();
		const { family, season } = familySeason(name);
		if (!familyOrder.has(family)) familyOrder.set(family, listed);

		for (const difficulty of benchmark.difficulties) {
			const at = position++;
			const id = difficulty.kovaaksBenchmarkId;
			const where = label(name, difficulty.difficultyName, id);
			const rankNames = Object.keys(difficulty.rankColors);
			for (const rank of rankNames) {
				if (/^(?:0|[1-9]\d*)$/.test(rank)) throw new Error(`${where}: integer-like rank name "${rank}"`);
			}

			const scenarios = new Map<string, number[]>();
			for (const category of Object.values(responses.get(id)?.categories ?? {})) {
				for (const [raw, scenario] of Object.entries(category?.scenarios ?? {})) {
					const trimmed = raw.trim();
					if (scenarios.has(trimmed)) continue;
					scenarios.set(trimmed, toNumbers(scenario.rank_maxes ?? []));
				}
			}
			if (scenarios.size === 0) {
				skipped.push(`${where}: no scenarios`);
				continue;
			}
			const lengths = new Set([...scenarios.values()].map((t) => t.length));
			if (lengths.size !== 1 || !lengths.has(rankNames.length)) {
				skipped.push(`${where}: ${rankNames.length} rank colours but rank_maxes of length ${[...lengths].join('/')}`);
				continue;
			}

			const usable: [string, number[]][] = [];
			for (const [scenario, thresholds] of scenarios) {
				const problem = ladderProblem(thresholds);
				if (problem) skipped.push(`${where}: "${scenario}" has ${problem}`);
				else usable.push([scenario, thresholds]);
			}
			if (usable.length === 0) continue;

			const i = benchmarks.length;
			benchmarks.push({
				id,
				name,
				difficulty: difficulty.difficultyName,
				ranks: rankNames.map((rank) => ({ name: rank, color: difficulty.rankColors[rank]! })),
			});
			keys.push({ familyOrder: familyOrder.get(family)!, season, position: at });
			for (const [scenario, thresholds] of usable) {
				let list = byScenario.get(scenario);
				if (!list) byScenario.set(scenario, (list = []));
				list.push([i, thresholds]);
			}
		}
	});

	const order = (a: SnapshotCandidate, b: SnapshotCandidate) => {
		const p = keys[a[0]]!;
		const q = keys[b[0]]!;
		return p.familyOrder - q.familyOrder || q.season - p.season || p.position - q.position;
	};
	const scenarios: Record<string, SnapshotCandidate[]> = {};
	for (const name of [...byScenario.keys()].sort(byCodeUnit)) scenarios[name] = byScenario.get(name)!.sort(order);
	return { benchmarks, scenarios, skipped };
}

function byCodeUnit(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Serialise (B3)                                                      */
/* ------------------------------------------------------------------ */

/** The file body after `generatedAt`: one benchmark and one scenario per line. */
function body(built: Pick<Built, 'benchmarks' | 'scenarios'>): string {
	const benchmarks = built.benchmarks.map((b) => `\t\t${JSON.stringify(b)}`).join(',\n');
	const names = Object.keys(built.scenarios).sort(byCodeUnit);
	const scenarios = names.map((name) => `\t\t${JSON.stringify(name)}: ${JSON.stringify(built.scenarios[name])}`).join(',\n');
	return `\t"benchmarks": [\n${benchmarks}\n\t],\n\t"scenarios": {\n${scenarios}\n\t}\n}\n`;
}

/**
 * The snapshot file. `generatedAt` is carried over from `previous` (the
 * existing file's text) unless the content changed, so an unchanged run
 * produces no diff.
 */
export function serialize(built: Pick<Built, 'benchmarks' | 'scenarios'>, previous: string | null, now: string): string {
	const content = body(built);
	let generatedAt = now;
	if (previous !== null) {
		try {
			const old = JSON.parse(previous) as Snapshot;
			if (old.version === 1 && typeof old.generatedAt === 'string' && body(old) === content) generatedAt = old.generatedAt;
		} catch {
			// An unreadable previous file is simply replaced.
		}
	}
	return `{\n\t"version": 1,\n\t"generatedAt": ${JSON.stringify(generatedAt)},\n${content}`;
}
