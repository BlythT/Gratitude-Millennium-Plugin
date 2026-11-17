// Reads the Steam client's license list the way Gratitude does (frontend/injection/clientlicenses.ts):
// runs the console command licenses_print in SharedJSContext and collects its console output until
// it has been quiet for half a second. Shared by the badge sweep and the license list check.
//
// evaluate(expression) must evaluate in Steam's SharedJSContext and return the value.
// Returns the raw output, or null when it didn't start or finish within timeoutMs.

const QUIET_MS = 500;

export async function captureLicensesPrint(evaluate, timeoutMs = 15000) {
	await evaluate(`(() => {
		window.__gratitudeLicenseCapture?.reg?.unregister?.();
		const st = window.__gratitudeLicenseCapture = { chunks: [], started: false, last: Date.now(), reg: null };
		st.reg = window.SteamClient?.Console?.RegisterForSpewOutput?.((s) => {
			const text = typeof s === 'string' ? s : s?.spew;
			if (typeof text !== 'string' || s?.spew_type === 'input') return;
			if (!st.started && !text.includes('License packageID')) return;
			st.started = true; st.chunks.push(text); st.last = Date.now();
		});
		window.SteamClient?.Console?.ExecCommand?.('licenses_print');
		return true;
	})()`);
	const deadline = Date.now() + timeoutMs;
	try {
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 200));
			const done = await evaluate(`!!window.__gratitudeLicenseCapture && window.__gratitudeLicenseCapture.started && Date.now() - window.__gratitudeLicenseCapture.last >= ${QUIET_MS}`);
			if (done) return await evaluate("window.__gratitudeLicenseCapture.chunks.join('')");
		}
		return null;
	} finally {
		await Promise.resolve(evaluate('window.__gratitudeLicenseCapture?.reg?.unregister?.(); delete window.__gratitudeLicenseCapture; true')).catch(() => {});
	}
}
