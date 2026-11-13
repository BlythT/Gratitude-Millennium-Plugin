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

export interface StoredLicenseCache {
	completedLicenseCount?: unknown;
	totalLicenses?: unknown;
}

// A sync is skipped only when the user didn't ask for it and the last sync that finished every
// page saw the same number of licenses. The older totalLicenses count isn't trusted: it was saved
// with the first page, so a sync that stopped part way could have left it matching.
export function shouldSkipLicenseSync(
	existing: StoredLicenseCache | null | undefined,
	pageTotal: number,
	isExplicitSync: boolean,
): boolean {
	if (isExplicitSync || pageTotal <= 0 || !existing) {
		return false;
	}
	return existing.completedLicenseCount === pageTotal;
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
