const LOG_PREFIX = '[Gratitude]';

export function log(...args: unknown[]): void {
  console.log(LOG_PREFIX, ...args);
}

export function logError(...args: unknown[]): void {
  console.error(LOG_PREFIX, ...args);
}
