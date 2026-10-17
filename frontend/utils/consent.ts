import { logError } from '../../lib/logger';
import { isTruthy } from './truthy';

// The backend restores the previous consent record when a save fails
export const CONSENT_NOT_SAVED_MESSAGE = 'Consent choice was not saved; the previous consent choice is unchanged';

export type SetConsentCallable = (args: { steamUserID: string; consent: boolean }) => Promise<unknown>;

export function isConsentSaved(result: unknown): boolean {
	return isTruthy(result);
}

async function saveConsent(setConsent: SetConsentCallable, steamUserID: string, consent: boolean): Promise<boolean> {
	try {
		const saved = isConsentSaved(await setConsent({ steamUserID, consent }));
		if (!saved) {
			logError(`${CONSENT_NOT_SAVED_MESSAGE} (allowed=${consent})`);
		}
		return saved;
	} catch (error) {
		logError(`Error storing consent choice (allowed=${consent}):`, error);
		return false;
	}
}

export function grantConsent(setConsent: SetConsentCallable, steamUserID: string): Promise<boolean> {
	return saveConsent(setConsent, steamUserID, true);
}

export function declineConsent(setConsent: SetConsentCallable, steamUserID: string): Promise<boolean> {
	return saveConsent(setConsent, steamUserID, false);
}
