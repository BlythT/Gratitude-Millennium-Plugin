#!/usr/bin/env node
// Checks that the Steam client's license list (the console command licenses_print, which
// Gratitude reads to tell gifts apart by App ID) still has the format Gratitude parses. It's
// console output, not an API, so a Steam update could change it; run this after one.
//
// Prints how many licenses were read, their states and payment methods, how many games they say
// were gifted, and any sign the format changed.
//
// Needs Node 22+ and Steam running with CEF remote debugging (an empty
// `.cef-enable-remote-debugging` file in the Steam folder before launching Steam).
//
// Usage: npm run test:license-list [-- --devtools <url>] [--json]
//
// Exit codes: 0 the list reads as expected; 1 it looks changed; 2 the check couldn't run.

import process from 'node:process';
import { checkLicensesPrintFormat, GIFT_METHOD } from '../lib/client-licenses.ts';
import { captureLicensesPrint } from './license-list-capture.mjs';

const args = process.argv.slice(2);
const devtools = args.includes('--devtools') ? args[args.indexOf('--devtools') + 1] : 'http://127.0.0.1:8080';
const asJson = args.includes('--json');

async function evaluator() {
	let list;
	try {
		list = await (await fetch(`${devtools}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
	} catch {
		throw new Error(`No DevTools at ${devtools}. Launch Steam with .cef-enable-remote-debugging in the Steam folder.`);
	}
	const shared = list.find((t) => t.title === 'SharedJSContext');
	if (!shared?.webSocketDebuggerUrl) throw new Error("Steam's SharedJSContext was not found. Is Steam running?");
	const ws = new WebSocket(shared.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('Could not connect to SharedJSContext')); });
	let nextId = 0;
	const pending = new Map();
	ws.onmessage = (event) => { const m = JSON.parse(event.data); pending.get(m.id)?.(m); pending.delete(m.id); };
	const evaluate = (expression) => new Promise((resolve, reject) => {
		const id = ++nextId;
		const timer = setTimeout(() => { pending.delete(id); reject(new Error("Steam didn't answer within 5s")); }, 5000);
		pending.set(id, (m) => {
			clearTimeout(timer);
			if (m.result?.exceptionDetails) reject(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300)));
			else resolve(m.result?.result?.value);
		});
		ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
	});
	return { evaluate, close: () => ws.close() };
}

async function run() {
	if (typeof WebSocket !== 'function') throw new Error(`Needs Node 22 or later (this is ${process.version}).`);
	const { evaluate, close } = await evaluator();
	try {
		const text = await captureLicensesPrint(evaluate);
		if (text === null) {
			console.log("licenses_print printed nothing within 15s. Steam's console command may have changed or been removed.");
			return 1;
		}
		const check = checkLicensesPrintFormat(text);
		const own = check.licenses.filter((l) => !l.borrowed);
		const giftedApps = new Set(own.filter((l) => l.active && l.method === GIFT_METHOD).flatMap((l) => l.appIds));
		const truncated = check.licenses.filter((l) => l.appsTruncated).length;
		if (asJson) {
			console.log(JSON.stringify({ blocks: check.blocks, parsed: check.licenses.length, states: check.states, methods: check.methods, giftedApps: giftedApps.size, truncated, problems: check.problems }, null, 2));
		} else {
			console.log(`Read ${check.licenses.length} of ${check.blocks} licenses (${own.length} own, ${check.licenses.length - own.length} borrowed through Family Sharing).`);
			console.log(`States: ${Object.entries(check.states).map(([k, v]) => `${k} ${v}`).join(', ')}`);
			console.log(`Payment methods: ${Object.entries(check.methods).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
			console.log(`Gift licenses ("${GIFT_METHOD}", active) cover ${giftedApps.size} App IDs. ${truncated} app lists were cut off at Steam's limit.`);
			if (!check.methods[GIFT_METHOD]) console.log(`Note: no "${GIFT_METHOD}" licenses. Fine for an account with no gifts; otherwise the method's name may have changed.`);
			console.log(check.problems.length ? `\nThe format looks changed:\n${check.problems.map((p) => `  - ${p}`).join('\n')}` : '\nThe license list reads as expected.');
		}
		return check.problems.length ? 1 : 0;
	} finally {
		close();
	}
}

run().then(
	(code) => process.exit(code),
	(error) => {
		console.error(error.message);
		process.exit(2);
	},
);
