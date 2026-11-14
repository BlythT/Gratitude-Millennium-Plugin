import { describe, it, expect, afterEach } from 'vitest';
import { isBorrowed, ownerAccountIdOf } from './ownership';

describe('isBorrowed', () => {
	it('is false for a game the user owns, where Steam leaves the owner unset', () => {
		expect(isBorrowed(undefined, '105179341')).toBe(false);
		expect(isBorrowed(null, '105179341')).toBe(false);
		expect(isBorrowed(0, '105179341')).toBe(false);
	});

	it('is true for a game lent by another account', () => {
		expect(isBorrowed(251516924, '105179341')).toBe(true);
	});

	it('is false when the owner is the user', () => {
		expect(isBorrowed(105179341, '105179341')).toBe(false);
		expect(isBorrowed('105179341', '105179341')).toBe(false);
	});
});

describe('ownerAccountIdOf', () => {
	const g = globalThis as unknown as { window?: unknown };
	const original = g.window;
	afterEach(() => { g.window = original; });

	it('reads the owner from Steam\'s app store', () => {
		g.window = { appStore: { GetAppOverviewByAppID: (id: number) => (id === 3981100 ? { owner_account_id: 251516924 } : {}) } };
		expect(ownerAccountIdOf(3981100)).toBe(251516924);
		expect(ownerAccountIdOf(4000)).toBeUndefined();
	});

	it('is undefined when Steam\'s app store is missing or throws', () => {
		g.window = {};
		expect(ownerAccountIdOf(4000)).toBeUndefined();
		g.window = { appStore: { GetAppOverviewByAppID: () => { throw new Error('not ready'); } } };
		expect(ownerAccountIdOf(4000)).toBeUndefined();
	});
});
