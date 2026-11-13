# Plan: safe and durable storage for Gratitude user data

**Status**: complete: phase 1 committed as c78c754, phase 2 as d1ae411 (2026-10-18)  
**Date**: 2026-10-17  
**Tracking**: local only, no GitHub issue

## What this is

Gratitude is a plugin for Millennium, a framework that adds plugins to the Steam desktop client. It
marks games in your Steam library that were gifted to you, and lets you record who gave each gift
plus a personal note. This plan covers how Gratitude saves its data, so that a crash, a failed
write or an uninstall can't silently lose it.

The gift notes matter most. The user types them in by hand, so unlike the rest of Gratitude's data
they can't be rebuilt from Steam. The licence cache and friends cache are caches: if they are lost,
Gratitude syncs them again.

## Proposal

One plan in two stages. Stage 1 ships first, and stage 2 ships well before any move to Millennium's
newer `.star` plugin format.

1. **Make saves safe.** A save either completes or leaves the previous file untouched, failures are
   detected and reported, and nothing reaches disk for an account that hasn't consented.
2. **Move hand entered data into millennium.config.** Millennium's plugin config store,
   millennium.config, is its documented way for a plugin to keep user data. Gift records, consent
   and settings move there, written by Gratitude's Lua backend only, so gift notes survive
   reinstalling the plugin. The two caches stay as files.

## Deliverables

- Killing Steam, or a full disk, during a save never leaves a Gratitude store empty, cut short or
  unreadable, and a failed save is reported rather than logged as a success.
- Licence and friends data reaches disk only for accounts that have consented.
- Loading a Steam Community page no longer rewrites the friends cache when the friend list is the
  same.
- On Millennium 3.0.0 and later, gift records, consent and settings live in millennium.config and
  survive an uninstall: Millennium v3.6.1 kept them without asking.
- Existing users' data moves across automatically, and the old files are kept as `*.migrated`
  rather than deleted.
- The README explains where Gratitude stores data and what happens on uninstall.

## Key decisions

**Gift records move into millennium.config; the caches stay as files.** The licence cache and
friends cache can be thrown away and rebuilt by syncing. Gift notes are genuine user data we cannot
reconstruct, so they get the store that survives a reinstall. Reinstalling a plugin is the usual
troubleshooting advice, and today it silently deletes every note. millennium.config also keeps
working unchanged in the `.star` format, where the plugin folder no longer exists.

We accept that a file would be better on several counts: a failure would stay inside Gratitude,
disk-write failures would be reported, there would be no size limit, and the data would sit in a
visible file of its own. Those trade-offs are listed under **Accepted trade-offs** in stage 2.

**Stage 2 ships well before any move to `.star`.** There is currently no update path that takes a
folder-based plugin to a `.star` one, and a transition that involves uninstalling would delete any
data still in the plugin folder. Migrating while Gratitude can still read its own folder directly
is the easy moment. Users need to launch a stage 2 version at least twice before the switch (see
the migration rule). A future `.star` version may still need a best-effort read of the old plugin
folder for users who skip straight to it.

**Use what exists before writing our own.** See **Built-ins and libraries**. Millennium already
provides a cross-platform atomic rename and a JSON library, and millennium.config itself provides
most of stage 2.

## Background

### Where the data lives today

Gratitude has three parts: a Lua backend that owns storage, a frontend inside Steam's library UI,
and a "webkit" script that scrapes Steam Store and Community pages. The backend runs on LuaJIT, so
it has Lua 5.1 semantics. The frontend and the webkit script reach stored data only by calling the
backend.

The backend keeps five stores. Each is saved as a JSON file inside the plugin's own folder. Every
store is partitioned by Steam account ID, so several Steam users on one machine stay separate.

| Store | What it holds | Rebuildable? |
| --- | --- | --- |
| Licence cache | Licences scraped from Steam's account licences page | Yes, by syncing again |
| Consent | Whether the user agreed to Gratitude storing their data | No, but the user can be asked again |
| Givers | Who gave each gift: display name, optional profile link, free text notes | No, typed in by hand |
| Friends cache | Friend list scraped from Steam Community, used for autocomplete | Yes |
| Settings | Per-account UI preferences | No, but tiny |

