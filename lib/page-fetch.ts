// Fetching Steam pages for the syncs without hanging or giving up too early. A request that never
// answers would leave a sync waiting forever (issue #39: a large library's sync stuck on page 19
// of 26), and Steam answers a run of quick requests with 429 Too Many Requests, which needs more
// than a second or two before trying again.

// How long one request may take, including reading its page
export const PAGE_TIMEOUT_MS = 20_000;
// Waits before each retry. Steam's throttling lasts tens of seconds, so the later waits are long.
export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];
// The longest wait taken from a Retry-After header
export const MAX_RETRY_AFTER_MS = 60_000;

export interface RetryInfo {
	// 1 for the first retry
	retry: number;
	waitMs: number;
	reason: string;
}

export interface FetchTextOptions {
	init?: RequestInit;
	timeoutMs?: number;
	delaysMs?: number[];
	onRetry?: (info: RetryInfo) => void;
	fetchImpl?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Retry-After is seconds or an HTTP date. Returns the wait in ms, capped, or null when absent.
export function retryAfterMs(header: string | null | undefined, nowMs: number = Date.now()): number | null {
	if (!header) return null;
	const trimmed = header.trim();
	let ms: number;
	if (/^\d+$/.test(trimmed)) {
		ms = Number(trimmed) * 1000;
	} else {
		const date = Date.parse(trimmed);
		if (Number.isNaN(date)) return null;
		ms = date - nowMs;
	}
	return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}

// Throttling and server errors are worth retrying; other errors (not signed in, not found) won't
// change on a retry
export function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

class TimeoutError extends Error {}

/**
 * Fetches a page's text. Each attempt is aborted after timeoutMs, so a request that never answers
 * is retried instead of stalling. Network errors, timeouts, 429 and 5xx are retried after each of
 * delaysMs in turn, or after Retry-After when Steam sends one. Returns null when every attempt
 * failed or Steam refused the page outright.
 */
export async function fetchTextWithRetry(url: string, options: FetchTextOptions = {}): Promise<string | null> {
	const {
		init,
		timeoutMs = PAGE_TIMEOUT_MS,
		delaysMs = RETRY_DELAYS_MS,
		onRetry,
		fetchImpl = fetch,
		sleep = defaultSleep,
	} = options;

	for (let attempt = 0; ; attempt++) {
		let reason: string;
		let retryAfter: number | null = null;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const timedOut = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					controller.abort();
					reject(new TimeoutError());
				}, timeoutMs);
			});
			// The timeout also covers reading the page, which can stall like the request
			const text = await Promise.race([
				(async () => {
					const response = await fetchImpl(url, { ...init, signal: controller.signal });
					if (response.ok) return await response.text();
					if (!isRetryableStatus(response.status)) {
						return { refused: response.status };
					}
					return { retry: response.status, retryAfter: response.headers?.get?.('retry-after') ?? null };
				})(),
				timedOut,
			]);
			if (typeof text === 'string') return text;
			if ('refused' in text) return null;
			reason = `HTTP ${text.retry}`;
			retryAfter = retryAfterMs(text.retryAfter);
		} catch (error) {
			reason = error instanceof TimeoutError ? `no answer within ${timeoutMs / 1000}s` : `network error: ${(error as Error)?.message ?? error}`;
		} finally {
			clearTimeout(timer);
		}

		if (attempt >= delaysMs.length) return null;
		const waitMs = retryAfter ?? delaysMs[attempt];
		onRetry?.({ retry: attempt + 1, waitMs, reason });
		await sleep(waitMs);
	}
}
