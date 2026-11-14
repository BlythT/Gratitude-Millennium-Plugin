# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Fixed

- Fixed the Gifted badge in Big Picture mode showing the previous game's gift date, or no badge at all, after moving from one game to another. Big Picture keeps the same stats row between games, so the badge stayed as it was for the first game.

## v1.3.2 - 2026-11-14

### Fixed

- Fixed the Gifted badge missing on some gifted games, depending on which games were at the top of the library list, because the badge read the App ID of a game in the list instead of the open game.
- Fixed the Gifted badge not showing on gifted games you have never played.
- Fixed a question mark badge on games borrowed through Steam Family Sharing, which are not your licenses and can't be synced.
- Fixed the gift icon sitting lower than Steam's Play Time and Achievements icons.
- Fixed the Gifted badge popping in after the game page appeared. It now appears in the same frame as Steam's stats row, including on the first game opened after Steam starts and after the cache's five-minute refresh.

### Changed

- Automatic license and friends syncs now wait until the Steam page has finished loading and is idle, and request at low priority, so they don't slow Steam's startup, the Library or the Store, especially on slow connections. Syncs you start from a sync link still run straight away.
- The automatic license check now runs at most once every 10 minutes instead of on every Store page, and the friends list refreshes at most every 6 hours instead of on every Community page.

## v1.3.1 - 2026-11-14

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

### Changed

- The consent prompt can no longer be closed with its X button; Allow or Deny answers it.
- `plugin.json` now carries the release version (it had stayed at 1.1.5 since v1.1.5).
- Updated the plugin description: gift data now updates in the background whenever you open the Steam Store.

## v1.3.0 - 2026-07-13

### Added

- Added a progress overlay while a requested license sync runs, styled to match Steam, which returns to the Library when the sync finishes.
- Added a Grant Permission button in settings, so consent can be given after declining the prompt.

### Changed

- Reworked the consent prompt flow, and delayed the prompt until Steam's modal system is ready.
- Moved the giver dialog's friend suggestions into a dropdown under the search box.
- Replaced the giver dialog's single-line notes field with a multi-line text area and tidied its layout.

### Fixed

- Fixed the question mark badge not showing for games with no license data when the license cache was empty.

## v1.2.1 - 2026-07-12

### Fixed

- Fixed each paginated license fetch overwriting the cached license history, so a Store visit could wipe the cache; pages are now added to it.

## v1.2.0 - 2026-07-12

### Changed

- Rebuilt the gifted badge in React using Steam's native tooltip.
- Reworked the plugin's internal caches and data files.

### Fixed

- Fixed tooltip memory leaks and alignment.
- Fixed incorrect cache counts in the settings panel and a license scraper issue.

## v1.1.5 - 2026-06-14

### Changed

- Release builds keep the release version in `plugin.json` instead of a development placeholder.

## v1.1.4 - 2026-06-14

### Changed

- Releases are now built and published automatically when a version tag is pushed.

## v1.1.3 - 2026-06-14

### Added

- Added App ID-based license matching, using your owned games list, with name matching as the fallback. This fixes most cases where a game's library name differs from its license name.

### Changed

- Rewrote the fuzzy license name matcher for better matches.
- The giver dialog now closes before opening a Steam profile.

### Fixed

- Fixed the license cache repeatedly re-populating in a loop.
- Fixed values from the Millennium backend being misread as true or false.
- Fixed the cache not being cleared in the frontend after clearing it in settings.

## v1.1.2 - 2026-03-29

### Changed

- The friends cache no longer stores friends' online status, which went stale.

## v1.1.1 - 2026-03-29

### Added

- Added a persistent advanced setting to show or hide Steam profile links and IDs in the giver friend finder.
- Added support for showing and editing a Steam profile URL or ID on manual giver entries when the advanced setting is enabled.

### Changed

- Updated the Gratitude sidebar settings to use native Millennium-style controls while keeping plugin-owned persistence for UI preferences.
- Unified cache status and cache clearing into a single cache section in the settings sidebar.
- Updated webkit startup sync to run license and friends cache refreshes in the background instead of awaiting them during `WebkitMain()` startup.
- Reduced the chance that visiting Steam Store or Community pages will feel delayed while Gratitude refreshes cached data.

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
