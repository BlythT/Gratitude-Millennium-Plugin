import { describe, it, expect } from 'vitest';
import { formatNoteCounter, isNoteWithinCap, shouldShowNoteCounter } from './giverNotes';

describe('shouldShowNoteCounter', () => {
	it('hides the counter below 1,800 characters', () => {
		expect(shouldShowNoteCounter('a'.repeat(1799))).toBe(false);
	});

	it('shows the counter from 1,800 characters', () => {
		expect(shouldShowNoteCounter('a'.repeat(1800))).toBe(true);
	});
});

describe('formatNoteCounter', () => {
	it('shows the length against the cap', () => {
		expect(formatNoteCounter('a'.repeat(1850))).toBe('1850 / 2000');
	});
});

describe('isNoteWithinCap', () => {
	it('allows exactly 2,000 characters', () => {
		expect(isNoteWithinCap('a'.repeat(2000))).toBe(true);
	});

	it('rejects 2,001 characters', () => {
		expect(isNoteWithinCap('a'.repeat(2001))).toBe(false);
	});

	it('ignores trailing spaces, because the saved note is trimmed', () => {
		expect(isNoteWithinCap(`${'a'.repeat(2000)}   `)).toBe(true);
	});

	// Each emoji is 2 UTF-16 units, so 1,000 of them is what a 2,000 unit maxLength allows
	it('allows 1,000 emoji, which have a length of 2,000', () => {
		expect(isNoteWithinCap('\u{1F600}'.repeat(1000))).toBe(true);
	});
});
