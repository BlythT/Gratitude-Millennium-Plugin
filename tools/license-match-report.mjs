#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fuzzyMatchLicenseName, normalizeForComparison } from '../lib/license-matching.js';

const DEFAULT_CACHE_PATH = path.resolve('backend/gratitude_cache.json');
function parseArgs(argv) {
	const options = {
		cachePath: DEFAULT_CACHE_PATH,
		steamUserID: null,
		inputPaths: [],
		json: false,
		maxSuggestions: 5,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];

		if (token === '--cache' && argv[index + 1]) {
			options.cachePath = path.resolve(argv[++index]);
			continue;
		}

		if (token === '--steam-user-id' && argv[index + 1]) {
			options.steamUserID = argv[++index];
			continue;
		}

		if (token === '--dom' || token === '--titles' || token === '--input') {
			if (!argv[index + 1]) {
				throw new Error(`${token} requires a file or directory path`);
			}

			options.inputPaths.push(path.resolve(argv[++index]));
			continue;
		}

		if (token === '--json') {
			options.json = true;
			continue;
		}

		if (token === '--max-suggestions' && argv[index + 1]) {
			options.maxSuggestions = Number.parseInt(argv[++index], 10) || options.maxSuggestions;
			continue;
		}

		if (token.startsWith('--')) {
			throw new Error(`Unknown option: ${token}`);
		}

		options.inputPaths.push(path.resolve(token));
	}

	return options;
}

function decodeHtmlEntities(value) {
	return value
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, '\'')
		.replace(/&trade;/gi, '\u2122')
		.replace(/&reg;/gi, '\u00ae')
		.replace(/&copy;/gi, '\u00a9')
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function stripTags(value) {
	return value.replace(/<[^>]*>/g, ' ');
}

function tokenize(value) {
	const normalized = normalizeForComparison(value);
	return normalized ? new Set(normalized.split(' ')) : new Set();
}

function jaccardScore(left, right) {
	const leftTokens = tokenize(left);
	const rightTokens = tokenize(right);

	if (leftTokens.size === 0 || rightTokens.size === 0) {
		return 0;
	}

	let intersection = 0;
	for (const token of leftTokens) {
		if (rightTokens.has(token)) {
			intersection += 1;
		}
	}

	const union = new Set([...leftTokens, ...rightTokens]).size;
	return union === 0 ? 0 : intersection / union;
}

function extractLibraryTitlesFromHtml(html) {
	const titles = new Set();
	const listItemPattern = /role="listitem"[\s\S]*?(?=role="listitem"|<\/div><div class="_2tC_c87MH67xQM7Y0pVyXm Focusable"|<\/body>|<\/html>)/g;

	for (const blockMatch of html.matchAll(listItemPattern)) {
		const block = blockMatch[0] ?? '';
		const titleMatches = block.matchAll(/<div[^>]*style="display:\s*none;"[^>]*>([\s\S]*?)<\/div>/gi);

		for (const titleMatch of titleMatches) {
			const rawContent = titleMatch[1] ?? '';
			const textContent = decodeHtmlEntities(stripTags(rawContent)).replace(/\s+/g, ' ').trim();
			if (textContent && textContent.length > 1) {
				titles.add(textContent);
			}
		}
	}

	return [...titles];
}

function extractCommunityGameTitlesFromHtml(html) {
	const titles = new Set();
	const cardPattern = /<div class="JeLbcWPaZDg-"[\s\S]*?(?=class="JeLbcWPaZDg-"|<\/body>|<\/html>)/g;

	for (const cardMatch of html.matchAll(cardPattern)) {
		const card = cardMatch[0] ?? '';

		for (const titleMatch of card.matchAll(/<span class="UpqjtP0-VK0-">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/span>/gi)) {
			const rawContent = titleMatch[1] ?? '';
			const textContent = decodeHtmlEntities(stripTags(rawContent)).replace(/\s+/g, ' ').trim();
			if (textContent) {
				titles.add(textContent);
			}
		}

		for (const altMatch of card.matchAll(/<img[^>]*alt="([^"]+)"/gi)) {
			const textContent = decodeHtmlEntities(stripTags(altMatch[1] ?? '')).replace(/\s+/g, ' ').trim();
			if (textContent) {
				titles.add(textContent);
			}
		}
	}

	return [...titles];
}

function extractFallbackTitlesFromHtml(html) {
	const titles = new Set();
	const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (titleTagMatch?.[1]) {
		const titleText = decodeHtmlEntities(stripTags(titleTagMatch[1])).replace(/\s+/g, ' ').trim();
		if (titleText) {
			titles.add(titleText);
		}
	}

	const headingMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
	if (headingMatch?.[1]) {
		const headingText = decodeHtmlEntities(stripTags(headingMatch[1])).replace(/\s+/g, ' ').trim();
		if (headingText) {
			titles.add(headingText);
		}
	}

	return [...titles];
}

