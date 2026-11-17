import { describe, it, expect, vi } from 'vitest';
import { fetchTextWithRetry, retryAfterMs, isRetryableStatus, MAX_RETRY_AFTER_MS } from './page-fetch';

const ok = (text: string) => ({ ok: true, status: 200, text: async () => text, headers: new Map() });
const status = (code: number, retryAfter?: string) => ({
	ok: false,
	status: code,
	text: async () => '',
	headers: new Map(retryAfter ? [['retry-after', retryAfter]] : []),
});
const never = () => new Promise(() => {});

// Fetch stubs that answer in order
function fetchSequence(...answers: (() => unknown)[]) {
	let i = 0;
	return vi.fn(async () => {
		const answer = answers[Math.min(i++, answers.length - 1)];
		return answer() as Response;
	}) as unknown as typeof fetch;
}

const noSleep = vi.fn(async (_ms: number) => {});

describe('fetchTextWithRetry', () => {
	it('returns the page on the first try', async () => {
		const fetchImpl = fetchSequence(() => ok('page'));
		expect(await fetchTextWithRetry('u', { fetchImpl, sleep: noSleep })).toBe('page');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('retries a request that never answers instead of waiting forever', async () => {
		const fetchImpl = fetchSequence(never, () => ok('page'));
		const onRetry = vi.fn();
		const text = await fetchTextWithRetry('u', { fetchImpl, sleep: noSleep, timeoutMs: 20, onRetry });
		expect(text).toBe('page');
		expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ retry: 1, reason: 'no answer within 0.02s' }));
	});

	it('times out a page whose body never finishes', async () => {
		const stalledBody = () => ({ ok: true, status: 200, text: never, headers: new Map() });
		const fetchImpl = fetchSequence(stalledBody, () => ok('page'));
		expect(await fetchTextWithRetry('u', { fetchImpl, sleep: noSleep, timeoutMs: 20 })).toBe('page');
	});

	it('waits longer each time Steam throttles, then gets the page', async () => {
		const fetchImpl = fetchSequence(() => status(429), () => status(429), () => status(503), () => ok('page'));
		const sleep = vi.fn(async (_ms: number) => {});
		expect(await fetchTextWithRetry('u', { fetchImpl, sleep, delaysMs: [2000, 5000, 15000, 30000] })).toBe('page');
		expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 5000, 15000]);
	});

	it("follows Steam's Retry-After", async () => {
		const fetchImpl = fetchSequence(() => status(429, '40'), () => ok('page'));
		const sleep = vi.fn(async (_ms: number) => {});
		await fetchTextWithRetry('u', { fetchImpl, sleep });
		expect(sleep).toHaveBeenCalledWith(40_000);
	});

	it('gives up after the last retry', async () => {
		const fetchImpl = fetchSequence(() => status(429));
		expect(await fetchTextWithRetry('u', { fetchImpl, sleep: noSleep, delaysMs: [1, 1] })).toBeNull();
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it("doesn't retry a page Steam refuses outright", async () => {
		const fetchImpl = fetchSequence(() => status(403));
		expect(await fetchTextWithRetry('u', { fetchImpl, sleep: noSleep })).toBeNull();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('retries a network error', async () => {
		const fetchImpl = fetchSequence(() => { throw new TypeError('Failed to fetch'); }, () => ok('page'));
		expect(await fetchTextWithRetry('u', { fetchImpl, sleep: noSleep })).toBe('page');
	});

	it('passes the request options through with an abort signal', async () => {
		const fetchImpl = fetchSequence(() => ok('page'));
		await fetchTextWithRetry('u', { fetchImpl, sleep: noSleep, init: { credentials: 'include' } });
		const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
		expect(init.credentials).toBe('include');
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});
});

describe('retryAfterMs', () => {
	it('reads seconds and dates, capped', () => {
		expect(retryAfterMs('30')).toBe(30_000);
		expect(retryAfterMs('9999')).toBe(MAX_RETRY_AFTER_MS);
		expect(retryAfterMs(new Date(Date.UTC(2026, 0, 1, 0, 0, 10)).toUTCString(), Date.UTC(2026, 0, 1))).toBe(10_000);
		expect(retryAfterMs(null)).toBeNull();
		expect(retryAfterMs('soon')).toBeNull();
	});
});

describe('isRetryableStatus', () => {
	it('retries throttling and server errors only', () => {
		expect(isRetryableStatus(429)).toBe(true);
		expect(isRetryableStatus(502)).toBe(true);
		expect(isRetryableStatus(403)).toBe(false);
		expect(isRetryableStatus(404)).toBe(false);
	});
});
