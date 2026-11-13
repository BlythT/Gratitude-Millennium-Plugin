# Research and implementation notes: safe and durable storage for Gratitude user data

**Date**: 2026-10-17  
**Companion to**: [plan-data-storage.md](plan-data-storage.md)

This document records how the storage plan's decisions were reached and the detail behind them.
The plan says what we are building and why. This document covers how Gratitude's code and
Millennium actually behave, the evidence for each claim, the alternatives that were weighed and
rejected, and the gotchas that whoever writes the spec and the code needs to know.

**How to read the citations.**

- Gratitude paths are relative to the repo root, read on branch `build/regenerate-lockfile`
  (8a4f08f) on 2026-10-17.
- Millennium paths are relative to
  [SteamClientHomebrew/Millennium at tag v3.6.1](https://github.com/SteamClientHomebrew/Millennium/tree/v3.6.1)
  (commit 401d5325), the version installed on Tim's machine. Millennium's `main` was six commits
  ahead at the time, and none of those commits touch config code.
- Claims reasoned from the source but not run are marked **(inferred)**.
- The research was done by four background agents during the session (plugin updates,
  millennium.config, the build tool and starlight, and a `/research` pass over the plan). The main
  session re-checked in source every claim a decision rests on. Anything only reported by an agent
  and not re-checked says so.

## Overview

Gratitude keeps five JSON stores as files inside its own plugin folder, saved by the Lua backend.
Only one of them, the gift records ("givers"), holds data the user typed in by hand and that can't
be rebuilt from Steam. The research set out to answer one question, whether a plugin update
deletes that data, and found that it doesn't. It then found several other ways the data can be
lost or leak today: saves that a crash can leave empty, write failures that go unnoticed, a
shutdown save that runs while Steam is being killed, scraped data reaching disk without consent,
and an uninstall that silently deletes every gift note.

Millennium has one documented place for a plugin to keep user data: its plugin config store,
millennium.config. Values live in Millennium's own settings file, `config.json`, outside the
plugin folder. They survive plugin updates and Millennium updates, and survive an uninstall unless
the user answers yes to a "delete saved settings" prompt. It also works unchanged for the newer
`.star` plugin format, which has no plugin folder at all. The cost is a set of limits and failure
modes: 256 KB per value, 256 keys per plugin, disk-write failures that are only logged, and one
shared file whose corruption resets every plugin's data. Those limits rule it out for the licence
cache, which outgrows a single value at roughly 1,900 to 2,600 licences.

The resulting plan has two stages. Stage 1 makes file saves atomic and checked, removes the
shutdown save, keeps unconsented data off disk, sets unreadable files aside and fixes the gift
modal's delete-before-save order. Stage 2 moves gift records, consent and settings into
millennium.config with a migration that only retires the old files once a later session has
proved the data reached disk. The most important things for an implementer to know are:

- Lua reports write and close failures by return value, never by raising, so `pcall` catches
  nothing (section 3.2).
- Only the first value a Lua callable returns reaches the frontend (section 3.8).
- millennium.config's `get` reads Millennium's memory, not the disk, and a failed disk write still
  returns success (section 4.7).
- Millennium's `fs.rename` replaces an existing file on Windows, Linux and macOS, while plain Lua's
  `os.rename` does not on Windows (section 6).

## Research findings

### 1. Plugin updates keep user data; uninstalling deletes it

This was the question that started the work. Millennium's updater,
`head::plugin_installer::update_plugin` (`src/bindings/plugin_mgr.cc:269-370`), downloads the new
package from steambrew.app into a temporary folder, `plugins/__tmp_<uuid>/`, then copies each file
into `plugins/<name>/` with `copy_options::overwrite_existing`. It never calls `remove_all` or
`rename` on the plugin folder. Files in the package are overwritten and files outside it are left
alone. The same merge behaviour goes back to Millennium v2.29.2's Python updater
(`shutil.copytree(..., dirs_exist_ok=True)`).

The package can't contain Gratitude's data files. steambrew.app builds each plugin from a fresh
checkout through the SteamClientHomebrew/PluginDatabase repo, whose `scripts/build/prepare-dist.sh`
copies `.millennium`, `plugin.json`, the README and the `backend/` folder. The data files are
gitignored, so a fresh checkout has none. The research downloaded the live Gratitude package from
steambrew.app and listed it: no `gratitude_*.json`. Gratitude's own GitHub release zip
(`.github/workflows/release.yml:33-39`) is also built from a CI checkout.

Things that do delete the data:

- **Uninstall.** `uninstall_plugin` (`src/bindings/plugin_mgr.cc:74-99`) deletes the whole plugin
  folder through `platform::safe_remove_directory` (`src/system/filesystem.cc:216-303`). There is
  no "reinstall" for plugins, and the installer refuses to install a plugin that is already
  installed (`src/typescript/frontend/components/PluginInstaller.tsx:76-86`), so reinstalling
  means uninstalling first.
- **Uninstalling a symlinked dev install deletes the checkout.** `safe_remove_directory` follows a
  symlink and deletes every file in the target, `.git` included, before removing the link. The
  research copied the function's logic into a test program and ran it against a symlinked fake
  plugin: it deleted `.git/HEAD`, `plugin.json` and `backend/gratitude_givers.json` from the
  target. Tim's dev install is exactly this setup, so it must only ever be removed with
  `unlink ~/.local/share/millennium/plugins/gratitude`.
- **The `.star` format.** A `.star` plugin is a single file, with no plugin folder (section 8).
- **A one-off Windows migration in v3.0.0.** `Win32_MigrateLegacyLayout`
  (`src/platform/windows.cc:188-270`) moved `<Steam>/plugins/*` to `<Steam>/millennium/plugins`,
  skipped any entry whose destination existed, and then ran `remove_all(<Steam>/plugins)` anyway,
  so a colliding plugin folder was deleted with its data. This is in the past and narrow.

Two side findings: updates never remove files a newer version dropped, so old `.lua` files pile up
in installed copies; and installs from Gratitude's GitHub zip have no `metadata.json`, so
Millennium never checks them for updates (`plugin_mgr.cc:165-186`).

There is no per-plugin data folder API. `utils.get_backend_path()` returns
`<plugin folder>/backend` (`src/lua_host/api/utils.cc:660-669`, set from
`src/engine/backend_mgr.cc:155` and `src/engine/plugin_manager.cc:172`), so Gratitude's files live
inside the folder that uninstall deletes. `plugin.json` has no "keep these files" list: its schema
(`src/system/plugin-schema.json`) has only `include`, which adds files to the package.

### 2. How Gratitude stores data today

The Lua backend (`backend/main.lua`, 645 lines) owns all storage. The frontend and the webkit
script reach data only through backend callables. Each store has an in-memory table and a
`JsonStore` instance (`backend/main.lua:11-22`):

| Store | File | In-memory shape per account | Written by |
| --- | --- | --- | --- |
| Licence cache | `gratitude_cache.json` | `{byAppId = {appid -> {name, date, acquisition}}, byName = {name -> {date, acquisition}}, totalLicenses}` | `SetGameLicenseData` (once per licence page), `ClearCache` |
| Consent | `gratitude_consent.json` | `{allowed = bool, timestamp = int}` | `SetConsent` |
| Givers | `gratitude_givers.json` | `{licenseKey -> {licenseKey, libraryTitle, displayName, source, createdAt, updatedAt, steamID64?, profileUrl?, notes?}}` | `UpsertGiverData`, `DeleteGiverData` |
| Friends cache | `gratitude_friends.json` | `{friends = [{steamID64, displayName, updatedAt, profileUrl?, nicknameOrAlias?, avatarUrl?}], updatedAt}` | `SetFriendsCache`, `ClearFriendsCache` |
| Settings | `gratitude_settings.json` | `{showFriendPickerSteamUrl = bool}` | `SetUiSettings` |

Every store is a map keyed by Steam account ID at the top level. `backend/lib/JsonStore.lua` builds
each path with `fs.join(utils.get_backend_path(), filename)` (line 12). `JsonStore:save` encodes the
whole store with the bundled lua-cjson and writes it in place. `JsonStore:load` returns the decoded
table, or `{}` when the file is missing, empty or fails to parse. Every change saves that store's
whole file at once, and `on_unload` saves all five again (`backend/main.lua:625-634`).

On Tim's machine on 2026-10-17 the files are: licence cache 89,976 bytes (907 licences), consent
53 bytes, and givers, friends and settings each `{}`. **There are no real gift records on this
machine**, so migration tests need synthetic records. The 47 gifts mentioned in the session are
"Gift/Guest Pass" licences in the cache, not annotated gift records.

### 3. Ways today's code loses or leaks data

#### 3.1 Saves are not crash safe

`JsonStore:save` opens the store file with `io.open(path, "w")` (`backend/lib/JsonStore.lua:35`),
which truncates it before the new contents are written. A process that dies part way through
leaves the file empty or cut short. On the next start, `JsonStore:load` logs the decode error and
returns `{}` (lines 76-88), the `load_*_from_file` helpers leave the in-memory store empty
(`backend/main.lua:37-113`), and the next save writes that empty store over the damaged file. The
loss is then permanent.

#### 3.2 Failed writes go unnoticed

In Lua 5.1 and LuaJIT, `file:write` and `file:close` report failure by returning `nil, message`.
They never raise. `JsonStore:save` wraps the write in `pcall` (lines 41-43), which only catches
raised errors, and ignores what `close` returns (line 45). It then logs "saved successfully" (line
52). Tested on Lua 5.1.5 against `/dev/full`, which always reports a full disk:

```text
f:write(string.rep("x", 100))  -> true
f:close()                      -> nil  No space left on device  28
```

The small write succeeds into the buffer, and the error only appears at `close`. So on a full disk
today a save truncates the file, writes nothing and reports success. LuaJIT's `src/lib_io.c`
behaves the same way, per the `/research` agent's reading.

#### 3.3 A failed save isn't undone in memory

`UpsertGiverData` puts the record into memory (`backend/main.lua:431-432`) before saving (line 434),
and `DeleteGiverData` removes it from memory (lines 459-465) before saving (line 467). If the save
fails, the gift modal shows "Unable to save giver data." (`frontend/components/GiverModal.tsx:204`),
but `giverCache` reloads from the backend on the next read, which returns the unsaved edit from
memory. The user sees an edit that isn't on disk, and it disappears at the next Steam start.
`SetConsent` mutates `consentState` (lines 346-351), saves, ignores the result and always returns
`true` (lines 352-353).

#### 3.4 The shutdown save runs while Steam is being killed

The comment above `on_unload` (`backend/main.lua:623-624`) says it may not be called if Steam
crashes. In Millennium v3.6.1 it is called, at the worst moment:

- When Steam's process dies, the Lua host sees its socket close and calls `on_unload` "so the
  plugin gets a chance to persist state" (`src/lua_host/main.cc:959-962`).
- At the same time the host is being shut down. On Linux it was started with
  `prctl(PR_SET_PDEATHSIG, SIGHUP)` (`src/engine/child_process.cc:619`) and its SIGHUP handler
  calls `_exit(1)` (`src/lua_host/main.cc:606-609`). On Windows it runs in a job object with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`src/engine/child_process.cc:564-567`).
