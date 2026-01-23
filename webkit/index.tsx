import { callable } from '@steambrew/webkit';
import { log, logError } from './lib/logger';

const setGameLicenseData = callable<[{ licenseData: string }], void>('SetGameLicenseData');

type LicenseData = {
    date: string;
    item: string;
    acquisition: string;
};

export default async function WebkitMain() {
    log("WebkitMain loaded");

    async function warmupSteamStore() {
        try {
            log("Warming up Steam Store session...");

            const response = await fetch("https://store.steampowered.com/account/", {
                credentials: "include",
                headers: {
                    "User-Agent": navigator.userAgent
                }
            });

            if (!response.ok) {
                logError("Store warmup failed:", response.status);
            } else {
                log("Steam Store session initialized.");
            }
        } catch (err) {
            logError("Error warming up Steam Store:", err);
        }
    }

    // ✅ Warm up the store BEFORE fetching licenses
    await warmupSteamStore();

    fetchSteamLicenses().then((html) => {
        if (html) {
            log("Fetched Steam Licenses HTML");

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const table = doc.querySelector('table.account_table');
            if (table) {
                log("Found account_table")
                const data = parseLicenseTable(table);

                log("Parsed License Data:", data);
                log("Sending data to backend...");
                setGameLicenseData({ licenseData: JSON.stringify(data) }).then(() => {
                    log("Data sent to backend successfully.");
                }).catch((error) => {
                    logError("Error sending data to backend:", error);
                });
            } else {
                log("account_table not found in the HTML.");
            }
        } else {
            log("Failed to fetch Steam Licenses.");
        }
    });
}

// Fetch https://store.steampowered.com/account/licenses/
async function fetchSteamLicenses(): Promise<string | null> {
    try {
        const response = await fetch('https://store.steampowered.com/account/licenses/', {
            credentials: 'include',
            headers: {
                'User-Agent': navigator.userAgent
            }
        });

        if (!response.ok) {
            logError('Failed to fetch licenses:', response.status);
            return null;
        }

        const html = await response.text();
        return html;
    } catch (error) {
        logError('Error fetching Steam licenses:', error);
        return null;
    }
}

function parseLicenseTable(table: Element) {
    const licenses: LicenseData[] = [];
    const rows = table.querySelectorAll('tr');
    rows.forEach((row, index) => {
        if (index === 0) return;
        const dateCell = row.querySelector('.license_date_col');
        const itemCell = row.children[1];
        const acquisitionCell = row.querySelector('.license_acquisition_col');
        
        if (dateCell && itemCell && acquisitionCell) {
            const date = dateCell.textContent?.trim() || '';
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
