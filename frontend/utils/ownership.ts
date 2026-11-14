// Family Sharing: games borrowed from another account show in the Library but are not the user's
// licenses, so they were never gifted to the user and have nothing on the licenses page.

// True when the game belongs to another account. Steam leaves owner_account_id unset on games the
// user owns and sets it to the lender's account ID on borrowed ones.
export function isBorrowed(ownerAccountId: unknown, accountId: string): boolean {
	if (ownerAccountId === undefined || ownerAccountId === null || ownerAccountId === 0 || ownerAccountId === '') {
		return false;
	}
	return String(ownerAccountId) !== accountId;
}

// The lender's account ID from Steam's app store, or undefined when the user owns the game or
// Steam's app data isn't available.
export function ownerAccountIdOf(appId: number): unknown {
	try {
		// appStore is Steam's own global in the client UI context; it isn't typed
		const appStore = (window as unknown as { appStore?: { GetAppOverviewByAppID?: (id: number) => { owner_account_id?: unknown } | null } }).appStore;
		return appStore?.GetAppOverviewByAppID?.(appId)?.owner_account_id;
	} catch {
		return undefined;
	}
}
