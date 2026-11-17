import { describe, it, expect } from 'vitest';
import { parseLicensesPrint, parsePurchasedTime, giftVerdictForApp, formatLicenseDate, checkLicensesPrintFormat } from './client-licenses';

// Real licenses_print output, with the original owner's ID replaced
const OUTPUT = `License packageID 0:
 - State   : Active (flags 0x200) - Purchased : Sun Jun 17 12:13:38 2012 in "", Complimentary
 - Apps	: 5, 7, 8, 90, 205, 211, 215, 218, 219, 310, 410, 440, 480, 564, 570, 575, 635, 640, 740, 760, 761, 764, 765, 766, 1007, 1213, 1273, 1840, 2145, 2403, 4270, 9001, ... (196 in total)
 - Depots   : 228983,  (1 in total)
License packageID 218:
 - State   : Active (flags 0x200) - Purchased : Sat Dec 22 23:04:12 2012 in "NZ", Guest Pass
 - Apps	: 4000,  (1 in total)
 - Depots   : 4001, 4002,  (2 in total)
License packageID 27214:
 - State   : Active (flags 0x200) - Purchased : Thu Nov 27 13:10:01 2014 in "NZ", Wallet
 - Apps	: 219740, 322330,  (2 in total)
 - Depots   : 219741,  (1 in total)
License packageID 55832:
 - State   : Active (flags 0x200) - Purchased : Sat Jan 10 22:26:30 2015 in "NZ", Guest Pass
 - Apps	: 322330,  (1 in total)
 - Depots   : 322331,  (1 in total)
License packageID 68022:
 - State   : Active (flags 0x200) - Purchased : Wed Sep 16 19:20:32 2015 in "NZ", PayPal
 - Apps	: 238370,  (1 in total)
 - Depots   : 238371,  (1 in total)
License packageID 347119:
 - State   : Inactive (flags 0x200) - Purchased : Sat Mar  2 07:13:10 2019 in "NZ", Complimentary
 - Apps	: 548430,  (1 in total)
 - Depots   : 548431,  (1 in total)
License packageID 135552:
 - State   : Active (flags 0x200) - Purchased : Mon Mar  4 20:23:05 2019 in "NZ", Guest Pass
 - Apps	: 548430,  (1 in total)
 - Depots   : 548431,  (1 in total)
License packageID 37:
 - State   : Active, Borrowed (flags 0x4200) - Purchased : Mon Jun 29 12:53:26 2015 in "NZ", Family Group
 - Original Owner : 12345
 - Apps	: 211, 215, 218, 240,  (4 in total)
 - Depots   : 241, 263,  (2 in total)
`;

const licenses = parseLicensesPrint(OUTPUT);
const byPackage = (id: number) => licenses.find((l) => l.packageId === id)!;

describe('parseLicensesPrint', () => {
	it('reads every license', () => {
		expect(licenses.map((l) => l.packageId)).toEqual([0, 218, 27214, 55832, 68022, 347119, 135552, 37]);
	});

	it('reads state, method and apps', () => {
		expect(byPackage(218)).toMatchObject({ active: true, borrowed: false, method: 'Guest Pass', appIds: [4000], appsTruncated: false });
		expect(byPackage(347119).active).toBe(false);
		expect(byPackage(27214).appIds).toEqual([219740, 322330]);
	});

	it('marks Family Sharing licenses as borrowed', () => {
		expect(byPackage(37)).toMatchObject({ active: true, borrowed: true, method: 'Family Group' });
	});

	it("notes an app list cut off at Steam's limit", () => {
		expect(byPackage(0).appsTruncated).toBe(true);
		expect(byPackage(0).appIds).toHaveLength(32);
	});

	it('skips blocks without the expected lines', () => {
		expect(parseLicensesPrint('License packageID 5:\n - something else\nNot a license')).toEqual([]);
	});
});

describe('parsePurchasedTime', () => {
	it('reads the local time Steam prints, including single-digit days', () => {
		expect(parsePurchasedTime('Sat Dec 22 23:04:12 2012')).toBe(new Date(2012, 11, 22, 23, 4, 12).getTime() / 1000);
		expect(parsePurchasedTime('Sat Mar  2 07:13:10 2019')).toBe(new Date(2019, 2, 2, 7, 13, 10).getTime() / 1000);
		expect(parsePurchasedTime('yesterday')).toBeNull();
	});
});

describe('giftVerdictForApp', () => {
	it('finds a gift by App ID', () => {
		const verdict = giftVerdictForApp(licenses, 4000);
		expect(verdict?.gifted).toBe(true);
		expect(verdict?.license?.packageId).toBe(218);
	});

	it('counts a gift even when another license also includes the game', () => {
		// Don't Starve Together: in the Don't Starve package bought earlier, and gifted
		expect(giftVerdictForApp(licenses, 322330)?.license?.packageId).toBe(55832);
	});

	it('ignores licenses that are no longer active, like a free weekend', () => {
		expect(giftVerdictForApp(licenses, 548430)?.license?.packageId).toBe(135552);
	});

	it('is not gifted when the only licenses for it were bought', () => {
		expect(giftVerdictForApp(licenses, 238370)).toEqual({ gifted: false });
	});

	it("can't tell for a game no own license lists, or only a borrowed one", () => {
		expect(giftVerdictForApp(licenses, 999999)).toBeNull();
		expect(giftVerdictForApp(licenses.filter((l) => l.packageId === 37), 240)).toBeNull();
	});

	it("can't tell a non-gift when a gift license's app list was cut off", () => {
		const truncatedGift = { ...byPackage(218), packageId: 9, appIds: [1], appsTruncated: true };
		expect(giftVerdictForApp([...licenses, truncatedGift], 238370)).toBeNull();
	});
});

describe('formatLicenseDate', () => {
	it('formats like the licenses page', () => {
		expect(formatLicenseDate(new Date(2012, 11, 22, 23, 4, 12).getTime() / 1000)).toBe('Dec 22, 2012');
	});
});

describe('checkLicensesPrintFormat', () => {
	it('passes real output', () => {
		const check = checkLicensesPrintFormat(OUTPUT);
		expect(check.problems).toEqual([]);
		expect(check.blocks).toBe(8);
		expect(check.licenses).toHaveLength(8);
		expect(check.states).toEqual({ Active: 6, Inactive: 1, 'Active, Borrowed': 1 });
		expect(check.methods['Guest Pass']).toBe(3);
	});

	it('fails when nothing recognisable was printed', () => {
		expect(checkLicensesPrintFormat('Unknown command "licenses_print"').problems[0]).toMatch(/printed nothing recognisable/);
	});

	it('fails when a license is missing a line it needs', () => {
		const broken = OUTPUT.replace(' - Apps\t: 4000,  (1 in total)\n', '');
		expect(checkLicensesPrintFormat(broken).problems).toContain("1 of 8 licenses didn't parse (missing State, Purchased or Apps lines).");
	});

	it('fails on an unfamiliar state, an unreadable time or a short app list', () => {
		const changed = OUTPUT
			.replace('State   : Inactive (flags', 'State   : Revoked (flags')
			.replace('Sat Dec 22 23:04:12 2012', '2012-12-22T23:04:12')
			.replace('219740, 322330,  (2 in total)', '219740,  (2 in total)');
		const problems = checkLicensesPrintFormat(changed).problems;
		expect(problems).toContain('Package 347119 has an unfamiliar state "Revoked".');
		expect(problems.some((p) => p.includes('unreadable purchase time'))).toBe(true);
		expect(problems).toContain('Package 27214 lists 1 apps but says 2 in total.');
	});
});
