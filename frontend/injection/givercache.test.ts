import { beforeEach, describe, expect, it, vi } from 'vitest';

// The backend callables, replaced because @steambrew/client only loads inside Steam
const backend = vi.hoisted(() => ({
	upsertGiverData: vi.fn(),
	getAllGiverData: vi.fn(),
}));

vi.mock('@steambrew/client', () => ({
	callable: (name: string) => {
		if (name === 'UpsertGiverData') return backend.upsertGiverData;
		if (name === 'GetAllGiverData') return backend.getAllGiverData;
		return vi.fn();
	},
}));

import { giverCache } from './givercache';

const GIFT = { licenseKey: '220', libraryTitle: 'Half-Life 2', displayName: 'Gifter', source: 'manual' as const };

describe('giverCache.upsert', () => {
	beforeEach(() => {
		backend.upsertGiverData.mockReset();
		backend.getAllGiverData.mockReset().mockResolvedValue('{}');
	});

	it('sends replacesLicenseKey to the backend inside the payload', async () => {
		backend.upsertGiverData.mockResolvedValue(true);

		await giverCache.upsert('111', { ...GIFT, replacesLicenseKey: 'Half-Life 2' });

		const [{ payloadJson, steamUserID }] = backend.upsertGiverData.mock.calls[0];
		expect(steamUserID).toBe('111');
		expect(JSON.parse(payloadJson)).toEqual({ ...GIFT, replacesLicenseKey: 'Half-Life 2' });
	});

	it('returns the backend error code unchanged, so the modal can show its message', async () => {
		backend.upsertGiverData.mockResolvedValue('size_limit');

		expect(await giverCache.upsert('111', GIFT)).toBe('size_limit');
	});
});