Every change saves that store's whole file straight away. When the plugin unloads, the backend
saves all five files again.

### Problems

Verified by reading the source on 2026-10-17.

1. **Saves are not crash safe.** A save truncates the file, then writes the new contents in place.
   If the process dies part way through, the file is left empty or cut short. A file that fails to
   parse loads as an empty store, and the next save writes that empty store over it, so the loss
   becomes permanent.
2. **Failed writes go unnoticed.** Lua reports write and close errors by return value, not by
   raising an error. The save code only catches raised errors and ignores the close result, so on a
   full disk a save cuts the file short and still logs success.
3. **A failed save isn't undone in memory.** The backend changes its in-memory copy before saving.
   If the save fails, the gift modal shows "Unable to save giver data.", but the unsaved edit still
   appears on the next reload.
4. **The shutdown save runs at the worst moment.** It also runs when Steam crashes, because the Lua
   host calls it when its connection to Steam drops, while the process is already being killed. On
   Tim's machine Steam hangs on quit and has needed `kill -9` twice, and on 2026-10-17 all five
   files were rewritten in the same second Steam was killed.
5. **Data reaches disk without consent.** The consent dialog says Gratitude "needs to store your
   Steam license history (acquisition dates and sources) and friends list locally". In practice:
   - Licences scraped for an account without consent stay in memory, and any other licence cache
     save, including the shutdown save, writes every account in memory.
   - The friends cache has no consent check at all and is saved on every Community page load.
6. **The gift modal deletes before it saves.** When a gift stored under an older licence key format
   is edited, the modal removes the old record first and saves the new one second. If the save
   fails, or Steam dies between the two calls, the note is lost.
7. **Uninstalling deletes the gift notes.** Uninstalling removes the plugin folder, and the data
   files go with it. Plugin updates are safe: Millennium copies new files over the folder and never
   deletes, and the data files are never in the update package.
8. **The friends cache is rewritten on every Community page load,** because its "updated at"
   timestamp changes each time, even when the friend list hasn't.

### millennium.config

millennium.config arrived in Millennium v3.0.0 (2026-05-30). Its Lua side has worked since then;
its frontend side was broken until v3.5.0. These facts come from the Millennium v3.6.1 source and
[docs.steambrew.app](https://docs.steambrew.app/).

- **Storage.** Values live in Millennium's own settings file, `config.json` (Linux
  `~/.config/millennium/config.json`, Windows `<Steam>\millennium\config\config.json`), under the
  plugin's name. Every write rewrites the whole file atomically (a temporary file, then a rename),
  even when the value hasn't changed. There is no fsync.
- **Limits.** 256 KB per value (measured as compact JSON) and 256 keys, both counted per plugin and
  never shared between plugins. Keys can be up to 512 bytes.
- **Error reporting.** A write that breaks a limit is refused and returns an error, leaving the old
  value. A write that fails on disk is only logged by Millennium: Gratitude is told it succeeded.
  Reading a value back checks Millennium's memory, not the disk.
- **Lifecycle.** Values survive plugin updates and Millennium updates. Uninstalling through
  Millennium's settings deletes the plugin folder and keeps the values. Millennium's source also
  has a "Do you want to delete saved settings for Gratitude - Gifted Games Reminder?" prompt
  that deletes them on yes, but in testing on v3.6.1 (2026-10-18) it never appeared. Deleting the
  plugin folder by hand never asks. Removing Millennium as its uninstall guide describes removes
  everything; on some Linux systems that means deleting its config folder by hand.
- **Exposure.** Nothing in Millennium sends `config.json` off the machine: no telemetry, export or
  cloud sync, and its bug template asks for logs, not config. On the same machine, any plugin's
  frontend can read any plugin's config by name, the whole config is sent to Steam's UI at startup,
  and every Lua write passes the value into Steam's frontend. Files in the plugin folder are no
  better protected, since any plugin's backend has full filesystem access.
