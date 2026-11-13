# Safe and Durable Storage for Gratitude User Data Specification

**Plan**: [plan-data-storage.md](plan-data-storage.md)  
**Research**: [research-data-storage.md](research-data-storage.md)  
**Tracking**: local only, no GitHub issue  
**Type**: Bug Fix (phase 1) and Major Feature (phase 2)  
**Tasks**: 62 (phase 1: 37, phase 2: 24, final: 1)  

## Overview

Gratitude is a Millennium plugin that marks gifted games in the Steam library and lets the user
record who gave each gift, with a note. Its Lua backend keeps five JSON stores, each partitioned by
Steam account, as files in the plugin folder: the licence cache, consent, gift records ("givers"),
the friends cache and settings. Today a crash or full disk during a save can empty a file, failed
writes are logged as successes, scraped data reaches disk without consent, and uninstalling the
plugin deletes every gift note. Gift notes are the one store the user typed in by hand, so they
can't be rebuilt.

This work follows the approved plan in two phases, each on its own branch with one commit.
Phase 1 makes every file save atomic and checked, undoes failed saves in memory, removes the
shutdown save, keeps unconsented licence and friends data off disk, sets unreadable files aside,
skips unchanged friends saves, makes the gift modal save before it deletes, shows the real result
of consent and settings saves, and keeps personal data out of logs. Phase 2 moves gift
records, consent and settings into millennium.config (Millennium's plugin config store, kept in
Millennium's own `config.json` outside the plugin folder) with a migration that retires the old
files only in a later session, caps notes at 2,000 characters, and documents where data lives.

Every bug fix and behaviour change is built red then green, existing untested behaviour in the
touched files gets characterisation tests, Lua tests move to LuaUnit, and frontend logic is pulled
into pure functions tested with vitest. Every decision in the plan is settled; the implementation
details the plan left open are listed under **Assumptions** so Tim can override any of them.

## Decisions (resolved 2026-10-17)

Tim answered every open point from the first draft of this spec. All of them land in phase 1,
except the review step, which applies to both phases.

1. **Consent save failure.** `ConsentModal.tsx`'s enable path awaits `SetConsent` and logs a
   failure clearly. Nothing new appears in the UI: with the undo in memory (1C.4) the account stays
   unconsented, so the dialog appears again next session. The settings panel's "Grant Permission"
   button (`frontend/index.tsx:110-117`) sets `hasConsent` from the result it actually got back.
   The result-to-state logic is a pure function, built red-green (1E.4).
2. **Changelog wording.** Four Fixed entries, all agreed (the fourth confirmed at close-out, with
   "and file paths" added):
   - "Fixed license and friends data being saved to disk before storage consent was given."
   - "Fixed data files being left empty or cut short if Steam closes, is killed or runs out of
     disk space during a save."
   - "Fixed unreadable data files being overwritten instead of kept aside as `.corrupted` copies."
   - "Fixed logs including gifter names, license names, full Steam account IDs and file paths."
3. **Settings cache.** Fixed in phase 1: `SettingsCache.update` (`frontend/settings.ts:65-85`)
   restores the previous cached value when `SetUiSettings` returns failure, not only when it
   throws. Pure function, red-green (1E.5).
4. **`.gitignore` stray line.** The last line, `tools/` saved as UTF-16, is deleted rather than
   repaired: a working `tools/` rule would ignore the new LuaUnit file and tests (1F.1).
5. **Logs don't contain personal data.** New unit 1H. Never log gifter display names, notes,
   profile URLs, friend names, or licence and game names; log a licence key only when it is a
   numeric app ID. Steam account IDs and SteamID64s are masked to their last four digits (exact
   format: assumption A20). Numeric app IDs, counts and error messages are fine; payloads are never
   logged.
6. **Reviews use `/deep-review`.** In both phases the review before the commit runs Tim's
   `/deep-review` skill instead of the code-reviewer agent. Its Blocker, Critical and Major findings
   are fixed, or the reason for leaving one is recorded, before committing. `fix/safe-saves` sits
   on `build/regenerate-lockfile`, which branches from af3e494 rather than `main`, so the first
   review's scope may include the lockfile and schema commits; that is accepted.

### How `/deep-review` runs here (O1, resolved 2026-10-17)

The skill resolves its base as `origin/main`, else `origin/master`, else an MR target, and this
repo has no remote. Its branch scope (`<base>...HEAD`) only sees commits, and its uncommitted scope
(`git diff HEAD`) misses untracked files. Tim chose to **review before committing**:

1. Mark the phase's new files with `git add -N <path>` (intent to add; no content is staged), so
   `git diff HEAD` includes them.
2. Run `/deep-review` with `Scope: uncommitted`, naming the local parent branch as the base:
   `build/regenerate-lockfile` for phase 1, `fix/safe-saves` for phase 2.
3. Fix the findings, then make the phase's single commit.

The remote stays removed; re-adding it is not an option.

### Log file names, not paths (O2, resolved 2026-10-17)

`backend/lib/JsonStore.lua` logged whole store paths (lines 24, 26, 63, 79 and 86 on 2026-10-17,
and 1B.4 adds the `.corrupted` path). On Linux a path includes the user's home folder name. Tim
chose to log file names only; task 1H.4 covers it.

## Requirements

### Functional

- A save either completes or leaves the previous file untouched; a failed save is reported, never
  logged as a success, and leaves no temporary file behind.
- A failed gift, consent or settings save leaves the backend's memory matching the disk.
- Licence and friends data reaches disk only for accounts whose consent record says `allowed`,
  including at shutdown; it stays in memory for the session either way.
- An unreadable or empty store file is renamed to `<name>.corrupted.<unix time>`, logged, and that
  store starts empty.
- Loading Steam Community twice writes the friends cache at most once.
- Editing a gift stored under an older licence key never loses the note when the save fails.
- A failed consent or settings save leaves the UI showing the previous value.
- No log line contains a gifter name, note, profile link, friend name, licence or game name, or an
  unmasked account ID or SteamID64.
- Phase 2: on Millennium 3.0.0 and later, gift records, consent and settings live in
  millennium.config under `givers.<accountId>`, `consent.<accountId>` and
  `settings.<accountId>`; existing data moves across automatically and old files are kept as
  `*.migrated`.
- Phase 2: notes are capped at 2,000 characters with a counter from 1,800, the backend rejects
  longer notes, and an account whose gift records pass 256 KB gets a specific refusal message.
- Phase 2: the README explains where data is stored and what uninstalling removes.

### Technical

- The backend runs on LuaJIT (Lua 5.1 semantics). Lua tests run on Lua 5.1 with LuaUnit v3.5 and
  Ubuntu's `lua-cjson`; frontend tests run in vitest's default Node environment with no new
  dependencies (no jsdom, happy-dom or @testing-library).
- Every store stays partitioned by Steam account ID.
- Store files, `.tmp`, `.corrupted.*` and `.migrated*` files derive from one data folder function,
  so a later `.star` move changes one line.
- Atomic saves use Millennium's `fs.rename`, never `os.rename` (which can't replace a file on
  Windows), with the temporary file in the same folder as the store file.
- Only the Lua backend touches millennium.config. Callable arguments don't change, so AGENTS.md
  section 5's argument order warning isn't triggered.
- Config keys can never be renamed after release.

## Technical Approach

### Key Decisions

Settled in the plan and research; listed so a cold reader has the reasons.

1. **Gift records, consent and settings move to millennium.config; the caches stay as files.**
   Gift notes are the only data that can't be rebuilt, and millennium.config survives a reinstall
   when the user answers no to Millennium's "delete saved settings" prompt. The licence cache
   outgrows one 256 KB value at about 1,900 to 2,600 licences.
2. **No shutdown save.** `on_unload` runs when Steam is being killed (research section 3.4), and
   once failed saves are undone in memory there is nothing left for it to retry.
3. **Consent controls storing, not scraping.** Scraped data stays in memory for the session;
   only saves are filtered.
4. **Failed saves are undone only for hand entered stores.** The two caches keep their in-memory
   data; the next sync saves them again.
5. **The friends comparison is a small helper of our own**, not Penlight, because Penlight can't
   ignore keys or list order.
6. **Old files are retired only in a later session**, because `millennium.config.get` reads
   Millennium's memory and a write can fail silently. Only a fresh load of `config.json` finding
   the key proves the data reached disk.
7. **One key per account per moved store** (`givers.<id>`, `consent.<id>`, `settings.<id>`): each
   account gets its own 256 KB, at the cost of about 85 accounts per Steam install.
8. **No backup copy of gift records**; consent never falls back to a `.migrated` file.
9. **`tools/test_cache_merger.lua` moves to LuaUnit** (decided in this spec, overridable). One
   runner, one report and one exit code for every Lua test is worth a mechanical rewrite of a
   98 line file. Its seven scenarios keep every assertion, in the same order, as one test method,
   because each scenario feeds the next.
10. **Logs never carry personal data**, because logs are what users share when they ask for help.
    Account IDs are masked rather than dropped, so lines from different accounts stay distinct.

### Assumptions

Implementation details the plan left open. A1 to A10 were resolved by Tim's brief for this spec;
A11 to A19 are gaps found while writing it, resolved by following the plan's intent. A20 is the
log format Tim asked to be marked as an assumption; A21 and A22 fill gaps in his answers. Each
can be overridden before execution.

