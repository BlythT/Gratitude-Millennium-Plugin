import { describe, it, expect } from 'vitest';
import { settingsAfterSave } from './settingsSave';

const previous = { showFriendPickerSteamUrl: false };
const next = { showFriendPickerSteamUrl: true };

describe('settingsAfterSave', () => {
	it('keeps the previous settings when the save returns failure', () => {
		expect(settingsAfterSave(previous, next, false)).toBe(previous);
		expect(settingsAfterSave(previous, next, undefined)).toBe(previous);
		expect(settingsAfterSave(previous, next, 'save_failed')).toBe(previous);
	});

	it('takes the next settings when the save returns success', () => {
		expect(settingsAfterSave(previous, next, true)).toBe(next);
		expect(settingsAfterSave(previous, next, 'true')).toBe(next);
	});
});
