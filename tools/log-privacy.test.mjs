// Static check that log calls never pass personal data.
// A call is flagged when its arguments mention a risky identifier outside the masking helpers.
// It is a list of names, not a data-flow analysis: a new variable that holds personal data needs
// adding to RISKY_IDENTIFIERS, or logging it will pass unnoticed.
// A genuinely safe call opts out with a `log-privacy: allow=<name>[,<name>] <reason>` comment on its
// first line, which skips only the named identifiers. Known gap: an error object logged from a
// catch block can quote its input (V8 JSON.parse errors do); accepted as a known gap.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RISKY_IDENTIFIERS = [
	'steamUserID',
	'steamID',
	'steamid',
	'steamID64',
	'accountID',
	'accountId',
	'appSteamID',
	'globalSteamID',
	'displayName',
	'existingDisplayName',
	'notes',
	'profileUrl',
	'nicknameOrAlias',
	'avatarUrl',
	'gameName',
	'gameTitle',
	'libraryTitle',
	'licenseKey',
	'item',
	'payload',
	'payloadJson',
	'licenseData',
	'friendsJson',
	'row',
	'href',
	'src',
	// Variables that hold personal data as a whole: names, notes, licenses or friends
	'friends',
	'friend',
	'normalizedFriends',
	'licenses',
	'license',
	'ownedGames',
	'games',
	'giver',
	'existingGiver',
	'match',
	'accountStore',
	'GiverStore',
	'FriendsCacheStore',
	'GameLicenseCache',
	'content',
	'decoded',
	'html',
];
const MASKING_HELPERS = ['maskId', 'mask_id', 'safeLicenseKey', 'safe_license_key'];

const IDENTIFIER_PATTERN = /(?<![\w$])[A-Za-z_$][\w$]*/g;
const MASKED_CALL_PATTERN = new RegExp(`(?<![\\w$])(?:${MASKING_HELPERS.join('|')})\\s*\\(`, 'g');
// `log-privacy: allow=name[,name] <reason>` skips only the named identifiers on that call
const OPT_OUT_PATTERN = /(?:\/\/|--)\s*log-privacy:\s*allow=([\w$]+(?:,[\w$]+)*)\s+\S/;

// A compound name ending in a risky identifier is risky too: legacyLicenseKey, legacy_license_key
const RISKY_ENDINGS = RISKY_IDENTIFIERS.flatMap((name) => [
	name[0].toUpperCase() + name.slice(1),
	'_' + name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(),
]);

function isRisky(identifier) {
	if (MASKING_HELPERS.includes(identifier)) return false;
	if (RISKY_IDENTIFIERS.includes(identifier)) return true;
	return RISKY_ENDINGS.some((ending) => identifier.length > ending.length && identifier.endsWith(ending));
}

