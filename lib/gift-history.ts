import type { ClientLicense } from './client-licenses';
import { GIFT_METHOD } from './client-licenses';

// Gifts recorded in the Steam Community inventory history ("Received a gift from <name>"), and
// pairing them with the user's gift licenses to fill in who gave each gifted game. Gifts went
// through the inventory until about 2019, so this covers older gifts; Steam stopped naming the
// sender after that.

export interface HistoryGift {
	// As the history shows it, in English: "22 Dec, 2012 11:04pm"
	date: string;
	senderName: string;
	senderProfileUrl?: string;
	// The sender's account ID, from the profile link's data-miniprofile
	senderAccountId?: number;
	// The gift's item names, e.g. "Garry's Mod" or "Unknown package 89583"
	items: string[];
}

export interface GifterAssignment {
	appId: number;
	displayName: string;
	steamID64?: string;
	profileUrl?: string;
}

// History entries for a received gift that names its sender
export function isReceivedGiftFrom(description: string): boolean {
	return /^Received a gift from\b/i.test(description.trim());
}

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// "22 Dec, 2012 11:04pm" (or with a newline between date and time) in local time -> seconds
export function parseHistoryDate(text: string): number | null {
	const m = text.replace(/\s+/g, ' ').trim().match(/^(\d{1,2}) (\w{3}),? (\d{4}) (\d{1,2}):(\d{2})\s*(am|pm)$/i);
	if (!m || !(m[2] in MONTHS)) return null;
	let hour = Number(m[4]) % 12;
	if (m[6].toLowerCase() === 'pm') hour += 12;
	const date = new Date(Number(m[3]), MONTHS[m[2]], Number(m[1]), hour, Number(m[5]));
	return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

const ACCOUNT_ID_BASE = 76561197960265728n;

export function steamID64FromAccountId(accountId: number | undefined): string | undefined {
	return accountId && accountId > 0 ? (ACCOUNT_ID_BASE + BigInt(accountId)).toString() : undefined;
}

// The SteamID64 in a permanent profile link (steamcommunity.com/profiles/<id>); custom /id/ links
// don't carry one
export function steamID64FromProfileUrl(url: string | undefined): string | undefined {
	return url?.match(/steamcommunity\.com\/profiles\/(\d{17})/i)?.[1];
}

// A profile link in a form two links can be compared in: no trailing slash, lower case
export function normalizeProfileUrl(url: string | undefined): string {
	return (url ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

// Who sent a gift, as far as is known: their SteamID64 and the name to show
export interface Sender {
	steamID64?: string;
	displayName: string;
}

// Accepting a gift adds its license at the same minute the history records the gift
const MATCH_WINDOW_SECONDS = 10 * 60;

/**
 * The gift license each history gift added. A gift shown as "Unknown package N" names its package;
 * otherwise the user's own gift license bought nearest the gift's time, within ten minutes.
 */
export function licenseForGift(gift: HistoryGift, licenses: ClientLicense[]): ClientLicense | null {
	const giftLicenses = licenses.filter((l) => !l.borrowed && l.method === GIFT_METHOD);
	for (const item of gift.items) {
		const packageId = item.match(/^Unknown package (\d+)$/i)?.[1];
		if (packageId) {
			const byPackage = giftLicenses.find((l) => l.packageId === Number(packageId));
			if (byPackage) return byPackage;
		}
	}
	const time = parseHistoryDate(gift.date);
	if (time === null) return null;
	let best: ClientLicense | null = null;
	let bestGap = Infinity;
	for (const license of giftLicenses) {
		if (license.purchasedTime === null) continue;
		const gap = Math.abs(license.purchasedTime - time);
		if (gap <= MATCH_WINDOW_SECONDS && gap < bestGap) {
			best = license;
			bestGap = gap;
		}
	}
	return best;
}

/**
 * Gifters to fill in: for each history gift, the Library games its license includes, except games
 * that already have a gifter (the user's entries are never replaced). senderOf identifies the
 * sender, e.g. by matching their profile link to a friend; by default it uses what the history
 * says.
 */
export function gifterAssignments(
	gifts: HistoryGift[],
	licenses: ClientLicense[],
	isLibraryGame: (appId: number) => boolean,
	hasGifter: (appId: number) => boolean,
	senderOf: (gift: HistoryGift) => Sender = (gift) => ({
		steamID64: steamID64FromAccountId(gift.senderAccountId) ?? steamID64FromProfileUrl(gift.senderProfileUrl),
		displayName: gift.senderName,
	}),
): GifterAssignment[] {
	const assignments = new Map<number, GifterAssignment>();
	for (const gift of gifts) {
		const license = licenseForGift(gift, licenses);
		if (!license) continue;
		const { steamID64, displayName } = senderOf(gift);
		for (const appId of license.appIds) {
			if (assignments.has(appId) || !isLibraryGame(appId) || hasGifter(appId)) continue;
			assignments.set(appId, {
				appId,
				displayName,
				steamID64,
				profileUrl: gift.senderProfileUrl || (steamID64 ? `https://steamcommunity.com/profiles/${steamID64}` : undefined),
			});
		}
	}
	return [...assignments.values()];
}
