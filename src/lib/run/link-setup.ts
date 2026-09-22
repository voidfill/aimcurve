/**
 * The Command Prompt script that moves KovaaK's output folders somewhere a
 * browser may read, and links them back so the game notices nothing.
 *
 * Chromium refuses `Program Files`, `Windows`, `ProgramData` and every
 * `AppData` folder outright, and it canonicalizes the picked path before that
 * check — so a link pointing *into* one of them is refused just the same. The
 * only shape that works is this one: the real folders live under the user
 * profile, and the link sits inside the game's own tree.
 *
 * The script is built here, away from the component, because it is a string
 * the user pastes into an elevated shell. The path is theirs, so it is checked
 * for anything `cmd` would read as syntax rather than as a path.
 */

export const DEFAULT_KOVAAKS_PATH =
	'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FPSAimTrainer\\FPSAimTrainer';

/** Where the moved folders end up. `%USERPROFILE%` is never on the blocklist. */
export const LINK_TARGET = '%USERPROFILE%\\aimcurve';

export type ScriptResult = { ok: true; script: string } | { ok: false; reason: string };

/**
 * `"` would close our quoting; `&`, `|`, `<`, `>` and `^` are separators and
 * escapes; `%` would expand a variable of the user's choosing; a newline would
 * append a command of its own. None of them belong in a Windows path, so
 * rejecting is honest rather than restrictive.
 */
const UNSAFE = /["&|<>^%\r\n]/;

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
 * `set K=` carries the path so it appears exactly once: the only line the user
 * has to read against their own machine is the one they just filled in.
 */
export function buildScript(input: string): ScriptResult {
	const path = clean(input);
	if (path === '') return { ok: false, reason: 'Paste the folder that holds stats and performances.' };
	if (UNSAFE.test(path)) return { ok: false, reason: 'That does not look like a folder path.' };
	if (!ABSOLUTE.test(path)) return { ok: false, reason: 'Paste the full path, starting with a drive letter.' };

	return {
		ok: true,
		script: [
			`set K=${path}`,
			`md "${LINK_TARGET}"`,
			`move "%K%\\stats" "${LINK_TARGET}\\stats"`,
			`move "%K%\\performances" "${LINK_TARGET}\\performances"`,
			`mklink /J "%K%\\stats" "${LINK_TARGET}\\stats"`,
			`mklink /J "%K%\\performances" "${LINK_TARGET}\\performances"`,
		].join('\n'),
	};
}
