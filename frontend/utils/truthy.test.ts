import { describe, it, expect } from 'vitest';
import { isTruthy } from './truthy';

describe('isTruthy', () => {
	it('reads true and the string "true" in any case as true', () => {
		expect(isTruthy(true)).toBe(true);
		expect(isTruthy('true')).toBe(true);
		expect(isTruthy('TRUE')).toBe(true);
	});

	it('reads false, other strings and backend error codes as false', () => {
		expect(isTruthy(false)).toBe(false);
		expect(isTruthy('')).toBe(false);
		expect(isTruthy('false')).toBe(false);
		expect(isTruthy('size_limit')).toBe(false);
		expect(isTruthy('save_failed')).toBe(false);
	});

	it('reads an array by its first element', () => {
		expect(isTruthy([])).toBe(false);
		expect(isTruthy([true])).toBe(true);
	});

	it('reads an object by its first key', () => {
		expect(isTruthy({})).toBe(false);
		expect(isTruthy({ ok: true })).toBe(true);
		expect(isTruthy({ error: 'x', ok: false })).toBe(false);
	});

	it('reads numbers, null and undefined by JavaScript truthiness', () => {
		expect(isTruthy(1)).toBe(true);
		expect(isTruthy(0)).toBe(false);
		expect(isTruthy(null)).toBe(false);
		expect(isTruthy(undefined)).toBe(false);
	});
});
