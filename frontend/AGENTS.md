# Frontend AGENTS

## Scope

This directory owns the Steam UI integration layer that runs in the main Millennium frontend context.

Key areas:

- `index.tsx`: plugin entry, settings panel, popup hooks, consent bootstrap
- `components/`: React modal and settings UI
- `display/`: injected gifted badge DOM builders
- `injection/`: DOM observation, page detection, cache coordination
- `types.ts`: shared selectors, icons, and UI-facing types

## Responsibilities

- Detect Steam library game pages
- Inject the gifted badge into Steam-owned markup
- Open and manage giver-related modals
- Read backend data through frontend cache helpers
- Coordinate refresh behavior when cached data is missing

## Frontend Rules

- This repo intentionally uses direct DOM manipulation for injected library UI.
- Selector stability matters. Check `types.ts` first when injection breaks.
- Desktop and Big Picture share most logic, so avoid changes that only work in one mode.
- Gift badges should only render when `acquisition === "Gift/Guest Pass"`.
- Keep the main gifted section compact and close to Steam's native layout.

## Modal And Injection Guidance

- For library page coordination, start in `injection/observer.ts`.
- For badge layout and click targets, start in `display/components.ts`.
- For giver detail/edit flows, start in `components/GiverModal.tsx`.
- Avoid adding unnecessary wrapper elements to the injected gifted section. Small styling and event-hook changes are usually safer than larger DOM restructures.

## Backend Integration Notes

- Frontend reads persisted data through Millennium callables and local cache helpers.
- If a backend call takes multiple params, be careful: Lua may receive them in a reordered sequence.
- After mutating giver or friends data, make sure any frontend cache is invalidated or refreshed.

## Working Safely

- Preserve existing Steam visual language unless the task clearly calls for a UI change.
- Prefer small, targeted DOM changes over broad rewrites.
- Be careful with tooltip, click-target, and cursor behavior because small layout shifts are noticeable in Steam's header rows.
- Do not assume a browser-view capability exists here; Store/Community scraping belongs in `webkit/`.

## Verification

- Run `npm run build`.
- Manually test in Steam desktop library.
- Manually test in Big Picture mode.
- Re-check hover, tooltip, click, and modal flows after any badge or modal change.
