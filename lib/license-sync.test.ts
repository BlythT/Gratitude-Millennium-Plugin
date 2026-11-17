import { describe, it, expect } from 'vitest';
import { firstLicensePageUrl, licensePageCount, nextLicensePageUrl, readResumePoint, saveResumePoint, clearResumePoint, RESUME_MAX_AGE_MS, shouldSkipLicenseSync, completedLicenseCount, parseLicenseTotal, withoutExplicitSyncFlag } from './license-sync';

describe('firstLicensePageUrl', () => {
	it('asks for the first licenses page in English, whatever the client language', () => {
		const url = new URL(firstLicensePageUrl());
		expect(url.origin + url.pathname).toBe('https://store.steampowered.com/account/licenses/');
		expect(url.searchParams.get('l')).toBe('english');
	});
});

describe('nextLicensePageUrl', () => {
	it('resolves a query-only href against the licenses page', () => {
		expect(nextLicensePageUrl('?start=100')).toBe('https://store.steampowered.com/account/licenses/?start=100&l=english');
	});

	it('keeps the English page language when the paginator link drops it', () => {
		const url = new URL(nextLicensePageUrl('?start=200&l=german') ?? 'about:blank');
		expect(url.searchParams.get('l')).toBe('english');
		expect(url.searchParams.get('start')).toBe('200');
	});

	it('accepts an absolute licenses href', () => {
		expect(nextLicensePageUrl('https://store.steampowered.com/account/licenses/?start=300'))
			.toBe('https://store.steampowered.com/account/licenses/?start=300&l=english');
	});

	it('refuses a link that leaves the Steam Store', () => {
		expect(nextLicensePageUrl('https://example.com/account/licenses/?start=100')).toBeNull();
	});
});

describe('shouldSkipLicenseSync', () => {
	it('skips when the last completed sync saw the same number of licenses', () => {
		expect(shouldSkipLicenseSync(120, 120, false)).toBe(true);
		expect(shouldSkipLicenseSync('120', 120, false)).toBe(true);
	});

	it('syncs when the count changed', () => {
		expect(shouldSkipLicenseSync(119, 120, false)).toBe(false);
	});

	it('always syncs when the user asked for it', () => {
		expect(shouldSkipLicenseSync(120, 120, true)).toBe(false);
	});

	it('syncs when the page total is unknown or no sync has completed', () => {
		expect(shouldSkipLicenseSync(0, 0, false)).toBe(false);
		expect(shouldSkipLicenseSync(0, 120, false)).toBe(false);
		expect(shouldSkipLicenseSync(null, 120, false)).toBe(false);
	});
});

describe('completedLicenseCount', () => {
	it('is set only on the last page of a sync where every page was saved', () => {
		expect(completedLicenseCount({ isLastPage: true, everyPageSaved: true, pageTotal: 120, parsedTotal: 118 })).toBe(120);
	});

	it('falls back to the parsed count when the page total is unknown', () => {
		expect(completedLicenseCount({ isLastPage: true, everyPageSaved: true, pageTotal: 0, parsedTotal: 118 })).toBe(118);
	});

	it('is not set before the last page or after a failed save', () => {
		expect(completedLicenseCount({ isLastPage: false, everyPageSaved: true, pageTotal: 120, parsedTotal: 50 })).toBeUndefined();
		expect(completedLicenseCount({ isLastPage: true, everyPageSaved: false, pageTotal: 120, parsedTotal: 118 })).toBeUndefined();
	});
});

describe('parseLicenseTotal', () => {
	it('reads a plain total', () => {
		expect(parseLicenseTotal('Showing 1 - 100 of 912')).toBe(912);
	});

	it('reads a total with a thousands separator', () => {
		expect(parseLicenseTotal('Showing 1 - 100 of 1,234')).toBe(1234);
		expect(parseLicenseTotal('Showing 1 - 100 of 12 345')).toBe(12345);
	});

	it('ignores trailing text after the total', () => {
		expect(parseLicenseTotal('Showing 1 - 100 of 2,048 licenses')).toBe(2048);
	});

	it('returns 0 when there is no total', () => {
		expect(parseLicenseTotal('Showing everything')).toBe(0);
		expect(parseLicenseTotal(undefined)).toBe(0);
	});
});

