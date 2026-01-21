// Modified from https://github.com/jcdoll/hltb-millennium-plugin
import { log } from '../lib/logger';
import {
  createDisplay,
  getExistingDisplay,
  removeExistingDisplay,
} from '../display/components';
// import { injectStyles } from '../display/styles';
import { SELECTED_GAME_NAME_SELECTOR, SELECTED_GAME_TOOLTIP_CONTAINER_SELECTOR } from '../types';
import { callable } from '@steambrew/client';

const getGameLicense = callable<[{ gameName: string }], string>('GetGameLicense');

let currentGameName: string | null = null;
let processingGameName: string | null = null;
let currentDoc: Document | null = null;
let observer: MutationObserver | null = null;

export function resetState(): void {
  currentGameName = null;
  processingGameName = null;
  currentDoc = null;
}

export function refreshDisplay(): void {
  if (!currentDoc || !currentGameName) return;

  const existing = getExistingDisplay(currentDoc);
  if (!existing) return;

  getGameLicense({ gameName: currentGameName }).then((cached) => {

    const data = cached ? JSON.parse(cached) : null;
    if (!data) return;

    existing.replaceWith(createDisplay(currentDoc, data));
  }).catch((error) => {
    log('Error refreshing display data from backend:', error);
  });
}

// Detect game name from document
// Example:
// <span class="_3rpUkswF6xc_ste4Ros_xM">Escape Simulator 2</span>
export function detectGameName(doc: Document): string | null {
  const nameElem = doc.querySelector(SELECTED_GAME_NAME_SELECTOR);
  if (nameElem) {
    return nameElem.textContent?.trim() || null;
  }

  return null;
}

// Detect tooltip container element
// Example:
// <div class="_1mDAVT4sTzFRwJtlKCw2Ws">
//    <div class="_2cRYms-zZc4misk9tj3bt8">
//        <div class="tool-tip-source Focusable">
//            <div
//                class="_1nxYsdQLxAV_i8JIm-f64w _2sKVnd_AUg44QSdoAp8Lne _1kiZKVbDe-9Ikootk57kpA _3pS8kMrtScuY1Qf-W8tmRV Panel">
//                <div class="_3bkqc-SsCg0b3FTEuewlK8 _1UXbBdCvbg9tyZhc4owO4W"><svg xmlns="http://www.w3.org/2000/svg"
//                        viewBox="0 0 36 36" fill="none" class="MbTRimZpGCATmn39ae8RT">
//                        <path ...>
//                        </path>
//                    </svg></div>
//                <div class="_2YTg3hVVde1EN1A4QVkvAE _3m_zjRTQBqcfzCjXLXUHcR">
//                    <div class="_34lrt5-Fc3usZU6trA1P0-">Cloud Status</div>
//                    <div class="_2TYVGoD27ZMfjRirKQNLfk _1nfJNsQjTOXSQQyFahGnRi">Up to date</div>
//                </div>
//            </div>
//        </div>
//    </div>
//    # more items like above. Can't append since these two final children exist
//    <div class="_1kiZKVbDe-9Ikootk57kpA _1aKegVl9_lSdNAyWYZQlr9">
//        <div class="_1tIg-QIrwMNtCm7NcYADyi _1GZdosVXnfrf69yU8DWASl"><svg version="1.1" id="Layer_2"
//                xmlns="http://www.w3.org/2000/svg" class="SVGIcon_Button SVGIcon_PlayTime" x="0px" y="0px" width="256px"
//                height="256px" viewBox="0 0 256 256">
//                <polyline fill="none" stroke="#000000" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"
//                    stroke-miterlimit="10" points="85.5,149.167 128,128 128,55.167 "></polyline>
//                <path fill="none" stroke="#000000" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"
//                    stroke-miterlimit="10"
//                    d="M128,17.5c61.027,0,110.5,49.473,110.5,110.5S189.027,238.5,128,238.5S17.5,189.027,17.5,128">
//                </path>
//                <circle stroke="#000000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"
//                    stroke-miterlimit="10" cx="26.448" cy="85.833" r="5.5"></circle>
//                <circle stroke="#000000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"
//                    stroke-miterlimit="10" cx="50.167" cy="50.5" r="5.5"></circle>
//                <circle stroke="#000000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"
//                    stroke-miterlimit="10" cx="86" cy="26.667" r="5.5"></circle>
//            </svg></div>
//        <div class="_3m_zjRTQBqcfzCjXLXUHcR">
//            <div class="_34lrt5-Fc3usZU6trA1P0-">Play Time</div>
//            <div class="_2TYVGoD27ZMfjRirKQNLfk">15 minutes</div>
//        </div>
//    </div>
//    <div class="_1kiZKVbDe-9Ikootk57kpA UAhWiMg9Q2VPsQQBj_ikT">
//        <div class="_1tIg-QIrwMNtCm7NcYADyi k-QNT9kzOEOvG0U_kGmwr"><svg xmlns="http://www.w3.org/2000/svg"
//                viewBox="0 0 36 36" fill="none">
//                <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"
//                    d="M9.64304 9.49988L6.39294 12.8055L9.64304 16.1112V20.8333H14.2858L18.0001 24.6111L21.7143 20.8333H26.3573V16.111L29.6072 12.8055L26.3573 9.50012V4.77777H21.7143L18.0001 1L14.2858 4.77777H9.64304V9.49988ZM22.6432 12.8056C22.6432 15.4136 20.5645 17.5278 18.0004 17.5278C15.4362 17.5278 13.3575 15.4136 13.3575 12.8056C13.3575 10.1976 15.4362 8.08334 18.0004 8.08334C20.5645 8.08334 22.6432 10.1976 22.6432 12.8056Z">
//                </path>
//                <path fill="currentColor"
//                    d="M5 30.2778L8.25 24.6111H12.4286L15.6786 27.9167L11.5 35L9.17857 30.2778H5Z"></path>
//                <path fill="currentColor"
//                    d="M30.9999 30.2778L27.7499 24.6111H23.5713L20.3213 27.9167L24.4999 35L26.8213 30.2778H30.9999Z">
//                </path>
//            </svg></div>
//        <div class="_3m_zjRTQBqcfzCjXLXUHcR">
//            <div class="_34lrt5-Fc3usZU6trA1P0-">Achievements</div>
//            <div class="_16quGbk-i_9yE-tFyyOK8G">
//                <div class="_2TYVGoD27ZMfjRirKQNLfk _2muiKHUkOiTvX-6arqnQUC">1/85</div>
//                <div role="progressbar" aria-valuenow="1.1764705882352942" class="_25YVDTaClw6Y2COPsU0UaV">
//                    <div class="_1FnTqlsi2_-TJf1d5apoS6" style="width: 1.17647%;"></div>
//                </div>
//            </div>
//        </div>
//    </div>
//</div>
export function detectTooltipContainer(doc: Document): HTMLElement | null {
  // There are two tooltip containers; use the last one
  log('Looking for tooltip container using selector:', SELECTED_GAME_TOOLTIP_CONTAINER_SELECTOR);
    const tooltipContainers = doc.querySelectorAll(SELECTED_GAME_TOOLTIP_CONTAINER_SELECTOR);
  
  if (tooltipContainers.length === 0) {
    log('Tooltip container not found');
    return null;
  }

  const tooltipContainer = tooltipContainers[tooltipContainers.length - 1];

  log('Found tooltip container (last match):', tooltipContainer);
  if (tooltipContainer) {
    log('Found tooltip container:', tooltipContainer);
    if (!(tooltipContainer instanceof HTMLElement)) {
      log('Tooltip container is not an HTMLElement, casting:', typeof tooltipContainer);

      if (tooltipContainer as HTMLElement | null === null) {
        log('Casting failed, returning null');
        return null;
      }
      return tooltipContainer as HTMLElement | null;
    }

    return tooltipContainer;
  }

  log('Tooltip container not found');

  return null;
}


