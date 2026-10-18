# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- Added a persistent advanced setting to show or hide Steam profile links and IDs in the giver friend finder.
- Added support for showing and editing a Steam profile URL or ID on manual giver entries when the advanced setting is enabled.

### Changed

- Changed gift records, consent and settings to become read-only for a session when some of their saved data couldn't be read, so nothing is saved over it.
- Changed the gift modal to show a specific message when an account's gift notes reach Millennium's storage limit.
- Changed `UpsertGiverData` to return an error code instead of `false` when a gift isn't saved.
- Changed gift records, consent and settings to be stored in Millennium's plugin config, so gift notes survive reinstalling the plugin.
- Existing gift records, consent and settings now move to Millennium's plugin config automatically, with the old files kept as `.migrated` copies.
- Limited gift notes to 2,000 characters, with a counter shown near the limit.
- Updated the Gratitude sidebar settings to use native Millennium-style controls.
- Unified cache status and cache clearing into a single cache section in the settings sidebar.
- Updated webkit startup sync to run license and friends cache refreshes in the background instead of awaiting them during `WebkitMain()` startup.
- Reduced the chance that visiting Steam Store or Community pages will feel delayed while Gratitude refreshes cached data.

### Fixed

- Fixed editing a gift stored under an older license key leaving a duplicate when removing the old key failed.
- Fixed license and friends data being saved to disk before storage consent was given.
- Fixed data files being left empty or cut short if Steam closes, is killed or runs out of disk space during a save.
- Fixed unreadable data files being overwritten instead of kept aside as `.corrupted` copies.
- Fixed logs including gifter names, license names, full Steam account IDs and file paths.

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
