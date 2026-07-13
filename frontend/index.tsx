import { IconsModule, definePlugin, Field, DialogButton, ToggleField, callable } from '@steambrew/client';
import { log, logError, logDebug } from '../lib/logger';
import { injectionEngine } from './lib/framework/InjectionEngine';
import { GiftBadge } from './components/GiftBadge';
import { isTruthy } from './utils/truthy';
import { gameLicenseCache } from './injection/gamelicensecache';
import { friendsCache } from './injection/friendscache';
import { giverCache } from './injection/givercache';
import { useState, useEffect, useRef } from 'react';
import { showConsentModal } from './components/ConsentModal';
import { getCurrentAccountID } from '../lib/steamid';
import { POPUPS, SELECTORS, type GiverSource } from './types';
import { useSettings } from './settings';
import { FriendSelector } from './components/FriendSelector';

// Declare backend functions
const isGameLicenseCachePopulated = callable<[{ steamUserID: string }], boolean>('IsGameLicenseCachePopulated');
const getAllCacheEntries = callable<[{ steamUserID: string }], string>('GetGameLicenseData');
const hasUserConsented = callable<[{ steamUserID: string }], boolean | string>('HasUserConsented');
const setConsent = callable<[{ steamUserID: string, consent: boolean }], boolean>('SetConsent');
const SettingsContent = () => {
	const steamUserID = getCurrentAccountID() || '';
	const [isLoading, setIsLoading] = useState(true);
	const [licenseCount, setLicenseCount] = useState(0);
	const [friendCount, setFriendCount] = useState(0);
	const [giverCount, setGiverCount] = useState(0);
	const [hasConsent, setHasConsent] = useState<boolean | null>(true);
	const [settings, setSetting] = useSettings(steamUserID);
	const clickCountRef = useRef(0);
	const [showZoo, setShowZoo] = useState(false);
	const [zooName, setZooName] = useState('');
	const [zooProfile, setZooProfile] = useState('');
	const [zooSource, setZooSource] = useState<GiverSource>('manual');

	useEffect(() => {
		hasUserConsented({ steamUserID }).then((consented) => {
			setHasConsent(consented === true || consented === 'true');
		}).catch(error => {
			logError('Error checking consent in settings:', error);
		});
	}, [steamUserID]);

	const checkCache = async () => {
		return await isGameLicenseCachePopulated({ steamUserID: getCurrentAccountID() || '' }).then((populated) => {
			log('Response from IsGameLicenseCachePopulated:', populated);
			return populated;
		}).catch((error) => {
			logError('Error checking if cache is populated:', error);
			return false;
		});
	};

	const updateEntryCount = async () => {
		try {
			const steamID = getCurrentAccountID() || '';
			const data = await getAllCacheEntries({ steamUserID: steamID });
			const entries = data ? JSON.parse(data) : {};
			if (entries.byName) {
				setLicenseCount(Object.keys(entries.byName).length);
			} else {
				setLicenseCount(Object.keys(entries).length);
			}

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
			const steamID = getCurrentAccountID() || '';
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
			{hasConsent === false && (
				<Field
					label="Plugin Disabled: Data Access Denied"
					description="Gratitude cannot function without permission to read your Steam license history. Please grant permission to re-enable the plugin."
					bottomSeparator="standard"
					childrenLayout="below"
				>
					<DialogButton onClick={async () => {
						try {
							await setConsent({ steamUserID, consent: true });
							setHasConsent(true);
							window.open("steam://openurl/https://store.steampowered.com/?gratitude_sync=1");
						} catch (error) {
							logError('Error granting consent from settings:', error);
						}
					}}>
						Grant Permission
					</DialogButton>
				</Field>
			)}
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
						description={(
							<span
								onClick={() => {
									clickCountRef.current += 1;
									if (clickCountRef.current >= 5) {
										setShowZoo(prev => !prev);
										clickCountRef.current = 0;
									}
								}}
								style={{ userSelect: 'none' }}
							>
								{`${giverCount} manually recorded gifts. (This is never cleared automatically).`}
							</span>
						)}
						bottomSeparator="standard"
					/>
					<Field
						label="Missing something?"
						description="Newly gifted games might not be detected: try visiting the store or restarting steam before checking your library"
						bottomSeparator="standard"
					/>
					{showZoo && (
						<Field
							label="Developer Component Zoo"
							description="Developer previews of custom React elements. Click your data description again to toggle."
							bottomSeparator="standard"
							childrenLayout="below"
						>
							<div style={{ background: 'rgba(0, 0, 0, 0.25)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '4px', padding: '16px', marginTop: '10px' }}>
								<div style={{ position: 'relative', marginBottom: '16px' }}>
									<FriendSelector
										steamUserID={steamUserID}
										displayName={zooName}
										onChangeDisplayName={setZooName}
										profileField={zooProfile}
										onChangeProfileField={setZooProfile}
										source={zooSource}
										onChangeSource={setZooSource}
										settings={settings}
										isLinkedFriend={zooSource === 'friend-cache' && Boolean(zooProfile)}
										onEmailSearch={() => alert('Gmail search icon clicked')}
										onRefreshFriends={() => alert('Fetch friends clicked')}
									/>
								</div>
								<div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', display: 'grid', gap: '4px' }}>
									<div><strong>Zoo State Tracker:</strong></div>
									<div>Display Name: {zooName || '""'}</div>
									<div>Profile ID/Url: {zooProfile || '""'}</div>
									<div>Source: {zooSource}</div>
									<div>Is Linked Friend: {String(zooSource === 'friend-cache' && Boolean(zooProfile))}</div>
								</div>
								<div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
									<DialogButton onClick={() => setShowZoo(false)}>
										Close Component Zoo
									</DialogButton>
								</div>
							</div>
						</Field>
					)}
				</>
			)}
		</>
	);
};

let consentModalShown = false;

interface SteamPopup {
	m_strName: string;
	m_popup?: {
		document: Document;
	} | null;
	window: Window;
}

// Popup callback to handle main window initialization
async function onPopupCreation(popup: SteamPopup) {
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
				if (!currentUserID) {
					logError('Could not resolve current Steam User ID during popup creation.');
					return;
				}
				const userConsented = await hasUserConsented({ steamUserID: currentUserID });
				logDebug('RAW IPC RETURN hasUserConsented:', JSON.stringify(userConsented), 'type:', typeof userConsented);
				if (userConsented === null || userConsented === undefined || userConsented === 'null') {
					const timeoutId = window.setTimeout(() => {
						showConsentModal(currentUserID, popup.window);
					}, 2500);

					popup.window.addEventListener('beforeunload', () => {
						window.clearTimeout(timeoutId);
					});
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

injectionEngine.register({
	id: 'gifted-badge',
	selector: [SELECTORS.standard.tooltipContainer, SELECTORS.bigPicture.tooltipContainer],
	insertAfterSelector: [SELECTORS.standard.playtimeTooltip, SELECTORS.bigPicture.playtimeTooltip],
	component: GiftBadge
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
