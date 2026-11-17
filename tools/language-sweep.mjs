#!/usr/bin/env node
// Runs the badge sweep with the Steam client in other languages, to catch problems that only show
// in a translated client: translated game titles, labels and window titles, and longer labels in
// the stats row.
//
// For each language it restarts Steam with `-language <name>`, checks the client really is in
// that language, and runs the badge sweep on the desktop Library and in Big Picture. Steam saves
// the language it was launched with, so the runner first reads your language and, at the end,
// restarts Steam in it again. Restarting Steam closes any game you have running, and Big Picture
// opens full screen during each run.
//
// Needs everything the badge sweep needs (Node 22+, Gratitude installed), with Steam already
// running with DevTools, so the runner can read your language. It creates the
// `.cef-enable-remote-debugging` file itself before each launch.
//
// Usage: npm run test:badges:languages -- --cache "<Steam>/millennium/plugins/gratitude/backend/gratitude_cache.json"
//   --languages <list>  Comma-separated Steam language names (default italian,german,japanese,russian)
//   --steam <path>      steam.exe (default: read from the registry on Windows)
//   --desktop-only      Skip the Big Picture sweeps
//   --restore <name>    The language to leave Steam in (default: the language Steam has now)
// Any other arguments (--cache, --controls, --only, ...) are passed to each badge sweep.
//
// Exit codes: 0 every sweep passed; 1 a sweep failed; 2 the run couldn't start or Steam didn't
// come up in a language.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEVTOOLS = 'http://127.0.0.1:8080';
const DEFAULT_LANGUAGES = ['italian', 'german', 'japanese', 'russian'];
const STOP_TIMEOUT_MS = 90_000;
const START_TIMEOUT_MS = 180_000;
// Steam keeps loading the Library for a while after its window appears
const SETTLE_MS = 15_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
	const options = { languages: DEFAULT_LANGUAGES, steam: null, desktopOnly: false, restore: null, sweepArgs: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--languages') options.languages = argv[++i].split(',').map((l) => l.trim()).filter(Boolean);
		else if (arg === '--steam') options.steam = argv[++i];
		else if (arg === '--desktop-only') options.desktopOnly = true;
		else if (arg === '--restore') options.restore = argv[++i];
		else options.sweepArgs.push(arg);
	}
	return options;
}

function findSteamExe() {
	if (process.platform !== 'win32') throw new Error('Pass --steam <path to the Steam executable>.');
	const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamExe'], { encoding: 'utf8' });
	const exe = out.match(/SteamExe\s+REG_SZ\s+(.+)/)?.[1]?.trim();
	if (!exe) throw new Error("Couldn't find Steam in the registry. Pass --steam <path to steam.exe>.");
	return path.normalize(exe);
}

function steamRunning() {
	try {
		if (process.platform === 'win32') {
			return execFileSync('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], { encoding: 'utf8' }).toLowerCase().includes('steam.exe');
		}
		execFileSync('pgrep', ['-x', 'steam']);
		return true;
	} catch {
		return false;
	}
}

async function devtoolsList() {
	try {
		const response = await fetch(`${DEVTOOLS}/json/list`, { signal: AbortSignal.timeout(2000) });
		return await response.json();
	} catch {
		return null;
	}
}

// Evaluates an expression in Steam's SharedJSContext, or returns undefined when it can't
async function evaluateShared(expression) {
	const shared = (await devtoolsList())?.find((t) => t.title === 'SharedJSContext');
	if (!shared?.webSocketDebuggerUrl) return undefined;
	const ws = new WebSocket(shared.webSocketDebuggerUrl);
	try {
		await Promise.race([new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }), sleep(3000).then(() => { throw new Error('connect'); })]);
		const reply = await Promise.race([
			new Promise((resolve) => {
				ws.onmessage = (event) => { const m = JSON.parse(event.data); if (m.id === 1) resolve(m); };
				ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
			}),
			sleep(5000).then(() => null),
		]);
		return reply?.result?.result?.value;
	} catch {
		return undefined;
	} finally {
		ws.close();
	}
}

