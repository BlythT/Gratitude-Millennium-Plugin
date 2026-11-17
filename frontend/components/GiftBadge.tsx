import React, { useState, useEffect } from 'react';
import { applyGiftHistory } from '../injection/gifthistory';
import { t, giftDate, uiLanguage } from '../i18n';
import { Focusable, type FocusableProps } from '@steambrew/client';
import { UI_CLASSES, type LicenseMatch } from '../types';
import { log, logDebug } from '../../lib/logger';
import confetti from 'canvas-confetti';
import { showGiverModal } from './GiverModal';
import { gameLicenseCache, type UserLicenseCache } from '../injection/gamelicensecache';
import { giverCache } from '../injection/givercache';
import { getCurrentAccountID } from '../../lib/steamid';
import { detectGameName, detectAppId } from '../utils/dom';
import { isBorrowed, ownerAccountIdOf, purchasedTimeOf } from '../utils/ownership';
import { fuzzyMatchLicenseName } from '../../lib/license-matching.js';
import { chooseLicenseByDate } from '../../lib/license-by-date';
import { giftVerdictForApp, formatLicenseDate, type ClientLicense } from '../../lib/client-licenses';
import { getClientLicensesSync, loadClientLicenses, observeClientLicenses } from '../injection/clientlicenses';

import { SteamTooltip } from './SteamTooltip';

let confettiTimeout: ReturnType<typeof setTimeout> | null = null;

