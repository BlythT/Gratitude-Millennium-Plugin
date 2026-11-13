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