async function stopSteam(steamExe) {
	if (!steamRunning()) return;
	spawn(steamExe, ['-shutdown'], { detached: true, stdio: 'ignore' }).unref();
	const deadline = Date.now() + STOP_TIMEOUT_MS;
	while (steamRunning()) {
		if (Date.now() > deadline) throw new Error(`Steam didn't close within ${STOP_TIMEOUT_MS / 1000}s.`);
		await sleep(500);
	}
}

// Starts Steam with remote debugging (and a language, if given) and waits until its main window
// is up in that language. Returns the language Steam reports.
async function startSteam(steamExe, language) {
	fs.writeFileSync(path.join(path.dirname(steamExe), '.cef-enable-remote-debugging'), '');
	spawn(steamExe, language ? ['-language', language] : [], { detached: true, stdio: 'ignore' }).unref();
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await sleep(2000);
		const ready = await evaluateShared(`!!window.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup?.document?.body`);
		if (ready) {
			await sleep(SETTLE_MS);
			return evaluateShared('window.SteamClient.Settings.GetCurrentLanguage()');
		}
	}
	throw new Error(`Steam's window didn't open within ${START_TIMEOUT_MS / 1000}s${language ? ` in ${language}` : ''}.`);
}

function runSweep(args) {
	return new Promise((resolve) => {
		const sweep = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), 'badge-sweep.mjs');
		const child = spawn(process.execPath, ['--import', 'tsx', sweep, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
		let output = '';
		child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
		child.on('close', (code) => resolve({ code, summary: output.trim().split('\n').find((l) => / passed, \d+ failed/.test(l)) ?? '' }));
	});
}

async function run() {
	const options = parseArgs(process.argv.slice(2));
	const steamExe = options.steam ?? findSteamExe();
	if (!fs.existsSync(steamExe)) throw new Error(`No Steam at ${steamExe}`);

	// Steam keeps the language it was last launched with, so note the user's to put it back
	const original = options.restore ?? await evaluateShared('window.SteamClient.Settings.GetCurrentLanguage()');
	if (!original) {
		throw new Error("Couldn't read Steam's current language. Start Steam with DevTools, or pass --restore <language>.");
	}
	console.log(`Steam is in ${original}; it will be restarted in ${original} at the end.`);

	const results = [];
	try {
		for (const language of options.languages) {
			console.log(`\n=== ${language}: restarting Steam`);
			await stopSteam(steamExe);
			const reported = await startSteam(steamExe, language);
			if (reported !== language) {
				results.push({ language, mode: '-', code: 2, summary: `Steam reported "${reported ?? 'nothing'}" instead` });
				continue;
			}
			for (const mode of options.desktopOnly ? ['desktop'] : ['desktop', 'big picture']) {
				console.log(`\n--- ${language}, ${mode}`);
				const { code, summary } = await runSweep([...options.sweepArgs, ...(mode === 'big picture' ? ['--big-picture'] : [])]);
				results.push({ language, mode, code, summary });
			}
		}
	} finally {
		console.log(`\n=== restarting Steam in ${original}`);
		await stopSteam(steamExe).catch((e) => console.error(e.message));
		const back = await startSteam(steamExe, original).catch((e) => (console.error(e.message), undefined));
		if (back === original) console.log(`Steam is back in ${back}.`);
		else console.error(`Steam came back in ${back ?? 'an unknown language'}, not ${original}. Restart it with -language ${original}.`);
	}

	console.log('\nLanguage sweep results:');
	for (const r of results) console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.language.padEnd(10)} ${r.mode.padEnd(12)} ${r.summary}`);
	if (results.some((r) => r.code === 2)) return 2;
	return results.every((r) => r.code === 0) ? 0 : 1;
}

run().then(
	(code) => process.exit(code),
	(error) => {
		console.error(error.message);
		process.exit(2);
	},
);
