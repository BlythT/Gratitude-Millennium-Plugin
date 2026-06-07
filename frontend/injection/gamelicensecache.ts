import { callable } from '@steambrew/client';
import { log, logError } from '../../lib/logger';

// Backend callable functions
const isGameLicenseCachePopulated = callable<[{ steamUserID: string }], boolean>('IsGameLicenseCachePopulated');
const getAllCacheEntries = callable<[{ steamUserID: string }], string>('GetGameLicenseData');
const clearCacheBackend = callable<[{ steamUserID: string }], boolean>('ClearCache');

// Individual game license entry
interface GameLicenseEntry {
	date: string;
	acquisition: string;
	name?: string;
}

// User cache stores entries in Maps for efficient lookups
interface UserCache {
	byAppId: Map<string, GameLicenseEntry>; // Map<appId, licenseInfo>
	byName: Map<string, GameLicenseEntry>;  // Map<gameName, licenseInfo>
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
class GameLicenseCache {
	private cache: Map<string, UserCache> = new Map();

	/**
	 * Get cache data for a user. Fetches from backend on cache miss.
	 * 
	 * Since data is append-only, once cached it never needs refreshing
	 * unless explicitly cleared.
	 */
	async getData(steamUserID: string): Promise<UserCache> {
		const cached = this.cache.get(steamUserID);
		
		// Cache hit - data is still valid since it's append-only
		if (cached && cached.isPopulated) {
			log(`Cache hit for user ${steamUserID} (${cached.byAppId.size} byAppId, ${cached.byName.size} byName entries)`);
			return cached;
		}

		log(`Cache miss for user ${steamUserID}, fetching from backend`);
		return await this.loadFromBackend(steamUserID);
	}

	/**
	 * Get cache data for a user synchronously.
	 * @returns UserCache, or null if not yet cached
	 */
	getDataSync(steamUserID: string): UserCache | null {
		const cached = this.cache.get(steamUserID);
		return cached && cached.isPopulated ? cached : null;
	}

	/**
	 * Load entire cache from backend for a user.
	 * 
	 * Since data is append-only, this only needs to be called:
	 * - On first access (cache miss)
	 * - After explicit cache clear
	 */
	private async loadFromBackend(steamUserID: string): Promise<UserCache> {
		try {
			// First check if backend cache is populated
			const isPopulated = await isGameLicenseCachePopulated({ steamUserID });
			
			if (!isPopulated) {
				log(`Backend cache not populated for user ${steamUserID}`);
				const emptyCache = {
					byAppId: new Map<string, GameLicenseEntry>(),
					byName: new Map<string, GameLicenseEntry>(),
					isPopulated: false
				};
				this.cache.set(steamUserID, emptyCache);
				return emptyCache;
			}

			// Fetch all entries from backend (returns JSON string)
			const entriesJson = await getAllCacheEntries({ steamUserID });
			const dataObj: any = entriesJson ? JSON.parse(entriesJson) : {};
			
			// Support legacy flat format if present
			let byAppIdMap: Map<string, GameLicenseEntry>;
			let byNameMap: Map<string, GameLicenseEntry>;

			if (dataObj && (dataObj.byAppId || dataObj.byName)) {
				byAppIdMap = new Map<string, GameLicenseEntry>(Object.entries(dataObj.byAppId ?? {}));
				byNameMap = new Map<string, GameLicenseEntry>(Object.entries(dataObj.byName ?? {}));
			} else {
				// Convert old flat format (where the whole object is key: licenseInfo)
				byAppIdMap = new Map<string, GameLicenseEntry>();
				byNameMap = new Map<string, GameLicenseEntry>(Object.entries(dataObj ?? {}));
			}
			
			log(`Loaded cache from backend for user ${steamUserID}: ${byAppIdMap.size} byAppId, ${byNameMap.size} byName entries`);

			const userCache = {
				byAppId: byAppIdMap,
				byName: byNameMap,
				isPopulated: true
			};

			// Update local cache
			this.cache.set(steamUserID, userCache);

			return userCache;
		} catch (error) {
			logError(`Error loading cache from backend for user ${steamUserID}:`, error);
			const errorCache = {
				byAppId: new Map<string, GameLicenseEntry>(),
				byName: new Map<string, GameLicenseEntry>(),
				isPopulated: false
			};
			return errorCache;
		}
	}

	/**
	 * Clear cache for a user (both frontend and backend)
	 */
	async clearCache(steamUserID: string): Promise<boolean> {
		try {
			const success = await clearCacheBackend({ steamUserID });
			
			if (success) {
				this.cache.delete(steamUserID);
				log(`Cache cleared for user ${steamUserID}`);
			}
			
			return success;
		} catch (error) {
			logError(`Error clearing cache for user ${steamUserID}:`, error);
			return false;
		}
	}

	/**
	 * Invalidate frontend cache for a user (forces reload on next access)
	 */
	invalidate(steamUserID: string): void {
		this.cache.delete(steamUserID);
		log(`Frontend cache invalidated for user ${steamUserID}`);
	}
}

// Export singleton instance
export const gameLicenseCache = new GameLicenseCache();
