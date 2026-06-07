# Backend AGENTS

## Scope

This directory owns Lua backend persistence and Millennium callables.

Primary file:

- `main.lua`

Runtime data files stored here:

- `gratitude_cache.json`
- `gratitude_consent.json`
- `gratitude_friends.json`
- `gratitude_givers.json`

These JSON files are runtime state, not source files. Avoid editing or deleting them unless the task explicitly requires it.

## Responsibilities

- Persist per-account license cache
- Persist per-account consent state
- Persist per-account giver records
- Persist per-account friends cache
- Expose callable methods used by `frontend/` and `webkit/`

## Important Backend Rules

- Keep storage keyed by Steam Account ID at the top level.
- Keep license cache shape compatible with frontend expectations:
  - input from webkit: `{ item, date, acquisition }`
  - stored cache: `{ [gameName]: { date, acquisition } }`
- Keep giver and friends data isolated per Steam account.
- Native file access belongs here, not in `frontend/` or `webkit/`.

## Callable Gotcha

Millennium Lua backend callables with multiple parameters can be easy to misread during marshaling.

Repo-specific rule:

- Do not trust the written object literal order in frontend code.
- Multi-field payloads have been observed to reach Lua in key order.
- Verify the actual received values with logs before changing signatures.
- This has already affected giver methods like `GetGiverData` and `DeleteGiverData`.

## Working Safely

- Prefer additive changes and preserve existing on-disk formats unless a migration is intentional.
- If you change persistence format, update all readers and writers together.
- Keep logging useful and concise with the existing Gratitude prefix style.
- Do not move persistence into another runtime surface.

## Verification

- Run `npm run build` for TypeScript-side safety after backend callable changes.
- For backend behavior, verify through manual plugin flows in Steam:
  - consent save/load
  - cache clear and repopulate
  - giver add/edit/delete
  - friends cache save/load
