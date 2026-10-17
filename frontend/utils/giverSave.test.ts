import { describe, it, expect } from 'vitest';
import { deleteGiverAndLegacy, saveGiverThenRemoveLegacy } from './giverSave';

function recordedSteps(upsertResult: () => Promise<unknown>, removeResult?: () => Promise<unknown>) {
	const calls: string[] = [];
	const steps = {
		upsert: () => {
			calls.push('upsert');
			return upsertResult();
		},
		removeLegacy: removeResult && (() => {
			calls.push('removeLegacy');
			return removeResult();
		}),
	};
	return { calls, steps };
}

describe('saveGiverThenRemoveLegacy', () => {
	it('never removes the legacy record when the upsert returns false', async () => {
		const { calls, steps } = recordedSteps(async () => false, async () => true);
		const outcome = await saveGiverThenRemoveLegacy(steps);
		expect(calls).toEqual(['upsert']);
		expect(outcome).toEqual({ saved: false, upsertResult: false, legacyRemoved: null });
	});

	it('never removes the legacy record when the upsert returns an error code', async () => {
		const { calls, steps } = recordedSteps(async () => 'save_failed', async () => true);
		const outcome = await saveGiverThenRemoveLegacy(steps);
		expect(calls).toEqual(['upsert']);
		expect(outcome).toEqual({ saved: false, upsertResult: 'save_failed', legacyRemoved: null });
	});

	it('removes the legacy record after a successful upsert', async () => {
		const { calls, steps } = recordedSteps(async () => true, async () => true);
		const outcome = await saveGiverThenRemoveLegacy(steps);
		expect(calls).toEqual(['upsert', 'removeLegacy']);
		expect(outcome).toEqual({ saved: true, upsertResult: true, legacyRemoved: true });
	});

	it('reports a saved gift with legacyRemoved false when the removal returns false', async () => {
		const { steps } = recordedSteps(async () => true, async () => false);
		const outcome = await saveGiverThenRemoveLegacy(steps);
		expect(outcome).toEqual({ saved: true, upsertResult: true, legacyRemoved: false });
	});

	it('reports a saved gift with legacyRemoved false when the removal rejects', async () => {
		const { steps } = recordedSteps(async () => true, async () => {
			throw new Error('remove failed');
		});
		const outcome = await saveGiverThenRemoveLegacy(steps);
		expect(outcome).toEqual({ saved: true, upsertResult: true, legacyRemoved: false });
	});

	it('reports legacyRemoved as null when there is no legacy record', async () => {
		const { calls, steps } = recordedSteps(async () => true);
		const outcome = await saveGiverThenRemoveLegacy(steps);
		expect(calls).toEqual(['upsert']);
		expect(outcome).toEqual({ saved: true, upsertResult: true, legacyRemoved: null });
	});

	it('rejects without removing the legacy record when the upsert rejects', async () => {
		const { calls, steps } = recordedSteps(async () => {
			throw new Error('upsert failed');
		}, async () => true);
		await expect(saveGiverThenRemoveLegacy(steps)).rejects.toThrow('upsert failed');
		expect(calls).toEqual(['upsert']);
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
