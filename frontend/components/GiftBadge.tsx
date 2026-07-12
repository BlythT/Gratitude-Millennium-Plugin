import React, { useState, useEffect } from 'react';
import { UI_CLASSES, type LicenseMatch } from '../types';
import { log, logDebug } from '../../lib/logger';
import confetti from 'canvas-confetti';
import { showGiverModal } from './GiverModal';
import { gameLicenseCache, type UserLicenseCache } from '../injection/gamelicensecache';
import { giverCache } from '../injection/givercache';
import { getCurrentAccountID } from '../../lib/steamid';
import { detectGameName, detectAppId } from '../utils/dom';
import { fuzzyMatchLicenseName } from '../../lib/license-matching.js';

import { SteamTooltip } from './SteamTooltip';

let confettiTimeout: ReturnType<typeof setTimeout> | null = null;

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
  return (
    <SteamTooltip toolTipContent={tooltipText}>
      <div 
        className={`${UI_CLASSES.displayContainer} _3pS8kMrtScuY1Qf-W8tmRV Panel`}
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
    </SteamTooltip>
  );
};

export const GiftBadge: React.FC<{ doc: Document }> = ({ doc }) => {
  const [_forceRender, setForceRender] = useState(0);
  const steamID = getCurrentAccountID();
  
  // We grab these synchronously on mount so we don't tear on DOM changes
  const [domData] = useState(() => {
    return {
      gameName: detectGameName(doc),
      appId: detectAppId(doc)
    };
  });

  const { gameName, appId } = domData;

  const [licenseDataMap, setLicenseDataMap] = useState<UserLicenseCache | null>(
    () => steamID ? gameLicenseCache.getDataSync(steamID) || null : null
  );

  useEffect(() => {
    if (!steamID) return;
    return gameLicenseCache.observe(steamID, (data) => {
      setLicenseDataMap(data);
    });
  }, [steamID]);

  useEffect(() => {
    if (steamID) {
       giverCache.getAll(steamID).then(() => {
          setForceRender(n => n + 1); // trigger re-render to pick up new giver data
       });
    }
  }, [steamID]);

  if (!steamID || !gameName) {
    return null;
  }

  if (!licenseDataMap) {
    logDebug(`[GiftBadge] Render aborted: Cache data is missing or not yet loaded.`);
    return null; 
  }

  let match: LicenseMatch | null = null;
  if (appId) {
    const license = licenseDataMap.byAppId.get(String(appId));
    if (license) {
      match = { licenseKey: String(appId), data: license, matchType: 'appid-exact' };
    }
  }
  if (!match) {
    const fuzzyMatch = fuzzyMatchLicenseName(licenseDataMap.byName, gameName);
    if (fuzzyMatch) {
      match = { licenseKey: fuzzyMatch.licenseKey, data: fuzzyMatch.data, matchType: fuzzyMatch.matchType };
    }
  }

  if (!match) {
    logDebug(`[GiftBadge] Rendering Question icon because no cache match was found for "${gameName}".`);
    const handleMissingClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      gameLicenseCache.invalidate(steamID);
      window.open("steam://store/");
    };

    return (
      <Badge
        icon={<QuestionIcon />}
        tooltipText="License data not found. Click to refresh (opens store page)."
        valueText="Loading..."
        onIconClick={handleMissingClick}
        onTextClick={handleMissingClick}
      />
    );
  }
  
  if (match.data.acquisition !== "Gift/Guest Pass") {
    logDebug(`[GiftBadge] Render aborted: Found game "${gameName}" in cache but acquisition is "${match.data.acquisition}" (not Gift).`);
    return null; // Not a gifted game, render nothing
  }

  const giver = giverCache.getEntrySync(steamID, match.licenseKey, gameName);

  logDebug(`[GiftBadge] Rendering Gift icon for "${gameName}".`);

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
      steamUserID: steamID,
      gameTitle: gameName,
      licenseKey: match!.licenseKey,
      giftDate: match!.data.date,
      existingGiver: giver,
      onSaved: () => setForceRender(n => n + 1),
      onDeleted: () => setForceRender(n => n + 1),
    });
  };

  const tooltipText = giver 
    ? `Gifted by ${giver.displayName} on ${match.data.date}${giver.notes ? ` - ${giver.notes}` : ''}` 
    : `Gifted on ${match.data.date} - Click to record gifter info`;

  return (
    <Badge
      icon={<GiftIcon />}
      tooltipText={tooltipText}
      valueText={match.data.date}
      onIconClick={handleConfetti}
      onTextClick={handleManageGiver}
    />
  );
};
