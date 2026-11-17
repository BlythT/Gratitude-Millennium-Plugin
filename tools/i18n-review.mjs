#!/usr/bin/env node
// Builds a page for reviewing every translation outside Steam: each phrase in English and in every
// language side by side, with the badge as it would read, a sample date in each language's format,
// and automatic flags for phrases worth a second look. Also prints the flags.
//
// Usage: npm run i18n:review [-- --out <file.html>]   (default: i18n-review.html in the working folder)

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { en, STEAM_LANGUAGES, TRANSLATIONS, translate, formatGiftDate } from '../lib/i18n/index.ts';

const args = process.argv.slice(2);
const out = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'i18n-review.html');

// The badge label sits in Steam's stats row next to labels like PLAY TIME; much longer and it
// crowds the row
const BADGE_LABEL_MAX = 14;
// A phrase this many times longer than the English may not fit where the English does
const LENGTH_RATIO_MAX = 2.2;
// Phrases that may reasonably stay the same as English in some languages
const SAME_AS_ENGLISH_OK = new Set(['giver.game', 'giver.notes', 'giver.edit', 'badge.label']);

const keys = Object.keys(en);
const flags = [];
for (const { code, name } of STEAM_LANGUAGES.filter((l) => l.code !== 'en')) {
	const messages = TRANSLATIONS[code] ?? {};
	for (const key of keys) {
		const text = messages[key];
		if (!text) {
			flags.push({ code, name, key, why: 'missing (shows English)' });
			continue;
		}
		if (text === en[key] && !SAME_AS_ENGLISH_OK.has(key)) flags.push({ code, name, key, why: 'same as English' });
		if (key === 'badge.label' && [...text].length > BADGE_LABEL_MAX) flags.push({ code, name, key, why: `badge label is ${[...text].length} characters` });
		if ([...text].length > en[key].length * LENGTH_RATIO_MAX && en[key].length > 12) {
			flags.push({ code, name, key, why: `${(([...text].length) / en[key].length).toFixed(1)}x the English length` });
		}
	}
}

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const flagged = new Set(flags.map((f) => `${f.code}|${f.key}`));
const sample = { date: 'Dec 22, 2012' };

const sections = STEAM_LANGUAGES.map(({ code, name, steam }) => {
	const date = formatGiftDate(sample.date, code);
	const rows = keys.map((key) => {
		const text = translate(code, key, { date, name: 'Sam', note: '…', licenses: 657, friends: 36, count: 1 });
		const english = translate('en', key, { date: sample.date, name: 'Sam', note: '…', licenses: 657, friends: 36, count: 1 });
		const mark = flagged.has(`${code}|${key}`) ? ' class="flag"' : '';
		return `<tr${mark}><td class="key">${escape(key)}</td><td>${escape(english)}</td><td lang="${code}">${escape(text)}</td></tr>`;
	}).join('');
	const label = translate(code, 'badge.label');
	return `<section id="${code}"><h2>${escape(name)} <small>${code} · steam: ${steam}</small></h2>
<div class="badge"><span class="icon">🎁</span><span><span class="label" lang="${code}">${escape(label)}</span><span class="value">${escape(date)}</span></span></div>
<table><thead><tr><th>Key</th><th>English</th><th>${escape(name)}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}).join('\n');

const flagList = flags.length
	? `<ul>${flags.map((f) => `<li><a href="#${f.code}">${escape(f.name)}</a> · <code>${escape(f.key)}</code>: ${escape(f.why)}</li>`).join('')}</ul>`
	: '<p>No automatic flags.</p>';

fs.writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gratitude translations</title><style>
:root { color-scheme: light dark; --bg: #f6f7f9; --fg: #1b1f24; --muted: #5b6573; --line: #d9dee5; --flag: #fff4cc; --badge: #1f2a37; --badge-fg: #c7d5e0; }
@media (prefers-color-scheme: dark) { :root { --bg: #14181d; --fg: #e6e9ee; --muted: #9aa5b4; --line: #2b323b; --flag: #4a3d10; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
h1 { margin: 0 0 4px; } h2 { margin: 28px 0 8px; } small { color: var(--muted); font-weight: normal; }
nav { display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 8px 0 16px; } nav a { color: inherit; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; } td, th { border-bottom: 1px solid var(--line); padding: 6px 8px; vertical-align: top; text-align: left; word-wrap: break-word; }
td.key { width: 22%; color: var(--muted); font-family: ui-monospace, monospace; font-size: 12px; } tr.flag td { background: var(--flag); }
.badge { display: inline-flex; gap: 10px; align-items: center; background: var(--badge); color: var(--badge-fg); padding: 8px 14px; border-radius: 4px; margin: 4px 0 10px; }
.badge .label { display: block; text-transform: uppercase; letter-spacing: .06em; font-size: 12px; font-weight: 600; } .badge .value { display: block; font-size: 13px; opacity: .85; }
@media (max-width: 640px) { td.key { width: 30%; } }
</style></head><body>
<h1>Gratitude translations</h1><p>${STEAM_LANGUAGES.length} languages, ${keys.length} phrases each. Highlighted rows have an automatic flag. Sample values: date ${escape(sample.date)}, name "Sam".</p>
<nav>${STEAM_LANGUAGES.map((l) => `<a href="#${l.code}">${escape(l.name)}</a>`).join('')}</nav>
<h2>Automatic flags (${flags.length})</h2>${flagList}
${sections}
</body></html>`);

console.log(`Wrote ${out}`);
console.log(flags.length ? `${flags.length} automatic flags:\n${flags.map((f) => `  ${f.code.padEnd(6)} ${f.key.padEnd(28)} ${f.why}`).join('\n')}` : 'No automatic flags.');
