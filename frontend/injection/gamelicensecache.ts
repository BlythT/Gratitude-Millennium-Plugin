import { callable } from '@steambrew/client';
import { CacheManager } from './CacheManager';
import { isTruthy } from '../utils/truthy';

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

class GameLicenseCache {
	private manager = new CacheManager<UserLicenseCache>(
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
		}
	);

	async getData(steamUserID: string): Promise<UserLicenseCache> {
		const data = await this.manager.getData(steamUserID);
		if (!data) {
			return {
				byAppId: new Map<string, GameLicenseEntry>(),
				byName: new Map<string, GameLicenseEntry>(),
				isPopulated: false
			};
		}
		return data;
	}

	getDataSync(steamUserID: string): UserLicenseCache | null {
		const data = this.manager.getDataSync(steamUserID);
		return data && data.isPopulated ? data : null;
	}

	async clearCache(steamUserID: string): Promise<boolean> {
		return await this.manager.clearCache(steamUserID);
	}

	invalidate(steamUserID: string): void {
		this.manager.invalidate(steamUserID);
	}
}

export const gameLicenseCache = new GameLicenseCache();
