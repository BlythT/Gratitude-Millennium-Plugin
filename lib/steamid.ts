/**
 * Steam ID Utilities
 * Works in both main window and webkit contexts
 */

import { log } from './logger';

// SteamID64 = AccountID (32-bit) + 76561197960265728
// http://forum.tsgk.com/viewtopic.php?t=26238
// https://stackoverflow.com/a/36472887
const ACCOUNT_ID_BASE = BigInt("76561197960265728");

/**
 * Convert SteamID64 to AccountID (32-bit)
 */
export function steamID64ToAccountID(steamID64: string | number): string {
  return (BigInt(steamID64) - ACCOUNT_ID_BASE).toString();
}

/**
 * Convert AccountID (32-bit) to SteamID64
 */
export function accountIDToSteamID64(accountID: string | number): string {
  return (BigInt(accountID) + ACCOUNT_ID_BASE).toString();
}

/**
 * Get the current user's Account ID (32-bit)
 * Works in both main window and webkit contexts
 * Returns null if not available
 */
export function getCurrentAccountID(): string | null {
  try {
    // Method 1: App.m_CurrentUser.strSteamID (main window only)
    // Convert SteamID64 to AccountID
    const appSteamID = (window as any).App?.m_CurrentUser?.strSteamID;
    if (appSteamID) {
      const accountID = steamID64ToAccountID(appSteamID);
      log('[SteamID] Got Account ID from App.m_CurrentUser:', accountID);
      return accountID;
    }

    // Method 2: g_steamID (most web contexts, webkit)
    // Convert SteamID64 to AccountID
    const globalSteamID = (window as any).g_steamID;
    if (globalSteamID) {
      const accountID = steamID64ToAccountID(globalSteamID);
      log('[SteamID] Got Account ID from g_steamID:', accountID);
      return accountID;
    }

    // Method 3: g_AccountID (store pages, some webkit)
    // Already in correct format
    const accountID = (window as any).g_AccountID;
    if (accountID) {
      log('[SteamID] Got Account ID from g_AccountID:', accountID);
      return accountID.toString();
    }

    log('[SteamID] Account ID not available from any source');
    return null;
  } catch (error) {
    console.error('[SteamID] Error getting Account ID:', error);
    return null;
  }
}

/**
 * Get the current user's SteamID64
 * Works in both main window and webkit contexts
 * Returns null if not available
 */
export function getCurrentSteamID64(): string | null {
  try {
    // Method 1: App.m_CurrentUser.strSteamID (main window only)
    const appSteamID = (window as any).App?.m_CurrentUser?.strSteamID;
    if (appSteamID) {
      log('[SteamID] Got SteamID64 from App.m_CurrentUser:', appSteamID);
      return appSteamID;
    }

    // Method 2: g_steamID (most web contexts, webkit)
    const globalSteamID = (window as any).g_steamID;
    if (globalSteamID) {
      log('[SteamID] Got SteamID64 from g_steamID:', globalSteamID);
      return globalSteamID;
    }

    // Method 3: g_AccountID (store pages, some webkit)
    // Convert to SteamID64
    const accountID = (window as any).g_AccountID;
    if (accountID) {
      const steamID64 = accountIDToSteamID64(accountID);
      log('[SteamID] Got SteamID64 from g_AccountID:', accountID, '→', steamID64);
      return steamID64;
    }

    log('[SteamID] SteamID64 not available from any source');
    return null;
  } catch (error) {
    console.error('[SteamID] Error getting SteamID64:', error);
    return null;
  }
}

/**
 * Check if we're in the main window context (has App object)
 */
export function isMainWindowContext(): boolean {
  return typeof (window as any).App !== 'undefined';
}

/**
 * Check if we're in a webkit context (embedded web page)
 */
export function isWebkitContext(): boolean {
  // Webkit contexts typically have g_steamID or g_AccountID but not App
  return !isMainWindowContext() &&
    (typeof (window as any).g_steamID !== 'undefined' ||
      typeof (window as any).g_AccountID !== 'undefined');
}

/**
 * Get debug info about available Steam ID sources
 */
export function getSteamIDDebugInfo(): {
  context: string;
  sources: { [key: string]: any };
  accountID: string | null;
  steamID64: string | null;
} {
  const sources = {
    'App.m_CurrentUser.strSteamID': (window as any).App?.m_CurrentUser?.strSteamID,
    'g_steamID': (window as any).g_steamID,
    'g_AccountID': (window as any).g_AccountID,
  };

  let context = 'unknown';
  if (isMainWindowContext()) {
    context = 'main-window';
  } else if (isWebkitContext()) {
    context = 'webkit';
  }

  return {
    context,
    sources,
    accountID: getCurrentAccountID(),
    steamID64: getCurrentSteamID64(),
  };
}
