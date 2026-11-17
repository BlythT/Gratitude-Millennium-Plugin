import { describe, it, expect } from 'vitest';
import { en, STEAM_LANGUAGES, TRANSLATIONS, resolveLanguage, translate, formatGiftDate, type MessageKey } from './index';

const keys = Object.keys(en) as MessageKey[];
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
	it("cover every Steam client language", () => {
		const missing = STEAM_LANGUAGES.filter((l) => !TRANSLATIONS[l.code]).map((l) => l.code);
		expect(missing).toEqual([]);
		expect(STEAM_LANGUAGES).toHaveLength(30);
	});

	it('have every phrase in every language', () => {
		const gaps = Object.entries(TRANSLATIONS).flatMap(([code, messages]) =>
			keys.filter((key) => !messages[key]?.trim()).map((key) => `${code}: ${key}`));
		expect(gaps).toEqual([]);
	});

	it('have no phrases English lacks', () => {
		const extra = Object.entries(TRANSLATIONS).flatMap(([code, messages]) =>
			Object.keys(messages).filter((key) => !(key in en)).map((key) => `${code}: ${key}`));
		expect(extra).toEqual([]);
	});

	it('keep the name Gratitude wherever the English has it', () => {
		const named = keys.filter((key) => en[key].includes('Gratitude'));
		expect(named.length).toBeGreaterThan(0);
		const renamed = Object.entries(TRANSLATIONS).flatMap(([code, messages]) =>
			named.filter((key) => !messages[key]?.includes('Gratitude')).map((key) => `${code}: ${key}`));
		expect(renamed).toEqual([]);
	});

	it('keep every placeholder, and add none', () => {
		const wrong = Object.entries(TRANSLATIONS).flatMap(([code, messages]) =>
			keys.filter((key) => messages[key] && placeholders(messages[key]!).join() !== placeholders(en[key]).join())
				.map((key) => `${code}: ${key}`));
		expect(wrong).toEqual([]);
	});
});

describe('resolveLanguage', () => {
	it('maps locales and Steam language names to a translation', () => {
		expect(resolveLanguage('it')).toBe('it');
		expect(resolveLanguage('it-IT')).toBe('it');
		expect(resolveLanguage('italian')).toBe('it');
		expect(resolveLanguage('pt-BR')).toBe('pt-BR');
		expect(resolveLanguage('brazilian')).toBe('pt-BR');
		expect(resolveLanguage('pt-PT')).toBe('pt');
		expect(resolveLanguage('es-419')).toBe('es-419');
		expect(resolveLanguage('es-MX')).toBe('es-419');
		expect(resolveLanguage('es-ES')).toBe('es');
		expect(resolveLanguage('latam')).toBe('es-419');
		expect(resolveLanguage('zh-CN')).toBe('zh-CN');
		expect(resolveLanguage('zh-Hant')).toBe('zh-TW');
		expect(resolveLanguage('tchinese')).toBe('zh-TW');
		expect(resolveLanguage('koreana')).toBe('ko');
		expect(resolveLanguage('nb-NO')).toBe('no');
	});

	it('falls back to English for anything unknown', () => {
		expect(resolveLanguage('xx')).toBe('en');
		expect(resolveLanguage('')).toBe('en');
		expect(resolveLanguage(undefined)).toBe('en');
	});
});

describe('translate', () => {
	it('fills in placeholders', () => {
		expect(translate('en', 'badge.tooltipFromNote', { name: 'Sam', note: 'Happy birthday' })).toBe('Gifted by Sam - Happy birthday');
		expect(translate('de', 'badge.tooltipFrom', { name: 'Sam' })).toBe('Geschenkt von Sam');
	});

	it('falls back to English for a language without a translation', () => {
		expect(translate('xx', 'badge.label')).toBe('Gifted');
	});
});

describe('formatGiftDate', () => {
	it('shows a stored license date in the language’s own format', () => {
		expect(formatGiftDate('Dec 22, 2012', 'en')).toBe('Dec 22, 2012');
		expect(formatGiftDate('Dec 22, 2012', 'de')).toBe('22. Dez. 2012');
		expect(formatGiftDate('Mar 5, 2025', 'ja')).toBe('2025年3月5日');
	});

	it('leaves an unreadable date as it is', () => {
		expect(formatGiftDate('someday', 'de')).toBe('someday');
	});
});