- On a clean quit the host gets a `SHUTDOWN` call with a 5 second timeout
  (`src/engine/child_process.cc:239`). After that, on Linux it gets SIGTERM, a 3 second wait and
  SIGKILL (lines 149-152); on Windows it is terminated at once (line 146).

So the five-file rewrite starts because of the kill and races the signal that ends the process.
Which usually wins wasn't measured. On 2026-10-17 Steam hung on quit twice on Tim's machine and
needed `kill -9`. After the second kill all five files had been rewritten in the same second, and
the hook had created `{}` files for givers, friends and settings, which hadn't existed before. They
came through intact that time.

#### 3.5 Scraped data reaches disk without consent

The consent dialog says: "This plugin needs to store your Steam license history (acquisition dates
and sources) and friends list locally to function. Your data never leaves your computer."
(`frontend/components/ConsentModal.tsx:34`). What the code does:

- **Licences.** The webkit script scrapes the licence pages on Store visits with no consent check
  (`webkit/index.tsx:20-22`, `122-240`; "consent" appears nowhere in `webkit/`).
  `SetGameLicenseData` always merges the result into memory (`backend/main.lua:262-264`) and only
  skips its own save without consent (lines 272-277). But every licence cache save writes every
  account held in memory: another, consented account syncing in the same session, `ClearCache`
  (lines 323-332) and the shutdown save (line 629) all write unconsented licences to disk.
- **Friends.** `SetFriendsCache` (lines 503-540) has no consent check at all, and the webkit script
  calls it on every steamcommunity.com page load (`webkit/index.tsx:247-289`).

Consent arrived in v0.1.6 (commit 4615211, 2026-01-31). `load_consent_from_file`
(`backend/main.lua:67-74`) has no conversion from any older format, so users from v0.1.0 to v0.1.5,
or with the old global consent format, already count as not consented and see the dialog today.