async function readSnapshotTitles(inputPath) {
	const inputStat = await stat(inputPath);
	if (inputStat.isDirectory()) {
		const entries = await readdir(inputPath, { withFileTypes: true });
		const nestedTitles = [];

		for (const entry of entries) {
			if (!entry.isFile() && !entry.isDirectory()) {
				continue;
			}

			const nestedPath = path.join(inputPath, entry.name);
			nestedTitles.push(...await readSnapshotTitles(nestedPath));
		}

		return nestedTitles;
	}

	const raw = await readFile(inputPath, 'utf8');
	const extension = path.extname(inputPath).toLowerCase();
	const looksLikeHtml = /^\s*</.test(raw);

	if (extension === '.html' || extension === '.htm' || looksLikeHtml) {
		const communityTitles = extractCommunityGameTitlesFromHtml(raw);
		const libraryTitles = extractLibraryTitlesFromHtml(raw);
		const extractedTitles = communityTitles.length > 0
			? communityTitles
			: (libraryTitles.length > 0 ? libraryTitles : extractFallbackTitlesFromHtml(raw));
		return extractedTitles.map((title) => ({ source: inputPath, title }));
	}

	if (extension === '.json') {
		const decoded = JSON.parse(raw);
		const titles = [];

		if (Array.isArray(decoded)) {
			for (const item of decoded) {
				if (typeof item === 'string' && item.trim()) {
					titles.push({ source: inputPath, title: item.trim() });
				} else if (item && typeof item === 'object') {
					const candidate = item.title ?? item.gameName ?? item.name;
					if (typeof candidate === 'string' && candidate.trim()) {
						titles.push({ source: inputPath, title: candidate.trim() });
					}
				}
			}
		} else if (decoded && typeof decoded === 'object') {
			for (const value of Object.values(decoded)) {
				if (typeof value === 'string' && value.trim()) {
					titles.push({ source: inputPath, title: value.trim() });
				}
			}
		}

		return titles;
	}

	return raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((title) => ({ source: inputPath, title }));
}

function normalizeCacheShape(decodedCache) {
	if (!decodedCache || typeof decodedCache !== 'object' || Array.isArray(decodedCache)) {
		return {};
	}

	const keys = Object.keys(decodedCache);
	if (keys.length === 0) {
		return {};
	}

	const looksLikeSingleAccount = keys.every((key) => {
		const value = decodedCache[key];
		return value && typeof value === 'object' && !Array.isArray(value) &&
			typeof value.date === 'string' && typeof value.acquisition === 'string';
	});

	if (looksLikeSingleAccount) {
		return {
			unknown: decodedCache,
		};
	}

	return decodedCache;
}

async function loadCacheByAccount(cachePath, preferredSteamUserID = null) {
	const raw = await readFile(cachePath, 'utf8');
	const decoded = JSON.parse(raw);
	const normalized = normalizeCacheShape(decoded);
	const accounts = new Map();

	for (const [steamUserID, accountValue] of Object.entries(normalized)) {
		if (!accountValue || typeof accountValue !== 'object' || Array.isArray(accountValue)) {
			continue;
		}

		const entries = new Map();
		const targetObject = accountValue.byName || accountValue;
		for (const [licenseKey, licenseData] of Object.entries(targetObject)) {
			if (!licenseData || typeof licenseData !== 'object' || Array.isArray(licenseData)) {
				continue;
			}

			if (typeof licenseData.date !== 'string' || typeof licenseData.acquisition !== 'string') {
				continue;
			}

			entries.set(licenseKey, {
				date: licenseData.date,
				acquisition: licenseData.acquisition,
			});
		}

		accounts.set(steamUserID === 'unknown' && preferredSteamUserID ? preferredSteamUserID : steamUserID, entries);
	}

	return accounts;
}

function buildNormalizedIndex(entries) {
	const normalizedIndex = new Map();

	for (const [licenseKey, licenseData] of entries.entries()) {
		const normalized = normalizeForComparison(licenseKey);
		if (!normalizedIndex.has(normalized)) {
			normalizedIndex.set(normalized, []);
		}

		normalizedIndex.get(normalized).push({
			licenseKey,
			licenseData,
		});
	}

	return normalizedIndex;
}

function scoreSuggestions(title, entries, limit) {
	const scored = [];
	for (const [licenseKey, licenseData] of entries.entries()) {
		const score = jaccardScore(title, licenseKey);
		if (score <= 0) {
			continue;
		}

		scored.push({
			licenseKey,
			licenseData,
			score,
		});
	}

	scored.sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}

		return left.licenseKey.length - right.licenseKey.length;
	});

	return scored.slice(0, limit);
}

