import { describe, expect, it } from 'vitest';
import { buildScript, DEFAULT_KOVAAKS_PATH } from './link-setup';

/** The path as the first line quotes it, without the `$K = '…'` around it. */
function pathLine(script: string): string {
	const first = script.split('\n')[0] ?? '';
	expect(first.startsWith("$K = '")).toBe(true);
	expect(first.endsWith("'")).toBe(true);
	return first.slice("$K = '".length, -1);
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
			`$K = '${DEFAULT_KOVAAKS_PATH}'`,
			'$A = "$env:USERPROFILE\\aimcurve"',
			"foreach ($d in 'stats', 'performances') {",
			'  if (Test-Path "$A\\$d") { Write-Warning "$A\\$d already exists, skipping"; continue }',
			'  robocopy "$K\\$d" "$A\\$d" /E /MOVE /NFL /NDL /NJH /NP',
			'  if ($LASTEXITCODE -ge 8) { Write-Warning "Could not move $d"; continue }',
			'  New-Item -ItemType Junction -Path "$K\\$d" -Target "$A\\$d" | Out-Null',
			'}',
		]);
	});

	it('keeps a path on another drive', () => {
		const result = buildScript('D:\\SteamLibrary\\steamapps\\common\\FPSAimTrainer\\FPSAimTrainer');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(pathLine(result.script)).toBe('D:\\SteamLibrary\\steamapps\\common\\FPSAimTrainer\\FPSAimTrainer');
	});

	it('drops surrounding whitespace, which would otherwise end up in the path', () => {
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

	it('doubles an apostrophe so it stays inside the quoted path', () => {
		const result = buildScript("D:\\Games\\Kovaak's\\FPSAimTrainer");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(pathLine(result.script)).toBe("D:\\Games\\Kovaak''s\\FPSAimTrainer");
	});

	// Inside single quotes these are plain characters, and all are legal in a
	// Windows path, so cmd's old objections to them no longer apply.
	it.each([
		['an ampersand', 'C:\\games\\FPS & AimTrainer'],
		['a percent sign', 'C:\\games\\100%'],
		['a dollar sign', 'C:\\games\\$FPS'],
	])('keeps %s as written', (_label, path) => {
		const result = buildScript(path);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(pathLine(result.script)).toBe(path);
	});

	it('rejects an empty path', () => {
		expect(buildScript('   ').ok).toBe(false);
	});

	it('rejects a path that does not start at a drive letter', () => {
		expect(buildScript('steamapps\\common\\FPSAimTrainer').ok).toBe(false);
		expect(buildScript('\\\\nas\\games\\FPSAimTrainer').ok).toBe(false);
	});

	// Everything below would end up verbatim in an elevated PowerShell.
	it.each([
		['a double quote', 'C:\\games\\FPS"AimTrainer'],
		['a typographic quote', 'C:\\games\\Kovaak\u2019s'],
		['a newline', "C:\\games\\FPSAimTrainer\n'; Remove-Item C:\\ -Recurse; '"],
	])('rejects %s', (_label, path) => {
		expect(buildScript(path).ok).toBe(false);
	});
});
