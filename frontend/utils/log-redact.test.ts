import { describe, it, expect } from 'vitest';
import { maskId, safeLicenseKey } from '../../lib/log-redact';

describe('maskId', () => {
	it('keeps only the last four characters of an account ID', () => {
		expect(maskId('1234569341')).toBe('****9341');
	});

	it('masks a numeric ID through its string form', () => {
		expect(maskId(1234569341)).toBe('****9341');
	});

	it('keeps only the last four digits of a 17 digit SteamID64', () => {
		expect(maskId('76561198012345678')).toBe('****5678');
	});

	it('fully masks a value of four characters or fewer', () => {
		expect(maskId('9341')).toBe('****');
		expect(maskId('41')).toBe('****');
	});

	it('reports a missing or empty value as <none>', () => {
		expect(maskId('')).toBe('<none>');
		expect(maskId(null)).toBe('<none>');
		expect(maskId(undefined)).toBe('<none>');
	});
});

describe('safeLicenseKey', () => {
	it('keeps an all digit app ID as it is', () => {
		expect(safeLicenseKey('220')).toBe('220');
	});

	it('keeps a numeric app ID through its string form', () => {
		expect(safeLicenseKey(220)).toBe('220');
	});

	it('hides a key that is not all digits', () => {
		expect(safeLicenseKey('Half-Life 2')).toBe('non-numeric key');
		expect(safeLicenseKey('220a')).toBe('non-numeric key');
	});

	it('reports a missing or empty key as <none>', () => {
		expect(safeLicenseKey('')).toBe('<none>');
		expect(safeLicenseKey(null)).toBe('<none>');
		expect(safeLicenseKey(undefined)).toBe('<none>');
	});
});
