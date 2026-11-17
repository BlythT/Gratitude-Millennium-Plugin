import { resolveLanguage, translate, formatGiftDate, type MessageKey } from '../lib/i18n';

// The Steam client's UI language as a translation code. Steam's LocalizationManager has the locale
// the client is shown in ("it" with Steam in Italian); navigator.language can be left over from an
// earlier launch, so it isn't used. Falls back to the page's lang attribute, then English.
export function uiLanguage(): string {
	try {
		const locales = (window as unknown as { LocalizationManager?: { GetPreferredLocales?: () => string[] } })
			.LocalizationManager?.GetPreferredLocales?.();
		if (Array.isArray(locales) && locales[0]) return resolveLanguage(locales[0]);
	} catch {
		// Not ready yet; use the fallback
	}
	return resolveLanguage(typeof document !== 'undefined' ? document.documentElement?.lang : undefined);
}

/** A phrase in the Steam client's language, with {placeholders} filled in. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
	return translate(uiLanguage(), key, vars);
}

/** A stored license date ("Dec 22, 2012") in the Steam client's language. */
export function giftDate(date: string): string {
	return formatGiftDate(date, uiLanguage());
}
