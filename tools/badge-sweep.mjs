#!/usr/bin/env node
// Checks the Gifted badge in the running Steam client, game by game.
//
// Opens each gifted game's Library page and checks that the badge shows with the cached gift date,
// appears once, sits after Play Time, and that its icon lines up with Steam's stat icons and sits
// on the text baseline. As controls, a sample of non-gifted games and games borrowed through Family
// Sharing must show no badge.
//
// It also times how the badge renders: how many frames (and ms) after Steam's stats row appears its
// container is inserted and its content drawn. 0 frames means the badge appears in the same frame
// as the page, with no pop-in. Frames are only counted while Steam's window is being drawn (not
// minimised or fully covered); otherwise only milliseconds are reported and pop-in isn't checked.
//
// Pages are opened with Steam's own navigator, so the Steam window isn't focused and you can keep
// typing elsewhere while it runs. Only the desktop Library is checked, not Big Picture mode.
//
// Needs Node 22 or later (for its built-in WebSocket), and Steam running with Gratitude installed
// and CEF remote debugging enabled: create an empty `.cef-enable-remote-debugging` file in the Steam
// folder before launching Steam (Steam deletes it on startup). DevTools is then at
// http://127.0.0.1:8080. Close any DevTools window attached to Steam first: an attached target
// can't be connected to.
//
// Usage: npm run test:badges -- --cache "<Steam>/millennium/plugins/gratitude/backend/gratitude_cache.json"
//   --account <id>     Steam account ID in the cache (default: the only one in it)
//   --only <ids>       Comma-separated app IDs to check instead of every gifted game (no controls)
//   --controls <n>     Non-gifted and borrowed games to check for no badge (default 5 of each)
//   --devtools <url>   CEF DevTools address (default http://127.0.0.1:8080)
//   --timeout <ms>     How long to wait for each page to open (default 15000)
//   --max-popin-frames <n>  Frames the badge may trail Steam's stats row by (default 0: same frame)
//   --json             Print results as JSON
//
// Exit codes: 0 every check passed; 1 a check failed or a page didn't open; 2 the sweep couldn't
// run (bad arguments, no Steam, nothing to check).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { SELECTORS } from '../frontend/types.ts';

const GIFT = 'Gift/Guest Pass';

const POLL_MS = 30;
const EMPTY_GRACE_MS = 250;
const SETTLE_TIMEOUT_MS = 2500;
const NAV_ATTEMPT_MS = 3000;
const EVALUATE_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 5000;
// The timing observer in Steam's window stops itself after this, even if the sweep dies
const TIMING_SELF_STOP_MS = 30000;

class UsageError extends Error {}

function parseArgs(argv) {
	const options = {
		cachePath: path.resolve('backend/gratitude_cache.json'),
		account: null,
		only: null,
		controls: 5,
		devtools: 'http://127.0.0.1:8080',
		timeoutMs: 15000,
		maxPopinFrames: 0,
		json: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = () => {
			const v = argv[++i];
			if (v === undefined || v.startsWith('--')) throw new UsageError(`${arg} needs a value`);
			return v;
		};
		const count = () => {
			const v = value();
			if (!/^\d+$/.test(v)) throw new UsageError(`${arg} must be a whole number, not "${v}"`);
			return Number(v);
		};
		if (arg === '--cache') options.cachePath = path.resolve(value());
		else if (arg === '--account') options.account = value();
		else if (arg === '--only') {
			options.only = value().split(',').map((s) => s.trim()).filter(Boolean);
			const bad = options.only.find((id) => !/^\d+$/.test(id));
			if (bad || !options.only.length) throw new UsageError(`--only takes comma-separated app IDs, not "${bad ?? ''}"`);
		}
		else if (arg === '--controls') options.controls = count();
		else if (arg === '--devtools') options.devtools = value();
		else if (arg === '--timeout') options.timeoutMs = count();
		else if (arg === '--max-popin-frames') options.maxPopinFrames = count();
		else if (arg === '--json') options.json = true;
		else throw new UsageError(`Unknown argument: ${arg}`);
	}
	return options;
}

const withTimeout = (promise, ms, message) => Promise.race([
	promise,
	new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
]);

