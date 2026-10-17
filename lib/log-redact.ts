const NONE = '<none>';
const MASK = '****';

function toLogString(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value);
	return text === '' ? null : text;
}

export function maskId(id: unknown): string {
	const text = toLogString(id);
	if (text === null) return NONE;
	if (text.length <= 4) return MASK;
	return MASK + text.slice(-4);
}

export function safeLicenseKey(key: unknown): string {
	const text = toLogString(key);
	if (text === null) return NONE;
	return /^[0-9]+$/.test(text) ? text : 'non-numeric key';
}
