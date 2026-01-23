// Modified from https://github.com/jcdoll/hltb-millennium-plugin
import type { licenseData } from '../types';
import { log } from '../lib/logger';
import confetti from 'canvas-confetti';

function createDisplayId(gameName: string): string {
  return 'gratitude-' + gameName.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

// TODO: add settings menu to change icon from default
const bootstrapGiftIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="rgba(255, 255, 255, 0.4)" viewBox="0 0 16 16" height="30" width="30">
  <path d="M3 2.5a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 5 0v.006c0 .07 0 .27-.038.494H15a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 14.5V7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2.038A3 3 0 0 1 3 2.506zm1.068.5H7v-.5a1.5 1.5 0 1 0-3 0c0 .085.002.274.045.43zM9 3h2.932l.023-.07c.043-.156.045-.345.045-.43a1.5 1.5 0 0 0-3 0zM1 4v2h6V4zm8 0v2h6V4zm5 3H9v8h4.5a.5.5 0 0 0 .5-.5zm-7 8V7H2v7.5a.5.5 0 0 0 .5.5z"/>
</svg>`;
const bootstrapGiftFilledIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="rgba(255, 255, 255, 0.4)" viewBox="0 0 16 16" height="30" width="30">
  <path d="M3 2.5a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 5 0v.006c0 .07 0 .27-.038.494H15a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2.038A3 3 0 0 1 3 2.506zm1.068.5H7v-.5a1.5 1.5 0 1 0-3 0c0 .085.002.274.045.43zM9 3h2.932l.023-.07c.043-.156.045-.345.045-.43a1.5 1.5 0 0 0-3 0zm6 4v7.5a1.5 1.5 0 0 1-1.5 1.5H9V7zM2.5 16A1.5 1.5 0 0 1 1 14.5V7h6v9z"/>
</svg>`;
const tablerGiftFilledIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="rgba(255, 255, 255, 0.4">
  <path d="M11 14v8h-4a3 3 0 0 1 -3 -3v-4a1 1 0 0 1 1 -1h6zm8 0a1 1 0 0 1 1 1v4a3 3 0 0 1 -3 3h-4v-8h6zm-2.5 -12a3.5 3.5 0 0 1 3.163 5h.337a2 2 0 0 1 2 2v1a2 2 0 0 1 -2 2h-7v-5h-2v5h-7a2 2 0 0 1 -2 -2v-1a2 2 0 0 1 2 -2h.337a3.486 3.486 0 0 1 -.337 -1.5c0 -1.933 1.567 -3.5 3.483 -3.5c1.755 -.03 3.312 1.092 4.381 2.934l.136 .243c1.033 -1.914 2.56 -3.114 4.291 -3.175l.209 -.002zm-9 2a1.5 1.5 0 0 0 0 3h3.143c-.741 -1.905 -1.949 -3.02 -3.143 -3zm8.983 0c-1.18 -.02 -2.385 1.096 -3.126 3h3.143a1.5 1.5 0 1 0 -.017 -3z"/>
</svg>`
const reactIconsIO5GiftIconFilledSharpSVG = `<svg stroke="rgba(255, 255, 255, 0.4)" fill="rgba(255, 255, 255, 0.4)" stroke-width="0" viewBox="0 0 512 512" height="30" width="30" xmlns="http://www.w3.org/2000/svg"><path fill="none" d="M346 110a34 34 0 0 0-68 0v34h34a34 34 0 0 0 34-34zm-112 0a34 34 0 1 0-34 34h34z"></path><path d="M234 144h44v112h164a22 22 0 0 0 22-22v-68a22 22 0 0 0-22-22h-59.82A77.95 77.95 0 0 0 256 55.79 78 78 0 0 0 129.81 144H70a22 22 0 0 0-22 22v68a22 22 0 0 0 22 22h164zm44-34a34 34 0 1 1 34 34h-34zm-112 0a34 34 0 1 1 68 0v34h-34a34 34 0 0 1-34-34zm112 370h132a22 22 0 0 0 22-22V288H278zM80 458a22 22 0 0 0 22 22h132V288H80z"></path></svg>`
const reactIconsIO5GiftIconFilledSVG = `<svg stroke="rgba(255, 255, 255, 0.4)" fill="rgba(255, 255, 255, 0.4)" stroke-width="0" viewBox="0 0 512 512" height="30" width="30" xmlns="http://www.w3.org/2000/svg"><path fill="none" d="M200 144h40v-40a40 40 0 1 0-40 40zm152-40a40 40 0 0 0-80 0v40h40a40 40 0 0 0 40-40z"></path><path d="M80 416a64 64 0 0 0 64 64h92a4 4 0 0 0 4-4V292a4 4 0 0 0-4-4H88a8 8 0 0 0-8 8zm160-164V144h32v108a4 4 0 0 0 4 4h140a47.93 47.93 0 0 0 16-2.75A48.09 48.09 0 0 0 464 208v-16a48 48 0 0 0-48-48h-40.54a2 2 0 0 1-1.7-3A72 72 0 0 0 256 58.82 72 72 0 0 0 138.24 141a2 2 0 0 1-1.7 3H96a48 48 0 0 0-48 48v16a48.09 48.09 0 0 0 32 45.25A47.93 47.93 0 0 0 96 256h140a4 4 0 0 0 4-4zm32-148a40 40 0 1 1 40 40h-40zm-74.86-39.9A40 40 0 0 1 240 104v40h-40a40 40 0 0 1-2.86-79.89zM276 480h92a64 64 0 0 0 64-64V296a8 8 0 0 0-8-8H276a4 4 0 0 0-4 4v184a4 4 0 0 0 4 4z"></path></svg>`
const reactIconsHi2GiftIconFilledSVG = `<svg stroke="rgba(255, 255, 255, 0.4)" fill="rgba(255, 255, 255, 0.4)" stroke-width="0" viewBox="0 0 24 24" aria-hidden="true" height="30" width="30" xmlns="http://www.w3.org/2000/svg"><path d="M11.25 3v4.046a3 3 0 0 0-4.277 4.204H1.5v-6A2.25 2.25 0 0 1 3.75 3h7.5ZM12.75 3v4.011a3 3 0 0 1 4.239 4.239H22.5v-6A2.25 2.25 0 0 0 20.25 3h-7.5ZM22.5 12.75h-8.983a4.125 4.125 0 0 0 4.108 3.75.75.75 0 0 1 0 1.5 5.623 5.623 0 0 1-4.875-2.817V21h7.5a2.25 2.25 0 0 0 2.25-2.25v-6ZM11.25 21v-5.817A5.623 5.623 0 0 1 6.375 18a.75.75 0 0 1 0-1.5 4.126 4.126 0 0 0 4.108-3.75H1.5v6A2.25 2.25 0 0 0 3.75 21h7.5Z"></path><path d="M11.085 10.354c.03.297.038.575.036.805a7.484 7.484 0 0 1-.805-.036c-.833-.084-1.677-.325-2.195-.843a1.5 1.5 0 0 1 2.122-2.12c.517.517.759 1.36.842 2.194ZM12.877 10.354c-.03.297-.038.575-.036.805.23.002.508-.006.805-.036.833-.084 1.677-.325 2.195-.843A1.5 1.5 0 0 0 13.72 8.16c-.518.518-.76 1.362-.843 2.194Z"></path></svg>`

function createGiftIcon(doc: Document): HTMLElement {
  const iconDiv = doc.createElement('div');
  iconDiv.className = '_1tIg-QIrwMNtCm7NcYADyi k-QNT9kzOEOvG0U_kGmwr';
  iconDiv.style.cursor = 'pointer';
  iconDiv.innerHTML = reactIconsIO5GiftIconFilledSharpSVG;

  // Easter egg: click behavior to trigger confetti
  iconDiv.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    fireConfetti(doc);

    iconDiv.style.transform = 'scale(1.2)';
    setTimeout(() => iconDiv.style.transform = 'scale(1)', 100);
  });

  return iconDiv;
}

function fireConfetti(doc: Document) {
  log("fired confetti!");
  
  const canvas = doc.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.zIndex = '99999';
  canvas.style.pointerEvents = 'none';
  doc.body.appendChild(canvas);

  const myConfetti = confetti.create(canvas, {
    resize: true,
    useWorker: true
  });

  myConfetti({
    particleCount: 150,
    spread: 70,
    origin: { y: 0.6 },
  });

  // Cleanup
  setTimeout(() => {
    if (canvas.parentElement) {
      doc.body.removeChild(canvas);
    }
  }, 5000);
}

function createContentContainer(doc: Document, data?: licenseData): HTMLElement {
  const textDiv = doc.createElement('div');
  textDiv.className = '_3m_zjRTQBqcfzCjXLXUHcR';

  const labelDiv = doc.createElement('div');
  labelDiv.className = '_34lrt5-Fc3usZU6trA1P0-';
  labelDiv.textContent = 'Gifted';

  const valueDiv = doc.createElement('div');
  valueDiv.className = '_2TYVGoD27ZMfjRirKQNLfk';

  if (data === undefined) {
    valueDiv.textContent = 'Loading...';
  } else if (!data || !data.acquisition) {
    valueDiv.textContent = 'License data not found';
  } else {
    valueDiv.textContent = `${data.date}`;
  }

  textDiv.appendChild(labelDiv);
  textDiv.appendChild(valueDiv);

  return textDiv;
}

/**
 * Creates the Gratitude Display element with a unique ID per game.
 * 
 * @returns HTMLElement if display should be shown, null otherwise
 */
export function createDisplay(
  doc: Document,
  gameName: string,
  data?: licenseData
): HTMLElement | null {
  log('Creating display with data:', data);

  // Don't create anything if not a gift
  if (data?.acquisition !== "Gift/Guest Pass") {
    log("Not a gift:", data);
    return null;
  }

  // Main container matching Achievements structure with unique ID per game
  const container = doc.createElement('div');
  container.id = createDisplayId(gameName);
  container.className = '_1kiZKVbDe-9Ikootk57kpA';

  // Add icons and content
  const icon = createGiftIcon(doc);
  container.appendChild(icon);
  container.appendChild(createContentContainer(doc, data));

  log('Created display container:', container);

  return container;
}

export function getExistingDisplay(doc: Document, gameName: string): HTMLElement | null {
  return doc.getElementById(createDisplayId(gameName));
}