const LANGUAGES = {
	lua: { logCall: /(?<![\w.:])(?:logger:(?:info|warn|error)|print)\s*\(/g, lineComment: '--' },
	ts: { logCall: /(?<![\w$.])(?:log|logError|logDebug|console\.\w+)\s*\(/g, lineComment: '//' },
};

const SCANNED_FOLDERS = [
	{ folder: 'backend', extensions: ['.lua'], language: 'lua' },
	{ folder: 'frontend', extensions: ['.ts', '.tsx', '.js'], language: 'ts' },
	{ folder: 'webkit', extensions: ['.ts', '.tsx', '.js'], language: 'ts' },
	{ folder: 'lib', extensions: ['.ts', '.tsx', '.js'], language: 'ts' },
];
const SKIPPED_FILES = new Set(['lib/logger.ts']);

// A regex literal can only start where a value is expected, which is after one of these
const REGEX_CAN_FOLLOW = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);

const blank = (text) => text.replace(/[^\n]/g, ' ');

function endOfLine(source, index) {
	const newline = source.indexOf('\n', index);
	return newline === -1 ? source.length : newline;
}

function endOfQuoted(source, index) {
	const quote = source[index];
	let position = index + 1;
	while (position < source.length && source[position] !== quote && source[position] !== '\n') {
		position += source[position] === '\\' ? 2 : 1;
	}
	return position + 1;
}

// Lua long brackets: [[...]], [==[...]==]
function endOfLongBracket(source, index) {
	const opening = /^\[(=*)\[/.exec(source.slice(index, index + 64));
	if (!opening) return null;
	const closing = source.indexOf(`]${opening[1]}]`, index + opening[0].length);
	return closing === -1 ? source.length : closing + opening[1].length + 2;
}

function endOfRegex(source, index) {
	let position = index + 1;
	let inClass = false;
	while (position < source.length && source[position] !== '\n') {
		const char = source[position];
		if (char === '\\') {
			position += 2;
			continue;
		}
		if (char === '[') inClass = true;
		else if (char === ']') inClass = false;
		else if (char === '/' && !inClass) break;
		position += 1;
	}
	position += 1;
	while (/[a-z]/i.test(source[position] ?? '')) position += 1;
	return position;
}

// Returns the end of a comment or string literal starting at index, with the code to keep in its
// place, or null when index starts ordinary code
function readNonCode(source, index, language, previousCodeChar) {
	const char = source[index];
	const pair = source.slice(index, index + 2);

	if (language === 'lua') {
		if (pair === '--') {
			const end = endOfLongBracket(source, index + 2) ?? endOfLine(source, index);
			return { end, code: blank(source.slice(index, end)) };
		}
		if (char === '[') {
			const end = endOfLongBracket(source, index);
			return end === null ? null : { end, code: blank(source.slice(index, end)) };
		}
	} else {
		if (pair === '//') {
			const end = endOfLine(source, index);
			return { end, code: blank(source.slice(index, end)) };
		}
		if (pair === '/*') {
			const close = source.indexOf('*/', index + 2);
			const end = close === -1 ? source.length : close + 2;
			return { end, code: blank(source.slice(index, end)) };
		}
		if (char === '`') return readTemplate(source, index);
		if (char === '/' && REGEX_CAN_FOLLOW.has(previousCodeChar)) {
			const end = endOfRegex(source, index);
			return { end, code: blank(source.slice(index, end)) };
		}
	}

	if (char === '"' || char === "'") {
		const end = endOfQuoted(source, index);
		return { end, code: blank(source.slice(index, end)) };
	}
	return null;
}

// Keeps the ${...} expressions of a template literal and blanks its text
function readTemplate(source, index) {
	let code = ' ';
	let position = index + 1;
	while (position < source.length) {
		const char = source[position];
		if (char === '\\') {
			code += '  ';
			position += 2;
		} else if (char === '`') {
			return { end: position + 1, code: code + ' ' };
		} else if (source.startsWith('${', position)) {
			const expression = readCode(source, position + 2, 'ts', '}');
			if (!expression) return { end: source.length, code };
			code += `  ${expression.code} `;
			position = expression.end + 1;
		} else {
			code += char === '\n' ? '\n' : ' ';
			position += 1;
		}
	}
	return { end: source.length, code };
}

// Copies code from start up to the bracket that closes it, with comments and string text blanked.
// Returns the closing bracket's index and the copied code, or null when the source ends first.
function readCode(source, start, language, closer) {
	let code = '';
	let depth = 0;
	let previousCodeChar = closer === ')' ? '(' : '{';
	let index = start;
	while (index < source.length) {
		const nonCode = readNonCode(source, index, language, previousCodeChar);
		if (nonCode) {
			code += nonCode.code;
			index = nonCode.end;
			continue;
		}

		const char = source[index];
		if (CLOSERS.has(char)) {
			if (depth === 0 && char === closer) return { end: index, code };
			depth -= 1;
		} else if (OPENERS.has(char)) {
			depth += 1;
		}
		code += char;
		if (!/\s/.test(char)) previousCodeChar = char;
		index += 1;
	}
	return null;
}

function blankMaskedCalls(code) {
	let result = code;
	for (const match of code.matchAll(MASKED_CALL_PATTERN)) {
		const open = match.index + match[0].length - 1;
		let depth = 0;
		let close = open;
		for (; close < code.length; close += 1) {
			if (OPENERS.has(code[close])) depth += 1;
			if (CLOSERS.has(code[close])) depth -= 1;
			if (depth === 0) break;
		}
		result = result.slice(0, open) + blank(code.slice(open, close + 1)) + result.slice(close + 1);
	}
	return result;
}

function lineAt(source, index) {
	const start = source.lastIndexOf('\n', index - 1) + 1;
	return { number: source.slice(0, index).split('\n').length, start, text: source.slice(start, endOfLine(source, index)) };
}

// A call inside a comment or string on its own line isn't a call
function startsInCommentOrString(source, index, language) {
	const prefix = source.slice(lineAt(source, index).start, index);
	if (language === 'ts' && /^\s*(\/\*|\*)/.test(prefix)) return true;
	const { lineComment } = LANGUAGES[language];
	let quote = null;
	for (let position = 0; position < prefix.length; position += 1) {
		const char = prefix[position];
		if (quote) {
			if (char === '\\') position += 1;
			else if (char === quote) quote = null;
			continue;
		}
		if (prefix.startsWith(lineComment, position)) return true;
		if (char === '"' || char === "'" || char === '`') quote = char;
	}
	return quote !== null;
}

function findOffenders(source, language) {
	const offenders = [];
	for (const match of source.matchAll(LANGUAGES[language].logCall)) {
		if (startsInCommentOrString(source, match.index, language)) continue;
		const line = lineAt(source, match.index);
		const optOut = OPT_OUT_PATTERN.exec(line.text);
		const allowed = new Set(optOut ? optOut[1].split(',') : []);

		const args = readCode(source, match.index + match[0].length, language, ')');
		if (!args) {
			offenders.push({ line: line.number, identifiers: ['<arguments never close>'] });
			continue;
		}
		const found = [...blankMaskedCalls(args.code).matchAll(IDENTIFIER_PATTERN)].map((token) => token[0]);
		const identifiers = [...new Set(found.filter((identifier) => isRisky(identifier) && !allowed.has(identifier)))];
		if (identifiers.length > 0) offenders.push({ line: line.number, identifiers });
	}
	return offenders;
}

function listFiles(folder, extensions) {
	const files = [];
	for (const entry of fs.readdirSync(path.join(REPO_ROOT, folder), { withFileTypes: true })) {
		const relativePath = `${folder}/${entry.name}`;
		// frontend/lib and webkit/lib are symlinks to lib/, which is scanned on its own
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) {
			files.push(...listFiles(relativePath, extensions));
		} else if (extensions.includes(path.extname(entry.name)) && !entry.name.includes('.test.') && !SKIPPED_FILES.has(relativePath)) {
			files.push(relativePath);
		}
	}
	return files;
}

describe('log privacy check', () => {
	it('flags a log call that passes a risky identifier', () => {
		expect(findOffenders('log(`Loaded cache for user ${steamUserID}`);', 'ts')).toEqual([{ line: 1, identifiers: ['steamUserID'] }]);
		expect(findOffenders("logError('Missing cells in row:', row);", 'ts')).toEqual([{ line: 1, identifiers: ['row'] }]);
	});

	it('accepts identifiers passed through the masking helpers', () => {
		expect(findOffenders('log(`Saved ${safeLicenseKey(giverData.licenseKey)} for ${maskId(steamUserID)}`);', 'ts')).toEqual([]);
		expect(findOffenders('logger:info("Saved for user " .. log_redact.mask_id(steamUserID))', 'lua')).toEqual([]);
	});

	it('reads the arguments of a call split over several lines', () => {
		const source = ['const a = 1;', 'log(', "\t'Saving giver',", '\t`name=${displayName}`,', ');'].join('\n');
		expect(findOffenders(source, 'ts')).toEqual([{ line: 2, identifiers: ['displayName'] }]);
		const lua = ['logger:info("Deleted record for user " ..', '    steamUserID .. " and license " .. licenseKey)'].join('\n');
		expect(findOffenders(lua, 'lua')).toEqual([{ line: 1, identifiers: ['steamUserID', 'licenseKey'] }]);
	});

	it('flags variables that hold personal data', () => {
		expect(findOffenders("log('Parsed', friends);", 'ts')).toEqual([{ line: 1, identifiers: ['friends'] }]);
		expect(findOffenders('log(existingGiver);', 'ts')).toEqual([{ line: 1, identifiers: ['existingGiver'] }]);
		expect(findOffenders('logger:info(json.encode(accountStore))', 'lua')).toEqual([{ line: 1, identifiers: ['accountStore'] }]);
		expect(findOffenders('log(`Matched ${match}`);', 'ts')).toEqual([{ line: 1, identifiers: ['match'] }]);
	});

	it('flags compound names that end in a risky identifier', () => {
		expect(findOffenders('log(`Migrating ${legacyLicenseKey}`);', 'ts')).toEqual([{ line: 1, identifiers: ['legacyLicenseKey'] }]);
		expect(findOffenders('logger:info("Key " .. legacy_license_key)', 'lua')).toEqual([{ line: 1, identifiers: ['legacy_license_key'] }]);
		expect(findOffenders('log(`Rows: ${rowCount}`);', 'ts')).toEqual([]);
	});

	it('skips only the identifiers an opt-out comment names on its first line', () => {
		expect(findOffenders('logger:info("Data length: " .. #licenseData) -- log-privacy: allow=licenseData length only', 'lua')).toEqual([]);
		expect(findOffenders('log(row.length); // log-privacy: allow=row a count', 'ts')).toEqual([]);
		expect(findOffenders('log(row.length, displayName); // log-privacy: allow=row a count', 'ts')).toEqual([{ line: 1, identifiers: ['displayName'] }]);
		expect(findOffenders('log(row.length); // log-privacy: allow a count', 'ts')).toEqual([{ line: 1, identifiers: ['row'] }]);
		expect(findOffenders('log(row); // log-privacy: allow', 'ts')).toEqual([{ line: 1, identifiers: ['row'] }]);
	});

	it('ignores risky words in plain string text and comments', () => {
		expect(findOffenders("logError('Skipping friend row with incomplete data.');", 'ts')).toEqual([]);
		expect(findOffenders('logger:error("No item for steamUserID") -- row', 'lua')).toEqual([]);
		expect(findOffenders('// log(steamUserID)\nconst x = "log(payload)";', 'ts')).toEqual([]);
	});
});

describe('log calls in backend, frontend, webkit and lib', () => {
	it('pass no personal data', () => {
		const offenders = SCANNED_FOLDERS.flatMap(({ folder, extensions, language }) =>
			listFiles(folder, extensions).flatMap((file) =>
				findOffenders(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'), language).map(
					({ line, identifiers }) => `${file}:${line} logs ${identifiers.join(', ')}`,
				),
			),
		);
		expect(offenders).toEqual([]);
	});
});
