export interface LicenseData {
	date: string;
	acquisition: string;
}

export interface MatchResult {
	licenseKey: string;
	data: LicenseData;
	matchType: string;
}

export function decodeHtmlEntities(value: string | number): string {
	return String(value)
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

export function normalizeForComparison(value: string | number): string {
	let normalized = decodeHtmlEntities(value)
		.toLowerCase()
		// Replace unicode Trademark (™), Registered (®), and Copyright (©) symbols with spaces
		.replace(/[\u2122\u00ae\u00a9]/g, ' ')
		// Decompose combined characters (e.g., diacritics/accents like 'é' to 'e' + combining accent)
		.normalize('NFKD')
		// Strip the combining accent marks (unicode range U+0300 to U+036F)
		.replace(/[\u0300-\u036f]/g, '')
		// Replace parenthesized symbol abbreviations like (tm), (r), (c) with spaces
		.replace(/\((tm|r|c)\)/g, ' ')
		// Replace standalone word-boundary symbol abbreviations like "tm" or "r" with spaces
		.replace(/\b(tm|r|c)\b/g, ' ')
		// Standardize ampersands to "and" to align "X & Y" with "X and Y"
		.replace(/&/g, ' and ')
		// Strip all remaining non-alphanumeric characters (punctuation, special chars) leaving spaces
		.replace(/[^a-z0-9]+/g, ' ')
		// Strip common English articles to allow matching with or without them (e.g., "The Witcher" -> "Witcher")
		.replace(/\b(the|a|an)\b/g, ' ');

	// Static map of Roman numerals (1 to 20) to their Arabic equivalents.
	const romanMap: Record<string, string> = {
		'xx': '20', 'xix': '19', 'xviii': '18', 'xvii': '17', 'xvi': '16', 'xv': '15',
		'xiv': '14', 'xiii': '13', 'xii': '12', 'xi': '11', 'x': '10', 'ix': '9',
		'viii': '8', 'vii': '7', 'vi': '6', 'v': '5', 'iv': '4', 'iii': '3', 'ii': '2',
		'i': '1'
	};
	
	// Convert Roman numerals to Arabic digits when surrounded by word boundaries.
	normalized = normalized.replace(/\b(xx|xix|xviii|xvii|xvi|xv|xiv|xiii|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/g, (match, _p1, offset, str) => {
		// Safeguard: Do not convert the letter 'i' if it starts the entire string
		if (match === 'i' && str.slice(0, offset).trim() === '') {
			return match;
		}
		return romanMap[match];
	});

	// Collapse multiple spaces into a single space and trim trailing/leading whitespace
	return normalized
		.replace(/\s+/g, ' ')
		.trim();
}

// Maps normalized game names to lists of their raw license/display names.
const TITLE_ALIASES = new Map<string, string[]>([
	['counter strike 2', ['Counter-Strike: Global Offensive']],
	['warhammer 40 000 dawn of war soulstorm', ['Dawn of War: Soulstorm (NA/AU)']],
	['totally accurate battlegrounds', ['TABG']],
	['orion prelude', ['Orion Dino Horde Gift']],
	['teleglitch die more edition', ['Teleglitch: Base Game']],
]);

const QUALIFIER_SUFFIX_PATTERNS = [
	/\s*[-:]?\s*(?:steam\s+)?(?:special|definitive|legacy|extended|anniversary|collector'?s?|goty|game\s+of\s+the\s+year|complete|collection|multiplayer|single\s*player|deluxe)(?:\s+edition)?$/i,
	/\s*[-:]?\s*(?:public test|test server|staging branch|unstable|testing grounds|playtest)$/i,
	/\s*[-:]?\s*(?:alpha|beta|demo)$/i,
	/\s+edition$/i,
];

const YEAR_QUALIFIER_SUFFIX_PATTERNS = [
	/\s*\((?:[^)]*\d{4}[^)]*)\)\s*$/i,
	/\s*\((?:classic|row|ro w|ww|na|au|eu|us)\)\s*$/i,
];

// Cache of FuzzyMatcherIndex instances keyed by the source Map object identity.
const matcherIndices = new WeakMap<Map<string, LicenseData>, FuzzyMatcherIndex>();

class FuzzyMatcherIndex {
	map: Map<string, LicenseData>;
	size: number;
	normalizedExactIndex: Map<string, { key: string; value: LicenseData }[]>;
	tokenIndex: Map<string, Set<string>>;

	constructor(map: Map<string, LicenseData>) {
		this.map = map;
		this.size = map.size;
		this.normalizedExactIndex = new Map();
		this.tokenIndex = new Map();

		for (const [key, value] of map.entries()) {
			const normalizedKey = normalizeForComparison(key);
			if (!normalizedKey) continue;

			let list = this.normalizedExactIndex.get(normalizedKey);
			if (!list) {
				list = [];
				this.normalizedExactIndex.set(normalizedKey, list);
			}
			list.push({ key, value });

			const tokens = normalizedKey.split(' ').filter(Boolean);
			for (const token of tokens) {
				let tokenKeys = this.tokenIndex.get(token);
				if (!tokenKeys) {
					tokenKeys = new Set();
					this.tokenIndex.set(token, tokenKeys);
				}
				tokenKeys.add(key);
			}
		}
	}
}

function getOrBuildIndex(map: Map<string, LicenseData>): FuzzyMatcherIndex {
	let index = matcherIndices.get(map);
	if (!index || index.size !== map.size) {
		index = new FuzzyMatcherIndex(map);
		matcherIndices.set(map, index);
	}
	return index;
}

function stripSuffixes(gameName: string, patterns: RegExp[]): string[] {
	const candidates = new Set<string>();
	for (const pattern of patterns) {
		const stripped = gameName.replace(pattern, '').trim();
		if (stripped && stripped !== gameName) {
			candidates.add(stripped);
		}
	}
	return [...candidates];
}

export function fuzzyMatchLicenseName(
	map: Map<string, LicenseData>,
	gameName: string,
	allowQualifierStripping = true,
	allowYearQualifierStripping = true,
	allowAliasLookup = true,
): MatchResult | null {
	if (map.has(gameName)) {
		const data = map.get(gameName);
		if (data) {
			return {
				licenseKey: gameName,
				data,
				matchType: 'exact',
			};
		}
	}

	const index = getOrBuildIndex(map);
	const normalizedGameName = normalizeForComparison(gameName);
	if (!normalizedGameName) {
		return null;
	}

	const exactCandidates = index.normalizedExactIndex.get(normalizedGameName);
	if (exactCandidates && exactCandidates.length > 0) {
		const best = exactCandidates.reduce((prev, curr) => curr.key.length < prev.key.length ? curr : prev);
		return {
			licenseKey: best.key,
			data: best.value,
			matchType: 'normalized-exact',
		};
	}

	if (allowAliasLookup) {
		const aliasTargets = TITLE_ALIASES.get(normalizedGameName);
		if (aliasTargets) {
			for (const target of aliasTargets) {
				if (map.has(target)) {
					const data = map.get(target);
					if (data) {
						return {
							licenseKey: target,
							data,
							matchType: 'alias-exact',
						};
					}
				}
				const targetNormalized = normalizeForComparison(target);
				if (targetNormalized) {
					const targetMatch = index.normalizedExactIndex.get(targetNormalized);
					if (targetMatch && targetMatch.length > 0) {
						const best = targetMatch.reduce((prev, curr) => curr.key.length < prev.key.length ? curr : prev);
						return {
							licenseKey: best.key,
							data: best.value,
							matchType: 'alias-normalized-exact',
						};
					}
				}
			}
		}
	}

	const tokens = normalizedGameName.split(' ').filter(Boolean);
	if (tokens.length === 0) {
		return null;
	}

	const candidateKeys = new Set<string>();
	for (const token of tokens) {
		const keys = index.tokenIndex.get(token);
		if (keys) {
			for (const key of keys) {
				candidateKeys.add(key);
			}
		}
	}

	const checkCandidateSubset = (allowReverse = true): MatchResult | null => {
		let bestForward: MatchResult | null = null;
		let bestReverse: MatchResult | null = null;
		for (const key of candidateKeys) {
			const normalizedKey = normalizeForComparison(key);
			if (!normalizedKey) continue;

			if (normalizedKey.startsWith(normalizedGameName) || normalizedKey.endsWith(normalizedGameName)) {
				// Reject forward match if the remaining portion (suffix or prefix) starts/ends with a digit
				if (normalizedKey.startsWith(normalizedGameName)) {
					const suffix = normalizedKey.slice(normalizedGameName.length).trimStart();
					if (/^\d/.test(suffix)) continue;
				} else {
					const prefix = normalizedKey.slice(0, normalizedKey.length - normalizedGameName.length).trimEnd();
					if (/\d$/.test(prefix)) continue;
				}

				const data = map.get(key);
				if (data && (!bestForward || key.length < bestForward.licenseKey.length)) {
					bestForward = {
						licenseKey: key,
						data,
						matchType: 'normalized-forward-prefix',
					};
				}
			}

			if (allowReverse && (normalizedGameName.startsWith(normalizedKey) || normalizedGameName.endsWith(normalizedKey))) {
				const data = map.get(key);
				if (data && (!bestReverse || key.length > bestReverse.licenseKey.length)) {
					bestReverse = {
						licenseKey: key,
						data,
						matchType: 'normalized-reverse-prefix',
					};
				}
			}
		}
		return bestForward || bestReverse;
	};

	const prefixMatch = checkCandidateSubset(true);
	if (prefixMatch) {
		return prefixMatch;
	}

	if (tokens.length > 1) {
		const scored: { key: string; jaccard: number }[] = [];
		const querySet = new Set(tokens);

		const extractNumbers = (str: string) => {
			const matches = str.match(/\b\d+\b/g);
			return matches ? new Set(matches) : new Set<string>();
		};
		const numbersGame = extractNumbers(normalizedGameName);

		for (const key of candidateKeys) {
			const normalizedKey = normalizeForComparison(key);
			const numbersCand = extractNumbers(normalizedKey);

			let numbersMatch = true;
			if (numbersGame.size !== numbersCand.size) {
				numbersMatch = false;
			} else {
				for (const num of numbersGame) {
					if (!numbersCand.has(num)) {
						numbersMatch = false;
						break;
					}
				}
			}

			if (!numbersMatch) continue;

			const candidateTokens = normalizedKey.split(' ').filter(Boolean);
			const candidateSet = new Set(candidateTokens);

			let intersection = 0;
			for (const t of querySet) {
				if (candidateSet.has(t)) {
					intersection += 1;
				}
			}

			const union = new Set([...querySet, ...candidateSet]).size;
			const jaccard = union === 0 ? 0 : intersection / union;

			scored.push({ key, jaccard });
		}

		const THRESHOLD = 0.55;
		const eligible = scored.filter(item => item.jaccard >= THRESHOLD);
		if (eligible.length > 0) {
			eligible.sort((a, b) => {
				if (b.jaccard !== a.jaccard) {
					return b.jaccard - a.jaccard;
				}
				return a.key.length - b.key.length;
			});

			const best = eligible[0];
			const data = map.get(best.key);
			if (data) {
				return {
					licenseKey: best.key,
					data,
					matchType: 'fuzzy-token',
				};
			}
		}
	}

	if (allowQualifierStripping) {
		const strippedCandidates = stripSuffixes(gameName, QUALIFIER_SUFFIX_PATTERNS);
		for (const candidate of strippedCandidates) {
			const normalizedCand = normalizeForComparison(candidate);
			if (!normalizedCand) continue;

			const candMatch = index.normalizedExactIndex.get(normalizedCand);
			if (candMatch && candMatch.length > 0) {
				const best = candMatch.reduce((prev, curr) => curr.key.length < prev.key.length ? curr : prev);
				return {
					licenseKey: best.key,
					data: best.value,
					matchType: 'stripped-normalized-exact',
				};
			}

			const strippedTokens = normalizedCand.split(' ').filter(Boolean);
			const strippedCandidateKeys = new Set<string>();
			for (const token of strippedTokens) {
				const keys = index.tokenIndex.get(token);
				if (keys) {
					for (const key of keys) {
						strippedCandidateKeys.add(key);
					}
				}
			}

			for (const key of strippedCandidateKeys) {
				const normalizedKey = normalizeForComparison(key);
				if (normalizedKey && (normalizedKey.startsWith(normalizedCand) || normalizedKey.endsWith(normalizedCand))) {
					const data = map.get(key);
					if (data) {
						return {
							licenseKey: key,
							data,
							matchType: 'stripped-normalized-forward-prefix',
						};
					}
				}
			}
		}
	}

	if (allowYearQualifierStripping) {
		const strippedCandidates = stripSuffixes(gameName, YEAR_QUALIFIER_SUFFIX_PATTERNS);
		for (const candidate of strippedCandidates) {
			const normalizedCand = normalizeForComparison(candidate);
			if (!normalizedCand) continue;

			const candMatch = index.normalizedExactIndex.get(normalizedCand);
			if (candMatch && candMatch.length > 0) {
				const best = candMatch.reduce((prev, curr) => curr.key.length < prev.key.length ? curr : prev);
				return {
					licenseKey: best.key,
					data: best.value,
					matchType: 'year-stripped-normalized-exact',
				};
			}

			const strippedTokens = normalizedCand.split(' ').filter(Boolean);
			const strippedCandidateKeys = new Set<string>();
			for (const token of strippedTokens) {
				const keys = index.tokenIndex.get(token);
				if (keys) {
					for (const key of keys) {
						strippedCandidateKeys.add(key);
					}
				}
			}

			for (const key of strippedCandidateKeys) {
				const normalizedKey = normalizeForComparison(key);
				if (normalizedKey && (normalizedKey.startsWith(normalizedCand) || normalizedKey.endsWith(normalizedCand))) {
					const data = map.get(key);
					if (data) {
						return {
							licenseKey: key,
							data,
							matchType: 'year-stripped-normalized-forward-prefix',
						};
					}
				}
			}
		}
	}

	return null;
}
