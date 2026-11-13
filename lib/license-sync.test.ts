import { describe, it, expect } from 'vitest';
import { nextLicensePageUrl, shouldSkipLicenseSync, completedLicenseCount } from './license-sync';

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
		expect(shouldSkipLicenseSync({ completedLicenseCount: 120 }, 120, false)).toBe(true);
	});

	it('syncs when the count changed', () => {
		expect(shouldSkipLicenseSync({ completedLicenseCount: 119 }, 120, false)).toBe(false);
	});

	it('ignores the old totalLicenses count, which a partial sync could have set', () => {
		expect(shouldSkipLicenseSync({ totalLicenses: 120 }, 120, false)).toBe(false);
	});

	it('always syncs when the user asked for it', () => {
		expect(shouldSkipLicenseSync({ completedLicenseCount: 120 }, 120, true)).toBe(false);
	});

	it('syncs when the page total is unknown or there is no cache', () => {
		expect(shouldSkipLicenseSync({ completedLicenseCount: 0 }, 0, false)).toBe(false);
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