- **What other plugins keep there.** Of 14 plugins found using it, most store settings. Two store
  API keys, one an Epic account refresh token, one the user's purchase prices. The only one storing
  data about other people is Family-Library, which keeps family members' Steam account IDs.
  Gratitude would be the only plugin storing names of, and notes about, other people.

## Stage 1: make saves safe

All stage 1 items are decided.

### Atomic, checked saves

After any save, each store's file holds either the complete old contents or the complete new
contents. A save writes a temporary file in the same folder as the store file, checks that both
the write and the close succeeded, and only then renames it over the store file with Millennium's
`fs.rename`. If either check fails, the temporary file is deleted and the save reports failure.
This holds on Windows, Linux and macOS (see **Built-ins and libraries**).

When a store loads and finds a leftover temporary file, the rename never happened:

- If the store file exists, it is the last completed save, and the temporary file is deleted.
- If there is no store file and the temporary file parses, it is the only copy of a first save
  killed between close and rename, so it is renamed into place. A partly written one won't parse,
  and is deleted.
- If it can't be renamed into place, or can't be read to check, it is left on disk and saves to
  that store are refused for the session, so the only copy is never deleted or overwritten.

This applies to every store saved as a file: all five in stage 1, and after stage 2 the licence
cache, the friends cache, and any store using the file fallback.

Accepted trade-off: replacing the file means a save creates it fresh, so permissions a user had
tightened on a data file (for example `chmod 600`) go back to the default. Millennium's `fs` has no
way to read or set permissions, and default exposure is the same as before.

### Failed saves are undone in memory

When a save of gift records, consent or settings fails, the backend restores the previous
in-memory value, so the UI never shows an edit that isn't on disk. Each change replaces a record or
a few fields, so undoing it means restoring the previous value, without copying whole stores.

The licence and friends caches keep their in-memory data when a save fails. They are rebuildable,
and the next sync that changes them saves them again. Clearing a cache is the exception: a clear
that fails to save is undone in memory, so the backend agrees with the disk and with the frontend,
which keeps its own copy when a clear fails. Because unchanged friends lists aren't saved
(see **Skip unchanged friends saves**), a failed friends save is retried only at the next friends
save of any kind, or next session. That is accepted, because the friends cache can be rebuilt.

`SetConsent` returns its save result, like the other backend calls, instead of always reporting
success. The UI follows the same rule:

- If saving consent fails, the failure is logged and the consent dialog appears again next
  session. Nothing new is shown in the UI.
- The settings panel's "Grant Permission" button shows the result it actually got back, rather
  than always showing consent as granted.
- The frontend's settings cache restores the previous value when a settings save returns failure,
  not only when the call throws.

### No shutdown save

The backend no longer saves all five stores when the plugin unloads. Every change is already saved
when it happens, failed saves are undone in memory, and the shutdown save runs when Steam is most
likely being killed. Removing it also stops licence data for accounts without consent reaching disk
at shutdown.

### Only consented accounts reach disk

Licence and friends data stays in memory for the session whether or not the account has consented,
so Gratitude keeps working. Every save of those two stores writes only accounts that have consented.
If a user consents later in the session, the next save persists what is in memory. The webkit
script keeps scraping as it does today.

Accounts with no consent record count as not consented. This covers users from before the consent
dialog existed (v0.1.0 to v0.1.5) and the old global consent format; they already see the consent
dialog today. For them the worst case is that their caches drop off disk until they answer it, and
then sync again.

If the consent file itself couldn't be read at load, consent is unknown rather than absent, so
licence and friends saves are refused for that session instead of being filtered to nobody. That
stops a Clear cache in that session wiping other accounts' caches.

### Unreadable files are set aside

If a store file exists but can't be parsed, or is empty, it is renamed to
`<name>.corrupted.<unix time>`, the problem is logged, and that store starts empty. Nothing is shown
in the UI. Millennium handles its own `config.json` the same way.

