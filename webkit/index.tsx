import { callable } from '@steambrew/webkit';
import { log, logError } from './lib/logger';
import { getCurrentAccountID } from './lib/steamid';

const setGameLicenseData = callable<[{ licenseData: string; steamUserID: string }], void>('SetGameLicenseData');

type LicenseData = {
	date: string;
	item: string;
	acquisition: string;
};

export default async function WebkitMain() {
	log("WebkitMain loaded");

	const html = await fetchSteamLicenses();
	if (!html) {
		log("Failed to fetch Steam Licenses.");
		return;
	}

	log("Fetched Steam Licenses HTML");

	const parser = new DOMParser();
	const doc = parser.parseFromString(html, 'text/html');
	const table = doc.querySelector('table.account_table');
	if (!table) {
		log("account_table not found in the HTML.");
		return;
	}

	log("Found account_table");

	const steamUserID = getCurrentAccountID();
	if (!steamUserID || steamUserID === '') {
		logError("Could not get current Steam User ID.");
		return;
	}

	const data = parseLicenseTable(table);
	log("Parsed License Data:", data);
	log("Sending data to backend...");

	try {
		await setGameLicenseData({ licenseData: JSON.stringify(data), steamUserID });
		log("Data sent to backend successfully.");
	} catch (error) {
		logError("Error sending data to backend:", error);
	}
}

// Fetch https://store.steampowered.com/account/licenses/
async function fetchSteamLicenses(retries = 3, delayMs = 1000): Promise<string | null> {
	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetch('https://store.steampowered.com/account/licenses/', {
				credentials: 'include',
			});
			if (response.ok) return await response.text();
			logError('Failed to fetch licenses:', response.status);
		} catch (error) {
			logError(`Fetch attempt ${i + 1} failed:`, error);
		}
		if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
	}
	return null;
}

function parseLicenseTable(table: Element) {
	const licenses: LicenseData[] = [];
	const rows = table.querySelectorAll('tbody tr');
	rows.forEach((row) => {
		const dateCell = row.querySelector('.license_date_col');
		const itemCell = row.children[1];
		const acquisitionCell = row.querySelector('.license_acquisition_col');

		if (dateCell && itemCell && acquisitionCell) {
			const date = standardizeDate(dateCell.textContent?.trim() || '');
			// Complimentary items have a "Remove" link and extra newlines that need to be cleaned
			const item = itemCell.textContent
				?.split('\n')
				.map(line => line.trim())
				.filter(line => line && line !== 'Remove')
				.join(' ') || '';
			const acquisition = acquisitionCell.textContent?.trim() || '';
			licenses.push({ date, item, acquisition });
		}
	});
	return licenses;
}

// Standardise date format (Last Played is Mar 5, 2025 while License Data is 5 Mar, 2025)
function standardizeDate(dateStr: string): string {
	const date = new Date(dateStr);
	if (isNaN(date.getTime())) {
		return dateStr; // Return original string if parsing fails
	}

	const day = date.getDate().toString();
	const month = date.toLocaleString('default', { month: 'short' });
	const year = date.getFullYear();
	// Use the format "Mar 5, 2025" so our dates are consistent with existing UI (e.g. Last Played tooltip).
	return `${month} ${day}, ${year}`;
}