/** Shared number and time formatting for the Run view. */

export const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const clockFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

const formats = new Map<number, Intl.NumberFormat>();

function numberFormat(digits: number): Intl.NumberFormat {
	let format = formats.get(digits);
	if (!format) {
		format = new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
		formats.set(digits, format);
	}
	return format;
}

export function formatValue(value: number, digits = 0): string {
	return numberFormat(digits).format(value);
}

const scoreFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** A CSV score: as recorded, up to two decimals and no forced zeros. */
export function formatScore(value: number): string {
	return scoreFormat.format(value);
}

/** Always signed, with a true minus sign; zero is unsigned. */
export function formatSigned(value: number, digits = 0): string {
	const text = numberFormat(digits).format(Math.abs(value));
	if (Number(text.replace(/[^\d.]/g, '')) === 0) return text;
	return `${value > 0 ? '+' : '−'}${text}`;
}

export function formatDuration(seconds: number): string {
	if (seconds < 60) return `${formatValue(seconds, 1)} s`;
	const whole = Math.round(seconds);
	return `${Math.floor(whole / 60)} min ${String(whole % 60).padStart(2, '0')} s`;
}
