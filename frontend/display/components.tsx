import React from 'react';
import ReactDOM from 'react-dom';
import { findModuleDetailsByExport } from '@steambrew/client';
import { ICONS, UI_CLASSES, type GiverData, type LicenseMatch } from '../types';
import { log } from '../../lib/logger';
import confetti from 'canvas-confetti';
import { showGiverModal } from '../components/GiverModal';

// Find Steam's native Tooltip component
const Tooltip = findModuleDetailsByExport(
  (m) =>
    m?.toString?.()?.includes(`divProps`) &&
    m?.toString?.()?.includes(`tooltipProps`) &&
    m?.toString?.()?.includes(`toolTipContent`) &&
    m?.toString?.()?.includes(`tool-tip-source`),
)?.[1];

function createDisplayId(gameName: string): string {
  return 'gratitude-' + gameName.toLowerCase().replace(/[^a-z0-9]/g, '-');
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

interface SafeTooltipProps {
  toolTipContent: React.ReactNode;
  fallbackText: string;
  children?: React.ReactElement;
}

const SafeTooltip = ({ toolTipContent, fallbackText, children }: SafeTooltipProps) => {
  if (!children) return null;
  if (Tooltip) {
    return <Tooltip toolTipContent={toolTipContent}>{children}</Tooltip>;
  }
  return React.cloneElement(children, {
    title: fallbackText
  } as any);
};

const GiftedTooltipContent = ({ giver, date }: { giver: GiverData | null; date: string }) => {
  return (
    <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ fontWeight: 500 }}>{giver ? `Gifted by ${giver.displayName}` : 'Gifted Game'}</div>
      {giver?.notes && <div style={{ fontSize: '12px', opacity: 0.8, maxWidth: '200px', wordBreak: 'break-word' }}>{giver.notes}</div>}
      <div style={{ fontSize: '12px', opacity: 0.8 }}>Acquired: {date}</div>
      {!giver && <div style={{ fontSize: '11px', opacity: 0.6, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '4px', marginTop: '2px' }}>Click to record gifter info</div>}
    </div>
  );
};

const MissingDataTooltipContent = () => {
  return (
    <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ fontWeight: 500 }}>License data not found</div>
      <div style={{ fontSize: '12px', opacity: 0.8 }}>Click to refresh (opens store page)</div>
    </div>
  );
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
    ? `Gifted by ${giver.displayName}${giver.notes ? ` - ${giver.notes}` : ''}. Acquired: ${data.date}` 
    : `Gifted Game. Acquired: ${data.date}. Click to record gifter info.`;

  const tooltipContent = <GiftedTooltipContent giver={giver} date={data.date} />;

  return (
    <>
      <SafeTooltip toolTipContent={tooltipContent} fallbackText={tooltipText}>
        <div 
          className={UI_CLASSES.iconContainer} 
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          onClick={handleConfetti}
          dangerouslySetInnerHTML={{ __html: ICONS.gift }}
        />
      </SafeTooltip>
      <SafeTooltip toolTipContent={tooltipContent} fallbackText={tooltipText}>
        <div 
          className={UI_CLASSES.textContainer} 
          style={{ cursor: 'pointer' }}
          onClick={handleManageGiver}
        >
          <div className={UI_CLASSES.label}>Gifted</div>
          <div className={UI_CLASSES.value}>{data.date}</div>
        </div>
      </SafeTooltip>
    </>
  );
};

const MissingDataBadge = () => {
  const handleClick = () => {
    window.open("steam://store/");
  };

  const tooltipText = 'License data not found, click to refresh (opens store page)';
  const tooltipContent = <MissingDataTooltipContent />;

  return (
    <>
      <SafeTooltip toolTipContent={tooltipContent} fallbackText={tooltipText}>
        <div 
          className={UI_CLASSES.iconContainer}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          onClick={handleClick}
          dangerouslySetInnerHTML={{ __html: ICONS.question }}
        />
      </SafeTooltip>
      <SafeTooltip toolTipContent={tooltipContent} fallbackText={tooltipText}>
        <div 
          className={UI_CLASSES.textContainer} 
          style={{ cursor: 'pointer' }}
          onClick={handleClick}
        >
          <div className={UI_CLASSES.label}>Gifted</div>
          <div className={UI_CLASSES.value}>Loading...</div>
        </div>
      </SafeTooltip>
    </>
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
    const placeholder = doc.createElement('div');
    placeholder.id = createDisplayId(gameName);
    placeholder.style.display = 'none';
    return placeholder;
  }

  const container = doc.createElement('div');
  container.id = createDisplayId(gameName);
  container.className = UI_CLASSES.displayContainer;
  container.style.contain = 'layout';
  container.style.contentVisibility = 'auto';
  
  // Render using ReactDOM.createRoot (matching size-on-disk pattern)
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

  log('Created display container:', container);
  return container;
}

export function createMissingDataDisplay(doc: Document, gameName: string): HTMLElement | null {
  log('Creating missing data display for:', gameName);
  
  const container = doc.createElement('div');
  container.id = createDisplayId(gameName);
  container.className = UI_CLASSES.displayContainer;
  container.dataset.missing = 'true';

  const root = (ReactDOM as any).createRoot(container);
  root.render(
    <MissingDataBadge />
  );

  log('Created missing data display container:', container);
  return container;
}

export function getExistingDisplay(doc: Document, gameName: string): HTMLElement | null {
  return doc.getElementById(createDisplayId(gameName));
}
