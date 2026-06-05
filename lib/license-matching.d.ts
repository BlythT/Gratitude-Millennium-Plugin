export interface LicenseMatch<T = unknown> {
	licenseKey: string;
	data: T;
	matchType?: string;
}

export function decodeHtmlEntities(value: string): string;
export function normalizeForComparison(value: string): string;
export function fuzzyMatchLicenseName<T>(map: Map<string, T>, gameName: string): LicenseMatch<T> | null;
