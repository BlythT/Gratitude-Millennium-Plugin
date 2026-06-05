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
	return decodeHtmlEntities(value)
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[\u2122\u00ae\u00a9]/g, ' ')
		.replace(/\((tm|r|c)\)/gi, ' ')
		.replace(/\b(tm|r|c)\b/gi, ' ')
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

const TITLE_ALIASES = new Map([
	// Franchise / rename cases
	['counter strike 2', ['Counter-Strike: Global Offensive']],
	['dark souls iii', ['DARK SOULS III']],
	['serious sam 3 bfe', ['Serious Sam 3 Standard']],
	['warhammer 40 000 dawn of war soulstorm', ['Dawn of War: Soulstorm (NA/AU)']],

	// Edition / branch / release-tag cases
	['super people testing grounds', ['SUPER PEOPLE Playtest for store signup']],
	['titan quest anniversary edition', ['Titan Quest Retail']],

	// Shortform / shorthand cases
	['tabg', ['TABG']],
]);

const QUALIFIER_SUFFIX_PATTERNS = [
	/\s*[-:]\s*(?:steam\s+)?(?:special|definitive|legacy|extended|anniversary|collector'?s?)\s+edition$/i,
	/\s*[-:]\s*(?:public test|test server|staging branch|unstable|testing grounds|playtest)$/i,
	/\s*[-:]\s*(?:alpha|beta|demo)$/i,
	/\s+edition$/i,
];

const YEAR_QUALIFIER_SUFFIX_PATTERNS = [
	/\s*\((?:[^)]*\d{4}[^)]*)\)\s*$/i,
	/\s*\((?:classic|row|ro w|ww|na|au|eu|us)\)\s*$/i,
];

function findBestNormalizedMatch(map, normalizedGameName) {
	let normalizedExactMatch = null;
	let normalizedForwardMatch = null;
	let normalizedReverseMatch = null;

	for (const [key, value] of map.entries()) {
		const normalizedKey = normalizeForComparison(key);
		if (!normalizedKey) {
			continue;
		}

		if (normalizedKey === normalizedGameName) {
			if (!normalizedExactMatch || key.length < normalizedExactMatch.key.length) {
				normalizedExactMatch = { key, value };
			}
			continue;
		}

		if (normalizedKey.startsWith(normalizedGameName)) {
			if (!normalizedForwardMatch || key.length < normalizedForwardMatch.key.length) {
				normalizedForwardMatch = { key, value };
			}
			continue;
		}

		if (normalizedGameName.startsWith(normalizedKey)) {
			if (!normalizedReverseMatch || key.length > normalizedReverseMatch.key.length) {
				normalizedReverseMatch = { key, value };
			}
		}
	}

	if (normalizedExactMatch) {
		return { ...normalizedExactMatch, matchType: 'normalized-exact' };
	}

	if (normalizedReverseMatch) {
		return { ...normalizedReverseMatch, matchType: 'normalized-reverse-prefix' };
	}

	if (normalizedForwardMatch) {
		return { ...normalizedForwardMatch, matchType: 'normalized-forward-prefix' };
	}

	return null;
}

function findBestRawPrefixMatch(map, gameName) {
	let forwardMatch = null;
	let reverseMatch = null;

	for (const [key, value] of map.entries()) {
		if (key.startsWith(gameName)) {
			if (!forwardMatch || key.length < forwardMatch.key.length) {
				forwardMatch = { key, value };
			}
			continue;
		}

		if (gameName.startsWith(key)) {
			if (!reverseMatch || key.length > reverseMatch.key.length) {
				reverseMatch = { key, value };
			}
		}
	}

	if (reverseMatch) {
		return { ...reverseMatch, matchType: 'reverse-prefix' };
	}

	if (forwardMatch) {
		return { ...forwardMatch, matchType: 'forward-prefix' };
	}

	return null;
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

function tryFallbackCandidates(map, candidates, matchTypePrefix, allowQualifierStripping, allowYearQualifierStripping, allowAliasLookup) {
	for (const candidate of candidates) {
		const match = fuzzyMatchLicenseName(
			map,
			candidate,
			allowQualifierStripping,
			allowYearQualifierStripping,
			allowAliasLookup,
		);
		if (match) {
			return {
				licenseKey: match.licenseKey,
				data: match.data,
				matchType: `${matchTypePrefix}${match.matchType}`,
			};
		}
	}

	return null;
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

	const normalizedGameName = normalizeForComparison(gameName);
	if (normalizedGameName) {
		const normalizedMatch = findBestNormalizedMatch(map, normalizedGameName);
		if (normalizedMatch) {
			return {
				licenseKey: normalizedMatch.key,
				data: normalizedMatch.value,
				matchType: normalizedMatch.matchType,
			};
		}
	}

	const rawPrefixMatch = findBestRawPrefixMatch(map, gameName);
	if (rawPrefixMatch) {
		return {
			licenseKey: rawPrefixMatch.key,
			data: rawPrefixMatch.value,
			matchType: rawPrefixMatch.matchType,
		};
	}

	if (allowQualifierStripping) {
		const strippedMatch = tryFallbackCandidates(
			map,
			stripSuffixes(gameName, QUALIFIER_SUFFIX_PATTERNS),
			'stripped-',
			false,
			false,
			false,
		);
		if (strippedMatch) {
			return strippedMatch;
		}
	}

	if (allowYearQualifierStripping) {
		const strippedMatch = tryFallbackCandidates(
			map,
			stripSuffixes(gameName, YEAR_QUALIFIER_SUFFIX_PATTERNS),
			'year-stripped-',
			false,
			false,
			false,
		);
		if (strippedMatch) {
			return strippedMatch;
		}
	}

	if (allowAliasLookup) {
		const aliasTargets = TITLE_ALIASES.get(normalizeForComparison(gameName));
		if (aliasTargets) {
			const aliasMatch = tryFallbackCandidates(
				map,
				aliasTargets,
				'alias-',
				false,
				false,
				false,
			);
			if (aliasMatch) {
				return aliasMatch;
			}
		}
	}

	return null;
}
