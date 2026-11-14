import { describe, it, expect, vi, afterEach } from 'vitest';
import { isDue, readLastRun, recordRun, syncPriority, waitForQuietPage } from './background-sync';

describe('isDue', () => {
	const tenMinutes = 10 * 60 * 1000;

	it('runs when it has never run', () => {
		expect(isDue(null, 1_000_000, tenMinutes)).toBe(true);
	});

	it('waits until the interval has passed', () => {
		expect(isDue(1_000_000, 1_000_000 + tenMinutes - 1, tenMinutes)).toBe(false);
		expect(isDue(1_000_000, 1_000_000 + tenMinutes, tenMinutes)).toBe(true);
	});

	it('runs when the clock moved backwards', () => {
		expect(isDue(2_000_000, 1_000_000, tenMinutes)).toBe(true);
	});
});

describe('readLastRun and recordRun', () => {
	it('round-trips a timestamp', () => {
		const data = new Map<string, string>();
		const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
		recordRun(storage, 'key', 123456);
		expect(readLastRun(storage, 'key')).toBe(123456);
	});

	it('treats missing, bad or throwing storage as never run', () => {
		expect(readLastRun(undefined, 'key')).toBeNull();
		expect(readLastRun({ getItem: () => 'not a number', setItem: () => {} }, 'key')).toBeNull();
		expect(readLastRun({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} }, 'key')).toBeNull();
		expect(() => recordRun({ getItem: () => null, setItem: () => { throw new Error('full'); } }, 'key', 1)).not.toThrow();
	});
});

describe('syncPriority', () => {
	it('is low in the background and normal when the user asked for the sync', () => {
		expect(syncPriority(false)).toBe('low');
		expect(syncPriority(true)).toBe('auto');
	});
});

describe('waitForQuietPage', () => {
	afterEach(() => { vi.useRealTimers(); });

	it('waits for load, then idle time, then the delay', async () => {
		vi.useFakeTimers();
		let loadListener: (() => void) | null = null;
		let idleCallback: (() => void) | null = null;
		const win = {
			document: { readyState: 'loading' },
			addEventListener: (_: string, fn: () => void) => { loadListener = fn; },
			requestIdleCallback: (fn: () => void) => { idleCallback = fn; },
			setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
		} as unknown as Window;

		let done = false;
		const waiting = waitForQuietPage(win, 5000).then(() => { done = true; });

		await vi.advanceTimersByTimeAsync(60000);
		expect(done).toBe(false); // still loading
		loadListener!();
		await vi.advanceTimersByTimeAsync(60000);
		expect(done).toBe(false); // not idle yet
		idleCallback!();
		await vi.advanceTimersByTimeAsync(4999);
		expect(done).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await waiting;
		expect(done).toBe(true);
	});
});
