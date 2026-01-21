import { Millennium, IconsModule, definePlugin, Field, DialogButton, TextField, callable, Spinner } from '@steambrew/client';
import { log, logError } from '../lib/logger';

// Declare a function that exists on the backend
const getGameLicense = callable<[{ gameName: string }], string>('GetGameLicense');
const isGameLicenseCachePopulated = callable<[], boolean>('IsGameLicenseCachePopulated');
const getGameLicenseData = callable<[], string>('GetGameLicenseData');

import { useState, useEffect } from 'react';

const SettingsContent = () => {
	const [gameName, setGameName] = useState('');
	const [gameLicense, setGameLicense] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	const checkChache = async () => {
		return await isGameLicenseCachePopulated().then((populated) => {
			log('Response from IsGameLicenseCachePopulated:', populated);
			return populated;
		}).catch((error) => {
			logError('Error checking if cache is populated:', error);
			return false;
		});
	};

	// Polling to check if cache is populated
	useEffect(() => {
		const pollCacheStatus = async () => {
			const result = await checkChache();
			if (result) {
				setIsLoading(false);
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
			<Field label="Plugin Settings" description="This is a description of the plugin settings." icon={<IconsModule.Settings />} bottomSeparator="standard" focusable>
				<DialogButton
					onClick={() => {
						log('Button clicked: Fetching license data from backend...');
						getGameLicenseData().then((data) => {
							log('Received license data from backend:', data);
						}).catch((error) => {
							logError('Error fetching license data from backend:', error);
						});
					}}
				>
					List all
				</DialogButton>
			</Field>
			<Field>
				<TextField
					label="Game Name"
					onChange={(e) => setGameName(e.currentTarget.value)}
				/>
				<DialogButton
					onClick={() => {
						log('Button clicked: Fetching license for game:', gameName);
						getGameLicense({ gameName }).then((license) => {
							log(`Received license for ${gameName}:`, license);
							setGameLicense(license);
						}).catch((error) => {
							logError(`Error fetching license for ${gameName}:`, error);
						});
					}}
				>
					Click Me
				</DialogButton>
			</Field>
			<Field label="Game License Data" description="License data for the specified game." bottomSeparator="standard">
				<>
					{gameLicense !== null ? gameLicense : "No data fetched yet."}
				</>
			</Field>
		</>
	);
};

function windowCreatedHook(context: any) {
	// Only handle main Steam windows (Desktop or Big Picture)
	if (!context.m_strName?.startsWith('SP ')) return;

	const doc = context.m_popup?.document;
	if (!doc?.body) return;
	log('Window created:', context.m_strName);
}

export default definePlugin(() => {
	Millennium.AddWindowCreateHook(windowCreatedHook);

	return {
		title: 'My Plugin',
		icon: <IconsModule.Settings />,
		content: <SettingsContent />,
	};
});
