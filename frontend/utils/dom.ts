import { SELECTORS } from '../types';
import { log } from '../../lib/logger';

export function detectGameName(doc: Document): string | null {
  let nameElem = doc.querySelector(SELECTORS.standard.gameName);

  if (!nameElem) {
    nameElem = doc.querySelector(SELECTORS.bigPicture.gameName);
  }

  return nameElem?.textContent?.trim() || null;
}



function getAppIdFromDataAttribute(doc: Document): number | null {
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
  return null;
}

function getAppIdFromLinks(doc: Document): number | null {
  const links = doc.querySelectorAll('a[href]');
  for (const link of Array.from(links)) {
    const href = link.getAttribute('href');
    if (!href) continue;

    const match = href.match(/(?:steam:\/\/nav\/games\/details\/|steam:\/\/rungameid\/|steam:\/\/store\/|steam:\/\/url\/StorePage\/|steam:\/\/url\/StoreAppPage\/|store\.steampowered\.com\/app\/|steamcommunity\.com\/app\/)(\d+)/i);
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

function getAppIdFromImages(doc: Document): number | null {
  const images = doc.querySelectorAll('img[src]');
  for (const img of Array.from(images)) {
    const src = img.getAttribute('src');
    if (!src) continue;
    
    // Steam sometimes uses /apps/appid/ or /assets/appid/ in image URLs
    const match = src.match(/\/(?:apps|assets)\/(\d+)\//i);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        log('Detected App ID from image src:', parsed, src);
        return parsed;
      }
    }
  }
  return null;
}

export function detectAppId(doc: Document): number | null {
  const strategies = [getAppIdFromDataAttribute, getAppIdFromLinks, getAppIdFromImages];
  
  for (const strategy of strategies) {
    const id = strategy(doc);
    if (id !== null) {
      return id;
    }
  }
  
  return null;
}
