// Modified from https://github.com/jcdoll/hltb-millennium-plugin
import type { licenseData } from '../types';
import { log } from '../lib/logger';

const CONTAINER_ID = 'gratitude-for-millennium';

function formatTime(hours: number | null | undefined): string {
  if (!hours || hours === 0) return '--';
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins}m`;
  }
  return `${hours}h`;
}

/**
 * Creates the Gratitude Display element.
 *
 * Display state is inferred from the `data` parameter:
 * - `undefined` → Loading (API call in progress, show "Loading...")
 * - `data` without `game_id` → Not found (show "Search HLTB" link)
 * - `data` with `game_id` → Found (show "View Details" button)
 */
// <div class="_1kiZKVbDe-9Ikootk57kpA _1aKegVl9_lSdNAyWYZQlr9">
//     <div class="_1tIg-QIrwMNtCm7NcYADyi _1GZdosVXnfrf69yU8DWASl"><svg version="1.1" id="Layer_2"
//             xmlns="http://www.w3.org/2000/svg" class="SVGIcon_Button SVGIcon_PlayTime" x="0px" y="0px" width="256px"
//             height="256px" viewBox="0 0 256 256">
//             <polyline fill="none" stroke="#000000" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"
//                 stroke-miterlimit="10" points="85.5,149.167 128,128 128,55.167 "></polyline>
//             <path fill="none" stroke="#000000" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"
//                 stroke-miterlimit="10"
//                 d="M128,17.5c61.027,0,110.5,49.473,110.5,110.5S189.027,238.5,128,238.5S17.5,189.027,17.5,128"></path>
//             <circle stroke="#000000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"
//                 stroke-miterlimit="10" cx="26.448" cy="85.833" r="5.5"></circle>
//             <circle stroke="#000000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"
//                 stroke-miterlimit="10" cx="50.167" cy="50.5" r="5.5"></circle>
//             <circle stroke="#000000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"
//                 stroke-miterlimit="10" cx="86" cy="26.667" r="5.5"></circle>
//         </svg></div>
//     <div class="_3m_zjRTQBqcfzCjXLXUHcR">
//         <div class="_34lrt5-Fc3usZU6trA1P0-">Play Time</div>
//         <div class="_2TYVGoD27ZMfjRirKQNLfk">15 minutes</div>
//     </div>
// </div>
export function createDisplay(
  doc: Document,
  data?: licenseData
): HTMLElement {
  log('Creating display with data:', data);
  // Create a div with classes _1kiZKVbDe-9Ikootk57kpA _1aKegVl9_lSdNAyWYZQlr9 and id CONTAINER_ID
  const container = doc.createElement('div');
  container.id = CONTAINER_ID;
  container.className = '_1kiZKVbDe-9Ikootk57kpA _1aKegVl9_lSdNAyWYZQlr9';
  const iconDiv = doc.createElement('div');
  iconDiv.className = '_1tIg-QIrwMNtCm7NcYADyi _1GZdosVXnfrf69yU8DWASl';
  iconDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="rgba(255, 255, 255, 0.4)" class="bi bi-gift-fill" viewBox="0 0 16 16">
  <path d="M3 2.5a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 5 0v.006c0 .07 0 .27-.038.494H15a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2.038A3 3 0 0 1 3 2.506zm1.068.5H7v-.5a1.5 1.5 0 1 0-3 0c0 .085.002.274.045.43zM9 3h2.932l.023-.07c.043-.156.045-.345.045-.43a1.5 1.5 0 0 0-3 0zm6 4v7.5a1.5 1.5 0 0 1-1.5 1.5H9V7zM2.5 16A1.5 1.5 0 0 1 1 14.5V7h6v9z"/>
</svg>`
  const textDiv = doc.createElement('div');
  textDiv.className = '_3m_zjRTQBqcfzCjXLXUHcR';
  const labelDiv = doc.createElement('div');
  labelDiv.className = '_34lrt5-Fc3usZU6trA1P0-';
  labelDiv.textContent = 'Gift?';
  const valueDiv = doc.createElement('div');
  valueDiv.className = '_2TYVGoD27ZMfjRirKQNLfk';
  if (data === undefined) {
    valueDiv.textContent = 'Loading...';
  } else if (!data || !data.acquisition) {
    valueDiv.textContent = "Licence data not found";
  } else {
    valueDiv.textContent = `Acquired on: ${data.date} via ${data.acquisition} `;
  }

  textDiv.appendChild(labelDiv);
  textDiv.appendChild(valueDiv);
  container.appendChild(iconDiv);
  container.appendChild(textDiv);

  log('Created display container:', container);

  return container;
}

export function getExistingDisplay(doc: Document): HTMLElement | null {
  return doc.getElementById(CONTAINER_ID);
}

export function removeExistingDisplay(doc: Document): void {
  log('Removing existing display if present');
  doc.getElementById(CONTAINER_ID)?.remove();
}
