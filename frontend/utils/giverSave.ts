import { isTruthy } from './truthy';

export type GiverSaveOutcome = { saved: boolean; upsertResult: unknown; legacyRemoved: boolean | null };

export async function saveGiverThenRemoveLegacy(steps: {
	upsert: () => Promise<unknown>;
	removeLegacy?: () => Promise<unknown>;
}): Promise<GiverSaveOutcome> {
	const upsertResult = await steps.upsert();
	const saved = isTruthy(upsertResult);
	if (!saved || !steps.removeLegacy) {
		return { saved, upsertResult, legacyRemoved: null };
	}

	try {
		return { saved, upsertResult, legacyRemoved: isTruthy(await steps.removeLegacy()) };
	} catch {
		return { saved, upsertResult, legacyRemoved: false };
	}
}

export type GiverDeleteOutcome = { deleted: boolean; legacyRemoved: boolean | null };

// The badge falls back to the title key, so its record goes too. Legacy keys are removed first and
// a failure stops before the current key, so a stale copy never shows in place of the current one.
export async function deleteGiverAndLegacy(steps: {
	licenseKey: string;
	existingLicenseKey?: string;
	fallbackLicenseKey?: string;
	hasRecord: (licenseKey: string) => boolean;
	remove: (licenseKey: string) => Promise<unknown>;
}): Promise<GiverDeleteOutcome> {
	const { licenseKey, existingLicenseKey, fallbackLicenseKey, hasRecord } = steps;
	const fallbackWithRecord = fallbackLicenseKey && hasRecord(fallbackLicenseKey) ? fallbackLicenseKey : undefined;
	const legacyKeys = [...new Set([existingLicenseKey, fallbackWithRecord])]
		.filter((key): key is string => Boolean(key) && key !== licenseKey);

	for (const legacyKey of legacyKeys) {
		const removed = await steps.remove(legacyKey).then(isTruthy, () => false);
		if (!removed) {
			return { deleted: false, legacyRemoved: false };
		}
	}

	const deleted = isTruthy(await steps.remove(licenseKey));
	return { deleted, legacyRemoved: legacyKeys.length > 0 ? true : null };
}
