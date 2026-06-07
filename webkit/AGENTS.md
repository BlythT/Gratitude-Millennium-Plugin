# Webkit AGENTS

## Scope

This directory owns browser-view code that runs on Steam web pages such as Store and Community.

Primary file:

- `index.tsx`

Support code:

- `lib/`

## Responsibilities

- Fetch and parse Steam account licenses from `https://store.steampowered.com/account/licenses/`
- Scrape Steam friends data from Community pages when available
- Normalize scraped data before sending it to the Lua backend
- Derive Steam identity from browser-view globals when needed

## Webkit Rules

- Keep this code plain TypeScript and DOM/web-API oriented.
- Do not depend on Steam's React component layer here.
- Use page-origin-aware logic:
  - Store scraping belongs on `store.steampowered.com`
  - friends scraping belongs on `steamcommunity.com`
- Be cautious about CORS across Store and Community origins. Fetching Community pages from Store context is not reliable.

## Data Compatibility

- License rows sent to the backend must stay compatible with Lua storage expectations:
  - `{ item, date, acquisition }`
- If you change parser output, update backend handling intentionally.
- Friends scraping should keep enough data for frontend autocomplete:
  - display name
  - alias/nickname when available
  - profile URL
  - SteamID64
  - avatar URL when available

## Working Safely

- Prefer resilient DOM parsing over brittle exact markup assumptions.
- When Steam exposes search metadata such as `data-search`, use it to preserve alias/original-name searchability.
- Keep scraping side effects minimal: scrape, normalize, send to backend.
- Do not add persistence here; filesystem ownership stays in `backend/`.

## Verification

- Run `npm run build`.
- Manually verify by visiting:
  - a Store page for license scraping behavior
  - a Community page for friends scraping behavior
- Check frontend behavior afterward to confirm the scraped data is actually consumable.
