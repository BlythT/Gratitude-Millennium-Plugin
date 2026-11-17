// Friends from the Steam client's own friends list (g_FriendsUIApp.FriendStore), in the same shape
// as the friends scraped from the Community friends page, so the friend picker and saved gifters
// work the same with either. The client has the list as soon as Steam is running, so the picker no
// longer depends on having visited Community; the scrape stays as a fallback and for profile links.

export interface ClientFriendRecord {
	steamID64: string;
	profileUrl?: string;
	// What Steam shows for them: your nickname for them if you set one, else their Steam name
	displayName: string;
	// Their Steam name when it isn't the displayName (the scrape's "nickname or alias" field)
	nicknameOrAlias?: string;
	avatarUrl?: string;
	updatedAt: number;
}

// The parts of a client friend this reads. Steam's objects carry much more.
export interface ClientFriend {
	steamid?: { ConvertTo64BitString?: () => string };
	m_unAccountID?: number;
	m_strNickname?: string;
	m_persona?: { m_strPlayerName?: string; m_strAvatarHash?: string; m_strProfileURL?: string };
}

const ACCOUNT_ID_BASE = 76561197960265728n;
// Steam's placeholder avatar hash for accounts without one
const EMPTY_AVATAR = /^0+$/;

function steamID64Of(friend: ClientFriend): string | null {
	try {
		const fromObject = friend.steamid?.ConvertTo64BitString?.();
		if (fromObject && /^\d{17}$/.test(fromObject)) return fromObject;
	} catch {
		// Fall back to the account ID
	}
	return typeof friend.m_unAccountID === 'number' && friend.m_unAccountID > 0
		? (ACCOUNT_ID_BASE + BigInt(friend.m_unAccountID)).toString()
		: null;
}

/**
 * Maps the client's friends to friend records. profileUrls are custom profile links already known
 * from the Community scrape, by SteamID64 ("https://steamcommunity.com/id/name"); the client
 * doesn't load those, so friends without one get their permanent /profiles/<id> link.
 */
export function friendRecordsFromClient(
	friends: ClientFriend[],
	profileUrls: Map<string, string> = new Map(),
	now: number = Date.now(),
): ClientFriendRecord[] {
	const records: ClientFriendRecord[] = [];
	for (const friend of friends) {
		const steamID64 = steamID64Of(friend);
		const steamName = friend.m_persona?.m_strPlayerName?.trim();
		if (!steamID64 || !steamName) continue;
		const nickname = friend.m_strNickname?.trim() || undefined;
		const hash = friend.m_persona?.m_strAvatarHash?.trim();
		records.push({
			steamID64,
			profileUrl: profileUrls.get(steamID64) || friend.m_persona?.m_strProfileURL?.trim() || `https://steamcommunity.com/profiles/${steamID64}`,
			displayName: nickname ?? steamName,
			nicknameOrAlias: nickname && nickname !== steamName ? steamName : undefined,
			avatarUrl: hash && !EMPTY_AVATAR.test(hash) ? `https://avatars.fastly.steamstatic.com/${hash}_medium.jpg` : undefined,
			updatedAt: now,
		});
	}
	return records;
}
