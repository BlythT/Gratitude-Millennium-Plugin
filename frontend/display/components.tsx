import React from 'react';
import ReactDOM from 'react-dom';
import { findModuleDetailsByExport } from '@steambrew/client';
import { UI_CLASSES, type GiverData, type LicenseMatch } from '../types';
import { log } from '../../lib/logger';
import confetti from 'canvas-confetti';
import { showGiverModal } from '../components/GiverModal';

let Tooltip: any = null;
let searchedTooltip = false;

function getTooltipComponent(): any {
  if (!searchedTooltip) {
    searchedTooltip = true;
    try {
      Tooltip = findModuleDetailsByExport(
        (m) =>
          m?.toString?.()?.includes(`divProps`) &&
          m?.toString?.()?.includes(`tooltipProps`) &&
          m?.toString?.()?.includes(`toolTipContent`) &&
          m?.toString?.()?.includes(`tool-tip-source`),
      )?.[1];
      log('Resolved Steam native Tooltip component:', Tooltip ? 'Success' : 'Not Found');
    } catch (e) {
      log('Error resolving native Tooltip:', e);
    }
  }
  return Tooltip;
}

function createDisplayId(gameName: string): string {
  return 'gratitude-' + gameName.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

let confettiTimeout: any = null;

function fireConfetti(doc: Document) {
  log("fired confetti!");

  const CANVAS_ID = 'gratitude-confetti-canvas';
  let canvas = doc.getElementById(CANVAS_ID) as HTMLCanvasElement | null;

  if (!canvas) {
    canvas = doc.createElement('canvas');
    canvas.id = CANVAS_ID;
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.zIndex = '99999';
    canvas.style.pointerEvents = 'none';
    doc.body.appendChild(canvas);
  } else {
    if (confettiTimeout) {
      clearTimeout(confettiTimeout);
      confettiTimeout = null;
    }
  }

  const myConfetti = confetti.create(canvas, {
    resize: true,
    useWorker: true
  });

  myConfetti({
    particleCount: 150,
    spread: 70,
    origin: { y: 0.6 },
  });

  confettiTimeout = setTimeout(() => {
    if (canvas && canvas.parentElement) {
      doc.body.removeChild(canvas);
    }
    confettiTimeout = null;
  }, 5000);
}

export interface ExplictlyRootedElement extends HTMLElement {
  __reactRoot?: any;
}

export function unmountDisplay(element: HTMLElement): void {
  const rooted = element as ExplictlyRootedElement;
  if (rooted.__reactRoot) {
    try {
      log('Unmounting React root for element:', element.id);
      rooted.__reactRoot.unmount();
    } catch (err) {
      log('Error unmounting React root:', err);
    }
    delete rooted.__reactRoot;
  }
}

const GiftIcon = () => (
  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 512 512" height="30" width="30" xmlns="http://www.w3.org/2000/svg">
    <path fill="none" d="M346 110a34 34 0 0 0-68 0v34h34a34 34 0 0 0 34-34zm-112 0a34 34 0 1 0-34 34h34z" />
    <path d="M234 144h44v112h164a22 22 0 0 0 22-22v-68a22 22 0 0 0-22-22h-59.82A77.95 77.95 0 0 0 256 55.79 78 78 0 0 0 129.81 144H70a22 22 0 0 0-22 22v68a22 22 0 0 0 22 22h164zm44-34a34 34 0 1 1 34 34h-34zm-112 0a34 34 0 1 1 68 0v34h-34a34 34 0 0 1-34-34zm112 370h132a22 22 0 0 0 22-22V288H278zM80 458a22 22 0 0 0 22 22h132V288H80z" />
  </svg>
);

const QuestionIcon = () => (
  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 384 512" height="30" width="30" xmlns="http://www.w3.org/2000/svg">
    <path d="M202.021 0C122.202 0 70.503 32.703 29.914 91.026c-7.363 10.58-5.093 25.086 5.178 32.874l43.138 32.709c10.373 7.865 25.132 6.026 33.253-4.148 25.049-31.381 43.63-49.449 82.757-49.449 30.764 0 68.816 19.799 68.816 49.631 0 22.552-18.617 34.134-48.993 51.164-35.423 19.86-82.299 44.576-82.299 106.405V320c0 13.255 10.745 24 24 24h72.471c13.255 0 24-10.745 24-24v-5.773c0-42.86 125.268-44.645 125.268-160.627C377.504 66.256 286.902 0 202.021 0zM192 373.459c-38.196 0-69.271 31.075-69.271 69.271 0 38.195 31.075 69.27 69.271 69.27s69.271-31.075 69.271-69.271-31.075-69.27-69.271-69.27z" />
  </svg>
);

interface BadgeProps {
  icon: React.ReactNode;
  tooltipText: string;
  valueText: string;
  onIconClick: (e: React.MouseEvent) => void;
  onTextClick: (e: React.MouseEvent) => void;
}

const Badge = ({ icon, tooltipText, valueText, onIconClick, onTextClick }: BadgeProps) => {
  const TooltipComponent = getTooltipComponent();

  const content = (
    <div 
      className={`${UI_CLASSES.displayContainer} _3pS8kMrtScuY1Qf-W8tmRV Panel`}
      title={TooltipComponent ? undefined : tooltipText}
    >
      <div 
        className={UI_CLASSES.iconContainer} 
        onClick={onIconClick}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
      >
        {icon}
      </div>
      <div 
        className={UI_CLASSES.textContainer} 
        onClick={onTextClick}
        style={{ cursor: 'pointer' }}
      >
        <div className={UI_CLASSES.label}>Gifted</div>
        <div className={UI_CLASSES.value}>{valueText}</div>
      </div>
    </div>
  );

  if (TooltipComponent) {
    return <TooltipComponent toolTipContent={tooltipText}>{content}</TooltipComponent>;
  }
  return content;
};

interface GiftedBadgeProps {
  doc: Document;
  gameName: string;
  match: LicenseMatch;
  giver: GiverData | null;
  steamUserID: string;
  onGiverUpdated: () => void;
}

const GiftedBadge = ({ doc, gameName, match, giver, steamUserID, onGiverUpdated }: GiftedBadgeProps) => {
  const data = match.data;

  const handleConfetti = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fireConfetti(doc);
  };

  const handleManageGiver = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
  };

  const tooltipText = giver 
    ? `Gifted by ${giver.displayName} on ${data.date}${giver.notes ? ` - ${giver.notes}` : ''}` 
    : `Gifted on ${data.date} - Click to record gifter info`;

  return (
    <Badge
      icon={<GiftIcon />}
      tooltipText={tooltipText}
      valueText={data.date}
      onIconClick={handleConfetti}
      onTextClick={handleManageGiver}
    />
  );
};