// One DevTools connection per page target, reused for every evaluation
async function connect(target) {
	if (!target.webSocketDebuggerUrl) {
		throw new Error(`Steam's "${target.title}" page can't be connected to. Close any DevTools window attached to Steam and run again.`);
	}
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await withTimeout(new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = () => reject(new Error(`Could not connect to ${target.title}`));
	}), CONNECT_TIMEOUT_MS, `Connecting to ${target.title} timed out`);
	let nextId = 0;
	const pending = new Map();
	ws.onmessage = (event) => {
		const message = JSON.parse(event.data);
		pending.get(message.id)?.(message);
		pending.delete(message.id);
	};
	return {
		async evaluate(expression) {
			const id = ++nextId;
			const reply = await new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`Steam didn't answer within ${EVALUATE_TIMEOUT_MS} ms (${target.title})`));
				}, EVALUATE_TIMEOUT_MS);
				pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
				ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
			});
			const result = reply.result?.result;
			if (reply.result?.exceptionDetails || result?.subtype === 'error') {
				throw new Error(result?.description ?? JSON.stringify(reply.result?.exceptionDetails));
			}
			return result?.value;
		},
		close: () => ws.close(),
	};
}

async function findTargets(devtools) {
	let list;
	try {
		const response = await fetch(`${devtools}/json/list`, { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
		list = await response.json();
	} catch {
		throw new Error(`No DevTools at ${devtools}. Launch Steam with .cef-enable-remote-debugging in the Steam folder.`);
	}
	const shared = list.find((t) => t.title === 'SharedJSContext');
	const main = list.find((t) => t.type === 'page' && t.title === 'Steam');
	if (!shared || !main) {
		throw new Error("Steam's SharedJSContext or main window was not found. Is the Steam window open?");
	}
	return { shared, main };
}

// Page-side helpers shared by the probe and the timing observer. A game's page is identified by
// the icon next to its title. Stats rows that existed before the current navigation are recorded
// in window.__gratitudeSweepOldRows and ignored, so a badge left from the previous game can't pass
// as the new game's. String.raw keeps the page script's backslashes (\n, \d) as written.
const PAGE_HELPERS = String.raw`
	const sel = ${JSON.stringify(SELECTORS.standard)};
	const last = (selector) => { const all = document.querySelectorAll(selector); return all[all.length - 1] || null; };
	const openAppId = () => {
		const src = last(sel.gameName)?.parentElement?.querySelector('img[src]')?.getAttribute('src') || '';
		return (src.match(/\/(?:apps|assets)\/(\d+)\//i) || [])[1] || null;
	};
	const freshRow = () => {
		const old = window.__gratitudeSweepOldRows;
		const rows = [...document.querySelectorAll(sel.tooltipContainer)].filter((row) => !old?.has(row));
		return rows[rows.length - 1] || null;
	};
`;

// Runs in the Library window: reports the open game and everything the checks need about its badge
const PAGE_PROBE = String.raw`(() => {
	${PAGE_HELPERS}
	const round = (n) => Math.round(n * 10) / 10;
	const row = freshRow();
	const containers = row ? [...row.querySelectorAll('#injection-gifted-badge')] : [];
	const badge = containers.find((b) => b.innerText.trim()) || containers[0] || null;
	const children = row ? [...row.children] : [];
	const firstLine = (el) => (el.innerText || '').split('\n')[0].trim().toUpperCase();
	const playtime = children.find((el) => el.matches(sel.playtimeTooltip));
	const achievements = children.find((el) => firstLine(el) === 'ACHIEVEMENTS');
	const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.height ? [round(b.top), round(b.bottom)] : null; };
	const shapeBottom = (svg) => {
		const rs = svg ? [...svg.querySelectorAll('path, circle, rect, polygon')].filter((p) => p.getAttribute('fill') !== 'none').map((p) => p.getBoundingClientRect()).filter((b) => b.height) : [];
		return rs.length ? round(Math.max(...rs.map((b) => b.bottom))) : null;
	};
	const baseline = (el) => {
		if (!el) return null;
		const marker = document.createElement('span');
		marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
		el.appendChild(marker);
		const y = marker.getBoundingClientRect().bottom;
		marker.remove();
		return round(y);
	};
	const textLines = badge ? [...badge.querySelectorAll('div')].filter((d) => !d.children.length && d.textContent.trim()) : [];
	const badgeSvg = badge?.querySelector('svg') || null;
	return JSON.stringify({
		name: (last(sel.gameName)?.textContent || '').trim(),
		appId: openAppId(),
		freshRow: !!row,
		injected: containers.length > 0,
		badgeCount: [...document.querySelectorAll('#injection-gifted-badge')].filter((b) => b.innerText.trim()).length,
		badgeText: badge ? badge.innerText.replace(/\s+/g, ' ').trim() : '',
		hasPlaytime: !!playtime,
		badgeFollowsPlaytime: !!playtime && playtime.nextElementSibling === badge,
		iconBox: box(badgeSvg),
		achievementsIconBox: box(achievements?.querySelector('svg')),
		iconBottom: shapeBottom(badgeSvg),
		textBaseline: baseline(textLines[1]),
	});
})()`;

// Navigates the Library without bringing the Steam window to the front, so the sweep can run
// while you type in another window. window.open("steam://nav/...") would steal keyboard focus.
const navigate = (route) => `(() => {
	const main = window.SteamUIStore?.WindowStore?.MainWindowInstance;
	if (typeof main?.NavigateWithoutChangingFocus !== 'function') return false;
	main.NavigateWithoutChangingFocus(${JSON.stringify(route)});
	return true;
})()`;

// Armed in the Library window before each navigation. Records the stats rows already on the page
// (they belong to the previous game), then a MutationObserver notes when the target game's new
// stats row, Gratitude's container in it, and the badge's content first appear, each with
// performance.now() and a count of the window's animation frames. Gratitude's own observer was
// registered first, so when it renders synchronously its badge is already there when this one runs.
// It also watches src changes, in case Steam reuses the header icon instead of replacing it.
const ARM_TIMING = (appId) => String.raw`(() => {
	window.__gratitudeSweepTiming?.stop();
	${PAGE_HELPERS}
	window.__gratitudeSweepOldRows = new WeakSet(document.querySelectorAll(sel.tooltipContainer));
	const target = ${JSON.stringify(String(appId))};
	const st = { frames: 0, framesAvailable: false, row: null, container: null, badge: null };
	let running = true;
	const tick = () => { if (!running) return; st.frames++; st.framesAvailable = true; requestAnimationFrame(tick); };
	requestAnimationFrame(tick);
	const mark = () => ({ t: performance.now(), frame: st.frames });
	const check = () => {
		if (openAppId() !== target) return;
		const row = freshRow();
		if (!row) return;
		st.row ??= mark();
		const container = row.querySelector('#injection-gifted-badge');
		if (container) st.container ??= mark();
		if (container && container.innerText.trim()) st.badge ??= mark();
	};
	const observer = new MutationObserver(check);
	observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });
	const stop = () => { running = false; observer.disconnect(); };
	setTimeout(stop, ${TIMING_SELF_STOP_MS});
	window.__gratitudeSweepTiming = { st, stop };
	return true;
})()`;

const READ_TIMING = `(() => {
	const timing = window.__gratitudeSweepTiming;
	if (!timing) return 'null';
	timing.stop();
	const { st } = timing;
	const gap = (a, b) => (a && b ? { ms: Math.round((b.t - a.t) * 10) / 10, frames: b.frame - a.frame } : null);
	return JSON.stringify({
		framesAvailable: st.framesAvailable,
		rowToContainer: gap(st.row, st.container),
		containerToBadge: gap(st.container, st.badge),
		rowToBadge: gap(st.row, st.badge),
	});
})()`;

const STOP_TIMING = 'window.__gratitudeSweepTiming?.stop(); true';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probePage(main) {
	return JSON.parse(await main.evaluate(PAGE_PROBE));
}

// Navigates and waits until the page shows appId with a stats row it rendered for this visit.
// A navigation that doesn't take is sent again until the deadline.
async function openPage(shared, main, appId, deadline) {
	let page = null;
	while (Date.now() < deadline) {
		if (!(await shared.evaluate(navigate(`/library/app/${appId}`)))) {
			throw new Error("Steam's navigator (SteamUIStore.WindowStore.MainWindowInstance) is unavailable.");
		}
		const attemptDeadline = Math.min(deadline, Date.now() + NAV_ATTEMPT_MS);
		while (Date.now() < attemptDeadline) {
			page = await probePage(main);
			if (page.appId === String(appId) && page.freshRow) return { opened: true, page };
			await sleep(POLL_MS);
		}
	}
	return { opened: false, page };
}

// Opens a game's page, waits until its badge has rendered, and probes it. Polling runs in Node:
// timers inside a background Steam window are throttled to as little as once a minute. A gifted
// game finishes as soon as its date shows; a game with no badge finishes once Gratitude's
// container has been on the page for EMPTY_GRACE_MS and is still empty (the badge renders within a
// frame of its container).
async function openAndProbe(shared, main, appId, expectDate, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	// Already showing this game: go to the Library home first, so the game's page renders anew and
	// both the checks and the timing see this visit, not an earlier one
	if ((await probePage(main)).appId === String(appId)) {
		await shared.evaluate(navigate('/library/home'));
		const leaveDeadline = Math.min(deadline, Date.now() + NAV_ATTEMPT_MS);
		while (Date.now() < leaveDeadline && (await probePage(main)).appId === String(appId)) await sleep(POLL_MS);
	}

	await main.evaluate(ARM_TIMING(appId));
	try {
		const { opened, page: openedPage } = await openPage(shared, main, appId, deadline);
		if (!opened) return { opened, page: openedPage, timing: null };

		let page = openedPage;
		const settleDeadline = Date.now() + SETTLE_TIMEOUT_MS;
		let emptySince = null;
		while (Date.now() < settleDeadline) {
			if (expectDate !== null && page.badgeText.includes(expectDate) && page.iconBox) break;
			if (expectDate === null && page.badgeText) break;
			if (expectDate === null && page.injected) {
				emptySince ??= Date.now();
				if (Date.now() - emptySince >= EMPTY_GRACE_MS) break;
			}
			await sleep(POLL_MS);
			page = await probePage(main);
		}
		const timing = JSON.parse(await main.evaluate(READ_TIMING));
		return { opened, page, timing };
	} finally {
		// Never leave the observer and frame loop running in Steam's window
		await main.evaluate(STOP_TIMING).catch(() => {});
	}
}

// "same frame", "+2 frames, 35ms", or "35ms" when frames couldn't be counted
function describeTiming(timing) {
	const gap = timing?.rowToBadge;
	if (!gap) return '';
	if (!timing.framesAvailable) return `${gap.ms}ms`;
	return gap.frames === 0 ? `same frame, ${gap.ms}ms` : `+${gap.frames} frame${gap.frames === 1 ? '' : 's'}, ${gap.ms}ms`;
}

const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

function checkGifted(page, license, timing, maxPopinFrames) {
	const problems = [];
	const gap = timing?.rowToBadge;
	if (gap && timing.framesAvailable && gap.frames > maxPopinFrames) {
		const parts = [timing.rowToContainer && `container +${timing.rowToContainer.frames}f`, timing.containerToBadge && `render +${timing.containerToBadge.frames}f`].filter(Boolean);
		problems.push(`popped in ${gap.frames} frame${gap.frames === 1 ? '' : 's'} (${gap.ms}ms) after the stats row (${parts.join(', ')})`);
	}
	if (page.badgeCount !== 1) problems.push(`${page.badgeCount} badges shown`);
	if (!/gifted/i.test(page.badgeText)) problems.push(`no Gifted badge (shows "${page.badgeText || 'nothing'}")`);
	else if (!page.badgeText.includes(license.date)) problems.push(`date "${page.badgeText}" doesn't match ${license.date}`);
	if (page.hasPlaytime && !page.badgeFollowsPlaytime) problems.push('not right after Play Time');
	if (page.achievementsIconBox && page.iconBox
		&& !(close(page.iconBox[0], page.achievementsIconBox[0], 0.5) && close(page.iconBox[1], page.achievementsIconBox[1], 0.5))) {
		problems.push(`icon box ${page.iconBox.join('-')} differs from Achievements ${page.achievementsIconBox.join('-')}`);
	}
	if (page.iconBottom !== null && page.textBaseline !== null && !close(page.iconBottom, page.textBaseline, 1.5)) {
		problems.push(`icon bottom ${page.iconBottom} is off the text baseline ${page.textBaseline}`);
	}
	return problems;
}

function checkNoBadge(page) {
	return page.badgeText ? [`shows a badge: "${page.badgeText}"`] : [];
}

// One line on how the badges rendered across the run, so pop-in regressions stand out
function renderSummary(results) {
	const timed = results.filter((r) => r.kind === 'gifted' && r.timing?.rowToBadge);
	if (!timed.length) return 'Render timing: no gifted badges were timed.';
	const ms = timed.map((r) => r.timing.rowToBadge.ms).sort((a, b) => a - b);
	const median = ms[Math.floor(ms.length / 2)];
	const max = ms[ms.length - 1];
	const framed = timed.filter((r) => r.timing.framesAvailable);
	let frames = 'frames not counted (Steam\'s window wasn\'t being drawn), so pop-in wasn\'t checked';
	if (framed.length) {
		const sameFrame = framed.filter((r) => r.timing.rowToBadge.frames === 0).length;
		const maxFrames = Math.max(...framed.map((r) => r.timing.rowToBadge.frames));
		frames = `${sameFrame}/${framed.length} in the same frame as the stats row (max +${maxFrames} frames)`;
		if (framed.length < timed.length) frames += `; ${timed.length - framed.length} not frame-counted`;
	}
	return `Render timing: ${frames}; median ${median}ms, max ${max}ms after the row.`;
}

async function sweep(options, account, byAppId, shared, main) {
	const borrowed = JSON.parse(await shared.evaluate(`JSON.stringify((window.appStore?.allApps || [])
		.filter((a) => a.app_type === 1 && a.owner_account_id && String(a.owner_account_id) !== ${JSON.stringify(account)})
		.map((a) => a.appid))`));
	const borrowedSet = new Set(borrowed.map(String));

	const cases = [];
	const giftedIds = Object.keys(byAppId).filter((id) => byAppId[id].acquisition === GIFT);
	if (!options.only && !giftedIds.length) {
		throw new UsageError(`No gifted games with an App ID in the cache for account ${account}; nothing to check.`);
	}
	for (const id of options.only ?? giftedIds) {
		if (byAppId[id]?.acquisition === GIFT) cases.push({ appId: id, kind: 'gifted', license: byAppId[id] });
		else cases.push({ appId: id, kind: borrowedSet.has(id) ? 'borrowed' : 'not gifted' });
	}
	if (!options.only && options.controls > 0) {
		const notGifted = Object.keys(byAppId).filter((id) => byAppId[id].acquisition !== GIFT && !borrowedSet.has(id));
		for (const id of notGifted.slice(0, options.controls)) cases.push({ appId: id, kind: 'not gifted' });
		for (const id of borrowed.slice(0, options.controls)) cases.push({ appId: String(id), kind: 'borrowed' });
	}

	const results = [];
	for (const testCase of cases) {
		const { opened, page, timing } = await openAndProbe(shared, main, testCase.appId, testCase.license?.date ?? null, options.timeoutMs);
		let status;
		let problems = [];
		if (!opened) {
			status = 'SKIP';
			problems = [`page didn't open (showing "${page?.name || 'nothing'}")`];
		} else {
			problems = testCase.kind === 'gifted' ? checkGifted(page, testCase.license, timing, options.maxPopinFrames) : checkNoBadge(page);
			status = problems.length ? 'FAIL' : 'PASS';
		}
		const result = { ...testCase, name: page?.name || testCase.license?.name || '', status, problems, page, timing };
		results.push(result);
		if (!options.json) {
			const render = testCase.kind === 'gifted' ? describeTiming(timing) : '';
			const label = `${status}  ${testCase.kind.padEnd(10)} ${String(testCase.appId).padEnd(8)} ${result.name}${render ? `  [${render}]` : ''}`;
			console.log(problems.length ? `${label}\n        ${problems.join('; ')}` : label);
		}
	}

	const count = (status) => results.filter((r) => r.status === status).length;
	if (options.json) {
		console.log(JSON.stringify({ account, results }, null, 2));
	} else {
		console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('SKIP')} skipped (${results.length} games; ${giftedIds.length} gifted in cache)`);
		console.log(renderSummary(results));
		if (count('SKIP')) console.log('Skipped pages count as a failure: those games were not checked.');
	}
	return count('FAIL') || count('SKIP') ? 1 : 0;
}

// Set once connected, so Ctrl+C can stop the timing observer in Steam's window before exiting
let mainConnection = null;

async function run() {
	if (typeof WebSocket !== 'function') {
		throw new UsageError(`The badge sweep needs Node 22 or later (this is ${process.version}).`);
	}
	const options = parseArgs(process.argv.slice(2));

	const cache = JSON.parse(await readFile(options.cachePath, 'utf8'));
	const accounts = Object.keys(cache);
	const account = options.account ?? (accounts.length === 1 ? accounts[0] : null);
	if (!account || !cache[account]) {
		throw new UsageError(`Pick an account with --account (cache has: ${accounts.join(', ') || 'none'})`);
	}
	const byAppId = cache[account].byAppId ?? {};

	const { shared: sharedTarget, main: mainTarget } = await findTargets(options.devtools);
	const shared = await connect(sharedTarget);
	const main = await connect(mainTarget);
	mainConnection = main;
	try {
		return await sweep(options, account, byAppId, shared, main);
	} finally {
		await main.evaluate(STOP_TIMING).catch(() => {});
		mainConnection = null;
		// Open connections would keep Node running after an error
		shared.close();
		main.close();
	}
}

process.on('SIGINT', () => {
	const stop = mainConnection ? mainConnection.evaluate(STOP_TIMING).catch(() => {}) : Promise.resolve();
	withTimeout(stop, 1000, '').catch(() => {}).finally(() => process.exit(130));
});

run().then(
	(code) => process.exit(code),
	(error) => {
		console.error(error.message);
		process.exit(2);
	},
);