async function handleGamePage(doc: Document): Promise<void> {
  const gameName = detectGameName(doc);
  const container = detectTooltipContainer(doc);
  if (!container) {
    log('Tooltip container not found in document');
    return;
  }

  if (!gameName) {
    // Silent return - game page not detected (common during DOM transitions)
    return;
  }

  // Already processing this specific app - prevent re-entry from MutationObserver
  if (gameName === processingGameName) {
    return;
  }

  // Check if display already exists for this app and has content
  // (Steam can clear children on hover, leaving an empty container)
  const existingDisplay = getExistingDisplay(doc);
  if (gameName === currentGameName && existingDisplay && existingDisplay.children.length > 0) {
    log('Display already exists for current game:', gameName);
    return;
  }

  // Set processing lock before any DOM modifications
  processingGameName = gameName;
  currentGameName = gameName;
  currentDoc = doc;
  log('Found game page for:', gameName);

  try {
    removeExistingDisplay(doc);

    // TODO: can we just append? Would prefer to insert in the middle
    container.appendChild(createDisplay(doc)); // undefined data = loading state

    const updateDisplayForApp = (targetGameName: string) => {
      const existing = getExistingDisplay(doc);
      if (!existing) return false;

      return getGameLicense({ gameName: targetGameName }).then((cached) => {
        const data = cached ? JSON.parse(cached) : null;

        if (data) {
          log('Updating display:', data.game_name || data.searched_name);
          existing.replaceWith(createDisplay(doc, data));
          return true;
        }
        return false;

      }).catch((error) => {
        log('Error updating display data from backend:', error);
        return false;
      });
    }

    // If game changed during fetch, update display for the new game instead
    if (currentGameName !== null && currentGameName !== gameName) {
      log('Game changed during fetch, updating display for current game:', currentGameName);
      updateDisplayForApp(currentGameName);
      return;
    }

    updateDisplayForApp(gameName);

    // Handle background refresh for stale data
    // if (result.refreshPromise) {
    //   result.refreshPromise.then((newData) => {
    //     if (newData && currentGameName === appId) {
    //       updateDisplayForApp(appId);
    //     }
    //   });
    // }
  } catch (e) {
    log('Error handling game page for', gameName, e);
  } finally {
    // Clear processing lock only if we're still processing this app
    if (processingGameName === gameName) {
      processingGameName = null;
    }
  }
}

export function setupObserver(doc: Document): void {
  log('Setting up MutationObserver');
  // Clean up existing observer
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  // injectStyles(doc);

  observer = new MutationObserver(() => {
    handleGamePage(doc);
  });

  observer.observe(doc.body, {
    childList: true,
    subtree: true,
  });

  log('MutationObserver set up');

  // Initial check for already-rendered game page
  handleGamePage(doc);
}

export function disconnectObserver(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}
