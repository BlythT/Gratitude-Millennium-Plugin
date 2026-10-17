import { describe, it, expect, vi, afterEach } from 'vitest';
import { SettingsCache } from './settingsCache';

const STEAM_USER_ID = '1234569341';
const ORIGINAL = { showFriendPickerSteamUrl: false };

// Each save resolves with the next result after its delay; an Error result rejects
function settingsBackend(saves: { result: unknown; delayMs?: number }[]) {
	const payloads: unknown[] = [];
	const getUiSettings = async () => JSON.stringify(ORIGINAL);
	const setUiSettings = ({ payloadJson }: { payloadJson: string }) => {
		payloads.push(JSON.parse(payloadJson));
		const { result, delayMs = 0 } = saves[payloads.length - 1];
		return new Promise<unknown>((resolve, reject) => {
			setTimeout(() => (result instanceof Error ? reject(result) : resolve(result)), delayMs);
		});
	};
	return { payloads, cache: new SettingsCache(getUiSettings, setUiSettings) };
}

async function loadedBackend(saves: { result: unknown; delayMs?: number }[]) {
	const backend = settingsBackend(saves);
	await backend.cache.get(STEAM_USER_ID);
	return backend;
}

// Flushes microtasks only, so no save's timer can fire while waiting
async function untilSavesStarted(payloads: unknown[], count: number) {
	for (let tick = 0; payloads.length < count && tick < 100; tick++) {
		await Promise.resolve();
	}
	expect(payloads).toHaveLength(count);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('SettingsCache.update', () => {
	it('stores and returns true when the save returns true', async () => {
		const { cache, payloads } = await loadedBackend([{ result: true }]);
		await expect(cache.update(STEAM_USER_ID, 'showFriendPickerSteamUrl', true)).resolves.toBe(true);
		expect(cache.getSync(STEAM_USER_ID)).toEqual({ showFriendPickerSteamUrl: true });
		expect(payloads).toEqual([{ steamUserID: STEAM_USER_ID, settings: { showFriendPickerSteamUrl: true } }]);
	});

	it('keeps the previous value and returns false when the save returns false', async () => {
		const { cache } = await loadedBackend([{ result: false }]);
		await expect(cache.update(STEAM_USER_ID, 'showFriendPickerSteamUrl', true)).resolves.toBe(false);
		expect(cache.getSync(STEAM_USER_ID)).toEqual(ORIGINAL);
	});

	it('keeps the previous value and returns false when the save returns "false"', async () => {
		const { cache } = await loadedBackend([{ result: 'false' }]);
		await expect(cache.update(STEAM_USER_ID, 'showFriendPickerSteamUrl', true)).resolves.toBe(false);
		expect(cache.getSync(STEAM_USER_ID)).toEqual(ORIGINAL);
	});

	it('keeps the previous value and returns false when the save rejects', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { cache } = await loadedBackend([{ result: new Error('ipc failed') }]);
		await expect(cache.update(STEAM_USER_ID, 'showFriendPickerSteamUrl', true)).resolves.toBe(false);
		expect(cache.getSync(STEAM_USER_ID)).toEqual(ORIGINAL);
	});

	it('shows the new value while the save is in flight', async () => {
		const { cache, payloads } = await loadedBackend([{ result: true, delayMs: 5 }]);
		const saving = cache.update(STEAM_USER_ID, 'showFriendPickerSteamUrl', true);
		await untilSavesStarted(payloads, 1);
		expect(cache.getSync(STEAM_USER_ID)).toEqual({ showFriendPickerSteamUrl: true });
		await saving;
	});
});

// The second update starts once the first one's save is in flight, like a second toggle click
async function overlappingUpdates(
	{ cache, payloads }: Awaited<ReturnType<typeof loadedBackend>>,
	firstValue: boolean,
	secondValue: boolean,
) {
	const first = cache.update(STEAM_USER_ID, 'showFriendPickerSteamUrl', firstValue);
	await untilSavesStarted(payloads, 1);
	const second = cache.update(STEAM_USER_ID, 'showFriendPickerSteamUrl', secondValue);
	return { first, second };
}

describe('SettingsCache.update with overlapping saves', () => {
	it('ends on the original value when a toggle on and off both fail, the first finishing first', async () => {
		const backend = await loadedBackend([{ result: false, delayMs: 5 }, { result: false, delayMs: 10 }]);
		const { first, second } = await overlappingUpdates(backend, true, false);
		await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
		expect(backend.cache.getSync(STEAM_USER_ID)).toEqual(ORIGINAL);
	});

	it('ends on the original value when two changes to the same value both fail', async () => {
		const backend = await loadedBackend([{ result: false, delayMs: 5 }, { result: false, delayMs: 10 }]);
		const { first, second } = await overlappingUpdates(backend, true, true);
		await Promise.all([first, second]);
		expect(backend.cache.getSync(STEAM_USER_ID)).toEqual(ORIGINAL);
	});

	it('ends on the original value when both fail, the second finishing first', async () => {
		const backend = await loadedBackend([{ result: false, delayMs: 30 }, { result: false, delayMs: 5 }]);
		const { first, second } = await overlappingUpdates(backend, true, true);
		await Promise.all([first, second]);
		expect(backend.cache.getSync(STEAM_USER_ID)).toEqual(ORIGINAL);
	});

	it('ends on the first value when the first saves and the second fails', async () => {
		const backend = await loadedBackend([{ result: true, delayMs: 5 }, { result: false, delayMs: 10 }]);
		const { first, second } = await overlappingUpdates(backend, true, false);
		await Promise.all([first, second]);
		expect(backend.cache.getSync(STEAM_USER_ID)).toEqual({ showFriendPickerSteamUrl: true });
	});

	it('ends on the second value when the first fails and the second saves', async () => {
		const backend = await loadedBackend([{ result: false, delayMs: 5 }, { result: true, delayMs: 10 }]);
		const { first, second } = await overlappingUpdates(backend, true, true);
		await Promise.all([first, second]);
		expect(backend.cache.getSync(STEAM_USER_ID)).toEqual({ showFriendPickerSteamUrl: true });
	});

	it('keeps showing the second value while it saves after the first saved', async () => {
		const backend = await loadedBackend([{ result: true, delayMs: 5 }, { result: true, delayMs: 30 }]);
		const { first, second } = await overlappingUpdates(backend, true, false);
		await first;
		expect(backend.cache.getSync(STEAM_USER_ID)).toEqual({ showFriendPickerSteamUrl: false });
		await second;
		expect(backend.cache.getSync(STEAM_USER_ID)).toEqual({ showFriendPickerSteamUrl: false });
	});

	it('ends on the first value when updates start in the same tick and only the first saves', async () => {
		const { cache } = await loadedBackend([{ result: true, delayMs: 5 }, { result: false, delayMs: 10 }]);
		await Promise.all([
			cache.update(STEAM_USER_ID, 'showFriendPickerSteamUrl', true),
			cache.update(STEAM_USER_ID, 'showFriendPickerSteamUrl', false),
		]);
		expect(cache.getSync(STEAM_USER_ID)).toEqual({ showFriendPickerSteamUrl: true });
	});
});
