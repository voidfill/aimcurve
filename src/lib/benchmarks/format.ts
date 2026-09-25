/** How a benchmark rank is shown: the gap text and the rank colours (B6, B7). */
import { formatScore, formatValue } from '../run/format';

/**
 * The gap to the next rank, unsigned: `47 to Gold`, or `2.31 s to Gold` on a
 * race, where a score difference is a time difference. Without a curve the kind
 * is unknown, and the gap is in points.
 */
export function formatGap(gap: number, rankName: string, kind: 'clock' | 'race' | null): string {
	return kind === 'race' ? `${formatValue(gap, 2)} s to ${rankName}` : `${formatScore(gap)} to ${rankName}`;
}

function rgb(hex: string): [number, number, number] | null {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Black or white, whichever contrasts more with the swatch. */
export function inkFor(color: string): '#000000' | '#ffffff' {
	const c = rgb(color);
	if (!c) return '#ffffff';
	const l = luminance(c);
	return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

/** The colour with its HSL lightness clamped to [45 %, 80 %], for lines and labels on the dark chart. */
export function chartColor(color: string): string {
	const c = rgb(color);
	if (!c) return '#8b9299';
	const [r, g, b] = c.map((v) => v / 255) as [number, number, number];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	let h = 0;
	let s = 0;
	if (d !== 0) {
		s = d / (1 - Math.abs(2 * l - 1));
		h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	const clamped = Math.min(0.8, Math.max(0.45, l));
	return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(clamped * 100)}%)`;
}
