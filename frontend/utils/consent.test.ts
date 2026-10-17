import { describe, it, expect, vi, afterEach } from 'vitest';
import { CONSENT_NOT_SAVED_MESSAGE, declineConsent, grantConsent, isConsentSaved } from './consent';

function fakeSetConsent(result: () => Promise<unknown>) {
	const calls: { steamUserID: string; consent: boolean }[] = [];
	const setConsent = (args: { steamUserID: string; consent: boolean }) => {
		calls.push(args);
		return result();
	};
	return { calls, setConsent };
}

function silenceErrors() {
	return vi.spyOn(console, 'error').mockImplementation(() => {});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('isConsentSaved', () => {
	it('reads true and "true" as saved', () => {
		expect(isConsentSaved(true)).toBe(true);
		expect(isConsentSaved('true')).toBe(true);
	});

	it('reads false, undefined and error codes as not saved', () => {
		expect(isConsentSaved(false)).toBe(false);
		expect(isConsentSaved(undefined)).toBe(false);
		expect(isConsentSaved('save_failed')).toBe(false);
	});
});

describe('CONSENT_NOT_SAVED_MESSAGE', () => {
	it('says the previous choice stands rather than promising the dialog again', () => {
		expect(CONSENT_NOT_SAVED_MESSAGE).not.toMatch(/dialog will appear again/);
		expect(CONSENT_NOT_SAVED_MESSAGE).toMatch(/previous consent choice is unchanged/);
	});
});

describe('grantConsent', () => {
	it('saves consent as allowed and returns true when the callable returns true', async () => {
		const errors = silenceErrors();
		const { calls, setConsent } = fakeSetConsent(async () => true);
		await expect(grantConsent(setConsent, '1234569341')).resolves.toBe(true);
		expect(calls).toEqual([{ steamUserID: '1234569341', consent: true }]);
		expect(errors).not.toHaveBeenCalled();
	});

	it('returns false and logs the not saved message when the callable returns false', async () => {
		const errors = silenceErrors();
		const { setConsent } = fakeSetConsent(async () => false);
		await expect(grantConsent(setConsent, '1234569341')).resolves.toBe(false);
		expect(errors).toHaveBeenCalledWith(expect.anything(), `${CONSENT_NOT_SAVED_MESSAGE} (allowed=true)`);
	});

	it('returns false and logs the not saved message when the callable returns "false"', async () => {
		const errors = silenceErrors();
		const { setConsent } = fakeSetConsent(async () => 'false');
		await expect(grantConsent(setConsent, '1234569341')).resolves.toBe(false);
		expect(errors).toHaveBeenCalledWith(expect.anything(), `${CONSENT_NOT_SAVED_MESSAGE} (allowed=true)`);
	});

	it('returns false and logs the error instead of rejecting when the callable rejects', async () => {
		const errors = silenceErrors();
		const failure = new Error('ipc failed');
		const { setConsent } = fakeSetConsent(async () => {
			throw failure;
		});
		await expect(grantConsent(setConsent, '1234569341')).resolves.toBe(false);
		expect(errors).toHaveBeenCalledWith(expect.anything(), 'Error storing consent choice (allowed=true):', failure);
	});
});

describe('declineConsent', () => {
	it('saves consent as denied and returns true when the callable returns true', async () => {
		const errors = silenceErrors();
		const { calls, setConsent } = fakeSetConsent(async () => true);
		await expect(declineConsent(setConsent, '1234569341')).resolves.toBe(true);
		expect(calls).toEqual([{ steamUserID: '1234569341', consent: false }]);
		expect(errors).not.toHaveBeenCalled();
	});

	it('returns false and logs the not saved message when the callable returns false', async () => {
		const errors = silenceErrors();
		const { setConsent } = fakeSetConsent(async () => false);
		await expect(declineConsent(setConsent, '1234569341')).resolves.toBe(false);
		expect(errors).toHaveBeenCalledWith(expect.anything(), `${CONSENT_NOT_SAVED_MESSAGE} (allowed=false)`);
	});

	it('returns false and logs the error instead of rejecting when the callable rejects', async () => {
		const errors = silenceErrors();
		const failure = new Error('ipc failed');
		const { setConsent } = fakeSetConsent(async () => {
			throw failure;
		});
		await expect(declineConsent(setConsent, '1234569341')).resolves.toBe(false);
		expect(errors).toHaveBeenCalledWith(expect.anything(), 'Error storing consent choice (allowed=false):', failure);
	});
});
