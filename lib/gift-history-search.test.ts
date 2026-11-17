import { describe, expect, it } from 'vitest';
import { GIFT_HISTORY_CUTOFF, HISTORY_END, giftSearchWindows, licenseDaySeconds, mergeHistoryGifts, windowStart } from './gift-history-search';

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

describe('licenseDaySeconds', () => {
	it('reads a licenses page date as the start of that UTC day', () => {
		expect(licenseDaySeconds('Dec 22, 2012')).toBe(day(2012, 12, 22));
		expect(licenseDaySeconds('Mar 5, 2025')).toBe(day(2025, 3, 5));
	});

	it('rejects anything else', () => {
		expect(licenseDaySeconds('22 Dec, 2012')).toBeNull();
		expect(licenseDaySeconds('')).toBeNull();
	});
});

describe('giftSearchWindows', () => {
	it('makes a window from the day before to the day after each gift, newest first', () => {
		const windows = giftSearchWindows({
			'Game A': { date: 'Jul 13, 2012', acquisition: 'Gift/Guest Pass' },
			'Game B': { date: 'Mar 27, 2013', acquisition: 'Gift/Guest Pass' },
		});
		expect(windows).toEqual([
			{ from: day(2013, 3, 26), to: day(2013, 3, 29) },
			{ from: day(2012, 7, 12), to: day(2012, 7, 15) },
		]);
	});

	it('joins gifts days apart into one window', () => {
		const windows = giftSearchWindows({
			'Game A': { date: 'Dec 22, 2012', acquisition: 'Gift/Guest Pass' },
			'Game B': { date: 'Dec 24, 2012', acquisition: 'Gift/Guest Pass' },
			'Game C': { date: 'Dec 22, 2012', acquisition: 'Gift/Guest Pass' },
		});
		expect(windows).toEqual([{ from: day(2012, 12, 21), to: day(2012, 12, 26) }]);
	});

	it('leaves out purchases and gifts after the cutoff', () => {
		const windows = giftSearchWindows({
			'Bought': { date: 'Dec 22, 2012', acquisition: 'Steam Store' },
			'New gift': { date: 'Mar 5, 2025', acquisition: 'Gift/Guest Pass' },
			'Undated': { acquisition: 'Gift/Guest Pass' },
		});
		expect(windows).toEqual([]);
		expect(GIFT_HISTORY_CUTOFF).toBe(day(2020, 1, 1));
	});
});

describe('windowStart', () => {
	const window = { from: day(2013, 3, 26), to: day(2013, 3, 29) };

	it('jumps to the end of a window nothing has reached yet', () => {
		expect(windowStart(window, null)).toEqual({ time: window.to, time_frac: 0, s: 0 });
		expect(windowStart(window, { time: day(2014, 1, 1), time_frac: 0, s: 0 })).toEqual({ time: window.to, time_frac: 0, s: 0 });
	});

	it('carries on from the last page when it stopped inside the window', () => {
		const last = { time: day(2013, 3, 28), time_frac: 5, s: '123' };
		expect(windowStart(window, last)).toBe(last);
	});

	it('skips a window the pages already read cover, or one older than the history', () => {
		expect(windowStart(window, { time: day(2013, 3, 1), time_frac: 0, s: 0 })).toBeNull();
		expect(windowStart(window, HISTORY_END)).toBeNull();
	});
});

describe('mergeHistoryGifts', () => {
	it('keeps each gift once', () => {
		const a = { date: '22 Dec, 2012 11:04pm', senderName: 'Sam Example', senderProfileUrl: 'https://steamcommunity.com/profiles/76561197960265729', items: ['Game A'] };
		const b = { date: '1 Jan, 2013 9:00am', senderName: 'Alex Example', items: ['Game B'] };
		expect(mergeHistoryGifts([a, b], [{ ...a }])).toEqual([a, b]);
	});
});
