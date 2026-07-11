import { log, logError } from '../../lib/logger';

interface CacheEntry<T> {
	data: T | null;
	isLoaded: boolean;
	timestamp: number;
}

type Listener<T> = (data: T | null) => void;

export class CacheManager<T> {
	private cache: Map<string, CacheEntry<T>> = new Map();
	private pendingFetches: Map<string, Promise<T | null>> = new Map();
	private listeners: Map<string, Set<Listener<T>>> = new Map();

	constructor(
		private name: string,
		private fetcher: (steamUserID: string) => Promise<T | null>,
		private clearer?: (steamUserID: string) => Promise<boolean>,
		private ttlMs: number = 5 * 60 * 1000
	) {}

	private notifyListeners(steamUserID: string, data: T | null) {
		const userListeners = this.listeners.get(steamUserID);
		if (userListeners) {
			userListeners.forEach(listener => listener(data));
		}
	}

	observe(steamUserID: string, listener: Listener<T>): () => void {
		let userListeners = this.listeners.get(steamUserID);
		if (!userListeners) {
			userListeners = new Set();
			this.listeners.set(steamUserID, userListeners);
		}
		userListeners.add(listener);

		const cached = this.cache.get(steamUserID);
		if (cached && cached.isLoaded) {
			listener(cached.data);
			
			const isStale = Date.now() - cached.timestamp > this.ttlMs;
			if (isStale && !this.pendingFetches.has(steamUserID)) {
				void this.getData(steamUserID, true).catch(() => {});
			}
		} else {
			listener(null);
			if (!this.pendingFetches.has(steamUserID)) {
				void this.getData(steamUserID, true).catch(() => {});
			}
		}

		return () => {
			const currentListeners = this.listeners.get(steamUserID);
			if (currentListeners) {
				currentListeners.delete(listener);
				if (currentListeners.size === 0) {
					this.listeners.delete(steamUserID);
				}
			}
		};
	}

	async getData(steamUserID: string, forceReload = false): Promise<T | null> {
		const cached = this.cache.get(steamUserID);
		const isStale = cached ? (Date.now() - cached.timestamp > this.ttlMs) : false;

		if (cached && cached.isLoaded && !forceReload && !isStale) {
			return cached.data;
		}

		if (this.pendingFetches.has(steamUserID)) {
			return this.pendingFetches.get(steamUserID)!;
		}

		const fetchPromise = (async () => {
			try {
				const data = await this.fetcher(steamUserID);
				this.cache.set(steamUserID, { data, isLoaded: true, timestamp: Date.now() });
				log(`Loaded ${this.name} cache for user ${steamUserID} (TTL: ${this.ttlMs}ms)`);
				this.notifyListeners(steamUserID, data);
				return data;
			} catch (error) {
				logError(`Error loading ${this.name} cache for user ${steamUserID}:`, error);
				if (cached && cached.isLoaded) {
					// We don't notify on failure if we already have stale data displayed
					return cached.data;
				}
				this.notifyListeners(steamUserID, null);
				return null;
			} finally {
				this.pendingFetches.delete(steamUserID);
			}
		})();

		this.pendingFetches.set(steamUserID, fetchPromise);
		return fetchPromise;
	}

	getDataSync(steamUserID: string): T | null | undefined {
		const cached = this.cache.get(steamUserID);
		if (cached && cached.isLoaded) {
			const isStale = Date.now() - cached.timestamp > this.ttlMs;
			if (isStale) {
				return undefined;
			}
			return cached.data;
		}
		return undefined;
	}

	async clearCache(steamUserID: string): Promise<boolean> {
		try {
			if (this.clearer) {
				const success = await this.clearer(steamUserID);
				if (success) {
					this.cache.delete(steamUserID);
					this.notifyListeners(steamUserID, null);
				}
				return success;
			} else {
				this.cache.delete(steamUserID);
				this.notifyListeners(steamUserID, null);
				return true;
			}
		} catch (error) {
			logError(`Error clearing ${this.name} cache for user ${steamUserID}:`, error);
			return false;
		}
	}

	invalidate(steamUserID: string): void {
		this.cache.delete(steamUserID);
		this.notifyListeners(steamUserID, null);
	}
}
