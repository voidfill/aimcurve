/**
 * R5/R6 of the Run view design: bot encounters on the chart and the bot table.
 * See docs/superpowers/specs/2026-09-24-run-view-design.md.
 *
 * Bots touch the scoring model only through placement (`x` spans) and
 * contribution (Δu across a span), per scoring D8.
 */
import { type RunCurve, uAtX } from '../scoring';

/** Per-kill detail in kill order, aligned with the scoring input's kill offsets. */
export interface KillDetail {
	bot: readonly string[];
	hits: readonly number[];
	shots: readonly number[];
}

/** One encounter: the span from the previous kill to kill `index`. */
export interface Encounter {
	index: number;
	bot: string;
	/** Progress span, 0 → 1. */
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
 * Encounter spans. Race: slot `k` is `[k/N, (k+1)/N]`, the same in every run.
 * Clock: `[t_{k−1}/T, t_k/T]` from 0, per run, from the run's own kill times.
 */
export function encounters(curve: RunCurve, kills: KillDetail, times: readonly number[] | null): Encounter[] {
	const { params } = curve;
	if (params.kind === 'race') {
		const n = params.bots;
		return Array.from({ length: n }, (_, k) => ({ index: k, bot: kills.bot[k] ?? '', x0: k / n, x1: (k + 1) / n }));
	}
	if (times === null || times.length !== kills.bot.length) return [];
	const out: Encounter[] = [];
	let x0 = 0;
	times.forEach((time, k) => {
		const x1 = Math.min(1, Math.max(x0, time / params.durationS));
		out.push({ index: k, bot: kills.bot[k]!, x0, x1 });
		x0 = x1;
	});
	return out;
}

function gained(curve: RunCurve, encounter: Encounter): number {
	return uAtX(curve, encounter.x1) - uAtX(curve, encounter.x0);
}

export interface RaceRow {
	slot: number;
	bot: string;
	/** Seconds spent on this slot, including its share of respawn gap. */
	split: number;
	baseline: number | null;
	/** `baseline − split`: positive means faster. */
	delta: number | null;
	best: number;
	/** `best − split`: never positive. */
	deltaBest: number;
}

/** The fastest split per slot over `curves` (candidates and the inspected run). */
export function bestSplits(curves: readonly RunCurve[], slots: number): number[] {
	const best = new Array<number>(slots).fill(Number.POSITIVE_INFINITY);
	for (const curve of curves) {
		if (curve.params.kind !== 'race' || curve.params.bots !== slots) continue;
		for (let k = 0; k < slots; k++) {
			best[k] = Math.min(best[k]!, uAtX(curve, (k + 1) / slots) - uAtX(curve, k / slots));
		}
	}
	return best;
}

export function raceRows(
	curve: RunCurve,
	spans: readonly Encounter[],
	baseline: RunCurve | null,
	best: readonly number[],
): RaceRow[] {
	return spans.map((encounter) => {
		const split = gained(curve, encounter);
		const base = baseline ? gained(baseline, encounter) : null;
		const fastest = Math.min(best[encounter.index] ?? split, split);
		return {
			slot: encounter.index,
			bot: encounter.bot,
			split,
			baseline: base,
			delta: base === null ? null : base - split,
			best: fastest,
			deltaBest: fastest - split,
		};
	});
}

export interface ClockRow {
	bot: string;
	/** Seconds in this bot's encounters. */
	time: number;
	encounters: number;
	hits: number;
	shots: number;
	accuracy: number | null;
	/** Δu over this bot's encounters: points gained while engaged. */
	points: number;
	baseline: number | null;
	/** `points − baseline`. */
	delta: number | null;
}

export interface ClockTable {
	rows: ClockRow[];
	/** The time and points after the last kill, up to `T`. */
	tail: { time: number; points: number };
}

function pointsByBot(curve: RunCurve, spans: readonly Encounter[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const encounter of spans) out.set(encounter.bot, (out.get(encounter.bot) ?? 0) + gained(curve, encounter));
	return out;
}

/**
 * One row per bot, in order of first appearance. With a baseline, a bot the
 * baseline never met counts as 0 points there.
 */
export function clockRows(
	curve: RunCurve,
	spans: readonly Encounter[],
	kills: KillDetail,
	baseline: { curve: RunCurve; spans: readonly Encounter[] } | null,
): ClockTable {
	const duration = curve.params.kind === 'clock' ? curve.params.durationS : 0;
	const base = baseline ? pointsByBot(baseline.curve, baseline.spans) : null;
	const rows = new Map<string, ClockRow>();
	for (const encounter of spans) {
		let row = rows.get(encounter.bot);
		if (!row) {
			row = { bot: encounter.bot, time: 0, encounters: 0, hits: 0, shots: 0, accuracy: null, points: 0, baseline: null, delta: null };
			rows.set(encounter.bot, row);
		}
		row.time += (encounter.x1 - encounter.x0) * duration;
		row.encounters++;
		row.hits += kills.hits[encounter.index] ?? 0;
		row.shots += kills.shots[encounter.index] ?? 0;
		row.points += gained(curve, encounter);
	}
	for (const row of rows.values()) {
		row.accuracy = row.shots > 0 ? row.hits / row.shots : null;
		if (base) {
			row.baseline = base.get(row.bot) ?? 0;
			row.delta = row.points - row.baseline;
		}
	}
	const lastX = spans.length > 0 ? spans[spans.length - 1]!.x1 : 0;
	const tail = {
		time: (1 - lastX) * duration,
		points: curve.u[curve.u.length - 1]! - uAtX(curve, lastX),
	};
	return { rows: [...rows.values()], tail };
}

/** The key of the row with the largest loss, or null when nothing was lost. */
export function largestLoss<T extends { delta: number | null }>(rows: readonly T[]): number | null {
	let worst: number | null = null;
	rows.forEach((row, i) => {
		if (row.delta !== null && row.delta < 0 && (worst === null || row.delta < rows[worst]!.delta!)) worst = i;
	});
	return worst;
}
