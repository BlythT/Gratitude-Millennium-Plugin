import { describe, it, expect } from 'vitest';
import { friendRecordsFromClient, type ClientFriend } from './client-friends';

const friend = (accountId: number, steamName: string, extra: Partial<ClientFriend> = {}): ClientFriend => ({
	m_unAccountID: accountId,
	m_persona: { m_strPlayerName: steamName, m_strAvatarHash: 'abc123def456', ...extra.m_persona },
	...extra,
});

describe('friendRecordsFromClient', () => {
	it('shows your nickname for a friend, with their Steam name alongside, like the Community page', () => {
		const [record] = friendRecordsFromClient([friend(12345678, 'Sam Example', { m_strNickname: 'Sammy' })], new Map(), 1);
		expect(record).toEqual({
			steamID64: '76561197972611406',
			profileUrl: 'https://steamcommunity.com/profiles/76561197972611406',
			displayName: 'Sammy',
			nicknameOrAlias: 'Sam Example',
			avatarUrl: 'https://avatars.fastly.steamstatic.com/abc123def456_medium.jpg',
			updatedAt: 1,
		});
	});

	it('uses the Steam name alone when there is no nickname', () => {
		const [record] = friendRecordsFromClient([friend(5, 'Sam')]);
		expect(record.displayName).toBe('Sam');
		expect(record.nicknameOrAlias).toBeUndefined();
	});

	it('keeps a custom profile link known from the Community scrape', () => {
		const links = new Map([['76561197972611406', 'https://steamcommunity.com/id/sam-example']]);
		const [record] = friendRecordsFromClient([friend(12345678, 'Sam Example')], links);
		expect(record.profileUrl).toBe('https://steamcommunity.com/id/sam-example');
	});

	it("prefers the client's SteamID object when it has one", () => {
		const [record] = friendRecordsFromClient([{ ...friend(1, 'Sam'), steamid: { ConvertTo64BitString: () => '76561198000000001' } }]);
		expect(record.steamID64).toBe('76561198000000001');
	});

	it('leaves out the placeholder avatar and friends whose name has not loaded', () => {
		const records = friendRecordsFromClient([
			friend(5, 'Sam', { m_persona: { m_strPlayerName: 'Sam', m_strAvatarHash: '0000000000000000000000000000000000000000' } }),
			{ m_unAccountID: 6, m_persona: {} },
			{ m_persona: { m_strPlayerName: 'No ID' } },
		]);
		expect(records).toHaveLength(1);
		expect(records[0].avatarUrl).toBeUndefined();
	});
});
