import { describe, it, expect } from 'vitest';
import { nextLicensePageUrl, shouldSkipLicenseSync, completedLicenseCount, parseLicenseTotal, withoutExplicitSyncFlag } from './license-sync';

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
