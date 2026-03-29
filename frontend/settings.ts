import { callable } from '@steambrew/client';
import { useEffect, useState } from 'react';
import { logError } from '../lib/logger';

export type GratitudeSettings = {
	showFriendPickerSteamUrl: boolean;
};

export const DEFAULT_SETTINGS: GratitudeSettings = {
	showFriendPickerSteamUrl: false,
};

const getUiSettings = callable<[{ steamUserID: string }], string>('GetUiSettings');
const setUiSettings = callable<[{ payloadJson: string }], boolean>('SetUiSettings');

type SettingsKey = keyof GratitudeSettings;

type CachedSettings = {
	settings: GratitudeSettings;
	isLoaded: boolean;
};

function normalizeBooleanSetting(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function normalizeSettings(payload: unknown): GratitudeSettings {
	const parsed = (payload && typeof payload === 'object') ? payload as Partial<GratitudeSettings> : {};

	return {
		showFriendPickerSteamUrl: normalizeBooleanSetting(
			parsed.showFriendPickerSteamUrl,
			DEFAULT_SETTINGS.showFriendPickerSteamUrl,
		),
	};
}

class SettingsCache {
	private cache: Map<string, CachedSettings> = new Map();

	getSync(steamUserID: string): GratitudeSettings {
		return this.cache.get(steamUserID)?.settings ?? DEFAULT_SETTINGS;
	}

	async get(steamUserID: string, forceReload = false): Promise<GratitudeSettings> {
		const cached = this.cache.get(steamUserID);
		if (cached?.isLoaded && !forceReload) {
			return cached.settings;
		}

		try {
			const payload = await getUiSettings({ steamUserID });
			const parsed = payload ? JSON.parse(payload) : {};
			const settings = normalizeSettings(parsed);
			this.cache.set(steamUserID, { settings, isLoaded: true });
			return settings;
		} catch (error) {
			logError(`Error loading UI settings for user ${steamUserID}:`, error);
			const settings = this.getSync(steamUserID);
			this.cache.set(steamUserID, { settings, isLoaded: true });
			return settings;
		}
	}

	async update<K extends SettingsKey>(steamUserID: string, key: K, value: GratitudeSettings[K]): Promise<boolean> {
		const currentSettings = await this.get(steamUserID);
		const nextSettings = {
			...currentSettings,
			[key]: value,
		};

		this.cache.set(steamUserID, { settings: nextSettings, isLoaded: true });

		try {
			return await setUiSettings({
				payloadJson: JSON.stringify({
					steamUserID,
					settings: nextSettings,
				}),
			});
		} catch (error) {
			logError(`Error saving UI settings for user ${steamUserID}:`, error);
			this.cache.set(steamUserID, { settings: currentSettings, isLoaded: true });
			return false;
		}
	}
}

const settingsCache = new SettingsCache();

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
			setSettings(previousSettings);
		}

		return success;
	};

	return [settings, updateSetting];
}
