// The Steam client's own license list, from its console command licenses_print. Unlike the
// Store's licenses page, it gives each license's package ID, the App IDs it includes, when it was
// got and how, so gifts can be told apart exactly by App ID, with no name matching. It's console
// output, not an API, so the parsing is strict and anything it can't read is left to the licenses
// page sync.
//
// A license looks like this (Steam truncates the app list after 32 with "..."):
//   License packageID 218:
//    - State   : Active (flags 0x200) - Purchased : Sat Dec 22 23:04:12 2012 in "NZ", Guest Pass
//    - Apps	: 4000,  (1 in total)
//    - Depots   : 4001, 4002,  (2 in total)
// Borrowed Family Sharing licenses say "Active, Borrowed", "Family Group" and have an
// " - Original Owner :" line.

export interface ClientLicense {
	packageId: number;
	active: boolean;
	borrowed: boolean;
	// Seconds since the epoch, read in the client's time zone, as Steam prints it
	purchasedTime: number | null;
	// "Guest Pass" for gifts; also "Credit Card", "Wallet", "CD Key", "Complimentary", ...
	method: string;
	appIds: number[];
	// The app list stopped at Steam's limit, so appIds isn't complete
	appsTruncated: boolean;
}

// Steam's payment method for gifts and guest passes
export const GIFT_METHOD = 'Guest Pass';

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// "Sat Dec 22 23:04:12 2012", in the client's local time -> seconds, or null
export function parsePurchasedTime(text: string): number | null {
	const m = text.trim().match(/^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})$/);
	if (!m || !(m[1] in MONTHS)) return null;
	const date = new Date(Number(m[6]), MONTHS[m[1]], Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
	return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

/**
 * Parses licenses_print output into licenses. Blocks that don't have the expected shape are
 * skipped; the caller can compare the count with what it expected.
 */
export function parseLicensesPrint(text: string): ClientLicense[] {
	const licenses: ClientLicense[] = [];
	for (const block of text.split(/(?=License packageID \d+:)/)) {
		const id = block.match(/^License packageID (\d+):/);
		if (!id) continue;
		const state = block.match(/State\s*:\s*([^(\n]+?)\s*\(flags/);
		const purchased = block.match(/Purchased\s*:\s*(.+?) in "[^"]*",\s*([^\n]+)/);
		const apps = block.match(/- Apps\s*:([^\n]*)/);
		if (!state || !purchased || !apps) continue;
		const listed = apps[1].split('(')[0];
		const total = apps[1].match(/\((\d+) in total\)/);
		const appIds = (listed.match(/\d+/g) ?? []).map(Number);
		licenses.push({
			packageId: Number(id[1]),
			active: /^Active\b/.test(state[1].trim()),
			borrowed: /\bBorrowed\b/.test(state[1]) || /Original Owner\s*:/.test(block),
			purchasedTime: parsePurchasedTime(purchased[1]),
			method: purchased[2].trim(),
			appIds,
			appsTruncated: listed.includes('...') || (total !== null && Number(total[1]) > appIds.length),
		});
	}
	return licenses;
}

export interface GiftVerdict {
	gifted: boolean;
	// The gift license, when gifted
	license?: ClientLicense;
}

/**
 * Whether the user's own licenses say the game was gifted: one of their active licenses that
 * includes it is a gift. Returns null when the list can't tell, so the caller uses the licenses
 * page instead: no own license lists the game (it may be in a truncated app list, or borrowed),
 * or none of the listed ones is a gift while a gift license's app list was truncated.
 */
export function giftVerdictForApp(licenses: ClientLicense[], appId: number): GiftVerdict | null {
	const own = licenses.filter((l) => !l.borrowed && l.active);
	const withApp = own.filter((l) => l.appIds.includes(appId));
	const gifts = withApp.filter((l) => l.method === GIFT_METHOD);
	if (gifts.length) {
		// The first gift is the one that gave the game
		const first = gifts.reduce((a, b) => ((a.purchasedTime ?? Infinity) <= (b.purchasedTime ?? Infinity) ? a : b));
		return { gifted: true, license: first };
	}
	if (!withApp.length) return null;
	if (own.some((l) => l.method === GIFT_METHOD && l.appsTruncated)) return null;
	return { gifted: false };
}

// "Dec 22, 2012" in the client's time zone, like the licenses page shows dates
export function formatLicenseDate(seconds: number): string {
	const date = new Date(seconds * 1000);
	const month = Object.keys(MONTHS)[date.getMonth()];
	return `${month} ${date.getDate()}, ${date.getFullYear()}`;
}
