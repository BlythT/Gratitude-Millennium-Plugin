import { logError } from '../../lib/logger';
import { maskId } from '../../lib/log-redact';
import { settingsAfterSave } from './settingsSave';
import { isTruthy } from './truthy';

export type GratitudeSettings = {
	showFriendPickerSteamUrl: boolean;
};

export const DEFAULT_SETTINGS: GratitudeSettings = {
	showFriendPickerSteamUrl: false,
};

export type SettingsKey = keyof GratitudeSettings;

type CachedSettings = {
	settings: GratitudeSettings;
	saved: GratitudeSettings;
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

export class SettingsCache {
	private cache: Map<string, CachedSettings> = new Map();

	constructor(
		private getUiSettings: (args: { steamUserID: string }) => Promise<string>,
		private setUiSettings: (args: { payloadJson: string }) => Promise<unknown>,
	) {}

	getSync(steamUserID: string): GratitudeSettings {
		return this.cache.get(steamUserID)?.settings ?? DEFAULT_SETTINGS;
	}

	async get(steamUserID: string, forceReload = false): Promise<GratitudeSettings> {
		const cached = this.cache.get(steamUserID);
		if (cached?.isLoaded && !forceReload) {
			return cached.settings;
		}

		try {
			const payload = await this.getUiSettings({ steamUserID });
			const parsed = payload ? JSON.parse(payload) : {};
			const settings = normalizeSettings(parsed);
			this.cache.set(steamUserID, { settings, saved: settings, isLoaded: true });
			return settings;
		} catch (error) {
			logError(`Error loading UI settings for user ${maskId(steamUserID)}:`, error);
			const settings = this.getSync(steamUserID);
			this.cache.set(steamUserID, { settings, saved: cached?.saved ?? settings, isLoaded: true });
			return settings;
		}
	}

	async update<K extends SettingsKey>(steamUserID: string, key: K, value: GratitudeSettings[K]): Promise<boolean> {
		const currentSettings = await this.get(steamUserID);
		const nextSettings = {
			...currentSettings,
			[key]: value,
		};

		const saved = this.cache.get(steamUserID)?.saved ?? currentSettings;
		this.cache.set(steamUserID, { settings: nextSettings, saved, isLoaded: true });

		let result: unknown = false;
		try {
			result = await this.setUiSettings({
				payloadJson: JSON.stringify({
					steamUserID,
					settings: nextSettings,
				}),
			});
		} catch (error) {
			logError(`Error saving UI settings for user ${maskId(steamUserID)}:`, error);
		}

		this.settle(steamUserID, nextSettings, result);
		return isTruthy(result);
	}

	// A failed save falls back to the last saved value rather than its own snapshot, which an
	// overlapping update may have left unsaved. A newer update still in flight keeps showing.
	// Assumes the backend answers saves in the order they were sent.
	private settle(steamUserID: string, nextSettings: GratitudeSettings, result: unknown): void {
		const cached = this.cache.get(steamUserID);
		const saved = settingsAfterSave(cached?.saved ?? nextSettings, nextSettings, result);
		const isNewest = !cached || cached.settings === nextSettings;
		this.cache.set(steamUserID, { settings: isNewest ? saved : cached.settings, saved, isLoaded: true });
	}
}
