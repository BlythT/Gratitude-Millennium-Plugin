import { SELECTORS } from '../types';
import { log } from '../../lib/logger';

export function detectGameName(doc: Document): string | null {
  let nameElem = doc.querySelector(SELECTORS.standard.gameName);

  if (!nameElem) {
    nameElem = doc.querySelector(SELECTORS.bigPicture.gameName);
  }

  return nameElem?.textContent?.trim() || null;
}

export function detectAppId(doc: Document): number | null {
  const appIdElement = doc.querySelector('[data-appid]');
  if (appIdElement) {
    const appIdAttr = appIdElement.getAttribute('data-appid');
    if (appIdAttr) {
      const parsed = parseInt(appIdAttr, 10);
      if (!isNaN(parsed) && parsed > 0) {
        log('Detected App ID from data-appid:', parsed);
        return parsed;
      }
    }
  }

  const links = doc.querySelectorAll('a[href]');
  for (const link of Array.from(links)) {
    const href = link.getAttribute('href');
    if (!href) continue;

    const match = href.match(/(?:steam:\/\/rungameid\/|steam:\/\/store\/|steam:\/\/url\/StorePage\/|steam:\/\/url\/StoreAppPage\/|store\.steampowered\.com\/app\/|steamcommunity\.com\/app\/)(\d+)/i);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        log('Detected App ID from link href:', parsed, href);
        return parsed;
      }
    }
  }

  return null;
}