| ID | Assumption | Why |
| --- | --- | --- |
| A1 | **Error transport.** `UpsertGiverData` returns `true` on success or an error-code string: `"invalid_payload"`, `"note_too_long"`, `"size_limit"`, `"read_only"` (stored data couldn't be read this session, so a Steam restart is needed; RF2.8) or `"save_failed"`. Phase 2 only. | Millennium keeps only the first Lua return value (`lua_pcall(L, numArgs, 1, 0)`, Millennium src/lua_host/main.cc:470). `isTruthy` (`frontend/utils/truthy.ts:13-15`) reads any string other than "true" as false, so `givercache.ts:48` and `GiverModal.tsx:196` keep working. |
| A2 | **Only `UpsertGiverData` uses codes.** `SetConsent`, `SetUiSettings` and `DeleteGiverData` keep returning `true` or `false`. | Their callers only need success or failure, so the contract stays narrow. Every caller passes the result through `isTruthy`, so a code would also be read correctly. |
| A3 | **Note cap counts Unicode code points** in the backend: `select(2, notes:gsub("[^\128-\191]", ""))`. | The textarea's `maxLength` counts UTF-16 units, never fewer than code points, so the backend never rejects what the UI allowed. |
| A4 | **Multi-account files.** A store file is retired to `*.migrated` only when every account in it had its key in config at startup. Keys copied this session don't count. A file holding no accounts (`{}`) is therefore retired at the first phase 2 startup; it holds nothing to lose. | Keeps the "proved on disk" guarantee per account. |
| A5 | **Never overwrite a `*.migrated` file.** First retirement: `<file>.migrated`. If that exists: `<file>.migrated.<unix time>`. If that exists too, the file isn't retired this session (logged). The fallback reads the newest: the highest `<unix time>` suffix, with plain `.migrated` the oldest. An unreadable copy is logged and skipped for the next newest. Gratitude never renames, sets aside, deletes or rewrites a `.migrated` file. | Each retirement can hold data no other copy has (A6). |
| A6 | **Downgrade edits are an accepted edge case.** Edits made on the file fallback after a Millennium downgrade below 3.0.0 go to the store file; after upgrading again config wins and that file becomes a newer `.migrated.<unix time>`. | Rare; the edits survive in that file. |
| A7 | **JSON that decodes to a non-table** (`null`, a number, string or boolean) counts as unreadable and is set aside. Arrays decode to tables and load as today. | `backend/main.lua` loaders call `next(loaded)`, which breaks on non-tables. |
| A8 | **A failed set-aside blocks saves.** If renaming an unreadable file fails, or its `.corrupted.<unix time>` name already exists, saves to that store are refused for the session rather than overwriting the file. | The file may hold recoverable data. |
| A9 | **Consent granted mid-session saves both caches.** After `SetConsent(true)` saves consent, it saves the licence and friends caches (consent filtered). Their failures are logged and don't change `SetConsent`'s result. Not done for `SetConsent(false)`. | Implements the plan's "the next save persists what is in memory", which otherwise waits for the next session (research open point 3). Saving on decline would purge data, which is out of scope. |
| A10 | **`.gitignore`** gets patterns for the `.tmp`, `.corrupted.*`, `.migrated` and `.migrated.*` copies in phase 1, and loses its stray UTF-16 line (decision 4); **docs** (AGENTS.md, backend/AGENTS.md, README) are updated in phase 2. | The dev install keeps live data, gift notes included, in the checkout's `backend/`. |
| A11 | **A store file that can't be opened for reading** is left in place, its store starts empty, and saves to it are refused for the session (same guard as A8). It isn't set aside. In config mode, saves for accounts with no config key at startup are refused for the session too, as they are when every newer `.migrated` copy couldn't be read (RF2.1). | An open failure can be a passing lock, such as Windows antivirus software; renaming would hide a healthy file's data until recovered by hand. |
| A12 | **`.migrated` fallback data is copied into config**, following the migration rule's "use the old file, copy its data into config". The `.migrated` file stays. | Otherwise accounts never edited would read the `.migrated` file every session. |
| A13 | **An emptied account keeps its key.** When the last gift of an account is deleted in config mode, `givers.<id>` is set to `{}`. Nothing in this work calls `millennium.config.delete`. | A missing key would let a later session fall back to `.migrated` and bring deleted gifts back. |
| A14 | **The 256 KB size check applies only when saving to config.** The note cap applies in both modes. | Files have no size limit. |
| A15 | **If `millennium.config.get_all()` returns an error**, the three moved stores show the file (or newest `.migrated`) data for the whole session, and nothing is copied, retired or saved, since config may hold newer data (RF2.2). | Research: never retire anything based on a failed read. |
| A16 | **Note-too-long message.** The modal checks the trimmed note before saving and shows "Notes are limited to 2,000 characters." The `note_too_long` code maps to the same text. Wording proposed. | `maxLength` doesn't shorten an existing value, so a note saved before the cap can be longer. |
| A17 | **Counter format** is `<length> / 2000`, shown when `notes.length >= 1800` (raw text, matching `maxLength`). | Fixed format keeps tests independent of locale. |
| A18 | **The Lua runner finds tests with `ls tools/test_*.lua`** and exits 1 on any failure. Lua tests therefore run on Linux or macOS only, as do their `mkdir` and `rm -rf` temp folders. | One less list to forget to update; tests already need a POSIX shell. |
| A19 | **New frontend tests live in `frontend/utils/`, not `lib/`.** | `frontend/lib` and `webkit/lib` are symlinks to `lib/`, so vitest runs each `lib/*.test.ts` three times (24 results for one 8-test file today). |
| A20 | **Log masking format.** An ID becomes `****` followed by the last four characters of its string form (`****9341`); a value of four characters or fewer becomes `****`; `nil`, `null`, `undefined` or an empty string becomes `<none>`. A licence key is logged as it is only when it is all digits (an app ID), otherwise as `non-numeric key`. | Tim asked for the exact format to be an assumption. Four digits still tell accounts apart on one machine. |
| A21 | **The log privacy check is a static scan** of log calls in `backend/`, `frontend/`, `webkit/` and `lib/` (1H.1). It flags a call whose arguments mention a risky identifier, or a compound name ending in one (`legacyLicenseKey`, `legacy_license_key`), outside the masking helpers. A genuinely safe call names the identifiers it allows with a `log-privacy: allow=<name>[,<name>] <reason>` comment on its first line; anything else in that call is still flagged. `tools/` is out of scope. Accepted gap: an error object logged from a catch block can quote its input (V8 `JSON.parse` errors do). | Heuristic but repeatable, and it runs with `npm test`. Named opt-outs and compound matching were added at Tim's request after 1H. `tools/` scripts never run in Steam, and the match report prints game names by design. |
| A22 | **Consent flows otherwise unchanged.** The consent dialog still opens the Store sync after Allow, and the "Grant Permission" button still opens it whatever the result. Only the dialog's logging and the button's `hasConsent` change. Declining is untouched. | Tim's answer changes the state and the logging, nothing else. |
| A23 | **A plugin reload counts as a later session.** A toggle, or Millennium restarting a crashed plugin, reruns `on_load` against Millennium's in-memory config, so files can be retired in the same Steam run that copied them. If that run's config writes never reached disk, gift records and settings come back from `.migrated` at the next Steam start (A12); consent doesn't, so the user is asked again. Pinned by RF2.5's tests. | Only a Steam start reloads `config.json` (Millennium `src/system/config.cc:300`), and the loss needs Millennium's own disk write to have failed, which it logs. Accepted after the 2F.9 review rather than adding machinery. |

### Contracts

Function names are suggestions; behaviour, return values, file names and config keys are the
contract. Units built in parallel rely on these.

**Lua test support** (`tools/lua_test_support.lua`, phase 1). Installs stand-ins through
`package.loaded` for Millennium modules that only exist inside Steam: `json` is Ubuntu's `cjson`;
`fs` has `join`, `exists`, `remove`, `rename` and `list` built on `io`, `os.rename` (which replaces
an existing target on Linux, like Millennium's `fs.rename`) and `ls`; `utils` has
`get_backend_path` and `sleep`; `logger` captures messages; `millennium` has `version`,
`cmp_version`, `add_browser_js`, `ready` and an optional `config`; `io` is a proxy over the real
`io` that can inject failures. The proxy only affects code that does `require("io")`; LuaUnit's own
output uses the global `io` and is untouched.

```lua
local support = require("lua_test_support")
local env = support.new_env()        -- fresh temp folder, failure switches off, logs cleared
env.dir                               -- what utils.get_backend_path() returns
env.write_file(name, content); env.read_file(name); env.exists(name); env.list()
env.fail.open_write = "Permission denied"      -- io.open in "w"/"wb" mode returns nil, msg
env.fail.open_read = "Permission denied"       -- io.open in "r"/"rb" mode on an existing file
env.fail.write = "No space left on device"     -- file:write returns nil, msg
env.fail.close = "No space left on device"     -- file:close really closes, then returns nil, msg
env.fail.rename = { count = 2, message = "Access is denied" }  -- math.huge for always
env.fail.only_path = "gratitude_cache" -- optional Lua pattern: fail only matching paths
env.logs           -- { { level = "info" | "warn" | "error", message = "..." }, ... }
env.sleeps         -- every utils.sleep argument
env.opened_for_write -- every path opened in a write mode
env.freeze_time(t) -- os.time() returns t until env.cleanup()
env.config         -- nil (no millennium.config) unless set; phase 2 sets a fake config
local backend = env.load_backend() -- clears package.loaded["lib.*"], dofile("backend/main.lua")
env.cleanup()      -- restores os.time, rm -rf only the folder this env created
```

**Fake millennium.config** (`support.new_fake_config(options)`, phase 2). Dot-call functions,
like the real API (`millennium.config.get(key)`). Values go through `cjson` encode and decode, so
tables come back as copies with string keys, like Millennium's JSON conversion.

```lua
local config = support.new_fake_config({ value_limit = 262144, key_limit = 256 })
config.get(key)            --> value or nil
config.set(key, value)     --> true | false, "plugin config value too large (max 256KB)"
                           --        | false, "plugin config key limit exceeded (max 256)"
config.delete(key)         --> true
config.get_all()           --> table of every key | nil, err when config.fail_get_all is set
config.saving_disabled = true  -- set returns true, memory updates, the "disk" doesn't
config.restart()           -- new session: memory becomes a copy of the "disk"
config.set_calls           -- list of keys passed to set, in order
```

**JsonStore** (`backend/lib/JsonStore.lua`). One function, `data_dir()`, returns the data folder
(today `utils.get_backend_path()`); every path derives from `store.path`.

```lua
local store = JsonStore.new("gratitude_givers.json", "Giver store") -- store.dir, store.path
store:load(defaultState) --> table   -- phase 1: removes <path>.tmp, sets aside unreadable files
store:save(data)         --> true | false, reason   -- phase 1: atomic and checked
store:exists()           --> boolean                -- phase 2
store:retire()           --> new_path | nil, reason -- phase 2, A5
store:load_newest_migrated() --> table | nil, unread -- phase 2, read only, A5; unread: a newer copy couldn't be read
```

**Config keys and values** (phase 2). The value is the same per account table the file holds today:

| Key | Value |
| --- | --- |
| `givers.<accountId>` | `{ [licenseKey] = { licenseKey, libraryTitle, displayName, source, createdAt, updatedAt, steamID64?, profileUrl?, notes? } }`, `{}` when emptied (A13) |
| `consent.<accountId>` | `{ allowed = boolean, timestamp = number }` |
| `settings.<accountId>` | `{ showFriendPickerSteamUrl = boolean }` |

**Callable return values.** Phase 1: unchanged except `SetConsent`, which returns its save result
(`true` or `false`) instead of always `true`. Phase 2: `UpsertGiverData` returns `true` or a code
(A1); nothing else changes.

**Frontend pure functions.** No imports from `@steambrew/client` or React, so vitest can load them.

```ts
// frontend/utils/giverSave.ts (phase 1 upserted then removed the legacy key; 2G.3 made it one call)
export type GiverSaveOutcome = { saved: boolean; upsertResult: unknown };
export function saveGiver<T extends { licenseKey: string }>(steps: {
	record: T;
	legacyLicenseKey?: string | null;
	upsert: (record: T & { replacesLicenseKey?: string }) => Promise<unknown>;
}): Promise<GiverSaveOutcome>;
export function giverSaveErrorMessage(upsertResult: unknown): string; // phase 2

// frontend/utils/giverNotes.ts (phase 2)
export const NOTE_MAX_LENGTH = 2000;
export const NOTE_COUNTER_FROM = 1800;
export function shouldShowNoteCounter(notes: string): boolean; // notes.length >= 1800
export function formatNoteCounter(notes: string): string;      // `${notes.length} / 2000`
export function isNoteWithinCap(notes: string): boolean;       // notes.trim().length <= 2000

// frontend/utils/giverSave.ts (phase 1, RF7): legacy keys first, then the current key
export type GiverDeleteOutcome = { deleted: boolean; legacyRemoved: boolean | null };
export function deleteGiverAndLegacy(steps: { ... }): Promise<GiverDeleteOutcome>;

// frontend/utils/consent.ts (phase 1, RF8): log on failure, return the saved flag
export function isConsentSaved(result: unknown): boolean;       // isTruthy(result)
export function grantConsent(setConsent: SetConsentCallable, steamUserID: string): Promise<boolean>;
export function declineConsent(setConsent: SetConsentCallable, steamUserID: string): Promise<boolean>;

// frontend/utils/settingsCache.ts (phase 1, RF9): no React or Steam imports, so vitest loads it
export class SettingsCache { constructor(getUiSettings, setUiSettings) }  // falls back to the last confirmed value

// frontend/utils/settingsSave.ts (phase 1)
export function settingsAfterSave<T>(previous: T, next: T, result: unknown): T; // next only if saved
```

**Log masking helpers** (phase 1, A20). No imports, so frontend, webkit and lib can all use the
TypeScript one.

```ts
// lib/log-redact.ts
export function maskId(id: unknown): string;          // "1234569341" -> "****9341"
export function safeLicenseKey(key: unknown): string; // "220" -> "220", "Half-Life 2" -> "non-numeric key"
```

```lua
-- backend/lib/log_redact.lua
log_redact.mask_id(id)            --> same rules as maskId
log_redact.safe_license_key(key)  --> same rules as safeLicenseKey
```

### Implementation Strategy

**Branches and commits.**

- Phase 1 on `fix/safe-saves`, created from `build/regenerate-lockfile`. Phase 2 on
  `feat/config-storage`, created from `fix/safe-saves` after its commit.
- One conventional commit per phase, made after that phase's code review, with Tim's repo-local
  identity (`timmblyth@gmail.com`). Never push. Stage files by path; never `git add -A` or
  `git add .`, because `docs/llm/active/` is untracked and must never be committed.
- CHANGELOG entries go under `## Unreleased` with each phase.

**Safety rules for anything that runs Steam.**

- Never uninstall Gratitude through Millennium's settings while it is the symlinked dev install
  (`~/.local/share/millennium/plugins/gratitude` points at this checkout). Millennium's uninstall
  follows the link and deletes the checkout, `.git` included. Uninstall testing (task 2F.7) uses
  a normal, non-symlinked install only.
- Back up `~/.config/millennium/config.json` before any phase 2 testing in Steam. It is shared by
  every checkout and worktree, because config values belong to the plugin name `gratitude`.
- Ask Tim before killing Steam. Steam has hung on quit on this machine and needed `kill -9`.
- Manual Steam testing runs in this main checkout, the symlink's target, with the phase branch
  checked out and `npm run build` run first.

**Red then green.** Every task that fixes a bug or changes behaviour follows the same steps:

1. **Red:** write the test named in the task. Run it. Confirm it fails for the reason given in the
   task, for example an assertion naming the wrong value, not a syntax error, missing stand-in or
   misconfigured runner.
2. **Green:** make the smallest change that passes it.
3. Run the whole suite (`npm run test:lua`, `npm test`) and keep it green.

New behaviour counts: its red is the test failing because the behaviour isn't there yet.
Characterisation tests are the exception: they describe behaviour that stays, so they pass against
the current code when written. Write them before changing the code they cover.

**Gotchas.**

- LuaUnit's `assertEquals(actual, expected)` takes the arguments in the opposite order to the hand
  rolled `assert_equal(expected, actual, message)` in `tools/test_cache_merger.lua`.
- LuaUnit treats every global whose name starts with `test` or `Test` (any case) as a test. Name
  each test class uniquely (`TestJsonStore`, `TestBackendSaves`, ...) because the runner loads
  every file into one Lua state, and define no other globals with that prefix.
- `lu.LuaUnit.run()` with no arguments reads the command line, so the runner passes its own
  arguments straight through: `npm run test:lua -- -p TestJsonStore` runs one class.
- `os.exit(failures)` would report success for exactly 256 failures; exit with
  `failures == 0 and 0 or 1`.
- Lua's `file:write` and `file:close` report failure by return value and never raise, so `pcall`
  catches nothing. On a full disk the error may only show at `close`. Check the first return value
  for truthiness: Lua 5.1 returns `true` from `write`, later versions return the file.
- `normalize_giver_payload` only reads the existing record (after RF5); `UpsertGiverData` records
  whether the account existed just before `ensure_account_store`, so its undo can remove an
  account it created.
- Characterisation tests for behaviour whose disk side changes in this work (for example
  `SetFriendsCache`) assert through the `Get*` callables, not files.
- `.gitignore` uses CRLF line endings and, until 1F.1 deletes its stray last line, contains NUL
  bytes, so the Edit and Write tools refuse it. Edit it with a shell command that keeps its CRLF
  endings. Git treats the current file as binary, so read its diff with `git diff --text`.
- From 1H on, every new log line, phase 2's included, masks account IDs and licence keys with the
  helpers above; the log privacy check (1H.1) fails `npm test` otherwise.

### Units of work

Each unit owns the files listed, so units in the same phase can run as parallel agents in this one
checkout. Worktrees would need intermediate commits squashed into the single phase commit, which
needs Tim's agreement, so the default is the shared checkout. An agent seeing a red run in another
unit's module reruns after that unit finishes rather than touching its files. Agents read this
spec from the main checkout, because `docs/` is untracked and doesn't appear in worktrees.

| Unit | Owns | Depends on | Can run alongside |
| --- | --- | --- | --- |
| 1A Lua test foundation | `tools/luaunit.lua`, `tools/LUAUNIT_LICENSE.txt`, `tools/run_lua_tests.lua`, `tools/test_cache_merger.lua`, `tools/lua_test_support.lua`, `tools/test_lua_test_support.lua`, `package.json` | 1.0 | 1E, 1F, 1H.2 |
| 1B Atomic saves and set-aside | `backend/lib/JsonStore.lua`, `tools/test_json_store.lua` | 1A | 1C, 1D, 1E, 1F, 1H.2, 1H.3 |
| 1C Backend save behaviour | `backend/main.lua`, `tools/test_backend_existing.lua`, `tools/test_backend_saves.lua` | 1A; 1C.6 also needs 1D | 1B, 1D, 1E, 1F, 1H.2, 1H.3 |
| 1D Friends comparison | `backend/lib/friends_compare.lua`, `tools/test_friends_compare.lua` | 1A | 1B, 1C.1 to 1C.5, 1E, 1F, 1H.2, 1H.3 |
| 1E Frontend save handling | `frontend/utils/giverSave.ts`, `frontend/utils/giverSave.test.ts`, `frontend/utils/truthy.test.ts`, `frontend/utils/consent.ts`, `frontend/utils/consent.test.ts`, `frontend/utils/settingsSave.ts`, `frontend/utils/settingsSave.test.ts`, `frontend/components/GiverModal.tsx`, `frontend/components/ConsentModal.tsx`, `frontend/index.tsx`, `frontend/settings.ts` | 1.0 | 1A to 1D, 1F, 1H.2, 1H.3 |
| 1F Ignore data copies | `.gitignore` | 1.0 | 1A to 1E, 1H.2, 1H.3 |
| 1H Logs without personal data | `lib/log-redact.ts`, `frontend/utils/log-redact.test.ts`, `backend/lib/log_redact.lua`, `tools/test_log_redact.lua`, `tools/log-privacy.test.mjs`, `tools/test_log_privacy.lua`; then log lines in `backend/main.lua`, `frontend/`, `webkit/index.tsx` and `lib/steamid.ts` | 1H.2: 1.0. 1H.3: 1A. 1H.1, 1H.4, 1H.5: 1B to 1F | 1H.2 and 1H.3 with 1A to 1F; 1H.1, 1H.4 and 1H.5 with none |
| 1G Close-out | `CHANGELOG.md`; manual tests; review; commit | 1A to 1H | none |
| 2A Fake config | `tools/lua_test_support.lua`, `tools/test_lua_test_support.lua` | 2.0 | 2C.1, 2D, 2E |
| 2B Config storage and migration | `backend/lib/JsonStore.lua`, `backend/lib/config_store.lua`, `backend/main.lua`, `tools/test_json_store.lua`, `tools/test_config_store.lua`, `tools/test_backend_config.lua` | 2A | 2C.1, 2D, 2E |
| 2C Note cap and error codes | `backend/lib/note_limit.lua`, `tools/test_note_limit.lua`; then `UpsertGiverData` in `backend/main.lua` | 2C.1: 2.0. 2C.2: 2B, 2C.1 | 2C.1 with all |
| 2D Gift modal note cap and messages | `frontend/utils/giverNotes.ts`, `frontend/utils/giverNotes.test.ts`, `frontend/utils/giverSave.ts`, `frontend/utils/giverSave.test.ts`, `frontend/components/GiverModal.tsx`, `frontend/injection/givercache.ts` | 2.0 | all |
| 2E Docs and type stubs | `README.md`, `AGENTS.md`, `backend/AGENTS.md`, `types/millennium.lua` | 2.0 | all |
| 2G Phase 1 review carry-overs | 2G.1: `tools/lua_test_support.lua` and backend test files. 2G.2: `backend/main.lua`. 2G.3: `backend/main.lua`, `frontend/utils/giverSave.ts`, `frontend/components/GiverModal.tsx` | 2G.1: 2A. 2G.2: 2B.4. 2G.3: 2C.2, 2D, 2G.2 | 2G.1 with 2C.1, 2D, 2E |
| 2F Close-out | `CHANGELOG.md`; manual tests; review; commit | 2A to 2E, 2G | none |

## Tasks

### Phase 1: Make saves safe (branch `fix/safe-saves`)

- [✅] 1.0 Create the phase 1 branch
  - **File**: none (git)
  - **Dependencies**: none
  - **Steps**: `git status --short` shows only `?? docs/`, then
    `git switch -c fix/safe-saves build/regenerate-lockfile`.
  - **Verification**: `git branch --show-current` prints `fix/safe-saves`. Baseline still green:
    `npm run test:lua` and `npm test` pass (on 2026-10-17 the Lua test passed, vitest reported 24
    results, and `npm run type-check` and `npm run lint` were clean).

#### Unit 1A: Lua test foundation

- [✅] 1A.1 Vendor LuaUnit v3.5
  - **File**: `tools/luaunit.lua`, `tools/LUAUNIT_LICENSE.txt`
  - **Dependencies**: 1.0
  - **Steps**: download
    `https://raw.githubusercontent.com/bluebird75/luaunit/LUAUNIT_V3_5/luaunit.lua` unmodified, and
    `LICENSE.txt` from the same tag. The licence file is an addition to Tim's brief: the BSD licence
    requires the copyright notice to travel with the source, and `luaunit.lua`'s header only says
    "see LICENSE.txt". Drop it if Tim prefers.
  - **Verification**: `sha256sum` gives
    `150ed14606ea66c6a02b3142dde02bdf6d48764fcd2af6bf85bfecd7d98a7d0b` for `luaunit.lua` (3,622
    lines, `M.VERSION='3.5'`) and `9a32cabfba5e46a9c3a55cdb4961afc83206d14345e537756f83362664c82265`
    for the licence, both measured when this spec was written. `tools/` never ships: neither the
    release zip nor steambrew.app's build includes it.

- [✅] 1A.2 Add the Lua test runner
  - **File**: `tools/run_lua_tests.lua`, `package.json`
  - **Dependencies**: 1A.1
  - **Steps**: the runner puts `./backend/?.lua;./tools/?.lua;` at the front of `package.path`, so
    `require("lib.JsonStore")` and `require("luaunit")` resolve from the repo root. It lists
    `tools/test_*.lua` with `ls -1` (A18), stops with an error if none are found, `dofile`s each in
    sorted order, then runs `os.exit(lu.LuaUnit.run() == 0 and 0 or 1)`. Change `test:lua` in
    `package.json` to `lua tools/run_lua_tests.lua`.
  - **Verification**: `npm run test:lua` exits 0. Until 1A.3, the old cache merger file runs its
    own checks when loaded and LuaUnit finds no test classes; that is expected.

- [✅] 1A.3 Move `tools/test_cache_merger.lua` to LuaUnit
  - **File**: `tools/test_cache_merger.lua`
  - **Dependencies**: 1A.2
  - **Steps**: confirm the old file passes (`lua tools/test_cache_merger.lua`). Convert it to
    `TestCacheMerger:test_merge_sequence()`, keeping the seven scenarios in order and all 28
    assertions with their messages: `assert_equal(e, a, m)` becomes `lu.assertEquals(a, e, m)`,
    `assert_type` becomes `lu.assertEquals(type(v), "table", m)`, and the `nil` check on
    `isNewFormat4` becomes `lu.assertNil`. Remove `run_tests()` and the prints; keep
    `require("backend.lib.cache_merger")`.
  - **Verification**: `npm run test:lua -- -p TestCacheMerger` passes with all 28 assertions.
    Temporarily change the expected `totalLicenses` from 100 to 99:
    `npm run test:lua; echo $?` reports the failure and prints `1`. Revert.

- [✅] 1A.4 Write the Lua test support module
  - **File**: `tools/lua_test_support.lua`, `tools/test_lua_test_support.lua` (`TestLuaTestSupport`)
  - **Dependencies**: 1A.2
  - **Steps**: implement the **Lua test support** contract above. Write its self-tests first: the
    temp folder exists and `cleanup` removes it; `fail.close` leaves the real file closed and
    returns the message; `fail.rename = { count = 2 }` fails twice, then succeeds; `only_path`
    limits failures to matching paths; `load_backend()` defines the `SetConsent` global and returns
    a table with `on_load`.
  - **Verification**: `npm run test:lua -- -p TestLuaTestSupport` passes.

#### Unit 1B: Atomic saves and set-aside

- [✅] 1B.1 Characterise JsonStore load and save
  - **File**: `tools/test_json_store.lua` (`TestJsonStore`)
  - **Dependencies**: 1A
  - **Steps**: tests that pass against today's `backend/lib/JsonStore.lua`: a missing file returns
    `{}` or the given default; a file holding `{}` loads as an empty table and isn't renamed; save
    then load round trips nested tables with string keys; saving data that contains a function
    returns false and leaves the existing file byte for byte unchanged; `store.path` is
    `fs.join(utils.get_backend_path(), filename)`.
  - **Verification**: all pass before any change to `JsonStore.lua`.

- [✅] 1B.2 Make saves atomic and checked (red-green)
  - **File**: `backend/lib/JsonStore.lua`, `tools/test_json_store.lua`
  - **Dependencies**: 1B.1
  - **Red**: with the store file holding content A, each test saves content B:
    - `env.fail.close` set: save returns false and a reason containing "No space left on device";
      the file still holds A; no `<path>.tmp` exists; no "saved successfully" log. Expected
      failure today: save returns true and the file is empty.
    - `env.fail.write` set: same assertions.
    - `env.fail.open_write` set: false, file holds A.
    - `env.opened_for_write` lists `store.path .. ".tmp"` and never `store.path`. Expected
      failure today: it lists `store.path`.
    - `env.fail.rename = { count = 2 }`: true, file holds B, `env.sleeps` is `{ 50, 50 }`.
    - `env.fail.rename = { count = math.huge }`: false after five attempts, file holds A, no tmp.
  - **Green**: add `data_dir()` as the only place the folder is decided. `save` encodes, opens
    `<path>.tmp` with `"wb"`, checks both `write` and `close` results, then renames with up to
    five `fs.rename` attempts and `utils.sleep(50)` between them (one shared helper, reused by
    1B.4). On any failure it removes the tmp file, logs the reason and returns `false, reason`.
    The success log comes only after the rename. See research "Atomic, checked save".
  - **Verification**: plan acceptance "a save on a full disk reports failure, leaves the previous
    file intact and leaves no temporary file behind".

- [✅] 1B.3 Clear a leftover temporary file at load (red-green)
  - **File**: `backend/lib/JsonStore.lua`, `tools/test_json_store.lua`
  - **Dependencies**: 1B.2
  - **Red**: store file holds A and `<path>.tmp` holds a cut short copy: `load` returns A's data
    and the tmp file is gone. Expected failure today: the tmp file is still there.
  - **Green**: `load` removes `<path>.tmp` first and logs it. A leftover tmp means the rename never
    happened, so the store file holds the complete previous version.
  - **Verification**: covers a process killed between writing and renaming.

- [✅] 1B.4 Set unreadable files aside (red-green)
  - **File**: `backend/lib/JsonStore.lua`, `tools/test_json_store.lua`
  - **Dependencies**: 1B.3
  - **Red**: with `env.freeze_time(T)`, each of these store files loads as the default, is renamed
    to `<name>.corrupted.T` with its bytes unchanged, and an error log names the new path: a 0 byte
    file, whitespace only, `{"a":`, `null`, `42`, `"text"`, `true` (A7). A save afterwards writes
    a fresh store file. Expected failure today: no `.corrupted.T` file. Also (characterisation,
    passes today): `{}` and `[]` load as empty tables and aren't renamed.
  - **Green**: in `load`, treat empty or whitespace content, a decode error and a non-table result
    as unreadable; rename with the 1B.2 retry helper. "Empty" never means a valid `{}`.
  - **Verification**: plan acceptance "an unreadable or empty store file is renamed to
    `*.corrupted.<unix time>` rather than overwritten".

- [✅] 1B.5 Refuse saves when a file can't be safely replaced (red-green)
  - **File**: `backend/lib/JsonStore.lua`, `tools/test_json_store.lua`
  - **Dependencies**: 1B.4
  - **Red**: each case loads the default, leaves the store file byte for byte unchanged, and a
    later `save` returns false without writing:
    - an unreadable file whose `<name>.corrupted.T` already exists (that file is untouched) (A8);
    - an unreadable file with `env.fail.rename = { count = math.huge }` (A8);
    - a valid file with `env.fail.open_read` set: no rename, no `.corrupted` file (A11).

    Expected failure today: `save` returns true and overwrites the file.
  - **Green**: `load` records why saving is blocked on the store; `save` returns `false, reason`
    without opening anything while it is set.
  - **Verification**: tests pass; the reason is logged once at load.

#### Unit 1C: Backend save behaviour

- [✅] 1C.1 Characterise the backend callables
  - **File**: `tools/test_backend_existing.lua` (`TestBackendExisting`)
  - **Dependencies**: 1A
  - **Steps**: each test seeds files, calls `env.load_backend()` and `on_load()`, then calls the
    global callables. Tests that pass against today's `backend/main.lua`:
    - **Consent checks**: `HasUserConsented` returns nil for an unknown account and for `""`;
      true after `SetConsent(true, "111")`; false after `SetConsent(false, "111")`;
      `SetConsent(true, "")` returns false.
    - **Licences**: `SetGameLicenseData` for an account without consent returns true and writes no
      cache file; after a page, `GetGameLicenseData` returns the merged data and
      `IsGameLicenseCachePopulated` is true; an old name-only cache file
      (`{"111": {"Game": {...}}}`) loads into `byName` (`backend/main.lua:37-58`).
    - **Giver payload validation**: a missing `licenseKey`, `libraryTitle`, `displayName` or
      `source` returns false and stores nothing; a `source` other than `manual` or `friend-cache`
      returns false; empty optional strings are dropped; an update keeps `createdAt` and refreshes
      `updatedAt` (freeze t1, then t2); `GetAllGiverData` returns the account map; deleting the
      last record makes `GetAllGiverData` return `"{}"`; `GetGiverData` with `""` returns `"{}"`.
    - **Friends normalisation** (through `GetFriendsCache`): rows missing `steamID64` or
      `displayName` are dropped with an error log; optional fields are kept when non-empty and
      dropped when empty; `HasFriendsCache` is true after a set; after `ClearFriendsCache`,
      `GetFriendsCache` returns `"{}"`; a payload that isn't JSON returns false.
    - **Settings**: `showFriendPickerSteamUrl` is stored as true only for boolean true; a payload
      without `steamUserID` returns false; `GetUiSettings` for an unknown account returns `"{}"`.
  - **Verification**: all pass before any change to `main.lua`.

- [✅] 1C.2 Remove the shutdown save (red-green)
  - **File**: `backend/main.lua`, `tools/test_backend_saves.lua` (`TestBackendSaves`)
  - **Dependencies**: 1C.1
  - **Red**: consented account with licence, gift, friends and settings data saved; delete all
    five data files; call `on_unload()`; no data file exists. Expected failure today: all five are
    recreated.
  - **Green**: `on_unload` only logs. Replace the comment at `backend/main.lua:623-624`, which
    says the hook may not run on a crash, with one saying why there is deliberately no save here:
    Millennium calls it when Steam's process dies, while the Lua host is being killed, and every
    change is already saved when it is made.
  - **Verification**: plan acceptance "no licence or friends data reaches disk, including at
    shutdown".

- [✅] 1C.3 Save only consented accounts (red-green)
  - **File**: `backend/main.lua`, `tools/test_backend_saves.lua`
  - **Dependencies**: 1C.2
  - **Red**: account 111 consented, 222 with no consent record, 333 declined:
    - licences for 222, then for 111: the cache file holds 111 only. Expected failure today: it
      holds 222 too.
    - `ClearCache("111")` with 222's licences in memory: the file holds neither.
    - `SetFriendsCache` for 222 returns true, writes no friends file, and `GetFriendsCache("222")`
      still returns the list. Expected failure today: the file is written with 222.
    - friends for 111 and 222: the file holds 111 only. 333 behaves like 222 throughout.
    - after every save, the in-memory caches still hold 222.
  - **Green**: a helper builds a shallow copy holding only accounts whose `consentState[id]` is a
    table with `allowed == true`. `save_cache_to_file` and `save_friends_to_file` save that copy.
    `SetFriendsCache` skips its save for an unconsented account (logged, returns true), like the
    existing licence check at `backend/main.lua:272-277`, which stays.
  - **Verification**: plan acceptance "for an account without consent, no licence or friends data
    reaches disk".

- [✅] 1C.4 Undo failed saves and return `SetConsent`'s result (red-green)
  - **File**: `backend/main.lua`, `tools/test_backend_saves.lua`
  - **Dependencies**: 1C.2
  - **Red**: each case starts from successfully saved data, then sets `env.fail.open_write`, which
    fails saves with today's and 1B's `JsonStore` alike, so this task doesn't wait for 1B:
    - `UpsertGiverData` editing a record returns a falsy value and `GetGiverData` returns the
      previous record. Expected failure today: the edited record.
    - `UpsertGiverData` for a new account 444 fails; after clearing the failure, a save for 111
      writes a file with no 444 key. Expected failure today: 444 is written.
    - `DeleteGiverData` returns false and the record is still returned, including when it was the
      account's last record.
    - `SetConsent(true, "555")` with no prior record returns false and `HasUserConsented("555")`
      returns nil. With a prior `false` record, the record and its timestamp are restored.
      Expected failure today: returns true and the new value sticks.
    - `SetUiSettings` returns false and `GetUiSettings` returns the previous settings.
    - Characterisation of the cache rule: a failed licence save keeps the page in memory.
  - **Green**: capture the previous value before mutating and restore it on failure (research
    "Undoing failed saves"). Record whether the giver account existed before calling
    `normalize_giver_payload` (see Gotchas). `SetConsent` builds a new record table and returns the
    save result.
  - **Verification**: plan acceptance "a failed gift, consent or settings save leaves memory
    matching the disk". The UI side is 1E.4 (decision 1).

- [✅] 1C.5 Save both caches when consent is granted (red-green, A9)
  - **File**: `backend/main.lua`, `tools/test_backend_saves.lua`
  - **Dependencies**: 1C.3, 1C.4
  - **Red**: licences and friends for 222 in memory, no files; `SetConsent(true, "222")` leaves
    both files holding 222. Expected failure today: neither file exists. With
    `env.fail.only_path = "gratitude_cache"` and `env.fail.open_write` set, `SetConsent` still
    returns true and the cache failure is logged. `SetConsent(false, "222")` opens no cache or
    friends file for writing.
  - **Green**: after a successful consent save with `consent == true`, call both cache saves.
  - **Verification**: tests pass.

- [✅] 1C.6 Skip unchanged friends saves (red-green)
  - **File**: `backend/main.lua`, `tools/test_backend_saves.lua`
  - **Dependencies**: 1C.3, 1D.1
  - **Red**: consented 111. At t1, `SetFriendsCache(list)` writes the file. At t2, the same list
    reordered returns true, adds no friends path to `env.opened_for_write`, and `GetFriendsCache`
    still shows `updatedAt` t1 on the snapshot and on each friend. Expected failure today: a
    second write with t2. Then the list with one changed `avatarUrl` writes, with t2.
  - **Green**: after normalising, if the account has a snapshot in memory and
    `friends_compare.same_friends(existing.friends, normalizedFriends)` is true, log and return
    true without touching memory or disk. Otherwise replace the snapshot and save as in 1C.3.
  - **Verification**: plan acceptance "loading a Steam Community page twice in a row writes the
    friends cache at most once" (the Steam half is 1G.5).

#### Unit 1D: Friends comparison

- [✅] 1D.1 Write the friends comparison helper (red-green)
  - **File**: `backend/lib/friends_compare.lua`, `tools/test_friends_compare.lua`
    (`TestFriendsCompare`)
  - **Dependencies**: 1A
  - **Contract**: `same_friends(a, b) -> boolean` for two lists of normalised friend records, with
    no `require`s, like `cache_merger.lua`. Compares every field of each record except
    `updatedAt` (no separate field list, after RF10); ignores the list order; a field present on
    one side only differs; duplicates count (one canonical string per friend, sorted, then
    compared). A future field that changes on every sync must be skipped alongside `updatedAt`.
  - **Red**: identical lists; only `updatedAt` differs; reordered; changed avatar; renamed
    friend; nickname added; profile URL removed; friend added; friend removed; both empty; a
    duplicated entry against a single one. Expected failure: the module doesn't exist yet.
  - **Green**: implement until every case passes.
  - **Verification**: plan acceptance "new LuaUnit tests cover ... the friends comparison".

#### Unit 1E: Frontend save handling

- [✅] 1E.1 Characterise `isTruthy`
  - **File**: `frontend/utils/truthy.test.ts`
  - **Dependencies**: 1.0
  - **Steps**: tests that pass today and pin the contract phase 2's error codes rely on (A1):
    `true` and `"true"`/`"TRUE"` are true; `false`, `""`, `"false"`, `"size_limit"` and
    `"save_failed"` are false; `[]` false, `[true]` true; `{}` false, `{ ok: true }` true,
    `{ error: "x", ok: false }` false (first key decides); `1` true, `0`, `null` and `undefined`
    false.
  - **Verification**: `npm test` passes.

- [✅] 1E.2 Extract the gift save sequence unchanged
  - **File**: `frontend/utils/giverSave.ts`, `frontend/components/GiverModal.tsx`
  - **Dependencies**: 1E.1
  - **Steps**: move the sequence at `GiverModal.tsx:180-194` into `saveGiverThenRemoveLegacy`
    keeping today's order (remove the legacy key, then upsert), with `saved` from `isTruthy`. The
    modal passes `removeLegacy` only when `existingGiver.licenseKey !== licenseKey`, and keeps its
    logging and messages. `giverSave.ts` imports only `./truthy`.
  - **Verification**: `npm run type-check`, `npm run lint` and `npm test` pass; the diff changes
    no behaviour.

- [✅] 1E.3 Save before removing the legacy record (red-green)
  - **File**: `frontend/utils/giverSave.ts`, `frontend/utils/giverSave.test.ts`,
    `frontend/components/GiverModal.tsx`
  - **Dependencies**: 1E.2
  - **Red**: fake steps record their call order:
    - upsert resolves `false`: `removeLegacy` is never called, `saved` is false. Expected failure:
      `removeLegacy` was called first.
    - upsert resolves `"save_failed"`: same.
    - upsert resolves `true`: calls are `["upsert", "removeLegacy"]`, `saved` and
      `legacyRemoved` true.
    - `removeLegacy` resolves false or rejects: `saved` true, `legacyRemoved` false, no throw.
    - no `removeLegacy`: `legacyRemoved` is null.
    - upsert rejects: the promise rejects and `removeLegacy` isn't called.
  - **Green**: upsert first; remove only after a truthy result. The modal logs when
    `legacyRemoved` is false (a stale duplicate under the old key, which nothing looks up).
  - **Verification**: plan acceptance "editing a gift stored under an old licence key never loses
    the note when the save fails".

- [✅] 1E.4 Show the real result of a consent save (red-green, decision 1)
  - **File**: `frontend/utils/consent.ts`, `frontend/utils/consent.test.ts`,
    `frontend/components/ConsentModal.tsx`, `frontend/index.tsx`
  - **Dependencies**: 1E.1
  - **Red**: `isConsentSaved` is true for `true` and `"true"`, and false for `false`, `undefined`
    and `"save_failed"`. Expected failure: the module doesn't exist yet.
  - **Green**: implement with `isTruthy`. In `ConsentModal.tsx`, `enableConsent` checks its awaited
    result with `isConsentSaved` and, when it is false, logs an error saying consent wasn't saved
    and the dialog will appear again next session. In `frontend/index.tsx`, the "Grant Permission"
    button sets `hasConsent` to `isConsentSaved(result)` instead of `true` and logs the same error
    on failure. Nothing else in either flow changes (A22).
  - **Verification**: `npm test`, `npm run type-check` and `npm run lint` pass; plan acceptance "a
    failed consent or settings save leaves the UI showing the previous value" (consent half, with
    1C.4).

- [✅] 1E.5 Restore the settings cache when a save fails (red-green, decision 3)
  - **File**: `frontend/utils/settingsSave.ts`, `frontend/utils/settingsSave.test.ts`,
    `frontend/settings.ts`
  - **Dependencies**: 1E.1
  - **Steps**: first extract today's rule unchanged: `settingsAfterSave(previous, next, result)`
    returns `next` whenever the call didn't throw, and `SettingsCache.update` stores its result
    after `SetUiSettings` resolves. The `catch` path keeps restoring `previous`.
  - **Red**: `settingsAfterSave(previous, next, false)` returns `previous`, and so do `undefined`
    and `"save_failed"`; `true` and `"true"` return `next`. Expected failure: the extracted rule
    returns `next` for `false`.
  - **Green**: return `next` only when `isTruthy(result)`. `update` stores the returned value in
    the cache and returns `isTruthy(result)`.
  - **Verification**: `npm test`, `npm run type-check` and `npm run lint` pass; plan acceptance "a
    failed consent or settings save leaves the UI showing the previous value" (settings half, with
    1C.4).