A file that can't be opened or read, as opposed to one that reads but doesn't parse, may be healthy
and only locked for a moment (antivirus software on Windows). It is left in place and saves to that
store are refused for the session.

### Skip unchanged friends saves

The friends cache is only saved when the friend list differs from what is stored. The comparison
ignores every `updatedAt` timestamp and the order of the list, and treats any other change as a
change, including a new avatar or a renamed friend. It is a small helper of our own with a LuaUnit
test.

The stored "updated at" then means when the list last changed, rather than when it was last
synced. Nothing in the UI shows that timestamp.

### The gift modal saves before it deletes

When a gift is moved from an older licence key, the modal saves the record under the new key first
and removes the old key only if that save succeeded. If the removal fails, a stale duplicate stays
under the old key. The badge falls back to the old key when the new one has no record, so deleting
a gift removes both keys; that also fixes gifts that were never moved off a title key, which
couldn't be deleted before. Moving a gift in one backend save is part of stage 2.

### Data copies are ignored by git

The temporary, `.corrupted.*` and `.migrated` copies of the data files are added to `.gitignore`,
so gift notes can't be committed from a development install. The broken last line of `.gitignore`
(`tools/` saved as UTF-16, which matches nothing) is deleted rather than repaired, because a
working `tools/` rule would ignore new test files.

### Logs don't contain personal data

Gratitude's logs are what users share when they ask for help, so they never contain gifter names,
notes, profile links, friend names, or licence and game names. Steam account IDs and SteamID64s are
masked to their last four digits, which still tells accounts apart. Numeric app IDs, counts and
error messages are logged as they are, and payloads never are. File paths are logged as file names
only, because a full path contains the user's home folder name.

A static check run by `npm test` flags any log call that passes a risky identifier, including
compound names such as `legacyLicenseKey` and variables that hold personal data (`friends`,
`existingGiver`, `accountStore` and similar), unless it goes through a masking helper. It is a
list of names, so a new variable that holds personal data needs adding to it. Its TypeScript side
uses a small hand-written tokenizer with its own tests; switching to `@typescript-eslint/parser`
was considered and left as a possible later refactor, because the current one works. A call that is
genuinely safe names the identifiers it allows in a `log-privacy: allow=<name>` comment, so
anything else added to it later is still flagged. One gap is accepted: an error object logged from
a frontend catch block can quote the text it failed to parse (V8's `JSON.parse` errors do). That
text is the backend's own JSON, so a parse failure is unlikely, and error messages are kept for
debugging.

### Changelog

Entries under Fixed, all agreed.

- Fixed license and friends data being saved to disk before storage consent was given.
- Fixed data files being left empty or cut short if Steam closes, is killed or runs out of disk
  space during a save.
- Fixed unreadable data files being overwritten instead of kept aside as `.corrupted` copies.
- Fixed logs including gifter names, license names, full Steam account IDs and file paths.

## Stage 2: move hand entered data into millennium.config

All stage 2 items are decided. Three came from the stage 1 review and land here because stage 2
changes the same code:

- Moving a gift to a new key in one backend save, instead of a save then a delete.
- One shared helper for undoing a failed save, used by every save path.
- Shared Lua test setup and payload builders in `tools/lua_test_support.lua`.

### What moves and what stays

Gift records, consent and settings move into millennium.config. The licence cache and friends
cache stay as files: they don't fit well (the licence cache passes 256 KB at roughly 1,900 to 2,600
licences), and they are rebuildable.

Only the Lua backend reads and writes millennium.config. The frontend and the webkit script keep
calling the backend exactly as they do today, so no frontend toolchain upgrade is needed.

### Key layout

One key per account for each store: `givers.<accountId>`, `consent.<accountId>` and
`settings.<accountId>`. Each account gets its own 256 KB for gift records, and one naming rule
serves all three stores. Millennium treats a dotted key as a single name. Three keys per account
under the 256 key limit allows about 85 accounts on one Steam install.

### Fallback to files

