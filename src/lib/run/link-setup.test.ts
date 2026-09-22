import { describe, expect, it } from 'vitest';
import { buildScript, DEFAULT_KOVAAKS_PATH } from './link-setup';

/** The line the pasted path lands on, without the `set K=` prefix. */
function pathLine(script: string): string {
	const first = script.split('\n')[0] ?? '';
	expect(first.startsWith('set K=')).toBe(true);
	return first.slice('set K='.length);
}

describe('buildScript', () => {
	it('puts the default path on the first line and nowhere else', () => {
		const result = buildScript(DEFAULT_KOVAAKS_PATH);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(pathLine(result.script)).toBe(DEFAULT_KOVAAKS_PATH);
		expect(result.script.split('\n').slice(1).join('\n')).not.toContain('FPSAimTrainer');
	});

	it('moves and links both output folders', () => {
		const result = buildScript(DEFAULT_KOVAAKS_PATH);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.script.split('\n')).toEqual([
			`set K=${DEFAULT_KOVAAKS_PATH}`,
			'md "%USERPROFILE%\\aimcurve"',
			'move "%K%\\stats" "%USERPROFILE%\\aimcurve\\stats"',
			'move "%K%\\performances" "%USERPROFILE%\\aimcurve\\performances"',
			'mklink /J "%K%\\stats" "%USERPROFILE%\\aimcurve\\stats"',
			'mklink /J "%K%\\performances" "%USERPROFILE%\\aimcurve\\performances"',
		]);
	});

	it('keeps a path on another drive', () => {
		const result = buildScript('D:\\SteamLibrary\\steamapps\\common\\FPSAimTrainer\\FPSAimTrainer');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(pathLine(result.script)).toBe('D:\\SteamLibrary\\steamapps\\common\\FPSAimTrainer\\FPSAimTrainer');
	});

	it('drops surrounding whitespace, which cmd would otherwise keep in the variable', () => {
		const result = buildScript(`  ${DEFAULT_KOVAAKS_PATH}  `);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(pathLine(result.script)).toBe(DEFAULT_KOVAAKS_PATH);
	});

	it('drops the quotes Windows adds to a copied path', () => {
		const result = buildScript(`"${DEFAULT_KOVAAKS_PATH}"`);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(pathLine(result.script)).toBe(DEFAULT_KOVAAKS_PATH);
	});

	it('drops a trailing separator so no line doubles it', () => {
		const result = buildScript(`${DEFAULT_KOVAAKS_PATH}\\`);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(pathLine(result.script)).toBe(DEFAULT_KOVAAKS_PATH);
	});

	it('rejects an empty path', () => {
		expect(buildScript('   ').ok).toBe(false);
	});

	it('rejects a path that does not start at a drive letter', () => {
		expect(buildScript('steamapps\\common\\FPSAimTrainer').ok).toBe(false);
		expect(buildScript('\\\\nas\\games\\FPSAimTrainer').ok).toBe(false);
	});

	// Everything below would end up verbatim in an elevated Command Prompt.
	it.each([
		['a quote', 'C:\\games\\FPS"AimTrainer'],
		['an ampersand', 'C:\\games\\FPS & AimTrainer'],
		['a pipe', 'C:\\games\\FPS|AimTrainer'],
		['a redirect', 'C:\\games\\FPS>AimTrainer'],
		['an escape', 'C:\\games\\FPS^AimTrainer'],
		['a variable expansion', 'C:\\games\\%TEMP%'],
		['a newline', 'C:\\games\\FPSAimTrainer\nformat c:'],
	])('rejects %s', (_label, path) => {
		expect(buildScript(path).ok).toBe(false);
	});
});
