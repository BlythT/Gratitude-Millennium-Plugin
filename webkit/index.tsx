// @ts-nocheck
import { callable } from '@steambrew/webkit';
import { log, logError } from '../lib/logger';
import { getCurrentAccountID } from '../lib/steamid';

const setGameLicenseData = callable('SetGameLicenseData');
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

async function maybeSyncLicenses(steamUserID) {
	const html = await fetchPage('https://store.steampowered.com/account/licenses/');
	if (!html) {
		log('Failed to fetch Steam Licenses.');
		return;
	}

	log('Fetched Steam Licenses HTML');

	const parser = new DOMParser();
	const doc = parser.parseFromString(html, 'text/html');
	const table = doc.querySelector('table.account_table');
	if (!table) {
		log('account_table not found in the HTML.');
		return;
	}

	log('Found account_table');

	const data = parseLicenseTable(table);
	log('Parsed License Data:', data);

	try {
		await setGameLicenseData({ licenseData: JSON.stringify(data), steamUserID });
		log('License data sent to backend successfully.');
	} catch (error) {
		logError('Error sending license data to backend:', error);
	}
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
	const dataSearch = row.getAttribute('data-search');
	const aliases = new Set();

	if (dataSearch) {
		const normalizedSegments = dataSearch
			.split(/[;\n|]+/)
			.map((segment) => segment.trim())
			.filter(Boolean);

		for (const segment of normalizedSegments) {
			const loweredSegment = segment.toLowerCase();
			if (displayName && loweredSegment === displayName.toLowerCase()) {
				continue;
			}
			aliases.add(segment);
		}
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
