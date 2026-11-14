import { SELECTORS } from '../types';
import { log } from '../../lib/logger';

// The last title in the document, matching the injection engine, which uses the last stats row.
// While Steam swaps pages both can be present, and the badge must describe the page it sits in.
function findGameNameElement(doc: Document): Element | null {
  for (const selector of [SELECTORS.standard.gameName, SELECTORS.bigPicture.gameName]) {
    const matches = doc.querySelectorAll(selector);
    if (matches.length) return matches[matches.length - 1];
  }
  return null;
}

export function detectGameName(doc: Document): string | null {
  return findGameNameElement(doc)?.textContent?.trim() || null;
}

// How many levels above the game title to look for the game's own App ID. One level up is the
// play bar's icon-and-title block, whose icon URL carries the App ID; a few more levels stay
// within the game's header. Searching wider reaches the game list, whose icons belong to other games.
const APP_ID_SEARCH_DEPTH = 3;

function parseAppId(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return !isNaN(parsed) && parsed > 0 ? parsed : null;
}

function getAppIdFromDataAttribute(scope: ParentNode): number | null {
  return parseAppId(scope.querySelector('[data-appid]')?.getAttribute('data-appid') ?? undefined);
}

const APP_LINK_PATTERN = /(?:steam:\/\/nav\/games\/details\/|steam:\/\/rungameid\/|steam:\/\/store\/|steam:\/\/url\/StorePage\/|steam:\/\/url\/StoreAppPage\/|store\.steampowered\.com\/app\/|steamcommunity\.com\/app\/)(\d+)/i;

function getAppIdFromLinks(scope: ParentNode): number | null {
  for (const link of Array.from(scope.querySelectorAll('a[href]'))) {
    const parsed = parseAppId((link.getAttribute('href') ?? '').match(APP_LINK_PATTERN)?.[1]);
    if (parsed) return parsed;
  }
  return null;
}

// Steam uses /apps/<appid>/ or /assets/<appid>/ in image URLs
const APP_IMAGE_PATTERN = /\/(?:apps|assets)\/(\d+)\//i;

function getAppIdFromImages(scope: ParentNode): number | null {
  for (const img of Array.from(scope.querySelectorAll('img[src]'))) {
    const parsed = parseAppId((img.getAttribute('src') ?? '').match(APP_IMAGE_PATTERN)?.[1]);
    if (parsed) return parsed;
  }
  return null;
}

const DOM_STRATEGIES = [
  { source: 'data-appid', find: getAppIdFromDataAttribute },
  { source: 'link href', find: getAppIdFromLinks },
  { source: 'image src', find: getAppIdFromImages },
];

// The App ID shown around the open game's title. Searching the whole window would find the first
// game in the library list instead of this one.
function getAppIdNearTitle(doc: Document): { appId: number; source: string } | null {
  let scope = findGameNameElement(doc)?.parentElement ?? null;
  for (let depth = 0; scope && depth < APP_ID_SEARCH_DEPTH; depth++, scope = scope.parentElement) {
    for (const { source, find } of DOM_STRATEGIES) {
      const appId = find(scope);
      if (appId !== null) return { appId, source };
    }
  }
  return null;
}

// Steam's own globals in the client UI context; they aren't typed
interface SteamGlobals {
  SteamUIStore?: { WindowStore?: { GetWindowInstanceFromWindow?: (w: Window | null) => { History?: { location?: { pathname?: string } } } | null } };
  appStore?: { GetAppOverviewByAppID?: (appId: number) => { display_name?: string } | null };
}

// The App ID in the route of the Steam window showing doc (/library/app/<id>)
function getAppIdFromRoute(doc: Document): number | null {
  try {
    const windowStore = (window as unknown as SteamGlobals).SteamUIStore?.WindowStore;
    const path = windowStore?.GetWindowInstanceFromWindow?.(doc.defaultView)?.History?.location?.pathname ?? '';
    return parseAppId(path.match(/\/library\/app\/(\d+)/)?.[1]);
  } catch {
    return null;
  }
}

function getAppName(appId: number): string | null {
  try {
    return (window as unknown as SteamGlobals).appStore?.GetAppOverviewByAppID?.(appId)?.display_name ?? null;
  } catch {
    return null;
  }
}

// This runs on every page change, so only log when the answer changes
let lastLogged = '';
function logDetected(appId: number | null, source: string) {
  const entry = `${appId}:${source}`;
  if (entry === lastLogged) return;
  lastLogged = entry;
  if (appId !== null) log(`Detected App ID from ${source}:`, appId);
}

// Finds the App ID of the game whose page is open. Returns null when it can't tell, and the
// caller then matches by name.
// On the desktop the play bar icon next to the title carries it. Big Picture's icon doesn't, so
// there it comes from the window's route, but only once the route's game is the one whose title
// is shown: Steam changes the route as soon as it navigates and can draw the new page later, and
// the answer must describe the page the badge sits in.
export function detectAppId(doc: Document): number | null {
  const nearTitle = getAppIdNearTitle(doc);
  if (nearTitle) {
    logDetected(nearTitle.appId, nearTitle.source);
    return nearTitle.appId;
  }

  const fromRoute = getAppIdFromRoute(doc);
  const title = detectGameName(doc);
  if (fromRoute !== null && title !== null && getAppName(fromRoute) === title) {
    logDetected(fromRoute, 'route');
    return fromRoute;
  }

  logDetected(null, 'none');
  return null;
}
