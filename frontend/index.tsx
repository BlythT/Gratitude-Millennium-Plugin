import { Millennium, IconsModule, definePlugin, Field, DialogButton, callable, Spinner } from '@steambrew/client';
import { log, logError } from './lib/logger';
import { setupObserver, clearFrontendCache } from './injection/observer';

// Declare backend functions
const isGameLicenseCachePopulated = callable<[], boolean>('IsGameLicenseCachePopulated');
const getCacheEntryCount = callable<[], number>('GetCacheEntryCount');
const clearCache = callable<[], boolean>('ClearCache');

import { useState, useEffect } from 'react';

const SettingsContent = () => {
	const [isLoading, setIsLoading] = useState(true);
	const [entryCount, setEntryCount] = useState(0);

	const checkCache = async () => {
		return await isGameLicenseCachePopulated().then((populated) => {
			log('Response from IsGameLicenseCachePopulated:', populated);
			return populated;
		}).catch((error) => {
			logError('Error checking if cache is populated:', error);
			return false;
		});
	};

	const updateEntryCount = async () => {
		try {
			const count = await getCacheEntryCount();
			setEntryCount(count);
		} catch (error) {
			logError('Error fetching cache entry count:', error);
		}
	};

	const handleClearCache = async () => {
		try {
			const success = await clearCache();
			if (success) {
				log('Cache cleared successfully');
				clearFrontendCache(); // Clear the in-memory cache
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
		return <Spinner />;
	}

	return (
		<>
			<Field 
				label="Cache Status" 
				description={`${entryCount} game license ${entryCount === 1 ? 'entry' : 'entries'} cached`}
				bottomSeparator="standard"
			/>
			<Field label="Cache Management" bottomSeparator="standard">
				<DialogButton onClick={handleClearCache}>
					Clear Cache
				</DialogButton>
			</Field>
		</>
	);
};

let currentDocument: Document | undefined;

export default definePlugin(() => {
	log('Defining Gratitude plugin');
	Millennium.AddWindowCreateHook?.((context: any) => {
		log('WindowCreateHook triggered for window:', context.m_strName);
		// Only handle main Steam windows (Desktop or Big Picture)
		if (!context.m_strName?.startsWith('SP ')) {
			log('Ignoring non-main window:', context.m_strName);
			return;
		}

		const doc = context.m_popup?.document;
		if (!doc?.body) {
			log('No document body found for window:', context.m_strName);
			return;
		}
		log('Window created:', context.m_strName);

		// Clean up old document if switching modes
		if (currentDocument && currentDocument !== doc) {
			log('Mode switch detected, cleaning up old document');
			// TODO: test this
			// removeExistingDisplay(currentDocument);
			// disconnectObserver();
			// resetState();
		}

		currentDocument = doc;
		setupObserver(doc);
	});

	return {
		title: 'Gratitude',
		icon: <IconsModule.Settings />,
		content: <SettingsContent />,
	};
});
