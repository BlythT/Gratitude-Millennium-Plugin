import { callable } from '@steambrew/client';
import { log, logError } from '../../lib/logger';
import { isTruthy } from '../utils/truthy';
import type { FriendRecord, FriendsCacheSnapshot } from '../types';

const getFriendsCache = callable<[{ steamUserID: string }], string>('GetFriendsCache');
const hasFriendsCache = callable<[{ steamUserID: string }], boolean>('HasFriendsCache');
const clearFriendsCacheBackend = callable<[{ steamUserID: string }], boolean>('ClearFriendsCache');

interface UserFriendsCache {
	snapshot: FriendsCacheSnapshot | null;
	isLoaded: boolean;
}

function normalizeSnapshot(payload: string): FriendsCacheSnapshot | null {
	if (!payload || payload === '{}') {
		return null;
	}

	const parsed = JSON.parse(payload) as Partial<FriendsCacheSnapshot>;
	if (!parsed || !Array.isArray(parsed.friends)) {
		return null;
	}

	return {
		friends: parsed.friends as FriendRecord[],
		updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
	};
}

class FriendsCache {
	private cache: Map<string, UserFriendsCache> = new Map();

	async getData(steamUserID: string, forceReload = false): Promise<FriendsCacheSnapshot | null> {
		const cached = this.cache.get(steamUserID);
		if (cached && cached.isLoaded && !forceReload) {
			return cached.snapshot;
		}

		try {
			const exists = await hasFriendsCache({ steamUserID });
			if (!isTruthy(exists)) {
				this.cache.set(steamUserID, {
					snapshot: null,
					isLoaded: true,
				});
				return null;
			}

			const snapshot = normalizeSnapshot(await getFriendsCache({ steamUserID }));
			this.cache.set(steamUserID, {
				snapshot,
				isLoaded: true,
			});

			log(
				`Loaded ${snapshot?.friends.length ?? 0} cached friends for user ${steamUserID}`,
			);
			return snapshot;
		} catch (error) {
			logError(`Error loading friends cache for user ${steamUserID}:`, error);
			return null;
		}
	}

	getDataSync(steamUserID: string): FriendsCacheSnapshot | null | undefined {
		return this.cache.get(steamUserID)?.snapshot;
	}

	async clearCache(steamUserID: string): Promise<boolean> {
		try {
			const success = await clearFriendsCacheBackend({ steamUserID });
			if (isTruthy(success)) {
				this.cache.delete(steamUserID);
			}
			return success;
		} catch (error) {
			logError(`Error clearing friends cache for user ${steamUserID}:`, error);
			return false;
		}
	}

	invalidate(steamUserID: string): void {
		this.cache.delete(steamUserID);
	}
}

export const friendsCache = new FriendsCache();
