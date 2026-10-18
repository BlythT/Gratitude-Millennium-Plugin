import { describe, it, expect } from 'vitest';
import { deleteGiverAndLegacy, giverSaveErrorMessage, saveGiver } from './giverSave';

const RECORD = { licenseKey: '220', displayName: 'Gifter' };

// An upsert that records every call it receives and answers with result()
function recordedUpsert(result: () => Promise<unknown>) {
	const calls: unknown[] = [];
	const upsert = (record: unknown) => {
		calls.push(record);
		return result();
	};
	return { calls, upsert };
}

describe('saveGiver', () => {
	// saveGiver takes only an upsert, so one call is fixed by its signature; the payload is what this pins.
	// The modal's own wiring (GiverModal.tsx) isn't loaded by vitest and is checked in Steam.
	it('moves a gift from its legacy key in one backend call', async () => {
		const { calls, upsert } = recordedUpsert(async () => true);
		const outcome = await saveGiver({ record: RECORD, legacyLicenseKey: 'Half-Life 2', upsert });
		expect(calls).toEqual([{ ...RECORD, replacesLicenseKey: 'Half-Life 2' }]);
		expect(outcome).toEqual({ saved: true, upsertResult: true });
	});

	it('sends no replacesLicenseKey without a different legacy key', async () => {
		for (const legacyLicenseKey of [undefined, null, '', '220']) {
			const { calls, upsert } = recordedUpsert(async () => true);
			await saveGiver({ record: RECORD, legacyLicenseKey, upsert });
			expect(calls).toEqual([RECORD]);
		}
	});

	it('reports an error code as not saved', async () => {
		const { calls, upsert } = recordedUpsert(async () => 'size_limit');
		const outcome = await saveGiver({ record: RECORD, legacyLicenseKey: 'Half-Life 2', upsert });
		expect(calls).toHaveLength(1);
		expect(outcome).toEqual({ saved: false, upsertResult: 'size_limit' });
	});

	it('rejects when the upsert rejects, after one call', async () => {
		const { calls, upsert } = recordedUpsert(async () => {
			throw new Error('upsert failed');
		});
		await expect(saveGiver({ record: RECORD, legacyLicenseKey: 'Half-Life 2', upsert })).rejects.toThrow('upsert failed');
		expect(calls).toHaveLength(1);
	});
});

describe('giverSaveErrorMessage', () => {
	it('explains the storage limit for "size_limit"', () => {
		expect(giverSaveErrorMessage('size_limit')).toBe(
			'Couldn\'t save: this account\'s gift notes have reached Millennium\'s storage limit. Shorten or remove some notes.',
		);
	});

	it('tells the user to restart Steam for "read_only"', () => {
		expect(giverSaveErrorMessage('read_only')).toBe(
			'Gratitude couldn\'t read some of your saved gift details when Steam started, so changes can\'t be saved until you restart Steam.',
		);
	});

	it('gives the note cap for "note_too_long"', () => {
		expect(giverSaveErrorMessage('note_too_long')).toBe('Notes are limited to 2,000 characters.');
	});

	it('falls back to the generic message for every other result', () => {
		for (const result of [false, 'save_failed', 'invalid_payload', undefined, 'something_new', 'toString']) {
			expect(giverSaveErrorMessage(result)).toBe('Unable to save giver data.');
		}
	});
});

// A fake giver store: remove deletes the record and returns true, unless a failure is set for that key
function giverStore(keys: string[], failures: Record<string, unknown> = {}) {
	const records = new Set(keys);
	const removed: string[] = [];
	return {
		records,
		removed,
		hasRecord: (licenseKey: string) => records.has(licenseKey),
		remove: async (licenseKey: string) => {
			removed.push(licenseKey);
			if (licenseKey in failures) {
				const failure = failures[licenseKey];
				if (failure instanceof Error) throw failure;
				return failure;
			}
			records.delete(licenseKey);
			return true;
		},
	};
}

