// Modified from https://github.com/jcdoll/hltb-millennium-plugin
import { log } from '../../lib/logger';
import { fuzzyMatchLicenseName } from '../../lib/license-matching.js';
import { createDisplay, createMissingDataDisplay, getExistingDisplay } from '../display/components';
import { getCurrentAccountID } from '../../lib/steamid';
import { gameLicenseCache } from './gamelicensecache';
import { giverCache } from './givercache';
import { SELECTORS } from '../types';

let observer: MutationObserver | null = null;
let onMainContentReady: ((doc: Document) => void) | null = null;
let mainContentDetected = false;
let lastProcessedGame: string | null = null;

function logGamePageScan(
	gameName: string | null,
	result: string,
	details?: Record<string, unknown>,
): void {
	const summary = { gameName, result, ...details };
	log('Game page scan:', JSON.stringify(summary));
}

export function resetState(): void {
  log('Resetting state');
  mainContentDetected = false;
  lastProcessedGame = null;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

// Detect game name from document - try multiple selectors
export function detectGameName(doc: Document): string | null {
  // Try standard selector first
  let nameElem = doc.querySelector(SELECTORS.standard.gameName);

  // If not found, try Big Picture selector
  if (!nameElem) {
    nameElem = doc.querySelector(SELECTORS.bigPicture.gameName);
  }

  return nameElem?.textContent?.trim() || null;
}

/**
 * Finds a specific element in the document by selector, trying multiple selectors.
 * @param doc The document or HTMLElement to search within
 * @param selectors Array of CSS selectors to try
 * @returns HTMLElement | null if not found
 */
export function detectElementMulti(doc: Document | HTMLElement, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    log('Looking for element with selector:', selector);
    const elements = doc.querySelectorAll(selector);

    log('Found', elements.length, 'elements');

    if (elements.length > 0) {
      // Use last element (page has duplicates, first copy off screen)
      const element = elements[elements.length - 1];

      if (element) {
        log('Found valid element:', element);
        return element as HTMLElement;
      }
    }
  }

  log('No valid element found for any selector');
  return null;
}

/**
 * Finds a specific element in the document by selector.
 * @param doc The document or HTMLElement to search within
 * @param selector The CSS selector to find the element
 * @returns HTMLElement | null if not found
 */
export function detectElement(doc: Document | HTMLElement, selector: string): HTMLElement | null {
  return detectElementMulti(doc, [selector]);
}

// Register callback for when main content container is ready
export function onMainContentReady_Register(callback: (doc: Document) => void): void {
  onMainContentReady = callback;
  log('Main content ready callback registered');
}

/**
 * Fetch license data asynchronously to populate cache.
 */
async function triggerCacheRefresh(): Promise<void> {
  log('Fetching license data asynchronously to populate cache');
  const steamID = getCurrentAccountID();
  if (!steamID) {
    log('Steam ID not available, cannot fetch data');
    return;
  }
  try {
    await Promise.all([
      gameLicenseCache.getData(steamID),
      giverCache.getAll(steamID),
    ]);
    log('License data fetched and cache populated');
  } catch (error) {
    log('Error fetching license data:', error);
  }
}

/**
 * Process the game page and trigger cache refresh if needed.
 * @param doc The document to process
 */
function processAndRefreshIfNeeded(doc: Document): void {
  const needsCacheRefresh = handleGamePageSync(doc);
  if (needsCacheRefresh) {
    triggerCacheRefresh();
  }
}

export function refreshGamePage(doc: Document): void {
  log('refreshGamePage called');
  const needsCacheRefresh = handleGamePageSync(doc, true);
  if (needsCacheRefresh) {
    log('refreshGamePage requested async cache refresh');
    triggerCacheRefresh();
  }
}

/**
 * Check if main content container is ready and trigger callback.
 * @param doc The document to check
 * @returns void
 */
function checkMainContentReady(doc: Document): void {
  if (!onMainContentReady) return; // No callback registered, don't prevent further checks
  if (mainContentDetected) return; // Already detected

  const hasMainContent = doc.querySelector(SELECTORS.standard.mainContent) ||
    doc.querySelector(SELECTORS.bigPicture.mainContent);

  if (!hasMainContent) return;

  log('Main content container detected, triggering callback');
  mainContentDetected = true;
  onMainContentReady?.(doc);
}

/**
 * Handle game page logic synchronously.
 * @param doc
 * @returns boolean — true signals that an async cache refresh should be triggered
 */
export function detectAppId(doc: Document): number | null {
  // 1. Try to find standard Steam attributes
  const appIdElement = doc.querySelector('[data-appid]');
  if (appIdElement) {
    const appIdAttr = appIdElement.getAttribute('data-appid');
    if (appIdAttr) {
      const parsed = parseInt(appIdAttr, 10);
      if (!isNaN(parsed) && parsed > 0) {
        log('Detected App ID from data-appid:', parsed);
        return parsed;
      }
    }
  }

  // 2. Try to search links on the page (Store Page, Community Hub, etc.)
  const links = doc.querySelectorAll('a[href]');
  for (const link of Array.from(links)) {
    const href = link.getAttribute('href');
    if (!href) continue;

    const match = href.match(/(?:steam:\/\/rungameid\/|steam:\/\/store\/|steam:\/\/url\/StorePage\/|steam:\/\/url\/StoreAppPage\/|store\.steampowered\.com\/app\/|steamcommunity\.com\/app\/)(\d+)/i);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        log('Detected App ID from link href:', parsed, href);
        return parsed;
      }
    }
  }

  return null;
}

