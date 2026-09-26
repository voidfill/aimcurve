/**
 * The PowerShell script that moves KovaaK's output folders somewhere a
 * browser may read, and links them back so the game notices nothing.
 *
 * Chromium refuses `Program Files`, `Windows`, `ProgramData` and every
 * `AppData` folder outright, and it canonicalizes the picked path before that
 * check — so a link pointing *into* one of them is refused just the same. The
 * only shape that works is this one: the real folders live under the user
 * profile, and the link sits inside the game's own tree.
 *
 * PowerShell rather than cmd: the admin shell Windows offers today (right-click
 * Start → Terminal (Admin)) is PowerShell, where `set`, `%VAR%` and `mklink`
 * all quietly mean something else. `robocopy /MOVE` rather than `Move-Item`,
 * because a Steam library often sits on another drive and neither `move` nor
 * `Move-Item` will carry a folder across volumes.
 *
 * The script is built here, away from the component, because it is a string
 * the user pastes into an elevated shell. The path is theirs, so it goes in a
 * single-quoted literal, where nothing but a quote means anything.
 */

export const DEFAULT_KOVAAKS_PATH =
	'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FPSAimTrainer\\FPSAimTrainer';

/** Where the moved folders end up. The user profile is never on the blocklist. */
export const LINK_TARGET = '$env:USERPROFILE\\aimcurve';

export type ScriptResult = { ok: true; script: string } | { ok: false; reason: string };

/**
 * A newline would end the command the path sits in, and `"` never occurs in a
 * Windows path. PowerShell also closes a single-quoted string on typographic
 * quotes, so those are refused rather than trusted to escape like `'` does.
 */
const UNSAFE = /["\r\n\u2018\u2019\u201a\u201b]/;

/** A drive letter and a separator. Rules out relative paths and UNC shares. */
const ABSOLUTE = /^[A-Za-z]:\\/;

function clean(input: string): string {
	let path = input.trim();
	// Windows' "Copy as path" wraps the path in quotes.
	if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1).trim();
	// A trailing separator would double up in every line below it.
	while (path.endsWith('\\')) path = path.slice(0, -1);
	return path;
}

/**
 * `$K` carries the path so it appears exactly once: the only line the user
 * has to read against their own machine is the one they just filled in.
 *
 * A folder already in place under the profile is skipped. Running the script
 * twice would otherwise have robocopy move a junction's contents onto
 * themselves and delete them as the source.
 */
export function buildScript(input: string): ScriptResult {
	const path = clean(input);
	if (path === '') return { ok: false, reason: 'Paste the folder that holds stats and performances.' };
	if (UNSAFE.test(path)) return { ok: false, reason: 'That does not look like a folder path.' };
	if (!ABSOLUTE.test(path)) return { ok: false, reason: 'Paste the full path, starting with a drive letter.' };

	return {
		ok: true,
		script: [
			`$K = '${path.replaceAll("'", "''")}'`,
			`$A = "${LINK_TARGET}"`,
			`foreach ($d in 'stats', 'performances') {`,
			`  if (Test-Path "$A\\$d") { Write-Warning "$A\\$d already exists, skipping"; continue }`,
			`  robocopy "$K\\$d" "$A\\$d" /E /MOVE /NFL /NDL /NJH /NP`,
			`  if ($LASTEXITCODE -ge 8) { Write-Warning "Could not move $d"; continue }`,
			`  New-Item -ItemType Junction -Path "$K\\$d" -Target "$A\\$d" | Out-Null`,
			`}`,
		].join('\n'),
	};
}