describe('deleteGiverAndLegacy', () => {
	it('removes only the current key when the gift has no legacy record', async () => {
		const store = giverStore(['220']);
		const outcome = await deleteGiverAndLegacy({
			licenseKey: '220',
			existingLicenseKey: '220',
			fallbackLicenseKey: 'Half-Life 2',
			...store,
		});
		expect(store.removed).toEqual(['220']);
		expect(store.records.size).toBe(0);
		expect(outcome).toEqual({ deleted: true, legacyRemoved: null });
	});

	it('reports not deleted when removing the current key returns false or "false"', async () => {
		for (const failure of [false, 'false']) {
			const store = giverStore(['220'], { '220': failure });
			const outcome = await deleteGiverAndLegacy({ licenseKey: '220', existingLicenseKey: '220', ...store });
			expect(outcome).toEqual({ deleted: false, legacyRemoved: null });
		}
	});

	it('rejects when removing the current key rejects', async () => {
		const store = giverStore(['220'], { '220': new Error('remove failed') });
		await expect(deleteGiverAndLegacy({ licenseKey: '220', existingLicenseKey: '220', ...store }))
			.rejects.toThrow('remove failed');
	});

	it('removes the key once when the title key is the current key', async () => {
		const store = giverStore(['Half-Life 2']);
		const outcome = await deleteGiverAndLegacy({
			licenseKey: 'Half-Life 2',
			existingLicenseKey: 'Half-Life 2',
			fallbackLicenseKey: 'Half-Life 2',
			...store,
		});
		expect(store.removed).toEqual(['Half-Life 2']);
		expect(outcome).toEqual({ deleted: true, legacyRemoved: null });
	});
});

// GiftBadge looks a gift up by its license key, then by its title, so a delete must clear both
describe('deleteGiverAndLegacy with a record under the title key', () => {
	it('deletes a gift that was never moved off its title key', async () => {
		const store = giverStore(['Half-Life 2']);
		const outcome = await deleteGiverAndLegacy({
			licenseKey: '220',
			existingLicenseKey: 'Half-Life 2',
			fallbackLicenseKey: 'Half-Life 2',
			...store,
		});
		expect(store.removed).toEqual(['Half-Life 2', '220']);
		expect([...store.records]).toEqual([]);
		expect(outcome).toEqual({ deleted: true, legacyRemoved: true });
	});

	it('deletes the stale duplicate left under the title key by a failed move', async () => {
		const store = giverStore(['220', 'Half-Life 2']);
		const outcome = await deleteGiverAndLegacy({
			licenseKey: '220',
			existingLicenseKey: '220',
			fallbackLicenseKey: 'Half-Life 2',
			...store,
		});
		expect(store.removed).toEqual(['Half-Life 2', '220']);
		expect([...store.records]).toEqual([]);
		expect(outcome).toEqual({ deleted: true, legacyRemoved: true });
	});

	it('removes the opened record\'s key even when the cache no longer lists it', async () => {
		const store = giverStore([]);
		const outcome = await deleteGiverAndLegacy({
			licenseKey: '220',
			existingLicenseKey: 'Half-Life 2',
			fallbackLicenseKey: 'Half-Life 2',
			...store,
		});
		expect(store.removed).toEqual(['Half-Life 2', '220']);
		expect(outcome).toEqual({ deleted: true, legacyRemoved: true });
	});

	it('leaves a title key with no record alone', async () => {
		const store = giverStore(['220']);
		await deleteGiverAndLegacy({
			licenseKey: '220',
			existingLicenseKey: '220',
			fallbackLicenseKey: 'Half-Life 2',
			...store,
		});
		expect(store.removed).toEqual(['220']);
	});

	it('keeps the current record and reports not deleted when the legacy removal returns false', async () => {
		const store = giverStore(['220', 'Half-Life 2'], { 'Half-Life 2': false });
		const outcome = await deleteGiverAndLegacy({
			licenseKey: '220',
			existingLicenseKey: '220',
			fallbackLicenseKey: 'Half-Life 2',
			...store,
		});
		expect(store.removed).toEqual(['Half-Life 2']);
		expect([...store.records].sort()).toEqual(['220', 'Half-Life 2']);
		expect(outcome).toEqual({ deleted: false, legacyRemoved: false });
	});

	it('keeps the current record and reports not deleted when the legacy removal rejects', async () => {
		const store = giverStore(['220', 'Half-Life 2'], { 'Half-Life 2': new Error('remove failed') });
		const outcome = await deleteGiverAndLegacy({
			licenseKey: '220',
			existingLicenseKey: '220',
			fallbackLicenseKey: 'Half-Life 2',
			...store,
		});
		expect(store.removed).toEqual(['Half-Life 2']);
		expect(outcome).toEqual({ deleted: false, legacyRemoved: false });
	});

	it('reports not deleted when the legacy record is removed but the current key fails', async () => {
		const store = giverStore(['220', 'Half-Life 2'], { '220': false });
		const outcome = await deleteGiverAndLegacy({
			licenseKey: '220',
			existingLicenseKey: '220',
			fallbackLicenseKey: 'Half-Life 2',
			...store,
		});
		expect(store.removed).toEqual(['Half-Life 2', '220']);
		expect([...store.records]).toEqual(['220']);
		expect(outcome).toEqual({ deleted: false, legacyRemoved: true });
	});
});
