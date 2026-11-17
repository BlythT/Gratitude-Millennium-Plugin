import { en, type MessageKey, type Messages } from './en';
import { europeanLocales } from './locales/european';
import { easternLocales } from './locales/eastern';
import { asianLocales } from './locales/asian';
import { syncLocales } from './locales/sync';

export { en, type MessageKey, type Messages };

// Steam's client languages and the locale code each is translated under. English is the source.
export const STEAM_LANGUAGES: { steam: string; code: string; name: string }[] = [
	{ steam: 'english', code: 'en', name: 'English' },
	{ steam: 'schinese', code: 'zh-CN', name: 'Simplified Chinese' },
	{ steam: 'tchinese', code: 'zh-TW', name: 'Traditional Chinese' },
	{ steam: 'japanese', code: 'ja', name: 'Japanese' },
	{ steam: 'koreana', code: 'ko', name: 'Korean' },
	{ steam: 'thai', code: 'th', name: 'Thai' },
	{ steam: 'indonesian', code: 'id', name: 'Indonesian' },
	{ steam: 'malay', code: 'ms', name: 'Malay' },
	{ steam: 'vietnamese', code: 'vi', name: 'Vietnamese' },
	{ steam: 'bulgarian', code: 'bg', name: 'Bulgarian' },
	{ steam: 'czech', code: 'cs', name: 'Czech' },
	{ steam: 'danish', code: 'da', name: 'Danish' },
	{ steam: 'german', code: 'de', name: 'German' },
	{ steam: 'spanish', code: 'es', name: 'Spanish (Spain)' },
	{ steam: 'latam', code: 'es-419', name: 'Spanish (Latin America)' },
	{ steam: 'greek', code: 'el', name: 'Greek' },
	{ steam: 'french', code: 'fr', name: 'French' },
	{ steam: 'italian', code: 'it', name: 'Italian' },
	{ steam: 'hungarian', code: 'hu', name: 'Hungarian' },
	{ steam: 'dutch', code: 'nl', name: 'Dutch' },
	{ steam: 'norwegian', code: 'no', name: 'Norwegian' },
	{ steam: 'polish', code: 'pl', name: 'Polish' },
	{ steam: 'portuguese', code: 'pt', name: 'Portuguese (Portugal)' },
	{ steam: 'brazilian', code: 'pt-BR', name: 'Portuguese (Brazil)' },
	{ steam: 'romanian', code: 'ro', name: 'Romanian' },
	{ steam: 'russian', code: 'ru', name: 'Russian' },
	{ steam: 'finnish', code: 'fi', name: 'Finnish' },
	{ steam: 'swedish', code: 'sv', name: 'Swedish' },
	{ steam: 'turkish', code: 'tr', name: 'Turkish' },
	{ steam: 'ukrainian', code: 'uk', name: 'Ukrainian' },
];

// Each language's phrases, from every locale file (the sync overlay's are kept separately)
export const TRANSLATIONS: Record<string, Messages> = { en };
for (const group of [europeanLocales, easternLocales, asianLocales, syncLocales]) {
	for (const [code, messages] of Object.entries(group)) {
		TRANSLATIONS[code] = { ...TRANSLATIONS[code], ...messages };
	}
}

/**
 * The translation code for a locale or Steam language name ("it", "it-IT", "zh-Hant", "latam",
 * "brazilian"), or 'en' when there's none. Regional variants fall back to the base language.
 */
export function resolveLanguage(locale: string | null | undefined): string {
	const value = (locale ?? '').trim().replace('_', '-');
	if (!value) return 'en';
	const lower = value.toLowerCase();
	const bySteamName = STEAM_LANGUAGES.find((l) => l.steam === lower);
	if (bySteamName) return bySteamName.code;
	const exact = STEAM_LANGUAGES.find((l) => l.code.toLowerCase() === lower);
	if (exact) return exact.code;
	const [base, ...rest] = lower.split('-');
	const region = rest.join('-');
	if (base === 'zh') return /hant|tw|hk|mo/.test(region) ? 'zh-TW' : 'zh-CN';
	if (base === 'pt') return region === 'br' ? 'pt-BR' : 'pt';
	if (base === 'es') return region && region !== 'es' ? 'es-419' : 'es';
	if (base === 'nb' || base === 'nn') return 'no';
	return STEAM_LANGUAGES.find((l) => l.code === base)?.code ?? 'en';
}

/** The phrase for key in language (a translation code), with {placeholders} filled in. */
export function translate(language: string, key: MessageKey, vars: Record<string, string | number> = {}): string {
	const template = TRANSLATIONS[language]?.[key] ?? en[key];
	return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/**
 * A license date ("Dec 22, 2012", as Gratitude stores it) in the language's own short format,
 * e.g. "22 dic 2012". Returns the date unchanged when it can't be read.
 */
export function formatGiftDate(date: string, language: string): string {
	const time = Date.parse(`${date} UTC`);
	if (Number.isNaN(time)) return date;
	try {
		return new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(time);
	} catch {
		return date;
	}
}
