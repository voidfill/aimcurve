/**
 * R5/R6 of the Run view design: bot encounters on the chart and the bot table.
 * See docs/superpowers/specs/2026-09-24-run-view-design.md.
 *
 * Bots touch the scoring model only through placement (`x` spans) and
 * contribution (Δu across a span), per scoring D8. A bot is engaged from
 * `kill − TTK` to its kill; the time between one kill and the next engagement
 * is dead time, which belongs to no bot.
 */
import { atTime, type RunCurve } from '../scoring';

/** Per-kill detail in kill order, aligned with the scoring input's kill offsets. */
export interface KillDetail {
	bot: readonly string[];
	hits: readonly number[];
	shots: readonly number[];
	/** Seconds from the start of the engagement to the kill. */
	ttk: readonly number[];
}

/** When each killed bot was engaged, in seconds of the run's own clock. */
export interface Engagement {
	index: number;
	bot: string;
	start: number;
	end: number;
}

/**
 * Engagements from kill times and TTK. A start is held between the previous
 * kill and its own kill, so engagements never overlap and a TTK longer than
 * the gap since the last kill cannot reach back past it.
 */
export function engagements(kills: KillDetail, times: readonly number[] | null): Engagement[] {
	if (times === null || times.length !== kills.bot.length) return [];
	let previous = 0;
	return times.map((end, index) => {
		const start = Math.min(end, Math.max(previous, end - (kills.ttk[index] ?? 0)));
		previous = end;
		return { index, bot: kills.bot[index]!, start, end };
	});
}

/** One engagement placed on the chart: its span in progress, 0 → 1. */
export interface Encounter {
	index: number;
	bot: string;
	x0: number;
	x1: number;
}

/** Run B's six tints. */
export const BOT_TINTS = ['#4d6b86', '#6b5a86', '#4f7a63', '#86694d', '#5c7a8a', '#7a5c6b'] as const;

/**
 * A tint per bot name, assigned in sorted-name order so a bot keeps its color
 * across runs of the same scenario. Kill-table bot names are not the
 * `added_bots` file names, so that order is not usable here.
 */
export function botColors(names: readonly string[]): Map<string, string> {
	const sorted = [...new Set(names)].sort();
	return new Map(sorted.map((name, i) => [name, BOT_TINTS[i % BOT_TINTS.length]!]));
}

/**
 * Chart spans. Race: slot `k` is `[k/N, (k+1)/N]`, the same in every run; dead
 * time adds no progress, so it has no width there. Clock: the engagement's
 * own times over `T`, with dead time left between spans.
 */
export function encounters(curve: RunCurve, engaged: readonly Engagement[]): Encounter[] {
	const { params } = curve;
	if (params.kind === 'race') {
		const n = params.bots;
		return engaged.map((e) => ({ index: e.index, bot: e.bot, x0: e.index / n, x1: (e.index + 1) / n }));
	}
	const x = (t: number) => Math.min(1, t / params.durationS);
	return engaged.map((e) => ({ index: e.index, bot: e.bot, x0: x(e.start), x1: x(e.end) }));
}

/** Seconds of dead time: before the first engagement and between the others. */
export function deadTime(engaged: readonly Engagement[]): number {
	let dead = 0;
	let previous = 0;
	for (const e of engaged) {
		dead += e.start - previous;
		previous = e.end;
	}
	return dead;
}

export interface RaceRow {
	slot: number;
	bot: string;
	/** Seconds engaged on this slot's bot, dead time excluded. */
	split: number;
	baseline: number | null;
	/** `baseline − split`: positive means faster. */
	delta: number | null;
	best: number;
	/** `best − split`: never positive. */
	deltaBest: number;
}

export interface RaceTable {
	rows: RaceRow[];
	/** Dead time in seconds, this run and the baseline. */
	dead: { split: number; baseline: number | null; delta: number | null };
}

/** The fastest engaged split per slot over `runs` (candidates and the inspected run). */
export function bestSplits(runs: readonly (readonly Engagement[])[], slots: number): number[] {
	const best = new Array<number>(slots).fill(Number.POSITIVE_INFINITY);
	for (const engaged of runs) {
		if (engaged.length !== slots) continue;
		engaged.forEach((e, k) => (best[k] = Math.min(best[k]!, e.end - e.start)));
	}
	return best;
}

