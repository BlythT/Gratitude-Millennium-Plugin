import { callable } from '@steambrew/client';
import { log, logError } from '../lib/logger';

// Backend callable functions
const isGameLicenseCachePopulated = callable<[{ steamUserID: string }], boolean>('IsGameLicenseCachePopulated');
const getAllCacheEntries = callable<[{ steamUserID: string }], string>('GetGameLicenseData');
const clearCacheBackend = callable<[{ steamUserID: string }], boolean>('ClearCache');

// Individual game license entry
interface GameLicenseEntry {
	date: string;
	acquisition: string;
}

// User cache stores entries in a Map for efficient O(1) lookups
interface UserCache {
	entries: Map<string, GameLicenseEntry>; // Map<gameName, licenseInfo>
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
	async getData(steamUserID: string): Promise<Map<string, GameLicenseEntry>> {
		const cached = this.cache.get(steamUserID);
		
		// Cache hit - data is still valid since it's append-only
		if (cached && cached.isPopulated) {
			log(`Cache hit for user ${steamUserID} (${cached.entries.size} entries)`);
			return cached.entries;
		}

		log(`Cache miss for user ${steamUserID}, fetching from backend`);
		return await this.loadFromBackend(steamUserID);
	}

	/**
	 * Get cache data for a user synchronously.
	 * @param steamUserID 
	 * @returns Map of game license entries for the user, or null if not cached
	 */
	getDataSync(steamUserID: string): Map<string, GameLicenseEntry> | null {
		const cached = this.cache.get(steamUserID);

		if (cached && cached.isPopulated) {
			return cached.entries;
		}

		return null;
	}

	/**
	 * Load entire cache from backend for a user.
	 * 
	 * Since data is append-only, this only needs to be called:
	 * - On first access (cache miss)
	 * - After explicit cache clear
	 * - When user manually refreshes to check for new entries
	 */
	async loadFromBackend(steamUserID: string): Promise<Map<string, GameLicenseEntry>> {
		try {
			// First check if backend cache is populated
			const isPopulated = await isGameLicenseCachePopulated({ steamUserID });
			
			if (!isPopulated) {
				log(`Backend cache not populated for user ${steamUserID}`);
				this.cache.set(steamUserID, {
					entries: new Map(),
					isPopulated: false
				});
				return new Map();
			}

			// Fetch all entries from backend (returns JSON string)
			const entriesJson = await getAllCacheEntries({ steamUserID });
			const dataObj: Record<string, GameLicenseEntry> = entriesJson ? JSON.parse(entriesJson) : {};
			
			// Convert object to Map for efficient lookups
			const entries = new Map<string, GameLicenseEntry>(Object.entries(dataObj));
			
			log(`Loaded ${entries.size} entries from backend for user ${steamUserID}`);

			// Update local cache - valid forever since data is append-only
			this.cache.set(steamUserID, {
				entries,
				isPopulated: true
			});

			return entries;
		} catch (error) {
			logError(`Error loading cache from backend for user ${steamUserID}:`, error);
			return new Map();
		}
	}

	/**
	 * Get the number of cached entries for a user.
	 * Uses cached count if available, otherwise fetches from backend.
	 */
	async getEntryCount(steamUserID: string): Promise<number> {
		const data = await this.getData(steamUserID);
		return data.size;
	}

	/**
	 * Get the number of cached entries for a user synchronously.
	 * @param steamUserID 
	 * @returns Number of entries, or null if not cached
	 */
	getEntryCountSync(steamUserID: string): number | null {
		const data = this.getDataSync(steamUserID);
		return data ? data.size : null;
	}

	/**
	 * Check if backend cache is populated for a user
	 */
	async isBackendPopulated(steamUserID: string): Promise<boolean> {
		try {
			return await isGameLicenseCachePopulated({ steamUserID });
		} catch (error) {
			logError(`Error checking backend population for user ${steamUserID}:`, error);
			return false;
		}
	}

	/**
	 * Clear cache for a user (both frontend and backend)
	 */
	async clearCache(steamUserID: string): Promise<boolean> {
		try {
			// Clear backend cache
			const success = await clearCacheBackend({ steamUserID });
			
			if (success) {
				// Clear frontend cache
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

	/**
	 * Get cached data without fetching from backend (returns null if not cached)
	 */
	getCachedOnly(steamUserID: string): Map<string, GameLicenseEntry> | null {
		const cached = this.cache.get(steamUserID);
		return cached && cached.isPopulated ? cached.entries : null;
	}

	/**
	 * Check if a specific game is in the cache for a user
	 */
	async hasGame(steamUserID: string, gameName: string): Promise<boolean> {
		const data = await this.getData(steamUserID);
		return data.has(gameName);
	}

	/**
	 * Check if a specific game is in the cache for a user synchronously
	 */
	hasGameSync(steamUserID: string, gameName: string): boolean {
		const data = this.getDataSync(steamUserID);
		return data ? data.has(gameName) : false;
	}

	/**
	 * Get license info for a specific game
	 */
	async getGameLicense(steamUserID: string, gameName: string): Promise<GameLicenseEntry | null> {
		const data = await this.getData(steamUserID);
		return data.get(gameName) || null;
	}

	/**
	 * Get license info for a specific game synchronously
	 */
	getGameLicenseSync(steamUserID: string, gameName: string): GameLicenseEntry | null {
		const data = this.getDataSync(steamUserID);
		return data ? data.get(gameName) || null : null;
	}
}

// Export singleton instance
export const gameLicenseCache = new GameLicenseCache();