// @ts-nocheck
import { callable } from '@steambrew/webkit';
import { log, logError } from '../lib/logger';
import { getCurrentAccountID } from '../lib/steamid';
import { fuzzyMatchLicenseName } from '../lib/license-matching.js';
import {
	clearResumePoint,
	firstLicensePageUrl,
	completedLicenseCount,
	licenseResumeKey,
	nextLicensePageUrl,
	licensePageCount,
	parseLicenseTotal,
	readResumePoint,
	saveResumePoint,
	shouldSkipLicenseSync,
	withoutExplicitSyncFlag,
	withoutUrlFlag,
} from '../lib/license-sync';
import { fetchTextWithRetry } from '../lib/page-fetch';
import { isReceivedGiftFrom } from '../lib/gift-history';
import { GIFT_HISTORY_CUTOFF, HISTORY_END, giftSearchWindows, mergeHistoryGifts, windowStart } from '../lib/gift-history-search';
import { resolveLanguage, translate } from '../lib/i18n';

// The sync overlay's text, in the language of the Steam page it runs on (Steam sets the page's
// lang to the client's language)
function w(key, vars) {
	return translate(resolveLanguage(document.documentElement.lang), key, vars);
}
import {
	FRIENDS_SYNC_INTERVAL_MS,
	LICENSE_CHECK_INTERVAL_MS,
	friendsSyncKey,
	isDue,
	licenseCheckKey,
	readLastRun,
	recordRun,
	syncPriority,
	waitForQuietPage,
} from '../lib/background-sync';

const setGameLicenseData = callable('SetGameLicenseData');
const getCompletedLicenseCount = callable('GetCompletedLicenseCount');
const setFriendsCache = callable('SetFriendsCache');
const setGiftHistory = callable('SetGiftHistory');
const getGiftHistory = callable('GetGiftHistory');
const getGameLicenseData = callable('GetGameLicenseData');
const setGiftSearchStatus = callable('SetGiftSearchStatus');
const hasUserConsented = callable('HasUserConsented');

// True only when this account allowed local storage. Without it nothing scraped could be saved,
// so syncing would fetch every license page on every visit for nothing.
async function isStorageAllowed(steamUserID) {
	try {
		const consent = await hasUserConsented({ steamUserID });
		return consent === true || consent === 'true';
	} catch (error) {
		logError('Could not check storage consent:', error);
		return false;
	}
}

