# Research and implementation notes: Gratitude bugs in the live Steam client

**Date**: 2026-10-18  
**Companion to**: [plan-steam-bugs.md](plan-steam-bugs.md)

This document records what the research for the Steam bugs plan found, the evidence behind each
finding, and the detail that whoever writes the spec and the code needs. The plan says what we are
fixing and why. This document covers how Millennium v3.6.1 and Gratitude actually behave in the
live Steam client, which claims are confirmed and which are inferred, and how to observe and
reproduce each bug.

**How to read the citations.**

- Gratitude paths are relative to the repo root, read on branch `feat/config-storage` (d1ae411)
  on 2026-10-18.
- Millennium paths are relative to
  [SteamClientHomebrew/Millennium at tag v3.6.1](https://github.com/SteamClientHomebrew/Millennium/tree/v3.6.1)
  (commit 401d5325), the version installed on Tim's machine. Millennium's `main` branch was six
  commits ahead on 2026-10-18, and none of those commits touch page injection, shutdown or plugin
  config.
- Steam's logs are in `~/.local/share/Steam/logs/`. The main one is `console-linux.txt`. Its
  times are NZ local time (NZDT, UTC+13) as Steam prints them, and its line numbers are as of
  2026-10-18 20:40; they move as Steam appends.
- Claims reasoned from source but not run are marked **(inferred)**. Nothing here has been
  confirmed live in Steam with DevTools yet. Confirming the two main causes live is the plan's
  first step.
- The findings come from a `/research` agent run on 2026-10-18, plus a second agent that read
  Millennium's GitHub issues and pull requests. The claims each decision rests on were re-read in
  source and logs when this document was written. Facts about Millennium's GitHub issues, pull
  requests and security settings come from the second agent's reading on 2026-10-18 and were not
  re-read.

## Overview

**The Store hang is Gratitude's, and the fix is small.** When it loads, Gratitude's backend
registers two hooks with an empty script path (`backend/main.lua:748-749`). For every Store and
Community page, Millennium then adds a module script tag pointing at the root of its own themes
folder. On Linux that folder exists and is empty. Millennium answers the request for that script
itself: reading the folder as a file throws, Millennium only logs the exception, and the request
is never answered. The page therefore sits at readyState "interactive" forever. Steam's log has that
exact exception 28 times, only while Gratitude is loaded. The hooks were a workaround for a
Millennium bug that Tim's own upstream commit fixed in v3.3.0. On current Millennium they add
nothing except the broken tag, so the fix is to skip them on 3.3.0 and later. It still needs
confirming live, by removing only the hooks.

**The quit hang is Millennium's, very likely issue 931.** None of the 12 quits since Millennium
was installed on 2026-10-17 exited by itself, two of them with no plugin loaded. The three quits
before Millennium was installed exited normally. Millennium's own unload code never starts, and
issue 931's backtrace shows a deadlock in Millennium's exit path that the v3.6.1 source still
has. Gratitude can neither cause nor fix it, so the deliverable is evidence for issue 931.

**A Millennium security matter** came out of the config question, kept in the untracked `docs/llm/active/private-security-notes.md` until Tim has told Millennium privately.

**The two smaller carried items have causes.** App ID detection takes the first game image in
the whole Steam window, which is usually a sidebar icon rather than the game page's own art.
Millennium's uninstall first disables the plugin, which reloads the Steam UI, so the page that
was about to show the "delete saved settings" prompt is gone before it can.

## Research findings

### 1. The Store never finishes loading

#### How Millennium v3.6.1 gets a plugin's webkit script into a Steam page

Millennium has two separate mechanisms, and Gratitude currently uses both.

- **Automatic injection, the normal path.** `plugin_loader::setup_webkit_shims`
  (`src/engine/plugin_loader.cc:298-321`) records every enabled plugin's
  `.millennium/Dist/webkit.js`. The webkit world manager discovers page targets and attaches to
  each one that qualifies. On attach it enables Runtime and Page, bypasses the page's CSP,
  registers its API shim with `Page.addScriptToEvaluateOnNewDocument`, and reloads top level
  Steam-owned pages once (`src/engine/plugin_webkit_world_mgr.cc:100-180`, `:247`, `:264`).
  Steam's log marks that reload with "webkit_world_mgr: reloaded page for session ...
  (top-level target)". Which URLs qualify is decided by `target_url::allows_webkit_injection`
  (`src/engine/target_url.cc`). Steam-owned hosts always qualify, and any other URL qualifies
  when a hook's regex matches it.
- **Hooks from `add_browser_js` and `add_browser_css`.** A Lua call goes through the Lua host's
  RPC (`src/lua_host/api/millennium.cc:220-237`) to `plugin_loader.cc:662-678`, which calls
  `theme_webkit_mgr::add_browser_hook` (`src/bindings/webkit.cc:126`). Millennium pauses every
  Document response on Steam domains with the DevTools `Fetch` domain. When a hook's regex
  matches the page URL, `mime_doc_request_handler` reads the response body and inserts, before
  `</head>`, a `<link rel="modulepreload">` and a
  `<script type="module" src="https://millennium.host/v1/themes/<path>">`
  (`src/engine/http_hooks.cc:217-279`, `apply_user_webkit_hooks` at `:282`;
  `src/include/millennium/http_hooks.h:116-119`).

**Why Gratitude has hooks at all.** Upstream commit 39574983 (2026-06-04, first released in
v3.2.0 on 2026-06-05) limited automatic injection to URLs that `is_valid_target_url` allowed, but
left Steam's own domains off that list. Store and Community pages then only qualified when a
hook's regex matched them. Gratitude's empty-path hooks, added on 2026-06-14 in commit 9150748,
used exactly that rule: the regex makes the page qualify, and the empty path was meant to add
nothing. Tim's upstream commit 84d9122 ("fix: WebKit injection of Steam URLs", 2026-06-13) put
the Steam domains back. Its first releases were v3.3.0-beta.2 and stable v3.3.0 (2026-06-23).
Checked with `git tag --contains` on both commits:

- releases without automatic injection on Steam pages: v3.2.0, v3.2.1-beta.1 and
  v3.3.0-beta.1. v3.2.0 is the only stable one.
- releases before v3.2.0 injected into any URL, Steam's included, according to 84d9122's commit
  message.
- on v3.3.0 and later, the world manager injects Gratitude's webkit script into Store and
  Community pages without the hooks. The hooks don't add a second copy of the script, because
  all they add is the themes-folder script tag.

#### What the empty path does

1. `apply_user_webkit_hooks` builds the script address from `m_themes_url` plus the encoded path
   (`http_hooks.cc:301`). With an empty path, the address is `https://millennium.host/v1/themes/`.
2. The page's request for that address is itself intercepted and answered from disk by
   `vfs_request_handler`. `path_from_url` maps it to `<steam>/millennium/themes/`
   (`http_hooks.cc:113-124`). On Tim's machine that is `~/.local/share/Steam/millennium/themes/`,
   an existing, empty directory.
3. On Linux, `std::ifstream` opens a directory without failing, so the handler skips its "not
   found" branch (`http_hooks.cc:174-178`). Reading it through `istreambuf_iterator`
   (`http_hooks.cc:195`) then throws `std::ios_base::failure` with "basic_filebuf::underflow
   error reading the file: Is a directory". A ten-line g++ program run against the real directory
   reproduced that exact message.
4. The exception escapes to the `Fetch.requestPaused` callback, which only logs `ex.what()`
   (`http_hooks.cc:328-344`). Nothing calls `Fetch.fulfillRequest` or `Fetch.continueRequest`
   for that request, so it stays paused.
5. A `type="module"` script in the page's HTML is deferred. The parser finishes and readyState
   becomes "interactive", then the browser waits for the module before it fires
   DOMContentLoaded and load. With the request paused, neither event ever fires. Any Store
   start-up code that waits for those events never runs, which would include whatever builds the
   "Featured and Recommended" carousel **(inferred**: the carousel code wasn't read; the
   readyState "interactive" observation from 2026-10-17 fits).

Two smaller facts about the same path:

- Millennium's callbacks for DevTools events run on a pool of four threads
  (`src/engine/cdp_api.cc:39`), and its requests time out after 30 seconds
  (`src/include/millennium/cdp_api.h:73-80`). Any exception in the `Fetch.requestPaused` callback
  leaves that request hanging, whatever the cause.
- When any hook matches, Millennium also adds its "RootColors" and slider CSS as inline styles to
  the page (`http_hooks.cc:304-308`). Removing Gratitude's hooks removes those from Store and
  Community pages. Without a theme installed they are probably empty **(inferred)**.

#### Evidence in Steam's log

- **28 occurrences.** `console-linux.txt` has 28 lines of "basic_filebuf::underflow error
  reading the file: Is a directory". All 15 Steam sessions in which Gratitude loaded have at
  least one. Most come less than a second after a "reloaded page" line (0.3 to 0.8 seconds in
  the cases checked). Some sessions have more errors than reloads, so the rest presumably come
  from later page loads in the same session **(inferred)**.
- **None without Gratitude.** The 2026-10-17 session that started at 01:10:50 logged "Enabled
  Plugins: 0", reloaded two pages and logged no error.
- **Two controls within one session.** The 2026-10-17 session that started at 01:20:34 began
  with no plugin enabled: two reloads, no error. Gratitude was enabled at 01:22:17, and the next
  reload was followed by the error at 01:22:24. The 2026-10-18 session that started at 10:20:22
  did the same after the uninstall test: reloads at 10:20:29 and 10:20:32 with no error,
  Gratitude enabled at 10:22:00, a reload at 10:22:06 and the error at 10:22:07.
- **Not every reload errors.** In several sessions two pages reload a few seconds apart and only
  one error follows, for example reloads at 11:13:19 and 11:13:23 and one error at 11:13:24. The
  log line names only a session ID, not a URL, so which pages these were is unknown. The one
  without an error is probably a Steam-owned page that matches neither hook regex
  **(inferred)**. The live observer should record each page's URL.

#### The themes folder decides whether a page hangs

- `~/.local/share/Steam/millennium/` and its `themes/` folder were both created at 2026-10-17
  01:10:50, the start of the first Steam session with Millennium. Millennium's library had been
  installed 14 seconds earlier (`/usr/lib/millennium/libmillennium_x86.so`, 01:10:36). So
  Millennium or its installer creates the empty folder on first start **(inferred from the
  timestamps; no code that creates it was found in the v3.6.1 source)**.
- If the folder were missing, `ifstream` would fail to open, the handler would answer 404 with
  an empty body, and the module would simply fail to load, so the page would finish loading
  **(inferred** from `http_hooks.cc:174-178`; the same g++ program showed that a missing path
  gives `is_open=0` and reads zero bytes without throwing).
- The hang therefore needs the folder to exist as a directory. That probably holds for every
  Linux install **(inferred)**. How `ifstream` treats a directory on Windows was not checked.
- v3.2.0's `http_hooks.cc` has the same themes mapping and the same read, so why the hooks didn't
  visibly hang the Store when they were added in June is unknown. One possibility is that the
  machine used then had no themes folder, or wasn't running Linux.

#### Why Gratitude's webkit script sometimes didn't run

On Steam web pages, Millennium's browser loader awaits `appendAccentColor` before it injects
any plugin's webkit script (`src/typescript/sdk/src/index.ts:119-134`). That function waits for
the document (`src/typescript/sdk/src/browser-init.ts:3-19`): if readyState is still "loading"
when it checks, it waits for DOMContentLoaded, which never fires on a hung page. If it checks
after the parser has finished, it carries on. So on a hung page, whether Gratitude's webkit
script starts at all is a race **(inferred)**. That fits the 2026-10-17 observation, where a
Store page opened with a `steam://openurl` link stayed "interactive" and no licence sync ran
until the page was reloaded.

#### What was ruled less likely

Gratitude's webkit startup blocks nothing. `WebkitMain` (`webkit/index.tsx:12-28`) reads the
account ID and starts the licence and friends syncs without awaiting them, and both are plain
`fetch` calls in the background. The licence cache drops its licence count at load (a separate,
out of scope bug), so the first Store visit after each restart runs a full licence sync. That
sync is a series of background fetches and is unlikely to stall the page, though this is
inferred rather than shown.

#### Upstream issues

The GitHub agent found no issue about Store pages hanging with plugins, `add_browser_js`,
readyState, or a missing carousel. The closest, all closed:

- [issue 665](https://github.com/SteamClientHomebrew/Millennium/issues/665) (2026-03, Windows):
  a Community page loading forever, with store widget iframes requesting `millennium.js`
  repeatedly. The reporter fixed it with a reinstall.
- [issue 782](https://github.com/SteamClientHomebrew/Millennium/issues/782) (closed 2026-06-24):
  Cloudflare checks looping in the Steam browser. Fixed by ae7cfff (3.2.0), which limited
  interception to Document responses on Steam domains, and ac80fe5 (3.3.1).
- [issue 785](https://github.com/SteamClientHomebrew/Millennium/issues/785) (fixed in v3.2.0):
  Store and Community pages appearing offline with Millennium.

### 2. Steam hangs on quit

#### Every quit on record

All quits since Millennium was installed, from `console-linux.txt` and `bootstrap_log.txt`.
"Killed" means `steam.sh` logged the client being killed with SIGKILL.

| Shutdown logged | Plugins loaded at the time | How it ended |
| --- | --- | --- |
| 2026-10-17 01:11:11 | None ("Enabled Plugins: 0") | Killed at 01:20:12, about 9 minutes later |
| 2026-10-17 01:26:55 | Gratitude | Killed at 01:29:37 |
| 2026-10-17 13:55:59 | Gratitude | Killed at 14:07:06, about 11 minutes later |
| 2026-10-18 09:47:56 | Gratitude | Killed at 09:49:59 |
| 2026-10-18 09:53:18 | Gratitude | Killed at 09:57:05 |
| 2026-10-18 10:03:14 | Gratitude | Killed at 10:04:15 (61 seconds) |
| 2026-10-18 10:09:53 | Gratitude | Aborted on heap corruption at 10:10:35, core dumped |
| 2026-10-18 10:19:09 | None: Gratitude disabled by the uninstall at 10:12:48 | Killed at 10:20:10 (61 seconds) |
| 2026-10-18 10:23:34 | Gratitude | Killed at 10:24:35 (61 seconds) |
| 2026-10-18 11:11:16 | Gratitude | Killed at 11:12:17 (61 seconds) |
| 2026-10-18 19:25:26 | Gratitude | Killed at 19:26:27 (61 seconds) |
| 2026-10-18 19:51:28 | Gratitude | GNOME session crashed at 19:51:58; the client was gone by 19:52:19 |

The 61 second kills follow the 60 second cut-off already in use on 2026-10-18. Before Millennium
was installed, Steam quit three times on 2026-10-17 (01:04:56 for an update relaunch, 01:06:54
and 01:07:05), and none needed a kill. That is a small control, but it points the same way as
the two hangs with no plugin loaded.

The 10:19:09 hang adds a second case with no plugin loaded. Gratitude had been loaded earlier in
that session, then disabled and its folder deleted by the uninstall test at 10:12:48 to 10:12:51.
The log shows no plugin enabled again before the quit.

#### What issue 931 says

[Millennium issue 931 "Steam Hangs On Exit"](https://github.com/SteamClientHomebrew/Millennium/issues/931)
is open with label `bug`, no assignee and no maintainer reply as of 2026-10-18. As summarised by
the GitHub agent:

- **ixalsera (2026-10-14), the original report:** CachyOS, Millennium v3.6.1, all plugins and
  themes disabled. Steam logs Shutdown and hangs forever; SIGTERM is ignored and only SIGKILL
  works.
- **undertakerazoth (2026-10-15):** Arch, diagnosed on a clean 3.5.0 with no plugins enabled.
  Their GDB trace has the main thread in `exit()`, then `~millennium_lifecycle`, then
  `pthread_cond_destroy`, while another thread waits on `millennium_lifecycle::get().terminate.cv`
  in `socket_utils::connect_socket()`. They blame function-local statics created on Millennium's
  worker thread after the bootstrap registered its `atexit` handler, so the statics are destroyed
  before `StopMillennium()` runs. They attached an unofficial AI-assisted patch, which the agent
  did not download or run.
- **electrobluesky (2026-10-17):** same symptom, plugins disabled, and it blocks PC shutdown.
  Their full backtrace has the main thread in `exit()`, then the bootstrap's `atexit` handler,
  then `StopMillennium`, then `std::thread::join`. The worker thread is in
  `PluginProcess::~PluginProcess` (sleeping), interrupted by a signal handler in
  `libmillennium_x86.so` that calls `exit()`, which blocks in `__lll_lock_wait_private`. The
  agent read this as a deadlock: the main thread holds glibc's exit lock while it waits to join
  the worker, and the worker waits for that lock **(inferred by the agent)**.
- **kajoken (2026-10-17, a contributor):** same hang; uninstalling Millennium fixes it.

#### The same mechanism in v3.6.1, and how Tim's logs match it

- `millennium_lifecycle::get()` returns a function-local static
  (`src/include/millennium/millennium_lifecycle.h:66`). A terminate watcher thread in the
  DevTools connector waits on its `terminate` condition variable
  (`src/engine/cdp_connector.cc:332-345`).
- The Linux bootstrap registers `proxy_at_exit_handler` with `atexit` after starting Millennium
  (`src/bootstrap/linux/libmillennium_bootstrap.c:176`). That handler calls `StopMillennium`
  (`src/platform/posix.cc:86-99`), whose first action is to log "Unloading Millennium...".
- **"Unloading Millennium..." never appears after any Shutdown in Tim's log.** That matches the
  first trace: the main thread is stuck destroying the static before the `atexit` handler that
  would call `StopMillennium` runs. Millennium's plugin shutdown, the only step a plugin could
  slow down, comes after that and never starts.
- In 7 of the 9 quits with Gratitude loaded that ended in a kill or an abort, the Lua host's
  buffered banner "Gratitude plugin loaded" appears in the log at the kill's timestamp. The Lua
  host only exits, and flushes its output, when the client dies.
- The only signal handler in Millennium outside the Lua host is for SIGINT, which calls
  `std::exit` (`src/platform/posix.cc:65`). Why SIGTERM is ignored wasn't traced. A handler that
  calls `exit()` while `exit()` is already running would block on glibc's exit lock, which would
  explain it **(inferred)**.
- Seen on 2026-10-17 during one hang (from notes taken at the time): 26 of the client's 33 threads
  were waiting on locks (`futex_do_wait`), and Millennium's two libraries were loaded.

#### What a plugin can add to shutdown

Even once Millennium's shutdown does run, a Lua plugin's effect is bounded:

- `backend_manager::shutdown` (`src/engine/backend_mgr.cc:86-118`) sends SHUTDOWN to every plugin
  in parallel, each with a 5 second timeout (`src/engine/child_process.cc:234-243`).
- `PluginProcess::~PluginProcess` (`child_process.cc:122-176`) then sends SIGTERM if the child is
  alive, polls for 3 seconds, sends SIGKILL and waits (`:149-154`).

So a plugin can delay Millennium's exit by about 8 seconds at most, and only after
`StopMillennium` has started, which Tim's hangs never reach.

#### PR 937 and PR 938

- [PR 937 "fix(posix): reap exited plugin children during shutdown"](https://github.com/SteamClientHomebrew/Millennium/pull/937)
  (Adiker, 2026-10-15, open, no reviews, no CI run). `~PluginProcess` checks `kill(pid, 0)`,
  which still succeeds for a child that has exited but not been reaped, so every stop waits the
  full 3 seconds. The PR checks with `waitpid(pid, WNOHANG)` instead. The author measured plugin
  shutdown going from 18012 ms to 601 ms with six plugins. It does not mention issue 931.
- **The 3 second delay shows in Tim's log.** Five of the six live disables of Gratitude took
  3.005 to 3.009 seconds from "Stopping plugin 'gratitude'..." to "Successfully unloaded
  gratitude" (2026-10-17 at 14:45:34, 14:50:39, 14:52:51 and 18:09:10; 2026-10-18 at 10:12:48).
  Gratitude's `on_unload` logged "Plugin unloaded" within a millisecond of each stop, so the
  host answered promptly and the wait was Millennium's **(inferred, matching PR 937's
  description)**. The sixth, at 14:41:33 on 2026-10-17, took a millisecond, because its Lua host
  had already been killed in a mid-sync test.
- [PR 938 "fix: prevent shutdown deadlocks and logger races"](https://github.com/SteamClientHomebrew/Millennium/pull/938)
  (same author, 2026-10-15, open, no reviews). It says "Related to #931 ... not confirmation of
  the exact cause". It turns eight shutdown-time singletons, `millennium_lifecycle` among them,
  into heap objects that are never destroyed, and makes pending DevTools requests fail before
  their worker threads are joined. Its author reports v3.6.1 with PRs 937 and 938 exiting cleanly
  twice.
- No commit on `main` or `next` since v3.6.1 touches shutdown. The repo's CI only runs on manual
  trigger, so neither PR has CI results.
- Older related issues, all closed: [756](https://github.com/SteamClientHomebrew/Millennium/issues/756)
  (a shutdown hang on Arch whose log happens to show a Gratitude hook; the maintainer said to use
  the latest beta), [667](https://github.com/SteamClientHomebrew/Millennium/issues/667) (a hang
  with any plugin enabled, fixed in the 3.0.0 betas), and 810 and 811 (orphaned Lua helper
  processes on Windows, fixed in v3.3.0-beta.2).

#### The quit that aborted

The 10:09:53 quit, first recorded as exiting by itself after 43 seconds, actually aborted. glibc
logged "corrupted double-linked list" at 10:10:35 (`console-linux.txt:9093`), and `steam.sh`
logged "Aborted (core dumped)" at 10:10:36 (`:9097`). Steam uploaded a minidump, and a copy is
in `/tmp/dumps/crash_20261018101035_47.dmp`, which a reboot may clear. A rough scan of the
crashing thread's stack (no symbol server, module names only) shows mostly PulseAudio libraries
and libc, with single frames from `libmillennium_x86.so`, Steam's `libaudio.so` and
`steamui.so`. That is where the corruption was noticed, not necessarily where it happened, and
its link to issue 931 is unknown.

#### Does the Lua host outlive the client?

This bears on the plan's open question 3.

- Millennium starts each Lua host with `PR_SET_PDEATHSIG` set to SIGHUP
  (`src/engine/child_process.cc:617-619`). The host's SIGHUP handler exits if its parent has
  changed (`src/lua_host/main.cc:606-612`). Separately, when the socket to the client closes, its
  event loop ends, calls `on_unload` and returns (`main.cc:959-970`).
- While the client hangs, the Lua host stays alive: it was still running two minutes after the
  2026-10-17 13:55:59 Shutdown.
- When the client was killed, the banner evidence above shows the host exiting at the same
  moment. On 2026-10-18, killing the client alone also ended the host.
- No observation so far shows a Lua host surviving a killed client. The plan's wording that it
  "has outlived the client before" appears to rest on the 13:55:59 case, where the client was
  still alive.

#### The GNOME session crash

From notes taken at the time and the kernel log: 30 seconds into the hung 19:51:28 quit, the amdgpu
driver logged a page fault and a GPU ring timeout in `gnome-shell` at 19:51:58, the ring reset
failed, and the GNOME session died. The machine stayed up. Afterwards Steam couldn't be started
from a shell opened in the old session ("Unable to open X11 display" at 19:52:45,
`console-linux.txt:10286-10287`). It started at 19:53:57 once launched with the new session's
X authority file. Whether Steam had anything to do with the crash is not established. The GitHub
agent found no Millennium issue mentioning amdgpu, GNOME or Wayland.

#### Inspecting a hung client

- Each thread's name, state and kernel wait point can be read without privileges from
  `/proc/<pid>/task/<tid>/comm`, `stat` and `wchan`. `/proc/<pid>/syscall` is not permitted.
- `gdb` is installed, and `libmillennium_x86.so` is not stripped (3,488 dynamic symbols), so a
  backtrace would name Millennium's functions.
- `/proc/sys/kernel/yama/ptrace_scope` is 1, which blocks attaching to a process that isn't a
  descendant. A backtrace needs `sudo gdb -p <pid> -batch -ex 'thread apply all bt'`, which is
  Tim's to run. Launching Steam from a script that later replaces itself with gdb would keep gdb
  an ancestor and might avoid sudo **(inferred, untested)**.

### 3. A Millennium security question

Details are kept in the untracked `docs/llm/active/private-security-notes.md` until Tim has told Millennium privately.

### 4. App ID detection picks another app

- `detectAppId` (`frontend/utils/dom.ts:68-79`) tries three strategies in order over the whole
  window document: a `[data-appid]` attribute, link `href`s, then image `src`s. `GiftBadge`
  calls it once when it mounts (`frontend/components/GiftBadge.tsx:111-116`).
- `getAppIdFromImages` (`dom.ts:49-66`) returns the first `img[src]` whose address matches
  `/(apps|assets)/<digits>/`.
- `webhelper_js.txt` has 15 detections from 2026-10-17 to 2026-10-18, every one from the image
  strategy. Values: 1361210 (Warhammer 40,000: Darktide) nine times, 10500 twice, 364360 twice,
  345260 once and 214950 once.
- Two of those lines include the matched file, `/assets/214950/08ae0b....jpg` and
  `/assets/364360/918a2a....jpg`. Steam's `steamui_librarycache.txt` shows these hash-named files
  are app icons: it logs 345260's as "asset type Icon", and Total War: WARHAMMER III's (1142710)
  own icon is `6db17b....jpg`.
- **Cause (inferred):** the library sidebar's game icons come before the game page's hero and
  logo images in document order, so the first sidebar icon wins. The answer is only right when
  that icon happens to be the current game's, which fits Darktide being detected correctly while
  the other IDs belong to games near WARHAMMER III in the sidebar.
- **Live check:** on the WARHAMMER III page, list the matching images in document order and note
  which container each sits in (see Implementation notes).
- **An unverified lead.** Steam's DevTools target list on 2026-10-18 showed a page whose URL
  carried the library route, ending `/library/app/1361210`. The current route may be a more
  reliable source for the app ID, but this wasn't investigated.

### 5. The missing "delete saved settings" prompt on uninstall

- `PluginComponent.uninstallPlugin` (`src/typescript/frontend/settings/plugins/PluginComponent.tsx:84-114`)
  asks to confirm, calls `Core_UninstallPlugin`, then calls `PluginConfig_GetAll` and asks
  "Do you want to delete saved settings for ...?" if the plugin has config keys. Errors there are
  swallowed silently.
- `plugin_installer::uninstall_plugin` (`src/bindings/plugin_mgr.cc:74-99`) first disables the
  plugin if it is enabled (`:81`). That call uses the default `reload_frontend = true`
  (`src/include/millennium/plugin_loader.h:62`), which ends in `inject_frontend_shims(true)` and
  a `Page.reload` of the Steam UI page (`src/engine/plugin_loader.cc:1110-1167`, reload at
  `:459`).
- Timeline on 2026-10-18: "Opting to disable gratitude" at 10:12:48.231, "Successfully unloaded
  gratitude" at 10:12:51.238, the plugin folder deleted at 10:12:51.240, and Millennium's
  frontend logging its start-up again in `webhelper_js.txt` at 10:12:53.
- The page waiting for `Core_UninstallPlugin`'s result is the page that was reloaded, so the
  prompt code never ran **(inferred from the order of events)**. `PluginConfig_GetAll` itself
  works: it returns the config object (`src/bindings/entry_point.cc:761`).
- Uninstalling a plugin that is already disabled skips the disable, so the prompt should appear
  **(inferred)**. That is a cheap test, but only on a normal, non-symlinked install.
- No upstream issue covers it. [Issue 857](https://github.com/SteamClientHomebrew/Millennium/issues/857)
  (Windows uninstaller leaving folders) and 911 (a broken link after uninstall) are related but
  different.

### 6. The account with over 256 KB of old gift records

This is what the source says happens today. It hasn't been observed live.

- At load, `config_store.migrate` (`backend/lib/config_store.lua:108-159`) copies each account
  from the old file that has no config key, through `copy_missing` (`:80-92`). For an account
  over the limit, `config_store.save` refuses with "size_limit" (`:45-76`), so the copy fails,
  but the account's data still goes into memory. Its badges and gift modal therefore show its
  gifts.
- Because one account is still missing from config, the old file is never retired. The copy is
  retried and refused at every Steam start, each time logging "Config value ... not saved: N
  bytes is over the limit".
- The store runs in config mode with every account editable, so an edit saves the account's
  whole value to config. That save is refused with "size_limit" unless the edit alone brings the
  account under 256 KB. The modal then shows: "Couldn't save: this account's gift notes have
  reached Millennium's storage limit. Shorten or remove some notes."
  (`frontend/utils/giverSave.ts:6`).
- A delete also saves the whole account, so it succeeds only if that one delete brings the
  account under the limit **(inferred)**. The message's advice works one edit at a time, and
  only when that edit's result fits.

### 7. Watching Steam's pages over DevTools

- **The endpoint.** In dev mode, Steam's Chromium exposes DevTools at `http://127.0.0.1:8080`.
  `/json/version` gives the browser's WebSocket address, and `/json/list` lists page targets. The
  browser is Chrome 126.0.6478.183, protocol 1.3. Node v24.12.0 is installed and has a built-in
  `WebSocket`, so scripts need no packages.
- **The targets.** With Steam on the Library, the list holds `SharedJSContext`
  (`https://steamloopback.host/index.html...`, where Gratitude's frontend runs), the main window
  titled "Steam", menus and supernavs. There is no Store target until the Store is opened.
- **The existing scripts** in [steam-test-tools/](steam-test-tools/):
  - `cdp_console.mjs <webSocketDebuggerUrl>` replays a page's console, filtered to `[Gratitude]`,
    and reads readyState.
  - `cdp_peek.mjs <webSocketDebuggerUrl>` reads readyState, the body text length, the sync
    overlay's text and whether `#application_config` exists.
  - `kill_mid_sync.sh <steam|luahost> [timeout]` watches `console-linux.txt` and SIGKILLs the
    target as the third licence page save begins.
  - `check_data_files.sh <snapshot>` checks that every store file parses and which were
    rewritten, printing no contents.
  - Both DevTools scripts need the target's debugger address pasted in by hand. Neither finds
    pages by URL, watches network traffic, records load events or takes screenshots.
- **What a hung Store load should look like:** a request for
  `https://millennium.host/v1/themes/` that never finishes or fails, readyState "interactive",
  no DOMContentLoaded or load event, and the "Is a directory" line in `console-linux.txt` within
  a second of the reload.
- **Two things a test client must never do:** turn on request interception (`Fetch.enable`),
  which would pause requests alongside Millennium's own interception; or auto-attach with
  `waitForDebuggerOnStart`, which stalls new pages until resumed.
- **Screenshots:** `Page.captureScreenshot` needs a timeout, because hidden views may never
  produce a frame.

## Technical context

### Gratitude files involved

- `backend/main.lua:735-753` holds `on_load`. It already calls `millennium.cmp_version` (to log
  a comparison against 2.29.3), then registers the two hooks at `:748-749` under a TODO naming
  commit 84d9122.
- `webkit/index.tsx` is the webkit script. `maybeSyncLicenses` (`:123`) runs only on
  `https://store.steampowered.com` and skips when the licence count is unchanged;
  `maybeSyncFriends` (`:248`) runs only on `https://steamcommunity.com`, on every visit. With
  `gratitude_sync=1` in the URL, each shows a progress overlay (`:307-370`) and, when done,
  returns to the Library with `steam://open/games`.
- The sync links Gratitude's own buttons open, all through `window.open("steam://openurl/...")`:
  - `frontend/components/ConsentModal.tsx:41`, the consent dialog's Allow button (Store);
  - `frontend/index.tsx:113`, the settings panel's Grant Permission button (Store);
  - `frontend/components/GiftBadge.tsx:168`, the badge shown when licence data isn't found
    (Store);
  - `frontend/components/GiverModal.tsx:262`, the gift modal's friends refresh (Community).
- `frontend/utils/dom.ts` holds app ID and game name detection; `frontend/types.ts` holds the
  DOM selectors.
- `tools/lua_test_support.lua` stubs the `millennium` module for the Lua tests (`:239-265`). Its
  `version()` always returns "v3.6.1", its `cmp_version` compares numbers only, and its
  `add_browser_js` records nothing. `env.start_backend()` loads `backend/main.lua` and calls
  `on_load` (`:498-504`). `npm run test:lua` runs every `tools/test_*.lua` with LuaUnit.

### Millennium files involved

| File | What it does here |
| --- | --- |
| `src/engine/http_hooks.cc` | Intercepts Steam page loads, applies hooks, and answers `millennium.host` requests from disk |
| `src/include/millennium/http_hooks.h` | Defines the themes address and how hooks become preload and script tags |
| `src/engine/plugin_webkit_world_mgr.cc` | Attaches to Steam pages, adds the backend binding, injects plugin webkit scripts, reloads the page |
| `src/engine/target_url.cc` | Decides which URLs get webkit injection and which are safe for hooks |
| `src/engine/plugin_loader.cc` | Collects plugin webkit scripts, handles Lua RPCs such as `add_browser_js` and `cmp_version`, and enables or disables plugins |
| `src/engine/ffi_binder.cc` | Handles binding calls from pages |
| `src/engine/core_ipc.cc` | Routes backend and plugin config calls |
| `src/engine/child_process.cc` | Starts and stops each plugin's Lua host process |
| `src/engine/backend_mgr.cc` | Shuts plugins down in parallel and disables single plugins |
| `src/include/millennium/millennium_lifecycle.h` | The function-local static at the centre of issue 931 |
| `src/platform/posix.cc` | `StartMillennium`, `StopMillennium` and the SIGINT handler |
| `src/bootstrap/linux/libmillennium_bootstrap.c` | Loads Millennium into Steam and registers the `atexit` handler |
| `src/lua_host/main.cc` | The Lua host's main loop, SHUTDOWN handling and parent death handling |
| `src/bindings/plugin_mgr.cc` | Uninstall: disable, then delete the plugin folder |
| `src/typescript/sdk/src/browser-init.ts` | The browser loader's wait for the document |
| `src/util/semver.cc` | The comparison behind `millennium.cmp_version` |

### Tim's machine

- Ubuntu 24.04, GNOME on Wayland, AMD GPU. Millennium v3.6.1 is at `/usr/lib/millennium/`
  (`libmillennium_x86.so`, `libmillennium_luavm_x86`), installed on 2026-10-17 at 01:10.
- Millennium's settings, including plugin config, are in `~/.config/millennium/config.json`.
  The enabled plugin list is the array `plugins.enabledPlugins`, currently `["gratitude"]`.
  Gratitude's gift records are in the same file under `plugins.gratitude.config`, so never print
  the file.
- Gratitude is installed as a symlink, `~/.local/share/millennium/plugins/gratitude`, pointing
  at the main checkout.
- Steam (Dev Mode) is started with `gtk-launch steam-dev`. After a desktop session restart, read
  the new display settings with `systemctl --user show-environment` and launch with that
  `XAUTHORITY`.
- Tim's user is in the `adm` group, so `journalctl -k` reads the kernel log without sudo: it
  returned 50 amdgpu lines for 19:51:50 to 19:52:10 on 2026-10-18.
- Steam writes minidumps to `/tmp/dumps/`.

## Decisions and rationale

### Fix the Store by skipping the hooks on Millennium 3.3.0 and later

The hooks exist for one reason: on v3.2.0, Store and Community pages only qualified for webkit
injection when a hook's regex matched them. From v3.3.0, Steam's domains qualify by themselves,
so on the version Tim runs, and on every release since June, the hooks contribute only the broken
script tag. Skipping them removes the tag, the paused request and the hang, while the world
manager keeps injecting Gratitude's webkit script exactly as it does now. The licence sync, the
friends sync and the explicit sync links all run from that webkit script, so they keep working,
though that is the first thing the live check must confirm.

The gate has to be a version comparison. A Lua plugin has no way to ask Millennium whether it
injects into Steam pages itself, but `millennium.cmp_version` exists and `on_load` already calls
it. Keeping the hooks with a harmless path (see the next section) might also stop the hang, but
on 3.3.0 and later any hook is redundant, so removing them there is simpler.

### What below 3.3.0 should do is still Tim's call, and the facts have sharpened

The plan proposes keeping today's hooks below 3.3.0 (open question 4), so nothing changes on
versions that can't inject the script themselves. Two findings bear on that choice and should go
to Tim with it.

First, "below 3.3.0" is broader than the versions that need the hooks. Only v3.2.0, among stable
releases, lacked injection on Steam pages. Releases before v3.2.0 injected into any URL,
according to 84d9122's commit message. Whether Gratitude runs on those older releases at all
wasn't checked.

Second, the hang comes from the empty path, not from having a hook. A hook whose path names a
file that doesn't exist in the themes folder should get a 404 instead of an exception. The page
would then log a failed module load but finish loading, while the regex still makes the page
qualify for injection on v3.2.0 **(inferred from `http_hooks.cc:174-178` and the g++ test,
untested in Steam)**. If Tim wants the hooks kept on v3.2.0, that variant might keep the syncs
working there without the hang, but it would need testing on a v3.2.0 install, which this plan
doesn't have.

### Prove the Store cause by removing only the hooks

The cause comes from reading source and logs, and the plan's bar is that it is shown live: the
bug reproduces with the hooks present and goes away when only the hooks are removed. A code
change that only skips the two calls is the cleanest such test, because it changes nothing else.
Renaming the empty themes folder would also test the mechanism without a code change, since a
missing folder should give a 404 instead of the exception. It changes Millennium's install
rather than Gratitude, though, so it is Tim's call and isn't needed if the code test is clear.

### Treat the quit hang as Millennium issue 931, and settle it with evidence rather than counts

Repeated quits with Gratitude enabled and disabled would settle the cause less firmly than the
evidence already in hand. Two hangs happened with no plugin loaded. The three quits before
Millennium was installed exited normally, and none of the 12 since has. Millennium's first unload
line never appears, which places the hang before the only code a plugin can affect. A backtrace
of one hung client would show directly whether the main thread sits in `~millennium_lifecycle`,
which is stronger than any number of quits. It needs debugger permission, so it is listed for
Tim. The quits the Store work causes anyway are still recorded, so the quit study costs no extra
restarts.

### The Millennium security matter is reported privately

Details are kept in the untracked `docs/llm/active/private-security-notes.md` until Tim has told Millennium privately.

### App ID detection: confirm the cause live, and fix only if Tim agrees

The cause is well supported by the logs but still inferred, so the plan confirms it live on the
WARHAMMER III page first. If Tim agrees to fix it (open question 1), the facts point to scoping
the search: look for images inside the game page's own container rather than the whole document,
or read the app ID from the library route. The route idea is unverified. A wrong ID matters less
than it looks, because the badge falls back to matching by name, but that fallback hides the
error from users, which is why the plan recommends fixing it.

### The account over 256 KB: the facts for Tim's choice

The plan leans towards a specific message rather than a file fallback (open question 2). The
source shows the user already gets the size-limit message, which tells them to shorten or remove
notes, but every edit is refused unless that single edit brings the account under the limit.
Neither option exists yet, and the case needs notes written before the 2,000 character cap, so it
is unlikely in practice. What the live check adds is confirmation of the message and the log
line, not new information for the choice.

### The uninstall prompt: draft an upstream report, retest later

The cause sits entirely in Millennium's uninstall flow, so Gratitude can't change it. The report
can rest on the source path and the 2026-10-18 log timeline. The cheap confirming test, which is
uninstalling an already disabled plugin, needs a normal install, because uninstalling the
symlinked dev install deletes the checkout. It therefore waits for Tim.

## Implementation notes

### The Store fix

A minimal shape for `on_load`, assuming the plan's default for open question 4:

```lua
-- Millennium 3.3.0 and later inject every enabled plugin's webkit script into Steam pages, so
-- these hooks are only needed on older versions. On 3.3.0 and later their empty path makes
-- Millennium read its themes folder as a file, which leaves Store and Community pages loading.
if millennium.cmp_version(millennium.version(), "3.3.0") < 0 then
    millennium.add_browser_js("", ".*store\\.steampowered\\.com.*")
    millennium.add_browser_js("", ".*steamcommunity\\.com.*")
end
```

Gotchas for the version gate:

- `cmp_version` strips a leading "v" from both arguments (`plugin_loader.cc:776-792`), and
  `millennium.version()` returns "v3.6.1". The existing log line "Comparing millennium version:
  1" shows the comparison working.
- It returns -2 when either version fails to parse (`src/lua_host/api/millennium.cc:306-323`).
  With `< 0` as the test, an unparseable version keeps the hooks, which is today's behaviour on
  that install, hang included. Whether that is the right default is a call for the spec.
- Pre-releases compare below their release under semver (`src/util/semver.cc:236-261`), so
  v3.3.0-beta.2 to beta.7 would keep the hooks although they have the fix. That changes nothing
  compared with today.
- Replace the TODO comment rather than leaving it, since the commit it waits for has shipped.
  Comments describe behaviour and never cite plan or spec IDs (AGENTS.md section 5).

### Testing it red then green

- The Lua stub in `tools/lua_test_support.lua` needs two changes: a way for a test to set the
  version `millennium.version()` returns, and a record of `add_browser_js` calls, for example on
  the env. Its `cmp_version` compares numbers only, which is enough for 3.2.0, 3.3.0 and 3.6.1,
  but doesn't model -2 or pre-releases.
- Tests that follow: no hooks on v3.6.1 and on v3.3.0; both hooks, with their exact regexes, on
  v3.2.0. The v3.6.1 test fails against today's code, which is the red step.
- There is no frontend or webkit change, so vitest is unaffected, and the log privacy check
  should stay green unchanged.
- The live reproduction is recorded failing before the change and passing after, per the plan.
- One CHANGELOG entry in the existing "Fixed" section under Unreleased, for example: "Fixed the
  Steam Store and Community pages never finishing loading while Gratitude is enabled on
  Millennium 3.3.0 and later."

### Reproducing the Store hang live

1. Back up `~/.config/millennium/config.json` and Gratitude's data files, as the plan requires.
2. Start Steam (Dev Mode) and wait for it to land on the Library. Tim's note: the hang "occurs
   after a steam restart because the landing page is the library".
3. Start an observer connected to the browser's WebSocket (from `/json/version`) with
   `Target.setDiscoverTargets {discover: true}`.
4. Open the Store with a `steam://openurl/https://store.steampowered.com/` link from a shell that
   has the desktop session's display settings, or by clicking the Store tab.
5. When a target appears whose URL starts with `https://store.steampowered.com` or
   `https://steamcommunity.com`, attach with `Target.attachToTarget {targetId, flatten: true}`.
   On that session enable `Network`, `Page`, `Page.setLifecycleEventsEnabled {enabled: true}`,
   `Runtime` and `Log`. Millennium reloads the page after attaching, so the observer normally
   catches the load that hangs.
6. Record each page's URL, every request to `millennium.host` with its finish or failure, the
   `Page.lifecycleEvent` names, and `domContentEventFired` and `loadEventFired`.
7. After a timeout, evaluate a read-only check on the page: `document.readyState`, the `src` of
   every `script[type=module]`, `performance.getEntriesByName('https://millennium.host/v1/themes/')`,
   and whether the carousel exists. The carousel's selector isn't known yet; find it on a working
   Store page with Gratitude disabled first.
8. Take a screenshot with a timeout, saved outside the repo.
9. Match the result against `console-linux.txt`: an "Is a directory" line within a second of the
   "reloaded page" line.

Then repeat with only the hooks removed (the fix above, built and loaded), and once with
Gratitude disabled, on separate restarts. The same observer works for Community pages and for the
four sync buttons, which should show the overlay and return to the Library.

### Turning Gratitude off and on for comparisons

- With Steam quit, back up `config.json`, then remove `"gratitude"` from `plugins.enabledPlugins`
  with a tool that edits only that array (for example `jq`), and restore it afterwards. Gratitude
  stays installed, and its data is untouched.
- A live disable and enable from Millennium's settings also works and reloads both the backend
  and the frontend, but each disable costs the 3 second wait from PR 937.
- Never uninstall Gratitude from Millennium's settings while it is the symlinked dev install.
  Millennium follows the link and deletes the checkout, `.git` included.

### Recording each quit

One row per quit, written as it happens so a GNOME crash loses at most the quit in progress:

| Field | Where it comes from |
| --- | --- |
| Shutdown time | The "Shutdown" line in `console-linux.txt` or `bootstrap_log.txt` |
| Gratitude enabled, and which build | `plugins.enabledPlugins` and the branch or commit built |
| How it ended | Exited by itself after N seconds, killed after the 60 second cut-off, or aborted |
| Whether "Unloading Millennium..." appeared | `console-linux.txt` after the Shutdown line |
| Whether the Lua host outlived the client | `pgrep -f '[l]ibmillennium_luavm'` after the kill |
| GPU fault nearby | `journalctl -k --since <shutdown time>` filtered for amdgpu |

Check for a running client with `pgrep -x steam`, not `pgrep -f steam`, which also matches the
command line of the shell running it. The brackets in the Lua host pattern avoid the same trap.

### Checking the security question live

Details are kept in the untracked `docs/llm/active/private-security-notes.md` until Tim has told Millennium privately.

### Checking app ID detection live

In the main Steam window's target, with the WARHAMMER III library page open:

```js
[...document.querySelectorAll('img[src]')]
  .filter((img) => /\/(?:apps|assets)\/\d+\//i.test(img.getAttribute('src')))
  .slice(0, 5)
  .map((img) => {
    const box = img.getBoundingClientRect();
    const src = img.getAttribute('src');
    return { src, left: Math.round(box.left), width: Math.round(box.width) };
  })
```

The first entry is what `detectAppId` returns. Steam's class names are hashed, so position and
size identify the container more reliably: a small image near the left edge is a sidebar icon. If
the first entry is one, and its app ID isn't the page's, the cause is confirmed. A screenshot of
the same page settles any doubt.

### Drafts for Tim to post

- **Issue 931 comment:** Ubuntu 24.04, GNOME on Wayland, Millennium v3.6.1; the quit table above,
  including the two hangs with no plugin loaded; "Unloading Millennium..." never logged after
  Shutdown; the three normal quits before Millennium was installed; the 3.005 to 3.009 second
  disable times as a data point for PR 937; and a backtrace if Tim takes one. No account IDs,
  hostnames or personal paths.
- **Private security report:** see the private notes.
- **Uninstall prompt issue:** the source path from `uninstallPlugin` through `uninstall_plugin`
  to the UI reload, and the 2026-10-18 log timeline. Search Millennium's issues again just before
  drafting, since none existed on 2026-10-18.

### Privacy while testing

- `config.json` holds Gratitude's gift records under `plugins.gratitude.config`. Read it with
  `jq` key paths or counts, never by printing it.
- Steam's own logs contain the unmasked Steam account ID (in `connection_log.txt` and `userdata`
  paths) and the machine's hostname (in target URLs). Neither goes into findings or drafts.
  Gratitude's own log lines mask account IDs, for example `****9341`.
- Screenshots stay outside the repository.

### Temporary files from the research

These are in the session's scratchpad and won't survive long; their substance is above.

- `ifs/t.cc`, the g++ program that reads a directory with `ifstream`.
- `tools/mdscan.py`, the heuristic minidump scanner.
- `att931a/report.md` and `att931b/steam.txt`, the developer report and the GDB backtrace
  attached to issue 931.

The scratchpad is
`/tmp/claude-1000/-home-tim-personalprojects-Gratitude-Millennium-Plugin/b50e29d8-0ed9-430b-9a52-df3bcb185fb6/scratchpad/`.
The Millennium v3.6.1 checkout used for this research is in another session's scratchpad,
`/tmp/claude-1000/-home-tim-personalprojects-Gratitude-Millennium-Plugin/4b852593-c6b0-41f4-b3d8-df6b767cddcd/scratchpad/millennium-src`.
Clone the tag again if either has gone.