const MissingDataBadge = () => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open("steam://store/");
  };

  const tooltipText = 'License data not found. Click to refresh (opens store page).';

  return (
    <Badge
      icon={<QuestionIcon />}
      tooltipText={tooltipText}
      valueText="Loading..."
      onIconClick={handleClick}
      onTextClick={handleClick}
    />
  );
};

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

  if (data?.acquisition !== "Gift/Guest Pass") {
    log("Not a gift:", data);
    const placeholder = doc.createElement('div') as ExplictlyRootedElement;
    placeholder.id = createDisplayId(gameName);
    placeholder.style.display = 'none';
    return placeholder;
  }

  const container = doc.createElement('div') as ExplictlyRootedElement;
  container.id = createDisplayId(gameName);
  container.className = UI_CLASSES.displayContainer;
  container.style.display = 'contents';
  
  const root = (ReactDOM as any).createRoot(container);
  root.render(
    <GiftedBadge
      doc={doc}
      gameName={gameName}
      match={match}
      giver={giver}
      steamUserID={steamUserID}
      onGiverUpdated={onGiverUpdated}
    />
  );

  container.__reactRoot = root;
  log('Created display container:', container);
  return container;
}

export function createMissingDataDisplay(doc: Document, gameName: string): HTMLElement | null {
  log('Creating missing data display for:', gameName);
  
  const container = doc.createElement('div') as ExplictlyRootedElement;
  container.id = createDisplayId(gameName);
  container.className = UI_CLASSES.displayContainer;
  container.dataset.missing = 'true';
  container.style.display = 'contents';

  const root = (ReactDOM as any).createRoot(container);
  root.render(
    <MissingDataBadge />
  );

  container.__reactRoot = root;
  log('Created missing data display container:', container);
  return container;
}

export function getExistingDisplay(doc: Document, gameName: string): HTMLElement | null {
  return doc.getElementById(createDisplayId(gameName));
}

