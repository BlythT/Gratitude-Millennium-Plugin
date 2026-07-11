// @ts-nocheck
import { callable } from '@steambrew/webkit';
import { log, logError } from '../lib/logger';
import { getCurrentAccountID } from '../lib/steamid';
import { fuzzyMatchLicenseName } from '../lib/license-matching.js';

const setGameLicenseData = callable('SetGameLicenseData');
const getGameLicenseData = callable('GetGameLicenseData');
const setFriendsCache = callable('SetFriendsCache');

export default async function WebkitMain() {
	log('WebkitMain loaded');

	const steamUserID = getCurrentAccountID();
	if (!steamUserID || steamUserID === '') {
		logError('Could not get current Steam User ID.');
		return;
	}

	void maybeSyncLicenses(steamUserID).catch((error) => {
		logError('Unexpected error during license sync:', error);
	});

	void maybeSyncFriends(steamUserID).catch((error) => {
		logError('Unexpected error during friends sync:', error);
	});
}

async function fetchOwnedGames(doc) {
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
			`&language=english`
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

async function shouldSkipSync(steamUserID, expectedTotal) {
	if (expectedTotal <= 0) return false;
	try {
		const existingCacheStr = await getGameLicenseData(steamUserID);
		if (existingCacheStr) {
			const existingCache = JSON.parse(existingCacheStr);
			if (existingCache && existingCache.totalLicenses === expectedTotal) {
				log(`Total licenses (${expectedTotal}) unchanged from backend cache. Skipping full sync.`);
				return true;
			}
		}
	} catch (err) {
		logError('Error checking backend cache for optimization:', err);
	}
	return false;
}

async function* fetchAllLicensePages(startUrl) {
	let currentUrl = startUrl;
	let hasNextPage = true;
	let pageCount = 1;
	const parser = new DOMParser();

	log(`Fetching Steam Licenses HTML (l=english, offset=0)`);

	while (hasNextPage) {
		const html = await fetchPage(currentUrl);
		if (!html) {
			log(`Failed to fetch Steam Licenses at page ${pageCount}.`);
			break;
		}

		const doc = parser.parseFromString(html, 'text/html');
		yield { doc, pageCount };

		const nextButton = doc.querySelector('.license_paginator_next');
		if (nextButton && nextButton.getAttribute('href')) {
			const href = nextButton.getAttribute('href');
			currentUrl = `https://store.steampowered.com/account/licenses/${href}`;
			pageCount++;
			// Small delay to be polite to Steam servers
			await new Promise(r => setTimeout(r, 300));
		} else {
			hasNextPage = false;
		}
	}
}

async function maybeSyncLicenses(steamUserID) {
	const startUrl = 'https://store.steampowered.com/account/licenses/?l=english';
	let totalLicensesFromPage = 0;
	let ownedGames = [];
	let gamesMap = new Map();
	let totalParsed = 0;

	for await (const { doc, pageCount } of fetchAllLicensePages(startUrl)) {
		// 1. If we are on page 1, fetch ownedGames so we have them, and check cache optimization
		if (pageCount === 1) {
			// Extract total licenses from paginator
			const paginatorSpan = doc.querySelector('.license_paginator_ctn span');
			if (paginatorSpan) {
				const match = paginatorSpan.textContent?.match(/of\s+(\d+)/i);
				if (match) {
					totalLicensesFromPage = parseInt(match[1], 10);
				}
			}

			if (await shouldSkipSync(steamUserID, totalLicensesFromPage)) {
				return;
			}

			ownedGames = await fetchOwnedGames(doc);
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
			break;
		}

		const licenses = parseLicenseTable(table);
		totalParsed += licenses.length;
		log(`Parsed ${licenses.length} License Data entries from page ${pageCount}`);

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
			totalLicenses: totalLicensesFromPage || totalParsed,
			isFirstPage: pageCount === 1
		};

		try {
			await setGameLicenseData({ licenseData: JSON.stringify(payload), steamUserID });
			log(`Incrementally sent page ${pageCount} license data to backend successfully.`);
		} catch (error) {
			logError(`Error sending page ${pageCount} license data to backend:`, error);
		}
	}

	log(`Finished fetching pages. Total parsed licenses: ${totalParsed}`);
}

async function maybeSyncFriends(steamUserID) {
	const currentUrl = new URL(window.location.href);
	if (currentUrl.origin !== 'https://steamcommunity.com') {
		log('Skipping friends sync outside Steam Community origin.');
		return;
	}

	const html = await fetchPage('https://steamcommunity.com/my/friends/');
	if (!html) {
		log('Failed to fetch Steam friends page.');
		return;
	}

	const parser = new DOMParser();
	const doc = parser.parseFromString(html, 'text/html');
	const friendList = doc.querySelector('#friends_list');
	if (!friendList) {
		log('friends_list not found in the HTML.');
		return;
	}

	const friends = parseFriendsList(friendList);
	log(`Parsed ${friends.length} Steam friends`);

	try {
		await setFriendsCache({ friendsJson: JSON.stringify(friends), steamUserID });
		log('Friends cache sent to backend successfully.');
	} catch (error) {
		logError('Error sending friends cache to backend:', error);
	}
}

async function fetchPage(url, retries = 3, delayMs = 1000) {
	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetch(url, {
				credentials: 'include',
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
