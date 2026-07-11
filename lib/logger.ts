const LOG_PREFIX = '[Gratitude]';

const isDebugEnabled = () => (window as any).__GratitudeDebug === true;

export function log(...args: unknown[]): void {
  console.log(LOG_PREFIX, ...args);
}

export function logError(...args: unknown[]): void {
  console.error(LOG_PREFIX, ...args);
}

export function logDebug(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.debug(LOG_PREFIX, '[DEBUG]', ...args);
  }
}