describe('withoutExplicitSyncFlag', () => {
	it('removes the sync flag and keeps the rest of the URL', () => {
		expect(withoutExplicitSyncFlag('https://store.steampowered.com/?gratitude_sync=1')).toBe('https://store.steampowered.com/');
		expect(withoutExplicitSyncFlag('https://steamcommunity.com/my/friends/?a=b&gratitude_sync=1#x'))
			.toBe('https://steamcommunity.com/my/friends/?a=b#x');
	});

	it('returns null when the page was not opened by a sync link', () => {
		expect(withoutExplicitSyncFlag('https://store.steampowered.com/')).toBeNull();
		expect(withoutExplicitSyncFlag('https://store.steampowered.com/?gratitude_sync=0')).toBeNull();
		expect(withoutExplicitSyncFlag('not a url')).toBeNull();
	});
});

describe('licensePageCount', () => {
	it('works out the number of pages from the range on the page', () => {
		expect(licensePageCount('Showing licenses 1-100 of 912', 1)).toBe(10);
		expect(licensePageCount('Showing licenses 1801-1900 of 1,902', 19)).toBe(20);
	});

	it('uses the current page on the last page, whose range is short', () => {
		expect(licensePageCount('Showing licenses 901-912 of 912', 10)).toBe(10);
	});

	it('reads thousands separators and spaces around the dash', () => {
		expect(licensePageCount('Showing licenses 1,001 - 1,100 of 2.345', 11)).toBe(24);
	});

	it('returns 0 without a range', () => {
		expect(licensePageCount('', 1)).toBe(0);
		expect(licensePageCount(undefined, 1)).toBe(0);
		expect(licensePageCount('Showing 912 licenses', 1)).toBe(0);
	});
});

describe('resume points', () => {
	const memory = () => {
		const map = new Map<string, string>();
		return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
	};
	const point = { url: 'https://store.steampowered.com/account/licenses/?start=1800&l=english', page: 19, parsed: 1409, total: 1902, savedAt: 1_000 };

	it('saves and reads back where a sync stopped', () => {
		const storage = memory();
		saveResumePoint(storage, 'k', point);
		expect(readResumePoint(storage, 'k', 2_000)).toEqual(point);
	});

	it('forgets a resume point after a day', () => {
		const storage = memory();
		saveResumePoint(storage, 'k', point);
		expect(readResumePoint(storage, 'k', point.savedAt + RESUME_MAX_AGE_MS + 1)).toBeNull();
	});

	it('is gone once cleared', () => {
		const storage = memory();
		saveResumePoint(storage, 'k', point);
		clearResumePoint(storage, 'k');
		expect(readResumePoint(storage, 'k', 2_000)).toBeNull();
	});

	it('rejects a resume point that would leave the licenses page or is malformed', () => {
		const storage = memory();
		storage.setItem('k', JSON.stringify({ ...point, url: 'https://example.com/account/licenses/?start=1' }));
		expect(readResumePoint(storage, 'k', 2_000)).toBeNull();
		storage.setItem('k', '{not json');
		expect(readResumePoint(storage, 'k', 2_000)).toBeNull();
		storage.setItem('k', JSON.stringify({ ...point, page: 1 }));
		expect(readResumePoint(storage, 'k', 2_000)).toBeNull();
	});

	it('keeps the resumed page in English', () => {
		const storage = memory();
		saveResumePoint(storage, 'k', { ...point, url: 'https://store.steampowered.com/account/licenses/?start=1800&l=italian' });
		expect(new URL(readResumePoint(storage, 'k', 2_000)!.url).searchParams.get('l')).toBe('english');
	});

	it('copes with storage that throws', () => {
		const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
		expect(() => saveResumePoint(broken, 'k', point)).not.toThrow();
		expect(readResumePoint(broken, 'k', 2_000)).toBeNull();
	});
});
