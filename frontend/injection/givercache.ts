import { callable } from '@steambrew/client';
import { log, logError } from '../../lib/logger';
import type { GiverData } from '../types';

const getAllGiverData = callable<[{ steamUserID: string }], string>('GetAllGiverData');
const upsertGiverData = callable<[{ payloadJson: string; steamUserID: string }], boolean>('UpsertGiverData');
const deleteGiverData = callable<[{ steamUserID: string; licenseKey: string }], boolean>('DeleteGiverData');

interface UserGiverCache {
	entries: Map<string, GiverData>;
	isLoaded: boolean;
}

class GiverCache {
	private cache: Map<string, UserGiverCache> = new Map();

	async getAll(steamUserID: string, forceReload = false): Promise<Map<string, GiverData>> {
		const cached = this.cache.get(steamUserID);
		if (cached && cached.isLoaded && !forceReload) {
			log(`Using cached giver data for user ${steamUserID} (${cached.entries.size} entries)`);
			return cached.entries;
		}

		try {
			log(`Loading giver data from backend for user ${steamUserID} (forceReload=${forceReload})`);
			const giverJson = await getAllGiverData({ steamUserID });
			const giverObject: Record<string, GiverData> = giverJson ? JSON.parse(giverJson) : {};
			const entries = new Map<string, GiverData>(Object.entries(giverObject));

			this.cache.set(steamUserID, {
				entries,
				isLoaded: true,
			});

			log(`Loaded ${entries.size} giver records for user ${steamUserID}`);
			return entries;
		} catch (error) {
			logError(`Error loading giver data for user ${steamUserID}:`, error);
			return new Map();
		}
	}

	getAllSync(steamUserID: string): Map<string, GiverData> | null {
		const cached = this.cache.get(steamUserID);
		return cached && cached.isLoaded ? cached.entries : null;
	}

	getEntrySync(steamUserID: string, licenseKey: string, fallbackLicenseKey?: string): GiverData | null {
		const entries = this.getAllSync(steamUserID);
		if (!entries) return null;
		let giver = entries.get(licenseKey) ?? null;
		if (!giver && fallbackLicenseKey) {
			giver = entries.get(fallbackLicenseKey) ?? null;
		}
		log(
			`Synchronous giver lookup for user ${steamUserID} and license ${licenseKey} (fallback: ${fallbackLicenseKey}): ${giver ? 'hit' : 'miss'}`,
		);
		return giver;
	}

	async upsert(steamUserID: string, giverData: Omit<GiverData, 'createdAt' | 'updatedAt'>): Promise<boolean> {
		try {
			log(`Upserting giver data for user ${steamUserID} and license ${giverData.licenseKey}`);
			const success = await upsertGiverData({
				payloadJson: JSON.stringify(giverData),
				steamUserID,
			});

			if (success) {
				log(`Upsert succeeded for user ${steamUserID} and license ${giverData.licenseKey}, reloading cache`);
				await this.getAll(steamUserID, true);
			}

			return success;
		} catch (error) {
			logError(`Error upserting giver data for user ${steamUserID}:`, error);
			return false;
		}
	}

	async remove(steamUserID: string, licenseKey: string): Promise<boolean> {
		try {
			log(`Deleting giver data for user ${steamUserID} and license ${licenseKey}`);
			const success = await deleteGiverData({ steamUserID, licenseKey });
			log(`Delete backend call completed for user ${steamUserID} and license ${licenseKey}: success=${success}`);

			if (success) {
				const cached = this.cache.get(steamUserID);
				if (cached?.entries.has(licenseKey)) {
					log(`Removing giver entry for license ${licenseKey} from frontend cache before reload`);
					cached.entries.delete(licenseKey);
				} else {
					log(`No existing frontend cache entry found for license ${licenseKey} before reload`);
				}

				log(`Reloading giver cache from backend after delete for user ${steamUserID}`);
				await this.getAll(steamUserID, true);
				const reloaded = this.cache.get(steamUserID)?.entries.has(licenseKey) ?? false;
				log(`Post-delete reload check for license ${licenseKey}: stillPresent=${reloaded}`);
				log(`Deleted giver data for user ${steamUserID} and license ${licenseKey}`);
			}

			return success;
		} catch (error) {
			logError(`Error deleting giver data for user ${steamUserID}:`, error);
			return false;
		}
	}

	invalidate(steamUserID: string): void {
		log(`Invalidating frontend giver cache for user ${steamUserID}`);
		this.cache.delete(steamUserID);
	}
}

export const giverCache = new GiverCache();
