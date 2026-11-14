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
  const parsed = parseAppId(scope.querySelector('[data-appid]')?.getAttribute('data-appid') ?? undefined);
  if (parsed) log('Detected App ID from data-appid:', parsed);
  return parsed;
}

const APP_LINK_PATTERN = /(?:steam:\/\/nav\/games\/details\/|steam:\/\/rungameid\/|steam:\/\/store\/|steam:\/\/url\/StorePage\/|steam:\/\/url\/StoreAppPage\/|store\.steampowered\.com\/app\/|steamcommunity\.com\/app\/)(\d+)/i;

function getAppIdFromLinks(scope: ParentNode): number | null {
  for (const link of Array.from(scope.querySelectorAll('a[href]'))) {
    const href = link.getAttribute('href') ?? '';
    const parsed = parseAppId(href.match(APP_LINK_PATTERN)?.[1]);
    if (parsed) {
      log('Detected App ID from link href:', parsed, href);
      return parsed;
    }
  }
  return null;
}

// Steam uses /apps/<appid>/ or /assets/<appid>/ in image URLs
const APP_IMAGE_PATTERN = /\/(?:apps|assets)\/(\d+)\//i;

function getAppIdFromImages(scope: ParentNode): number | null {
  for (const img of Array.from(scope.querySelectorAll('img[src]'))) {
    const src = img.getAttribute('src') ?? '';
    const parsed = parseAppId(src.match(APP_IMAGE_PATTERN)?.[1]);
    if (parsed) {
      log('Detected App ID from image src:', parsed, src);
      return parsed;
    }
  }
  return null;
}

// Finds the App ID of the game whose page is open, searching only around its title. Returns null
// when none is found there, and the caller then matches by name. Searching the whole window would
// find the first game in the library list instead of this one.
export function detectAppId(doc: Document): number | null {
  const strategies = [getAppIdFromDataAttribute, getAppIdFromLinks, getAppIdFromImages];

  let scope = findGameNameElement(doc)?.parentElement ?? null;
  for (let depth = 0; scope && depth < APP_ID_SEARCH_DEPTH; depth++, scope = scope.parentElement) {
    for (const strategy of strategies) {
      const id = strategy(scope);
      if (id !== null) {
        return id;
      }
    }
  }

  return null;
}
