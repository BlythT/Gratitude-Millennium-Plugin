import { callable } from '@steambrew/client';
import { CacheManager } from '../../lib/framework/CacheManager';
import type { FriendRecord, FriendsCacheSnapshot } from '../types';
import { isTruthy } from '../../lib/framework/truthy';

const getStoreData = callable<[{ steamUserID: string, storeName: string }], string>('GetStoreData');
const clearStoreData = callable<[{ steamUserID: string, storeName: string }], boolean>('ClearStoreData');

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

export const friendsCache = new CacheManager<FriendsCacheSnapshot>(
	'Friends',
	async (steamUserID: string) => {
		const payload = await getStoreData({ steamUserID, storeName: 'friends' });
		return normalizeSnapshot(payload);
	},
	async (steamUserID: string) => {
		const success = await clearStoreData({ steamUserID, storeName: 'friends' });
		return isTruthy(success);
	}
);
