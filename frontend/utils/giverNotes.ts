// Lengths are UTF-16 units, like the textarea's maxLength, so the backend's code point count never rejects them
export const NOTE_MAX_LENGTH = 2000;
export const NOTE_COUNTER_FROM = 1800;
export const NOTE_TOO_LONG_MESSAGE = `Notes are limited to ${NOTE_MAX_LENGTH.toLocaleString('en-US')} characters.`;

export function shouldShowNoteCounter(notes: string): boolean {
	return notes.length >= NOTE_COUNTER_FROM;
}

export function formatNoteCounter(notes: string): string {
	return `${notes.length} / ${NOTE_MAX_LENGTH}`;
}

// The saved note is trimmed, so trailing spaces don't count
export function isNoteWithinCap(notes: string): boolean {
	return notes.trim().length <= NOTE_MAX_LENGTH;
}
