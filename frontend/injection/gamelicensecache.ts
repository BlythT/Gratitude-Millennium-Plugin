import { callable } from '@steambrew/client';

import { CacheManager } from '../../lib/framework/CacheManager';
import { isTruthy } from '../../lib/framework/truthy';

const isGameLicenseCachePopulated = callable<[{ steamUserID: string }], boolean>('IsGameLicenseCachePopulated');
const getAllCacheEntries = callable<[{ steamUserID: string }], string>('GetGameLicenseData');
const clearCacheBackend = callable<[{ steamUserID: string }], boolean>('ClearCache');

export interface GameLicenseEntry {
	date: string;
	acquisition: string;
	name?: string;
}

export interface UserLicenseCache {
	byAppId: Map<string, GameLicenseEntry>;
	byName: Map<string, GameLicenseEntry>;
	isPopulated: boolean;
}

/**
 * Read-through cache for game license data.
 * 
 * Design optimized for append-only data:
 * - Once loaded, cache is valid forever (data never changes or gets removed)
 * - No TTL or expiration needed
 * - No need to check backend for updates
 * - Only invalidates on explicit clear
 */
export const gameLicenseCache = new CacheManager<UserLicenseCache>(
	'GameLicense',
	async (steamUserID) => {
		const isPopulated = await isGameLicenseCachePopulated({ steamUserID });
		
		if (!isTruthy(isPopulated)) {
			return {
				byAppId: new Map<string, GameLicenseEntry>(),
				byName: new Map<string, GameLicenseEntry>(),
				isPopulated: false
			};
		}

		const entriesJson = await getAllCacheEntries({ steamUserID });
		const dataObj: any = entriesJson ? JSON.parse(entriesJson) : {};
		
		let byAppIdMap: Map<string, GameLicenseEntry>;
		let byNameMap: Map<string, GameLicenseEntry>;

		if (dataObj && (dataObj.byAppId || dataObj.byName)) {
			byAppIdMap = new Map<string, GameLicenseEntry>(Object.entries(dataObj.byAppId ?? {}));
			byNameMap = new Map<string, GameLicenseEntry>(Object.entries(dataObj.byName ?? {}));
		} else {
			byAppIdMap = new Map<string, GameLicenseEntry>();
			byNameMap = new Map<string, GameLicenseEntry>(Object.entries(dataObj ?? {}));
		}
		
		return {
			byAppId: byAppIdMap,
			byName: byNameMap,
			isPopulated: true
		};
	},
	async (steamUserID) => {
		const success = await clearCacheBackend({ steamUserID });
		return isTruthy(success);
	},
	(data) => data !== null && data.isPopulated
);