export function raceRows(
	engaged: readonly Engagement[],
	baseline: readonly Engagement[] | null,
	best: readonly number[],
): RaceTable {
	const base = baseline && baseline.length === engaged.length ? baseline : null;
	const rows = engaged.map((e, k) => {
		const split = e.end - e.start;
		const other = base ? base[k]!.end - base[k]!.start : null;
		const fastest = Math.min(best[k] ?? split, split);
		return {
			slot: k,
			bot: e.bot,
			split,
			baseline: other,
			delta: other === null ? null : other - split,
			best: fastest,
			deltaBest: fastest - split,
		};
	});
	const dead = deadTime(engaged);
	const baseDead = base ? deadTime(base) : null;
	return { rows, dead: { split: dead, baseline: baseDead, delta: baseDead === null ? null : baseDead - dead } };
}

export interface ClockRow {
	bot: string;
	/** Seconds engaged with this bot. */
	time: number;
	encounters: number;
	hits: number;
	shots: number;
	accuracy: number | null;
	/** Δu over this bot's engagements: points gained while engaged. */
	points: number;
	baseline: number | null;
	/** `points − baseline`. */
	delta: number | null;
}

export interface ClockTable {
	rows: ClockRow[];
	/** Time and points outside every engagement, before the last kill. */
	dead: { time: number; points: number };
	/** After the last kill: a bot engaged but not killed before time ran out. */
	tail: { time: number; points: number };
}

function gained(curve: RunCurve, from: number, to: number): number {
	return atTime(curve, to).u - atTime(curve, from).u;
}

function pointsByBot(curve: RunCurve, engaged: readonly Engagement[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const e of engaged) out.set(e.bot, (out.get(e.bot) ?? 0) + gained(curve, e.start, e.end));
	return out;
}

/**
 * One row per bot, in order of first appearance. With a baseline, a bot the
 * baseline never met counts as 0 points there. Rows, dead time and the tail
 * add up to the run's duration and final score.
 */
export function clockRows(
	curve: RunCurve,
	engaged: readonly Engagement[],
	kills: KillDetail,
	baseline: { curve: RunCurve; engaged: readonly Engagement[] } | null,
): ClockTable {
	const duration = curve.params.kind === 'clock' ? curve.params.durationS : 0;
	const base = baseline ? pointsByBot(baseline.curve, baseline.engaged) : null;
	const rows = new Map<string, ClockRow>();
	let deadPoints = 0;
	let previous = 0;
	for (const e of engaged) {
		let row = rows.get(e.bot);
		if (!row) {
			row = { bot: e.bot, time: 0, encounters: 0, hits: 0, shots: 0, accuracy: null, points: 0, baseline: null, delta: null };
			rows.set(e.bot, row);
		}
		row.time += e.end - e.start;
		row.encounters++;
		row.hits += kills.hits[e.index] ?? 0;
		row.shots += kills.shots[e.index] ?? 0;
		row.points += gained(curve, e.start, e.end);
		deadPoints += gained(curve, previous, e.start);
		previous = e.end;
	}
	for (const row of rows.values()) {
		row.accuracy = row.shots > 0 ? row.hits / row.shots : null;
		if (base) {
			row.baseline = base.get(row.bot) ?? 0;
			row.delta = row.points - row.baseline;
		}
	}
	const last = Math.min(previous, duration);
	return {
		rows: [...rows.values()],
		dead: { time: deadTime(engaged), points: deadPoints },
		tail: { time: Math.max(0, duration - last), points: curve.u[curve.u.length - 1]! - atTime(curve, last).u },
	};
}

/** The index of the row with the largest loss, or null when nothing was lost. */
export function largestLoss<T extends { delta: number | null }>(rows: readonly T[]): number | null {
	let worst: number | null = null;
	rows.forEach((row, i) => {
		if (row.delta !== null && row.delta < 0 && (worst === null || row.delta < rows[worst]!.delta!)) worst = i;
	});
	return worst;
}
