/**
 * Regenerates src/data/benchmarks.json from Evxl and KovaaK's (B1, B2 of the
 * benchmark ranks design). Run by hand with `pnpm gen:benchmarks`, then review
 * the summary and commit the result.
 *
 * One Evxl request, then one KovaaK's request per difficulty, one at a time.
 * A request that still fails after its retries fails the whole run, and nothing
 * is written: a partial snapshot would silently drop benchmarks.
 */
import { readFile, writeFile } from 'node:fs/promises';
import {
	buildSnapshot,
	type EvxlBenchmark,
	type KovaaksResponse,
	serialize,
} from '../src/lib/benchmarks/snapshot.ts';

const OUT = new URL('../src/data/benchmarks.json', import.meta.url);
const EVXL = 'https://evxl.app/data/benchmarks';
const KOVAAKS = 'https://kovaaks.com/webapp-backend/benchmarks/player-progress-rank-benchmark';
const HEADERS = { 'User-Agent': 'aimcurve-benchmarks (+https://github.com/voidfill/aimcurve)', Accept: 'application/json' };
const SPACING_MS = 500;
const TIMEOUT_MS = 30_000;
const RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let last = 0;

async function getJson<T>(url: string): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		const wait = last + SPACING_MS - Date.now();
		if (wait > 0) await sleep(wait);
		last = Date.now();
		let retryAfter: number | null = null;
		let reason: string;
		try {
			const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
			if (response.ok) return (await response.json()) as T;
			reason = `HTTP ${response.status}`;
			if (response.status !== 429 && response.status < 500) throw new Error(`${url}: ${reason}`);
			const header = Number(response.headers.get('Retry-After'));
			if (Number.isFinite(header) && header > 0) retryAfter = header * 1000;
		} catch (err) {
			if (err instanceof Error && err.message.startsWith(url)) throw err;
			reason = err instanceof Error ? err.message : String(err);
		}
		if (attempt >= RETRIES) throw new Error(`${url}: ${reason} after ${RETRIES} retries`);
		const backoff = retryAfter ?? 2000 * 2 ** attempt;
		console.warn(`  ${reason}; retrying in ${Math.round(backoff / 1000)} s`);
		await sleep(backoff);
	}
}

const index = await getJson<EvxlBenchmark[]>(EVXL);
const visible = index.filter((b) => b.hidden !== true);
const ids = visible.flatMap((b) => b.difficulties.map((d) => d.kovaaksBenchmarkId));
console.log(`Evxl: ${index.length} benchmarks (${index.length - visible.length} hidden), ${ids.length} difficulties`);

const responses = new Map<number, KovaaksResponse>();
for (const [i, id] of ids.entries()) {
	process.stdout.write(`\rKovaaK's: ${i + 1}/${ids.length}`);
	responses.set(id, await getJson<KovaaksResponse>(`${KOVAAKS}?benchmarkId=${id}&steamId=00000000000000000`));
}
process.stdout.write('\n');

const built = buildSnapshot(index, responses);
let previous: string | null = null;
try {
	previous = await readFile(OUT, 'utf8');
} catch {
	// First run.
}
const text = serialize(built, previous, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
await writeFile(OUT, text);

console.log(
	`Wrote ${built.benchmarks.length} benchmarks, ${Object.keys(built.scenarios).length} scenarios, ` +
		`${(text.length / 1024).toFixed(0)} KB${text === previous ? ' (unchanged)' : ''}`,
);
if (built.skipped.length > 0) {
	console.log(`Skipped ${built.skipped.length}:`);
	for (const line of built.skipped) console.log(`  ${line}`);
}
