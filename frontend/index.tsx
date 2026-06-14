import { IconsModule, definePlugin, Field, DialogButton, ToggleField, callable } from '@steambrew/client';
import { log, logError } from '../lib/logger';
import { injectionEngine } from '../lib/framework/InjectionEngine';
import { GiftBadge, type GiftBadgeData } from './components/GiftBadge';
import { detectAppId, detectGameName } from '../lib/framework/steam-context';
import { fuzzyMatchLicenseName } from '../lib/license-matching.js';
import { isTruthy } from '../lib/framework/truthy';
import { gameLicenseCache, type UserLicenseCache } from './injection/gamelicensecache';
import { friendsCache } from './injection/friendscache';
import { giverCache } from './injection/givercache';
import { useState, useEffect } from 'react';
import { showConsentModal } from './components/ConsentModal';
import { getCurrentAccountID } from '../lib/steamid';
import { POPUPS, SELECTORS } from '../lib/framework/steam-constants';
import { type LicenseMatch } from './types';
import { useSettings } from './settings';

// Declare backend functions
const isGameLicenseCachePopulated = callable<[{ steamUserID: string }], boolean>('IsGameLicenseCachePopulated');
const hasUserConsented = callable<[{ steamUserID: string }], boolean>('HasUserConsented');

const SettingsContent = () => {
	const steamUserID = getCurrentAccountID();
	const [isLoading, setIsLoading] = useState(true);
	const [licenseCount, setLicenseCount] = useState(0);
	const [friendCount, setFriendCount] = useState(0);
	const [giverCount, setGiverCount] = useState(0);
	const [settings, setSetting] = useSettings(steamUserID);

	const checkCache = async () => {
		return await isGameLicenseCachePopulated({ steamUserID: getCurrentAccountID() }).then((populated) => {
			log('Response from IsGameLicenseCachePopulated:', populated);
			return populated;
		}).catch((error) => {
			logError('Error checking if cache is populated:', error);
			return false;
		});
	};

	const updateEntryCount = async () => {
		try {
			const steamID = getCurrentAccountID();
			const data = await gameLicenseCache.getData(steamID);
			setLicenseCount(data?.byName?.size || 0);

			const friendsData = await friendsCache.getData(steamID);
			setFriendCount(friendsData?.friends?.length || 0);

			const giversData = await giverCache.getAll(steamID);
			setGiverCount(giversData?.size || 0);
		} catch (error) {
			logError('Error fetching cache entry count:', error);
		}
	};

	const handleClearCache = async () => {
		try {
			const steamID = getCurrentAccountID();
			const successLicense = await gameLicenseCache.clearCache(steamID);
			const successFriends = await friendsCache.clearCache(steamID);
			if (isTruthy(successLicense) || isTruthy(successFriends)) {
				log('Caches cleared successfully');
				setLicenseCount(0);
				setFriendCount(0);
			}
		} catch (error) {
			logError('Error clearing cache:', error);
		}
	};

	// Polling to check if cache is populated
	useEffect(() => {
		let cancelled = false;

		const pollCacheStatus = async () => {
			if (cancelled) return;
			const result = await checkCache();
			if (result) {
				setIsLoading(false);
				await updateEntryCount();
			} else {
				setTimeout(pollCacheStatus, 1000); // Poll every second
			}
		};

		pollCacheStatus();
	}, []);

	return (
		<>
			<ToggleField
				label="Show Steam links"
				description="Show and edit profile links and IDs."
				checked={settings.showFriendPickerSteamUrl}
				onChange={(checked) => void setSetting('showFriendPickerSteamUrl', checked)}
				bottomSeparator="standard"
			/>
			{isLoading ? (
				<Field
					label="Gift History"
					description="Gift History not initialized! Please visit the Store page and come back."
					bottomSeparator="standard"
				/>
			) : (
				<>
					<Field
						label="Scraped Caches"
						description={`${licenseCount} licenses | ${friendCount} friends`}
						bottomSeparator="standard"
						childrenLayout="below"
					>
						<DialogButton onClick={handleClearCache}>
							Clear Scraped Caches
						</DialogButton>
					</Field>
					<Field
						label="Your Data"
						description={`${giverCount} manually recorded gifts. (This is never cleared automatically).`}
						bottomSeparator="standard"
					/>
					<Field
						label="Missing something?"
						description="Newly gifted games might not be detected: try visiting the store or restarting steam before checking your library"
						bottomSeparator="standard"
					/>
				</>
			)}
		</>
	);
};

let consentModalShown = false;

