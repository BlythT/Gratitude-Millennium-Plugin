import { callable } from '@steambrew/client';
import { log, logError } from '../../lib/logger';
import { CacheManager } from '../../lib/framework/CacheManager';
import { isTruthy } from '../../lib/framework/truthy';
import type { GiverData } from '../types';

const getAllGiverData = callable<[{ steamUserID: string }], string>('GetAllGiverData');
const upsertGiverData = callable<[{ payloadJson: string; steamUserID: string }], boolean>('UpsertGiverData');
const deleteGiverData = callable<[{ steamUserID: string; licenseKey: string }], boolean>('DeleteGiverData');

class GiverCache {
	private manager = new CacheManager<Map<string, GiverData>>(
		'Giver',
		async (steamUserID: string) => {
			const giverJson = await getAllGiverData({ steamUserID });
			const giverObject: Record<string, GiverData> = giverJson ? JSON.parse(giverJson) : {};
			return new Map<string, GiverData>(Object.entries(giverObject));
		}
	);

	async getAll(steamUserID: string, forceReload = false): Promise<Map<string, GiverData>> {
		const data = await this.manager.getData(steamUserID, forceReload);
		return data ?? new Map();
	}

	getAllSync(steamUserID: string): Map<string, GiverData> | null {
		return this.manager.getDataSync(steamUserID) ?? null;
	}

	getEntrySync(steamUserID: string, licenseKey: string, fallbackLicenseKey?: string): GiverData | null {
		const entries = this.getAllSync(steamUserID);
		if (!entries) return null;
		let giver = entries.get(licenseKey) ?? null;
		if (!giver && fallbackLicenseKey) {
			giver = entries.get(fallbackLicenseKey) ?? null;
		}
		return giver;
	}

	async upsert(steamUserID: string, giverData: Omit<GiverData, 'createdAt' | 'updatedAt'>): Promise<boolean> {
		try {
			log(`Upserting giver data for user ${steamUserID} and license ${giverData.licenseKey}`);
			const success = await upsertGiverData({
				payloadJson: JSON.stringify(giverData),
				steamUserID,
			});

			if (isTruthy(success)) {
				log(`Upsert succeeded for user ${steamUserID} and license ${giverData.licenseKey}, reloading cache`);
				await this.manager.getData(steamUserID, true);
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

			if (isTruthy(success)) {
				log(`Reloading giver cache from backend after delete for user ${steamUserID}`);
				await this.manager.getData(steamUserID, true);
			}

			return success;
		} catch (error) {
			logError(`Error deleting giver data for user ${steamUserID}:`, error);
			return false;
		}
	}

	invalidate(steamUserID: string): void {
		this.manager.invalidate(steamUserID);
	}
}

export const giverCache = new GiverCache();