When millennium.config isn't available (Millennium older than 3.0.0), Gratitude keeps using files
for all five stores, with stage 1's checked atomic saves. Gratitude detects whether
millennium.config is present rather than enforcing a minimum Millennium version.

### Migration rule

Checked per store and per account at every startup:

- **Config already has the key:** use config. If the old file still exists, rename it to
  `*.migrated`.
- **Config doesn't have the key:** use the old file, copy its data into config, and leave the old
  file in place.

A file is only retired in a later session, after Millennium has reloaded `config.json` from disk
and found the key. Reading a value back in the same session would only check Millennium's memory.
A plugin reload (a toggle, or Millennium restarting a crashed plugin) also counts as a later
session without that reload; if that run's config writes never reached disk, gift records and
settings come back from `*.migrated` at the next Steam start, and consent is asked again. That is
accepted rather than guarded.

If config has no key and only a `*.migrated` file exists (after a `config.json` reset, or a
Millennium downgrade below 3.0.0):

- **Gift records and settings** fall back to the `*.migrated` file. An older copy beats showing
  nothing; a gift deleted after the migration may reappear.
- **Consent** does not fall back. The user is asked again, so an old "allowed" can't override a
  later decision to decline.

### Note length and size refusals

- Notes are capped at 2,000 characters. The notes field stops input at the cap, and the backend
  rejects longer notes rather than truncating them. A worst-case record is then about 2.3 KB, so
  even a fully maxed account holds over 100 gifts.
- A character counter appears from 1,800 characters, so a long paste that stops at the cap is
  visible.
- If an account's gift records still exceed 256 KB, the save is refused and undone in memory, and
  the modal shows a specific message, for example "Couldn't save: this account's gift notes have
  reached Millennium's storage limit. Shorten or remove some notes." The backend's error has to
  reach the modal for this, which it doesn't today.

### No backup file

Gift records are not also copied to a backup file. A `config.json` reset leaves Millennium's
`.corrupted` copy behind, a session with saving disabled destroys nothing on disk, and a backup in
the plugin folder would be deleted at uninstall anyway. Keeping two copies would also bring deleted
gifts back when they were merged, because nothing marks a record as deleted.

### Accepted trade-offs

Signed off on 2026-10-17:

- **Corruption resets everything.** A corrupted `config.json` resets every plugin's data.
  Millennium keeps a `.corrupted` copy for recovery by hand.
- **Disk-write failures are silent.** Gratitude is told a write succeeded even if it didn't reach
  disk.
- **A locked file disables saving for a session.** If `config.json` can't be opened at startup,
  Millennium shows a message box and that session's edits are lost.
- **Millennium's settings page can undo a gift edit.** If its settings page is open and the user
  changes a General or Network setting, the page writes back a stale copy of the whole file.
  Gratitude can't detect this.
- **Unusual content in a shared file.** Gift records are names of, and notes about, other people
  in Millennium's shared settings file. They stay on the machine, and are no more exposed to other
  plugins than files are.
- **The uninstall prompt says "settings".** Answering yes deletes gift notes too. The README
  explains this.
- **Power cuts.** With no fsync, a power cut could lose the latest write, as with files.

### README and changelog

A README section explains:

- where Gratitude stores each kind of data (millennium.config for gift records, consent and
  settings; files in the plugin folder for the two caches; files for everything on Millennium older
  than 3.0.0);
- what happens on uninstall: the folder goes and config keeps gift notes, consent and settings;
  where Millennium shows a "delete saved settings" prompt, yes deletes gift notes too;
- that removing Millennium as its uninstall guide describes removes Gratitude's data too, because
  nothing is stored in the cloud, and that on some Linux systems the config folder is deleted by
  hand.

Changelog entries under Changed:

- Changed gift records, consent and settings to be stored in Millennium's plugin config, so gift
  notes survive reinstalling the plugin.
- Existing gift records, consent and settings now move to Millennium's plugin config automatically,
  with the old files kept as `.migrated` copies.
- Limited gift notes to 2,000 characters, with a counter shown near the limit.

