/**
 * S4 of the scenario page design: config groups.
 * See docs/superpowers/specs/2026-09-25-scenario-page-design.md.
 *
 * A group is the part of the client config that changes how aiming feels:
 * sens scale, H/V sens, DPI, FOV and FOV scale. Crosshair, resolution and the
 * other keys do not split a group.
 */

/** The S4 key fields of one run's config. */
export interface SensConfig {
	sensScale: string;
	horizSens: number;
	vertSens: number;
	dpi: number;
	fov: number;
	fovScale: string;
}

export interface GroupedRun {
	config: SensConfig;
	score: number | null;
	/** Normalized ISO timestamp, so string order is chronological order. */
	startedAt: string;
}

export interface ConfigGroup {
	key: string;
	/** 1-based, in order of first use: the `C1`, `C2` label. */
	index: number;
	label: string;
	config: SensConfig;
	/** A chart colour, or null for the neutral one. */
	color: string | null;
	runs: number;
	/** Highest score; null when no run of the group has one. */
	best: number | null;
	median: number | null;
	firstUsed: string;
	lastUsed: string;
	/** Whether the most recent run used this group. */
	current: boolean;
}

/**
 * The first three dark-mode slots of the dataviz reference palette: the most
 * that validate all-pairs for a scatter on the chart surface (CVD ΔE 9.4,
 * normal-vision ΔE 20.9, ≥ 3:1). Past three, groups share `NEUTRAL`.
 */
export const CONFIG_COLORS = ['#3987e5', '#d95926', '#199e70'] as const;
export const NEUTRAL = '#6b737b';

export function configKey(c: SensConfig): string {
	return [c.sensScale, c.horizSens, c.vertSens, c.dpi, c.fov, c.fovScale].join('\u0000');
}

export function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Groups in first-use order, plus each run's group index into that list.
 * The three most recently used groups get a colour, in the order of their
 * labels; the rest are neutral. Their labels carry identity either way.
 */
export function configGroups(runs: readonly GroupedRun[]): { groups: ConfigGroup[]; groupOf: number[] } {
	const byKey = new Map<string, { group: ConfigGroup; scores: number[] }>();
	const groupOf: number[] = [];
	const chronological = runs.map((run, i) => ({ run, i })).sort((a, b) => cmp(a.run.startedAt, b.run.startedAt) || a.i - b.i);
	for (const { run } of chronological) {
		const key = configKey(run.config);
		if (!byKey.has(key)) {
			const index = byKey.size + 1;
			byKey.set(key, {
				group: {
					key,
					index,
					label: `C${index}`,
					config: run.config,
					color: null,
					runs: 0,
					best: null,
					median: null,
					firstUsed: run.startedAt,
					lastUsed: run.startedAt,
					current: false,
				},
				scores: [],
			});
		}
	}
	const entries = [...byKey.values()];
	runs.forEach((run) => {
		const entry = byKey.get(configKey(run.config))!;
		const g = entry.group;
		g.runs++;
		if (run.startedAt < g.firstUsed) g.firstUsed = run.startedAt;
		if (run.startedAt > g.lastUsed) g.lastUsed = run.startedAt;
		if (run.score !== null && Number.isFinite(run.score)) {
			entry.scores.push(run.score);
			g.best = g.best === null ? run.score : Math.max(g.best, run.score);
		}
		groupOf.push(g.index - 1);
	});
	for (const { group, scores } of entries) group.median = median(scores);

	const groups = entries.map((e) => e.group);
	const recent = [...groups].sort((a, b) => cmp(b.lastUsed, a.lastUsed) || b.index - a.index);
	if (recent[0]) recent[0].current = true;
	recent
		.slice(0, CONFIG_COLORS.length)
		.sort((a, b) => a.index - b.index)
		.forEach((g, i) => (g.color = CONFIG_COLORS[i]!));
	return { groups, groupOf };
}

function cmp(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
