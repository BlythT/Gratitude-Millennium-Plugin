import type { HistoryGift } from './gift-history';

// Where to look in the Steam inventory history for "Received a gift from" entries. The history is
// read newest first, a page of 50 entries at a time, from a cursor that can start at any time. So
// instead of reading the whole history, the search starts just after each gift license's date and
// reads back past it. Accepting a gift adds its license within minutes of the history entry.

const DAY_SECONDS = 24 * 60 * 60;

// Gifts stopped going through the inventory in May 2017 (Steam's gifting change), but gifts
// already in someone's inventory were still sent after that. Licenses from this date on are newer
// than any gift the history names.
export const GIFT_HISTORY_CUTOFF = Date.UTC(2020, 0, 1) / 1000;

const GIFT_ACQUISITION = 'Gift/Guest Pass';

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// A licenses page date ("Dec 22, 2012") as the start of that day in UTC, in seconds
export function licenseDaySeconds(date: string): number | null {
	const m = date.trim().match(/^(\w{3})\w* (\d{1,2}), (\d{4})$/);
	if (!m || !(m[1] in MONTHS)) return null;
	return Date.UTC(Number(m[3]), MONTHS[m[1]], Number(m[2])) / 1000;
}

export interface SearchWindow {
	// Seconds; the window covers from <= time < to
	from: number;
	to: number;
}

/**
 * The stretches of history to read, newest first, one around each gift license dated before the
 * cutoff. The licenses page gives only the day, in the account's time zone, so each window runs
 * from the day before to the day after. Overlapping windows are joined.
 */
export function giftSearchWindows(
	licenses: Record<string, { date?: string; acquisition?: string }>,
	cutoff: number = GIFT_HISTORY_CUTOFF,
): SearchWindow[] {
	const days = new Set<number>();
	for (const license of Object.values(licenses)) {
		if (license?.acquisition !== GIFT_ACQUISITION || !license.date) continue;
		const day = licenseDaySeconds(license.date);
		if (day !== null && day < cutoff) days.add(day);
	}
	const windows: SearchWindow[] = [];
	for (const day of [...days].sort((a, b) => b - a)) {
		const window = { from: day - DAY_SECONDS, to: day + 2 * DAY_SECONDS };
		const previous = windows[windows.length - 1];
		if (previous && window.to >= previous.from) previous.from = Math.min(previous.from, window.from);
		else windows.push(window);
	}
	return windows;
}

export interface HistoryCursor {
	time: number;
	time_frac: number;
	s: string | number;
}

// The history has no entries older than this: its first page has no cursor to carry on from
export const HISTORY_END: HistoryCursor = { time: 0, time_frac: 0, s: 0 };

/**
 * Where to start reading a window, given the cursor the last page read left (the oldest point read
 * so far, as windows are read newest first). Null when the pages already read cover the window.
 */
export function windowStart(window: SearchWindow, last: HistoryCursor | null): HistoryCursor | null {
	if (last && last.time <= window.from) return null;
	if (last && last.time <= window.to) return last;
	return { time: window.to, time_frac: 0, s: 0 };
}

// Gifts from both lists, each once. Pages can overlap, and a new search adds to the gifts found before.
export function mergeHistoryGifts(...lists: HistoryGift[][]): HistoryGift[] {
	const seen = new Set<string>();
	const merged: HistoryGift[] = [];
	for (const gift of lists.flat()) {
		const key = JSON.stringify([gift.date, gift.senderProfileUrl ?? gift.senderName, gift.items]);
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(gift);
	}
	return merged;
}
