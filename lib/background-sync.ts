// Keeps the automatic (background) license and friends syncs out of Steam's way.
//
// Steam loads the Store home page in the background at every launch, so an automatic sync would
// otherwise fetch licenses while the Library is still loading. Automatic syncs therefore wait
// until the page is idle, request at low priority, and don't repeat on every page load. Syncs the
// user starts from a sync link skip all of this: the user is waiting on them.

// How often the automatic "has the license count changed?" check may run
export const LICENSE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
// How often the friends list may be refreshed automatically
export const FRIENDS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Extra wait after the page is idle, so Steam's own startup and Library loading go first
export const BACKGROUND_START_DELAY_MS = 5000;
// Longest wait for the browser to report idle time
const IDLE_TIMEOUT_MS = 10000;

export type SyncPriority = 'low' | 'auto';

// Fetch Priority for a sync's requests: low in the background, normal when the user asked for it
export function syncPriority(isExplicitSync: boolean): SyncPriority {
	return isExplicitSync ? 'auto' : 'low';
}

// True when an automatic sync last finished long enough ago to run again
export function isDue(lastRunMs: number | null, nowMs: number, intervalMs: number): boolean {
	if (lastRunMs === null || !Number.isFinite(lastRunMs)) return true;
	// A clock that moved backwards would otherwise block syncing until it caught up
	if (lastRunMs > nowMs) return true;
	return nowMs - lastRunMs >= intervalMs;
}

export interface KeyValueStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

// When the sync named by key last finished, or null when unknown or storage is unavailable
export function readLastRun(storage: KeyValueStorage | undefined, key: string): number | null {
	try {
		const value = storage?.getItem(key);
		if (value === null || value === undefined) return null;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function recordRun(storage: KeyValueStorage | undefined, key: string, nowMs: number): void {
	try {
		storage?.setItem(key, String(nowMs));
	} catch {
		// Storage can be unavailable or full; the sync then just runs again next time
	}
}

export const licenseCheckKey = (steamUserID: string) => `gratitude:lastLicenseCheck:${steamUserID}`;
export const friendsSyncKey = (steamUserID: string) => `gratitude:lastFriendsSync:${steamUserID}`;

// Resolves once the page has finished loading, the browser has had idle time (or IDLE_TIMEOUT_MS
// passed), and a further delayMs has gone by.
export async function waitForQuietPage(win: Window, delayMs: number = BACKGROUND_START_DELAY_MS): Promise<void> {
	if (win.document.readyState !== 'complete') {
		await new Promise<void>((resolve) => win.addEventListener('load', () => resolve(), { once: true }));
	}
	await new Promise<void>((resolve) => {
		if (typeof win.requestIdleCallback === 'function') {
			win.requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
		} else {
			win.setTimeout(resolve, 0);
		}
	});
	await new Promise<void>((resolve) => win.setTimeout(resolve, delayMs));
}
