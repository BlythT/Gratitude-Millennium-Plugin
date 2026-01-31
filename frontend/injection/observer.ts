// Modified from https://github.com/jcdoll/hltb-millennium-plugin
import { log } from '../lib/logger';
import { createDisplay, getExistingDisplay } from '../display/components';
import { SELECTED_GAME_NAME_SELECTOR, SELECTED_GAME_TOOLTIP_CONTAINER_SELECTOR } from '../types';
import { callable } from '@steambrew/client';

const getGameLicenseData = callable<[], string>('GetGameLicenseData');

let observer: MutationObserver | null = null;
let isProcessing = false;
let gameDataCache = new Map<string, any>(); // In-memory cache to avoid IPC calls
let onMainContentReady: ((doc: Document) => void) | null = null;
let mainContentDetected = false;

export function resetState(): void {
  log('Resetting state');
  isProcessing = false;
  gameDataCache.clear();
  mainContentDetected = false;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

// Clear the frontend's in-memory cache
export function clearFrontendCache(): void {
  log('Clearing frontend cache');
  gameDataCache.clear();
}

// Detect game name from document
export function detectGameName(doc: Document): string | null {
  log('Detecting game name with selector:', SELECTED_GAME_NAME_SELECTOR);
  const nameElem = doc.querySelector(SELECTED_GAME_NAME_SELECTOR);
  const gameName = nameElem?.textContent?.trim() || null;
  log('Detected game name:', gameName);
  return gameName;
}

// Detect tooltip container element
export function detectTooltipContainer(doc: Document): HTMLElement | null {
  log('Looking for tooltip container with selector:', SELECTED_GAME_TOOLTIP_CONTAINER_SELECTOR);
  const tooltipContainers = doc.querySelectorAll(SELECTED_GAME_TOOLTIP_CONTAINER_SELECTOR);

  log('Found', tooltipContainers.length, 'tooltip containers');

  if (tooltipContainers.length === 0) {
    log('No tooltip containers found');
    return null;
  }

  const tooltipContainer = tooltipContainers[tooltipContainers.length - 1];

  log('Container type:', typeof tooltipContainer, 'nodeType:', tooltipContainer?.nodeType);
  log('Container constructor:', tooltipContainer?.constructor?.name);

  // Check if it's an Element (nodeType 1) instead of strict HTMLElement check
  if (!tooltipContainer || tooltipContainer.nodeType !== 1) {
    log('Tooltip container is not a valid element node');
    return null;
  }

  log('Found valid tooltip container:', tooltipContainer);
  return tooltipContainer as HTMLElement;
}

function insertDisplayDeterministically(
  container: HTMLElement,
  display: HTMLElement
): boolean {
  // The container for the "Time Played" tooltip.
  const anchor = container.querySelector(
    '._1kiZKVbDe-9Ikootk57kpA._1aKegVl9_lSdNAyWYZQlr9'
  );

  if (!anchor) return false;

  anchor.after(display);
  return true;
}

// Register callback for when main content container is ready
export function onMainContentReady_Register(callback: (doc: Document) => void): void {
  onMainContentReady = callback;
  log('Main content ready callback registered');
}

async function handleGamePage(doc: Document): Promise<void> {
  log('handleGamePage called');

  // Check if main content is ready and trigger callback
  if (!mainContentDetected && doc.querySelector('[class*="_3Z7VQ1IMk4E3HsHvrkLNgo"]')) {
    log('Main content container detected, triggering callback');
    mainContentDetected = true;
    if (onMainContentReady) {
      onMainContentReady(doc);
    }
  }

  // Prevent concurrent processing
  if (isProcessing) {
    log('Already processing, skipping');
    return;
  }

  const gameName = detectGameName(doc);
  const container = detectTooltipContainer(doc);

  if (!gameName || !container) {
    log('Missing game name or container, exiting');
    return;
  }

  if (getExistingDisplay(doc, gameName)) {
    log('Display already exists for:', gameName);
    return;
  }

  log('Starting to process game:', gameName);
  isProcessing = true;

  try {
    // Check if the specific game is missing from memory
    if (!fuzzyMatch(gameDataCache, gameName)) {
      log('Cache miss for:', gameName, '- Fetching full license data');

      // Fetch the entire cache object from the backend
      const fullCacheJson = await getGameLicenseData();

      if (fullCacheJson) {
        const fullCacheMap = JSON.parse(fullCacheJson);

        // Hydrate the in-memory cache with all entries
        Object.entries(fullCacheMap).forEach(([name, data]) => {
          gameDataCache.set(name, data);
        });
        log('Memory cache hydrated with', Object.keys(fullCacheMap).length, 'entries');
      }
    }

    // Retrieve data from the now-hydrated cache
    const data = fuzzyMatch(gameDataCache, gameName);
    log('Data for current game:', data ? 'Found' : 'Not found');

    if (!data) {
      log('No data available after sync, skipping display');
      return;
    }

    // Verify game hasn't changed during the async await
    const currentGame = detectGameName(doc);
    if (currentGame !== gameName) {
      log('Game changed during fetch, skipping display');
      return;
    }

    const display = createDisplay(doc, gameName, data);
    if (!display) return;

    if (!insertDisplayDeterministically(container, display)) {
      log('Anchor not ready yet, waiting for next mutation');
      return;
    }

    log('Display inserted')
  } catch (error) {
    log('Error handling game page:', error);
  } finally {
    isProcessing = false;
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

  // Debounce handler to avoid processing on every tiny DOM change
  let debounceTimer: NodeJS.Timeout | null = null;

  observer = new MutationObserver(() => {
    // Clear existing timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Wait 100ms of inactivity before processing
    debounceTimer = setTimeout(() => {
      log('MutationObserver triggered (debounced)');
      handleGamePage(doc);
    }, 100);
  });

  log('Starting to observe document body');
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
  });

  log('MutationObserver set up successfully');

  // Initial check
  log('Running initial game page check');
  handleGamePage(doc);
}

