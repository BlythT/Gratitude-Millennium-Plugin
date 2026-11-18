import { callable } from '@steambrew/client';
import { CacheManager } from './CacheManager';
import type { FriendRecord, FriendsCacheSnapshot } from '../types';
import { isTruthy } from '../utils/truthy';
import { friendRecordsFromClient, type ClientFriend } from '../../lib/client-friends';
import { log } from '../../lib/logger';

const getFriendsCache = callable<[{ steamUserID: string }], string>('GetFriendsCache');
const clearFriendsCacheBackend = callable<[{ steamUserID: string }], boolean>('ClearFriendsCache');

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

const CLIENT_RETRY_MS = 30 * 1000;
const CLIENT_RETRY_LIMIT = 4;
const clientRetries = new Map<string, number>();

// The Steam client's own friends list, or an empty list before it has loaded
function clientFriends(): ClientFriend[] {
	try {
		const store = (window as unknown as { g_FriendsUIApp?: { FriendStore?: { all_friends?: ClientFriend[] } } }).g_FriendsUIApp?.FriendStore;
		return [...(store?.all_friends ?? [])];
	} catch {
		return [];
	}
}

// Friends come from the Steam client, so the list is complete and current without visiting
// Community. The friends scraped from the Community page add custom profile links, which the
// client doesn't load, and stand in when the client's list isn't ready.
export const friendsCache = new CacheManager<FriendsCacheSnapshot>(
	'Friends',
	async (steamUserID) => {
		const scraped = normalizeSnapshot(await getFriendsCache({ steamUserID }).catch(() => ''));
		const profileUrls = new Map((scraped?.friends ?? []).filter((f) => f.profileUrl).map((f) => [f.steamID64, f.profileUrl as string]));
		const fromClient = friendRecordsFromClient(clientFriends(), profileUrls);
		if (fromClient.length) {
			log(`Friends from the Steam client: ${fromClient.length}`);
			return { friends: fromClient as FriendRecord[], updatedAt: Date.now() };
		}
		// The client's list isn't loaded yet (Steam is still starting): use the scraped one for
		// now, and read the client's again on the next request a little later
		// (a few times: an account with no friends never has a list)
		const retries = clientRetries.get(steamUserID) ?? 0;
		if (retries < CLIENT_RETRY_LIMIT) {
			clientRetries.set(steamUserID, retries + 1);
			setTimeout(() => friendsCache.invalidate(steamUserID), CLIENT_RETRY_MS);
		}
		return scraped;
	},
	async (steamUserID) => {
		const success = await clearFriendsCacheBackend({ steamUserID });
		return isTruthy(success);
	}
);
