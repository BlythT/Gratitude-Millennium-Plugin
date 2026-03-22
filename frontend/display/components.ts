// Modified from https://github.com/jcdoll/hltb-millennium-plugin
import { ICONS, UI_CLASSES, type GiverData, type LicenseData, type LicenseMatch } from '../types'
import { log } from '../../lib/logger';
import confetti from 'canvas-confetti';
import { showGiverModal } from '../components/GiverModal';

function createDisplayId(gameName: string): string {
  return 'gratitude-' + gameName.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

function createGiftIcon(doc: Document): HTMLElement {
  const iconDiv = doc.createElement('div');
  iconDiv.className = UI_CLASSES.iconContainer;
  iconDiv.style.cursor = 'pointer';
  iconDiv.innerHTML = ICONS.gift;

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

function createQuestionIcon(doc: Document): HTMLElement {
  const iconDiv = doc.createElement('div');
  iconDiv.className = UI_CLASSES.iconContainer;

  iconDiv.innerHTML = ICONS.question;
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

function createContentContainer(
  doc: Document,
  data?: LicenseData,
  giver?: GiverData | null,
  onManageGiver?: () => void,
): HTMLElement {
  const textDiv = doc.createElement('div');
  textDiv.className = UI_CLASSES.textContainer;

  if (onManageGiver) {
    textDiv.style.cursor = 'pointer';
    textDiv.title = giver ? `Gifted by ${giver.displayName}` : 'Add Giver';
    textDiv.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onManageGiver();
    });
  }

  const labelDiv = doc.createElement('div');
  labelDiv.className = UI_CLASSES.label;
  labelDiv.textContent = 'Gifted';

  const valueDiv = doc.createElement('div');
  valueDiv.className = UI_CLASSES.value;

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
  match: LicenseMatch,
  giver: GiverData | null,
  steamUserID: string,
  onGiverUpdated: () => void,
): HTMLElement | null {
  const data = match.data;
  log('Creating display with data:', data);

  // Don't create anything if not a gift
  if (data?.acquisition !== "Gift/Guest Pass") {
    log("Not a gift:", data);
    // return invisible placeholder to signal no display needed
    const placeholder = doc.createElement('div');
    placeholder.id = createDisplayId(gameName);
    placeholder.style.display = 'none';
    return placeholder;
  }

  // Main container matching Achievements structure with unique ID per game
  const container = doc.createElement('div');
  container.id = createDisplayId(gameName);
  container.className = UI_CLASSES.displayContainer;
  container.style.contain = 'layout';
  container.style.contentVisibility = 'auto';

  // Add icons and content
  const icon = createGiftIcon(doc);
  container.appendChild(icon);
  container.appendChild(createContentContainer(doc, data, giver, () => {
    showGiverModal({
      parentWindow: doc.defaultView ?? window,
      steamUserID,
      gameTitle: gameName,
      licenseKey: match.licenseKey,
      giftDate: data.date,
      existingGiver: giver,
      onSaved: onGiverUpdated,
      onDeleted: onGiverUpdated,
    });
  }));

  log('Created display container:', container);

  return container;
}

/**
 * Creates a component which informs the user data is missing and they should refresh their cache (go to Steam store page).
 * * @returns HTMLElement if created, null otherwise
 */
export function createMissingDataDisplay(doc: Document, gameName: string): HTMLElement | null {
  log('Creating missing data display for:', gameName);
  // same format as createDisplay, but with different icon and text
  const container = doc.createElement('div');
  container.id = createDisplayId(gameName);
  container.className = UI_CLASSES.displayContainer;
  container.style.cursor = 'pointer';
  container.title = 'License data not found, click to refresh (opens store page)';
  // onclick, navigate to store page
  container.addEventListener('click', () => {
    window.open("steam://store/");
  });

  // Add icons and content
  const icon = createQuestionIcon(doc);
  container.appendChild(icon);
  container.appendChild(createContentContainer(doc, undefined));
  container.dataset.missing = 'true';
  log('Created missing data display container:', container);

  return container;
}

export function getExistingDisplay(doc: Document, gameName: string): HTMLElement | null {
  return doc.getElementById(createDisplayId(gameName));
}
