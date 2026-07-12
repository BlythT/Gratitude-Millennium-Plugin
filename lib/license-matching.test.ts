import { describe, it, expect } from 'vitest';
import { 
	normalizeForComparison, 
	decodeHtmlEntities, 
	fuzzyMatchLicenseName, 
	LicenseData 
} from './license-matching';

describe('License Matching Engine', () => {
	describe('decodeHtmlEntities', () => {
		it('should decode HTML entities properly', () => {
			expect(decodeHtmlEntities('Serious Sam 3: BFE &amp; Jewels')).toBe('Serious Sam 3: BFE & Jewels');
			expect(decodeHtmlEntities('Half-Life&trade;')).toBe('Half-Life\u2122');
		});
	});

	describe('normalizeForComparison', () => {
		it('should normalize casing, accents, and punctuation', () => {
			expect(normalizeForComparison('Crusader Kings II')).toBe('crusader kings 2');
			expect(normalizeForComparison('The Witcher 3: Wild Hunt')).toBe('witcher 3 wild hunt');
			expect(normalizeForComparison('DiRT Rally 2.0')).toBe('dirt rally 2 0');
		});

		it('should map roman numerals', () => {
			expect(normalizeForComparison('Portal II')).toBe('portal 2');
			expect(normalizeForComparison('Serious Sam III')).toBe('serious sam 3');
			expect(normalizeForComparison('Grand Theft Auto V')).toBe('grand theft auto 5');
		});

		it('should handle "i" safeguard', () => {
			// "I" at the start of a title should not convert to "1"
			expect(normalizeForComparison('I am Bread')).toBe('i am bread');
			expect(normalizeForComparison('Gladiator II')).toBe('gladiator 2');
		});
	});

	describe('fuzzyMatchLicenseName', () => {
		const mockCache = new Map<string, LicenseData>([
			['Serious Sam 3: BFE', { date: 'Jan 1, 2025', acquisition: 'Gift/Guest Pass' }],
			['Counter-Strike: Global Offensive', { date: 'Jan 2, 2025', acquisition: 'Gift/Guest Pass' }],
			['Dawn of War: Soulstorm (NA/AU)', { date: 'Jan 3, 2025', acquisition: 'Gift/Guest Pass' }],
			['Portal 2', { date: 'Jan 4, 2025', acquisition: 'Gift/Guest Pass' }]
		]);

		it('should exact match when present', () => {
			const res = fuzzyMatchLicenseName(mockCache, 'Serious Sam 3: BFE');
			expect(res).not.toBeNull();
			expect(res?.licenseKey).toBe('Serious Sam 3: BFE');
			expect(res?.matchType).toBe('exact');
		});

		it('should match normalized name variations', () => {
			const res = fuzzyMatchLicenseName(mockCache, 'portal ii');
			expect(res).not.toBeNull();
			expect(res?.licenseKey).toBe('Portal 2');
			expect(res?.matchType).toBe('normalized-exact');
		});

		it('should match using aliases', () => {
			const res = fuzzyMatchLicenseName(mockCache, 'Counter-Strike 2');
			expect(res).not.toBeNull();
			expect(res?.licenseKey).toBe('Counter-Strike: Global Offensive');
		});

		it('should strip suffix qualifiers like editions', () => {
			const res = fuzzyMatchLicenseName(mockCache, 'Serious Sam 3: BFE - Special Edition');
			expect(res).not.toBeNull();
			expect(res?.licenseKey).toBe('Serious Sam 3: BFE');
		});
	});
});
