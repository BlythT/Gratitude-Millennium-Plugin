// Modified from https://github.com/jcdoll/hltb-millennium-plugin
import { log } from '../../lib/logger';
import { createDisplay, createMissingDataDisplay, getExistingDisplay } from '../display/components';
import { SELECTED_GAME_NAME_SELECTOR, SELECTED_GAME_PLAYTIME_TOOLTIP_SELECTOR, SELECTED_GAME_TOOLTIP_CONTAINER_SELECTOR, MAIN_CONTENT_CONTAINER_SELECTOR } from '../types';
import { getCurrentAccountID } from '../../lib/steamid';
import { gameLicenseCache } from './gamelicensecache';

let observer: MutationObserver | null = null;
let onMainContentReady: ((doc: Document) => void) | null = null;
let mainContentDetected = false;
let lastProcessedGame: string | null = null;

export function resetState(): void {
  log('Resetting state');
  mainContentDetected = false;
  lastProcessedGame = null;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

// Detect game name from document
export function detectGameName(doc: Document): string | null {
  log('Detecting game name with selector:', SELECTED_GAME_NAME_SELECTOR);
  const nameElem = doc.querySelector(SELECTED_GAME_NAME_SELECTOR);
  const gameName = nameElem?.textContent?.trim() || null;
  log('Detected game name:', gameName);
  return gameName;
}

/**
 * Finds a specific element in the document by selector.
 * @param doc The document or HTMLElement to search within
 * @param selector The CSS selector to find the element
 * @returns HTMLElement | null if not found
 */
export function detectElement(doc: Document | HTMLElement, selector: string): HTMLElement | null {
  log('Looking for element with selector:', selector);
  const elements = doc.querySelectorAll(selector);

  log('Found', elements.length, 'elements');

  if (elements.length === 0) {
    log('No elements found');
    return null;
  }

  // Use last element (page has duplicates, first copy off screen)
  const element = elements[elements.length - 1];

  if (!element) {
    log('No valid element found');
    return null;
  }

  log('Found valid element:', element);
  return element as HTMLElement;
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
    await gameLicenseCache.getData(steamID);
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

/**
 * Check if main content container is ready and trigger callback.
 * @param doc The document to check
 * @returns void
 */
function checkMainContentReady(doc: Document): void {
  if (!onMainContentReady) return; // No callback registered, don't prevent further checks
  if (mainContentDetected) return; // Already detected
  if (!doc.querySelector(MAIN_CONTENT_CONTAINER_SELECTOR)) return;

  log('Main content container detected, triggering callback');
  mainContentDetected = true;
  onMainContentReady?.(doc);
}

/**
 * Handle game page logic synchronously.
 * @param doc
 * @returns boolean — true signals that an async cache refresh should be triggered
 */
function handleGamePageSync(doc: Document): boolean {
  log('handleGamePage called');

  // Check if main content is ready and trigger callback
  checkMainContentReady(doc);

  const gameName = detectGameName(doc);
  if (!gameName) {
    lastProcessedGame = null;
    return false;
  }

  if (gameName === lastProcessedGame) {
    log('Game name unchanged, skipping');
    return false;
  }

  const tooltipContainer = detectElement(doc, SELECTED_GAME_TOOLTIP_CONTAINER_SELECTOR);
  if (!tooltipContainer) {
    log('Tooltip container not found, skipping');
    return false;
  }

  // This is the Time Played tooltip element we will insert after.
  const insertAfterTarget = detectElement(tooltipContainer, SELECTED_GAME_PLAYTIME_TOOLTIP_SELECTOR);
  if (!insertAfterTarget) {
    log('Insert after target not found, skipping');
    return false;
  }

  lastProcessedGame = gameName;

  if (getExistingDisplay(doc, gameName)) {
    log('Display already exists for:', gameName);
    return false;
  }

  // Get current Steam ID
  const steamID = getCurrentAccountID();
  if (!steamID) {
    log('Steam ID not available, skipping');
    return true;
  }

  log('Starting to process game:', gameName);

  try {
    log('Checking if cache is populated');
    const cachePopulated = gameLicenseCache.getEntryCountSync(steamID) !== null;

    if (!cachePopulated) {
      log('Cache not populated, inserting missing data display');
      const missingDisplay = createMissingDataDisplay(doc, gameName);
      if (!missingDisplay) {
        log('Failed to create missing data display');
        return true;
      }

      insertAfterTarget.after(missingDisplay);
      log('Missing data display inserted, will fetch data asynchronously');
      return true;
    }

    log('Cache populated, proceeding to fetch license data synchronously');

    const licenseDataMap = gameLicenseCache.getDataSync(steamID);
    if (!licenseDataMap) {
      log('Cache is empty despite being marked populated, this should not happen');
      const missingDisplay = createMissingDataDisplay(doc, gameName);
      if (!missingDisplay) {
        log('Failed to create missing data display');
        return true;
      }
      insertAfterTarget.after(missingDisplay);
      return true;
    }
    log('Retrieved', licenseDataMap.size, 'license entries');

    // Check if data exists for this game using fuzzy matching
    const data = fuzzyMatch(licenseDataMap, gameName);
    log('Data for current game:', data ? 'Found' : 'Not found');

    if (!data) {
      log('No data available for this specific game, skipping display');
      return true; // Signal async fetch: might exist on backend but not cached
    }

    const display = createDisplay(doc, gameName, data);
    if (!display) return false;

    insertAfterTarget.after(display);
    log('Display inserted');
    return false;
  } catch (error) {
    log('Error handling game page:', error);
    return false;
  } finally {
    log('Processing complete for:', gameName);
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

/**
 * Fuzzy matches a game name in the map using bidirectional prefix matching.
 * Handles cases where licenses have suffixes like " - Gift" or " - Closed Beta Access".
 * Forward matches (key starts with gameName) prefer the shortest key (base game over DLC).
 * Reverse matches (gameName starts with key) take priority over forward matches.
 *
 * @param map - The map to search in
 * @param gameName - The game name to search for
 * @returns The matching value, or null if no match found
 */
function fuzzyMatch(map: Map<string, any>, gameName: string): any | null {
  if (map.has(gameName)) {
    return map.get(gameName);
  }

  let forwardMatch: { key: string; value: any } | null = null; // gameName is prefix of key
  let reverseMatch: { key: string; value: any } | null = null; // key is prefix of gameName

  for (const [key, value] of map.entries()) {
    if (key.startsWith(gameName)) {
      // Forward: prefer shortest key (base game over DLC)
      if (!forwardMatch || key.length < forwardMatch.key.length) {
        forwardMatch = { key, value };
      }
    } else if (gameName.startsWith(key)) {
      // Reverse: prefer longest key (most specific edition)
      if (!reverseMatch || key.length > reverseMatch.key.length) {
        reverseMatch = { key, value };
      }
    }
  }

  // Prefer reverse match (exact edition) over forward (base game with suffix)
  return reverseMatch?.value ?? forwardMatch?.value ?? null;
}

export function disconnectObserver(): void {
  log('disconnectObserver called');
  resetState();
}