function handleGamePageSync(doc: Document, forceRefresh = false): boolean {
  // Check if main content is ready and trigger callback
  checkMainContentReady(doc);

  const gameName = detectGameName(doc);
  if (!gameName) {
    logGamePageScan(null, 'no-game-detected', { forceRefresh });
    lastProcessedGame = null;
    return false;
  }

  const existingDisplay = getExistingDisplay(doc, gameName)
  if (!forceRefresh && gameName === lastProcessedGame && existingDisplay && !existingDisplay.dataset.missing) {
    logGamePageScan(gameName, 'skipped-existing-display', { forceRefresh });
    return false;
  }

  const tooltipContainer = detectElementMulti(doc, [
    SELECTORS.standard.tooltipContainer,
    SELECTORS.bigPicture.tooltipContainer
  ]);

  if (!tooltipContainer) {
    logGamePageScan(gameName, 'tooltip-container-missing', { forceRefresh });
    return false;
  }

  const insertAfterTarget = detectElementMulti(tooltipContainer, [
    SELECTORS.standard.playtimeTooltip,
    SELECTORS.bigPicture.playtimeTooltip
  ]);

  if (!insertAfterTarget) {
    logGamePageScan(gameName, 'insert-target-missing', { forceRefresh });
    return false;
  }

  lastProcessedGame = gameName;

  // Get current Steam ID
  const steamID = getCurrentAccountID();
  if (!steamID) {
    logGamePageScan(gameName, 'steam-id-missing', { forceRefresh });
    return true;
  }

  if (existingDisplay && (existingDisplay.dataset.missing || forceRefresh)) {
    log('Removing existing display before refresh');
    existingDisplay.remove();
  }

  try {
    const licenseDataMap = gameLicenseCache.getDataSync(steamID);
    if (!licenseDataMap) {
      const missingDisplay = createMissingDataDisplay(doc, gameName);
      if (!missingDisplay) {
        logGamePageScan(gameName, 'missing-display-create-failed', { forceRefresh });
        return true;
      }

      insertAfterTarget.after(missingDisplay);
      logGamePageScan(gameName, 'missing-cache-display-inserted', { forceRefresh });
      return true;
    }

    // Check if data exists for this game using App ID or fuzzy name matching
    let match = null;
    const appId = detectAppId(doc);
    if (appId) {
      const license = licenseDataMap.byAppId.get(String(appId));
      if (license) {
        match = {
          licenseKey: String(appId),
          data: license,
          matchType: 'appid-exact'
        };
        log('Found App ID match in cache:', appId, match);
      }
    }

    if (!match) {
      const fuzzyMatch = fuzzyMatchLicenseName(licenseDataMap.byName, gameName);
      if (fuzzyMatch) {
        match = {
          licenseKey: fuzzyMatch.licenseKey,
          data: fuzzyMatch.data,
          matchType: fuzzyMatch.matchType
        };
        log('Found fuzzy name match in cache:', gameName, match);
      }
    }

    if (!match) {
      logGamePageScan(gameName, 'license-data-missing', {
        forceRefresh,
        cacheEntries: licenseDataMap.byName.size,
      });
      return true; // Signal async fetch: might exist on backend but not cached
    }

    const giver = giverCache.getEntrySync(steamID, match.licenseKey, match.data.name);
    const display = createDisplay(doc, gameName, match, giver, steamID, () => refreshGamePage(doc));
    if (!display) {
      logGamePageScan(gameName, 'display-create-failed', {
        forceRefresh,
        licenseKey: match.licenseKey,
        hasGiver: !!giver,
      });
      return false;
    }

    insertAfterTarget.after(display);
    logGamePageScan(gameName, 'display-inserted', {
      forceRefresh,
      licenseKey: match.licenseKey,
      hasGiver: !!giver,
    });
    return false;
  } catch (error) {
    log('Error handling game page:', error);
    return false;
  }
}

export function setupObserver(doc: Document): void {
  log('setupObserver called');

  // Clean up existing observer
  if (observer) {
    log('Disconnecting existing observer');
    observer.disconnect();
  }

  log('Creating new MutationObserver');

  let isAnimationFramePending = false;

  observer = new MutationObserver(() => {
    // Debounce: only schedule one processing per frame, even if multiple mutations occur.
    // This is safe because we query current DOM state (not mutation records), so we always
    // see the final state after all mutations complete.
    if (isAnimationFramePending) return;

    isAnimationFramePending = true;

    requestAnimationFrame(() => {
      try {
        processAndRefreshIfNeeded(doc);
      } finally {
        isAnimationFramePending = false;
      }
    });
  });

  log('Starting to observe document body');
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
  });

  log('MutationObserver set up successfully');

  // Since the cache is empty on initial load, fetch the backend data first then try processing
  triggerCacheRefresh().then(() => {
    processAndRefreshIfNeeded(doc);
  });
}

export function disconnectObserver(): void {
  log('disconnectObserver called');
  resetState();
}
