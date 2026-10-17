import { callable } from '@steambrew/client';
import { useEffect, useState } from 'react';
import { SettingsCache, type GratitudeSettings, type SettingsKey } from './utils/settingsCache';

export { DEFAULT_SETTINGS, type GratitudeSettings } from './utils/settingsCache';

const getUiSettings = callable<[{ steamUserID: string }], string>('GetUiSettings');
const setUiSettings = callable<[{ payloadJson: string }], boolean>('SetUiSettings');

const settingsCache = new SettingsCache(getUiSettings, setUiSettings);

export function getSettingsSync(steamUserID: string): GratitudeSettings {
	return settingsCache.getSync(steamUserID);
}

export function useSettings(
	steamUserID: string,
): [
	GratitudeSettings,
	<K extends SettingsKey>(key: K, value: GratitudeSettings[K]) => Promise<boolean>,
] {
	const [settings, setSettings] = useState<GratitudeSettings>(() => getSettingsSync(steamUserID));

	useEffect(() => {
		let disposed = false;

		void settingsCache.get(steamUserID).then((loadedSettings) => {
			if (!disposed) {
				setSettings(loadedSettings);
			}
		});

		return () => {
			disposed = true;
		};
	}, [steamUserID]);

	const updateSetting = async <K extends SettingsKey>(key: K, value: GratitudeSettings[K]) => {
		const previousSettings = settings;
		const nextSettings = {
			...previousSettings,
			[key]: value,
		};

		setSettings(nextSettings);

		const success = await settingsCache.update(steamUserID, key, value);
		if (!success) {
			// The cache falls back to the last value the backend confirmed, which stays right when
			// updates overlap; this hook's own snapshot would not
			setSettings(settingsCache.getSync(steamUserID));
		}

		return success;
	};

	return [settings, updateSetting];
}
