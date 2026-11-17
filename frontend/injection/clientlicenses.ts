import { callable } from '@steambrew/client';
import { log, logError } from '../../lib/logger';
import { parseLicensesPrint, type ClientLicense } from '../../lib/client-licenses';

// Reads the Steam client's license list (see lib/client-licenses.ts) by running its console
// command licenses_print and collecting the output. Kept in memory only, and only read for an
// account that allowed Gratitude to read its license history, like the licenses page sync.

const hasUserConsented = callable<[{ steamUserID: string }], boolean | string>('HasUserConsented');

// The output has no end marker; it's complete once it has been quiet this long
const QUIET_MS = 500;
// Give up if it never starts or never finishes
const MAX_WAIT_MS = 15_000;
// Read again after this, so licenses added while Steam is open are picked up
const REFRESH_AFTER_MS = 10 * 60 * 1000;

interface SpewApi {
	ExecCommand?: (command: string) => void;
	RegisterForSpewOutput?: (callback: (spew: unknown) => void) => { unregister?: () => void } | undefined;
}

let licenses: ClientLicense[] | null = null;
let loadedAt = 0;
let loading: Promise<ClientLicense[] | null> | null = null;
const listeners = new Set<(licenses: ClientLicense[] | null) => void>();

export function getClientLicensesSync(): ClientLicense[] | null {
	return licenses;
}

export function observeClientLicenses(listener: (licenses: ClientLicense[] | null) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

async function captureLicensesPrint(): Promise<string | null> {
	const consoleApi = (window as unknown as { SteamClient?: { Console?: SpewApi } }).SteamClient?.Console;
	if (typeof consoleApi?.ExecCommand !== 'function' || typeof consoleApi.RegisterForSpewOutput !== 'function') {
		log("Steam's console isn't available; using the licenses page only.");
		return null;
	}

	const chunks: string[] = [];
	let started = false;
	let lastSpewAt = Date.now();
	const registration = consoleApi.RegisterForSpewOutput((spew) => {
		const entry = spew as { spew?: unknown; spew_type?: unknown } | string;
		const text = typeof entry === 'string' ? entry : entry?.spew;
		if (typeof text !== 'string' || (typeof entry === 'object' && entry?.spew_type === 'input')) return;
		// Ignore anything printed before the list starts
		if (!started && !text.includes('License packageID')) return;
		started = true;
		chunks.push(text);
		lastSpewAt = Date.now();
	});
	try {
		consoleApi.ExecCommand('licenses_print');
		const start = Date.now();
		while (Date.now() - start < MAX_WAIT_MS) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			if (started && Date.now() - lastSpewAt >= QUIET_MS) return chunks.join('');
		}
		logError(`licenses_print didn't ${started ? 'finish' : 'start'} within ${MAX_WAIT_MS / 1000}s.`);
		return null;
	} finally {
		registration?.unregister?.();
	}
}

/**
 * Reads the license list if it's missing or older than REFRESH_AFTER_MS (or force is set), for an
 * account that allowed reading its license history. Returns the licenses, or null when they
 * couldn't be read; the badge then uses the licenses page data.
 */
export function loadClientLicenses(steamUserID: string, force = false): Promise<ClientLicense[] | null> {
	if (!force && licenses && Date.now() - loadedAt < REFRESH_AFTER_MS) return Promise.resolve(licenses);
	if (loading) return loading;
	loading = (async () => {
		try {
			const consent = await hasUserConsented({ steamUserID });
			if (consent !== true && consent !== 'true') return licenses;
			const text = await captureLicensesPrint();
			const parsed = text ? parseLicensesPrint(text) : [];
			if (!parsed.length) return licenses;
			licenses = parsed;
			loadedAt = Date.now();
			log(`Read ${parsed.length} licenses from the Steam client.`);
			for (const listener of listeners) listener(licenses);
			return licenses;
		} catch (error) {
			logError('Reading the Steam client license list failed:', error);
			return licenses;
		} finally {
			loading = null;
		}
	})();
	return loading;
}
