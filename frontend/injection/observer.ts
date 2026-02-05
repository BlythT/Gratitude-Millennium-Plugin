// Modified from https://github.com/jcdoll/hltb-millennium-plugin
import { log } from '../../lib/logger';
import { createDisplay, createMissingDataDisplay, getExistingDisplay } from '../display/components';
import {
  SELECTED_GAME_NAME_SELECTOR,
  SELECTED_GAME_PLAYTIME_TOOLTIP_SELECTOR,
  SELECTED_GAME_TOOLTIP_CONTAINER_SELECTOR,
  MAIN_CONTENT_CONTAINER_SELECTOR,
  BIG_PICTURE_GAME_NAME_SELECTOR,
  BIG_PICTURE_TOOLTIP_CONTAINER_SELECTOR,
  BIG_PICTURE_PLAYTIME_TOOLTIP_SELECTOR,
  BIG_PICTURE_MAIN_CONTENT_CONTAINER_SELECTOR
} from '../types';
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

// Detect game name from document - try multiple selectors
export function detectGameName(doc: Document): string | null {
  log('Detecting game name');

  // Try standard selector first
  let nameElem = doc.querySelector(SELECTED_GAME_NAME_SELECTOR);

  // If not found, try Big Picture selector
  if (!nameElem) {
    nameElem = doc.querySelector(BIG_PICTURE_GAME_NAME_SELECTOR);
  }

  const gameName = nameElem?.textContent?.trim() || null;
  log('Detected game name:', gameName);
  return gameName;
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

  const hasMainContent = doc.querySelector(MAIN_CONTENT_CONTAINER_SELECTOR) ||
    doc.querySelector(BIG_PICTURE_MAIN_CONTENT_CONTAINER_SELECTOR);

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
function handleGamePageSync(doc: Document): boolean {
  log('handleGamePage called');

  // Check if main content is ready and trigger callback
  checkMainContentReady(doc);

  const gameName = detectGameName(doc);
  if (!gameName) {
    lastProcessedGame = null;
    return false;
  }

  const existingDisplay = getExistingDisplay(doc, gameName)
  if (gameName === lastProcessedGame && existingDisplay && !existingDisplay.dataset.missing) {
    log('Game name unchanged and display exists, skipping');
    return false;
  }

  const tooltipContainer = detectElementMulti(doc, [
    SELECTED_GAME_TOOLTIP_CONTAINER_SELECTOR,
    BIG_PICTURE_TOOLTIP_CONTAINER_SELECTOR
  ]);

  if (!tooltipContainer) {
    log('Tooltip container not found, skipping');
    return false;
  }

  const insertAfterTarget = detectElementMulti(tooltipContainer, [
    SELECTED_GAME_PLAYTIME_TOOLTIP_SELECTOR,
    BIG_PICTURE_PLAYTIME_TOOLTIP_SELECTOR
  ]);

  if (!insertAfterTarget) {
    log('Insert after target not found, skipping');
    return false;
  }

  lastProcessedGame = gameName;

  // Get current Steam ID
  const steamID = getCurrentAccountID();
  if (!steamID) {
    log('Steam ID not available, skipping');
    return true;
  }

  log('Starting to process game:', gameName);

  if (existingDisplay && existingDisplay.dataset.missing) {
    log('Existing display indicates missing data, removing it for refresh');
    existingDisplay.remove();
  }

  try {
    log('Checking if cache is populated');
    if (!gameLicenseCache.getDataSync(steamID)) {
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

  observer = new MutationObserver((mutations) => {
    // Debounce: only schedule one processing per frame, even if multiple mutations occur.
    // This is safe because we query current DOM state (not mutation records), so we always
    // see the final state after all mutations complete.
    console.log('Mutations:', mutations);  // Log to see what's changing
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