// The page's localStorage, or undefined where reading it throws (blocked storage). The sync
// helpers then treat every sync as due rather than failing.
function pageStorage() {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

// For an automatic sync: false when it ran recently. Otherwise waits until the page is idle, so
// Steam's own loading (the Library at startup, the Store page itself) goes first.
async function readyForBackgroundSync(name, storageKey, intervalMs) {
	const lastRun = readLastRun(pageStorage(), storageKey);
	if (!isDue(lastRun, Date.now(), intervalMs)) {
		log(`Skipping ${name}: last ran ${Math.round((Date.now() - lastRun) / 60000)} min ago.`);
		return false;
	}
	await waitForQuietPage(window);
	return true;
}

export default async function WebkitMain() {
	log('WebkitMain loaded');

	const steamUserID = getCurrentAccountID();
	if (!steamUserID || steamUserID === '') {
		logError('Could not get current Steam User ID.');
		return;
	}

	if (!(await isStorageAllowed(steamUserID))) {
		log('Local storage not allowed for this account; skipping license and friends sync.');
		return;
	}

	void maybeSyncLicenses(steamUserID).catch((error) => {
		logError('Unexpected error during license sync:', error);
	});

	void maybeSyncFriends(steamUserID).catch((error) => {
		logError('Unexpected error during friends sync:', error);
	});

	void maybeImportGifters(steamUserID).catch((error) => {
		logError('Unexpected error while finding gifters:', error);
	});
}

// Gifts received through the Steam inventory (until about 2019) are listed in the Community
// inventory history as "Received a gift from <name>", with a link to the sender. The settings
// panel opens the inventory history with this flag. The history can be read from any date, so the
// search reads only the pages around each gift license's date (lib/gift-history-search.ts). When
// that finds nothing, or there are no license dates to go by, it reads the whole history back from
// 2020 instead. Pages are read a few seconds apart so Steam doesn't throttle them, and the gifts
// that name a sender are saved for the Library to pair with gift licenses (lib/gift-history.ts).
const IMPORT_FLAG = 'gratitude_import';
// Set when the frontend runs the search in a hidden browser view: no overlay, and progress goes to
// the backend for the frontend to watch instead
const BACKGROUND_FLAG = 'gratitude_background';
const HISTORY_URL = 'https://steamcommunity.com/my/inventoryhistory/';
const HISTORY_PAGE_DELAY_MS = 3000;
// The inventory history throttles for about a minute at a time
const HISTORY_RETRY_DELAYS_MS = [5000, 15000, 30000, 60000, 60000];
// Steam answers a date before the history begins with a server error, so a jump that fails is
// retried only briefly before moving on to the next gift
const HISTORY_JUMP_RETRY_DELAYS_MS = [5000, 15000];
// A window with more pages than this is a busy trading stretch; stop rather than read on
const MAX_PAGES_PER_WINDOW = 10;

function historyGiftsFrom(doc) {
	const gifts = [];
	for (const row of doc.querySelectorAll('.tradehistoryrow')) {
		const description = row.querySelector('.tradehistory_event_description');
		const text = (description?.textContent || '').replace(/\s+/g, ' ').trim();
		if (!isReceivedGiftFrom(text)) continue;
		const link = description.querySelector('a[href]');
		const accountId = Number(link?.getAttribute('data-miniprofile'));
		gifts.push({
			date: (row.querySelector('.tradehistory_date')?.textContent || '').replace(/\s+/g, ' ').trim(),
			senderName: (link?.textContent || text.replace(/^Received a gift from\s*/i, '')).trim(),
			senderProfileUrl: link?.getAttribute('href') || undefined,
			senderAccountId: Number.isFinite(accountId) && accountId > 0 ? accountId : undefined,
			items: [...row.querySelectorAll('.history_item_name')].map((item) => (item.textContent || '').trim()).filter(Boolean),
		});
	}
	return gifts;
}

// Shows the search's progress: on the overlay, or to the backend in a background search
let reportImport = (text, percent) => updateSyncOverlay(text, percent);

// One page of history from cursor back: its gifts, and the cursor for the page after it
// (HISTORY_END at the start of the history). Null when it can't be read.
async function readHistoryPage(parser, cursor, delaysMs) {
	await new Promise((resolve) => setTimeout(resolve, HISTORY_PAGE_DELAY_MS));
	const query = new URLSearchParams({ ajax: '1', 'cursor[time]': cursor.time, 'cursor[time_frac]': cursor.time_frac, 'cursor[s]': cursor.s, l: 'english' });
	const json = await fetchTextWithRetry(`${HISTORY_URL}?${query}`, {
		init: { credentials: 'include' },
		delaysMs,
		onRetry: (info) => reportImport(w('import.busy', { seconds: Math.round(info.waitMs / 1000) })),
	});
	let data = null;
	try {
		data = json ? JSON.parse(json) : null;
	} catch {
		data = null;
	}
	if (!data?.success) return null;
	return {
		gifts: historyGiftsFrom(parser.parseFromString(data.html || '', 'text/html')),
		next: data.cursor || HISTORY_END,
	};
}

// The pages around each gift license's date. Returns the gifts found and how many pages were read.
async function searchAroundGifts(parser, windows) {
	const gifts = [];
	let pages = 0;
	let last = null;
	// An index loop: Community pages load Prototype.js, which replaces Array.prototype.entries
	for (let index = 0; index < windows.length; index++) {
		const window = windows[index];
		reportImport(w('import.checking', { done: index + 1, total: windows.length }), Math.round((index / windows.length) * 100));
		let cursor = windowStart(window, last);
		for (let windowPages = 0; cursor && windowPages < MAX_PAGES_PER_WINDOW; windowPages++) {
			const page = await readHistoryPage(parser, cursor, HISTORY_JUMP_RETRY_DELAYS_MS);
			if (!page) break;
			pages++;
			gifts.push(...page.gifts);
			last = page.next;
			cursor = last.time > window.from ? last : null;
		}
	}
	return { gifts, pages };
}

// The whole history back from the cutoff, for when there are no license dates to go by. Returns
// the gifts found, or null when it stopped part way.
async function readWholeHistory(parser) {
	const gifts = [];
	const language = resolveLanguage(document.documentElement.lang);
	let cursor = { time: GIFT_HISTORY_CUTOFF, time_frac: 0, s: 0 };
	while (cursor.time > 0) {
		const date = new Date(cursor.time * 1000).toLocaleDateString(language, { year: 'numeric', month: 'long' });
		reportImport(w('import.readingBack', { date }));
		const page = await readHistoryPage(parser, cursor, HISTORY_RETRY_DELAYS_MS);
		if (!page) return null;
		gifts.push(...page.gifts);
		cursor = page.next;
	}
	return gifts;
}

async function maybeImportGifters(steamUserID) {
	if (window.location.origin !== 'https://steamcommunity.com') return;
	const cleanUrl = withoutUrlFlag(window.location.href, IMPORT_FLAG);
	if (cleanUrl === null) return;
	const background = withoutUrlFlag(cleanUrl, BACKGROUND_FLAG) !== null;
	try {
		window.history.replaceState(window.history.state, '', withoutUrlFlag(cleanUrl, BACKGROUND_FLAG) ?? cleanUrl);
	} catch (error) {
		logError('Could not remove the import flag from the page URL:', error);
	}

	const setStatus = (state, step = '') =>
		setGiftSearchStatus({ statusJson: JSON.stringify({ state, step }), steamUserID }).catch(() => false);
	if (background) {
		let lastStep = '';
		reportImport = (text) => {
			if (text === lastStep) return;
			lastStep = text;
			void setStatus('running', text);
		};
		await setStatus('running', 'starting');
	} else {
		showSyncOverlay(w('import.title'), w('import.starting'));
	}
	const parser = new DOMParser();
	let found = null;
	try {
		let windows = [];
		try {
			const cache = JSON.parse((await getGameLicenseData({ steamUserID })) || '{}');
			windows = giftSearchWindows(cache.byName || {});
		} catch (error) {
			logError('Could not read the gift license dates:', error);
		}
		if (windows.length > 0) {
			const targeted = await searchAroundGifts(parser, windows);
			log(`Inventory history: ${targeted.pages} pages around ${windows.length} gift dates, ${targeted.gifts.length} gifts naming the sender.`);
			// Pages read but no gifts in them: the dates didn't line up, so read everything
			if (targeted.pages === 0) found = null;
			else if (targeted.gifts.length > 0) found = targeted.gifts;
			else found = await readWholeHistory(parser);
		} else {
			found = await readWholeHistory(parser);
		}
	} catch (error) {
		logError('Reading the inventory history failed:', error);
		found = null;
	}

	// Added to the gifts found before, so a search that missed a page never loses one
	let saved = false;
	let total = 0;
	if (found) {
		let previous = [];
		try {
			previous = JSON.parse((await getGiftHistory({ steamUserID })) || '{}').gifts || [];
		} catch {
			previous = [];
		}
		const gifts = mergeHistoryGifts(Array.isArray(previous) ? previous : [], found);
		total = gifts.length;
		const result = await setGiftHistory({ historyJson: JSON.stringify(gifts), steamUserID }).catch(() => false);
		saved = result !== false && result !== 'false';
	}
	log(`Inventory history: ${total} gifts naming the sender, ${saved ? 'saved' : 'not saved'}.`);
	if (background) {
		await setStatus(saved ? 'done' : 'failed', String(total));
		return;
	}
	if (saved) {
		updateSyncOverlay(w('import.done', { count: total }), 100);
		setTimeout(() => {
			window.location.href = 'steam://open/games';
		}, 1500);
	} else {
		updateSyncOverlay(w('import.failed'));
		setTimeout(closeSyncOverlay, 4000);
	}
}

async function fetchOwnedGames(doc, priority) {
	const configEl = doc.getElementById('application_config');
	if (!configEl) {
		log('application_config element not found.');
		return [];
	}

	try {
		const storeUserConfigAttr = configEl.getAttribute('data-store_user_config');
		const userInfoAttr = configEl.getAttribute('data-userinfo');
		if (!storeUserConfigAttr || !userInfoAttr) {
			log('Missing dataset attributes on application_config.');
			return [];
		}

		const { webapi_token } = JSON.parse(storeUserConfigAttr);
		const { steamid } = JSON.parse(userInfoAttr);
		if (!webapi_token || !steamid) {
			log('webapi_token or steamid is missing from config.');
			return [];
		}

		log(`Fetching owned games for Steam ID: ${steamid}`);
		const res = await fetch(
			`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/` +
			`?access_token=${encodeURIComponent(webapi_token)}` +
			`&steamid=${steamid}` +
			`&include_appinfo=true` +
			`&include_played_free_games=true` +
			`&language=english`,
			{ priority }
		);

		if (!res.ok) {
			logError('Failed to fetch owned games from Steam API:', res.status);
			return [];
		}

		const data = await res.json();
		return data.response?.games ?? [];
	} catch (error) {
		logError('Error in fetchOwnedGames:', error);
		return [];
	}
}

async function shouldSkipSync(steamUserID, expectedTotal, isExplicitSync) {
	// A forced sync, or a page without a total, always syncs; no need to ask the backend
	if (isExplicitSync || expectedTotal <= 0) return false;
	try {
		// Backend calls take named arguments; a bare string fails the backend's type check
		const completedCount = await getCompletedLicenseCount({ steamUserID });
		if (shouldSkipLicenseSync(completedCount, expectedTotal, isExplicitSync)) {
			log(`Total licenses (${expectedTotal}) unchanged since the last completed sync. Skipping full sync.`);
			return true;
		}
	} catch (err) {
		logError('Error checking backend cache for optimization:', err);
	}
	return false;
}

// Yields each licenses page with isLastPage set when it has no next link. Stops early, without a
// last page, when a page can't be fetched or its next link can't be followed. progress always
// holds the page being fetched, so the caller knows where it stopped. onRetry(page, info) runs
// before each retry of a page.
async function* fetchAllLicensePages(startUrl, startPage, priority, onRetry, progress) {
	let currentUrl = startUrl;
	let pageCount = startPage;
	const parser = new DOMParser();

	log(`Fetching Steam licenses from page ${startPage} (l=english)`);

	while (currentUrl) {
		progress.url = currentUrl;
		progress.page = pageCount;
		const page = pageCount;
		const html = await fetchPage(currentUrl, priority, (info) => onRetry?.(page, info));
		if (!html) {
			log(`Failed to fetch Steam Licenses at page ${pageCount}.`);
			return;
		}

		const doc = parser.parseFromString(html, 'text/html');
		const href = doc.querySelector('.license_paginator_next')?.getAttribute('href');
		yield { doc, pageCount, isLastPage: !href };

		if (!href) {
			return;
		}

		currentUrl = nextLicensePageUrl(href);
		if (!currentUrl) {
			logError(`Unexpected next page link on licenses page ${pageCount}; stopping.`);
			return;
		}
		pageCount++;
		// Small delay to be polite to Steam servers
		await new Promise(r => setTimeout(r, 300));
	}
}

// Ends a sync the user started from a sync link: back to the Library when it finished,
// otherwise a message, so a failed sync is never reported as complete.
function finishExplicitSync(completed) {
	if (completed) {
		updateSyncOverlay(w('sync.complete'), 100);
		setTimeout(() => {
			window.location.href = 'steam://open/games';
		}, 1000);
		return;
	}
	updateSyncOverlay(w('sync.incomplete'));
	setTimeout(closeSyncOverlay, 4000);
}

// True when this page was opened by a "sync now" link. Removes the flag from the page's URL, so a
// reload, or Steam reopening the Store tab at its last URL, doesn't start another forced sync.
function takeExplicitSyncFlag() {
	const cleanUrl = withoutExplicitSyncFlag(window.location.href);
	if (cleanUrl === null) {
		return false;
	}
	try {
		window.history.replaceState(window.history.state, '', cleanUrl);
	} catch (error) {
		logError('Could not remove the sync flag from the page URL:', error);
	}
	return true;
}

async function maybeSyncLicenses(steamUserID) {
	const currentUrl = new URL(window.location.href);
	if (currentUrl.origin !== 'https://store.steampowered.com') {
		log('Skipping license sync outside Steam Store origin.');
		return;
	}

	const isExplicitSync = takeExplicitSyncFlag();
	const storageKey = licenseCheckKey(steamUserID);

	if (isExplicitSync) {
		showSyncOverlay(w('sync.titleLicenses'), w('sync.connecting'));
	} else if (!(await readyForBackgroundSync('license check', storageKey, LICENSE_CHECK_INTERVAL_MS))) {
		return;
	}

	let completed = false;
	try {
		completed = await syncLicensePages(steamUserID, isExplicitSync);
		if (completed) {
			recordRun(pageStorage(), storageKey, Date.now());
		}
	} finally {
		if (isExplicitSync) {
			finishExplicitSync(completed);
		}
	}
}

// Fetches and saves every licenses page. Returns true when the sync finished, either because the
// license count is unchanged or because every page was fetched and saved.
async function syncLicensePages(steamUserID, isExplicitSync) {
	// A sync that stopped part way left its pages saved and noted where it stopped; carry on from
	// there, so a large library still finishes when Steam keeps cutting a long sync short
	const resumeKey = licenseResumeKey(steamUserID);
	const resume = readResumePoint(pageStorage(), resumeKey, Date.now());
	const startUrl = resume?.url ?? firstLicensePageUrl();
	const progress = { url: startUrl, page: resume?.page ?? 1 };
	let totalLicensesFromPage = 0;
	let ownedGames = [];
	let gamesMap = new Map();
	let totalParsed = resume?.parsed ?? 0;
	let everyPageSaved = true;
	let isFirstFetched = true;
	let totalPages = 0;
	let pagesThisRun = 0;
	let brokenLink = false;

	// Steam throttles long runs of requests; say so instead of leaving the overlay spinning
	const onRetry = isExplicitSync
		? (page, info) => updateSyncOverlay(w('sync.busy', { page, seconds: Math.round(info.waitMs / 1000) }))
		: undefined;

	const priority = syncPriority(isExplicitSync);
	for await (const { doc, pageCount, isLastPage } of fetchAllLicensePages(startUrl, progress.page, priority, onRetry, progress)) {
		// 1. On the first page fetched, read the total, fetch ownedGames, and check cache optimization
		if (isFirstFetched) {
			isFirstFetched = false;
			// Extract total licenses from paginator
			const paginatorText = doc.querySelector('.license_paginator_ctn span')?.textContent;
			totalLicensesFromPage = parseLicenseTotal(paginatorText);
			totalPages = licensePageCount(paginatorText, pageCount);

			if (resume) {
				// A new or removed license shifts every page, so the saved position no longer lines up
				if (totalLicensesFromPage !== resume.total) {
					log(`License total changed since the sync stopped (${resume.total} -> ${totalLicensesFromPage}); starting over.`);
					clearResumePoint(pageStorage(), resumeKey);
					return syncLicensePages(steamUserID, isExplicitSync);
				}
				log(`Resuming the license sync at page ${pageCount}.`);
				if (isExplicitSync) {
					updateSyncOverlay(w('sync.resuming', { page: pageCount }), 10);
				}
			} else {
				if (isExplicitSync) {
					updateSyncOverlay(w('sync.licenses'), 10);
				}

				if (await shouldSkipSync(steamUserID, totalLicensesFromPage, isExplicitSync)) {
					return true;
				}
			}

			ownedGames = await fetchOwnedGames(doc, priority);
			log(`Fetched ${ownedGames.length} owned games from Web API`);
			
			// Create Map of owned games for fuzzy matching: Name -> { appid }
			ownedGames.forEach((game) => {
				if (game.name && game.appid) {
					gamesMap.set(game.name, { appid: game.appid });
				}
			});
		}

		const table = doc.querySelector('table.account_table');
		if (!table) {
			log(`account_table not found in the HTML at page ${pageCount}.`);
			return false;
		}

		const licenses = parseLicenseTable(table);
		pagesThisRun++;
		// A page after the first with no licenses is never the end of the list. Steam sends one,
		// with no next link, when it doesn't accept a page link (a broken continuationToken), and
		// it shows the requested range in the paginator anyway. Taking it as the last page would
		// mark the sync complete with pages missing.
		if (licenses.length === 0 && pageCount > 1) {
			if (resume && pagesThisRun === 1) {
				log(`Steam didn't accept the saved link to page ${pageCount}; starting over.`);
				clearResumePoint(pageStorage(), resumeKey);
				return syncLicensePages(steamUserID, isExplicitSync);
			}
			logError(`Licenses page ${pageCount} came back empty; stopping.`);
			brokenLink = true;
			break;
		}
		totalParsed += licenses.length;
		log(`Parsed ${licenses.length} License Data entries from page ${pageCount}`);

		if (isExplicitSync) {
			// By page: the license total counts Family Sharing games the pages don't list, so a count
			// of licenses never reaches it and a finished sync would look stuck part way
			const pages = Math.max(totalPages, pageCount);
			const progressPercent = totalPages > 0
				? Math.min(95, Math.round((pageCount / pages) * 100))
				: Math.min(95, 10 + pageCount * 15);
			updateSyncOverlay(
				totalPages > 0 ? w('sync.licensesPage', { page: pageCount, pages }) : w('sync.licensesPageOnly', { page: pageCount }),
				progressPercent
			);
		}

		const byAppId = {};
		const byName = {};

		// Process and match each license
		licenses.forEach((license) => {
			if (!license.item) return;

			// Save under byName for compatibility/fallback
			byName[license.item] = {
				date: license.date,
				acquisition: license.acquisition,
			};

			// Try to match license name to an App ID
			const match = fuzzyMatchLicenseName(gamesMap, license.item);
			if (match && match.data?.appid) {
				const appId = match.data.appid;
				byAppId[appId] = {
					date: license.date,
					acquisition: license.acquisition,
					name: license.item,
				};
			}
		});

		const payload = {
			byAppId,
			byName,
			completedLicenseCount: completedLicenseCount({
				isLastPage,
				everyPageSaved,
				pageTotal: totalLicensesFromPage,
				parsedTotal: totalParsed,
			}),
			isFirstPage: pageCount === 1
		};

		try {
			const saved = await setGameLicenseData({ licenseData: JSON.stringify(payload), steamUserID });
			if (saved === false || saved === 'false') {
				everyPageSaved = false;
				logError(`Backend rejected page ${pageCount} license data.`);
			} else {
				log(`Incrementally sent page ${pageCount} license data to backend successfully.`);
			}
		} catch (error) {
			everyPageSaved = false;
			logError(`Error sending page ${pageCount} license data to backend:`, error);
		}

		if (isLastPage) {
			log(`Finished fetching pages. Total parsed licenses: ${totalParsed}`);
			clearResumePoint(pageStorage(), resumeKey);
			return everyPageSaved;
		}
	}

	log(`License sync stopped before the last page, at page ${progress.page}. Parsed ${totalParsed} licenses.`);
	// Note where it stopped, unless a page failed to save (it would be skipped on resuming), or a
	// resumed sync couldn't fetch even its first page (Steam may no longer accept the saved link)
	const resumeFailedAtOnce = resume && isFirstFetched;
	if (everyPageSaved && !brokenLink && !resumeFailedAtOnce && progress.page > 1 && totalLicensesFromPage > 0) {
		saveResumePoint(pageStorage(), resumeKey, {
			url: progress.url,
			page: progress.page,
			parsed: totalParsed,
			total: totalLicensesFromPage,
			savedAt: Date.now(),
		});
	} else {
		clearResumePoint(pageStorage(), resumeKey);
	}
	return false;
}

async function maybeSyncFriends(steamUserID) {
	const currentUrl = new URL(window.location.href);
	if (currentUrl.origin !== 'https://steamcommunity.com') {
		log('Skipping friends sync outside Steam Community origin.');
		return;
	}

	const isExplicitSync = takeExplicitSyncFlag();
	const storageKey = friendsSyncKey(steamUserID);
	if (isExplicitSync) {
		showSyncOverlay(w('sync.titleFriends'), w('sync.friendsFetching'));
	} else if (!(await readyForBackgroundSync('friends sync', storageKey, FRIENDS_SYNC_INTERVAL_MS))) {
		return;
	}

	const html = await fetchPage('https://steamcommunity.com/my/friends/', syncPriority(isExplicitSync));
	if (!html) {
		log('Failed to fetch Steam friends page.');
		if (isExplicitSync) {
			updateSyncOverlay(w('sync.friendsFailed'));
			setTimeout(closeSyncOverlay, 2000);
		}
		return;
	}

	const parser = new DOMParser();
	const doc = parser.parseFromString(html, 'text/html');
	const friendList = doc.querySelector('#friends_list');
	if (!friendList) {
		log('friends_list not found in the HTML.');
		if (isExplicitSync) {
			updateSyncOverlay(w('sync.friendsNone'));
			setTimeout(closeSyncOverlay, 2000);
		}
		return;
	}

	if (isExplicitSync) {
		updateSyncOverlay(w('sync.friendsReading'), 50);
	}

	const friends = parseFriendsList(friendList);
	log(`Parsed ${friends.length} Steam friends`);

	try {
		// The backend reports a failed save by returning false, not by throwing
		const saved = await setFriendsCache({ friendsJson: JSON.stringify(friends), steamUserID });
		if (saved === false || saved === 'false') {
			throw new Error('backend rejected the friends list');
		}
		log('Friends cache sent to backend successfully.');
		recordRun(pageStorage(), storageKey, Date.now());
		if (isExplicitSync) {
			updateSyncOverlay(w('sync.complete'), 100);
			setTimeout(() => {
				window.location.href = 'steam://open/games';
			}, 1000);
		}
	} catch (error) {
		logError('Error sending friends cache to backend:', error);
		if (isExplicitSync) {
			updateSyncOverlay(w('sync.friendsSaveFailed'));
			setTimeout(closeSyncOverlay, 2000);
		}
	}
}

function showSyncOverlay(title, initialStatus) {
	const overlayId = 'gratitude-sync-overlay';
	if (document.getElementById(overlayId)) return;

	const overlay = document.createElement('div');
	overlay.id = overlayId;
	overlay.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		background: rgba(20, 24, 30, 0.96);
		color: #fff;
		z-index: 9999999;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		font-family: 'Motiva Sans', 'Inter', system-ui, -apple-system, sans-serif;
	`;

	overlay.innerHTML = `
		<div style="background: #182029; border: 1px solid #2d3844; border-radius: 3px; padding: 28px; box-shadow: 0 16px 32px rgba(0,0,0,0.6); width: 380px; text-align: center; box-sizing: border-box;">
			<div style="font-size: 16px; font-weight: 500; margin-bottom: 12px; color: #fff; text-transform: uppercase; letter-spacing: 1px;">${title}</div>
			<div id="gratitude-sync-status" style="font-size: 12px; margin-bottom: 24px; color: #8b929a; line-height: 1.5; font-weight: 400;">${initialStatus}</div>
			<div id="gratitude-sync-progress-container" style="display: none; width: 100%; background: #202932; border-radius: 2px; height: 6px; margin-bottom: 20px; overflow: hidden;">
				<div id="gratitude-sync-progress-bar" style="width: 0%; height: 100%; background: #66c0f4; transition: width 0.3s ease;"></div>
			</div>
			<div id="gratitude-sync-spinner" style="margin: 0 auto; border: 3px solid rgba(102, 192, 244, 0.1); border-top: 3px solid #66c0f4; border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite;"></div>
		</div>
		<style>
			@keyframes spin {
				0% { transform: rotate(0deg); }
				100% { transform: rotate(360deg); }
			}
		</style>
	`;

	document.body.appendChild(overlay);
}

function updateSyncOverlay(status, progressPercent) {
	const statusEl = document.getElementById('gratitude-sync-status');
	if (statusEl) {
		statusEl.textContent = status;
	}

	if (typeof progressPercent === 'number') {
		const container = document.getElementById('gratitude-sync-progress-container');
		const bar = document.getElementById('gratitude-sync-progress-bar');
		if (container && bar) {
			container.style.display = 'block';
			bar.style.width = `${Math.min(100, Math.max(0, progressPercent))}%`;
		}
	}
}

function closeSyncOverlay() {
	const overlay = document.getElementById('gratitude-sync-overlay');
	if (overlay) {
		overlay.remove();
	}
}

// priority is a Fetch Priority hint: 'low' lets the page's own requests go first. Each request
// has a time limit and is retried with growing waits (see page-fetch.ts); onRetry runs before each
// retry. Returns null when the page couldn't be fetched.
async function fetchPage(url, priority = 'auto', onRetry) {
	return fetchTextWithRetry(url, {
		init: { credentials: 'include', priority },
		onRetry: (info) => {
			logError(`Fetching ${url} failed (${info.reason}); retry ${info.retry} in ${Math.round(info.waitMs / 1000)}s.`);
			onRetry?.(info);
		},
	});
}

function parseLicenseTable(table) {
	const licenses = [];
	const rows = table.querySelectorAll('tbody tr');

	rows.forEach((row) => {
		// The header row uses th cells with the same classes; only td rows are licenses. Taking the
		// header as a license added a fake "Item" to every sync, and made a page with no licenses
		// on it look like a page with one.
		const dateCell = row.querySelector('td.license_date_col');
		const itemCell = row.children[1];
		const acquisitionCell = row.querySelector('td.license_acquisition_col');

		if (row.querySelector('th') || row.querySelector('td[colspan]')) {
			return;
		}
		if (!dateCell || !itemCell || !acquisitionCell) {
			logError('Missing expected table cells in row:', row);
			return;
		}

		const date = standardizeDate(dateCell.textContent?.trim() || '');
		const item = itemCell.textContent
			?.split('\n')
			.map((line) => line.trim())
			.filter((line) => line && line !== 'Remove')
			.join(' ') || '';
		const acquisition = acquisitionCell.textContent?.trim() || '';
		licenses.push({ date, item, acquisition });
	});

	return licenses;
}

function parseFriendsList(root) {
	const rows = Array.from(root.querySelectorAll('.friend_block_v2'));
	const friends = [];

	for (const row of rows) {
		const steamID64 = row.getAttribute('data-steamid')?.trim();
		const profileUrl = row.querySelector('.selectable_overlay[href]')?.href?.trim();
		const avatarUrl = row.querySelector('.player_avatar img[src]')?.src?.trim();
		const displayName = getFriendDisplayName(row);
		const nicknameOrAlias = getFriendAlias(row, displayName, profileUrl);

		if (!steamID64 || !displayName) {
			logError('Skipping friend row with incomplete data.');
			continue;
		}

		friends.push({
			steamID64,
			profileUrl: profileUrl || undefined,
			displayName,
			nicknameOrAlias,
			avatarUrl: avatarUrl || undefined,
		});
	}

	return friends;
}

function getFriendDisplayName(row) {
	const content = row.querySelector('.friend_block_content');
	if (!content) {
		return '';
	}

	const contentClone = content.cloneNode(true);
	const nicknameHint = contentClone.querySelector('.player_nickname_hint');
	if (nicknameHint) {
		nicknameHint.remove();
	}

	const gameName = row.querySelector('.friend_game_link')?.textContent?.trim();
	const lastOnlineText = row.querySelector('.friend_last_online_text')?.textContent?.trim();
	const lines = (contentClone.textContent ?? '')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => line !== gameName && line !== lastOnlineText);

	return lines[0] ?? '';
}

function getFriendAlias(row, displayName, profileUrl) {
	const aliases = new Set();

	const dataSearch = row.getAttribute('data-search');
	if (dataSearch && displayName) {
		const parts = dataSearch.split(' ; ');
		const lowerDisplay = displayName.toLowerCase();

		[parts[0], parts[2]].forEach((part) => {
			if (!part) return;
			const name = part.trim();
			if (name && name.toLowerCase() !== lowerDisplay) {
				aliases.add(name);
			}
		});
	}

	const profileSlug = getProfileSlug(profileUrl);
	if (
		profileSlug &&
		displayName &&
		profileSlug.toLowerCase() !== displayName.toLowerCase() &&
		!isSteamID64(profileSlug)
	) {
		aliases.add(profileSlug);
	}

	if (aliases.size === 0) {
		return undefined;
	}

	return Array.from(aliases).join(' | ');
}

function getProfileSlug(profileUrl) {
	if (!profileUrl) {
		return undefined;
	}

	const trimmedUrl = profileUrl.replace(/\/+$/, '');
	const segments = trimmedUrl.split('/');
	return segments[segments.length - 1] || undefined;
}

function isSteamID64(value) {
	return /^\d{17}$/.test(value.trim());
}

// Standardise date format (Last Played is Mar 5, 2025 while License Data is 5 Mar, 2025)
function standardizeDate(dateStr) {
	const date = new Date(dateStr);
	if (isNaN(date.getTime())) {
		return dateStr; // Return original string if parsing fails
	}

	const day = date.getDate().toString();
	const month = date.toLocaleString('en-US', { month: 'short' });
	const year = date.getFullYear();
	// Use the format "Mar 5, 2025" so our dates are consistent with existing UI (e.g. Last Played tooltip).
	return `${month} ${day}, ${year}`;
}
