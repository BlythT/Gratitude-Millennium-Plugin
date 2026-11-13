# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Fixed

- Fixed Steam Store and Community pages never finishing loading while Gratitude is enabled on Millennium 3.3.0 and later, including when Millennium reports its version with a "v" prefix.
- Fixed a license sync that stopped part way (a failed page, or leaving the Store page) being treated as complete, which could leave gift data missing until the number of licenses changed.
- Fixed every Steam restart re-downloading all license pages on the first Store visit, even when nothing had changed.
- Fixed the sync started from the question mark badge doing nothing when the number of licenses was unchanged, and reporting "Sync complete" after a failed sync.
- Fixed license pages after the first being requested in the user's Steam language instead of English, which the license parsing relies on.
- Fixed the check that skips an unchanged license sync always failing, so every Store visit fetched every license page.
- Fixed the consent prompt disappearing during Steam's startup without an answer, which left new users never asked and nothing saved.
- Fixed the consent prompt not coming back when Steam replaced its main window before the prompt was answered.
- Fixed libraries of 1,000 or more licenses skipping license syncs, because the license total was misread.
- Fixed a license sync being treated as complete when its data wasn't saved to disk.
- Fixed license data being written to disk for accounts that denied local storage, including at shutdown.
- Fixed Store and Community visits downloading every license page and the friends list for accounts that hadn't allowed local storage, though none of it could be saved.
- Fixed `npm ci` failing because `package-lock.json` was out of date.
- Fixed the Store starting a full license sync and returning to the Library on every visit after a sync link was used, because the sync flag stayed in the Store tab's URL.

### Added

- Added a persistent advanced setting to show or hide Steam profile links and IDs in the giver friend finder.
- Added support for showing and editing a Steam profile URL or ID on manual giver entries when the advanced setting is enabled.

### Changed

- Updated the Gratitude sidebar settings to use native Millennium-style controls while keeping plugin-owned persistence for UI preferences.
- Unified cache status and cache clearing into a single cache section in the settings sidebar.
- Updated webkit startup sync to run license and friends cache refreshes in the background instead of awaiting them during `WebkitMain()` startup.
- Reduced the chance that visiting Steam Store or Community pages will feel delayed while Gratitude refreshes cached data.
- Updated the plugin description: gift data now updates in the background whenever you open the Steam Store.

## v1.1.0 - 2026-03-22

### Added

- Added gift labeling so users can record who gifted a game and save a personal note.
- Added friend-based lookup and autocomplete support backed by a scraped Steam friends cache.

### Changed

- Reduced observer debug log noise.

## v1.0.0 - 2026-02-07

### Fixed

- Unset the plugin name to avoid incorrect plugin naming behavior.

## v0.3.1 - 2026-02-06

### Added

- Added Big Picture mode support for the gifted-game indicator and tooltip flow.

## v0.3.0 - 2026-02-05

### Fixed

- Fixed backend cache and consent file handling on Linux.

## v0.2.3 - 2026-02-04

### Fixed

- Fixed unstable rendering caused by always removing the display node during observer updates.

### Changed

- Improved tooltip and library rendering performance to reduce churn and unnecessary repaints.

## v0.2.2 - 2026-02-02

### Changed

- Improved library page injection performance with `requestAnimationFrame` scheduling and fewer redundant game-page refreshes.
- Reintroduced a frontend-side license cache to reduce repeated backend calls.

## v0.2.1 - 2026-02-02

### Fixed

- Added the missing `get_active_path` backend function in `main.lua`.

## v0.2.0 - 2026-02-01

### Added

- Added shared Steam account ID handling between frontend and webkit contexts.
- Made license cache and consent storage account-specific.

### Changed

- Standardized scraped license dates to match the UI display format.

## v0.1.6 - 2026-01-31

### Added

- Added a visible indicator for gifted-game history when the cache is still empty.
- Added consent management for storing license data locally.
- Added fuzzy matching improvements for non-exact Steam game-name matches.

### Changed

- Improved cache file resilience and streamlined the first-run Store-page flow after consent.

## v0.1.5 - 2026-01-24

### Fixed

- Fixed inconsistent render order in the injected gifted-game UI.

## v0.1.4 - 2026-01-24

### Changed

- Updated the gift icon SVG so its color is driven by CSS.
- Improved the settings menu.

## v0.1.3 - 2026-01-24

### Added

- Persisted scraped license cache data to disk through the backend.

## v0.1.2 - 2026-01-24

### Added

- Added GitHub Actions release automation.
- Improved README installation guidance.

## v0.1.1 - 2026-01-24

### Added

- Added the initial GitHub Actions release automation setup.

## v0.1.0 - 2026-01-23

### Added

- Initial public release of Gratitude.
- Added Steam library gift indicators based on scraped account license history.
