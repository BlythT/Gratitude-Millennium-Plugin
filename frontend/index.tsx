import { IconsModule, definePlugin, Field, DialogButton, callable } from '@steambrew/client';
import { log, logError } from '../lib/logger';
import { setupObserver, onMainContentReady_Register } from './injection/observer';
import { useState, useEffect } from 'react';
import { showConsentModal } from './components/ConsentModal';
import { getCurrentAccountID } from '../lib/steamid';

// Declare backend functions
const isGameLicenseCachePopulated = callable<[{ steamUserID: string }], boolean>('IsGameLicenseCachePopulated');
const getAllCacheEntries = callable<[{ steamUserID: string }], string>('GetGameLicenseData');
const clearCache = callable<[{ steamUserID: string }], boolean>('ClearCache');
const hasUserConsented = callable<[{ steamUserID: string }], boolean | null>('HasUserConsented');

const SettingsContent = () => {
	const [isLoading, setIsLoading] = useState(true);
	const [entryCount, setEntryCount] = useState(0);

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
			const data = await getAllCacheEntries({ steamUserID: getCurrentAccountID() });
			const entries = data ? JSON.parse(data) : {};
			setEntryCount(Object.keys(entries).length);
		} catch (error) {
			logError('Error fetching cache entry count:', error);
		}
	};

	const handleClearCache = async () => {
		try {
			const success = await clearCache({ steamUserID: getCurrentAccountID() });
			if (success) {
				log('Cache cleared successfully');
				setEntryCount(0);
			}
		} catch (error) {
			logError('Error clearing cache:', error);
		}
	};

	// Polling to check if cache is populated
	useEffect(() => {
		const pollCacheStatus = async () => {
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

	if (isLoading) {
		return (
			<Field
				label="Gift History"
				description="Gift History not initialized! Please visit the Store page and come back."
				bottomSeparator="standard"
			/>
		);
	}

	return (
		<>
			<Field
				label="Cache Status"
				description={`${entryCount} game license ${entryCount === 1 ? 'entry' : 'entries'} cached`}
				bottomSeparator="standard"
			/>
			<Field label="Cache Management" bottomSeparator="standard">
				<DialogButton onClick={handleClearCache} style={{ padding: '.25em .5em' }}>
					Clear Cache
				</DialogButton>
			</Field>
			<Field label="Missing something?"
				description="Newly gifted games might not be detected: try visiting the store or restarting steam before checking your library"
				bottomSeparator="standard" />
		</>
	);
};

let consentModalShown = false;

// Popup callback to handle main window initialization
async function onPopupCreation(popup: any) {
	if (!popup) {
		return;
	}

	const isMainWindow = popup.m_strName === 'SP Desktop_uid0';

	if (isMainWindow) {

		// Register callback to show consent modal when main content loads
		onMainContentReady_Register(async () => {
			if (!consentModalShown) {
				consentModalShown = true;
				try {
					const currentUserID = getCurrentAccountID();
					// Check if user has already consented
					const userConsented = await hasUserConsented({ steamUserID: currentUserID });
					if (!userConsented) {
						showConsentModal(currentUserID);
					}
				} catch (error) {
					logError('Error checking consent:', error);
				}
			}
		});

		// Set up observer for library patching
		const doc = popup.m_popup?.document;
		if (doc?.body) {
			setupObserver(doc);
		}
	}
}

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
