import { describe, it, expect } from 'vitest';
import { isReceivedGiftFrom, parseHistoryDate, licenseForGift, gifterAssignments, steamID64FromAccountId, steamID64FromProfileUrl, normalizeProfileUrl, type HistoryGift } from './gift-history';
import type { ClientLicense } from './client-licenses';

const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => new Date(y, mo, d, h, mi, s).getTime() / 1000;
const license = (packageId: number, appIds: number[], time: number, method = 'Guest Pass', extra: Partial<ClientLicense> = {}): ClientLicense => ({
	packageId, active: true, borrowed: false, purchasedTime: time, method, appIds, appsTruncated: false, ...extra,
});

// Made-up gifts and licenses, shaped like real ones
const licenses: ClientLicense[] = [
	license(218, [4000], at(2012, 11, 22, 23, 4, 12)),
	license(89583, [431240], at(2016, 10, 7, 21, 17, 40)),
	license(5000, [2400, 2420, 2430], at(2013, 2, 27, 17, 7, 5)),
	license(68022, [238370], at(2015, 8, 16, 19, 20, 32), 'PayPal'),
	license(9999, [4000], at(2015, 1, 15, 22, 35, 39), 'Family Group', { borrowed: true }),
];
const gift = (date: string, items: string[], extra: Partial<HistoryGift> = {}): HistoryGift => ({
	date, items, senderName: 'Sam Example', senderProfileUrl: 'https://steamcommunity.com/id/sam-example', senderAccountId: 12345678, ...extra,
});

describe('isReceivedGiftFrom', () => {
	it('picks out received gifts that name the sender', () => {
		expect(isReceivedGiftFrom('Received a gift from Sam Example')).toBe(true);
		expect(isReceivedGiftFrom('Received a gift')).toBe(false);
		expect(isReceivedGiftFrom('Gift sent to Sam Example')).toBe(false);
		expect(isReceivedGiftFrom('Redeemed a gift in your inventory')).toBe(false);
	});
});

describe('parseHistoryDate', () => {
	it('reads the history’s date and time, with or without a line break', () => {
		expect(parseHistoryDate('22 Dec, 2012 11:04pm')).toBe(at(2012, 11, 22, 23, 4));
		expect(parseHistoryDate('22 Dec, 2012\n11:04pm')).toBe(at(2012, 11, 22, 23, 4));
		expect(parseHistoryDate('1 Jan, 2015 12:18am')).toBe(at(2015, 0, 1, 0, 18));
		expect(parseHistoryDate('1 Jan, 2015 12:18pm')).toBe(at(2015, 0, 1, 12, 18));
		expect(parseHistoryDate('yesterday')).toBeNull();
	});
});

describe('licenseForGift', () => {
	it('matches the gift license added at the same minute', () => {
		expect(licenseForGift(gift('22 Dec, 2012 11:04pm', ["Garry's Mod"]), licenses)?.packageId).toBe(218);
	});

	it('matches by package ID when the history names an unknown package', () => {
		expect(licenseForGift(gift('7 Nov, 2016 9:00pm', ['Unknown package 89583']), licenses)?.packageId).toBe(89583);
	});

	it('only matches the user’s own gift licenses, near the time', () => {
		expect(licenseForGift(gift('16 Sep, 2015 7:20pm', ['Magicka 2']), licenses)).toBeNull();
		expect(licenseForGift(gift('15 Feb, 2015 10:35pm', ["Garry's Mod"]), licenses)).toBeNull();
		expect(licenseForGift(gift('22 Dec, 2012 11:30pm', ["Garry's Mod"]), licenses)).toBeNull();
	});
});

describe('gifterAssignments', () => {
	const games = new Set([4000, 431240, 2400, 2420, 2430]);

	it('fills the sender in for every Library game the gift license includes', () => {
		const result = gifterAssignments([gift('27 Mar, 2013 5:07pm', ['The Ship - 2 Pack Gift'])], licenses, (id) => games.has(id), () => false);
		expect(result.map((a) => a.appId)).toEqual([2400, 2420, 2430]);
		expect(result[0]).toEqual({ appId: 2400, displayName: 'Sam Example', steamID64: steamID64FromAccountId(12345678), profileUrl: 'https://steamcommunity.com/id/sam-example' });
	});

	it('never replaces a gifter the user already has', () => {
		const result = gifterAssignments([gift('22 Dec, 2012 11:04pm', ["Garry's Mod"])], licenses, (id) => games.has(id), (id) => id === 4000);
		expect(result).toEqual([]);
	});

	it('skips apps that are not Library games, such as tools and soundtracks', () => {
		const result = gifterAssignments([gift('27 Mar, 2013 5:07pm', ['The Ship - 2 Pack Gift'])], licenses, (id) => id === 2400, () => false);
		expect(result.map((a) => a.appId)).toEqual([2400]);
	});

	it('uses who the sender is found to be, and a /profiles/ link without a custom one', () => {
		const result = gifterAssignments(
			[gift('22 Dec, 2012 11:04pm', ["Garry's Mod"], { senderProfileUrl: undefined })],
			licenses, (id) => games.has(id), () => false, () => ({ steamID64: '76561197972611406', displayName: 'Sam (Sammy)' }),
		);
		expect(result[0].displayName).toBe('Sam (Sammy)');
		expect(result[0].steamID64).toBe('76561197972611406');
		expect(result[0].profileUrl).toBe('https://steamcommunity.com/profiles/76561197972611406');
	});

	it('reads the SteamID from a /profiles/ link when the history has no account ID', () => {
		const result = gifterAssignments(
			[gift('22 Dec, 2012 11:04pm', ["Garry's Mod"], { senderAccountId: undefined, senderProfileUrl: 'https://steamcommunity.com/profiles/76561197972611406' })],
			licenses, (id) => games.has(id), () => false,
		);
		expect(result[0].steamID64).toBe('76561197972611406');
	});
});

describe('profile links', () => {
	it('read a SteamID only from permanent links, and compare links loosely', () => {
		expect(steamID64FromProfileUrl('https://steamcommunity.com/profiles/76561197972611406/')).toBe('76561197972611406');
		expect(steamID64FromProfileUrl('https://steamcommunity.com/id/sam-example')).toBeUndefined();
		expect(normalizeProfileUrl('https://steamcommunity.com/id/Sam-Example/')).toBe(normalizeProfileUrl('https://steamcommunity.com/id/sam-example'));
	});
});
