// Decisions for the paginated Steam license sync that runs on Store pages.

export const LICENSES_URL = 'https://store.steampowered.com/account/licenses/';

// The license table is parsed in English (dates and "Gift/Guest Pass"), so every page asks for it,
// whatever the paginator link says. Returns null for a link that would leave the licenses page.
export function nextLicensePageUrl(href: string): string | null {
	let url: URL;
	try {
		url = new URL(href, LICENSES_URL);
	} catch {
		return null;
	}
	if (url.origin !== 'https://store.steampowered.com' || !url.pathname.startsWith('/account/licenses')) {
		return null;
	}
	url.searchParams.set('l', 'english');
	return url.toString();
}

// The first licenses page, in English like every later one
export function firstLicensePageUrl(): string {
	return `${LICENSES_URL}?l=english`;
}

// Reads the total from the paginator text, e.g. "Showing 1 - 100 of 1,234" -> 1234. Accepts comma,
// period, space and non-breaking space thousands separators. Returns 0 when there is no total.
export function parseLicenseTotal(text: string | null | undefined): number {
	const match = text?.match(/of\s+(\d[\d,.\s  ]*)/i);
	if (!match) {
		return 0;
	}
	const total = parseInt(match[1].replace(/\D/g, ''), 10);
	return Number.isFinite(total) ? total : 0;
}

// How many licenses pages there are, from the paginator text on page currentPage, e.g. "Showing
// licenses 101-200 of 912" -> 10. The total counts games borrowed through Family Sharing, which
// the pages don't list, so the number of licenses parsed never reaches it; the page count is the
// honest measure of progress. Returns 0 when the text has no range.
export function licensePageCount(text: string | null | undefined, currentPage: number): number {
	const match = text?.match(/(\d[\d,.\s  ]*)\s*-\s*(\d[\d,.\s  ]*)\s+of\s+(\d[\d,.\s  ]*)/i);
	if (!match) return 0;
	const [first, last, total] = match.slice(1, 4).map((n) => parseInt(n.replace(/\D/g, ''), 10));
	if (![first, last, total].every(Number.isFinite) || last < first) return 0;
	// On the last page the range is short, so it can't give the page size
	if (last >= total) return currentPage;
	return Math.ceil(total / (last - first + 1));
}

// A sync is skipped only when the user didn't ask for it and the last sync that finished and saved
// every page saw the same number of licenses. completedCount is that sync's count from the backend.
export function shouldSkipLicenseSync(
	completedCount: unknown,
	pageTotal: number,
	isExplicitSync: boolean,
): boolean {
	if (isExplicitSync || pageTotal <= 0) {
		return false;
	}
	return Number(completedCount) === pageTotal;
}

// The count saved with a page: only the last page of a sync in which every page was fetched and
// saved carries one, so an interrupted sync never looks complete.
export function completedLicenseCount({
	isLastPage,
	everyPageSaved,
	pageTotal,
	parsedTotal,
}: {
	isLastPage: boolean;
	everyPageSaved: boolean;
	pageTotal: number;
	parsedTotal: number;
}): number | undefined {
	if (!isLastPage || !everyPageSaved) {
		return undefined;
	}
	return pageTotal || parsedTotal;
}

// Pages opened by a "sync now" link carry gratitude_sync=1. Returns the URL without it, or null
// when the flag isn't there.
export function withoutExplicitSyncFlag(href: string): string | null {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	if (url.searchParams.get('gratitude_sync') !== '1') {
		return null;
	}
	url.searchParams.delete('gratitude_sync');
	return url.toString();
}

// Where a license sync that stopped part way can pick up again. Pages already fetched were saved,
// so a large library whose sync keeps stopping at the same page (Steam throttling a long run of
// requests) still finishes over several visits instead of starting over at page 1 each time.
export interface LicenseResumePoint {
	// The licenses page to fetch next
	url: string;
	// Its page number, for progress
	page: number;
	// Licenses parsed on the pages before it
	parsed: number;
	// The license total when it stopped; a different total means pages shifted, so start over
	total: number;
	savedAt: number;
}

export const RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const licenseResumeKey = (steamUserID: string) => `gratitude:licenseResume:${steamUserID}`;

interface ResumeStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

// The saved resume point, or null when there is none, it's older than a day, or it's unreadable
export function readResumePoint(storage: ResumeStorage | undefined, key: string, nowMs: number): LicenseResumePoint | null {
	try {
		const raw = storage?.getItem(key);
		if (!raw) return null;
		const point = JSON.parse(raw) as Partial<LicenseResumePoint>;
		const valid = typeof point.url === 'string'
			&& nextLicensePageUrl(point.url) !== null
			&& Number.isInteger(point.page) && (point.page as number) > 1
			&& Number.isInteger(point.parsed) && (point.parsed as number) >= 0
			&& Number.isInteger(point.total) && (point.total as number) > 0
			&& typeof point.savedAt === 'number' && nowMs - point.savedAt <= RESUME_MAX_AGE_MS;
		return valid ? { ...(point as LicenseResumePoint), url: nextLicensePageUrl(point.url as string) as string } : null;
	} catch {
		return null;
	}
}

export function saveResumePoint(storage: ResumeStorage | undefined, key: string, point: LicenseResumePoint): void {
	try {
		storage?.setItem(key, JSON.stringify(point));
	} catch {
		// Without storage the next sync just starts from page 1
	}
}

export function clearResumePoint(storage: ResumeStorage | undefined, key: string): void {
	try {
		storage?.setItem(key, '');
	} catch {
		// Nothing to clear
	}
}
