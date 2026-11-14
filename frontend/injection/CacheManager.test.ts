import { describe, it, expect, vi, afterEach } from 'vitest';
import { CacheManager } from './CacheManager';

vi.mock('../../lib/logger', () => ({ log: vi.fn(), logError: vi.fn() }));

describe('CacheManager.getDataSync', () => {
	afterEach(() => { vi.useRealTimers(); });

	it('returns undefined before the first load', () => {
		const cache = new CacheManager<string>('test', async () => 'data');
		expect(cache.getDataSync('1')).toBeUndefined();
	});

	it('keeps returning data past the TTL and refreshes it in the background', async () => {
		vi.useFakeTimers();
		let version = 0;
		const fetcher = vi.fn(async () => `v${++version}`);
		const cache = new CacheManager<string>('test', fetcher, undefined, 1000);
		const listener = vi.fn();
		cache.observe('1', listener);
		await vi.runAllTimersAsync();
		expect(cache.getDataSync('1')).toBe('v1');

		vi.advanceTimersByTime(1001);
		// Stale: the old data is still returned, so a component renders straight away...
		expect(cache.getDataSync('1')).toBe('v1');
		// ...and the refresh it started notifies listeners with the new data
		await vi.runAllTimersAsync();
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(cache.getDataSync('1')).toBe('v2');
		expect(listener).toHaveBeenLastCalledWith('v2');
	});

	it('starts only one refresh for repeated reads of stale data', async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(async () => 'data');
		const cache = new CacheManager<string>('test', fetcher, undefined, 1000);
		await cache.getData('1');
		vi.advanceTimersByTime(1001);
		cache.getDataSync('1');
		cache.getDataSync('1');
		cache.getDataSync('1');
		await vi.runAllTimersAsync();
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});