The Unreleased changelog already says the sidebar settings keep "plugin-owned persistence for UI
preferences". When stage 2 merges, check whether that entry has been released. If it hasn't, trim
it to end at "native Millennium-style controls"; if it has, leave it.

## Built-ins and libraries

We use what Millennium already provides, or an existing library, wherever one fits, and write our
own code only where nothing does. Checked on 2026-10-17.

**Atomic saves use Millennium's `fs.rename`.** It calls C++'s `std::filesystem::rename`, which
replaces an existing file on every platform:

- On Windows, Millennium is built against Microsoft's C++ library, whose rename calls `MoveFileExW`
  with `MOVEFILE_REPLACE_EXISTING`
  ([microsoft/STL filesystem.cpp](https://github.com/microsoft/STL/blob/main/stl/src/filesystem.cpp)).
  Plain Lua's `os.rename` would fail there, because Windows' C runtime won't replace an existing
  file.
- On Linux and macOS it is POSIX `rename`, which is atomic.

Two details carry over from how Millennium saves its own settings file:

- The temporary file sits in the same folder as the store file. Microsoft's rename falls back to a
  copy, which isn't atomic, when the two are on different drives.
- The rename is retried a few times on Windows, because antivirus software can lock a file for a
  moment.

Neither Lua's `io` nor Millennium's `fs` can force data to disk (fsync), so a save survives the
process being killed but not a power cut.

Ruled out:

- **Pure Lua libraries** use `os.rename`, so they have the same Windows problem.
- **Native Lua libraries** (luv, LuaFileSystem, luaposix) would mean shipping compiled files for
  each platform through steambrew.app.
- **npm libraries** such as write-file-atomic don't apply, because Gratitude's frontend and webkit
  script can't write to disk.
- **Penlight**, the standard Lua utility library. Its deep comparison can't ignore keys or list
  order, so the friends comparison would still need our own preparation, and it would ship about
  2,600 lines to every user for the trivial remainder.

**JSON uses Millennium's bundled lua-cjson, as today.** It escapes `/` as `\/`, so a size check
using it comes out slightly larger than Millennium's own measurement against the 256 KB limit. That
errs on the safe side.

**millennium.config is itself the library for stage 2.** It provides atomic writes, size limits and
survival across uninstall. Our own code is the migration, the size check and the note cap.

**New Lua tests use LuaUnit.** [LuaUnit](https://github.com/bluebird75/luaunit) is a single file
under a BSD licence (v3.5, released 2026-03-26). It lives in `tools/`, which never ships to users,
because neither the release zip nor steambrew.app's build includes that folder.

- Tests that need JSON use the standard `lua-cjson` package (on Ubuntu, `apt install lua-cjson`).
  It is close to Millennium's bundled version but not identical.
- Millennium's `fs`, `logger`, `utils` and `millennium.config` only exist inside Steam, so tests
  use small stand-ins for them.

## Constraints

- **Per-account partitioning** stays for every store.
- **Data location decided in one place.** Store files, temporary files, `*.corrupted.*` files and
  `*.migrated` files all follow the same location decision, so a later move to `.star` changes one
  thing.
- **Lua 5.1.** The backend runs on LuaJIT. Lua tests run with Lua 5.1 via `npm run test:lua`;
  frontend tests via `npm test` (vitest).
- **Callable argument order.** [AGENTS.md](../../../AGENTS.md) section 5 warns that Millennium may
  reorder object fields when passing arguments to Lua callables. Any callable that changes, such as
  the gift save returning a specific size error, follows that guidance.
- **Never uninstall the dev install.** Tim tests in Steam dev mode with the plugin symlinked from a
  checkout. Millennium's uninstall follows the link and deletes the checkout, including `.git`.
  Uninstall testing uses a normal install, not the symlinked one.

## Acceptance criteria

Stage 1:

- Killing the Lua host or Steam during saves never leaves a store empty, cut short or unreadable.
- A save on a full disk reports failure, leaves the previous file intact and leaves no temporary
  file behind.
- A failed gift, consent or settings save leaves memory matching the disk.
- For an account without consent, no licence or friends data reaches disk, including at shutdown.
- An unreadable or empty store file is renamed to `*.corrupted.<unix time>` rather than overwritten.
- Loading a Steam Community page twice in a row writes the friends cache at most once. This also
  checks that avatar URLs are stable between loads.
- Editing a gift stored under an old licence key never loses the note when the save fails.
- A failed consent or settings save leaves the UI showing the previous value.
- No log line contains a gifter name, note, profile link, friend name, licence or game name, or an
  unmasked account ID or SteamID64.
- Existing tests keep passing, and new LuaUnit tests cover the atomic save, the consent filter,
  the set-aside and the friends comparison.

Stage 2:

- Existing users' gift notes, consent and settings survive the upgrade, on Millennium both with and
  without millennium.config.
- An old file is renamed to `*.migrated` only in a session after its data was copied into config.
- After a `config.json` reset, gift records and settings come back from `*.migrated`, and the
  consent dialog appears again.
- Gift notes survive a plugin uninstall and reinstall when the user answers no to Millennium's
  prompt, checked on a normal install, never the symlinked dev install.
- A note over 2,000 characters is rejected by the backend, and a refused oversized save shows the
  storage limit message with nothing half saved.
- Every store stays partitioned per account.
- Existing tests keep passing, and new tests cover the migration rule and the fallbacks.

## Out of scope

- Moving Gratitude to the `.star` plugin format. This work only keeps that move cheap and gets gift
  notes out of the plugin folder first.
- Upgrading the build tool, @steambrew/ttc, from 2.8.7 to 3.3.7. Evaluated separately: it would
  break steambrew.app's build without a TypeScript pin and raise the minimum Millennium version.
- The frontend or the webkit script using millennium.config directly.
- Moving the licence cache or friends cache out of files.
- Purging data already on disk for accounts without consent.
- Testing the frontend live inside Steam (for example jsdom, or Playwright attached to Steam's
  DevTools). Frontend logic in this work is tested as pure functions in vitest.

## Follow-ups

Found while doing this work; none is caused by it, and each is separate work for Tim to schedule:

- **Run the test suites in CI.** No workflow runs `npm test` or `npm run test:lua` today; the Lua
  suite needs Lua 5.1 and lua-cjson on the runner.
- **A Store page opened by URL can stay half loaded.** Opening
  `steam://openurl/https://store.steampowered.com/?gratitude_sync=1` from outside Steam left the
  page at `readyState` "interactive" with no sync until it was reloaded.
- **App ID detection can pick another app's image.** On the Total War: WARHAMMER III library page
  it reported 345260 instead of 1142710, and the badge quietly fell back to matching by name.
- **The licence cache loses `totalLicenses` at load**, so the "unchanged licence count" check
  never matches after a restart and every Steam start re-syncs all licence pages.
- **The Store stays loading while Gratitude is enabled.** With Gratitude disabled it loads
  normally; enabled, the "Featured and Recommended" carousel never appears. To be planned in
  `plan-steam-bugs.md` after stage 2 is committed.
- **An account whose gift records were already over 256 KB in the old file gets stuck.** Its copy
  into config is refused every session, and every edit is refused unless that one edit brings the
  account under the limit. Needs a design choice: a file fallback for that account, or a message
  naming the problem. Unlikely, since it needs very long notes written before the cap.
- **Steam hangs on quit.** Since 2026-10-17 almost every quit logged `Shutdown` and then hung
  until killed, including once with no plugin loaded. Matches Millennium issue 931 (open). To be
  looked at in `plan-steam-bugs.md`: first whether it depends on Gratitude at all.
- **A security question about Millennium** moved to the Steam bugs plan and is kept privately.
- [AGENTS.md](../../../AGENTS.md) for Gratitude's architecture, including section 5 on callable
  argument order.
- [CHANGELOG.md](../../../CHANGELOG.md), which lists user facing changes.
- [Millennium documentation](https://docs.steambrew.app/), which covers millennium.config.
