import { describe, expect, it } from 'vitest';
import { chartColor, formatGap, inkFor } from './format';

describe('B6 gap', () => {
	it('is in points on a clock scenario and without a curve', () => {
		expect(formatGap(47, 'Gold', 'clock')).toBe('47 to Gold');
		expect(formatGap(12.5, 'Gold', null)).toBe('12.5 to Gold');
	});

	it('is in seconds on a race', () => {
		expect(formatGap(2.314, 'Gold', 'race')).toBe('2.31 s to Gold');
	});
});

describe('rank colours', () => {
	it('inks a light swatch black and a dark one white', () => {
		expect(inkFor('#B9F2FF')).toBe('#000000');
		expect(inkFor('#000000')).toBe('#ffffff');
		expect(inkFor('#7900FF')).toBe('#ffffff');
	});

	it('clamps lightness for the dark chart', () => {
		expect(chartColor('#000000')).toBe('hsl(0 0% 45%)');
		expect(chartColor('#ffffff')).toBe('hsl(0 0% 80%)');
		expect(chartColor('#CAB148')).toBe('hsl(48 55% 54%)');
	});
});