/**
 * Fuzzy matches a game name in the map using bidirectional prefix matching.
 * Handles cases where licenses have suffixes like " - Gift" or " - Closed Beta Access".
 * Returns the longest match, with a minimum length requirement except when the game name
 * is an exact prefix of a map key (e.g., "Dota 2" matching "Dota 2 - Gift").
 * 
 * @param map - The map to search in
 * @param gameName - The game name to search for
 * @param minMatchLength - Minimum character length for reverse matches (default: 5)
 * @returns The matching value, or null if no match found
 */
function fuzzyMatch(map: Map<string, any>, gameName: string, minMatchLength: number = 5): any | null {
  // First try exact match
  if (map.has(gameName)) {
    return map.get(gameName);
  }

  // Then try prefix matches, preferring longer keys (more specific)
  const matches: Array<{ key: string; value: any }> = [];
  
  for (const [key, value] of map.entries()) {
    // Game name is prefix of key (e.g., "Dota 2" matches "Dota 2 - Gift")
    // This should always match regardless of length as some examples are short names with long suffixes
    // e.g. "Deadlock" matches "Deadlock - Closed Beta Access"
    if (key.startsWith(gameName)) {
      matches.push({ key, value });
    }
    // Key is prefix of game name (e.g., "Bad North" matches "Bad North: Jotunn Edition")
    // This requires minimum length to avoid spurious short matches
    else if (gameName.startsWith(key) && key.length >= minMatchLength) {
      matches.push({ key, value });
    }
  }

  // Return the longest matching key (most specific)
  if (matches.length > 0) {
    matches.sort((a, b) => b.key.length - a.key.length);
    return matches[0].value;
  }

  return null;
}

export function disconnectObserver(): void {
  log('disconnectObserver called');
  resetState();
}