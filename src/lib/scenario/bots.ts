/**
 * S6 of the scenario page design: bot tabs plot the pace in Run's bot table.
 * See docs/superpowers/specs/2026-09-25-scenario-page-design.md.
 *
 * Every value comes from the functions Run's bot table uses (`engagements`,
 * `clockRows`, `raceRows`), so a dot here and a row there cannot disagree.
 * Values are on the score scale the rank thresholds use: a clock bot's pace
 * as is, a race slot's pace (a race time) as `budget − pace`. The table's own
 * figure, a bot's points or a slot's split, is kept beside it.
 */
import { clockRows, engagements, isClicking, type KillDetail, raceRows } from '../run/bots';
import { comparable, curveFor, killTimes, type RunCurve, type ScoringInput } from '../scoring';

export interface BotTab {
	/** The bot name on a clock run, the slot index on a race. */
	key: string;
	label: string;
	bot: string;
}

export interface BotTabs {
	kind: 'clock' | 'race';
	tabs: BotTab[];
	/** The reference run's curve: other runs must compare with it. */
	reference: RunCurve;
}

/**
 * The tab set, from one reference run (the latest with kill detail). None for
 * a click scenario, a run that cannot be charted, or one without engagements.
 */
export function botTabs(input: ScoringInput, kills: KillDetail, window: number | null): BotTabs | null {
	const curve = curveFor(input);
	if (curve === null || isClicking(kills)) return null;
	const engaged = engagements(kills, killTimes(input), window);
	if (engaged.length === 0) return null;
	if (curve.params.kind === 'race') {
		return {
			kind: 'race',
			reference: curve,
			tabs: engaged.map((e, k) => ({ key: String(k), label: `${k + 1} · ${e.bot}`, bot: e.bot })),
		};
	}
	return {
		kind: 'clock',
		reference: curve,
		tabs: clockRows(curve, engaged, kills, null).rows.map((row) => ({ key: row.bot, label: row.bot, bot: row.bot })),
	};
}

export interface BotSeries {
	/**
	 * Tab key → one pace per run on the score scale, in run order; null where
	 * Run's table has no row or no pace.
	 */
	values: Map<string, (number | null)[]>;
	/** Tab key → the table's figure per run: points on a clock run, the split on a race. */
	raw: Map<string, (number | null)[]>;
	/** Runs with at least one value. */
	covered: number;
}

/**
 * One value per run and tab. A run has no values when it has no `.perf` or
 * kill detail, cannot be charted, does not compare with the reference (another
 * duration or race pool), or is clicking. A clock run's bot that it never
 * engaged has no row in Run's table, so it has no value here either.
 */
export function botSeries(
	stems: readonly string[],
	tabs: BotTabs,
	inputOf: (stem: string) => ScoringInput | null | undefined,
	killsOf: (stem: string) => KillDetail | null | undefined,
	window: number | null,
): BotSeries {
	const empty = () => new Map(tabs.tabs.map((t) => [t.key, new Array<number | null>(stems.length).fill(null)]));
	const values = empty();
	const raw = empty();
	let covered = 0;
	stems.forEach((stem, i) => {
		const input = inputOf(stem);
		const kills = killsOf(stem);
		if (!input || !kills || isClicking(kills)) return;
		const curve = curveFor(input);
		if (curve === null || !comparable(tabs.reference.params, curve.params)) return;
		const engaged = engagements(kills, killTimes(input), window);
		if (engaged.length === 0) return;
		let any = false;
		if (curve.params.kind === 'race') {
			const budget = curve.params.budget;
			if (engaged.length !== tabs.tabs.length) return;
			raceRows(engaged, null, []).rows.forEach((row) => {
				values.get(String(row.slot))![i] = budget - row.pace;
				raw.get(String(row.slot))![i] = row.split;
				any = true;
			});
		} else {
			for (const row of clockRows(curve, engaged, kills, null).rows) {
				if (!values.has(row.bot)) continue;
				values.get(row.bot)![i] = row.pace;
				raw.get(row.bot)![i] = row.points;
				any = true;
			}
		}
		if (any) covered++;
	});
	return { values, raw, covered };
}
