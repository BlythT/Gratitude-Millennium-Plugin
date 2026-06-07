export function decodeHtmlEntities(value) {
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

export function normalizeForComparison(value) {
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
	// We use a static list instead of a generic Roman numeral parser to prevent converting
	// standard letters/words (like 'M' for 1000, 'C' for 100, or 'D' for 500) into digits.
	const romanMap = {
		'xx': '20', 'xix': '19', 'xviii': '18', 'xvii': '17', 'xvi': '16', 'xv': '15',
		'xiv': '14', 'xiii': '13', 'xii': '12', 'xi': '11', 'x': '10', 'ix': '9',
		'viii': '8', 'vii': '7', 'vi': '6', 'v': '5', 'iv': '4', 'iii': '3', 'ii': '2',
		'i': '1'
	};
	
	// Convert Roman numerals to Arabic digits when surrounded by word boundaries.
	normalized = normalized.replace(/\b(xx|xix|xviii|xvii|xvi|xv|xiv|xiii|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/g, (match, p1, offset, str) => {
		// Safeguard: Do not convert the letter 'i' if it starts the entire string
		// (e.g., "I, Gladiator" or "I am Bread") to avoid transforming it into "1".
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
// Keys must be normalized for fast lookups, while values must match the exact strings
// that appear in the user's Steam licenses.
const TITLE_ALIASES = new Map([
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
// Since the Map might be mutated (though in practice a fresh Map is returned on
// each load), we track the Map's size on construction. If the size changes,
// the index will be rebuilt to avoid serving stale data.
const matcherIndices = new WeakMap();

class FuzzyMatcherIndex {
	constructor(map) {
		this.map = map;
		this.size = map.size;
		this.normalizedExactIndex = new Map();
		this.tokenIndex = new Map();

		for (const [key, value] of map.entries()) {
			const normalizedKey = normalizeForComparison(key);
			if (!normalizedKey) continue;

			if (!this.normalizedExactIndex.has(normalizedKey)) {
				this.normalizedExactIndex.set(normalizedKey, []);
			}
			this.normalizedExactIndex.get(normalizedKey).push({ key, value });

			const tokens = normalizedKey.split(' ').filter(Boolean);
			for (const token of tokens) {
				if (!this.tokenIndex.has(token)) {
					this.tokenIndex.set(token, new Set());
				}
				this.tokenIndex.get(token).add(key);
			}
		}
	}
}

function getOrBuildIndex(map) {
	let index = matcherIndices.get(map);
	if (!index || index.size !== map.size) {
		index = new FuzzyMatcherIndex(map);
		matcherIndices.set(map, index);
	}
	return index;
}

function stripSuffixes(gameName, patterns) {
	const candidates = new Set();
	for (const pattern of patterns) {
		const stripped = gameName.replace(pattern, '').trim();
		if (stripped && stripped !== gameName) {
			candidates.add(stripped);
		}
	}
	return [...candidates];
}

export function fuzzyMatchLicenseName(
	map,
	gameName,
	allowQualifierStripping = true,
	allowYearQualifierStripping = true,
	allowAliasLookup = true,
) {
	if (map.has(gameName)) {
		return {
			licenseKey: gameName,
			data: map.get(gameName),
			matchType: 'exact',
		};
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
					return {
						licenseKey: target,
						data: map.get(target),
						matchType: 'alias-exact',
					};
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

	const candidateKeys = new Set();
	for (const token of tokens) {
		const keys = index.tokenIndex.get(token);
		if (keys) {
			for (const key of keys) {
				candidateKeys.add(key);
			}
		}
	}

	const checkCandidateSubset = (allowReverse = true) => {
		let bestForward = null;
		let bestReverse = null;
		for (const key of candidateKeys) {
			const normalizedKey = normalizeForComparison(key);
			if (!normalizedKey) continue;

			if (normalizedKey.startsWith(normalizedGameName) || normalizedKey.endsWith(normalizedGameName)) {
				// Reject forward match if the remaining portion (suffix or prefix) starts/ends with a digit
				// - this almost always indicates a sequel (e.g. "Sanctum" vs "Sanctum 2").
				if (normalizedKey.startsWith(normalizedGameName)) {
					const suffix = normalizedKey.slice(normalizedGameName.length).trimStart();
					if (/^\d/.test(suffix)) continue;
				} else {
					const prefix = normalizedKey.slice(0, normalizedKey.length - normalizedGameName.length).trimEnd();
					if (/\d$/.test(prefix)) continue;
				}

				if (!bestForward || key.length < bestForward.licenseKey.length) {
					bestForward = {
						licenseKey: key,
						data: map.get(key),
						matchType: 'normalized-forward-prefix',
					};
				}
			}

			if (allowReverse && (normalizedGameName.startsWith(normalizedKey) || normalizedGameName.endsWith(normalizedKey))) {
				if (!bestReverse || key.length > bestReverse.licenseKey.length) {
					bestReverse = {
						licenseKey: key,
						data: map.get(key),
						matchType: 'normalized-reverse-prefix',
					};
				}
			}
		}
		// Prefer forward matches (key contains entire query) over reverse (query contains entire key)
		return bestForward || bestReverse;
	};

	const prefixMatch = checkCandidateSubset(true);
	if (prefixMatch) {
		return prefixMatch;
	}

	if (tokens.length > 1) {
		const scored = [];
		const querySet = new Set(tokens);

		const extractNumbers = (str) => {
			const matches = str.match(/\b\d+\b/g);
			return matches ? new Set(matches) : new Set();
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
			return {
				licenseKey: best.key,
				data: map.get(best.key),
				matchType: 'fuzzy-token',
			};
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
			const strippedCandidateKeys = new Set();
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
					return {
						licenseKey: key,
						data: map.get(key),
						matchType: 'stripped-normalized-forward-prefix',
					};
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
			const strippedCandidateKeys = new Set();
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
					return {
						licenseKey: key,
						data: map.get(key),
						matchType: 'year-stripped-normalized-forward-prefix',
					};
				}
			}
		}
	}

	return null;
}