function createAccountReport(steamUserID, entries, captures, maxSuggestions) {
	const normalizedIndex = buildNormalizedIndex(entries);
	const captureReports = [];
	const matchedCacheKeys = new Set();
	let exactMatches = 0;
	let fuzzyMatches = 0;
	let normalizedOnlyMatches = 0;
	let misses = 0;

	for (const capture of captures) {
		const exactMatch = entries.get(capture.title);
		const runtimeMatch = exactMatch
			? {
					licenseKey: capture.title,
					data: exactMatch,
					matchType: 'exact',
				}
			: fuzzyMatchLicenseName(entries, capture.title);
		const normalizedTitle = normalizeForComparison(capture.title);
		const normalizedCandidates = normalizedIndex.get(normalizedTitle) ?? [];
		const suggestions = scoreSuggestions(capture.title, entries, maxSuggestions);

		let status = 'miss';
		let matchedKey = null;

		if (runtimeMatch) {
			status = runtimeMatch.matchType;
			matchedKey = runtimeMatch.licenseKey;
			matchedCacheKeys.add(runtimeMatch.licenseKey);
			if (runtimeMatch.matchType === 'exact') {
				exactMatches += 1;
			} else {
				fuzzyMatches += 1;
			}
		} else if (normalizedCandidates.length === 1) {
			status = 'normalized-only';
			matchedKey = normalizedCandidates[0].licenseKey;
			matchedCacheKeys.add(normalizedCandidates[0].licenseKey);
			normalizedOnlyMatches += 1;
		} else if (normalizedCandidates.length > 1) {
			status = 'normalized-ambiguous';
		} else {
			misses += 1;
		}

		captureReports.push({
			source: capture.source,
			title: capture.title,
			status,
			matchedKey,
			normalizedTitle,
			normalizedCandidates: normalizedCandidates.map((candidate) => candidate.licenseKey),
			suggestions: suggestions.map((candidate) => ({
				licenseKey: candidate.licenseKey,
				score: Number(candidate.score.toFixed(3)),
			})),
		});
	}

	const unmatchedCacheEntries = [...entries.keys()]
		.filter((licenseKey) => !matchedCacheKeys.has(licenseKey))
		.sort((left, right) => left.localeCompare(right));

	return {
		steamUserID,
		totals: {
			cachedEntries: entries.size,
			capturedTitles: captures.length,
			exactMatches,
			fuzzyMatches,
			normalizedOnlyMatches,
			misses,
			unmatchedCacheEntries: unmatchedCacheEntries.length,
		},
		captures: captureReports,
		unmatchedCacheEntries,
	};
}

function printAccountReport(report) {
	console.log(`Account: ${report.steamUserID}`);
	console.log(`  cache entries: ${report.totals.cachedEntries}`);
	console.log(`  captured titles: ${report.totals.capturedTitles}`);
	console.log(`  exact matches: ${report.totals.exactMatches}`);
	console.log(`  fuzzy matches: ${report.totals.fuzzyMatches}`);
	console.log(`  normalized-only matches: ${report.totals.normalizedOnlyMatches}`);
	console.log(`  misses: ${report.totals.misses}`);
	console.log(`  unmatched cache entries: ${report.totals.unmatchedCacheEntries}`);
	console.log('');

	for (const capture of report.captures) {
		const matchText = capture.matchedKey ? ` -> ${capture.matchedKey}` : '';
		console.log(`- ${capture.title} [${capture.status}]${matchText}`);
		console.log(`  source: ${capture.source}`);

		if (capture.normalizedCandidates.length > 0) {
			console.log(`  normalized candidates: ${capture.normalizedCandidates.join(', ')}`);
		}

		if (capture.suggestions.length > 0) {
			const formatted = capture.suggestions
				.map((candidate) => `${candidate.licenseKey} (${candidate.score})`)
				.join(', ');
			console.log(`  suggestions: ${formatted}`);
		}
	}

	if (report.unmatchedCacheEntries.length > 0) {
		console.log('');
		console.log('Unmatched cache entries:');
		for (const licenseKey of report.unmatchedCacheEntries) {
			console.log(`- ${licenseKey}`);
		}
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const cacheByAccount = await loadCacheByAccount(options.cachePath, options.steamUserID);

	if (cacheByAccount.size === 0) {
		throw new Error(`No cache entries found in ${options.cachePath}`);
	}

	const snapshots = [];
	if (options.inputPaths.length === 0) {
		throw new Error('Provide at least one --dom, --titles, --input, or positional path');
	}

	for (const inputPath of options.inputPaths) {
		snapshots.push(...await readSnapshotTitles(inputPath));
	}

	if (snapshots.length === 0) {
		throw new Error('No titles could be extracted from the provided inputs');
	}

	const reports = [];
	if (options.steamUserID) {
		const accountEntries = cacheByAccount.get(options.steamUserID);
		if (!accountEntries) {
			throw new Error(`Steam user ID ${options.steamUserID} was not found in ${options.cachePath}`);
		}

		reports.push(createAccountReport(options.steamUserID, accountEntries, snapshots, options.maxSuggestions));
	} else {
		for (const [steamUserID, entries] of cacheByAccount.entries()) {
			reports.push(createAccountReport(steamUserID, entries, snapshots, options.maxSuggestions));
		}
	}

	if (options.json) {
		console.log(JSON.stringify({ cachePath: options.cachePath, reports }, null, 2));
		return;
	}

	console.log(`Cache file: ${options.cachePath}`);
	console.log(`Snapshots: ${snapshots.length}`);
	console.log('');

	for (let index = 0; index < reports.length; index += 1) {
		if (index > 0) {
			console.log('');
		}
		printAccountReport(reports[index]);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