#### Unit 1F: Ignore data file copies

- [✅] 1F.1 Ignore data copies and delete the stray line (A10, decision 4)
  - **File**: `.gitignore`
  - **Dependencies**: 1.0
  - **Steps**: with a command that keeps the CRLF endings (for example Python in binary mode):
    - insert these lines after `backend/gratitude_settings.json` in the `# Gratitude plugin data`
      block, each ending in `\r\n`:

      ```text
      *gratitude_*.json.tmp
      *gratitude_*.json.corrupted.*
      *gratitude_*.json.migrated
      *gratitude_*.json.migrated.*
      ```

    - delete everything after the `tools/reports/\r\n` line, which is the stray `tools/` line saved
      as UTF-16. Don't repair it: a working `tools/` rule would ignore the new LuaUnit file and
      tests.
  - **Verification**: `git check-ignore -v` matches `backend/gratitude_givers.json.tmp`,
    `backend/gratitude_givers.json.corrupted.1760000000`, `backend/gratitude_givers.json.migrated`
    and `backend/gratitude_givers.json.migrated.1760000000`; `git check-ignore -q tools/luaunit.lua`
    and `git check-ignore -q tools/test_json_store.lua` both exit 1 (not ignored);
    `tail -c 16 .gitignore | od -c` ends with `tools/reports/\r\n`;
    `tr -dc '\000' < .gitignore | wc -c` prints `0` (it prints `8` today);
    `git diff --text .gitignore` shows only the four added lines and the deleted stray line.

#### Unit 1H: Logs without personal data

Decision 5. 1H.1, 1H.4 and 1H.5 run after 1B to 1F, because they edit or check log lines in files
those units own. 1H.2 and 1H.3 only add new files and can start earlier.

- [✅] 1H.1 Add the log privacy check (red until 1H.5)
  - **File**: `tools/log-privacy.test.mjs`
  - **Dependencies**: 1B to 1F
  - **Steps**: a vitest test in plain JavaScript, using Node's `fs`, that reads every `.lua` file in
    `backend/` and every `.ts`, `.tsx` and `.js` file in `frontend/`, `webkit/` and `lib/`, skipping
    test files, `lib/logger.ts` and the `frontend/lib` and `webkit/lib` symlinks (A21). For each log
    call (`logger:info`, `logger:warn`, `logger:error` and `print` in Lua; `log`, `logError`,
    `logDebug` and `console.*` in TypeScript) it takes the whole argument list, across lines, and
    fails, naming the file and line, when the arguments mention a risky identifier outside
    `maskId(...)`, `mask_id(...)`, `safeLicenseKey(...)` or `safe_license_key(...)`. Risky
    identifiers, matched as whole words: `steamUserID`, `steamID`, `steamid`, `steamID64`,
    `accountID`, `appSteamID`, `globalSteamID`, `displayName`, `existingDisplayName`, `notes`,
    `profileUrl`, `nicknameOrAlias`, `avatarUrl`, `gameName`, `gameTitle`, `libraryTitle`,
    `licenseKey`, `item`, `payload`, `payloadJson`, `licenseData`, `friendsJson`, `row`, `href` and
    `src`. Self-tests on inline snippets cover a flagged call, a masked call, a call split over
    several lines and the opt-out comment.
  - **Red**: `npm test` fails and lists today's offenders, which should match the survey in 1H.4
    and 1H.5. It stays red until 1H.5; no other unit runs at this point.
  - **Verification**: the self-tests pass and the offender list matches the survey; any extra
    offender is added to 1H.5.

- [✅] 1H.2 Write the TypeScript masking helpers (red-green, A20)
  - **File**: `lib/log-redact.ts`, `frontend/utils/log-redact.test.ts`
  - **Dependencies**: 1.0
  - **Red**: `maskId("1234569341")` and `maskId(1234569341)` give `"****9341"`; a 17 digit SteamID64
    keeps only its last four; `"9341"` and `"41"` give `"****"`; `""`, `null` and `undefined` give
    `"<none>"`. `safeLicenseKey("220")` gives `"220"`; `"Half-Life 2"` and `"220a"` give
    `"non-numeric key"`; `""`, `null` and `undefined` give `"<none>"`. Expected failure: the module
    doesn't exist yet.
  - **Green**: implement with no imports. The test sits in `frontend/utils/` so vitest runs it once
    (A19).
  - **Verification**: `npm test` runs it once and it passes.

- [✅] 1H.3 Write the Lua masking helpers (red-green, A20)
  - **File**: `backend/lib/log_redact.lua`, `tools/test_log_redact.lua` (`TestLogRedact`)
  - **Dependencies**: 1A
  - **Red**: the same cases as 1H.2 for `mask_id` and `safe_license_key`, with `nil` in place of
    `null` and `undefined`. Expected failure: the module doesn't exist yet.
  - **Green**: implement with no `require`s, like `cache_merger.lua`.
  - **Verification**: `npm run test:lua -- -p TestLogRedact` passes.

- [✅] 1H.4 Remove personal data from backend logs (red-green)
  - **File**: `backend/main.lua`, `backend/lib/JsonStore.lua`, `tools/test_log_privacy.lua`
    (`TestLogPrivacy`)
  - **Dependencies**: 1H.1, 1H.3, 1B (owns `JsonStore.lua` until it finishes)
  - **File paths (decision O2)**: `JsonStore` logs file names only, never full paths, because on
    Linux the path contains the user's home folder name. This covers the save, load, overwrite,
    set-aside (`.corrupted`) and temporary file messages. Red: run a save, a load and a set-aside
    in a temporary folder whose path contains a distinctive name such as `home-zebedee`; no log
    message contains it, and the file name appears. Green: log `fs.filename(path)` (add `filename`
    to the `fs` stand-in if 1A didn't).
  - **Red**: drive the backend with distinctive values (account `"1234569341"`, display name
    "Zebedee Gifter", note "private note text", a profile URL, a friend called "Quentin Friend", a
    gift stored under the legacy key "Secret Game Title", and app ID `"220"`) through `SetConsent`,
    `HasUserConsented`, `SetGameLicenseData`, `GetGameLicenseData`, `UpsertGiverData`,
    `GetGiverData`, `DeleteGiverData`, `SetFriendsCache`, `SetUiSettings` and their error paths. No
    message in `env.logs` contains any of those strings or the full account ID, and `****9341`
    appears. Expected failure today: 22 log lines interpolate the full account ID, and four also
    log licence keys, which can be game or licence names (`backend/main.lua:386`, `438`, `451` and
    `474-477` on 2026-10-17; the lines move after 1C).
  - **Green**: pass every account ID through `log_redact.mask_id` and every licence key through
    `log_redact.safe_license_key`; drop names and payloads from messages. Counts, app IDs and error
    text stay.
  - **Verification**: `TestLogPrivacy` passes and 1H.1 lists no backend offenders.

- [✅] 1H.5 Remove personal data from frontend, webkit and lib logs (red-green)
  - **File**: `frontend/components/GiverModal.tsx`, `frontend/components/GiftBadge.tsx`,
    `frontend/injection/givercache.ts`, `frontend/injection/CacheManager.ts`,
    `frontend/settings.ts`, `frontend/utils/dom.ts`, `lib/steamid.ts`, `webkit/index.tsx`, and any
    other file 1H.1 lists
  - **Dependencies**: 1H.1, 1H.2, 1H.4
  - **Red**: 1H.1, already failing.
  - **Green**: fix every call 1H.1 lists, using `maskId` and `safeLicenseKey`. The survey on
    2026-10-17 found these (line numbers move after 1E):
    - `GiverModal.tsx`: "Saving giver modal data" (175-177) logs the gifter's display name; the
      legacy migration line (181) logs both keys; the save and delete lines (lines 197, 203, 223,
      225 and 230) log the licence key; the delete line (216-218) logs the account ID and display
      name; the open line (420-422) logs the licence key and account ID.
    - `GiftBadge.tsx:162`, `182` and `188`: game names in debug lines.
    - `givercache.ts:42`, `49`, `55`, `62`, `66` and `72`, `CacheManager.ts:80`, `84` and `127`, and
      `settings.ts:58` and `82`: account IDs and licence keys.
    - `frontend/utils/dom.ts:41` and `60`: link and image URLs, which can carry a game's store slug.
    - `lib/steamid.ts:39`, `48`, `56`, `78`, `85` and `94`: account IDs and SteamID64s.
    - `webkit/index.tsx:51` ("Fetching owned games for Steam ID") and `403` (a whole licence table
      row).
    - `lib/license-matching.ts` has no log calls, and the observer logic in
      `lib/framework/InjectionEngine.ts` logs only component IDs.
  - **Verification**: `npm test` is green again, 1H.1 included; `npm run type-check` and
    `npm run lint` pass; plan acceptance "no log line contains a gifter name, note, profile link,
    friend name, licence or game name, or an unmasked account ID or SteamID64" (with 1H.4 and
    1G.7).

