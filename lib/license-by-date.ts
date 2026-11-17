import { normalizeForComparison, type LicenseData } from './license-matching';

// Picks the license that gave the user a game by the date they got it, which Steam keeps per App
// ID (rt_purchased_time), instead of trusting the name the sync matched to that App ID. License
// names often differ from the game's (a "4 Pack", a "Sneak Peek Gift", a free weekend), and the
// name match can pick the wrong one: a preview gift instead of the copy bought later, or a base
// game's license for its DLC.

export interface DatedLicense extends LicenseData {
	name?: string;
}

export interface ChosenLicense {
	licenseKey: string;
	data: LicenseData;
	how: 'synced-date-agrees' | 'synced-after-purchase' | 'only-license-that-day' | 'name-among-that-day';
}

const MS_PER_DAY = 86_400_000;

// License dates read like "Mar 5, 2025". Day number since the epoch, or null when unreadable.
export function licenseDay(date: string): number | null {
	const time = Date.parse(`${date} UTC`);
	return Number.isNaN(time) ? null : Math.floor(time / MS_PER_DAY);
}

// Steam's rt_purchased_time is in seconds; 0 or missing means Steam doesn't know
export function purchaseDay(purchasedTime: number | null | undefined): number | null {
	return purchasedTime && purchasedTime > 0 ? Math.floor((purchasedTime * 1000) / MS_PER_DAY) : null;
}

// The licenses page shows dates in the user's time zone and Steam's purchase time is UTC, so a
// license can sit a day either side
const DAY_TOLERANCE = 1;

const dayIndexes = new WeakMap<Map<string, LicenseData>, Map<number, string[]>>();

function licensesByDay(byName: Map<string, LicenseData>): Map<number, string[]> {
	let index = dayIndexes.get(byName);
	if (!index) {
		index = new Map();
		for (const [name, license] of byName) {
			const day = licenseDay(license.date);
			if (day === null) continue;
			const names = index.get(day);
			if (names) names.push(name);
			else index.set(day, [name]);
		}
		dayIndexes.set(byName, index);
	}
	return index;
}

// The licenses from the purchase day, and from the days either side
function licensesNear(byName: Map<string, LicenseData>, day: number): { sameDay: string[]; nextTo: string[] } {
	const index = licensesByDay(byName);
	const nextTo: string[] = [];
	for (let offset = 1; offset <= DAY_TOLERANCE; offset++) {
		nextTo.push(...(index.get(day - offset) ?? []), ...(index.get(day + offset) ?? []));
	}
	return { sameDay: index.get(day) ?? [], nextTo };
}

const words = (value: string) => new Set(normalizeForComparison(value).split(' ').filter(Boolean));

// The license whose name shares the largest part of its words with the game's (Jaccard), or null
// when none shares a word or two tie. Only a few licenses are from around one day, so this can be
// looser than the library-wide name match: "Magicka 2" finds "Magicka 2 - 4 Pack".
function closestName(names: string[], title: string): string | null {
	const titleWords = words(title);
	if (!titleWords.size) return null;
	let best: string | null = null;
	let bestScore = 0;
	let tied = false;
	for (const name of names) {
		const nameWords = words(name);
		let shared = 0;
		let sharedText = false;
		for (const word of nameWords) {
			if (!titleWords.has(word)) continue;
			shared++;
			if (!/^\d+$/.test(word)) sharedText = true;
		}
		// A number alone ("2") isn't a name match: a translated title can keep only its digits
		const score = sharedText ? shared / (titleWords.size + nameWords.size - shared) : 0;
		if (score > bestScore) {
			best = name;
			bestScore = score;
			tied = false;
		} else if (score === bestScore && score > 0) {
			tied = true;
		}
	}
	return bestScore > 0 && !tied ? best : null;
}

/**
 * The license the user got a game through, chosen by date. Returns null when the date can't
 * decide (Steam has no purchase time, no license is from that day, or several are and their names
 * don't settle it); the caller then keeps the license the sync matched by name.
 *
 * @param purchasedTime Steam's rt_purchased_time for the game
 * @param synced The license the sync matched to this App ID by name, if any
 * @param byName Every license, by name
 * @param title The game's name, to choose between several licenses from the same day
 */
export function chooseLicenseByDate(
	purchasedTime: number | null | undefined,
	synced: DatedLicense | null | undefined,
	byName: Map<string, LicenseData>,
	title: string | null | undefined,
): ChosenLicense | null {
	const day = purchaseDay(purchasedTime);
	if (day === null) return null;

	if (synced) {
		const syncedDay = licenseDay(synced.date);
		if (syncedDay !== null && Math.abs(syncedDay - day) <= DAY_TOLERANCE) {
			return { licenseKey: synced.name ?? '', data: synced, how: 'synced-date-agrees' };
		}
		// A license from after Steam's purchase date is kept. Steam dates a game by the package
		// that grants it, and a package can gain a game long after it was bought: Klei added Don't
		// Starve Together to every Don't Starve purchase in 2015, so a DST gift from January 2015
		// shows a November 2014 purchase date. Only a license from before the purchase date is
		// set aside, as one that didn't keep the game: a preview, a free weekend, a playtest.
		if (syncedDay !== null && syncedDay > day + DAY_TOLERANCE) {
			return { licenseKey: synced.name ?? '', data: synced, how: 'synced-after-purchase' };
		}
	}

	const { sameDay, nextTo } = licensesNear(byName, day);
	const named = title ? closestName([...sameDay, ...nextTo], title) : null;
	if (named) {
		return { licenseKey: named, data: byName.get(named)!, how: 'name-among-that-day' };
	}
	// No name to go on (a translated title, or a package named nothing like the game): the only
	// license from the purchase day, or from the days either side when that day has none
	const pool = sameDay.length ? sameDay : nextTo;
	if (pool.length === 1) {
		return { licenseKey: pool[0], data: byName.get(pool[0])!, how: 'only-license-that-day' };
	}
	// Several, but if they were all got the same way (a bundle bought from the Store), it doesn't
	// matter which one it was
	if (pool.length > 1 && new Set(pool.map((name) => byName.get(name)!.acquisition)).size === 1) {
		return { licenseKey: pool[0], data: byName.get(pool[0])!, how: 'only-license-that-day' };
	}
	return null;
}
