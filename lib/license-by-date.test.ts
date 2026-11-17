import { describe, it, expect } from 'vitest';
import { chooseLicenseByDate, licenseDay, purchaseDay } from './license-by-date';
import type { LicenseData } from './license-matching';

const GIFT = 'Gift/Guest Pass';
const STORE = 'Steam Store';

// Seconds since the epoch at noon UTC on a date like "Sep 16, 2015"
const at = (date: string) => Date.parse(`${date} 12:00 UTC`) / 1000;

const licenses = (rows: [string, string, string][]) =>
	new Map<string, LicenseData>(rows.map(([name, date, acquisition]) => [name, { date, acquisition }]));

// Real rows from a user's license history
const history = licenses([
	['Magicka 2 Sneak Peek Gift', 'Mar 7, 2015', GIFT],
	['Magicka 2 - 4 Pack', 'Sep 16, 2015', STORE],
	['Amnesia: The Dark Descent', 'Sep 16, 2015', 'Complimentary'],
	['Blacklight: Retribution', 'Jan 20, 2015', 'Complimentary'],
	['Starbound Gift', 'Jan 21, 2015', GIFT],
	['Magicka', 'Nov 3, 2013', STORE],
	["Don't Starve", 'Nov 27, 2014', STORE],
	["Don't Starve - Reign of Giants", 'Nov 27, 2014', STORE],
	["Don't Starve Together Gift", 'Jan 10, 2015', GIFT],
	["Garry's Mod", 'Dec 22, 2012', GIFT],
	['Total War: WARHAMMER III', 'May 24, 2025', GIFT],
	['Total War: WARHAMMER III - Blood for the Blood God', 'May 24, 2025', STORE],
	['Humble Bundle Game A', 'Jun 1, 2020', 'Retail'],
	['Humble Bundle Game B', 'Jun 1, 2020', 'Retail'],
	['Free Weekend Thing', 'Jul 3, 2021', 'Complimentary'],
	['Other Gift', 'Jul 3, 2021', GIFT],
]);

describe('licenseDay and purchaseDay', () => {
	it('put a license date and a purchase time on the same day', () => {
		expect(licenseDay('Sep 16, 2015')).toBe(purchaseDay(at('Sep 16, 2015')));
	});

	it('return null for an unreadable date or no purchase time', () => {
		expect(licenseDay('not a date')).toBeNull();
		expect(purchaseDay(0)).toBeNull();
		expect(purchaseDay(undefined)).toBeNull();
	});
});

describe('chooseLicenseByDate', () => {
	it('picks the copy bought later over a preview gift the name match chose', () => {
		const synced = { name: 'Magicka 2 Sneak Peek Gift', ...history.get('Magicka 2 Sneak Peek Gift')! };
		const chosen = chooseLicenseByDate(at('Sep 16, 2015'), synced, history, 'Magicka 2');
		expect(chosen?.licenseKey).toBe('Magicka 2 - 4 Pack');
		expect(chosen?.data.acquisition).toBe(STORE);
		expect(chosen?.how).toBe('name-among-that-day');
	});

	it('prefers a license named like the game from the next day over an unrelated one on the purchase day', () => {
		const chosen = chooseLicenseByDate(at('Jan 20, 2015'), null, history, 'Starbound - Unstable');
		expect(chosen?.licenseKey).toBe('Starbound Gift');
	});

	it('picks by name among licenses from the purchase day', () => {
		const chosen = chooseLicenseByDate(at('Nov 27, 2014'), null, history, "Don't Starve");
		expect(chosen?.licenseKey).toBe("Don't Starve");
		expect(chosen?.how).toBe('name-among-that-day');
	});

	it('keeps a gift from after the purchase date, when a package bought earlier gained the game later', () => {
		// Steam dates Don't Starve Together to the Don't Starve purchase, which only included it from
		// mid 2015; the gift copy came in January 2015
		const synced = { name: "Don't Starve Together Gift", ...history.get("Don't Starve Together Gift")! };
		const chosen = chooseLicenseByDate(at('Nov 27, 2014'), synced, history, "Don't Starve Together");
		expect(chosen?.licenseKey).toBe("Don't Starve Together Gift");
		expect(chosen?.data.acquisition).toBe(GIFT);
		expect(chosen?.how).toBe('synced-after-purchase');
	});

	it('keeps the synced license when its date agrees', () => {
		const synced = { name: "Garry's Mod", ...history.get("Garry's Mod")! };
		const chosen = chooseLicenseByDate(at('Dec 22, 2012'), synced, history, "Garry's Mod");
		expect(chosen).toEqual({ licenseKey: "Garry's Mod", data: synced, how: 'synced-date-agrees' });
	});

	it('allows a day either side for time zones', () => {
		const synced = { name: "Garry's Mod", ...history.get("Garry's Mod")! };
		expect(chooseLicenseByDate(at('Dec 23, 2012'), synced, history, "Garry's Mod")?.how).toBe('synced-date-agrees');
		expect(chooseLicenseByDate(at('Dec 21, 2012'), null, history, "Garry's Mod")?.licenseKey).toBe("Garry's Mod");
		expect(chooseLicenseByDate(at('Dec 25, 2012'), null, history, "Garry's Mod")).toBeNull();
	});

	it('matches a game whose license has a different name when it is the only license that day', () => {
		// e.g. a translated library title, or a package named nothing like the game
		const chosen = chooseLicenseByDate(at('Dec 22, 2012'), null, history, 'ゲーリーズモッド');
		expect(chosen?.licenseKey).toBe("Garry's Mod");
		expect(chosen?.how).toBe('only-license-that-day');
	});

	it('gives up on a translated title when the purchase day has licenses got different ways', () => {
		expect(chooseLicenseByDate(at('Sep 16, 2015'), null, history, 'マジカ2')).toBeNull();
	});

	it('picks the game over its DLC bought the same day', () => {
		const chosen = chooseLicenseByDate(at('May 24, 2025'), null, history, 'Total War: WARHAMMER III');
		expect(chosen?.licenseKey).toBe('Total War: WARHAMMER III');
		expect(chosen?.data.acquisition).toBe(GIFT);
	});

	it('accepts any license from a same-day bundle when they were all got the same way', () => {
		const chosen = chooseLicenseByDate(at('Jun 1, 2020'), null, history, 'Something Else');
		expect(chosen?.data.acquisition).toBe('Retail');
	});

	it('gives up when same-day licenses were got different ways and no name matches', () => {
		expect(chooseLicenseByDate(at('Jul 3, 2021'), null, history, 'Something Else')).toBeNull();
	});

	it('gives up without a purchase time, or with no license near it', () => {
		const synced = { name: "Garry's Mod", ...history.get("Garry's Mod")! };
		expect(chooseLicenseByDate(0, synced, history, "Garry's Mod")).toBeNull();
		expect(chooseLicenseByDate(at('Jan 1, 2001'), null, history, "Garry's Mod")).toBeNull();
	});

	it('sets aside a synced license from before the purchase date when nothing that day replaces it', () => {
		// The caller then falls back to the synced license, as before
		const synced = { name: "Garry's Mod", ...history.get("Garry's Mod")! };
		expect(chooseLicenseByDate(at('Jan 1, 2030'), synced, history, "Garry's Mod")).toBeNull();
	});
});