Millennium's FAQ says "Millennium does not store or log any form of user data and ensures that
approved plugins do not store user data without consent"
([docs.steambrew.app FAQ](https://docs.steambrew.app/users/getting-started/faq)). Gift records also
have no consent check (`UpsertGiverData`, `backend/main.lua:405-440`), but they are typed in by the
user and the dialog doesn't mention them; the plan's consent rule covers the two scraped caches.

#### 3.6 The gift modal deletes before it saves

When a gift record stored under an older licence key format is edited, `handleSave` first calls
`giverCache.remove` on the old key (`frontend/components/GiverModal.tsx:180-183`), then
`giverCache.upsert` on the new key (lines 186-194). If the upsert fails, or Steam dies between the
two calls, the old record is already gone. This only affects records under the legacy key format,
which are the oldest notes.

#### 3.7 The friends cache is rewritten on every Community page load

`normalize_friend_rows` stamps every friend with `updatedAt = os.time()`
(`backend/main.lua:187-191`) and `SetFriendsCache` stamps the snapshot too (lines 529-532), so the
stored file always differs
and is always rewritten, even when the friend list hasn't changed. Nothing in the UI shows the
timestamp: `frontend/injection/friendscache.ts:21` only passes it through.

#### 3.8 Only a callable's first return value reaches the frontend

Several callables return `false, "message"` (for example `UpsertGiverData` at
`backend/main.lua:435`). The Lua host calls every callable with `lua_pcall(L, numArgs, 1, 0)`
(`src/lua_host/main.cc:470`), which keeps exactly one return value. The message is dropped. Strings,
booleans, numbers and tables can be returned (lines 480-513); tables are converted to JSON, whose
objects have their keys sorted by nlohmann. This is why the plan says the backend's size error
"has to reach the modal, which it doesn't today".

The frontend reads results through `isTruthy` (`frontend/utils/truthy.ts`): `true` is true, a
string is true only if it equals "true", and an object is judged by the value of its first key. A
returned table such as `{ok = false, error = "..."}` arrives with keys sorted (`error`, then `ok`),
so it happens to read as false, but only by accident of key order.

### 4. millennium.config

#### 4.1 Purpose, history and minimum versions

The docs page ([plugins/advanced/config](https://docs.steambrew.app/plugins/advanced/config))
describes it as the way "to store/sync user data between the backend and frontend", and says
"Configuration is entirely reactive". No docs page states where it is stored or its limits; those
come from the source only. The TypeScript API docs also carry a deprecation warning dated
2026-07-06 pointing old APIs at "the config API".

- It arrived in commit ffb2bf0757 (2026-03-18, PR 736), first in v3.0.0-beta.8, first stable in
  **v3.0.0 (2026-05-30)**. At v3.0.0 the Lua functions, the limits and the atomic write were
  already the same as in v3.6.1 (checked by the agent at the v3.0.0 tag).
- **Its frontend side was broken from v3.0.0 to v3.4.1.** Every frontend config call rejected with
  "type must be string, but is number" (issue 903, fixed by PR 904 in **v3.5.0, 2026-09-26**). The
  write still happened but reads never returned. The Lua side uses a different channel
  (`src/engine/plugin_loader.cc:1015-1050`) and was not affected (inferred).
- So the minimum is v3.0.0 for Lua-only use, and v3.5.0 if the frontend uses it.

#### 4.2 The Lua API

`millennium.config` is registered on the `millennium` module for every plugin
(`src/lua_host/api/millennium.cc:490-495`); on Millennium older than 3.0.0 it is absent, so
`if millennium.config then` is the feature check. Functions (`src/lua_host/api/config.cc:123-263`):

| Call | Returns | Notes |
| --- | --- | --- |
| `get(key)` | the value, or `nil` for a missing key; `nil, err` on an IPC error | Reads Millennium's in-memory copy (`src/bindings/plugin_config.cc:80-85`) |
| `set(key, value)` | `true`, or `false, err` | Blocks until the parent has validated, updated memory and called `save_to_disk` (`src/lua_host/rpc.cc:66-101`, `plugin_config.cc:95-110`) |
| `delete(key)` | `true`, or `false, err` | Also rewrites `config.json` |
| `get_all()` | a table of every key, or `nil, err` | Useful for finding `givers.*` keys by prefix |
| `on_change([key,] fn)` | an unsubscribe function | Not needed for this work |

Lua can only reach its own plugin's namespace, because the parent uses the child process's own
plugin name (`src/engine/plugin_loader.cc:1015-1050`). The RPC client is set up
(`src/lua_host/main.cc:655`) before `on_load` runs (line 896), so config calls are available in
`on_load`, which is where the migration runs.

#### 4.3 Why the frontend and webkit don't use it directly

- The frontend side needs Millennium v3.5.0 (section 4.1).
- The plugin name is injected into frontend calls at build time by `@steambrew/ttc` 3.3.7
  (`dist/index.js:984-991` in its npm package). Gratitude is on ttc 2.8.7 and `@steambrew/client`
  5.8.4, which have neither the injection nor the type declarations. With today's toolchain a
  frontend call would need the plugin name passed explicitly, or it writes to the `plugins[""]`
  namespace (inferred).
- Webkit pages get `window.MILLENNIUM_API.pluginConfig` (`src/typescript/sdk/src/index.ts:123`), but
  ttc doesn't inject the name there and change events only reach the main UI context (inferred,
  not tested).

Keeping all access in the Lua backend avoids all three and needs no toolchain change. It also
matches `backend/AGENTS.md`: "Native file access belongs here, not in `frontend/` or `webkit/`".

#### 4.4 How Lua values are converted

`lua_to_json` (`src/lua_host/api/config.cc:23-121`) converts in both directions:

- `nil` becomes JSON null; booleans and strings pass through; a number becomes an integer if it has
  no fractional part, otherwise a double.
- A table is an array only if `lua_objlen > 0` and keys 1 to n all exist. **An empty table becomes
  `{}`.** A table mixing a list part and named keys is stored as the list only, and the named keys
  are dropped silently.
- **Integer keys come back as strings**, and float keys are truncated through
  `std::to_string(static_cast<int>(...))`. Boolean and table keys are skipped.
- Strings stop at an embedded NUL. nlohmann sorts object keys, so key order isn't preserved.
- Invalid UTF-8 would make nlohmann's `dump()` throw, and a table that contains itself recurses
  with no depth guard until the host crashes (both inferred).
- `set(key, nil)` stores a JSON null, which still counts towards the key limit. Use `delete`.

Gratitude's shapes are safe: every map key is a string from `json.decode`, including licence keys
that look like numbers, such as `"220"` (`frontend/components/GiftBadge.tsx:151`). A key's JSON type
comes from its Lua type, not from how it looks.

#### 4.5 Limits

From `validate_limits` (`src/bindings/plugin_config.cc:45-60`):

- **256 KB (262,144 bytes) per value**, measured as the compact `value.dump().size()`.
- **256 keys per plugin**, checked only when adding a new key.
- **512 bytes per key name.**

Limits are per value and per plugin. There is no quota shared between plugins. Breaking a limit
returns `false, "plugin config value too large (max 256KB)"` or `false, "plugin config key limit
exceeded (max 256)"` and leaves the stored value unchanged. `get_all` could in theory exceed the
16 MB IPC frame (`src/include/plugin_ipc.h:108`), which Gratitude won't approach.

#### 4.6 Where and how it's stored

- **Path.** `MILLENNIUM__CONFIG_PATH/config.json` (`src/system/config.cc:286`). On Linux that is
  `${XDG_CONFIG_HOME:-~/.config}/millennium/config.json` (`src/system/environment.cc:157,169`), and
  a user-set `MILLENNIUM__CONFIG_PATH` wins (lines 101-104). On Windows it is
  `<Steam>\millennium\config\config.json`.
- **Layout.** One file holds all of Millennium's settings plus every plugin's values, under
  `plugins.<name>.config.<key>`.
- **Writes** (`src/system/config.cc:199-245`). Every plugin `set` or `delete` rewrites the whole
  file, even when the value hasn't changed. It writes `config.json.tmp` pretty printed with a
  2-space indent, flushes, checks the stream, then renames over `config.json`, retrying 5 times
  50 ms apart because Windows antivirus software can briefly lock the file. There is no fsync. All
  writes go through one `config_manager` in Steam's process, serialised by two mutexes, so there is
  a single writer and the Lua host never touches the file.
- **Load** (lines 142-197). A stale `config.json.tmp` is deleted. Invalid JSON is copied to
  `config.json.corrupted.<unix time>`, a message box tells the user, and everything resets to
  defaults. A file that exists but can't be opened turns saving off for the session
  (`_save_disabled`) with a message box.
- **Memory.** The whole file is parsed and held in Steam's process, and the whole config, every
  plugin's values included, is sent to the Steam UI at startup (`src/bindings/entry_point.cc:233`).
  Every Lua `set` also evaluates a script in Steam's shared UI JavaScript context carrying the
  base64 of the whole value (`plugin_config.cc:61-78`).

Killing Steam mid-write leaves the previous `config.json` intact, and the leftover `.tmp` is cleaned
up on the next start. A power cut could still lose the latest writes (no fsync).

#### 4.7 Failure modes

- **Disk-write failures are silent.** `set` validates, updates memory, calls `save_to_disk` and
  returns success (`plugin_config.cc:95-110`). `save_to_disk` returns nothing: a temp file that
  can't be opened, a failed write or a rename that fails 5 times is only logged
  (`config.cc:216, 224, 244`). The value stays in memory, so a passing failure is fixed by the next
  write from any plugin. A lasting one, such as a full disk, loses writes without telling
  Gratitude. The only errors that reach Gratitude are limit refusals.
- **Reading back proves nothing about the disk.** `get` returns the in-memory copy. Only a fresh
  start that reloads `config.json` from disk proves a write landed. This is why the migration
  retires old files in a later session.
- **Saving disabled for a session.** If `config.json` exists but can't be opened at startup, every
  `set` in that session returns true and writes nothing. The disk isn't touched, so nothing is
  destroyed; that session's edits are lost.
- **Corruption resets every plugin.** Recovery is by hand from the `.corrupted` copy.
- **Stale write from Millennium's settings page.** The page fetches the whole config once when it
  opens (`src/typescript/frontend/utils/config-provider.tsx:55`) and sends that whole snapshot back
  on every General or Network setting change (lines 78-88, `entry_point.cc:324-351`). `set_all`
  replaces everything (`config.cc:253-259`) and skips change notifications (`entry_point.cc:351`),
  so a Gratitude write made while the page is open is reverted, and Gratitude can't detect it.

#### 4.8 Lifecycle

- **Plugin update:** untouched, since `config.json` is outside the plugins folder.
- **Uninstall through Millennium's settings:** after deleting the folder, Millennium checks whether
  the plugin has any stored config and, if so, asks "Do you want to delete saved settings for
  Gratitude - Gifted Games Reminder?"
  (`src/typescript/frontend/settings/plugins/PluginComponent.tsx:96-104`). The locale key
  `pluginDeleteConfigPrompt` is missing from `english.json`, so every language sees that English
  fallback with the plugin's `common_name`. Values are deleted only on yes.
- **Deleting the plugin folder by hand:** never asks, and the values stay in `config.json`.
- **Millennium update or reinstall:** survives (inferred from the Linux install script and the
  Windows uninstaller, which never removes `millennium/config`). Removing Millennium the way its
  [Linux uninstall docs](https://docs.steambrew.app/users/parting-ways/uninstall) say
  (`rm -rf ~/.config/millennium`) removes everything.
- **Moving to `.star`:** survives only if `millennium.toml` sets `[plugin].id = "gratitude"`, since
  that becomes the config namespace (`src/engine/star_parser.cc:494,514`).

#### 4.9 Exposure and privacy

Nothing in Millennium sends `config.json` off the machine. Its only outbound requests are the plugin
update check (plugin id, commit and folder name, `src/bindings/library_updater.cc:110-131`), theme
updates, its own update check and store lookups. There is no telemetry, export or cloud sync.
Millennium's bug template asks for logs, not config. The crash dialog asks for `crash.log` and, on
Windows, a crash dump, which records stacks and module data rather than the heap (inferred).

On the same machine, exposure is about the same as files:

- Any plugin's frontend can read any plugin's config by naming it (`src/engine/core_ipc.cc:227`).
- The whole config goes to the Steam UI at startup (`entry_point.cc:233`).
- Millennium's developer socket (`/tmp/millennium-mep.sock` on Linux) always starts and exposes
  `plugin.config.get/set/delete/get_all` for any plugin (`src/mep/mep_hooks.cc:888-935`). It is
  local only.
- Files in the plugin folder are no better protected, since any plugin's Lua backend has full
  filesystem access.

The realistic way Gratitude's data leaves the machine today is its own log output. The backend logs
account IDs and licence names (`backend/main.lua:252-253`, `438`, `474-477`), and Millennium's
troubleshooting docs tell users to share logs. Notes aren't logged. This is out of scope for the
plan.

#### 4.10 What other plugins keep in millennium.config

The millennium.config agent searched GitHub code for the config API and read all 36 PluginDatabase
plugins at their pinned commits, plus 13 `.star` plugins. Code search only covers default branches,
so the list isn't exhaustive. Of 14 plugins found using the config store:

- Most store settings only.
- Three store secrets: API keys (ggdeals-millenium, millennium-cs2-profile-stats) and an Epic
  account refresh token (Lauchers_pLugin).
- refund-guard stores the user's own purchase prices, capped so the largest key sits around the
  256 KB limit (inferred).
- millennium-external-data-sources stores user-entered metadata as one key per non-Steam app, which
  would hit the 256-key cap past about 250 apps (inferred).
- Family-Library is the only one storing data about other people: family members' Steam account
  IDs, with no names or notes.

**Gratitude would be the only plugin storing names of, and notes about, other people.** Plugins that
handle friends' data (Better-Friends-Chat, cs2tracker, the player stats plugins) read it live and
store nothing. Library-Tracker keeps per-game data in files on purpose, with a comment explaining
that a library can hold thousands of games, well past the 256-key limit
(`backend/storage.lua:6-10` in that repo).

### 5. How each store fits

Measured on Tim's machine with a script that printed only structure and sizes, never contents.

| Store | Size | Fit | Reason |
| --- | --- | --- | --- |
| Licence cache | 89,874 compact bytes for 907 licences (657 `byName`, 414 `byAppId` entries) | No | 99 bytes per licence counted against `totalLicenses`, 137 bytes against unique names. One value fills at about 2,600 or 1,900 licences. 5,000 licences is 484 to 668 KB, 20,000 is 1.9 to 2.7 MB. Pretty printing in `config.json` makes it 1.78 times larger on disk (159,853 bytes locally). Every licence page sync would rewrite all of `config.json`, up to roughly 3.5 to 4.9 MB for a 20,000-licence collector. |
| Givers | About 326 bytes per record without notes, 537 bytes with a 200-character note (synthetic) | Yes, per account | 490 to 800 records per 256 KB value. Written only when the user acts. |
| Consent, settings | Tens of bytes per account | Yes | |
| Friends cache | About 289 bytes per friend | Size yes, writes no | About 900 friends per value, but written on every Community page load. Rebuildable. |

The licence cache extrapolation assumes the local ratios hold (63% of names matched to an app ID,
657 unique names per 907 licences). Splitting `byName` and `byAppId` into separate keys only
reaches about 3,300 or 2,900 entries each, so splitting doesn't rescue it.

With one key per account for each of the three moved stores, 256 keys allow 85 accounts on one
Steam install. Splitting only gift records per account would allow 254.

### 6. Atomic rename across platforms and Millennium versions

Millennium's Lua `fs.rename(from, to)` calls C++'s `std::filesystem::rename` with an error code
(`src/lua_host/api/filesystem.cc:259-276`) and returns `true`, or `nil, message`.

- **Windows.** Millennium is built with clang-cl against Microsoft's C++ library
  (`CMakePresets.json:68-89`), whose rename calls
  `MoveFileExW(source, target, MOVEFILE_COPY_ALLOWED | MOVEFILE_REPLACE_EXISTING)`
  ([microsoft/STL `stl/src/filesystem.cpp`](https://github.com/microsoft/STL/blob/main/stl/src/filesystem.cpp),
  line 690 in the copy read). It replaces an existing file. Plain Lua's `os.rename` uses the C
  runtime's `rename`, which refuses to replace an existing file on Windows.
- **`MOVEFILE_COPY_ALLOWED`** means a rename across drives silently becomes a non-atomic copy, so
  the temporary file must sit in the same folder as the store file.
- **Linux and macOS.** POSIX `rename`, which atomically replaces the target.

**Version availability, checked while writing this document.** Gratitude's backend already
requires the Lua `fs` and `utils` modules (`fs.join`, `fs.exists`, `utils.get_backend_path`).
Millennium's 2.x stable line has no Lua backend support before v2.31.0 (2025-12-19): v2.30.0
contains no Lua code at all. From v2.31.0 the modules live in `src/runtime/liblj_fs.cc` and
`liblj_utils.cc`, and `fs.rename` and `utils.sleep` are present there, in v2.36.4 (the last 2.x
release) and in v3.0.0 onwards (`src/lua_host/api/filesystem.cc:460` and `utils.cc:609` at
v3.0.0). So **`fs.rename` adds no new minimum version**: every Millennium that can run Gratitude's
backend has it. v2.36.4's Windows CI also initialises the Visual Studio toolchain
(`.github/workflows/ci.yml:164-180` at that tag), so it links Microsoft's C++ library too
(inferred from the CI config, not from a built binary).

Neither Lua's `io` nor Millennium's `fs` can fsync, so a save survives a killed process but not a
power cut. From memory, not checked: ext4's default `auto_da_alloc` behaviour flushes a file's data
before a rename that replaces another file, so ext4 is mostly safe; NTFS makes no such promise.

### 7. Libraries considered

Tim's preference is to use tested libraries over custom code wherever one fits, so each part of the
plan was checked for an existing option.

- **Atomic file writes.** Pure Lua libraries (Penlight's file helpers and similar) use `os.rename`,
  so they fail on Windows when the target exists. Native Lua libraries (luv, LuaFileSystem,
  luaposix) would mean shipping compiled binaries per platform through steambrew.app, which builds
  from source with no native step. npm libraries such as write-file-atomic don't apply, because the
  frontend and webkit script can't write to disk. Millennium's `fs.rename` is the built-in answer.
- **JSON.** Millennium bundles lua-cjson 2.1.0.11 as `json`, and Gratitude already uses it. It
  escapes `/` as `\/`, so a size check using it comes out slightly larger than Millennium's own
  measurement, which errs on the safe side.
- **Stage 2 storage.** millennium.config is itself the library: atomic writes, limits and survival
  across uninstall. Our own code is the migration, the size check and the note cap.
- **Table comparison: Penlight.** Measured during the session:
  - `pl.tablex` pulls in `utils`, `types`, `compat` and `operator`: about 2,600 lines, 80 KB raw,
    24 KB zipped, against Gratitude's 36.7 KB steambrew.app package (+66%).
  - About 1 ms to `require("pl.tablex")` under Lua 5.1.
  - Loading it adds the globals `warn`, `table.pack` and `table.unpack`, inside Gratitude's own
    Lua process only.
  - Penlight 1.15.0, last commit 2026-09-03, MIT licence; it would be vendored in `backend/pl/`.
  - `tablex.deepcompare(t1, t2, ignore_mt, eps)` can't skip keys and compares lists in order.
    `tablex.compare_no_order(t1, t2, cmp)` ignores order but needs a comparison function of our
    own, because every friend record carries its own `updatedAt`.
- **Tests: LuaUnit.** A single file, BSD licence, v3.5 released 2026-03-26. The main session
  downloaded `https://raw.githubusercontent.com/bluebird75/luaunit/LUAUNIT_V3_5/luaunit.lua` and
  confirmed it runs a test under Lua 5.1. The alternative, busted, needs LuaRocks and native
  dependencies.
- **Tests: JSON.** Ubuntu's `lua-cjson` package (2.1.0) is installed on Tim's machine and loads
  under Lua 5.1 as `cjson`. It is close to Millennium's bundled fork but not identical.

### 8. The `.star` format and starlight, as they affect storage

Millennium's plugin template moved to a new build tool, starlight, on 2026-08-17. Starlight packs a
plugin into a single `<id>.star` file described by `millennium.toml`. The starlight agent's findings
that bear on storage, with the transition claims re-checked by the main session:

- **There is no plugin folder.** For a `.star` plugin the parent drops `backend_dir`
  (`src/engine/backend_mgr.cc:164-166`), so `utils.get_backend_path()` returns `""`
  (`src/lua_host/main.cc:676,712-713`). `fs.join("", "gratitude_givers.json")` then gives a relative
  path that resolves against whatever working directory the Lua host inherits (inferred).
- **No official data folder exists for `.star` plugins either.** Plugins invent their own:
  k0d13 uses `millennium.steam_path() .. "/millennium/data/<id>"`, BambooFury's plugins use
  `<get_install_path()>\plugins\<name>-data`, Library-Tracker uses `<plugin>/data/`, and hltb and
  Sortium both write `settings.json` straight into `get_install_path()`, so with both installed they
  overwrite each other's settings (inferred). Any future data folder needs its own subfolder, and
  must never sit under `millennium/plugins/`, which Millennium's Windows uninstaller can remove.
- **There is no update path from a folder plugin to a `.star`.** steambrew.app's update check only
  matches a folder install against a catalogue entry whose format isn't `star`
  (`steambrew/www/src/app/api/checkupdates/route.ts:60-61,73` in SteamClientHomebrew/steambrew.app),
  Millennium's updater only takes the `.star` path if `<name>.star` already exists
  (`plugin_mgr.cc:271-274`), and reinstalling means uninstalling first, which deletes plugin-folder
  data. If a `gratitude/` folder and a `gratitude.star` both exist, discovery lists both under the
  same name (`src/engine/plugin_manager.cc:188-213`), so double loading is likely (inferred).
- **Support.** `.star` loading shipped in v3.4.0 (2026-08-10); installing and updating `.star`
  plugins from steambrew.app only arrived in v3.6.0 (2026-10-14). None of the 36 PluginDatabase
  plugins ships as `.star` yet, and two that migrated in their own repos are still pinned at their
  pre-migration commits.
- **Other changes a move would need** (not storage, recorded for completeness): a `.star` webkit
  script runs in an isolated JavaScript world (`src/engine/plugin_webkit_world_mgr.cc:420-494`), so
  `window.g_steamID` and friends in `lib/steamid.ts` likely read as null; starlight lints every
  `callable` against `---@ffi` annotations positionally, so Gratitude's single-object callables
  would move to positional arguments; imports change to `'millennium'` in 10 files.

A scratch conversion built a working 62,106-byte `gratitude.star`, so the code side is manageable.
The user transition is what blocks it today.

### 9. Build tool upgrade (out of scope)

`@steambrew/ttc` builds `frontend/` and `webkit/` into `.millennium/Dist/`. Upgrading 2.8.7 to 3.3.7
was evaluated alongside this work and deferred:

- From 3.3.6, built code calls `callable(pluginName, route)`, which Millennium accepts from v3.0.0
  but v2.36.4 does not, so 2.x users would break (read in source, not run).
- steambrew.app builds with pnpm and ignores `package-lock.json`. With ttc `^3.3.7`, pnpm resolves
  TypeScript 7.0.2, whose main entry exposes no compiler, and the build crashes. This was reproduced
  locally and matches three ttc 3.3.7 plugins failing in PluginDatabase CI run 35296854148. A
  `"typescript": "^5.9.3"` devDependency fixes it with byte-identical output.

Stage 2 keeps millennium.config access in Lua precisely so this upgrade isn't needed.

## Technical context

### Gratitude files this work touches

| File | What matters |
| --- | --- |
| `backend/lib/JsonStore.lua` | `save` (lines 17-54) and `load` (56-89). Path built once at line 12, the natural single place for the data location decision. |
| `backend/main.lua` | Store instances (11-15), in-memory tables (17-22), load and save helpers (33-113), callables (235-599), `on_load` (601-621), `on_unload` (625-634). Two copies of `table_size` exist (here at 25, and `backend/lib/cache_merger.lua:1`); the plan leaves them. |
| `backend/lib/cache_merger.lua` | Merges each licence page into the cache. No dependencies; tested directly. |
| `frontend/components/GiverModal.tsx` | Save flow (173-211), notes textarea with no length limit (361-363), generic failure message (204, 207). Notes are trimmed before sending (192). |
| `frontend/injection/givercache.ts` | Wraps `UpsertGiverData` and `DeleteGiverData`, typed as returning `boolean`, and reloads the cache after success. |
| `frontend/components/ConsentModal.tsx`, `frontend/index.tsx:112` | Call `SetConsent`; neither acts on a `false` result beyond logging. |
| `webkit/index.tsx` | Licence sync (122-240, one `SetGameLicenseData` call per page, full sync skipped when `totalLicenses` is unchanged at 73-87) and friends sync (247-289). |
| `frontend/utils/truthy.ts` | `isTruthy`, used on every callable result. |
| `tools/test_cache_merger.lua` | The only Lua test today, with hand-rolled asserts. Run by `npm run test:lua` (`lua tools/test_cache_merger.lua`). It requires `backend.lib.cache_merger`, so tests run from the repo root. |
| `lib/license-matching.test.ts` | The only vitest test. Vitest has no config file, so it runs in its default Node environment with no DOM library. |
| `types/*.lua` | Editor type stubs. `types/fs.lua:106-112` declares `fs.rename`; `types/utils.lua:10-11` declares `utils.sleep`; `types/millennium.lua` has **no** `config` entries. |
| `.gitignore` | Ignores the five data files by name only (`*gratitude_givers.json` and so on). |
| `README.md`, `CHANGELOG.md` | README gets a data storage section; the Unreleased "plugin-owned persistence for UI preferences" line may need trimming. |
| `AGENTS.md`, `backend/AGENTS.md` | Both describe the five JSON files as where data lives. |

### Millennium source landmarks (v3.6.1)

| Area | File |
| --- | --- |
| Lua config API | `src/lua_host/api/config.cc` |
| Config validation, limits, get/set/delete | `src/bindings/plugin_config.cc` |
| `config.json` load and atomic save | `src/system/config.cc` |
| Lua `fs` module | `src/lua_host/api/filesystem.cc` |
| Lua host lifecycle, callable dispatch, shutdown | `src/lua_host/main.cc` |
| Child process start and stop | `src/engine/child_process.cc` |
| Plugin install, update, uninstall | `src/bindings/plugin_mgr.cc`, `src/system/filesystem.cc` |
| Uninstall config prompt | `src/typescript/frontend/settings/plugins/PluginComponent.tsx` |
| Settings page whole-config write | `src/typescript/frontend/utils/config-provider.tsx` |

### Tim's development environment

- Ubuntu 24.04, Millennium v3.6.1, Lua 5.1.5 at `/usr/bin/lua`, `lua-cjson` 2.1.0 installed. Lua
  5.1 was chosen to match the LuaJIT that Millennium runs backends on
  (`src/lua_host/CMakeLists.txt:53`).
- Gratitude is installed by symlink: `~/.local/share/millennium/plugins/gratitude` points at the
  main checkout, so the data files live in that checkout's `backend/`. Never uninstall it through
  Millennium's settings (section 1).
- Steam is started in dev mode with `gtk-launch steam-dev`; logs, including the backend's
  `GRATITUDE` lines, are in `~/.local/share/Steam/logs/console-linux.txt`. Steam has hung on quit
  twice on this machine and needed `kill -9`, so ask Tim before killing it.
- Agreed for execution after the spec: stage 1 on `fix/safe-saves` stacked on
  `build/regenerate-lockfile`, stage 2 on `feat/config-storage` stacked on stage 1, one commit at
  the end of each stage after its review, with the repo-local personal identity, never pushed. The
  `origin` remote is removed.
- Agreed test approach: every bug fix and behaviour change is tested red then green, test coverage
  is improved where possible, and frontend logic is pulled into pure functions tested in vitest's
  current setup with no new dependencies. Live testing inside Steam is out of scope.

## Decisions and rationale

Every decision below was agreed with Tim during the session on 2026-10-17, through a question by
question review of the plan's open points.

### Gift records move into millennium.config; the caches stay as files

We chose millennium.config for gift records because they are the one store holding genuine user
data we can't reconstruct, and the plugin folder is the wrong place for it. Tim's reasoning, as he
put it: the licence and friends data "are all caches that can be blown away, but gift notes are
genuine user data we cannot reconstruct". Reinstalling a plugin is the usual troubleshooting advice,
and today it silently deletes every note. millennium.config keeps the notes through a reinstall
unless the user agrees to delete them, and it keeps working unchanged in the `.star` format.

We weighed it seriously against keeping the file, because the file wins on most other counts:

- A failure stays inside Gratitude, instead of a `config.json` problem affecting every plugin.
- Gratitude finds out when a disk write fails, which millennium.config hides.
- There's no size limit, so no note cap or "storage full" message to design.
- The data sits in a visible file that is easy to inspect, back up or delete.
- It is less work and easier to test.

What tipped it is that the reinstall wipe is the loss users are most likely to actually hit, while
millennium.config's failure modes need rare combinations, and the `.star` move (next decision)
pushes further the same way. A data folder of our own outside the plugin folder was also
considered, as Library-Tracker and some `.star` plugins do. It would survive uninstall without
putting unusual content into the shared file, but the location is undocumented and nothing ever
cleans it up: the notes would be silently left behind at uninstall. millennium.config is the only
option where the user is asked, which Tim agreed is the most respectful choice for data about other
people.

Tim specifically asked whether gift notes and gifter names belonged in a store that other plugins
mostly use for settings. The comparison in section 4.10 showed Gratitude would be the only plugin
storing names of and notes about other people, but not the most sensitive content in that file
(tokens and API keys are), and nothing in Millennium sends the file off the machine. Exposure on
the same machine is the same as for files. Consent and settings move too, because they are choices
the user made and are tiny. The licence cache stays a file because it doesn't fit (section 5), and
the friends cache stays because it is rebuildable and written on every Community load.

### Stage 2 ships well before any move to `.star`

There is no update path from a folder plugin to a `.star` (section 8), and any transition that
involves uninstalling would delete data still in the plugin folder before the `.star` version ever
runs. Migrating now, while Gratitude can read its own folder directly through `get_backend_path()`
and has as many sessions as the migration rule needs, is the easy moment. Users need to launch a
stage 2 version at least twice before any switch: once to copy into config, once to retire the
file. A future `.star` version may still need a best-effort read of the old folder for users who
skip straight to it, which means rebuilding the old path per OS (Linux keeps plugins under
`~/.local/share/millennium/plugins`, not the config folder).

We decided not to migrate to starlight now. The code conversion looks manageable, but existing
users can't be moved across until steambrew.app and Millennium handle a plugin changing format, or
the Millennium maintainers say how it should work. Asking them would mean posting on GitHub, which
waits until `gh` is switched to Tim's personal account.

### The shutdown save is removed

We chose to drop the save of all five stores in `on_unload`. Every change already saves when it
happens (`SetConsent` at `backend/main.lua:352`, `UpsertGiverData` and `DeleteGiverData` at 434
and 467, `SetFriendsCache` and `ClearFriendsCache` at 534 and 552, `SetUiSettings` at 593,
`ClearCache` at 328). The shutdown save only did three things nothing else does:

1. It retried saves that had already failed. For gift records, friends and settings the UI was
   already told the save failed, so a silent retry contradicts what the user saw. Once failed saves
   are undone in memory, there is nothing left to retry.
2. It wrote licences for accounts without consent, the main route of the consent gap.
3. It re-saved an old-format licence cache in the new format after `load_cache_from_file`
   converted it in memory (lines 37-58). The next licence sync does that anyway.

Against keeping it: it runs while Steam is being killed (section 3.4), and after stage 2 it would
rewrite Millennium's whole `config.json` once per moved store on every quit, since `set` rewrites
even unchanged values. We considered keeping a per-store "last save failed" flag and re-saving only
those stores at shutdown, but every write path would have to maintain the flag, which is more work
than undoing changes. Dropping the save gives up one thing: a clean-quit write that would have
undone a stale write from Millennium's settings page. That is listed as an accepted trade-off.
`SetConsent` now returns its save result like the other callables.

### Only consented accounts reach disk; scraping is unchanged

The first recommendation was a backend guard that refuses to keep any licence or friends data for
an account without consent, plus a webkit check that skips scraping entirely. Tim chose a lighter
rule, reasoning that the consent is to *store* data: scraping and keeping it in memory for the
session is fine. So licence and friends data stays in memory either way, the UI keeps working for
the session, and every save of those two stores writes only accounts that have consented. If a
user consents later in the session, the next save of that store persists what is in memory. It is
about the same amount of work as the guard, and it doesn't change the webkit script.

We checked the edge this creates. Accounts with no consent record count as not consented, which
covers users from before the consent dialog existed (section 3.5). They already see the dialog
today, and the worst case for them is that their caches drop off disk until they answer it, then
sync again. Both caches are rebuildable and gift records aren't affected. We decided not to
actively purge data already on disk for accounts without consent; that is listed as out of scope.

### Unreadable files are set aside

Atomic saves stop Gratitude creating half-written files, but a file can still be unreadable from a
disk fault, a manual edit, a power cut, or damage left over from before stage 1 ships, which is
exactly the existing users we are protecting. We chose to rename such a file to
`<name>.corrupted.<unix time>`, log it, and start that store empty. This is the pattern Millennium
uses for its own `config.json` (section 4.6), and it is about ten lines in `JsonStore:load`. We
considered refusing to save that store for the session instead, which keeps the file safe but
breaks the feature with unexplained save errors until someone fixes the file by hand. Nothing is
shown in the UI, because Gratitude has no notification surface and recovery would be manual anyway.

### Failed saves are undone in memory for hand-entered stores

When a save of gift records, consent or settings fails, the backend restores the previous
in-memory value, so the UI never shows an edit that isn't on disk. Each change replaces one record,
or two consent fields, so undoing it means putting back the previous value, with no deep copy of the
store. The licence and friends caches keep their in-memory data when a save fails: they are
rebuildable, the next sync saves them again, and the consent decision already has them living in
memory for the session. The `/research` pass suggested undoing for every store; we didn't, because
for the caches it would only discard data the UI could keep using.

### The gift modal saves before it deletes

When a gift is moved from an older licence key, the modal now upserts under the new key first and
removes the old key only if that succeeded. If the removal then fails, the worst case is a stale
duplicate under the old key, which nothing looks up and which loses nothing. It belongs in stage 1
because stage 1's whole point is that a failed or interrupted save can't lose data. It is the only
frontend change in stage 1.

### Atomic saves use Millennium's `fs.rename`, with no library

A save writes a temporary file in the same folder, checks that both the write and the close
succeeded, and only then renames it over the store file with `fs.rename`. No library was needed:
the only part with platform differences is the rename, and Millennium's already handles them
(section 6). Two details carry over from how Millennium saves `config.json`: the same-folder
temporary file, and retrying the rename a few times because Windows antivirus software can lock a
file briefly. Leftover temporary files are deleted when stores load.

### The friends comparison is our own small helper

Tim first chose Penlight, preferring tested code, once its measured cost turned out small (section
7). The `/research` pass then showed that `tablex.deepcompare` can't skip keys or ignore list order,
so we would still write the tricky part ourselves: dropping every `updatedAt` and putting the list
in a stable order. Penlight would only do the trivial final step of comparing two sorted lists of
flat string records. At the same time the later-session migration rule removed the other planned
use, a deep comparison of nested gift records, and the undo decision needs no deep copy. With the
error-prone decisions ours either way and the costs unchanged (about 2,600 lines of vendored code
running in a process with full filesystem access, updated by hand), Tim dropped Penlight from the
plan. The comparison is a small helper of our own with a LuaUnit test, and the two existing
`table_size` copies stay as they are.

The comparison treats any visible change as a change, including a new avatar or a renamed friend,
so the cache stays accurate. As a result the stored "updated at" means when the list last changed,
not when it was last synced; nothing in the UI shows it.

### LuaUnit for the new Lua tests

LuaUnit is a single BSD-licensed file that runs under Lua 5.1 with no install, so it lives in
`tools/`, which never ships to users: neither the release zip nor steambrew.app's build includes
it. Tests that need JSON use Ubuntu's `lua-cjson`, and Millennium's `fs`, `logger`, `utils` and
`millennium.config` get small stand-ins, since they only exist inside Steam.

### Migration retires old files only in a later session

The first draft said "copy into config, read back to verify, then rename the old file". The research
showed `get` reads Millennium's memory, and that in a session where Millennium can't open
`config.json` every `set` succeeds in memory and writes nothing. In that session the draft would
copy the gift records in, read them back successfully, rename the file to `*.migrated`, and the next
launch would show no notes, with the data surviving only in the `.migrated` file. So the rule,
checked per store and per account at every startup, is:

- **Config already has the key:** use config. If the old file still exists, rename it to
  `*.migrated`.
- **Config doesn't have the key:** use the old file, copy its data into config, and leave the file.

A fresh load of `config.json` from disk finding the key is the only real proof the write landed, and
the rule needs no read-back. If config has no key but a `*.migrated` file exists (after a
`config.json` reset or a Millennium downgrade below 3.0.0), gift records and settings fall back to
the `.migrated` file, because an older copy beats showing nothing; the cost is that a gift deleted
after migration may reappear. Consent does not fall back: the user is asked again, so an old
"allowed" can never override a later decision to decline.

### One key per account for each moved store

Keys are `givers.<accountId>`, `consent.<accountId>` and `settings.<accountId>`. Each account gets
its own 256 KB for gift records, so one heavy account can't block another's saves; there is one
naming rule and one migration path for all three stores; and smaller values mean slightly less work
per write, since every write rewrites `config.json` and sends the value into Steam's UI. Millennium
treats a dotted key as a single name, and `get_all()` can find keys by prefix. The cost is a ceiling
of about 85 accounts per Steam install. We considered per-account keys for gift records only (254
accounts, but two naming rules and two migration shapes) and one key per store for all accounts
(a straight copy of today's files, but every account sharing one 256 KB).

### No backup file for gift records

A backup file would only help with millennium.config's own failure modes, and each is covered
another way: a corrupted `config.json` leaves Millennium's `.corrupted` copy; a session with saving
disabled destroys nothing on disk; and a backup in the plugin folder would be deleted at uninstall
anyway, while one outside it brings back the "undocumented location, never cleaned up" problem.
Keeping two copies would also be a bug source: nothing marks a gift record as deleted, so merging
the copies would bring deleted gifts back, and we would need a rule for which copy wins. The narrow
remaining gap is the stale settings-page write, accepted as a trade-off. The `.migrated` file also
acts as a snapshot of everything up to the migration.

### Note cap, counter and a specific size message

Notes are capped at 2,000 characters, enforced by the textarea's `maxLength` and by the backend
rejecting longer notes rather than truncating them, so nothing is silently cut short if something
bypasses the UI. A counter appears from 1,800 characters, because `maxLength` silently cuts off
pasted text. If an account's gift records still exceed 256 KB, the save is refused, undone in
memory, and the modal shows a specific message such as "Couldn't save: this account's gift notes
have reached Millennium's storage limit. Shorten or remove some notes." A cap bounds each record but
not the number of records, which is why the message is still needed. Realistically the only way to
fill an account is pasting very long notes.

### Backend only, and no build tool upgrade

Only the Lua backend reads and writes millennium.config, and the frontend and webkit script keep
calling the backend as they do today, apart from the size error reaching the modal. This avoids the
frontend's v3.5.0 minimum, the missing plugin-name injection in ttc 2.8.7, and the ttc 3.x upgrade
with its steambrew.app build crash and Millennium 3.0 minimum (section 9). Gratitude detects
whether millennium.config is present rather than enforcing a minimum Millennium version, and falls
back to files for all five stores without it.

### Telling users

The README gets a section explaining where each kind of data is stored, what happens on uninstall,
including that answering yes to Millennium's "delete saved settings" prompt deletes gift notes too,
and that removing Millennium removes Gratitude's data because nothing is stored in the cloud. Tim
first thought the last point too obvious to mention, then asked for it so the README is explicit.
Stage 1 gets three Fixed entries and stage 2 three Changed entries in the CHANGELOG (wording in the
plan). The consent entry was deliberately softened to "Fixed license and friends data being saved
to disk before storage consent was given." rather than describing a broken promise. The Millennium
3.0.0 fallback gets no CHANGELOG entry, because nothing changes for users on older versions.

### Accepted trade-offs

Tim signed off on these on 2026-10-17, each judged rarer than the two certain losses being removed
(an uninstall always wiping gift notes, and a killed Steam able to empty a file):

- A corrupted `config.json` resets every plugin's data; Millennium keeps a `.corrupted` copy.
- Disk-write failures in millennium.config are silent.
- A locked `config.json` at startup disables saving for that session; Millennium shows a message.
- Millennium's settings page can revert a gift edit made while it was open.
- Gift records are unusual content in Millennium's shared file, though no more exposed than files.
- The uninstall prompt says "settings" and deletes gift notes too.
- A power cut can lose the latest write, as with files today.

## Implementation notes

### Atomic, checked save

A sketch of the shape, not final code:

```lua
local function atomic_write(path, encoded)
    local tmp_path = path .. ".tmp"
    local file, open_err = io.open(tmp_path, "wb")
    if not file then
        return false, "open failed: " .. tostring(open_err)
    end

    local wrote, write_err = file:write(encoded)
    local closed, close_err = file:close()
    if not wrote or not closed then
        fs.remove(tmp_path)
        return false, "write failed: " .. tostring(write_err or close_err)
    end

    local renamed, rename_err
    for _ = 1, 5 do
        renamed, rename_err = fs.rename(tmp_path, path)
        if renamed then
            return true
        end
        utils.sleep(50)
    end

    fs.remove(tmp_path)
    return false, "rename failed: " .. tostring(rename_err)
end
```

- Test the first return value for truthiness rather than comparing it with `true`: Lua 5.1's
  `write` returns `true`, and implementations following Lua 5.2 return the file handle.
- Always call `close`, and check it: the `/dev/full` test shows the error may only appear there.
- `io.open(..., "wb")` avoids Windows text-mode newline translation. lua-cjson output has no raw
  newlines, so this is a precaution rather than a fix.
- The temp file name must sit in the same folder as the store file (section 6).
- At load, delete a leftover `<name>.tmp` before reading. A leftover temp file means the rename
  never happened, so the store file still holds the complete previous version.
- `JsonStore:save` should return the failure reason as well as `false`, so callers can log it.

### Setting aside unreadable files

- "Empty" means the file's content is zero length (or only whitespace), **not** a valid `{}`. Three
  of Tim's five files are exactly `{}` today and must load normally.
- A file that parses but isn't a table (for example `null`, which lua-cjson decodes to a
  `json.null` light userdata, or `[]` at the top level) would break the `next(loaded)` checks in
  `backend/main.lua`. Treating any non-table decode result as unreadable seems right; the plan
  doesn't say, so this is a suggestion for the spec.
- Rename with `fs.rename` to `<name>.corrupted.<os.time()>` in the same folder, and log the new
  name. If the rename itself fails, start the store empty but don't save over the file in that
  session (a suggestion; the plan doesn't cover a failed set-aside).

### Undoing failed saves

Capture the previous value before mutating, and restore it on failure:

- `UpsertGiverData`: remember `accountStore[key]` (possibly `nil`) and whether the account table
  existed before `ensure_account_store` created it. On failure, put the record back and remove an
  account table this call created.
- `DeleteGiverData`: remember the deleted record and whether the account table was removed because
  it became empty (lines 462-464).
- `SetConsent`: today it mutates the existing table's `allowed` and `timestamp` fields in place
  (lines 346-351). Either remember both fields or replace the whole record with a new table, so
  the previous table can be put back.
- `SetUiSettings`: remember `SettingsStore[steamUserID]`.
- `SetGameLicenseData`, `SetFriendsCache`, `ClearCache`, `ClearFriendsCache`: no undo, by decision.

### Consent filter

Build a filtered copy for each save of the licence and friends stores: only account IDs where
`consentState[id]` exists and `allowed == true`. Save that copy; the in-memory store keeps
everything. Note what this does to data already on disk: because a save writes the whole filtered
table, the next save of a store passively drops non-consented accounts that were on disk. That is
the behaviour the plan describes for users with no consent record, and it applies equally to
accounts that declined. There is still no active purge.

After stage 2, `consentState` is loaded from `consent.<id>` keys (or the consent file on the
fallback), so the filter reads the same in-memory table either way.

### Friends comparison

- Compare the incoming normalised list with the stored one for that account, ignoring the top-level
  `updatedAt` and every friend's `updatedAt`.
- Sort both by `steamID64` (then by the other fields, to keep the order total if duplicates ever
  appear), then compare `steamID64`, `displayName`, `profileUrl`, `nicknameOrAlias` and
  `avatarUrl`, treating a missing optional field as different from a present one.
- When unchanged, skip the save **and** leave the in-memory snapshot as it is, so memory keeps
  matching disk and the stored timestamp means "last changed".
- The research couldn't check whether Steam's avatar URLs are stable between loads, because the
  friends cache on Tim's machine is empty. If Steam rotates image hosts, every load would count as a
  change. The stage 1 acceptance check (load Community twice, the second load doesn't write) will
  show it.

### Getting the backend's error to the gift modal

Because only the first return value crosses (section 3.8), `return false, "message"` can't carry
the size error. One shape that keeps every existing caller working: return `true` on success and a
short string code on failure, such as `"storage_limit"` or `"save_failed"`. `isTruthy("true")` is
the only true string, so existing `isTruthy(success)` checks still read a code as failure, and the
modal can map the code to its message. Returning a table works by accident of sorted keys and is
best avoided. This is a suggestion; the spec should pick the shape. Any change to a callable's
arguments follows AGENTS.md section 5 (pass positional values or a JSON string).

### Note cap: count characters, not bytes

- JavaScript's `maxLength` counts UTF-16 code units, while Lua 5.1's `#notes` counts bytes and Lua
  5.1 and LuaJIT have no `utf8` library. Checking `#notes > 2000` in the backend would reject a
  1,000-character note in Chinese or Japanese (about 3,000 bytes) that the textarea allowed.
- Counting UTF-8 code points in Lua, for example `select(2, notes:gsub("[^\128-\191]", ""))`, gives
  a count never larger than the UTF-16 count, so anything the textarea accepts passes the backend.
- Count after trimming, since the modal trims notes before sending them
  (`frontend/components/GiverModal.tsx:192`).
- **Caveat on the plan's "over 100 gifts" figure.** It assumes notes are mostly ASCII. A maxed note
  in a script that takes 3 bytes per character in UTF-8 is about 6 KB, so a fully maxed account in
  such a language holds about 40 gifts (inferred from encoding sizes, not measured). Typical short
  notes still leave room for hundreds. The specific size message covers the rest.

### millennium.config usage

- Feature check: `millennium.config ~= nil`. Don't compare versions.
- Distinguish "missing" from "error": `local value, err = millennium.config.get(key)`. A missing key
  returns `nil` with no error. If `err` is set, treat config as unavailable for that store this
  session: use the file, don't copy, and never retire anything based on a failed read.
- Check `set`'s two return values. A `false` with a limit message is the size refusal; anything
  else false is an unexpected failure.
- A size pre-check with `#json.encode(value) <= 262144` gives a specific error without parsing
  Millennium's message, and slightly overestimates (section 7). Either approach works; the backend
  must still handle a refused `set`.
- Use `delete`, never `set(key, nil)`, to remove a key.
- **Key names can never change after release.** PluginDatabase's reviewer instructions flag changed
  settings storage keys, because they make users lose settings on update (its `CLAUDE.md:54` at
  04482f1cbd).
- `set` rewrites `config.json` even for an unchanged value, so avoid writing in loops or at startup
  when nothing changed.
- `types/millennium.lua` has no `config` declarations; adding them keeps the editor quiet and
  documents the return values.

### Migration details

- **One file holds every account, but keys are per account.** The rule "if config has the key,
  rename the file" needs a decision for a file holding several accounts where only some have keys.
  Retiring the file only once every account it contains was found in config at startup keeps the
  "proved on disk" guarantee. See the open points below.
- Run the migration in `on_load`, before `millennium.ready()`, after deleting leftover temp files
  and before any callable can run.
- An account present in config but not in the file, or the reverse, needs no special handling:
  config is used where it has the key, and the file data is copied where it doesn't.
- `fs.rename` replaces an existing target, so renaming to `*.migrated` when a `.migrated` file
  already exists overwrites the older one. See the open points below.
- `*.migrated` files are never deleted by Gratitude.

### One place for the data location

Store files, `.tmp`, `.corrupted.*` and `.migrated` files all derive from one function returning the
data folder, today `utils.get_backend_path()`. A later `.star` move then changes one line, and must
not choose a folder under `millennium/plugins/` (section 8).

### Files git must ignore

The dev install keeps live data in the checkout's `backend/` folder, so the new file names would
show up as untracked files and could be committed by accident, gift notes included. The current
patterns match only the exact names (`*gratitude_givers.json` and so on). Patterns for
`gratitude_*.json.tmp`, `gratitude_*.json.corrupted.*` and `gratitude_*.json.migrated` (or one
broader `backend/gratitude_*.json*`) are needed. Release builds are unaffected, because they come
from fresh CI checkouts.

### Tests

- `npm run test:lua` runs a single file today. It needs to run every Lua test file, for example a
  small runner script in `tools/`, while keeping `tools/test_cache_merger.lua` passing.
- `JsonStore.lua` requires `logger`, `json`, `io`, `fs` and `utils`. Install stand-ins through
  `package.loaded` before requiring it: `json` as Ubuntu's `cjson`; `fs` with `join`, `exists`,
  `remove` and `rename` built on `io` and `os.rename` (which behaves like `fs.rename` on Linux);
  `utils.get_backend_path` returning a temporary test folder; `logger` capturing messages.
- A full-disk test can point a store at a path where writes fail. `/dev/full` itself can't be the
  target of a temp-file-plus-rename save, so the write-failure path is easier to test with a `fs`
  or `io` stand-in that returns `nil, "No space left on device"` from `close`. Either way the test
  asserts the old file is intact, no `.tmp` is left behind and the save reports failure.
- A millennium.config stand-in should model the behaviours the design depends on: `get` returning
  `nil` for missing keys, `set` refusing values over 262,144 bytes, and a "saving disabled" mode
  where `set` returns true but a simulated restart loses the data. That last mode is what proves
  the later-session rule.
- Frontend changes (save-before-delete, counter threshold, error code to message) become pure
  functions tested in vitest's Node environment. No DOM library.
- Red then green for every fix and behaviour change: write the failing test, confirm it fails for
  the expected reason, then fix.

### Manual testing in Steam

- Back up `~/.config/millennium/config.json` before testing stage 2. Unlike the data files, it is
  **shared by every checkout and worktree**: the symlink only changes where the files live, while
  config values belong to the plugin name `gratitude`. Testing stage 2 in a worktree migrates into
  the same config that the main checkout's install will later read, and switching back to a stage 1
  build leaves config and files diverging. Remove Gratitude's keys (with Steam fully quit) to
  repeat a migration test.
- Test uninstall and reinstall only on a normal, non-symlinked install (section 1).
- Check the stale-temp cleanup and set-aside behaviour by placing files by hand with Steam quit.
- Re-pointing the symlink, the quit hang and dev mode are covered in `MILLENNIUM_DEVELOPMENT.md`
  section 5.3 and the project memories.

### Docs

- README: the data storage section the plan describes.
- `AGENTS.md` (the architecture diagram and section 4.2) and `backend/AGENTS.md` (its runtime data
  file list, which already omits `gratitude_settings.json`) describe the five JSON files as where
  data lives. After stage 2 three of them are fallback-only. Updating them isn't listed in the plan.

## Open points found while writing this research

None of these are decided. The first five are gaps in the stage 2 design that the spec needs to
settle; the rest are smaller.

1. **Retiring a file that holds several accounts.** When only some accounts in
   `gratitude_givers.json` have keys in config, is the file renamed, kept, or rewritten without the
   migrated accounts? Suggested: rename it only when every account it contains was found in config
   at startup.
2. **Edits made on the file fallback after a migration.** After a downgrade below Millennium 3.0.0,
   gift records fall back to the `.migrated` file. Where do new saves go then? If they go to
   `gratitude_givers.json`, then after upgrading again config already has the keys, config wins,
   and the file holding the downgrade-era edits is renamed to `.migrated`, replacing the older
   snapshot. Those edits survive only in that file. Rare, but the plan doesn't cover it.
3. **Consent given later in the session.** The plan says the next save persists what is in memory.
   For friends, the next Community load will usually find the list unchanged and skip the save; for
   licences, the webkit script skips a sync when `totalLicenses` is unchanged
   (`webkit/index.tsx:73-87`). So the caches can stay memory-only for the rest of that session.
   They are saved in the next session, when memory starts empty and the first sync counts as a
   change. Saving both caches when `SetConsent(true)` succeeds would close it, if wanted.
4. **How the size error reaches the modal.** Only the first return value crosses; see "Getting the
   backend's error to the gift modal" for a suggested shape.
5. **Counting the note cap.** Code points in Lua versus UTF-16 units in the textarea, and the
   "over 100 gifts" figure assuming ASCII notes.
6. **Non-table decode results** in the set-aside rule, and what happens if the set-aside rename
   fails.
7. **`.gitignore` patterns** for the new file names.
8. **`SetConsent` returning false** has no UI handling: `ConsentModal.tsx` only logs on success and
   `frontend/index.tsx:112` ignores the result. The plan only asks for the result to be returned.
9. **Stale `AGENTS.md` and `backend/AGENTS.md`** after stage 2.
10. Still waiting on Tim from the session: the two draft CHANGELOG entries for stage 1 (crash-safe
    saves and unreadable files), and whether Gratitude's log contents (account IDs and licence
    names) should be tracked as separate work.