// Popup callback to handle main window initialization
async function onPopupCreation(popup: any) {
	if (!popup) {
		return;
	}

	const isMainWindow = popup.m_strName === POPUPS.main;
	const isBigPictureWindow = popup.m_strName === POPUPS.bigPicture;

	if (isMainWindow || isBigPictureWindow) {
		log('Setting up observer for window:', popup.m_strName);

		if (!consentModalShown) {
			consentModalShown = true;
			try {
				const currentUserID = getCurrentAccountID();
				const userConsented = await hasUserConsented({ steamUserID: currentUserID });
				if (!isTruthy(userConsented)) {
					showConsentModal(currentUserID);
				}
			} catch (error) {
				logError('Error checking consent:', error);
			}
		}

		// Set up observer for library patching
		const doc = popup.m_popup?.document;
		if (doc?.body) {
			injectionEngine.start(doc);
		}
	}
}

function resolveBadgeData(
	doc: Document,
	steamID: string,
	gameName: string,
	licenseDataMap: UserLicenseCache,
	giverCacheInstance: typeof giverCache
): GiftBadgeData | null {
	if (!licenseDataMap.isPopulated) {
		return { status: 'missing-cache', gameName, steamUserID: steamID, match: null, giver: null, doc };
	}

	let match: LicenseMatch | null = null;
	const appId = detectAppId(doc);
	if (appId) {
		const license = licenseDataMap.byAppId.get(String(appId));
		if (license) {
			match = { licenseKey: String(appId), data: license, matchType: 'appid-exact' };
		}
	}

	if (!match) {
		const fuzzyMatch = fuzzyMatchLicenseName(licenseDataMap.byName, gameName);
		if (fuzzyMatch) {
			match = { licenseKey: fuzzyMatch.licenseKey, data: fuzzyMatch.data, matchType: fuzzyMatch.matchType };
		}
	}

	if (!match || match.data.acquisition !== "Gift/Guest Pass") {
		return null;
	}

	let giver = null;
	if (match) {
		giver = giverCacheInstance.getEntrySync(steamID, match.licenseKey, gameName);
	}

	return {
		status: 'gift',
		gameName,
		steamUserID: steamID,
		match,
		giver,
		doc
	};
}

injectionEngine.register({
	id: 'gifted-badge',
	selector: [SELECTORS.standard.tooltipContainer, SELECTORS.bigPicture.tooltipContainer],
	insertAfterSelector: [SELECTORS.standard.playtimeTooltip, SELECTORS.bigPicture.playtimeTooltip],
	component: GiftBadge,
	getData: (doc: Document): GiftBadgeData | null | Promise<GiftBadgeData | null> => {
		const steamID = getCurrentAccountID();
		if (!steamID) return null;

		const gameName = detectGameName(doc);
		if (!gameName) return null;

		// Mixed sync/async wrapper pattern for Zero Layout Shift
		// We try synchronously first. If populated, we return sync (ZLS).
		const cachedLicenses = gameLicenseCache.getDataSync(steamID);
		if (cachedLicenses && cachedLicenses.isPopulated) {
			return resolveBadgeData(doc, steamID, gameName, cachedLicenses, giverCache);
		}

		// Otherwise, drop to async flow.
		return (async () => {
			const licenseDataMap = await gameLicenseCache.getData(steamID);
			if (!licenseDataMap) return null;
			await giverCache.getAll(steamID);
			return resolveBadgeData(doc, steamID, gameName, licenseDataMap, giverCache);
		})();
	}
});

// Initialize: check for existing main window and register callback for new ones
function initializePopupHandling() {
	// @ts-ignore - g_PopupManager exists on window but isn't typed
	const g_PopupManager = window.g_PopupManager;

	if (!g_PopupManager) {
		logError('g_PopupManager not available');
		return;
	}

	// Handle existing main window if already loaded
	const existingMainWindow = g_PopupManager.GetExistingPopup?.('SP Desktop_uid0');
	if (existingMainWindow) {
		onPopupCreation(existingMainWindow);
	}

	// Register callback for newly created popups
	if (typeof g_PopupManager.AddPopupCreatedCallback === 'function') {
		g_PopupManager.AddPopupCreatedCallback(onPopupCreation);
	} else {
		logError('AddPopupCreatedCallback is not a function');
	}
}

export default definePlugin(() => {
	// Initialize popup handling with g_PopupManager for proper startup flow
	initializePopupHandling();

	return {
		title: 'Gratitude',
		icon: <IconsModule.Settings />,
		content: <SettingsContent />,
	};
});
