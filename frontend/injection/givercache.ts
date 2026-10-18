import { callable } from '@steambrew/client';
import { log, logError } from '../../lib/logger';
import { maskId, safeLicenseKey } from '../../lib/log-redact';
import { CacheManager } from './CacheManager';
import { isTruthy } from '../utils/truthy';
import type { UpsertGiverResult } from '../utils/giverSave';
import type { GiverData } from '../types';

const getAllGiverData = callable<[{ steamUserID: string }], string>('GetAllGiverData');
const upsertGiverData = callable<[{ payloadJson: string; steamUserID: string }], UpsertGiverResult>('UpsertGiverData');
const deleteGiverData = callable<[{ steamUserID: string; licenseKey: string }], boolean>('DeleteGiverData');

class GiverCache {
	private manager = new CacheManager<Map<string, GiverData>>(
		'Giver',
		async (steamUserID) => {
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

	// Returns true, or the backend's error code ("size_limit", "note_too_long", ...), which isTruthy reads as a failure
	// replacesLicenseKey moves a gift from that key to giverData.licenseKey in the same backend save
	async upsert(
		steamUserID: string,
		giverData: Omit<GiverData, 'createdAt' | 'updatedAt'> & { replacesLicenseKey?: string },
	): Promise<UpsertGiverResult> {
		try {
			log(`Upserting giver data for user ${maskId(steamUserID)} and license ${safeLicenseKey(giverData.licenseKey)}`);
			const success = await upsertGiverData({
				payloadJson: JSON.stringify(giverData),
				steamUserID,
			});

			if (isTruthy(success)) {
				log(`Upsert succeeded for user ${maskId(steamUserID)} and license ${safeLicenseKey(giverData.licenseKey)}, reloading cache`);
				await this.manager.getData(steamUserID, true);
			}

			return success;
		} catch (error) {
			logError(`Error upserting giver data for user ${maskId(steamUserID)}:`, error);
			return false;
		}
	}

	async remove(steamUserID: string, licenseKey: string): Promise<boolean> {
		try {
			log(`Deleting giver data for user ${maskId(steamUserID)} and license ${safeLicenseKey(licenseKey)}`);
			const success = await deleteGiverData({ steamUserID, licenseKey });

			if (isTruthy(success)) {
				log(`Reloading giver cache from backend after delete for user ${maskId(steamUserID)}`);
				await this.manager.getData(steamUserID, true);
			}

			return success;
		} catch (error) {
			logError(`Error deleting giver data for user ${maskId(steamUserID)}:`, error);
			return false;
		}
	}

	invalidate(steamUserID: string): void {
		this.manager.invalidate(steamUserID);
	}
}

export const giverCache = new GiverCache();
