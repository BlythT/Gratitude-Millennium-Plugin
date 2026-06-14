import { callable } from '@steambrew/client';
import { log, logError } from '../../lib/logger';
import { CacheManager } from '../../lib/framework/CacheManager';
import { isTruthy } from '../../lib/framework/truthy';
import type { GiverData } from '../types';

const getStoreData = callable<[{ steamUserID: string, storeName: string }], string>('GetStoreData');
const setStoreData = callable<[{ payloadJson: string, steamUserID: string, storeName: string }], boolean>('SetStoreData');

function validateRequiredString(value: unknown, fieldName: string): asserts value is string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${fieldName} must be a non-empty string`);
	}
}

class GiverCache {
	private manager = new CacheManager<Map<string, GiverData>>(
		'Giver',
		async (steamUserID: string) => {
			const giverJson = await getStoreData({ steamUserID, storeName: 'givers' });
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
			validateRequiredString(giverData.licenseKey, 'licenseKey');
			validateRequiredString(giverData.libraryTitle, 'libraryTitle');
			validateRequiredString(giverData.displayName, 'displayName');
			validateRequiredString(giverData.source, 'source');

			if (giverData.source !== 'manual' && giverData.source !== 'friend-cache') {
				throw new Error('source must be manual or friend-cache');
			}

			const map = await this.getAll(steamUserID);
			const existingRecord = map.get(giverData.licenseKey);
			const now = Math.floor(Date.now() / 1000);

			const normalized: GiverData = {
				licenseKey: giverData.licenseKey,
				libraryTitle: giverData.libraryTitle,
				displayName: giverData.displayName,
				source: giverData.source,
				createdAt: existingRecord ? existingRecord.createdAt : now,
				updatedAt: now,
			};

			if (typeof giverData.steamID64 === 'string' && giverData.steamID64 !== '') {
				normalized.steamID64 = giverData.steamID64;
			}

			if (typeof giverData.profileUrl === 'string' && giverData.profileUrl !== '') {
				normalized.profileUrl = giverData.profileUrl;
			}

			if (typeof giverData.notes === 'string' && giverData.notes !== '') {
				normalized.notes = giverData.notes;
			}

			// Update the map
			map.set(giverData.licenseKey, normalized);

			// Serialize and save
			const payloadObject = Object.fromEntries(map.entries());
			const success = await setStoreData({
				payloadJson: JSON.stringify(payloadObject),
				steamUserID,
				storeName: 'givers'
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
			
			const map = await this.getAll(steamUserID);
			if (!map.has(licenseKey)) {
				return true;
			}

			map.delete(licenseKey);

			const payloadObject = Object.fromEntries(map.entries());
			const success = await setStoreData({
				payloadJson: JSON.stringify(payloadObject),
				steamUserID,
				storeName: 'givers'
			});

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
