/**
 * KovaaK's `... Performance.perf` — the protobuf companion to a `Stats.csv`.
 *
 * `proto/perf.proto` describes the wire format; this module turns it into the
 * shape ingest wants, which is a *tick table* rather than an event log. The
 * pivot is lossless: `(timestamp, event type)` is unique across all 2164 files
 * in the dump, 815,361 events for 815,361 distinct pairs, so nothing has to be
 * merged or discarded to make a run's events rectangular.
 */
import { fromBinary } from '@bufbuild/protobuf';
import { type Event, PerformanceFileSchema } from '../../gen/perf_pb';

/** Thrown when a `.perf` carries something this schema has no column for. */
export class PerfError extends Error {
	override readonly name = 'PerfError';
}

/**
 * The 13 event types observed in the corpus, in `run_series` column order.
 *
 * Fields 9, 16, 17 and 18 (`deaths`, `targetSize`, `targetSpeed`,
 * `randomSensScale`) are deliberately absent: they have never been observed, so
 * they have no column, and encountering one raises rather than being dropped.
 * Adding one is a migration plus a reingest.
 */
export const TICK_METRICS = [
	'shotsFired',
	'shotsHit',
	'shotsMissed',
	'damageDone',
	'damagePossible',
	'score',
	'kills',
	'overshots',
	'playerDamageTaken',
	'reloads',
	'pauseCount',
	'distanceTraveled',
	'mbsPoints',
] as const;

export type TickMetric = (typeof TICK_METRICS)[number];

const KNOWN = new Set<string>(TICK_METRICS);

export interface PerfHeader {
	scenarioName: string;
	scenarioHash: string;
	/** Epoch milliseconds, truncated to the whole second by the format. */
	challengeStartUtcMs: number;
	schemaVersion: number;
	timeLimit: number | null;
	playerProfile: string | null;
	addedBots: string[];
	playerMaxLives: number | null;
	botMaxLives: number[] | null;
	playerTeam: number | null;
	botTeams: number[] | null;
	mapName: string | null;
	mapScale: number | null;
	timescale: number | null;
	endChallengeAfterKills: number | null;
	endChallengeAfterDamage: number | null;
}

export interface PerfTicks {
	/** Seconds since challenge start, strictly ascending. */
	t: number[];
	/**
	 * One column per metric, aligned to `t`. The whole column is `null` when the
	 * run never emitted that event — which the vendor documents as "not
	 * applicable to this scenario" rather than zero. Inside a non-null column, a
	 * tick where the metric did not change is `null` too.
	 */
	metrics: Record<TickMetric, (number | null)[] | null>;
}

export interface Perf {
	header: PerfHeader;
	ticks: PerfTicks;
}

/** `ShotsFired{count}`, `DamageDone{delta}` and friends all carry one number. */
function payloadValue(event: Event): number {
	const value = event.payload.value as { count?: number; delta?: number } | undefined;
	return value?.count ?? value?.delta ?? 0;
}

/** Empty string and 0 mean "absent" in proto3; keep them out of the database. */
function orNull<T extends string | number>(value: T | undefined): T | null {
	return value === undefined || value === '' || value === 0 ? null : value;
}

/**
 * Parses a `.perf`.
 *
 * @throws {PerfError} on an event type with no `run_series` column.
 */
export function parsePerf(bytes: Uint8Array): Perf {
	const file = fromBinary(PerformanceFileSchema, bytes);
	const raw = file.header;
	const profile = raw?.challengeProfile;

	const header: PerfHeader = {
		scenarioName: raw?.scenarioName ?? '',
		scenarioHash: raw?.scenarioHash ?? '',
		challengeStartUtcMs: Number(raw?.challengeStartUtc ?? 0n),
		schemaVersion: raw?.schemaVersion ?? 0,
		timeLimit: orNull(profile?.timeLimit),
		playerProfile: orNull(profile?.playerProfile),
		addedBots: profile?.addedBots ?? [],
		playerMaxLives: orNull(profile?.playerMaxLives),
		botMaxLives: profile?.botMaxLives?.length ? profile.botMaxLives : null,
		playerTeam: orNull(profile?.playerTeam),
		botTeams: profile?.botTeams?.length ? profile.botTeams : null,
		mapName: orNull(profile?.mapName),
		mapScale: orNull(profile?.mapScale),
		timescale: orNull(profile?.timescale),
		endChallengeAfterKills: orNull(profile?.endChallengeAfterKills),
		endChallengeAfterDamage: orNull(profile?.endChallengeAfterDamage),
	};

	// Pivot. Events arrive ordered in every file we have, but nothing in the
	// format promises it, so the tick index is built from a map and sorted.
	const byTime = new Map<number, Map<string, number>>();
	for (const event of file.events) {
		const kind = event.payload.case;
		if (kind === undefined) continue; // an event with no payload carries nothing
		if (!KNOWN.has(kind)) {
			throw new PerfError(`unknown event type \`${kind}\` at t=${event.timestamp}`);
		}
		let tick = byTime.get(event.timestamp);
		if (tick === undefined) byTime.set(event.timestamp, (tick = new Map()));
		tick.set(kind, payloadValue(event));
	}

	const t = [...byTime.keys()].sort((a, b) => a - b);
	const metrics = {} as Record<TickMetric, (number | null)[] | null>;
	for (const key of TICK_METRICS) {
		let seen = false;
		const column = t.map((at) => {
			const value = byTime.get(at)!.get(key);
			if (value === undefined) return null;
			seen = true;
			return value;
		});
		metrics[key] = seen ? column : null;
	}

	return { header, ticks: { t, metrics } };
}
