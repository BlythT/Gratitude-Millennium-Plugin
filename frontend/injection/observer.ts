// Modified from https://github.com/jcdoll/hltb-millennium-plugin
import { log } from '../lib/logger';
import { createDisplay, getExistingDisplay } from '../display/components';
import { SELECTED_GAME_NAME_SELECTOR, SELECTED_GAME_TOOLTIP_CONTAINER_SELECTOR } from '../types';
import { callable } from '@steambrew/client';

const getGameLicense = callable<[{ gameName: string }], string>('GetGameLicense');

let observer: MutationObserver | null = null;
let isProcessing = false;

export function resetState(): void {
  log('Resetting state');
  isProcessing = false;
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

async function handleGamePage(doc: Document): Promise<void> {
  log('handleGamePage called');
  
  // Prevent concurrent processing
  if (isProcessing) {
    log('Already processing, skipping');
    return;
  }

  const gameName = detectGameName(doc);
  const container = detectTooltipContainer(doc);
  
  // Exit early if no game detected or no container
  if (!gameName) {
    log('No game name detected, exiting');
    return;
  }
  
  if (!container) {
    log('No container found, exiting');
    return;
  }

  // Skip if display already exists for this game - DOM is source of truth
  if (getExistingDisplay(doc, gameName)) {
    log('Display already exists for:', gameName);
    return;
  }

  log('Starting to process game:', gameName);
  isProcessing = true;

  try {
    log('Fetching license data for:', gameName);
    const cached = await getGameLicense({ gameName });
    log('Received cached data:', cached ? 'yes' : 'no');
    
    const data = cached ? JSON.parse(cached) : null;
    log('Parsed data:', data);

    // Only display if we have data
    if (!data) {
      log('No data available, skipping display creation');
      return;
    }

    // Check if game changed while fetching
    const currentGame = detectGameName(doc);
    log('Current game after fetch:', currentGame);
    
    if (currentGame !== gameName) {
      log('Game changed during fetch from', gameName, 'to', currentGame, '- skipping display');
      return;
    }

    // Create display with unique ID - no need to remove old one
    log('Creating new display with data:', data.game_name || data.searched_name);
    const display = createDisplay(doc, gameName, data);
    
    // Only append if display was created (e.g., game is a gift)
    if (display) {
      container.appendChild(display);
      log('Display successfully created and appended');
    } else {
      log('Display not created (not a gift or no qualifying data)');
    }
  } catch (error) {
    log('Error handling game page for', gameName, ':', error);
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
  observer = new MutationObserver(() => {
    log('MutationObserver triggered');
    handleGamePage(doc);
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

export function disconnectObserver(): void {
  log('disconnectObserver called');
  resetState();
}