#### Unit 1G: Phase 1 close-out

- [✅] 1G.1 Add the phase 1 changelog entries
  - **File**: `CHANGELOG.md`
  - **Dependencies**: 1A to 1H
  - **Steps**: add `### Fixed` under `## Unreleased`, after `### Changed`, with these four agreed
    entries, verbatim:
    - Fixed license and friends data being saved to disk before storage consent was given.
    - Fixed data files being left empty or cut short if Steam closes, is killed or runs out of disk
      space during a save.
    - Fixed unreadable data files being overwritten instead of kept aside as `.corrupted` copies.
    - Fixed logs including gifter names, license names, full Steam account IDs and file paths.
  - **Verification**: four entries under `## Unreleased`; no other line changed.

- [✅] 1G.2 Run every automated check
  - **File**: none
  - **Dependencies**: 1A to 1H
  - **Verification**: `npm run test:lua`, `npm test` (log privacy check included),
    `npm run type-check`, `npm run lint` and `npm run build` all pass; `on_unload` in
    `backend/main.lua` contains no save call.

- [✅] 1G.3 Prepare for testing in Steam (needs Tim to quit Steam)
  - **File**: none
  - **Dependencies**: 1G.2
  - **Steps**: with Steam fully quit, copy `backend/gratitude_*.json` to
    `~/gratitude-backup-<YYYY-MM-DD>/`, outside the repo. Run `npm run build` on `fix/safe-saves`.
    Start Steam in dev mode with `gtk-launch steam-dev`. Backend logs are in
    `~/.local/share/Steam/logs/console-linux.txt` (`grep -i gratitude`).
  - **Verification**: the backup holds five files matching `backend/` in size.

- [✅] 1G.4 Kill Steam during saves (needs Tim)
  - **File**: none
  - **Dependencies**: 1G.3
  - **Steps**:
    1. Clear the caches from Gratitude's settings sidebar (it clears the licence and friends
       caches), so the next Store sync isn't skipped by the unchanged licence count check
       (`webkit/index.tsx:74-89`).
    2. Record `stat -c '%Y %s %n' backend/gratitude_*.json`.
    3. Open `steam://openurl/https://store.steampowered.com/?gratitude_sync=1`. Each licence page
       saves the whole cache, about 90 KB. While the sync overlay is still counting pages, and
       with Tim's go-ahead, `kill -9` Steam's main process.
    4. With Steam stopped: every `backend/gratitude_*.json` is non-empty and parses
       (`lua -e` with `cjson` per file); a leftover `gratitude_cache.json.tmp` is allowed; consent,
       givers, friends and settings keep their step 2 mtimes (no shutdown save).
    5. Start Steam: the `.tmp` is gone, the log shows no decode errors, gift badges appear.
    6. Repeat three times, and once more killing the Lua host child process instead of Steam
       (find it under Steam in `ps -ef --forest`; its process name wasn't checked while writing
       this spec).
  - **Verification**: plan acceptance "killing the Lua host or Steam during saves never leaves a
    store empty, cut short or unreadable".

- [✅] 1G.5 Load Steam Community twice (needs Tim)
  - **File**: none
  - **Dependencies**: 1G.3
  - **Steps**: with consent given, open any Steam Community page and wait for the friends log
    line. Record `stat -c '%Y' backend/gratitude_friends.json`. After at least two seconds, load a
    Community page again: the log shows the unchanged line and the mtime is the same. If the second
    load writes, find which field differs without sharing friends' names; if it is `avatarUrl`,
    Steam's avatar URLs aren't stable between loads. Report that to Tim rather than changing the
    comparison, because the plan counts any change as a change.
  - **Verification**: plan acceptance "loading a Steam Community page twice in a row writes the
    friends cache at most once", including the avatar URL check.

- [✅] 1G.6 Set-aside and leftover temp file in Steam (needs Tim to quit Steam)
  - **File**: none
  - **Dependencies**: 1G.3
  - **Steps**: with Steam quit, make `backend/gratitude_settings.json` a 0 byte file, write
    `{"broken":` into `backend/gratitude_friends.json`, and create
    `backend/gratitude_givers.json.tmp` holding `{"partial":`. Start Steam.
  - **Verification**: `gratitude_settings.json.corrupted.<t>` and
    `gratitude_friends.json.corrupted.<t>` hold the original bytes and the log names them; the
    givers `.tmp` is gone and `gratitude_givers.json` is unchanged; Gratitude still works;
    `git status --short` shows none of these files. Cleanup with Steam quit: delete the
    `.corrupted.*` files from this test and restore both files from the backup.

- [✅] 1G.7 Edit a gift stored under a legacy key (needs Tim to quit Steam)
  - **File**: none
  - **Dependencies**: 1G.3
  - **Steps**: there are no real gift records on this machine, so seed one with Steam quit. Take
    the account ID from `backend/gratitude_consent.json` and a gifted game whose app ID is in the
    cache's `byAppId` with `"acquisition": "Gift/Guest Pass"`. Key the record by the game's
    library title, the legacy key the badge falls back to (`frontend/components/GiftBadge.tsx:186`):

    ```json
    {"<accountId>": {"<library title>": {"licenseKey": "<library title>", "libraryTitle": "<library title>", "displayName": "Legacy Tester", "source": "manual", "createdAt": 1760000000, "updatedAt": 1760000000, "notes": "legacy key note"}}}
    ```

    Start Steam, open the game, open the gift modal, edit the note and save.
  - **Verification**: `gratitude_givers.json` holds the record under the app ID with the new note
    and no longer holds the title key; the log shows the upsert before the delete. Gratitude's
    backend lines in the Steam log since this start contain neither "Legacy Tester", the note, the
    library title nor the full account ID; the masked `****` form appears instead. Restore the file
    from the backup afterwards.

- [✅] 1G.8 Deep review of phase 1 (decision 6)
  - **File**: none
  - **Dependencies**: 1G.1 to 1G.7
  - **Steps**: run Tim's `/deep-review` skill as described under "How `/deep-review` runs here":
    `git add -N` each new phase 1 file, then `Scope: uncommitted` with `build/regenerate-lockfile`
    named as the base. Fix every
    Blocker, Critical and Major finding, or record why it stays where the code or repository docs
    will show it next time, which is what `/deep-review`'s memory needs to treat it as accepted.
    Rerun 1G.2 and repeat any Steam check whose code changed.
  - **Verification**: no open Blocker, Critical or Major finding.

- [✅] 1G.9 Commit phase 1
  - **File**: none (git)
  - **Dependencies**: 1G.8
  - **Steps**: `git status --short` lists only phase 1 files plus `?? docs/`. Stage each file by
    path. Show Tim the message, then commit.

    ```text
    fix: make data saves atomic and keep unconsented data off disk

    - write each store to a temporary file, check the write and close, then rename it
    - set unreadable data files aside as .corrupted copies instead of overwriting them
    - undo failed gift, consent and settings saves in memory and show the real result in the ui
    - remove the shutdown save and return the consent save result
    - save licence and friends caches only for consented accounts
    - skip friends cache saves when the friend list is unchanged
    - save gift records before removing a legacy key in the gift modal
    - keep personal data out of logs and mask account ids
    - ignore temporary and set-aside data copies in git and drop the broken last line
    - add LuaUnit and a runner for every Lua test file
    ```

  - **Verification**: `git log -1 --format='%ae %ce'` prints
    `timmblyth@gmail.com timmblyth@gmail.com`; `git status --short` shows only `?? docs/`;
    nothing pushed.

### Review Fixes (phase 1)

From the 1G.8 deep review: no Blocker, Critical or Major; Tim chose to resolve these Minor and
Trivial findings before the phase 1 commit. Red then green wherever behaviour changes.

- [✅] RF1 Keep a leftover `.tmp` when it can't be promoted or read
  - **File**: `backend/lib/JsonStore.lua`, `tools/test_json_store.lua`
  - **Severity**: Minor (found by correctness, tests, reuse)
  - **Fix**: with no store file, a `.tmp` that parses but can't be renamed into place, or can't be
    opened to check, stays on disk and saves are refused for the session (as `set_aside` does). A
    `.tmp` is removed only beside a store file or after being read and found invalid; the removal
    is logged only when `fs.remove` succeeds. Build the `.tmp` path once in `JsonStore.new`.
- [✅] RF2 Treat a read error like an open failure
  - **File**: `backend/lib/JsonStore.lua`, `tools/test_json_store.lua`, `tools/lua_test_support.lua`
  - **Severity**: Minor (data)
  - **Fix**: when `file:read` returns nil, log the error without the path, leave the file in
    place and refuse saves, instead of setting a healthy file aside. Add `env.fail.read`.
