import { callable } from '@steambrew/client';
import { log, logError } from '../../lib/logger';
import { gifterAssignments, normalizeProfileUrl, steamID64FromAccountId, steamID64FromProfileUrl, type HistoryGift } from '../../lib/gift-history';
import { loadClientLicenses } from './clientlicenses';
import { giverCache } from './givercache';
import { friendsCache } from './friendscache';
import { getFriendDisplayLabel } from '../components/FriendSelector';

// Fills in gifters from the gifts the Community inventory history recorded (saved by the webkit
// import, see webkit/index.tsx), paired with the user's gift licenses. Only games without a gifter
// get one, so the user's own entries are never replaced.

const getGiftHistory = callable<[{ steamUserID: string }], string>('GetGiftHistory');
const markGiftHistoryFilled = callable<[{ appIdsJson: string; steamUserID: string }], boolean | string>('MarkGiftHistoryFilled');

interface SavedHistory {
	gifts?: HistoryGift[];
	updatedAt?: number;
	// App IDs a gifter was filled in for before: never filled again, so a deleted gifter stays deleted
	filled?: number[];
}

interface AppOverview {
	app_type?: number;
	display_name?: string;
}

function appOverview(appId: number): AppOverview | null {
	try {
		return (window as unknown as { appStore?: { GetAppOverviewByAppID?: (id: number) => AppOverview | null } }).appStore?.GetAppOverviewByAppID?.(appId) ?? null;
	} catch {
		return null;
	}
}

// The history's save time last applied per account, so an unchanged history isn't reapplied
const applied = new Map<string, number>();
let running: Promise<number> | null = null;

/**
 * Pairs the saved history gifts with gift licenses and saves gifters for games that have none.
 * Returns how many were added. Does nothing when the history hasn't changed since it was last
 * applied, or when the license list can't be read yet (it tries again next time).
 */
export function applyGiftHistory(steamUserID: string): Promise<number> {
	if (running) return running;
	running = (async () => {
		try {
			const raw = await getGiftHistory({ steamUserID });
			const history = raw && raw !== '{}' ? (JSON.parse(raw) as SavedHistory) : null;
			// Lua sends an empty list back as {}, so lists are checked
			const gifts = Array.isArray(history?.gifts) ? history.gifts.map((g) => ({ ...g, items: Array.isArray(g.items) ? g.items : [] })) : [];
			if (!history || !gifts.length || applied.get(steamUserID) === history.updatedAt) return 0;
			const filledBefore = new Set(Array.isArray(history.filled) ? history.filled : []);

			const licenses = await loadClientLicenses(steamUserID);
			if (!licenses) return 0;
			const givers = await giverCache.getAll(steamUserID, true);
			const friends = (await friendsCache.getData(steamUserID).catch(() => null))?.friends ?? [];
			const friendById = new Map(friends.map((f) => [f.steamID64, f]));
			const friendByProfile = new Map(friends.filter((f) => f.profileUrl).map((f) => [normalizeProfileUrl(f.profileUrl), f]));

			// A game has a gifter when one is saved under its App ID, or under its name or for its title
			// (older records were keyed by the game's or the license's name). A game filled in before
			// counts too, even if the user has since deleted that gifter.
			const hasGifter = (appId: number) => {
				if (filledBefore.has(appId) || givers.has(String(appId))) return true;
				const name = appOverview(appId)?.display_name;
				return !!name && (givers.has(name) || giverCache.findByTitleSync(steamUserID, name) !== null);
			};
			const assignments = gifterAssignments(
				gifts,
				licenses,
				(appId) => appOverview(appId)?.app_type === 1,
				hasGifter,
				// The history links the sender's profile but has no account ID: a /profiles/ link carries
				// the SteamID, and a custom /id/ link is matched to a friend, who also gives the label
				(gift) => {
					const id = steamID64FromAccountId(gift.senderAccountId) ?? steamID64FromProfileUrl(gift.senderProfileUrl);
					const friend = (id && friendById.get(id)) || friendByProfile.get(normalizeProfileUrl(gift.senderProfileUrl));
					return friend
						? { steamID64: friend.steamID64, displayName: getFriendDisplayLabel(friend) }
						: { steamID64: id, displayName: gift.senderName };
				},
			);

			let added = 0;
			const filledNow: number[] = [];
			for (const assignment of assignments) {
				// The user may have saved a gifter for this game while earlier ones were being saved
				const name = appOverview(assignment.appId)?.display_name;
				if (giverCache.getEntrySync(steamUserID, String(assignment.appId), name) || (name && giverCache.findByTitleSync(steamUserID, name))) continue;
				const saved = await giverCache.upsert(steamUserID, {
					licenseKey: String(assignment.appId),
					libraryTitle: appOverview(assignment.appId)?.display_name ?? String(assignment.appId),
					displayName: assignment.displayName,
					steamID64: assignment.steamID64,
					profileUrl: assignment.profileUrl,
					source: 'steam-history',
				});
				if (saved) {
					added++;
					filledNow.push(assignment.appId);
				}
			}
			if (filledNow.length) await markGiftHistoryFilled({ appIdsJson: JSON.stringify(filledNow), steamUserID }).catch(() => false);
			applied.set(steamUserID, history.updatedAt ?? 0);
			log(`Gift history: ${gifts.length} gifts, ${added} gifters filled in.`);
			return added;
		} catch (error) {
			logError('Applying the gift history failed:', error);
			return 0;
		} finally {
			running = null;
		}
	})();
	return running;
}
