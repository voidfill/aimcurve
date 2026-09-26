/**
 * `pnpm shots`: captures the link-preview image and the README screenshots
 * from a running dev server, with headless Chrome over the DevTools protocol.
 * No dependencies: Node's own WebSocket and fetch.
 *
 *   public/og.png            #/dev/card, the whole 1200×630 viewport
 *   docs/images/pace.png     About's pace chart   ([data-shot="pace"])
 *   docs/images/bots.png     About's bot table    ([data-shot="bots"])
 *   docs/images/progress.png About's progression ([data-shot="progress"])
 *
 * Needs `pnpm dev` running (or BASE_URL). Chrome is found at its usual install
 * path, or set CHROME. Uses a throwaway profile, so it never touches your data.
 * See docs/preview-assets.md.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321/';
const PORT = 9333;
const CHROMES = [
	process.env.CHROME,
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
];

const chrome = CHROMES.find((p): p is string => !!p && existsSync(p));
if (!chrome) throw new Error('Chrome not found: set CHROME to its executable');
await fetch(BASE).catch(() => {
	throw new Error(`Nothing at ${BASE}: start \`pnpm dev\` first, or set BASE_URL`);
});

const profile = mkdtempSync(join(tmpdir(), 'aimcurve-shots-'));
const browser = spawn(chrome, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], {
	stdio: 'ignore',
});

try {
	const target = await retry(async () => {
		const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
		return list.find((t) => t.type === 'page')!.webSocketDebuggerUrl;
	});
	const cdp = await connect(target);

	async function open(hash: string, width: number, height: number, ready: string): Promise<void> {
		await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
		await cdp('Page.navigate', { url: new URL(hash, BASE).href });
		// Charts draw on canvas after the demo snapshot and the benchmark ladder load.
		await retry(async () => {
			const { result } = await cdp('Runtime.evaluate', { expression: ready, returnByValue: true });
			if (result.value !== true) throw new Error(`not ready: ${ready}`);
		});
		await new Promise((r) => setTimeout(r, 500));
	}

	async function shoot(selector: string, file: string): Promise<void> {
		const { result } = await cdp('Runtime.evaluate', {
			expression: `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`,
			returnByValue: true,
		});
		const [x, y, width, height] = result.value as [number, number, number, number];
		const { data } = await cdp('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 } });
		writeFileSync(file, Buffer.from(data as string, 'base64'));
		console.log(`${file}  ${Math.round(width)}×${Math.round(height)}`);
	}

	await open('#/dev/card', 1200, 630, `!!document.querySelector('[data-shot="og"] canvas')`);
	await shoot('[data-shot="og"]', 'public/og.png');

	// Tall enough that every panel is on screen; the page scrolls in `main`, not the window.
	await open('#/about', 1200, 3200, `document.querySelectorAll('[data-shot] canvas').length === 2 && !!document.querySelector('[data-shot="bots"]')`);
	for (const name of ['pace', 'bots', 'progress']) await shoot(`[data-shot="${name}"]`, `docs/images/${name}.png`);
} finally {
	browser.kill();
	await new Promise((r) => setTimeout(r, 500));
	rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}

async function retry<T>(fn: () => Promise<T>, tries = 60): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await fn();
		} catch (err) {
			if (i >= tries) throw err;
			await new Promise((r) => setTimeout(r, 250));
		}
	}
}

type Call = (method: string, params?: object) => Promise<Record<string, any>>;

async function connect(url: string): Promise<Call> {
	const ws = new WebSocket(url);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	let id = 0;
	const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
	ws.onmessage = (event) => {
		const msg = JSON.parse(String(event.data));
		const p = pending.get(msg.id);
		if (!p) return;
		pending.delete(msg.id);
		if (msg.error) p.reject(new Error(msg.error.message));
		else p.resolve(msg.result);
	};
	return (method, params = {}) =>
		new Promise((resolve, reject) => {
			pending.set(++id, { resolve, reject });
			ws.send(JSON.stringify({ id, method, params }));
		});
}
