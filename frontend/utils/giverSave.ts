import { NOTE_TOO_LONG_MESSAGE } from './giverNotes';
import { isTruthy } from './truthy';

export const GIVER_SAVE_FAILED_MESSAGE = 'Unable to save giver data.';
export const GIVER_DELETE_FAILED_MESSAGE = 'Unable to remove giver data.';
const SIZE_LIMIT_MESSAGE = 'Couldn\'t save: this account\'s gift notes have reached Millennium\'s storage limit. Shorten or remove some notes.';
const READ_ONLY_MESSAGE = 'Gratitude couldn\'t read some of your saved gift details when Steam started, so changes can\'t be saved until you restart Steam.';

export type GiverSaveOutcome = { saved: boolean; upsertResult: unknown };

// One backend call: a gift stored under an older key moves to its new key in the same save, so a
// failed save leaves it where it was, never lost and never duplicated
export async function saveGiver<T extends { licenseKey: string }>(steps: {
	record: T;
	legacyLicenseKey?: string | null;
	upsert: (record: T & { replacesLicenseKey?: string }) => Promise<unknown>;
}): Promise<GiverSaveOutcome> {
	const { record, legacyLicenseKey } = steps;
	const upsertResult = await steps.upsert(
		legacyLicenseKey && legacyLicenseKey !== record.licenseKey ? { ...record, replacesLicenseKey: legacyLicenseKey } : record,
	);
	return { saved: isTruthy(upsertResult), upsertResult };
}

// UpsertGiverData's result: true, or one of the error codes listed in backend/main.lua
export type UpsertGiverErrorCode = 'invalid_payload' | 'note_too_long' | 'size_limit' | 'read_only' | 'save_failed';
export type UpsertGiverResult = boolean | UpsertGiverErrorCode;

// Every code needs an entry, so a new backend code fails type-check until it has a message
const UPSERT_ERROR_MESSAGES: Record<UpsertGiverErrorCode, string> = {
	invalid_payload: GIVER_SAVE_FAILED_MESSAGE,
	note_too_long: NOTE_TOO_LONG_MESSAGE,
	size_limit: SIZE_LIMIT_MESSAGE,
	read_only: READ_ONLY_MESSAGE,
	save_failed: GIVER_SAVE_FAILED_MESSAGE,
};

// Only the codes the user can act on get their own message; false and unknown codes get the generic one
export function giverSaveErrorMessage(upsertResult: unknown): string {
	if (typeof upsertResult === 'string' && Object.prototype.hasOwnProperty.call(UPSERT_ERROR_MESSAGES, upsertResult)) {
		return UPSERT_ERROR_MESSAGES[upsertResult as UpsertGiverErrorCode];
	}
	return GIVER_SAVE_FAILED_MESSAGE;
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
