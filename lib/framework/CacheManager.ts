import { log, logError } from '../logger';

interface CacheEntry<T> {
	data: T | null;
	isLoaded: boolean;
}

export class CacheManager<T> {
	private cache: Map<string, CacheEntry<T>> = new Map();

	constructor(
		private name: string,
		private fetcher: (steamUserID: string) => Promise<T | null>,
		private clearer?: (steamUserID: string) => Promise<boolean>,
		private shouldCache?: (data: T | null) => boolean
	) {}

	async getData(steamUserID: string, forceReload = false): Promise<T | null> {
		const cached = this.cache.get(steamUserID);
		if (cached && cached.isLoaded && !forceReload) {
			return cached.data;
		}

		try {
			const data = await this.fetcher(steamUserID);
			const canCache = this.shouldCache ? this.shouldCache(data) : true;
			if (canCache) {
				this.cache.set(steamUserID, { data, isLoaded: true });
			}
			log(`Loaded ${this.name} cache for user ${steamUserID}`);
			return data;
		} catch (error) {
			logError(`Error loading ${this.name} cache for user ${steamUserID}:`, error);
			return null;
		}
	}

	getDataSync(steamUserID: string): T | null | undefined {
		return this.cache.get(steamUserID)?.data;
	}

	async clearCache(steamUserID: string): Promise<boolean> {
		try {
			if (this.clearer) {
				const success = await this.clearer(steamUserID);
				if (success) {
					this.cache.delete(steamUserID);
				}
				return success;
			} else {
				this.cache.delete(steamUserID);
				return true;
			}
		} catch (error) {
			logError(`Error clearing ${this.name} cache for user ${steamUserID}:`, error);
			return false;
		}
	}

	invalidate(steamUserID: string): void {
		this.cache.delete(steamUserID);
	}
}