function fireConfetti(doc: Document) {
  // No confetti for people who have asked their system to reduce motion
  if (doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
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

// Sized and placed like Steam's Achievements icon: a 30px icon in a box with a 1px top and 5px
// bottom margin. The plain icon box class has a 3px margin, which sits it 2px below the trophy.
const STAT_ICON_PROPS = {
  height: 30,
  width: 30,
  style: { display: 'block' },
};
const STAT_ICON_BOX_MARGIN = '1px 3px 5px';

const GiftIcon = () => (
  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 512 512" {...STAT_ICON_PROPS} xmlns="http://www.w3.org/2000/svg">
    <path fill="none" d="M346 110a34 34 0 0 0-68 0v34h34a34 34 0 0 0 34-34zm-112 0a34 34 0 1 0-34 34h34z" />
    <path d="M234 144h44v112h164a22 22 0 0 0 22-22v-68a22 22 0 0 0-22-22h-59.82A77.95 77.95 0 0 0 256 55.79 78 78 0 0 0 129.81 144H70a22 22 0 0 0-22 22v68a22 22 0 0 0 22 22h164zm44-34a34 34 0 1 1 34 34h-34zm-112 0a34 34 0 1 1 68 0v34h-34a34 34 0 0 1-34-34zm112 370h132a22 22 0 0 0 22-22V288H278zM80 458a22 22 0 0 0 22 22h132V288H80z" />
  </svg>
);

const QuestionIcon = () => (
  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 384 512" {...STAT_ICON_PROPS} xmlns="http://www.w3.org/2000/svg">
    <path d="M202.021 0C122.202 0 70.503 32.703 29.914 91.026c-7.363 10.58-5.093 25.086 5.178 32.874l43.138 32.709c10.373 7.865 25.132 6.026 33.253-4.148 25.049-31.381 43.63-49.449 82.757-49.449 30.764 0 68.816 19.799 68.816 49.631 0 22.552-18.617 34.134-48.993 51.164-35.423 19.86-82.299 44.576-82.299 106.405V320c0 13.255 10.745 24 24 24h72.471c13.255 0 24-10.745 24-24v-5.773c0-42.86 125.268-44.645 125.268-160.627C377.504 66.256 286.902 0 202.021 0zM192 373.459c-38.196 0-69.271 31.075-69.271 69.271 0 38.195 31.075 69.27 69.271 69.27s69.271-31.075 69.271-69.271-31.075-69.27-69.271-69.27z" />
  </svg>
);

interface BadgeProps {
  icon: React.ReactNode;
  tooltipText: string;
  valueText: string;
  onIconClick: (e?: React.SyntheticEvent) => void;
  onTextClick: (e?: React.SyntheticEvent) => void;
}

// Focusable declares children as required, which this project's JSX typing doesn't count as passed
const FocusBox = Focusable as unknown as React.FC<Omit<FocusableProps, 'children'> & { children?: React.ReactNode }>;

// The tooltip sits on the label and date, which open the gift details; the icon fires confetti,
// so it has none
const Badge = ({ icon, tooltipText, valueText, onIconClick, onTextClick }: BadgeProps) => {
  // The badge is a button: a controller can move onto it (Steam's Focusable) and press A, the
  // keyboard can Tab to it and press Enter or Space, and a screen reader reads its tooltip. One
  // press can arrive as both a key and an A, so it only acts once.
  const lastActivated = React.useRef(0);
  const activate = () => {
    if (Date.now() - lastActivated.current < 500) return;
    lastActivated.current = Date.now();
    onTextClick();
  };
  return (
      <FocusBox
        className={`${UI_CLASSES.displayContainer} _3pS8kMrtScuY1Qf-W8tmRV Panel`}
        onActivate={activate}
        role="button"
        tabIndex={0}
        aria-label={`${t('badge.label')}, ${valueText}. ${tooltipText}`}
        lang={uiLanguage()}
        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        }}
      >
        <div 
          className={UI_CLASSES.iconContainer} 
          onClick={onIconClick}
          aria-hidden="true"
          style={{ cursor: 'pointer', margin: STAT_ICON_BOX_MARGIN }}
        >
          {icon}
        </div>
        <SteamTooltip toolTipContent={tooltipText}>
          <div 
            className={UI_CLASSES.textContainer} 
            onClick={onTextClick}
            style={{ cursor: 'pointer' }}
          >
            <div className={UI_CLASSES.label}>{t('badge.label')}</div>
            <div className={UI_CLASSES.value}>{valueText}</div>
          </div>
        </SteamTooltip>
      </FocusBox>
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

  // Steam's own license list, when it could be read; refreshed in the background when it's old
  const [clientLicenses, setClientLicenses] = useState<ClientLicense[] | null>(() => getClientLicensesSync());
  useEffect(() => {
    const stop = observeClientLicenses(setClientLicenses);
    if (steamID) void loadClientLicenses(steamID);
    return stop;
  }, [steamID]);

  useEffect(() => {
    if (steamID) {
       giverCache.getAll(steamID).then(() => {
          setForceRender(n => n + 1); // trigger re-render to pick up new giver data
       });
       // Gifters found in the Steam inventory history, filled in where none is saved
       void applyGiftHistory(steamID).then((added) => {
          if (added) setForceRender(n => n + 1);
       });
    }
  }, [steamID]);

  if (!steamID || !gameName) {
    return null;
  }

  // A game borrowed through Family Sharing isn't the user's license, so it can't have been gifted
  // to them, and a sync would never find it
  if (appId && isBorrowed(ownerAccountIdOf(appId), steamID)) {
    logDebug(`[GiftBadge] Render aborted: "${gameName}" is borrowed through Family Sharing.`);
    return null;
  }

  let match: LicenseMatch | null = null;

  // Steam's license list says by App ID whether a license for this game was a gift, with no name
  // matching. When it can't tell (it couldn't be read, or doesn't list the game), the licenses
  // page data below decides.
  const verdict = appId && clientLicenses ? giftVerdictForApp(clientLicenses, appId) : null;
  if (verdict && !verdict.gifted) {
    logDebug(`[GiftBadge] Render aborted: Steam's license list has no gift for "${gameName}".`);
    return null;
  }
  if (verdict?.license?.purchasedTime) {
    match = {
      licenseKey: String(appId),
      data: { date: formatLicenseDate(verdict.license.purchasedTime), acquisition: 'Gift/Guest Pass' },
      matchType: 'client-license',
    };
  }

  if (!match && !licenseDataMap) {
    logDebug(`[GiftBadge] Render aborted: Cache data is missing or not yet loaded.`);
    return null;
  }

  if (!match && appId && licenseDataMap) {
    // The sync matched this App ID to a license by name. Steam's own date for when the user got
    // the game checks that, and finds the right license when the name match picked a preview or
    // free weekend. Gift records stay keyed by App ID whichever license is chosen.
    const synced = licenseDataMap.byAppId.get(String(appId));
    const byDate = chooseLicenseByDate(purchasedTimeOf(appId), synced, licenseDataMap.byName, gameName);
    const license = byDate?.data ?? synced;
    if (license) {
      match = { licenseKey: String(appId), data: license, matchType: byDate?.how ?? 'appid-exact' };
    }
  }
  if (!match && licenseDataMap) {
    const fuzzyMatch = fuzzyMatchLicenseName(licenseDataMap.byName, gameName);
    if (fuzzyMatch) {
      match = { licenseKey: fuzzyMatch.licenseKey, data: fuzzyMatch.data, matchType: fuzzyMatch.matchType };
    }
  }

  if (!match) {
    logDebug(`[GiftBadge] Rendering Question icon because no cache match was found for "${gameName}".`);
    const handleMissingClick = (e?: React.SyntheticEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      gameLicenseCache.invalidate(steamID);
      window.open("steam://openurl/https://store.steampowered.com/?gratitude_sync=1");
    };

    return (
      <Badge
        icon={<QuestionIcon />}
        tooltipText={t('badge.missingTooltip')}
        valueText={t('badge.loading')}
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

  const handleConfetti = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    fireConfetti(doc);
  };

  const handleManageGiver = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
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

  const shownDate = giftDate(match.data.date);
  const tooltipText = giver
    ? giver.notes
      ? t('badge.tooltipFromNote', { name: giver.displayName, note: giver.notes })
      : t('badge.tooltipFrom', { name: giver.displayName })
    : t('badge.tooltipRecord');

  return (
    <Badge
      icon={<GiftIcon />}
      tooltipText={tooltipText}
      valueText={shownDate}
      onIconClick={handleConfetti}
      onTextClick={handleManageGiver}
    />
  );
};
