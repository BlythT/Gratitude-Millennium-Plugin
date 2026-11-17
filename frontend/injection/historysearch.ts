import { callable } from '@steambrew/client';
import { log, logError } from '../../lib/logger';
import { GIFT_METHOD } from '../../lib/client-licenses';
import { GIFT_HISTORY_CUTOFF } from '../../lib/gift-history-search';
import { loadClientLicenses } from './clientlicenses';
import { applyGiftHistory } from './gifthistory';

// Searches the Community inventory history for who sent older gifts, in a hidden browser view, so
// nobody has to sit and watch it. The webkit script does the search (webkit/index.tsx) and reports
// each step to the backend; this starts it once per session when there's something to find, and
// closes the view when it finishes, fails, or stops making progress.

const getGiftHistory = callable<[{ steamUserID: string }], string>('GetGiftHistory');
const getGiftSearchStatus = callable<[{ steamUserID: string }], string>('GetGiftSearchStatus');
const hasUserConsented = callable<[{ steamUserID: string }], boolean | string>('HasUserConsented');

const SEARCH_URL = 'https://steamcommunity.com/my/inventoryhistory/?l=english&gratitude_import=1&gratitude_background=1';
// Steam's own start-up goes first
export const START_DELAY_MS = 2 * 60 * 1000;
const POLL_MS = 15 * 1000;
// A hidden page's timers can slow to one a minute, so only a long silence means it's stuck
export const STALL_MS = 5 * 60 * 1000;

interface BrowserView {
	LoadURL(url: string): void;
	SetVisible(visible: boolean): void;
}

interface SearchStatus {
	state?: 'running' | 'done' | 'failed';
	step?: string;
}

let started = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readStatus(steamUserID: string): Promise<SearchStatus> {
	try {
		return JSON.parse((await getGiftSearchStatus({ steamUserID })) || '{}') as SearchStatus;
	} catch {
		return {};
	}
}

// True when the history has been searched before, so the gifts it names are already saved
async function searchedBefore(steamUserID: string): Promise<boolean> {
	try {
		const raw = await getGiftHistory({ steamUserID });
		return !!(raw && raw !== '{}' && (JSON.parse(raw) as { updatedAt?: number }).updatedAt);
	} catch {
		return false;
	}
}

// Gift licenses old enough to have gone through the inventory, so the history may name a sender
async function hasOldGifts(steamUserID: string): Promise<boolean> {
	const licenses = await loadClientLicenses(steamUserID);
	if (!licenses) return true; // can't tell: the search falls back to the licenses page dates
	return licenses.some((l) => !l.borrowed && l.method === GIFT_METHOD && l.purchasedTime !== null && l.purchasedTime < GIFT_HISTORY_CUTOFF);
}

function createHiddenView(): { view: BrowserView; destroy: () => void } | null {
	const client = (window as unknown as { SteamClient?: { BrowserView?: { Create?: (o: object) => BrowserView; Destroy?: (v: BrowserView) => void }; Browser?: { GetBrowserID?: () => number } } }).SteamClient;
	const popups = (window as unknown as { g_PopupManager?: { GetExistingPopup?: (name: string) => { window?: { SteamClient?: { Browser?: { GetBrowserID?: () => number } } } } | undefined } }).g_PopupManager;
	if (!client?.BrowserView?.Create || !client.BrowserView.Destroy) return null;
	const parentPopupBrowserID = popups?.GetExistingPopup?.('SP Desktop_uid0')?.window?.SteamClient?.Browser?.GetBrowserID?.() ?? client.Browser?.GetBrowserID?.();
	if (parentPopupBrowserID === undefined) return null;
	const view = client.BrowserView.Create({ parentPopupBrowserID, strName: 'GratitudeGifterSearch', strUserAgentIdentifier: 'Valve Steam Client' });
	view.SetVisible(false);
	return { view, destroy: () => client.BrowserView!.Destroy!(view) };
}

/** Runs the hidden search and waits for it. Returns true when it finished and saved its gifts. */
export async function runHiddenGifterSearch(steamUserID: string): Promise<boolean> {
	const hidden = createHiddenView();
	if (!hidden) {
		log('Gifter search: no hidden browser view available.');
		return false;
	}
	let lastStep = '';
	let lastChange = Date.now();
	try {
		hidden.view.LoadURL(SEARCH_URL);
		log('Gifter search: started in the background.');
		// No limit on the total time; only a search that stops making progress is given up on
		for (;;) {
			await sleep(POLL_MS);
			const status = await readStatus(steamUserID);
			if (status.state === 'done' || status.state === 'failed') {
				log(`Gifter search: ${status.state}.`);
				return status.state === 'done';
			}
			const step = `${status.state ?? ''}:${status.step ?? ''}`;
			if (step !== lastStep) {
				lastStep = step;
				lastChange = Date.now();
			} else if (Date.now() - lastChange > STALL_MS) {
				log('Gifter search: no progress for five minutes; stopping.');
				return false;
			}
		}
	} finally {
		try {
			hidden.destroy();
		} catch (error) {
			logError('Gifter search: could not close the hidden view:', error);
		}
	}
}

/**
 * Starts the background search once per session, a little after Steam starts: only with consent,
 * when the history hasn't been searched yet, and when there are old enough gifts to look for.
 */
export function startBackgroundGifterSearch(steamUserID: string) {
	if (started) return;
	started = true;
	void (async () => {
		await sleep(START_DELAY_MS);
		const consented = await hasUserConsented({ steamUserID }).catch(() => false);
		if (consented !== true && consented !== 'true') return;
		if (await searchedBefore(steamUserID)) return;
		if (!(await hasOldGifts(steamUserID))) return;
		if (await runHiddenGifterSearch(steamUserID)) await applyGiftHistory(steamUserID);
	})().catch((error) => logError('Gifter search failed:', error));
}
