// @ts-nocheck
import { callable } from '@steambrew/webkit';
import { log, logError } from '../lib/logger';
import { getCurrentAccountID } from '../lib/steamid';
import { fuzzyMatchLicenseName } from '../lib/license-matching.js';
import { LICENSES_URL, nextLicensePageUrl, shouldSkipLicenseSync, completedLicenseCount, parseLicenseTotal, withoutExplicitSyncFlag } from '../lib/license-sync';
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

// For an automatic sync: false when it ran recently. Otherwise waits until the page is idle, so
// Steam's own loading (the Library at startup, the Store page itself) goes first.
async function readyForBackgroundSync(name, storageKey, intervalMs) {
	const lastRun = readLastRun(window.localStorage, storageKey);
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
// last page, when a page can't be fetched or its next link can't be followed.
async function* fetchAllLicensePages(startUrl, priority) {
	let currentUrl = startUrl;
	let pageCount = 1;
	const parser = new DOMParser();

	log(`Fetching Steam Licenses HTML (l=english, offset=0)`);

	while (currentUrl) {
		const html = await fetchPage(currentUrl, priority);
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
		updateSyncOverlay('Sync complete! Returning to Library...', 100);
		setTimeout(() => {
			window.location.href = 'steam://open/games';
		}, 1000);
		return;
	}
	updateSyncOverlay("Sync didn't finish, so some gift data may be missing. Please try again later.");
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
		showSyncOverlay('Gratitude: Sync Licenses', 'Connecting to Steam store...');
	} else if (!(await readyForBackgroundSync('license check', storageKey, LICENSE_CHECK_INTERVAL_MS))) {
		return;
	}

	let completed = false;
	try {
		completed = await syncLicensePages(steamUserID, isExplicitSync);
		if (completed) {
			recordRun(window.localStorage, storageKey, Date.now());
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
	const startUrl = `${LICENSES_URL}?l=english`;
	let totalLicensesFromPage = 0;
	let ownedGames = [];
	let gamesMap = new Map();
	let totalParsed = 0;
	let everyPageSaved = true;

	const priority = syncPriority(isExplicitSync);
	for await (const { doc, pageCount, isLastPage } of fetchAllLicensePages(startUrl, priority)) {
		// 1. If we are on page 1, fetch ownedGames so we have them, and check cache optimization
		if (pageCount === 1) {
			// Extract total licenses from paginator
			totalLicensesFromPage = parseLicenseTotal(doc.querySelector('.license_paginator_ctn span')?.textContent);

			if (isExplicitSync) {
				updateSyncOverlay(`Syncing licenses...`, 10);
			}

			if (await shouldSkipSync(steamUserID, totalLicensesFromPage, isExplicitSync)) {
				return true;
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
		totalParsed += licenses.length;
		log(`Parsed ${licenses.length} License Data entries from page ${pageCount}`);

		if (isExplicitSync) {
			const progressPercent = totalLicensesFromPage > 0 
				? Math.min(95, Math.round((totalParsed / totalLicensesFromPage) * 100)) 
				: Math.min(95, 10 + pageCount * 15);
			updateSyncOverlay(
				`Syncing licenses (Page ${pageCount}, items ${totalParsed}${totalLicensesFromPage ? ` of ${totalLicensesFromPage}` : ''})...`,
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
			return everyPageSaved;
		}
	}

	log(`License sync stopped before the last page. Parsed ${totalParsed} licenses.`);
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
		showSyncOverlay('Gratitude: Sync Friends', 'Fetching friends list from Steam...');
	} else if (!(await readyForBackgroundSync('friends sync', storageKey, FRIENDS_SYNC_INTERVAL_MS))) {
		return;
	}

	const html = await fetchPage('https://steamcommunity.com/my/friends/', syncPriority(isExplicitSync));
	if (!html) {
		log('Failed to fetch Steam friends page.');
		if (isExplicitSync) {
			updateSyncOverlay('Failed to fetch friends list.');
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
			updateSyncOverlay('No friends list found.');
			setTimeout(closeSyncOverlay, 2000);
		}
		return;
	}

	if (isExplicitSync) {
		updateSyncOverlay('Parsing friends list...', 50);
	}

	const friends = parseFriendsList(friendList);
	log(`Parsed ${friends.length} Steam friends`);

	try {
		await setFriendsCache({ friendsJson: JSON.stringify(friends), steamUserID });
		log('Friends cache sent to backend successfully.');
		recordRun(window.localStorage, storageKey, Date.now());
		if (isExplicitSync) {
			updateSyncOverlay('Sync complete! Returning to Library...', 100);
			setTimeout(() => {
				window.location.href = 'steam://open/games';
			}, 1000);
		}
	} catch (error) {
		logError('Error sending friends cache to backend:', error);
		if (isExplicitSync) {
			updateSyncOverlay('Error saving friends cache.');
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

// priority is a Fetch Priority hint: 'low' lets the page's own requests go first
async function fetchPage(url, priority = 'auto', retries = 3, delayMs = 1000) {
	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetch(url, {
				credentials: 'include',
				priority,
			});
			if (response.ok) {
				return await response.text();
			}
			logError(`Failed to fetch ${url}:`, response.status);
		} catch (error) {
			logError(`Fetch attempt ${i + 1} failed for ${url}:`, error);
		}

		if (i < retries - 1) {
			await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
		}
	}

	return null;
}

function parseLicenseTable(table) {
	const licenses = [];
	const rows = table.querySelectorAll('tbody tr');

	rows.forEach((row) => {
		const dateCell = row.querySelector('.license_date_col');
		const itemCell = row.children[1];
		const acquisitionCell = row.querySelector('.license_acquisition_col');

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