- [✅] RF3 One consent check, and caches wait while consent is unknown
  - **File**: `backend/main.lua`, `tools/test_backend_saves.lua`
  - **Severity**: Minor (reuse, correctness, api; data)
  - **Fix**: `SetGameLicenseData` uses `has_storage_consent`. While the consent store's saves are
    blocked (consent couldn't be read at load), licence and friends saves are refused rather than
    filtered to nobody, so Clear cache can't wipe other accounts.
- [✅] RF4 `ClearCache` returns its save result
  - **File**: `backend/main.lua`, `tools/test_backend_saves.lua`
  - **Severity**: Minor (api)
- [✅] RF5 `normalize_giver_payload` stops creating the account
  - **File**: `backend/main.lua`
  - **Severity**: Minor (reuse); the shared undo helper is deferred to phase 2
- [✅] RF6 Guard tests: a failed consent save keeps the caches off disk; `TestLogPrivacy` checks the
  not-found licence key value
  - **File**: `tools/test_backend_saves.lua`, `tools/test_log_privacy.lua`
  - **Severity**: Minor and Trivial (tests)
- [✅] RF7 Delete also removes a gift's legacy key
  - **File**: `frontend/utils/giverSave.ts`, `frontend/utils/giverSave.test.ts`,
    `frontend/components/GiverModal.tsx`
  - **Severity**: Minor (data); the single-save key move is deferred to phase 2
- [✅] RF8 Consent result handled in one tested helper, decline failures logged, accurate message
  - **File**: `frontend/utils/consent.ts`, `frontend/utils/consent.test.ts`,
    `frontend/components/ConsentModal.tsx`, `frontend/index.tsx`
  - **Severity**: Minor and Trivial (tests, api, correctness)
- [✅] RF9 Settings cache tested at its real call site, and a failed save restores only its own
  value
  - **File**: `frontend/settings.ts` and a new test in `frontend/utils/`
  - **Severity**: Minor and Trivial (tests, data)
- [✅] RF10 Friends comparison compares every field except `updatedAt`
  - **File**: `backend/lib/friends_compare.lua`, `tools/test_friends_compare.lua`
  - **Severity**: Minor (reuse)
- [✅] RF11 Log check flags variables that hold personal data
  - **File**: `tools/log-privacy.test.mjs`, plus named opt-outs where only `.length` is logged
  - **Severity**: Minor (security); runs after RF1 to RF10
- [✅] RF12 Record without code change: atomic saves reset tightened permissions (plan trade-off);
  the hand-written lexer stays; shared undo helper, shared test fixtures and the single-save key
  move go to phase 2; running the suites in CI is a separate later change
  - **File**: `docs/llm/active/plan-data-storage.md`, this spec

### Phase 2: Move hand entered data into millennium.config (branch `feat/config-storage`)

- [✅] 2.0 Create the phase 2 branch
  - **File**: none (git)
  - **Dependencies**: 1G.9
  - **Steps**: `git switch -c feat/config-storage fix/safe-saves`.
  - **Verification**: `git log --oneline -1` shows the phase 1 commit.

#### Unit 2A: Fake millennium.config

- [✅] 2A.1 Add the fake config to the test support module
  - **File**: `tools/lua_test_support.lua`, `tools/test_lua_test_support.lua`
  - **Dependencies**: 2.0
  - **Steps**: implement the **Fake millennium.config** contract; `env.config = config` makes
    `require("millennium").config` return it, and nil keeps file mode. Tests first: a missing key
    is nil; `get` returns a copy; a value over `value_limit` is refused with Millennium's message
    and the old value kept; a new key past `key_limit` is refused while updating an existing key
    works; with `saving_disabled`, `restart()` loses the session's writes; without it, `restart()`
    keeps them; `fail_get_all` makes `get_all` return nil and the error; integer-looking keys come
    back as strings.
  - **Verification**: `npm run test:lua -- -p TestLuaTestSupport` passes.

#### Unit 2B: Config storage and migration

- [✅] 2B.1 Retire store files and read `.migrated` copies (red-green, A5)
  - **File**: `backend/lib/JsonStore.lua`, `tools/test_json_store.lua`
  - **Dependencies**: 2.0
  - **Red** (time frozen at T):
    - `retire()` with no `.migrated`: the file becomes `<path>.migrated`, which is returned.
    - with `.migrated` present: the file becomes `<path>.migrated.T`; `.migrated` is unchanged.
    - with `.migrated` and `.migrated.T` present: returns nil and a reason; nothing is renamed or
      overwritten.
    - `load_newest_migrated()` with `.migrated`, `.migrated.100` and `.migrated.200` returns the
      `.200` data; with only `.migrated`, its data; with none, nil; an unreadable newest copy is
      logged and skipped for the next newest.
    - `load_newest_migrated()` changes no file's name or bytes.

    Expected failure: the methods don't exist yet.
  - **Green**: implement in `JsonStore`, deriving every name from `store.path` and listing
    `store.dir` with `fs.list`.
  - **Verification**: tests pass; no path is built outside `JsonStore`.

- [✅] 2B.2 Read and save config values (red-green)
  - **File**: `backend/lib/config_store.lua`, `tools/test_config_store.lua` (`TestConfigStore`)
  - **Dependencies**: 2A.1
  - **Contract**:

    ```lua
    config_store.VALUE_LIMIT = 262144
    config_store.snapshot()                      --> all | nil, err ("unavailable" without config)
    config_store.accounts(snapshot, prefix)      --> { [accountId] = value } for "<prefix>.<id>"
    config_store.save(prefix, accountId, value)  --> true | false, "size_limit" | "save_failed"
    ```

  - **Red**: `accounts` picks `givers.111` and `givers.222` and ignores `consent.111` and
    `giversx.1`; `save` sets `givers.111`; a value whose `json.encode` is over 262,144 bytes
    returns `false, "size_limit"` without calling `set`; with the fake's `value_limit` at 1,000, a
    2,000 byte value is refused by `set` and also returns `"size_limit"`; a key limit refusal
    returns `"save_failed"`; `snapshot` passes through `get_all`'s error. Expected failure: the
    module doesn't exist yet.
  - **Green**: implement with `millennium.config` and `json` (lua-cjson's `\/` escaping makes the
    pre-check slightly stricter than Millennium's, which is the safe side).
  - **Verification**: tests pass.

- [✅] 2B.3 Implement the migration rule (red-green)
  - **File**: `backend/lib/config_store.lua`, `tools/test_config_store.lua` (`TestConfigMigration`)
  - **Dependencies**: 2B.1, 2B.2
  - **Contract**: `config_store.migrate({ prefix, store, snapshot, fallback_to_migrated })`
    returns the store's in-memory data, its mode (`"config"` or `"file"`), and the accounts that
    may be saved this session, nil meaning all (RF2.1, RF2.2).
    `fallback_to_migrated` is true for givers and settings, false for consent. Per account:

    | Situation at startup | Data used | Writes |
    | --- | --- | --- |
    | No config, or the snapshot failed (A15) | store file; if absent and fallback is on, newest `.migrated` | none now; saves go to the store file |
    | Config has the account's key | config value; the file's copy of that account is ignored | none |
    | Account in the store file, key absent | file value | `set` the key |
    | Every account in a successfully loaded store file had its key at startup (A4) | config | retire the store file (A5) |
    | Store file absent or set aside, fallback on, a `.migrated` copy exists | config keys, plus `.migrated` accounts without a key | `set` those accounts (A12); `.migrated` untouched |
    | Store file couldn't be opened (A11) | config only | none; file kept |

  - **Red**, each a series of sessions with `config.restart()` between:
    1. Session 1: file holds 111 and 222, config empty: both returned, both keys set, file kept.
       Session 2: file retired to `.migrated`, data from config, no `set` calls.
    2. `saving_disabled` in session 1: session 2 finds no keys, copies again and keeps the file;
       session 3 retires it. This is the later-session rule.
    3. Config has 111 at startup, file has 111 and 222: only 222 is copied and the file is kept;
       the next session retires it.
    4. Config's 111 differs from the file's 111: config wins.
    5. File `{}`: retired at the first startup with config (A4).
    6. Config empty, only `.migrated` present: with fallback on, its data is returned and copied,
       and `.migrated` is untouched; with fallback off, the data is empty and nothing is set.
    7. No config: file mode; only `.migrated` present gives its data with fallback on, nothing
       with fallback off.
    8. `fail_get_all`: file mode, no `set`, nothing retired.
    9. Unreadable store file: set aside (phase 1), not retired, fallback applies.
    10. Steady state: everything already in config makes no `set` call and touches no file.

    Expected failure: `migrate` doesn't exist yet.
  - **Green**: implement `migrate` from the table.
  - **Verification**: plan acceptance "an old file is renamed to `*.migrated` only in a session
    after its data was copied into config" and "new tests cover the migration rule and the
    fallbacks".

- [✅] 2B.4 Use config for gift records, consent and settings (red-green)
  - **File**: `backend/main.lua`, `tools/test_backend_config.lua` (`TestBackendConfig`)
  - **Dependencies**: 2B.3
  - **Steps**: `on_load` loads the two caches as today, takes one `config_store.snapshot()`,
    migrates givers, consent and settings with it and records each mode, then registers the browser
    scripts and calls `millennium.ready()` as today. Each moved store saves one account through a
    single helper: config mode calls `config_store.save(prefix, id, value)`, file mode saves the
    whole table with that store's `JsonStore`. In config mode, deleting an account's last gift
    saves `{}` (A13); file mode keeps today's removal of the empty account. Phase 1's undo and
    consent filter stay as they are.
  - **Red**, sessions via `env.load_backend()` sharing one fake config across `restart()`:
    - With config: seed all three files for 111. Session 1 returns the file data through
      `GetAllGiverData`, `HasUserConsented` and `GetUiSettings`; session 2 returns the same data
      and the three files are now `.migrated`.
    - Without config (`env.config = nil`): the same seeds load from the files, saves rewrite the
      files, and no `.migrated` file appears.
    - `UpsertGiverData` for 111 in config mode: `set_calls` is only `givers.111`,
      `gratitude_givers.json` isn't opened for writing, and 222's key is unchanged.
    - `SetConsent` and `SetUiSettings` write `consent.111` and `settings.111`.
    - Deleting 111's last gift leaves `givers.111` as `{}`; in a later session with a `.migrated`
      copy present, the deleted gift doesn't come back.
    - Config reset after migration (new empty fake config, `.migrated` files present): gift
      records and settings come back and `HasUserConsented` returns nil.
    - Downgrade after migration (`env.config = nil`): gift records and settings come from
      `.migrated`, consent is nil, an upsert writes `gratitude_givers.json`; back on config, config
      wins and that file becomes `.migrated.T` while the older `.migrated` is untouched (A5, A6).
    - Consent read from config still filters the caches: a consented account's licences reach the
      cache file, an unconsented one's don't.
    - A config save refused for the key limit is undone in memory.

    Expected failure: today's `main.lua` never touches config.
  - **Green**: wire as described.
  - **Verification**: plan acceptance "existing users' gift notes, consent and settings survive
    the upgrade, on Millennium both with and without millennium.config" (automated half), "after a
    `config.json` reset ... the consent dialog appears again" and "every store stays partitioned
    per account".

#### Unit 2C: Note cap and error codes

- [✅] 2C.1 Count note length in characters (red-green, A3)
  - **File**: `backend/lib/note_limit.lua`, `tools/test_note_limit.lua` (`TestNoteLimit`)
  - **Dependencies**: 2.0 (needs 1A's runner, already committed)
  - **Contract**: `NOTE_MAX_CHARS = 2000`, `char_count(s)`, `is_within_limit(s)`.
  - **Red**: `""` counts 0; 2,000 ASCII characters are within the limit and 2,001 aren't; 2,000
    copies of "日" (6,000 bytes) are within and 2,001 aren't; 1,000 copies of U+1F600, a 4 byte
    character that is 2 UTF-16 units (what a 2,000 unit `maxLength` allows), are within; "é" counts
    as one. Expected failure: the module doesn't exist yet.
  - **Green**: `select(2, s:gsub("[^\128-\191]", ""))`.
  - **Verification**: tests pass under Lua 5.1.

- [✅] 2C.2 Return error codes from `UpsertGiverData` (red-green, A1)
  - **File**: `backend/main.lua`, `tools/test_backend_config.lua`
  - **Dependencies**: 2B.4, 2C.1
  - **Red**:
    - invalid JSON or a missing required field returns `"invalid_payload"`. Expected failure
      today: `false`.
    - a 2,001 character note returns `"note_too_long"` in config mode and in file mode, with
      nothing stored, set or written.
    - a 2,000 character note in "日" returns `true` (the boolean).
    - config mode, an account pushed past 262,144 bytes by records with 2,000 character notes:
      `"size_limit"`, `GetGiverData` shows the previous state, the config value is unchanged and
      no file is written.
    - the fake's `value_limit` lowered so `set` refuses: `"size_limit"`; key limit: `"save_failed"`.
    - file mode with `env.fail.open_write`: `"save_failed"`.
  - **Green**: check the note cap before any mutation, map failures to the A1 codes, and add a
    comment at `UpsertGiverData` explaining why it returns strings (only the first return value
    reaches the frontend, and `isTruthy` reads them as false) and why the other callables don't
    (A2).
  - **Verification**: plan acceptance "a note over 2,000 characters is rejected by the backend, and
    a refused oversized save shows ... nothing half saved" (backend half).

#### Unit 2D: Gift modal note cap and messages

- [✅] 2D.1 Note counter and cap functions (red-green, A16, A17)
  - **File**: `frontend/utils/giverNotes.ts`, `frontend/utils/giverNotes.test.ts`
  - **Dependencies**: 2.0
  - **Red**: `shouldShowNoteCounter` is false at 1,799 characters and true at 1,800;
    `formatNoteCounter` gives `"1850 / 2000"`; `isNoteWithinCap` is true at 2,000, false at 2,001,
    true for 2,000 characters plus trailing spaces, and true for 1,000 copies of U+1F600
    (length 2,000).
    Expected failure: the module doesn't exist yet.
  - **Green**: implement the contract.
  - **Verification**: `npm test` passes.

- [✅] 2D.2 Map save results to modal messages (red-green)
  - **File**: `frontend/utils/giverSave.ts`, `frontend/utils/giverSave.test.ts`
  - **Dependencies**: 2.0
  - **Red**: `giverSaveErrorMessage("size_limit")` returns "Couldn't save: this account's gift
    notes have reached Millennium's storage limit. Shorten or remove some notes." (the plan's
    wording); `"note_too_long"` returns "Notes are limited to 2,000 characters." (A16); `false`,
    `"save_failed"`, `"invalid_payload"`, `undefined` and any unknown string return "Unable to save
    giver data.". Expected failure: the function doesn't exist yet.
  - **Green**: implement.
  - **Verification**: `npm test` passes.

- [✅] 2D.3 Wire the cap, counter and messages into the gift modal
  - **File**: `frontend/components/GiverModal.tsx`, `frontend/injection/givercache.ts`
  - **Dependencies**: 2D.1, 2D.2
  - **Steps**: the notes textarea gets `maxLength={NOTE_MAX_LENGTH}`; below it, the counter shows
    when `shouldShowNoteCounter(notes)`, styled like the existing status message
    (`GiverModal.tsx:390-392`). `handleSave` shows the A16 message without calling the backend when
    `isNoteWithinCap(notes)` is false, and on a failed save shows
    `giverSaveErrorMessage(outcome.upsertResult)`. The thrown error path keeps the generic message.
    In `givercache.ts`, `UpsertGiverData` is typed as returning `boolean | string` and `upsert`
    returns that, with a short comment on the code convention.
  - **Verification**: `npm run type-check`, `npm run lint`, `npm test` and `npm run build` pass;
    the Steam check is 2F.6.

#### Unit 2E: Docs and type stubs

- [✅] 2E.1 Declare `millennium.config` in the editor stubs
  - **File**: `types/millennium.lua`
  - **Dependencies**: 2.0
  - **Steps**: declare `get`, `set`, `delete`, `get_all` and `on_change` with the return values in
    research section 4.2. Editor support only; nothing runs this file.
  - **Verification**: `lua -e 'assert(loadfile("types/millennium.lua"))'` reports no syntax
    error.

- [✅] 2E.2 Add the README data storage section
  - **File**: `README.md`
  - **Dependencies**: 2.0
  - **Steps**: add `## Where Gratitude stores your data` before `## Acknowledgments`, one line per
    paragraph like the rest of the README, in UK English. Cover exactly the plan's three points:
    - where each kind of data lives: gift records, consent and settings in Millennium's plugin
      config (`~/.config/millennium/config.json` on Linux, `<Steam>\millennium\config\config.json`
      on Windows); the licence and friends caches as files in the plugin folder; everything as
      files in the plugin folder on Millennium older than 3.0.0;
    - what happens on uninstall: answering no to "Do you want to delete saved settings for
      Gratitude - Gifted Games Reminder?" keeps gift notes, consent and settings, while yes deletes
      gift notes too, even though the prompt says "settings"; deleting the plugin folder by hand
      leaves the config values; on Millennium older than 3.0.0 uninstalling deletes everything;
    - removing Millennium removes Gratitude's data too, because nothing is stored in the cloud.
  - **Verification**: the plan's three points are present; no em or en dashes.

- [✅] 2E.3 Update the storage descriptions in AGENTS.md and backend/AGENTS.md (A10)
  - **File**: `AGENTS.md`, `backend/AGENTS.md`
  - **Dependencies**: 2.0
  - **Steps**: in `AGENTS.md`, the section 2 diagram shows consent, givers and settings in
    millennium.config with a file fallback; section 3.3 step 4 names the `givers.<accountId>` key;
    section 4.2 describes per account config keys and the file fallback; section 6 adds
    `backend/lib/JsonStore.lua` (atomic saves, set-aside, `.migrated` handling) and
    `backend/lib/config_store.lua`. In `backend/AGENTS.md`, the runtime data list adds
    `gratitude_settings.json`, says which files are fallback only after migration, and mentions the
    `.tmp`, `.corrupted.*` and `.migrated*` copies; responsibilities mention millennium.config.
    Keep the mermaid syntax simple, with no semicolons in node text.
  - **Verification**: no description still says gift records, consent or settings live only in
    JSON files.

#### Unit 2G: Carried over from the phase 1 review

Decided by Tim on 2026-10-17 (plan, start of stage 2). Red then green wherever behaviour changes.

- [✅] 2G.1 Shared Lua test setup and payload builders
  - **File**: `tools/lua_test_support.lua`, `tools/test_lua_test_support.lua`, the backend test files
  - **Dependencies**: 2A (same support module); do before 2B so its new tests use them
  - **Steps**: move the identical `start(env)` helper (load the backend, call `on_load`, silence
    `print` and restore it in `env.cleanup()`) from `tools/test_backend_existing.lua` and
    `tools/test_backend_saves.lua` into the support module as `env.start_backend()`. Add payload
    builders with default arguments (licence page, giver, friends, settings) so each test keeps only
    its overrides. `tools/test_log_privacy.lua` keeps its own payloads, because their private
    values are what it tests. A refactor: every existing test stays green, no new red.
- [✅] 2G.2 One shared helper for undoing a failed save
  - **File**: `backend/main.lua`, backend tests
  - **Dependencies**: 2B.4 (the save paths it wraps change there)
  - **Steps**: replace the four hand-written undo blocks (`SetConsent`, `UpsertGiverData`,
    `DeleteGiverData`, `SetUiSettings`) and the two clears with one helper, for example
    `save_account_change(store, steamUserID, mutate, save)`: remember the account entry, apply the
    change, save, and restore the entry on failure. It must cover the config-backed stores from 2B
    and the file fallback. Existing undo tests are the characterisation; add a test only for a
    path they don't pin.
- [✅] 2G.3 Move a gift to a new key in one backend save (red-green)
  - **File**: `backend/main.lua`, `frontend/utils/giverSave.ts`, `frontend/components/GiverModal.tsx`,
    their tests
  - **Dependencies**: 2C.2 (`UpsertGiverData` error codes), 2D (gift modal), 2G.2
  - **Steps**: `UpsertGiverData` accepts an optional `replacesLicenseKey` inside `payloadJson`. It
    removes that key and adds the new record in one in-memory change before its single save, and
    undoes both on failure. The callable's arguments don't change, so AGENTS.md section 5 isn't
    triggered. The modal's save passes `replacesLicenseKey` instead of a separate remove call;
    `deleteGiverAndLegacy` (RF7) stays. Red: a Lua test where the save after a key move fails must
    leave neither a duplicate nor a lost record; a vitest test that the save sequence makes one
    backend call.

#### Unit 2F: Phase 2 close-out

- [✅] 2F.1 Add the phase 2 changelog entries and check the settings line
  - **File**: `CHANGELOG.md`
  - **Dependencies**: 2B to 2E
  - **Steps**: add the plan's three entries, verbatim, in `### Changed` under `## Unreleased`:
    - "Changed gift records, consent and settings to be stored in Millennium's plugin config, so
      gift notes survive reinstalling the plugin."
    - "Existing gift records, consent and settings now move to Millennium's plugin config
      automatically, with the old files kept as `.migrated` copies."
    - "Limited gift notes to 2,000 characters, with a counter shown near the limit."

    If "Updated the Gratitude sidebar settings to use native Millennium-style controls while
    keeping plugin-owned persistence for UI preferences." is still under `## Unreleased`, trim it
    to end at "native Millennium-style controls."; if a release heading now sits above it, leave
    it. Check again when the branch merges.
  - **Verification**: entries present; only that one existing line touched, and only if
    unreleased.

- [✅] 2F.2 Run every automated check
  - **File**: none
  - **Dependencies**: 2F.1
  - **Verification**: `npm run test:lua`, `npm test`, `npm run type-check`, `npm run lint` and
    `npm run build` pass.

- [✅] 2F.3 Back up before testing in Steam (needs Tim to quit Steam)
  - **File**: none
  - **Dependencies**: 2F.2
  - **Steps**: with Steam fully quit,
    `cp ~/.config/millennium/config.json ~/.config/millennium/config.json.before-gratitude-stage2`,
    and copy `backend/gratitude_*.json` to a new `~/gratitude-backup-<YYYY-MM-DD>-stage2/`. Run
    `npm run build`.
  - **Verification**: both backups exist and match the originals' sizes.

- [✅] 2F.4 Migrate across two sessions in Steam (needs Tim)
  - **File**: none
  - **Dependencies**: 2F.3
  - **Steps**: with Steam quit, seed `gratitude_givers.json` with one record for a gifted game,
    keyed by its app ID and carrying a note (shape as in 1G.7), and `gratitude_settings.json` with
    `{"<accountId>": {"showFriendPickerSteamUrl": true}}`; the consent file already exists.
    1. Session 1: start Steam. The gift and note show. `config.json` now holds `givers.<id>`,
       `consent.<id>` and `settings.<id>` for Gratitude. The research reads the layout as
       `plugins.<name>.config.<key>`; this machine's file has no plugin config yet, so search it
       for `givers.`. The three files are still in `backend/` and no `.migrated` exists.
    2. Quit Steam, asking Tim before any `kill -9`.
    3. Session 2: the three files are now `*.migrated`; the gift and the setting still show.
       Edit the note: `config.json` changes and no new `gratitude_givers.json` appears.
  - **Verification**: plan acceptance "existing users' gift notes, consent and settings survive the
    upgrade" (with millennium.config) and "an old file is renamed to `*.migrated` only in a session
    after its data was copied into config". The without-config path is covered by 2B.4's tests;
    no Millennium older than 3.0.0 is available here.

- [✅] 2F.5 Reset config in Steam (needs Tim)
  - **File**: none
  - **Dependencies**: 2F.4
  - **Steps**: with Steam quit, remove Gratitude's `givers.`, `consent.` and `settings.` keys from
    `config.json` with a short Python script that loads, edits and writes the JSON, then check it
    still parses. Start Steam.
  - **Verification**: the gift, its note and the setting come back from `.migrated`, and the
    consent dialog appears (plan acceptance "after a `config.json` reset, gift records and settings
    come back from `*.migrated`, and the consent dialog appears again"). Answer Allow.

- [✅] 2F.6 Check the note cap and counter in Steam (needs Tim)
  - **File**: none
  - **Dependencies**: 2F.4
  - **Steps**: paste about 2,100 characters into the gift modal's notes.
  - **Verification**: input stops at 2,000; the counter appears from 1,800 and reads like
    `2000 / 2000`; the save succeeds.

- [✅] 2F.7 Uninstall and reinstall on a normal install (Tim performs)
  - **File**: none
  - **Dependencies**: 2F.4
  - **Steps**: never on the symlinked dev install.
    1. Quit Steam. `unlink ~/.local/share/millennium/plugins/gratitude` (removes only the link).
    2. Make a normal install: create the folder `~/.local/share/millennium/plugins/gratitude` and
       copy in `plugin.json`, `.millennium/`, `backend/main.lua` and `backend/lib/`, never the
       data files.
    3. `ls -la ~/.local/share/millennium/plugins/` must show `gratitude` as a directory (`d`), not a
       link (`l`). Stop if it shows a link.
    4. Start Steam, enable Gratitude if needed, and confirm the gift note shows.
    5. Uninstall Gratitude in Millennium's settings and answer **No** to "Do you want to delete
       saved settings for Gratitude - Gifted Games Reminder?". The plugin folder is gone and
       `config.json` still holds Gratitude's keys.
    6. Quit Steam, repeat step 2, start Steam: the gift note is still there.
    7. Optionally repeat step 5 answering **Yes**: the keys are gone. Restore `config.json` from the
       2F.3 backup afterwards.
    8. Quit Steam, check the folder is still the copy and not a link, remove it, and restore the
       dev link: `ln -s /home/tim/personalprojects/Gratitude-Millennium-Plugin
       ~/.local/share/millennium/plugins/gratitude`.
  - **Verification**: plan acceptance "gift notes survive a plugin uninstall and reinstall when the
    user answers no to Millennium's prompt, checked on a normal install".

- [✅] 2F.8 Restore the dev environment
  - **File**: none
  - **Dependencies**: 2F.4 to 2F.7
  - **Steps**: confirm the dev link points at this checkout. Ask Tim whether to restore
    `config.json` and the data files from the backups or keep the migrated state, and whether the
    test's `.migrated` copies should be deleted by hand (Gratitude never deletes them).
  - **Verification**: Tim's choice is applied and Steam starts with Gratitude loaded.

- [✅] 2F.9 Deep review of phase 2 (decision 6)
  - **File**: none
  - **Dependencies**: 2F.1 to 2F.8
  - **Steps**: run Tim's `/deep-review` skill as described under "How `/deep-review` runs here":
    `git add -N` each new phase 2 file, then `Scope: uncommitted` with `fix/safe-saves` named as
    the base. Fix every Blocker, Critical and Major finding, or record
    why it stays where the code or repository docs will show it next time. Rerun 2F.2 and repeat any
    Steam check whose code changed.
  - **Verification**: no open Blocker, Critical or Major finding.

- [✅] 2F.10 Commit phase 2
  - **File**: none (git)
  - **Dependencies**: 2F.9
  - **Steps**: `git status --short` lists only phase 2 files plus `?? docs/`. Stage by path. Show
    Tim the message, then commit.

    ```text
    feat: store gift records, consent and settings in millennium.config

    - copy each account into config and retire the old file as .migrated in a later session
    - fall back to files when millennium.config is unavailable
    - cap gift notes at 2,000 characters with a counter from 1,800
    - show a specific message when an account's gift records reach the storage limit
    - document where gratitude stores data and what uninstalling removes
    ```

  - **Verification**: `git log -1 --format='%ae %ce'` prints
    `timmblyth@gmail.com timmblyth@gmail.com`; nothing pushed.

### Review Fixes (phase 2)

From the 2F.9 deep review; Tim agreed every recommendation on 2026-10-18. Red then green wherever
behaviour changes. Deferred to the plan's Follow-ups: an account already over 256 KB, and whether
a Millennium security question (kept privately).

- [✅] RF2.1 Refuse saves that would hide an unread source
  - **File**: `backend/lib/config_store.lua`, `backend/lib/JsonStore.lua`, `backend/main.lua`,
    `tools/test_config_store.lua`, `tools/test_backend_config.lua`, `tools/test_json_store.lua`
  - **Severity**: Major (found by data, correctness; skeptic confirmed by reading)
  - **Issue**: in config mode, a save while the store file couldn't be read (A11), or while every
    `.migrated` copy failed to read, creates the account's key, which then hides the unread data
    for good and lets the file be retired.
  - **Fix**: `load_newest_migrated` also reports when a copy newer than the one it returns (or
    every copy) exists but couldn't be opened or read. `migrate` returns a third value: when the
    source was unread, the set of accounts that had a config key at startup, otherwise nil.
    `save_moved_account` refuses, with `"save_failed"` and a masked log line, a save for an account
    outside that set. Red: save during the locked session, then restart; the file's older gifts
    must still show.
- [✅] RF2.2 Read-only session when `get_all` fails while millennium.config exists
  - **File**: `backend/lib/config_store.lua`, `tools/test_config_store.lua`,
    `tools/test_backend_config.lua`
  - **Severity**: Minor (data)
  - **Fix**: the moved stores still show the file or newest `.migrated` data, but every save to
    them is refused for that session (an empty editable set). A15 updated.
- [✅] RF2.3 `fs.list` returning nil no longer stops `on_load`
  - **File**: `backend/lib/JsonStore.lua`, `tools/lua_test_support.lua`, `tools/test_json_store.lua`
  - **Severity**: Minor (correctness)
  - **Fix**: a failed listing is logged and treated as "a copy may exist but couldn't be read".
    Add `env.fail.list` to the test support module.
- [✅] RF2.4 README: `.migrated` retention and going back to an older Gratitude
  - **File**: `README.md`
  - **Severity**: Minor and Minor (security, api)
- [✅] RF2.5 Tests for a refused migration copy and a plugin reload; record the toggle as A23
  - **File**: `tools/test_config_store.lua`, `tools/test_backend_config.lua`, this spec
  - **Severity**: Minor and Minor (tests)
- [✅] RF2.6 Cheap fixes
  - **File**: `backend/lib/config_store.lua`, `backend/main.lua`, `backend/lib/log_redact.lua`,
    `backend/lib/JsonStore.lua`, `tools/lua_test_support.lua`, the Lua test files,
    `frontend/utils/giverNotes.ts`, `frontend/utils/giverSave.ts`, `frontend/utils/giverSave.test.ts`,
    `frontend/injection/givercache.ts`
  - **Severity**: Minor and Trivial (reuse, api, tests)
  - **Fix**: one constant per permanent key prefix; shared `support.sorted_keys` and
    `env.snapshot_files` and one `setUp` in `test_config_store.lua`; the note-cap message built
    from `NOTE_MAX_LENGTH`; an exhaustive map of error codes to messages, typed with the codes;
    the fake config checks the key limit before the size, refuses keys over 512 bytes and states
    what it doesn't model; one `log_redact.replace_literal` used by `JsonStore` and `config_store`;
    a note in the one-call test that the call count is fixed by `saveGiver`'s signature.

From the second deep review (run 3); Tim agreed every recommendation and the RF2.8 wording on
2026-10-18. Afterwards: one skeptic on RF2.7 instead of a third full review, then a rebuild and a
Steam smoke test.

- [✅] RF2.7 Close the unread-source class
  - **File**: `backend/lib/config_store.lua`, `backend/main.lua`, `tools/test_config_store.lua`,
    `tools/test_backend_config.lua`
  - **Severity**: Minor x3 (correctness, data, tests): the run 2 Major's class, not fully closed
  - **Fix**: while any source for a store is unread, nothing writes a key or file for the
    accounts it might hold: `migrate` shows fallback accounts without copying them into config;
    the no-config fallback keeps the unread flag and makes the store read-only; cache and
    friends saves are refused while consent is unknown because the consent store is read-only.
- [✅] RF2.8 Tell the user a session-long refusal needs a Steam restart
  - **File**: `backend/main.lua`, `frontend/utils/giverSave.ts`, tests
  - **Severity**: Minor (api)
  - **Fix**: a fifth `UpsertGiverData` code, `read_only`, for refusals from an unread source;
    message "Gratitude couldn't read some of your saved gift details when Steam started, so
    changes can't be saved until you restart Steam." (Tim's approval). A1 updated.
- [✅] RF2.9 Check account IDs before they become config keys; log a fixed `get_all` failure
  - **File**: `backend/lib/config_store.lua`, `backend/main.lua`, tests
  - **Severity**: Minor x2 (security)
- [✅] RF2.10 README: removing Millennium, and timestamped `.migrated` copies
  - **File**: `README.md`
  - **Severity**: Minor and Trivial (security, api)
- [✅] RF2.11 Refactors: shared log, write and JSON test helpers; one readable-file definition in
  `JsonStore`; a delete failure message constant; the real A2 rationale; no spec IDs in comments
  - **File**: `tools/lua_test_support.lua`, the Lua test files, `backend/lib/JsonStore.lua`,
    `frontend/utils/giverSave.ts`, `frontend/components/GiverModal.tsx`, `backend/main.lua`
  - **Severity**: Minor x2 and Trivial x2 (reuse, api)
- [✅] RF2.12 Tests: `givercache.upsert` passes the payload and the code through; the fake's
  check-order test pins key length; `env.list` bypasses fault injection
  - **File**: `frontend/injection/givercache.test.ts` (new), `tools/test_lua_test_support.lua`,
    `tools/lua_test_support.lua`
  - **Severity**: Minor and Trivial x2 (tests)

From the RF2.7 skeptic; Tim agreed both on 2026-10-18.

- [✅] RF2.13 A file that can be opened counts as present even when `fs.exists` says no
  - **File**: `backend/lib/JsonStore.lua`, `tools/lua_test_support.lua` (`env.fail.exists`),
    `tools/test_json_store.lua`, `tools/test_backend_config.lua`
  - **Severity**: Minor or Trivial (no confirmed real trigger)
  - **Fix**: every presence check in `JsonStore` uses "`fs.exists`, or it opens". A failed open
    still reads as absent: telling a missing file from an unreadable one would mean matching
    error text, and a mismatch would block saves on a fresh install.
- [✅] RF2.14 Without config, a refusal from an unreadable store file returns `read_only`
  - **File**: `backend/main.lua`, `tools/test_backend_config.lua`
  - **Severity**: Trivial

### Final

Deep review runs per phase (1G.8 and 2F.9), before each phase's commit.

- [✅] Spec Audit
  - **Dependencies**: 2F.10
  - **Steps**: run the spec-auditor agent over both commits
    (`git diff build/regenerate-lockfile feat/config-storage`) against the plan and this spec.
  - **Verification**: every plan acceptance criterion maps to a passing test or a completed Steam
    check; the log changelog entry is confirmed; any
    assumption Tim overrode is reflected in the code.

### Audit Fixes

From the spec audit (PASS with 8 non-blocking issues); Tim agreed on 2026-10-18. Code changes
are amended into the phase 2 commit (5f8c1fe, which became d1ae411), since they only improve it
and nothing is pushed.

- [✅] AF1 Working docs: the plan's uninstall prompt text, its later-session reasoning and its
  Follow-ups (the Steam quit hang); this spec's Decision 2, Ralph Completion and Success Criteria
- [✅] AF2 Committed docs and comments: AGENTS.md 4.4 and the `migrate` comment say a plugin
  reload also counts as a later session (A23); rewrap the overlong `main.lua` comment
- [✅] AF3 US spelling in test code (`licence_page`, `test_licence_*`, "behaviour" and similar)
- [✅] AF4 `DeleteGiverData` for an account with no records writes nothing (red-green)
- [✅] AF5 `TestLogPrivacy` gains a config-mode pass
- [✅] AF6 Steam: the single-save gift key move, with a title-keyed gift planted in `config.json`
  (needs Tim); 1G.4, 1G.6, 2F.5 and the storage-limit message recorded as covered by tests
- [✅] AF7 Amend 5f8c1fe with AF2 to AF5

## Verification

### Success Criteria

- [✅] All tests pass: `npm run test:lua` (every `tools/test_*.lua`, including the converted cache
  merger test) and `npm test`
- [✅] `npm run type-check`, `npm run lint` and `npm run build` pass
- [✅] Stage 1 acceptance criteria met: 1B.2, 1B.3, 1G.4 (killed saves and full disk); 1C.4
  (memory matches disk); 1C.2, 1C.3 (consent, including shutdown); 1B.4, 1G.6 (set-aside); 1C.6,
  1G.5 (Community twice); 1E.3 (legacy key); 1E.4, 1E.5 (UI shows the previous value); 1H.1 to
  1H.5, 1G.7 (no personal data in logs); 1A to 1D (LuaUnit coverage)
- [✅] Stage 2 acceptance criteria met: 2B.4, 2F.4 (upgrade with and without config); 2B.3, 2F.4
  (later-session retirement); 2B.4, 2F.5 (config reset); 2F.7 (uninstall); 2C.2, 2D.3, 2F.6
  (note cap and size message); 2B.4 (partitioning); 2B.3 (migration and fallback tests)
- [✅] No regressions in existing behaviour (1B.1 and 1C.1 characterisation tests still pass)
- [✅] Two commits on `feat/config-storage` above `build/regenerate-lockfile` (c78c754, d1ae411), Tim's identity,
  nothing pushed, no `docs/llm/active/` file committed

### Ralph Completion (for autonomous execution)

When ALL of the following are true, output `<promise>COMPLETE</promise>`:

- All tasks above show `[✅]`
- All tests pass
- No TypeScript or lint errors

If stuck on the same task for 3+ iterations, output `<promise>BLOCKED: [reason]</promise>`. Tasks
marked "needs Tim" or "Tim performs" are
not stuck tasks: stop and ask.

## Progress Notes

_Real-time updates during implementation_

- [2026-10-17 04:03] ✅ Specification created from plan file
- [2026-10-17 08:50] ✅ Specification updated with Tim's answers: decisions resolved, unit 1H
  (logs) added, 1E.4 and 1E.5 added, 1F.1 deletes the stray line, reviews use `/deep-review`;
  open points O1 and O2 recorded
- [2026-10-17 12:05] ✅ Completed: 1.0 Create the phase 1 branch (`fix/safe-saves` from
  `build/regenerate-lockfile` at 8a4f08f; baseline green: Lua test, vitest 24, type-check, lint).
  Execution mode: continuous. Parallel plan: 1E and 1H.2 as agents alongside 1A and 1F.
- [2026-10-17 12:05] 🔄 Started: unit 1E (1E.1 to 1E.5) and 1H.2, each as a parallel agent
- [2026-10-17 12:07] ✅ Completed: 1A.1 LuaUnit v3.5 vendored (both sha256 hashes match), 1A.2
  runner `tools/run_lua_tests.lua` and `test:lua` script, 1A.3 cache merger test on LuaUnit (28
  assertions; a deliberate 100 to 99 change failed with exit 1, then reverted)
- [2026-10-17 12:07] ✅ Completed: 1H.2 `lib/log-redact.ts` and `frontend/utils/log-redact.test.ts`
  (red: module missing; green: 9 tests; suite 38). Note for 1H.5: pass SteamID64s as strings,
  because a 17 digit JavaScript number loses its last digits before `maskId` sees it.
- [2026-10-17 12:07] 🔄 Started: 1A.4 Lua test support module
- [2026-10-17 12:09] ✅ Completed: 1A.4 `tools/lua_test_support.lua` and 10 self-tests (`TestLuaTestSupport`).
  The module was written before its tests, not after as the task says; to compensate, two
  deliberate mutations (close failure not injected, rename count never decrementing) each failed
  exactly one self-test, then were reverted. Suite: 11 Lua tests green, no temp folders left.
- [2026-10-17 12:09] ✅ Completed: 1F.1 `.gitignore` gains the four data-copy patterns and loses the stray
  UTF-16 `tools/` line; all `check-ignore` checks pass, no NUL bytes remain. Deviation: with the
  NUL bytes gone git treats the file as text, and Tim's `core.autocrlf=input` will store it with
  LF endings at commit (54 of 55 text files in the repo are already LF). The byte diff therefore
  shows every line; `git diff --ignore-cr-at-eol` shows exactly the intended change. Mention the
  normalisation in the phase 1 commit message.
- [2026-10-17 12:09] 🔄 Started: 1B, 1C.1 to 1C.5 and 1D as parallel agents; 1H.3 in the main session

- [2026-10-17 12:10] ✅ Completed: unit 1E (1E.1 to 1E.5), each red then green except the characterisation
  and extraction steps; vitest 49, type-check and lint clean. Decisions taken in the unit and
  accepted: `legacyRemoved` is `null` when the upsert fails (no removal attempted; `false` means
  tried and failed); `CONSENT_NOT_SAVED_MESSAGE` added so both consent call sites log the same
  text; `ConsentModal` now treats a returned non-"true" string as a failure (booleans unchanged);
  the "Migrating legacy giver entry" log now fires after a successful upsert, text unchanged until
  1H. `npm run build` left for 1G, because it writes the Dist that the symlinked Steam loads.
- [2026-10-17 12:11] ✅ Completed: 1H.3 `backend/lib/log_redact.lua` and `tools/test_log_redact.lua` (red:
  `require("lib.log_redact")` not found; green: 8 tests). Lua suite 19 green. Waiting on 1B, 1C.1
  to 1C.5 and 1D; 1H.1 waits for them, because it stays red until 1H.5 and would confuse their
  `npm test` runs.
- [2026-10-17 12:13] ✅ Completed: 1D.1 `backend/lib/friends_compare.lua` (`same_friends(a, b)`, strict boolean,
  ignores order and every `updatedAt`, duplicates count, anything odd compares as different) and
  25 tests (red: module missing; always-true and always-false fakes failed 18 and 8 tests). 1C.6
  handed to the 1C agent, which owns `backend/main.lua`.
- [2026-10-17 12:17] ✅ Completed: unit 1B (1B.1 to 1B.5), `TestJsonStore` 24 tests, red then green; full
  Lua suite 102 green. Found while building: renaming an unreadable file aside could replace an
  existing `.corrupted.<time>` copy; 1B.5 now blocks saves instead (A8). New log lines use file
  names only. For 1H.4: `save`'s returned reason can carry the full path (Lua's `io.open` error
  text starts with it), so make reasons path free and include a failed save in `TestLogPrivacy`.
  For Tim at the phase boundary: `load` deletes a leftover `.tmp` even when no store file exists,
  as specified; promoting a valid `.tmp` instead would keep a first ever save killed between
  close and rename (tiny window, plan change).
- [2026-10-17 12:19] ✅ Completed: unit 1C (1C.1 to 1C.6), `TestBackendExisting` 18 and `TestBackendSaves` 17,
  red then green; Lua suite 103 green. Deviations accepted: a 1C.3 assertion now checks no friends
  write for unconsented accounts (1C.5's consent save legitimately writes `{}`); `print` is
  silenced in backend test setUp. For Tim at the phase boundary: with 1C.6 an unchanged friends
  list isn't saved again, so a failed friends save is only retried at the next friends save of any
  kind or next session (friends is rebuildable; proposed: accept and record); granting consent
  with nothing in memory now writes `{}` cache and friends files (harmless).
- [2026-10-17 12:19] ✅ Runner improvement (unit 1A file): a test file that fails to load becomes a failing
  `TestLoadErrors` test instead of aborting the run, so parallel red phases don't block each other.
- [2026-10-17 12:19] 🔄 Started: 1H.1, 1H.4 and 1H.5 in one sequential agent
- [2026-10-17 12:30] ✅ Completed: 1H.1 (`tools/log-privacy.test.mjs`; red: 55 offenders, 22 backend and 33
  frontend, webkit and lib; green 6 of 6; scans all 177 log calls), 1H.4 (`TestLogPrivacy` 4
  tests; red: 108 hits for the full account ID, legacy key, temp folder path and a path in a
  failed save reason; green), 1H.5 (red: the 33 non-backend offenders; green). Suites: Lua 107,
  vitest 55, type-check and lint clean. Four `log-privacy: allow` opt-outs in `backend/main.lua`
  (270, 313, 395, 429), each logging an already masked ID. Questions for Tim at the phase
  boundary: match risky names inside camelCase names too (catches `legacyLicenseKey`; adds two
  opt-outs); opted-out calls aren't checked (inherent); V8 `JSON.parse` errors can quote their
  input in frontend catch logs (input is backend JSON, so unlikely); the draft changelog entry
  doesn't mention file paths.
- [2026-10-17 12:30] 🔄 Started: 1G.2 automated checks (build deferred to 1G.3, because Steam is running from
  this checkout and the build rewrites the Dist it loads)
- [2026-10-17 13:59] ✅ Tim's phase boundary answers (all as recommended), applied red then green:
  - Leftover `.tmp` with no store file is promoted when it parses; `TestJsonStore` gained three
    tests (red: load returned {} instead of the temp file's data). Plan updated.
  - Accepted and commented in `SetFriendsCache`: a failed friends save is retried only at the next
    friends save of any kind, or next session. Plan updated.
  - Log check matches compound names and needs named opt-outs (`allow=<name>`); two new self-tests
    (red: compound name not flagged, named opt-out not recognised). The four existing opt-outs now
    name `licenseData` or `steamUserID`, and two `decodedPayload` lines opt out because cjson errors
    give a position, not the input. A21 and the plan updated; the V8 quoting gap is recorded.
  - Changelog log entry agreed with "and file paths" added; 1G.1 lists all four entries.
  Suites: Lua 110, vitest 56, type-check and lint clean.
- [2026-10-17 13:59] ✅ Completed: 1G.1 four Fixed entries under `## Unreleased` (one line per entry, matching
  the file's existing style). 1G.2 waits only on `npm run build`, deferred to 1G.3 with Steam quit.
- [2026-10-17 14:07] ✅ Completed: 1G.2 (Lua 110, vitest 56, type-check, lint, build, `on_unload` saves
  nothing). 1G.3 in progress: Steam hung on quit again (third time today; Shutdown logged, client
  and Gratitude's Lua host still alive after two minutes). Data backed up to
  `~/gratitude-backup-2026-10-17/` first, then Tim approved `kill -9`. The old build's `on_unload`
  rewrote all five files within a millisecond of the kill; all survived with identical data,
  which is the race phase 1 removes. Build done; starting dev mode.
- [2026-10-17 14:40] ✅ Completed: 1G.4 kill tests, automated with Tim's approval (a watcher kill -9s the target
  as the third licence page save begins). Rounds 1 to 3 killed Steam mid sync (14:38:24, 14:39:08,
  14:39:47); round 4 killed only Gratitude's Lua host (14:40:30; Millennium logged a signal 9
  crash and a crash dump, and did not restart it). Every round: all five files parse, only the
  cache was written (no shutdown save), no leftover `.tmp`; each restart loaded all five stores
  with no decode errors. Round 1 needed the caches cleared and a Store reload (the first sync URL
  left the Store half loaded with no sync). Found, pre-existing and out of scope:
  `load_cache_from_file` drops `totalLicenses`, so every Steam start re-syncs all licence pages.
- [2026-10-17 14:42] Follow-up for after the tests (Tim asked): why the Store page opened by
  `xdg-open steam://openurl/https://store.steampowered.com/?gratitude_sync=1` stayed half loaded
  (`readyState` "interactive", no Gratitude webkit run, no sync) until Tim reloaded it. Startup
  Store loads synced normally. Millennium's `network_hook` "Is a directory" error appears on every
  Store load today, including working ones, so it is probably unrelated.
- [2026-10-17 14:44] ✅ Completed: 1G.5 after the round 4 crash dialog's Restart Plugin (a disable then enable,
  no Steam restart). First Community load stored 34 friends at 14:43:19; a second load at 14:43:39
  logged "Friends list unchanged" and left the file untouched, so avatar URLs are stable between
  loads. 1G.6 and 1G.7 will plant files while the backend runs and reload it by toggling the
  plugin, which avoids another Steam quit (the new `on_unload` saves nothing).
- [2026-10-17 14:46] ✅ Completed: 1G.6, with files planted while the backend ran and the plugin toggled off
  and on in Millennium's settings (a live reload; the new `on_unload` saved nothing). On load:
  the partial givers `.tmp` was removed (givers file present, temp file invalid), the cut-off
  friends file and the empty settings file were set aside as `.corrupted.1792201554` holding their
  original bytes, the seeded givers file was unchanged (checksum), every log line named files
  only, and git ignores the copies. Cleanup (delete the copies, restore from backup) after 1G.7.
- [2026-10-17 14:51] ✅ Completed: 1G.7. First attempt (Total War: WARHAMMER III, legacy record keyed by title):
  the library page detected app ID 345260 from an image (not 1142710, and not in the cache), so the
  badge matched by name, the modal's key equalled the record's key, and the edit saved in place
  with nothing lost; the move path wasn't exercised. Second attempt (Warhammer 40,000: Darktide,
  app ID detected correctly): upsert under `1361210` at 14:51:09.911, then the old title key
  deleted at 14:51:09.925, so the record moved with the new note and the title key is gone. Both
  runs: no backend log line held the gifter name, either note, the title or the full account ID.
  Follow-up, pre-existing and out of scope: app ID detection from image `src` can pick another
  app's image (WARHAMMER III page reported 345260); the badge silently falls back to a name match.
- [2026-10-17 14:53] ✅ Steam test cleanup with the plugin toggled off: deleted both `.corrupted.1792201554`
  copies; restored givers, settings and friends from `~/gratitude-backup-2026-10-17/`
  (byte-identical); kept the newer, complete licence cache. All five files valid, no extra copies.
  Next: 1G.8 `/deep-review` (needs Tim's go-ahead), then 1G.9 commit.
- [2026-10-17 14:54] 🔄 Started: 1G.8 deep review of phase 1 (Tim approved)
- [2026-10-17 15:27] ✅ Completed: 1G.8 deep review: no Blocker, Critical or Major (6 lenses; 13 Minor and 8
  Trivial withheld, 1 Accepted; memory recorded as run 1). Tim approved the Review Fixes section.
- [2026-10-17 15:27] 🔄 Started: Review Fixes wave 1 (RF1 to RF10) as four parallel agents
- [2026-10-17 15:31] ✅ Completed: RF10 friends comparison compares every field except `updatedAt` (red: 4
  failures, extra changed field, one-sided field, run-together names and values, non-string keys;
  green 30 of 30). 1D.1 contract text updated. RF12 recorded in the plan (permissions trade-off,
  lexer kept, three items moved to stage 2, new Follow-ups section). RF7 widened with the agent:
  delete also removes the badge's fallback (title) key when it holds a record, which covers the
  stale duplicate as well as never-moved legacy gifts.
- [2026-10-17 15:32] ✅ Completed: RF1 and RF2 in `JsonStore.lua` (five new tests red, then green; all five
  also fail against a copy of the pre-fix file). A leftover `.tmp` that can't be checked or
  promoted is kept with saves refused; it is removed only beside a store file or once read and
  found invalid, and "Removed" is logged only on success. A read error leaves the file in place
  and refuses saves. `self.tmp_path` is built once. Support module gained `env.fail.read`.
- [2026-10-17 15:35] ✅ Completed: RF3 to RF6 (backend agent; each red then green, guard tests checked
  against mutations): `SetGameLicenseData` uses `has_storage_consent`; both cache saves are refused
  while the consent store is blocked, so a clear can't wipe other accounts; `ClearCache` returns
  its save result; `normalize_giver_payload` no longer creates the account; guard tests for the
  consent save ordering and the not-found licence key. Plus, in the main session, red then green:
  `HasUserConsented` returns `has_storage_consent`, so a non-boolean `allowed` reads as not
  consented in the UI too. Lua 127 green. Open for Tim: on a failed clear, memory currently stays
  cleared (agent's choice); proposed to restore it in both clears.
- [2026-10-17 15:40] ✅ Completed: RF7 to RF9 (frontend agent; each red then green, checked against mutations):
  `deleteGiverAndLegacy` removes legacy keys (the record's own and the badge's title fallback) then
  the current key; `grantConsent` and `declineConsent` with an accurate message on every path;
  `SettingsCache` moved to `frontend/utils/settingsCache.ts` (vitest can't load `settings.ts`,
  whose imports need Steam) and falls back to the last confirmed value, which handles overlapping
  failed updates. Grant Permission now opens the Store sync even if the consent call rejects (A22).
  Main session: `useSettings` resets to the cache's value after a failed update (the same overlap
  bug in the hook's own state; checked by reading, React isn't available to vitest). Contracts
  updated. Vitest 87, Lua 127, type-check and lint clean.
- [2026-10-17 15:42] ✅ Completed: RF11 log check flags variables that hold personal data (red: `friends`,
  `existingGiver`, `accountStore` and `match` not flagged; green). The repo scan then flagged 12
  existing lines, all safe (counts, yes or no, cjson error text, acquisition type), so each got a
  named opt-out. Header notes the check is a list of names. All checks: Lua 127, vitest 88,
  type-check, lint, build. Review Fixes complete except Tim's call on restoring memory after a
  failed clear.
- [2026-10-17 18:08] ✅ Tim chose to restore memory after a failed clear: `ClearCache` and `ClearFriendsCache`
  now undo the clear when the save fails (red: memory reported empty; green). Plan updated. Lua
  128, vitest 88, build. Next: a quick Steam smoke test of the modal, consent and settings wiring
  (Tim asked for it), then 1G.9 commit.
- [2026-10-17 18:11] ✅ Smoke test in Steam after the review fixes (Tim): gift added and deleted (upsert then
  delete logged, givers file empty again), settings toggled on and off (two saves), no full
  account ID or game name in the logs, no stray copies.
- [2026-10-17 18:11] ✅ Completed: 1G.9 phase 1 committed as c78c754 on `fix/safe-saves` (41 files; author and
  committer timmblyth@gmail.com; not pushed; `.gitignore` stored with LF). Phase 1 done; phase 2
  waits for Tim's go-ahead.
- [2026-10-17 18:46] Added Unit 2G (phase 1 review carry-overs: shared test setup, shared undo helper,
  single-save gift key move) so a fresh session's `/execute-plan-spec` picks them up.
- [2026-10-17 18:47] **Resume here (context cleared after phase 1).** Next task: 2.0, create
  `feat/config-storage` from `fix/safe-saves` (c78c754). Agreements carried forward:
  - Execution mode is continuous: pause at the start of phase 2 for Tim's go-ahead, before reviews,
    and for Steam steps marked "needs Tim".
  - Run genuinely independent units as parallel agents that each own their files; the main
    session owns this spec's progress notes. Do contiguous work in one process.
  - Red then green for every behaviour change; frontend logic as pure functions in vitest (no DOM
    libraries); Lua tests with LuaUnit (`npm run test:lua`, runner reports load errors as tests).
  - Review: `git add -N` the new files, then `/deep-review` with `Scope: uncommitted` and base
    `fix/safe-saves`; then one commit (Tim pre-approved), identity checked, no push.
  - Steam testing: back up `~/.config/millennium/config.json` and `backend/gratitude_*.json`
    first; reload the plugin by toggling it in Millennium's settings rather than quitting Steam;
    scripts in `docs/llm/active/steam-test-tools/`; memories `steam-testing-techniques` and
    `gratitude-open-items` hold the details.
  - Unit 2G holds the three phase 1 review carry-overs.
- [2026-10-17 18:52] ✅ Completed: 2.0 `feat/config-storage` from `fix/safe-saves` at c78c754
  (baseline: Lua 128, vitest 88). Tim confirmed continuous mode. Order: main session runs 2A.1,
  2G.1, 2B.1 to 2B.4, 2G.2, 2C.1, 2C.2, 2G.3; one frontend agent runs 2D.1 to 2D.3 in parallel;
  docs (2E) after 2B.4 so they describe the real code.
- [2026-10-17 18:52] 🔄 Started: 2A.1 fake config (main session) and 2D.1 to 2D.3 (frontend agent)
- [2026-10-17 18:54] ✅ Completed: 2A.1 `support.new_fake_config` (red: 7 new self-tests failed on
  the missing function; green; Lua 135). Values are stored as JSON through a separate cjson
  instance with sparse arrays converted to objects, so integer keys come back as strings like
  Millennium's. `restart()` also resets `saving_disabled`, `fail_get_all` and `set_calls`, since
  each describes one session; the existing `millennium.config` switch test now also checks nil.
- [2026-10-17 18:54] 🔄 Started: 2G.1 shared test setup and payload builders
- [2026-10-17 18:56] ✅ Completed: 2G.1 `env.start_backend()` (silences `print`, restored at cleanup)
  and `support.giver`, `giver_payload`, `licence_page`, `friends_payload`, `settings_payload`
  with default arguments; both backend test files use them and keep only overrides. Refactor
  only: `TestBackendExisting` 18 and `TestBackendSaves` 24 unchanged and green; two new
  self-tests; Lua 137. `test_log_privacy.lua` keeps its own setup, since it captures `print`.
- [2026-10-17 18:56] ✅ Completed: 2D.1 to 2D.3 (frontend agent; red: `giverNotes` module missing,
  then `giverSaveErrorMessage is not a function`; vitest 98). Decisions taken in the unit:
  `NOTE_TOO_LONG_MESSAGE` (in `giverNotes.ts`) and `GIVER_SAVE_FAILED_MESSAGE` (in `giverSave.ts`)
  are exported so each text lives once, like `CONSENT_NOT_SAVED_MESSAGE`; the counter copies the
  status message's inline style (status messages now at `GiverModal.tsx:355` and `:418`). Main
  session: the failed-save log line now names the backend's code instead of "returned false".
  For 2F.6: a note saved before the cap can show "2100 / 2000"; saving it shows the A16 message
  until it is shortened.
- [2026-10-17 18:56] 🔄 Started: 2B.1 retire and `.migrated` reads in `JsonStore`
- [2026-10-17 18:58] Tim (away): proceed through phase 2 in continuous mode. Plan: run to 2F.2,
  then stop at 2F.3, the first Steam step that needs him.
- [2026-10-17 18:58] ✅ Completed: 2B.1 `exists`, `retire` and `load_newest_migrated` (red: 9 tests
  failed on the missing methods; green; Lua 146). Timestamps sort as numbers (`.1000` beats
  `.200`); names a match must ignore (`.migrated.abc`, `.corrupted.*`, another store's copies, a
  prefixed name) are tested. `retire` logs its own outcome with file names only. The leftover
  check now shares a `read_json_table` helper with `load_newest_migrated`. Checked in Millennium
  v3.6.1: `fs.rename` errors are `ec.message()` (`src/lua_host/api/filesystem.cc:264-272`),
  system text with no paths, so rename failures need no path stripping.
- [2026-10-17 18:58] 🔄 Started: 2B.2 `config_store` snapshot, accounts and save
- [2026-10-17 19:00] ✅ Completed: 2B.2 `backend/lib/config_store.lua` and `TestConfigStore` 9 tests
  (red: module not found; green; Lua 155). Beyond the listed cases: the size check is tested at
  exactly 262,144 bytes (reaches `set`) and one byte over (refused before `set`); `accounts`
  ignores `givers.` and `givers.111.extra`; `save` logs failures with the account masked, and
  masks the key if Millennium's error text ever contains it (its limit messages don't,
  `src/bindings/plugin_config.cc:51-57`, but an IPC exception's text is unknown). `accountId`
  added to the log privacy scan's list, since the scan matched only `accountID`; a mutation
  logging it raw failed the scan, then was reverted.
- [2026-10-17 19:00] 🔄 Started: 2B.3 migration rule
- [2026-10-17 19:01] ✅ Completed: 2B.3 `config_store.migrate` and `TestConfigMigration` 11 tests:
  the spec's 10 scenarios plus the A11 row (red: `migrate` missing; green; Lua 166). The store's
  load outcome comes from the store itself: no file afterwards means absent or set aside;
  a file still there with saves refused means it couldn't be opened or read (A11), so it is
  neither copied, retired nor used as a reason to fall back. Mutations checked: always retiring
  failed 3 tests; ignoring the A11 case failed 1.
- [2026-10-17 19:01] 🔄 Started: 2B.4 wire config into `main.lua`
- [2026-10-17 19:03] ✅ Completed: 2B.4 `TestBackendConfig` 9 tests (red: 8 failed and 1 errored
  because `main.lua` never touched config; the without-config test passed, as it describes
  today's file behaviour; green; Lua 175, vitest 98). `on_load` loads the two caches, then
  `load_moved_stores` takes one snapshot and migrates givers, consent and settings, recording each
  mode in `storeModes`. `save_consent`, `save_givers` and `save_settings(steamUserID)` replace the
  three whole-file savers through one `save_moved_account` helper. Kept from phase 1 on purpose:
  cache and friends saves are still refused while the consent file couldn't be read, even in
  config mode, because that file may hold consent for an account not yet copied into config.
- [2026-10-17 19:03] 🔄 Started: 2G.2 shared undo helper
- [2026-10-17 19:05] ✅ Completed: 2G.2 `save_account_change(data, steamUserID, change, save)`
  replaces the undo blocks in `SetConsent`, `UpsertGiverData`, `DeleteGiverData`, `SetUiSettings`,
  `ClearCache` and `ClearFriendsCache`; `ensure_account_store` is gone. `change` returns a new
  entry (gift changes work on a shallow copy of the account), because editing the account in place
  would leave nothing to put back. Existing undo tests stayed green unchanged; one new test pins
  the path they didn't, a refused delete in config mode. Mutation (edit the account in place)
  failed that test and two phase 1 delete tests. Lua 176.
- [2026-10-17 19:05] 🔄 Started: 2C.1 note length in characters
- [2026-10-17 19:05] ✅ Completed: 2C.1 `backend/lib/note_limit.lua` and `TestNoteLimit` 6 tests
  (red: module not found; green; Lua 182).
- [2026-10-17 19:07] ✅ Completed: 2C.2 `UpsertGiverData` returns `true` or an A1 code, with the
  comment the task asks for (red: 12 assertions expected a code and got `false`, 5 of them
  existing tests whose expectation changed: two in `TestBackendExisting`, two in
  `TestBackendSaves`, one in `TestLogPrivacy`; green; Lua 189). Assumed: an empty payload or an
  empty Steam ID also returns `"invalid_payload"`, since A1's four codes have no better fit and
  the modal shows the generic message for it. The size-limit fixture first stopped 2,500 bytes
  short of the limit, so it couldn't fail; it now fills the account as far as the limit allows
  and adds one more record of the same shape. Mutations: no `size_limit` mapping failed 2 tests;
  no note cap failed 2.
- [2026-10-17 19:07] 🔄 Started: 2G.3 move a gift to a new key in one backend save
- [2026-10-17 19:09] ✅ Completed: 2G.3. Backend: `UpsertGiverData` reads an optional
  `replacesLicenseKey` from the payload and drops that key in the same account change as the new
  record, so the shared undo restores both (red: the old key survived beside the new one, in
  config and file mode; a guard test for a refused move passed before and after; Lua 192).
  Assumed: a `replacesLicenseKey` that isn't a non-empty string, or equals the new key, is
  ignored rather than rejected. Frontend: `saveGiverThenRemoveLegacy` became a single-call
  `saveGiver` (red: `saveGiver is not a function`; 7 old tests replaced by 4; vitest 95); the
  modal passes the legacy key and no longer calls `remove` on save; `givercache.upsert` accepts
  `replacesLicenseKey`; contract block updated. `deleteGiverAndLegacy` unchanged. Type-check and
  lint clean. Unchanged from phase 1, for Tim: a moved gift gets a new `createdAt`, because the
  backend looks for an existing record only under the new key.
- [2026-10-17 19:09] 🔄 Started: 2E.1 to 2E.3 docs and type stubs
- [2026-10-17 19:11] ✅ Completed: 2E.1 to 2E.3. `types/millennium.lua` declares `millennium.config`
  `get`, `set`, `delete`, `get_all` and `on_change` from Millennium v3.6.1's
  `src/lua_host/api/config.cc` (`loadfile` reports no syntax error). README gains "Where Gratitude
  stores your data" before Acknowledgments, covering the plan's three points, with "gift details"
  as the user-facing name. AGENTS.md: section 2 diagram, 3.3 step 4, 4.2 and section 6 as listed;
  backend/AGENTS.md: primary files, runtime data and copies, responsibilities. No em or en
  dashes. Drafted and taken out again as beyond the listed edits, to offer Tim: an AGENTS.md
  section on saves, migration and consent, and a 3.3 sentence on the note cap and error codes
  (draft kept at the session scratchpad's `agents-4.4-draft.md`).
- [2026-10-17 19:11] 🔄 Started: 2F.1 changelog entries
- [2026-10-17 19:11] ✅ Completed: 2F.1 the plan's three entries, verbatim, at the top of `### Changed`
  under `## Unreleased`; the settings line was still unreleased, so it now ends at "native
  Millennium-style controls.". The file's unbracketed headings were left as they are. Possible
  further entries from a diff audit, for Tim to decide (not added, since the task says the
  three): the storage-limit message in the gift modal; moving a gift from an older key in one
  save, so a failed save can't leave a duplicate; `UpsertGiverData` returning error codes.
- [2026-10-17 19:12] Steam is running from this checkout with the phase 2 `main.lua` on disk;
  `config.json` has no Gratitude keys yet, so the new backend hasn't loaded. As a precaution
  against a plugin reload migrating live data before 2F.3, `config.json` and
  `backend/gratitude_*.json` were copied (all parse) to
  `~/gratitude-backup-2026-10-17-stage2-precaution/`. The live givers file holds `{}`.
- [2026-10-17 19:12] 🔄 2F.2: Lua 192, vitest 95 (11 files), type-check and lint pass, no temp
  folders left. `npm run build` deferred to 2F.3, as in phase 1, because it rewrites the Dist the
  running Steam loads.
- [2026-10-17 19:12] **Paused before 2F.3**, which needs Tim to quit Steam. Every code, test and
  docs task in phase 2 is done.
- [2026-10-18 09:50] Steam hung on quit again (Shutdown logged 09:47:56; client and Lua host still
  alive two minutes later). The Lua host had started before `main.lua` changed, so it ran phase 1
  code, which saves nothing on unload; data and `config.json` matched the precautionary copy.
  Tim approved `kill -9` of the client, which also ended the Lua host. Afterwards no Steam
  process was left and every file was still byte-identical to the copy.
- [2026-10-18 09:50] 🔄 Started: 2F.3 backups and build
- [2026-10-18 09:50] ✅ Completed: 2F.3 with Steam quit: `~/.config/millennium/config.json.before-gratitude-stage2`
  (760 bytes) and `~/gratitude-backup-2026-10-18-stage2/` (all five data files), each
  byte-identical to its original. `npm run build` succeeded (the known ttc 3.3.7 update notice
  only); the Dist holds `replacesLicenseKey` and the note cap message. That completes 2F.2.
  Before 2F.4: the live givers file holds `{}` and settings holds one account.
- [2026-10-18 09:51] 🔄 Started: 2F.4. Planted with Steam quit: a Darktide (1361210) gift record with
  a note, keyed by app ID, and `showFriendPickerSteamUrl: true`; consent file as it was.
  Session 1 (Steam started 09:51:13): "Copied 1 of 1" for givers, consent and settings, no
  errors, account masked in every line. `config.json` on disk holds
  `plugins.gratitude.config.givers.<id>`, `consent.<id>` and `settings.<id>` with the planted
  values (confirms the research's layout); the three files are still in `backend/`, no
  `.migrated` yet.
- [2026-10-18 09:52] Finding for 2F.9: a plugin toggle, or Millennium restarting a crashed plugin,
  reruns `on_load` without reloading `config.json`, so `get_all` returns Millennium's memory and
  the "later session" rule would retire files on a toggle. If that session's config writes never
  reached disk, gift records and settings still come back from `.migrated` (A12), but consent
  doesn't fall back, so the user would be asked again. 2F.4 session 2 therefore uses a real Steam
  restart.
- [2026-10-18 09:57] 2F.4 session 1, checked by Tim: Darktide's badge names the planted gifter, the
  modal shows the note, and the profile field shows (setting on). Steam hung on quit again
  (Shutdown 09:53:18); nothing had been written since session 1's load (`config.json` 09:51:15,
  givers and settings 09:51:06); Tim approved `kill -9` of the client, which also ended the Lua
  host. Session 2 (09:57:10): all three files retired to `.migrated` before any callable ran, no
  copy logged; the cache and friends files untouched.
- [2026-10-18 09:58] ✅ Completed: 2F.4. Session 2, checked by Tim: gift, note and setting still
  show; he edited the note and saved. `config.json` was rewritten at 09:57:52 with the new note
  under `givers.<id>` (same key, so `createdAt` kept); no `gratitude_givers.json` reappeared; the
  backend logged one upsert. None of the 116 Gratitude log lines from both sessions holds the
  gifter, either note, the game title, the full account ID or a home folder path.
- [2026-10-18 09:58] 🔄 Started: 2F.6 ahead of 2F.5, since Steam is running and 2F.5 needs a quit.
- [2026-10-18 10:00] ✅ Completed: 2F.6. Tim pasted 2,100 characters: the counter read
  "2000 / 2000" and hid again below 1,800, and the save succeeded. `config.json` holds a 1,999
  character note: input stopped at 2,000, whose last character was a space, which the modal trims.
- [2026-10-18 10:00] 🔄 Started: 2F.5 config reset (needs a Steam quit)
- [2026-10-18 10:04] Tim's standing approval: for the rest of the Steam tests (2F.5 to 2F.8), a
  Steam that hangs on quit may be `kill -9`ed once a minute has passed since `Shutdown` and the
  data files and `config.json` show no writes since the last action.
- [2026-10-18 10:08] ✅ Completed: 2F.5. Steam hung on quit (Shutdown 10:03:14), killed at 10:04:15
  with nothing written. With Steam gone, a Python script removed `givers.`, `consent.` and
  `settings.` from Gratitude's config (the file still parsed, Millennium's other sections kept).
  Next start: givers and settings loaded from `.migrated` and copied back into config ("Copied 1
  of 1"), consent not; the `.migrated` files kept their sizes and times. Tim saw the consent
  dialog, answered Allow, and saw the gift with the pre-migration note "stage 2 migration note"
  and the profile field. `consent.<id>` reached `config.json` with a new timestamp; no consent
  file was written; the Store sync after Allow saved the licence cache as usual.
- [2026-10-18 10:15] 🔄 2F.7 in progress. Steam exited by itself 43 s after Shutdown (first time
  today). The dev link was replaced with `unlink` and a plain copy (`plugin.json`, `.millennium/`,
  `backend/main.lua`, `backend/lib/`, no data files); `ls -la` showed a directory; checkout and
  `.git` intact. Gratitude loaded from the copy with no data files, reading the three stores from
  config. Tim visited the Store, saw the gift and note, and uninstalled: Millennium asked only
  "uninstall Gratitude?" and **never asked "Do you want to delete saved settings for Gratitude -
  Gifted Games Reminder?"**. Millennium deleted the copy (11 files: 10 plugin files plus the
  licence cache) at 10:12:51; all three keys stayed in `config.json`. The installed
  `libmillennium_x86.so` (v3.6.1) does contain the prompt code; it shows the prompt only when
  `PluginConfig_GetAll` returns keys, and swallows any error silently, so something failed at
  runtime; root cause not pursued (Millennium internals). Consequences: README's uninstall text
  describes a prompt that didn't appear and needs Tim's call; step 7 (answer Yes) can't be done.
  Upstream, found while checking: Millennium issue 931 "Steam Hangs On Exit" (open) matches the
  quit hangs.
- [2026-10-18 10:22] Data point for the Store loading follow-up (14:42 on 2026-10-17), from Tim:
  with Gratitude disabled after the reinstall, the Store loads normally; throughout this testing,
  with Gratitude enabled, it stayed loading and the "Featured and Recommended" carousel never
  appeared. Out of scope here. First lead, unconfirmed: `on_load` hooks the webkit script into
  every Store and Community page with `millennium.add_browser_js("", ...)`, a workaround for a
  Millennium bug (TODO in `on_load`).
- [2026-10-18 10:23] 2F.7 reinstall: Steam killed at 10:20:10 after Shutdown at 10:19:09 (an earlier
  window close had only hidden it to the tray, so no Shutdown and no kill then); folder recopied
  (10 files, a directory) with the three keys still in config. Gratitude came back disabled, as
  for any reinstall; Tim enabled it. Its load found no files and read all three stores from
  config; no consent dialog; Tim saw the gifter and "stage 2 migration note". A Store visit
  synced licences into the new folder's cache (consent from config allowed the saves); no
  Gratitude write to `config.json`. Step 7 (answer Yes) skipped: Millennium never shows that
  prompt here.
- [2026-10-18 10:25] ✅ Completed: 2F.7. Steam killed at 10:24:35 after Shutdown at 10:23:34. The
  folder was checked to be a plain copy (no link, no `.git`), deleted, and the dev link restored
  to this checkout; checkout state unchanged. Plan acceptance "gift notes survive a plugin
  uninstall and reinstall ... on a normal install" met, except that the "No" answer it names was
  never asked: v3.6.1 kept the values without asking.
- [2026-10-18 10:25] Tim decided: after the phase 2 commit, run `/create-plan` to write
  `docs/llm/active/plan-steam-bugs.md` (Store loading fix via DevTools console and network, then a
  sweep for other Gratitude bugs), on its own branch. Recorded in memory `gratitude-open-items`.
- [2026-10-18 10:25] 🔄 Started: 2F.8. Tim chose to restore the pre-test state: `config.json` from
  `config.json.before-gratitude-stage2` (only Gratitude's keys differed), givers, consent and
  settings files from `~/gratitude-backup-2026-10-18-stage2/`, the three test `.migrated` copies
  deleted, the newer licence and friends caches kept.
- [2026-10-18 10:27] ✅ Completed: 2F.8. Restored files matched their backups; config held no
  Gratitude keys. Steam started at 10:27:09 with Gratitude loaded from the dev link, running the
  real first migration: consent and settings copied into config with their files kept; the
  givers file (`{}`, no accounts) retired straight to `.migrated`, as A4 intends. Steam left
  running.
- [2026-10-18 10:28] Tim agreed four changes before the review, all applied: README's uninstall
  text now describes what v3.6.1 did (folder deleted, config kept) and warns that a "delete saved
  settings" prompt, where a Millennium version shows one, deletes gift details too (that part
  is from Millennium's source, not observed); three more changelog entries (storage-limit
  message, `UpsertGiverData` error codes, the duplicate left by a failed legacy-key removal);
  AGENTS.md gains section 4.4 on saves, migration and consent; a moved gift's `createdAt` stays
  as it is, since nothing in the frontend shows it.
- [2026-10-18 10:28] 🔄 Started: 2F.9. `git add -N` on the 7 new files; 25 files in `git diff HEAD`.
- [2026-10-18 10:39] Deep review (run 2 in memory): 6 lenses (correctness, security, data, tests,
  reuse, api; performance skipped). 1 Major survived a skeptic, 10 Minor and 5 Trivial withheld,
  1 Trivial accepted (`createdAt` on a moved gift, Tim's 10:28 decision). Memory reconciled 14
  phase 1 findings to fixed.
  - [data, correctness] Major: a config-mode save while the givers source couldn't be read
    (A11 file, or every `.migrated` copy) creates the account's key, which then hides the file's
    older gifts; the file is retired next session (skeptic: confirmed by reading).
  - Withheld Minor: key prefixes typed twice; test helpers duplicated; Gratitude downgrade after
    migration; a Millennium security question (kept privately); `.migrated` retention not in README;
    stale fallback when `get_all` fails; `fs.list` nil stops `on_load`; account over 256 KB stuck;
    plugin reload untested; refused migration copy untested.
  - Withheld Trivial: duplicated masking helper; "2,000" literal; untyped error codes; fake
    config fidelity; modal save wiring untested.
  - Known toggle issue assessed by data, correctness and tests: limited to consent, only when
    Millennium's own disk write failed in that run; suggested recording it as an assumption.
- [2026-10-18 10:45] Tim agreed every recommendation: Review Fixes (phase 2) RF2.1 to RF2.6
  written; the over-256 KB account and a security question went to the plan's Follow-ups.
- [2026-10-18 11:06] ✅ Completed: RF2.1 and RF2.2 together, since they share one mechanism.
  `load_newest_migrated` returns a second value, true when a newer copy exists but couldn't be
  opened or read (bad JSON doesn't count). `migrate` returns a third value, the accounts that may
  be saved this session: nil normally; the accounts keyed at startup when the store's source was
  unread (`save_blocked_reason` set, or `.migrated` copies unread); empty when config exists but
  `get_all` failed. `save_moved_account` refuses anyone outside it with `"save_failed"` and a
  masked log line. Red: 8 assertions (codes, editable sets, the second value) failed for the
  right reason; green; Lua 202. Mutation: removing the guard failed 3 backend tests. A11, A15
  and the contracts updated.
- [2026-10-18 11:06] ✅ Completed: RF2.3. `env.fail.list` added to the fs stub (Millennium's
  `Lua_ListDirectory` returns nil and the error). Red: `ipairs(nil)` raised in
  `load_newest_migrated` and the backend failed to start; green: a failed listing is logged and
  returns `nil, true`, so the plugin loads and unkeyed accounts can't be saved that session.
  Lua 205.
- [2026-10-18 11:07] ✅ Completed: RF2.4. README gains "Moving from the old files": the copies
  keep gift details as they were and Gratitude never deletes them (delete by hand, or uninstall);
  earlier Gratitude versions read only the old files, so rename the copies back first, and
  changes made there, consent included, don't carry over. No em or en dashes.
- [2026-10-18 11:08] ✅ Completed: RF2.5. Characterisation tests (they describe today's behaviour,
  so they passed when written; each mutation-checked): a copy config refuses keeps the account in
  memory and the file, two sessions running, and logs "Copied 0 of 1" (moving the assignment
  inside the success branch failed it); a plugin reload retires the file and a Steam restart
  recovers gift records from `.migrated`; the backend version shows consent is asked again while
  gifts and settings return. A23 added; the fake's `restart()` comment now says it means a Steam
  restart. Lua 208.
- [2026-10-18 11:10] ✅ Completed: RF2.6.
  - `config_store.GIVERS`, `CONSENT` and `SETTINGS` replace every prefix literal in `main.lua`; a
    test pins their values, so a rename fails the suite.
  - `log_redact.replace_literal` (every occurrence, plain text; red first) now backs JsonStore's
    `without_path` and `config_store.save`'s key masking.
  - The fake config checks key length, key limit, then size, as Millennium does (red first), and
    its comment names what it doesn't model (small sparse integer keys, nulls).
  - `support.sorted_keys` and `env.snapshot_files` replace four local copies; `test_config_store.lua`
    shares one setUp and tearDown; `RECORD_220`, `LEGACY_RECORD` and `GIFT_400` come from
    `support.giver`. Refactor only: counts unchanged.
  - Frontend: `NOTE_TOO_LONG_MESSAGE` is built from `NOTE_MAX_LENGTH`; `UpsertGiverErrorCode` and
    `UpsertGiverResult` live in `giverSave.ts` and type the callable and `upsert`; an exhaustive
    `Record` maps codes to messages, guarded against prototype keys (test adds `'toString'`); the
    one-call test notes that the count is fixed by `saveGiver`'s signature.
  Checks: Lua 211, vitest 95, type-check and lint clean. `npm run build` waits for Steam to quit.
- [2026-10-18 11:14] Tim agreed to a Steam smoke test and a second `/deep-review` after the fixes;
  the second review's lenses are running. Steam hung on quit (Shutdown 11:11:16) and was killed at
  11:12:17 with nothing written. `npm run build` succeeded; the working tree still matched the
  review baseline. Start at 11:13:11 on the new build: the real migration's second session
  retired the consent and settings files (config already held both from 10:27); givers loaded
  from their empty `.migrated` copy; no "couldn't be read" warning. Tim toggled the profile
  setting on and off (two saves), added and deleted a Darktide gift (one upsert, one delete);
  `config.json` ends with `givers.<id> = {}` (A13), the setting off and consent unchanged; no
  store file reappeared. None of the 76 Gratitude log lines holds the full account ID, a home
  path or the game title. Also from Tim: look at the Steam quit hang in the Steam bugs plan
  (memory `gratitude-open-items` updated).
- [2026-10-18 11:20] Second deep review (run 3 in memory), same six lenses: no Blocker, Critical
  or Major, so no skeptic stage; 10 Minor and 5 Trivial withheld; run 2's 14 findings reconciled
  to fixed. Lenses confirmed the RF2 tests catch their bugs and the fake config matches
  Millennium where tests rely on it. The run 2 Major's class is not fully closed: the
  migration's own copy from an older `.migrated` (or beside a leftover `.tmp`), the no-config
  fallback, and the consent-dependent cache guard can still act on an unread source (Minor each:
  rare combinations). Other Minors: generic message for a session-long refusal; README's claim
  about removing Millennium (wrong on Arch and NixOS); unchecked account IDs as config keys;
  `get_all` error text logged unfiltered; test helpers still duplicated; duplicated parse path;
  `givercache.upsert` untested. Trivials: delete message literal; stale A2 rationale; README on
  timestamped copies; check-order test; `env.list` fault injection.
- [2026-10-18 11:23] Tim agreed every recommendation and the RF2.8 wording; RF2.7 to RF2.12 written.
  Done first so the new tests could use them: shared `env.find_log`, `count_logs`, `writes_since`
  and `read_json` replace the per-file copies (RF2.11, refactor only, Lua 211 unchanged);
  `env.list` lists without fault injection; the check-order test now sends an oversized value
  with the long key (mutation: size first now fails it) (RF2.12).
- [2026-10-18 11:23] ✅ Completed: RF2.7. `copy_missing` takes a `persist` flag: while the store's
  source is unread, fallback accounts are shown but not copied into config (logged as "Showing N
  ... without copying"). The no-config fallback keeps `load_newest_migrated`'s unread flag and
  returns an empty editable set. `save_consented_accounts` also refuses while the consent store
  is limited (`storeEditable[CONSENT]` set). Red: 4 tests (older copy copied; leftover `.tmp`
  case; no-config read-only; caches cleared while config unreadable) failed as the reviewers
  predicted; green; Lua 215. Mutations: always copying failed 2 tests; dropping the consent
  guard failed 1.
- [2026-10-18 11:24] ✅ Completed: RF2.8. `save_moved_account` refuses with `"read_only"`, which
  `UpsertGiverData` passes through; the boolean callables still return `false`. Frontend:
  `read_only` joins `UpsertGiverErrorCode` and maps to Tim's message. Red: the four refusal tests
  (now expecting `"read_only"`) and the vitest message test failed; green; Lua 215, vitest 96,
  type-check clean. A1 updated.
- [2026-10-18 11:25] ✅ Completed: RF2.9. `config_store.save` refuses an account ID that isn't 1 to
  10 digits (a 32-bit Steam account ID) with `"save_failed"` and a masked log line, so no key can
  be written that `accounts()` wouldn't read back. A failed `get_all` with config present logs a
  fixed "couldn't be read ... read-only" line, never Millennium's error text. Red: both tests
  failed (`"1.2"` saved; the injected note text reached the log); green; Lua 217.
- [2026-10-18 11:25] ✅ Completed: RF2.10. README: removing Millennium as its uninstall guide
  describes removes Gratitude's data, but on some Linux systems the guide has the config folder
  deleted by hand and gift details stay in it until then (linked); and, for going back to an
  earlier Gratitude, use the highest-numbered `.migrated.<time>` copy. No em or en dashes.
- [2026-10-18 11:28] Tim asked whether spec IDs (RF2.7, 2G.3, A13) belong in code comments; agreed
  they don't: a later reader can't look them up, they record history rather than behaviour, and
  they collide (phase 1 "RF2" and phase 2 "RF2.1"). Folded into RF2.11; memory
  `no-spec-ids-in-code-comments` saved; AGENTS.md section 5 records the convention.
- [2026-10-18 11:28] ✅ Completed: RF2.11. `read_json_table` is now the one definition of a usable
  store file and reports why one isn't ("empty", "invalid JSON", "not a JSON object or array", or
  an open or read failure); `JsonStore:load` calls it and keeps its own log lines, block reasons
  and set-aside reasons (every existing JsonStore test passes unchanged); `load_newest_migrated`
  logs the real reason. `GIVER_DELETE_FAILED_MESSAGE` replaces the delete path's two literals.
  The `UpsertGiverData` comment and A2 give the real reason the other callables stay boolean. All
  44 comments citing spec IDs, plus the bare scenario numbers in the migration tests, now say the
  behaviour in words (16 of them were committed in phase 1). Lua 217, vitest 96, type-check and
  lint clean.
- [2026-10-18 11:29] ✅ Completed: RF2.12. New `frontend/injection/givercache.test.ts` mocks
  `@steambrew/client`'s `callable` and pins that `upsert` sends `replacesLicenseKey` inside the
  payload and returns the backend's code unchanged; it describes existing behaviour, so it was
  proved by mutation instead of a red run (dropping the field failed one test; returning
  `isTruthy(success)` failed the other). The check-order and `env.list` parts were done first
  (11:23). Lua 217, vitest 98 (12 files), type-check and lint clean.
- [2026-10-18 11:29] 🔄 Started: one skeptic on the RF2.7 rule, as agreed instead of a third review.
- [2026-10-18 11:45] Skeptic verdict: the rule holds, by enumeration. 2,520 combinations (config
  absent, failing, empty or keyed x store file states x leftover `.tmp` states x `.migrated`
  states, for each of givers, settings and consent), each over two sessions with the real
  backend and callables: 0 keys or files written that later hid data, 0 cache writes while
  consent was unread, 0 refusals in all-read sessions, nothing carried into the next session;
  working tree unchanged. Two things outside the rule's wording:
  - A failed existence check reads as "file absent": Millennium's `fs.exists` returns false on
    any stat error (`filesystem.cc:37-43`), so a file that stat can't see but `open` can read
    would be skipped and an older `.migrated` copied over it. No confirmed real trigger (a
    32-bit stat overflow on a large inode is the only candidate). Minor or Trivial.
  - Without config, a store file that couldn't be read refuses gift saves with `save_failed`,
    not `read_only`, because the refusal comes from `JsonStore`. Trivial; data is safe.
- [2026-10-18 17:50] ✅ Completed: RF2.13 and RF2.14 (Tim agreed both). `JsonStore`'s eight
  presence checks go through `is_present`: `fs.exists`, or the file opens. `env.fail.exists`
  added to the fs stub. `save_moved_account` refuses a file-mode save with `"read_only"` when the
  store file couldn't be read. Red: 3 tests (a file stat can't see loaded as `{}`; an older
  `.migrated` copy was migrated ahead of the store file, the skeptic's scenario; `save_failed`
  instead of `read_only`); green. Lua 220, vitest 98 (12 files), type-check and lint clean, no
  temp folders left. Next: rebuild and a Steam smoke test (needs Steam quit), then the commit.
- [2026-10-18 19:36] ✅ Completed: 2F.9. Steam (the 11:13 run, still on the earlier build) hung
  after Shutdown at 19:25:26 and was killed at 19:26:27 with nothing written since 11:14. Final
  build succeeded; start at 19:26:38 loaded in the steady state (stores from config, `.migrated`
  copies only read, no "couldn't be read" warning). Tim's smoke test: two settings saves, a gift
  upsert and delete (a title-keyed game, logged as "non-numeric key"), `givers.<id>` back to `{}`,
  no store file recreated; none of 76 log lines holds the full account ID or a home path. No open
  Blocker, Critical or Major finding: run 2's Major fixed (RF2.1, then the class closed in RF2.7
  and RF2.13, confirmed by a 2,520-combination skeptic enumeration); run 3 found none.
- [2026-10-18 19:36] 🔄 Started: 2F.10. Commit message and one more changelog entry shown to Tim.
- [2026-10-18 19:37] ✅ Completed: 2F.10. Tim approved a Changed entry for the read-only sessions
  and the message. Phase 2 committed as 5f8c1fe on `feat/config-storage` (28 files staged by
  path; author and committer timmblyth@gmail.com; only `docs/` untracked; no remote, nothing
  pushed).
- [2026-10-18 19:37] 🔄 Started: Spec Audit (spec-auditor over `build/regenerate-lockfile..feat/config-storage`).
- [2026-10-18 19:46] ✅ Completed: Spec Audit (PASS - 17 plan acceptance criteria and the Final
  task's 3 checks verified; reran Lua 220, vitest 98, type-check, lint; its own config-mode log
  privacy run over migration, a key move, the note cap and refusals found 0 leaks). 8
  non-blocking issues, for Tim:
  1. Plan text out of date: the uninstall prompt (2F.7 found v3.6.1 doesn't ask); the "fresh
     load of config.json" reasoning, also in committed AGENTS.md 4.4 and the `migrate` comment,
     which A23 qualifies for plugin reloads; the Steam quit hang missing from Follow-ups.
  2. This spec is stale in Decision 2 (log entry still "draft"), Ralph Completion and the
     unticked Success Criteria.
  3. Steam checks not repeated after review fixes changed their code: 1G.4 and 1G.6 (RF1, RF2),
     1G.7 (the single-save key move has never run in Steam), 2F.5 (RF2.7); smoke tests ran
     instead; all covered by automated tests.
  4. The storage-limit message was never seen in Steam (needs 256 KB of notes).
  5. Trivial: `backend/main.lua:485` comment line is 181 characters.
  6. Trivial: UK spellings in test code (`licence_page`, `test_licence_*`, "behaviour").
  7. Trivial: a config-mode delete for an account with no records writes `givers.<id> = {}`.
  8. `TestLogPrivacy` runs in file mode only.
- [2026-10-18 19:51] ✅ Completed: AF1 to AF5 (Tim agreed all three groups).
  - AF1: the plan's uninstall passages describe what v3.6.1 did; its later-session paragraph
    notes that a plugin reload also counts (accepted); Follow-ups gain the Steam quit hang. This
    spec's Decision 2 lists the four agreed entries; Ralph Completion no longer mentions a
    draft. Success Criteria are ticked after the last checks.
  - AF2: AGENTS.md 4.4 and the `migrate` comment give the Steam-start reason and say a plugin
    reload also counts, with what happens if its writes were lost; the `UpsertGiverData` comment
    rewrapped.
  - AF3: test code uses US spelling (`license_page`, `test_license_*`, "behavior",
    "Characterization", "normalization"), 42 occurrences across 8 files; "cancelled" in
    `frontend/index.tsx` is older code this branch doesn't touch, so left.
  - AF4: `DeleteGiverData` returns true without saving when the account has no records (red: a
    config key in config mode and a file write in file mode; green).
  - AF5: `TestLogPrivacy` drives config mode through migration, a title-key move, the note cap,
    a refused config save, a locked file and an unreadable config quoting a note; 0 private
    values logged. Mutations (unmasked key; raw `get_all` error text) each failed it.
  Lua 223, vitest 98, type-check and lint clean, no temp folders left.
- [2026-10-18 19:51] 🔄 Started: AF6, the Steam key move check (needs Steam quit to plant the gift).
- [2026-10-18 19:53] AF6 interrupted. Steam hung after Shutdown at 19:51:28; at 19:51:58 the
  amdgpu driver logged a page fault and a gfx ring timeout in `gnome-shell`, the ring reset
  failed, and the GNOME session died (Steam with it, about 19:52:20); Tim logged back in at
  19:52:27. The machine did not reboot. Cause not established; noted for the Steam bugs plan.
  With Steam gone, `config.json` was backed up to the session scratchpad
  (`config.json.before-key-move`) and a title-keyed Darktide gift ("Move Tester") planted; it
  parses with consent and settings unchanged. A relaunch from this shell failed ("Unable to open
  X11 display": the old session's display settings), so Gratitude never loaded. Waiting on Tim
  to start Steam in the new session, or to stop and restore from the backup.
- [2026-10-18 19:55] ✅ Completed: AF6. Tim asked me to launch Steam; it started in the new session
  with its new X authority file (19:53:57). Gratitude loaded the planted title-keyed gift from
  config. Tim saw "Move Tester", changed the note and saved: one upsert under `1361210`, "Moved
  giver record from license non-numeric key", one `config.json` write; the gift now sits only
  under `1361210` with the new note, the title key gone, `createdAt` new (as decided). Tim then
  deleted it: gift records back to `{}`, consent and settings unchanged. None of the 65 log lines
  holds the account ID, gifter, note, title or a home path. 1G.4, 1G.6, 2F.5 and the
  storage-limit message are recorded as covered by automated tests, as agreed.
- [2026-10-18 19:55] ✅ Completed: AF7. AF2 to AF5 amended into the phase 2 commit, now d1ae411
  (one bullet added for the empty-delete guard); identity timmblyth@gmail.com; only `docs/`
  untracked; nothing pushed. Success Criteria ticked. Every task in this spec is complete.
---

**Status Indicators:**

- `[ ]` - Not started
- `[🔄]` - In progress
- `[✅]` - Completed
- `[❌]` - Failed/blocked
