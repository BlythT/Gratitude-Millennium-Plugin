# Gratitude Bugs in the Live Steam Client Specification

**Plan**: [plan-steam-bugs.md](plan-steam-bugs.md)  
**Research**: [research-steam-bugs.md](research-steam-bugs.md)  
**Tracking**: local only, no GitHub issue  
**Type**: Bug Fix  
**Branch**: `fix/steam-bugs` from `feat/config-storage` (d1ae411)  
**Tasks**: 37 (phase 0: 5, phase 1: 10, phase 2: 3, phase 3: 5, phase 4: 5, phase 5: 6, final: 3)  

## Overview

Gratitude is a Millennium plugin that marks gifted games in the Steam library and lets the user
record who gave each gift. Its Lua backend owns storage, its frontend draws the "Gifted" badge and
the gift modal in Steam's library UI, and its webkit script runs on Steam Store and Community
pages to read the account's licences and friends list. This work covers bugs that only show up in
the live Steam client, on Tim's machine: Millennium v3.6.1, Ubuntu 24.04, GNOME on Wayland, AMD
GPU.

There are three problems, worked in this order:

- **The Store never finishes loading while Gratitude is enabled.** Research traced it to the two
  `millennium.add_browser_js("", ...)` hooks in `on_load` (`backend/main.lua:748-749`). Their
  empty path makes Millennium add a script tag for its own themes folder; reading the folder as a
  file throws, Millennium never answers that request, and the page waits forever. The hooks were
  a workaround for a Millennium bug fixed in v3.3.0, so once the cause is shown live, the fix
  skips them on 3.3.0 and later.
- **Steam hangs on quit.** The evidence points at Millennium issue 931, so the deliverable is a
  log of every quit, a stated conclusion and a drafted comment for that issue, not a Gratitude
  change.
- **Unknown bugs.** A sweep of library pages, the Store, Community, the gift modal and the
  settings panel with DevTools watching, recording each bug rather than fixing it. Four items
  carried over from the data storage plan are settled along the way.

Most of this runs while Tim is away, so every Steam task says whether Claude can do it alone or
needs Tim. Two untracked tools are built first, a DevTools observer and a quit and relaunch
script, so the live checks are repeatable and their evidence is consistent. Nothing is posted to
GitHub: anything for Millennium is a draft file for Tim. The only code change is the Store fix,
in one commit.

## Open questions from the plan

Tim hasn't answered the plan's five open questions. The work proceeds on the recommended option
for each and records that it did:

1. **Fix app ID detection here?** Not in this branch: the cause is confirmed live and recorded
   like a sweep finding (3.3, A3).
2. **Account over 256 KB: file fallback or message?** Facts recorded from source and tests, no
   code (3.4, A4).
3. **Kill a Lua host left running after the client is killed?** Yes, and the quit log says so
   (A5). Research found no case of it happening.
4. **Below Millennium 3.3.0: keep or drop the hooks?** Keep today's hooks below 3.3.0 and for a
   version that can't be parsed; skip them on 3.3.0 and later (A2).
5. **More sweep surfaces?** The settings panel is added (4.3). The consent dialog is added as a
   Tim check (5.1), because showing it needs stored consent removed. Big Picture Mode isn't swept
   (A6).

### New points for Tim

Found while writing this spec. The work proceeds on the stated default for each, and the findings
document's Questions for Tim section carries them for his answer.

- **N1 "Working without Tim" is treated as approved.** The arrangement was put forward in the
  plan for approval along with the rest of it, and the plan is still marked draft. This spec
  assumes approval, which also replaces the standing "ask Tim before kill -9" for this work only
  (A1).
- **N2 Clicking in the Steam UI through DevTools.** The plan's list of what Claude may do covers
  observing pages, not clicking. The Store tab path, library game pages, the gift modal, the
  settings panel and two of the four sync buttons all need a click. Default: Claude clicks
  through DevTools only where the click saves nothing; any click that saves waits for Tim (A7).
- **N3 Two sync buttons need consent state changed.** The consent dialog appears only when no
  consent is stored, and Grant Permission only when consent is stored as declined. Getting either
  means editing Gratitude's data in `config.json`, beyond the plan's permitted edit (the enabled
  plugins list), so both are Tim's (5.1).
- **N4 No "Shutdown" line after `steam -shutdown`.** The plan's hang cut-off starts at the
  Shutdown line. Default when none appears: send `steam -shutdown` once more, and if there is
  still none, record it and stop Steam work for Tim rather than killing a client that never began
  to quit (A9).
- **N5** A security matter; details are kept in the untracked `docs/llm/active/private-security-notes.md` until Tim has told Millennium privately.
- **N6 A quit and relaunch tool is added** next to the DevTools observer, so every quit is timed,
  killed and logged the same way (0.4). It is untracked tooling like the existing scripts;
  flagged because nobody asked for it.
- **N7 Removing the hooks also removes Millennium's theme colours from Store and Community
  pages.** When any hook matches, Millennium adds its "RootColors" and slider CSS to the page
  (`http_hooks.cc:304-308`). Probably empty without a theme (inferred), but a user with a
  Millennium theme may see Store pages lose its colours. Recorded in the findings as a side effect
  of the fix.
- **N8 Millennium leaves a page loading forever when a hook's file read throws.** Any plugin
  calling `add_browser_js` with an empty or folder path hits it. Not in the plan, so no upstream
  issue is drafted unless Tim wants one.

## Requirements

### Functional

- With Gratitude enabled on Millennium 3.3.0 or later, a Store page opened from Steam's Store tab
  or from a `steam://openurl` link finishes loading (A10), as it does with Gratitude disabled. A
  Community page finishes loading too.
- Steam's log no longer shows "basic_filebuf::underflow error reading the file: Is a directory"
  with Gratitude enabled.
- A Store visit still runs the licence sync and a Community visit the friends sync. The sync
  links Gratitude's buttons open still show the progress overlay and return to the Library.
- Below Millennium 3.3.0, and when the version can't be parsed, `on_load` registers the same two
  hooks as today.
- Every quit during the work is recorded, and the quit hang gets a stated conclusion and a drafted
  comment for issue 931.
- A findings document records the Store cause and evidence, the quit conclusion, an answer for
  each carried item, and one entry per sweep bug.
- Drafts for Tim: the issue 931 comment, a private security report and an upstream issue for
  the missing uninstall prompt.

### Technical

- The code change is limited to `on_load` in `backend/main.lua`, the Lua test stub and its
  self-tests, one new Lua test file and `CHANGELOG.md`. Nothing in `frontend/` or `webkit/`
  changes, so the built `.millennium/Dist/` comes from the same source before and after.
- The 223 Lua tests (`npm run test:lua`) and 98 vitest tests in 12 files (`npm test`) keep
  passing, the static log privacy check included.
- The DevTools observer uses Node's built-in `WebSocket` and `fetch`, no packages, and never
  enables request interception or pauses new targets.
- Findings, the quit log and drafts carry no gifter names, notes, friend names, unmasked account
  IDs or SteamID64s, hostnames or home folder paths. Screenshots and raw DevTools logs stay in the
  executing session's scratchpad, never the repo.
- `docs/llm/active/` is never committed.

## Technical Approach

### Key Decisions

From the plan and research; listed so a cold reader has the reasons.

1. **Confirm each traced cause live before fixing.** Both causes come from reading source and
   logs. The Store fix ships only after the hang reproduces with the hooks present and goes away
   with only the two hook calls removed.
2. **Skip the hooks on Millennium 3.3.0 and later.** From v3.3.0 Millennium injects every enabled
   plugin's webkit script into Steam pages itself, so the hooks add only the broken script tag. A
   Lua plugin can't ask Millennium whether it injects, but `on_load` already calls
   `millennium.cmp_version`, so the gate is a version comparison.
3. **Every sync keeps working.** The licence sync, the friends sync and the explicit sync links
   all run from the webkit script, which Millennium keeps injecting. The live acceptance checks
   all three.
4. **The quit hang is settled by evidence, not counts:** "Unloading Millennium..." never appearing
   after Shutdown, hangs with no plugin loaded, and a backtrace if Tim takes one. A quit has hung
   if the client is still running 60 s after logging Shutdown; it is then killed.
5. **Sweep findings are recorded, not fixed**, unless one turns out to be part of the Store or
   quit problem.
6. **Millennium's problems become drafts that Tim posts.** The repo has no remote and `gh` is
   logged in to a work account. A Millennium security matter is handled privately (see the private notes).

### Assumptions

Each can be overridden before or during execution.

| ID | Assumption | Why |
| --- | --- | --- |
| A1 | **Working without Tim is approved** (N1). Claude may quit Steam, SIGKILL a client still running 60 s after Shutdown, relaunch Steam (Dev Mode), open `steam://openurl` links, observe pages through DevTools, and toggle Gratitude in `plugins.enabledPlugins` with Steam quit after a backup. | The plan's proposed arrangement; Tim is away for most of the run. |
| A2 | **Hook gate** (open question 4). The hooks are registered only when `millennium.cmp_version(millennium.version(), "3.3.0")` is below 0. Below 3.3.0, for v3.3.0 pre-releases (semver orders them below 3.3.0) and for a version that can't be parsed (`cmp_version` returns -2), both hooks are registered exactly as today. | Changes only what this machine can test; every other case behaves as it does now, hang included. |
| A3 | **App ID detection** (open question 1): the cause is confirmed live and recorded; no fix in this branch. | Until Tim answers. |
| A4 | **Account over 256 KB** (open question 2): facts from source and existing tests; no code change and no live test. | The choice is Tim's; the facts are what he needs. |
| A5 | **Lua host after a kill** (open question 3): a `libmillennium_luavm` process still running 5 s after the client is killed is killed too, and recorded. | It belongs to the same hung Steam; research found no case of it. |
| A6 | **Sweep surfaces** (open question 5): library game pages, Store, Community, the gift modal and the settings panel; the consent dialog in 5.1; no Big Picture Mode. | No frontend code changes, so the frontend guide's Big Picture check isn't triggered. |
| A7 | **DevTools clicks** (N2). Claude may click through DevTools where the click saves nothing: Steam's tabs, library games, opening and closing the gift modal, typing in its friend search, its friends refresh, the missing data badge, opening the settings panel. Allow, Deny, gift Save and Delete, clearing caches and settings toggles are Tim's. | Needed for the Store tab path and most of the sweep while Tim is away. |
| A8 | **Three acceptance restarts**, each covering the Store tab, a `steam://openurl` Store link and a Community page, with the first path alternating: tab, link, tab. | Three is the number proposed in the plan; alternating shows that neither path depends on the other loading first. |
| A9 | **No Shutdown line** (N4): if none appears within 60 s of `steam -shutdown`, send it once more; if still none after another 60 s, record it and stop Steam work for Tim. | The hang cut-off is defined from Shutdown. |
| A10 | **Load outcome.** Finished: `readyState` "complete", a load event and, on the Store, the Featured and Recommended carousel, within 60 s of navigation. Hung: 60 s after navigation the `millennium.host/v1/themes/` request has neither finished nor failed and no load event has fired. | A normal Store load takes seconds; Millennium's own DevTools requests time out at 30 s. |
| A11 | Security matter, see the private notes. | Kept private until Millennium is told. |
| A12 | **Wording is proposed.** The CHANGELOG entry and commit message are shown to Tim before the commit. | He agreed wording in the previous work. |
| A13 | **No new log line in `on_load`.** The existing "Gratitude plugin loaded with Millennium version" line and the page's module script list show which path ran. | Keeps the change to the gate and its comment. |
| A14 | **Opening pages from a shell** uses `xdg-open 'steam://openurl/<url>'` with the desktop session's display settings. | Opened the Store this way on 2026-10-17. |

### Contracts

**Hook gate** (`backend/main.lua`, `on_load`). The hooks' arguments and order don't change:
`add_browser_js("", ".*store\\.steampowered\\.com.*")`, then
`add_browser_js("", ".*steamcommunity\\.com.*")`, as written in Lua source. Nothing else in
`on_load` changes.

| `millennium.version()` | `cmp_version(..., "3.3.0")` | Hooks registered |
| --- | --- | --- |
| v3.6.1, v3.3.0 | 1, 0 | none |
| v3.2.0 | -1 | both, as today |
| v3.3.0-beta.2 (pre-release) | -1 | both, as today |
| a version Millennium can't parse | -2 | both, as today |

The TODO at `backend/main.lua:744-747` is replaced by a comment, in US English, saying what the
code does and why: below 3.3.0 the hooks make Store and Community pages qualify for webkit
injection; from 3.3.0 Millennium injects there itself, and the hooks' empty path would leave those
pages loading, because Millennium reads its themes folder as a file and never answers; a version
that can't be parsed keeps the hooks. No plan or spec IDs.

**Lua test stub** (`tools/lua_test_support.lua`). Per env, so `support.new_env()` resets both:

```lua
env.millennium_version = "v3.2.0" -- millennium.version() returns it; "v3.6.1" when nil or no env is current
env.browser_js_calls              -- {} for a new env; add_browser_js(path, pattern) appends { path = path, pattern = pattern }
millennium.cmp_version(a, b)      -- as today, plus -2 when either version contains no digit
```

The -2 case models one of Millennium's parse failures (`src/lua_host/api/millennium.cc:306-323`).
The stub still compares digits only, so it gets pre-releases wrong, and no test uses one.

**DevTools observer** (`docs/llm/active/steam-test-tools/cdp_observe.mjs`, untracked). Connects to
the browser through `http://127.0.0.1:8080/json/version`, which Steam exposes in dev mode.

```text
node cdp_observe.mjs targets
node cdp_observe.mjs watch --target <regex> --out-dir <dir> [--seconds 60] [--carousel <css>] [--label <name>]
node cdp_observe.mjs check --target <regex> [--carousel <css>]
node cdp_observe.mjs eval  --target <regex> --file <expression.js>
node cdp_observe.mjs shot  --target <regex> --out-dir <dir> [--timeout 10] [--label <name>]
node cdp_observe.mjs click --target <regex> (--text <visible text> | --selector <css>)
```

- `--target` matches a page target's URL or title: `^Steam$` for the main window,
  `SharedJSContext` for the page Gratitude's frontend runs in. `targets` prints each page target's
  type, title and URL path without the host.
- `watch` calls `Target.setDiscoverTargets {discover: true}` and attaches to every matching page
  target, existing or new, with `Target.attachToTarget {targetId, flatten: true}`. On each session
  it enables `Network`, `Page`, `Page.setLifecycleEventsEnabled {enabled: true}`, `Runtime` and
  `Log`, and it stays attached across Millennium's reload of the page. When `--seconds` ends it
  runs `check` on each page, detaches, and writes every event as JSON lines to
  `<out-dir>/<label>.jsonl`. It prints one summary per document load:
  - the URL path and the `Page.lifecycleEvent` names seen;
  - whether `domContentEventFired` and `loadEventFired` arrived;
  - every `millennium.host` request with its outcome: status, failure text, or pending;
  - counts of failed requests and console errors;
  - every console line containing `[Gratitude]`, cut to 200 characters.
- `check` evaluates a read-only expression and prints JSON with:
  - `readyState`, and the `src` of every `script[type=module]`;
  - whether this has an entry:
    `performance.getEntriesByName('https://millennium.host/v1/themes/')`;
  - whether `--carousel` matches;
  - the sync overlay's text, found as `cdp_peek.mjs` finds it;
  - whether `#application_config` exists.
- `eval` runs an expression file in the page's own world (no `contextId`) and prints its JSON
  result. Expressions are read-only and never return config values, keys or names.
- `shot` calls `Page.captureScreenshot` with a timeout, because hidden views may never produce a
  frame, and saves `<out-dir>/<label>.png`.
- `click` is the only command that changes page state, and is used only within A7. It fails
  without clicking when no element or more than one matches, and prints what it clicked.
- Never `Fetch.enable`, which would pause requests alongside Millennium's own interception, and
  never `Target.setAutoAttach`, which with `waitForDebuggerOnStart` stalls new pages. The tool
  refuses an `--out-dir` inside the repository.

**Quit and relaunch tool** (`docs/llm/active/steam-test-tools/steam_restart.sh`, untracked).
Every command that launches or signals Steam first reads `DISPLAY`, `WAYLAND_DISPLAY` and
`XAUTHORITY` fresh from `systemctl --user show-environment`. Expect `:0` and `wayland-0`;
`XAUTHORITY` changes whenever the desktop session restarts.

```text
steam_restart.sh status                client pid, Lua host pids, plugins.enabledPlugins, display settings present
steam_restart.sh quit "<build label>"  quit, wait, kill if hung, append one quit log row
steam_restart.sh start                 launch Steam (Dev Mode) and wait for the Library
steam_restart.sh plugin off|on         with Steam quit: back up config.json, edit only plugins.enabledPlugins
```

- `quit`:
  1. Note the length of `console-linux.txt`, run `steam -shutdown`, and wait for a new
     `] Shutdown` line (A9 if none).
  2. 30 s after Shutdown, if the client still runs, save each thread's `comm`, state and `wchan`
     from `/proc/<pid>/task/*` to the scratchpad and count the threads by `wchan`.
  3. 60 s after Shutdown, `kill -KILL` the client and wait for it to exit.
  4. Check for "Aborted" or "corrupted" after Shutdown, for "Unloading Millennium..." after
     Shutdown in `console-linux.txt` and `bootstrap_log.txt`, for a Lua host 5 s after the kill
     (A5), and for `journalctl -k` amdgpu lines from Shutdown to 2 minutes after.
  5. Append the row.
- `start` refuses while a client runs, because the `steam-dev` launcher would try to quit it and
  then wait at an interactive prompt. It runs `gtk-launch steam-dev` with the display settings and
  waits until `/json/list` has `SharedJSContext` and a page titled "Steam" and the log shows
  "Gratitude plugin loaded with Millennium version" (or "Enabled Plugins: 0" when disabled). It
  then allows 15 s for the Library to settle, and gives up with a report after 180 s.
- `plugin` refuses while a client runs. It copies `config.json` to
  `config.json.bak-<YYYYmmdd-HHMMSS>`, changes only the array with `jq`, and checks that the file
  parses and that `plugins.gratitude.config` has the same key count as before. It never prints the
  file.

**Quit log** (`docs/llm/active/quit-log-steam-bugs.md`, untracked). A short header pointing at
research section 2's table of the 12 quits before this work, then one row per quit, written as
soon as its outcome is known:

| Shutdown | Session | Gratitude, build | How it ended | "Unloading Millennium..." after Shutdown | Lua host after kill | Threads at 30 s | amdgpu lines |
| --- | --- | --- | --- | --- | --- | --- | --- |

"How it ended" is one of: exited by itself after N s, killed at 60 s, or aborted. "Threads at
30 s" is a count by wait point, for example "26 of 33 in futex_do_wait".

**Findings document** (`docs/llm/active/findings-steam-bugs.md`, untracked). Each entry follows
the privacy rule and is written so it could become a GitHub issue.

```markdown
# Findings: Gratitude bugs in the live Steam client
## Questions for Tim       (first, so they are seen on return)
## Store loading            (cause, evidence per session, the fix, acceptance results, side effects)
## Quit hang                (conclusion, evidence, links to the quit log and the draft)
## Carried items            (security question, app ID, account over 256 KB, uninstall prompt)
## Sweep findings
### F<n> <short title>
- Surface: library page | Store | Community | gift modal | settings panel | consent dialog
- What happened, and how to reproduce it
- Evidence: console lines, failed or unexpected requests, what a screenshot showed
- With Gratitude disabled: same | doesn't happen | not checked, and why
- Likely owner: Gratitude | Millennium | Steam, and why
```

**Drafts** (`docs/llm/active/drafts/`, untracked). Each opens with a line saying where Tim would
post it:

- `millennium-931-comment.md`: a comment on Millennium issue 931.
- A private security report, kept outside the repo (see the private notes).
- `millennium-uninstall-prompt-issue.md`: a new Millennium issue, following its bug template.

Drafts are wrapped at 100 characters like other working files. When Tim posts one, Claude gives
him the text with wrapped lines joined, because GitHub renders every newline.

### Implementation Strategy

**Branch and commit.**

- `fix/steam-bugs` from `feat/config-storage` at d1ae411. One conventional commit for the Store
  fix (code, stub, tests, changelog), made after the code review and Tim's go-ahead, with the
  identity set in the repo's own config, `timmblyth@gmail.com`. Stage by path, never
  `git add -A` or `git add .`. There is no remote, so nothing is pushed.
- The tools, quit log, findings and drafts stay in `docs/llm/active/`, untracked.

**Safety rules for Steam.**

- Never uninstall Gratitude through Millennium's settings while
  `~/.local/share/millennium/plugins/gratitude` is the symlink to this checkout. Millennium follows
  the link and deletes the checkout, `.git` included.
- Back up `~/.config/millennium/config.json` and `backend/gratitude_*` before the first Steam test
  (0.5), and `config.json` again before each edit (`steam_restart.sh plugin` does this).
- `config.json` holds Gratitude's gift records under `plugins.gratitude.config`. Read it with
  `jq` key paths or counts, never print it.
- `npm run build` rewrites the `.millennium/Dist/` that Steam loads, so it runs only with Steam
  quit. A change to `backend/main.lua` needs no build and takes effect at the next Steam start.
- Before every quit, add a progress note naming the session. A GNOME session crash, which
  happened 30 s into a hung quit on 2026-10-18, may end this Claude session too, and Steam then
  waits for Tim to log back in.
- Steam's own logs hold the unmasked account ID and the machine's hostname. Neither goes into
  findings, the quit log or drafts.
- When a screenshot or log can't settle an observation, record it as a question for Tim and move
  on.

**Session plan.** Each session is one Steam start and one quit. Code and writing tasks that don't
need Steam (1.4, 1.5, 3.2, 3.4, 3.5) can run while a session is open, apart from the 1.5 gotcha
below.

| Session | Gratitude | Backend | Purpose | Tasks |
| --- | --- | --- | --- | --- |
| S0 | enabled | d1ae411 | the Steam session running now; its quit starts the quit log | 0.5 |
| S1 | disabled | d1ae411 | baseline: Store and Community load; find the carousel selector | 1.1 |
| S2 | enabled | d1ae411 | reproduce the hang with the hooks | 1.2 |
| S3 | enabled | two hook calls removed | show the hang gone | 1.3 |
| S4 | enabled | the fix | acceptance 1, sync links, security check, app ID | 1.9, 1.10, 3.1, 3.3 |
| S5 | enabled | the fix | acceptance 2, sweep of library pages, Store and Community | 1.9, 4.1, 4.2 |
| S6 | enabled | the fix | acceptance 3, sweep of the gift modal and settings panel | 1.9, 4.3 |
| S7 | disabled | the fix | compare candidate findings with Gratitude disabled | 4.4 |

That is eight quits, most expected to end in a kill at 60 s. If phase 1 stops early (1.1 to 1.3
say how), S4 to S7 run on d1ae411 for the other phases.

**Red then green.** For each behaviour change: write the test, run it, and confirm it fails for
the stated reason, an assertion naming the wrong value, not a load error or a missing stub. Make
the smallest change that passes, then rerun `npm run test:lua` and `npm test`. Characterisation
tests pass when written. The live reproduction is the Store fix's outer red and green: hung in S2,
loading in S3 and in S4 to S6.

**Conventions.** Code comments describe behaviour, never plan or spec IDs. US English in code and
comments, UK English in prose. No em or en dashes anywhere. CHANGELOG entries go under
`## Unreleased`.

**Gotchas.**

- `cmp_version` strips a leading "v" from both arguments (`plugin_loader.cc:776-792`), and
  `millennium.version()` returns "v3.6.1". It returns -2 when either version fails to parse, so
  the hooks stay whenever the result is below 0; never test `== -1`.
- Run 1.5's red only while `git diff backend/main.lua` is empty. During S3 the hook calls are
  removed, and the v3.6.1 test would pass for the wrong reason.
- LuaUnit treats every global starting with `test` or `Test` as a test, and the runner loads every
  file into one Lua state, so the new class needs a unique name (`TestBrowserHooks`).
  `assertEquals` takes `(actual, expected)`.
- Check for the client with `pgrep -x steam` and for Lua hosts with
  `pgrep -f '[l]ibmillennium_luavm'`; `pgrep -f steam` matches its own shell.
- Never run `steam-dev` straight from the Bash tool, because Steam then ends up attached to the
  tool's shell. Use `gtk-launch steam-dev`.
- `console-linux.txt` keeps ANSI colour codes: strip them with `sed 's/\x1b\[[0-9;]*m//g'` before
  grepping. Read new lines from a saved length, and from the start if the file has shrunk.
- Millennium reloads each Store and Community page once after attaching ("webkit_world_mgr:
  reloaded page for session ... (top-level target)"), so the observer stays attached across
  navigations and summarises each document load separately.
- On a hung page, whether Gratitude's webkit script starts is a race in Millennium's loader, so S2
  may or may not show "WebkitMain loaded".
- `steamcommunity.com/my/` redirects to a path holding the account's SteamID64 or custom URL, and
  target URLs can carry the machine's hostname. Mask or drop both in anything copied into findings.
- The first Store visit after each restart runs a full licence sync, because the licence cache
  drops its licence count at load. That bug is out of scope.

## Tasks

### Phase 0: Set up

- [ ] 0.1 Create the branch
  - **File**: none (git)
  - **Dependencies**: none
  - **Steps**: `git status --short` shows only `?? docs/`. `git config user.email` prints
    `timmblyth@gmail.com`; stop and ask Tim if it doesn't. Then
    `git switch -c fix/steam-bugs feat/config-storage`.
  - **Verification**: `git branch --show-current` prints `fix/steam-bugs`, at d1ae411. Baseline as
    on 2026-10-18 21:00: `npm run test:lua` 223 tests, `npm test` 98 tests in 12 files,
    `npm run type-check` and `npm run lint` clean.

- [ ] 0.2 Get Millennium v3.6.1's source for reference
  - **File**: none (scratchpad)
  - **Dependencies**: none
  - **Steps**: research's checkout may be gone:
    `/tmp/claude-1000/-home-tim-personalprojects-Gratitude-Millennium-Plugin/4b852593-c6b0-41f4-b3d8-df6b767cddcd/scratchpad/millennium-src`.
    If it is, clone the tag into a new, empty folder in this session's scratchpad. Read it only;
    never build or run anything from it.

    ```bash
    git clone --depth 1 --branch v3.6.1 https://github.com/SteamClientHomebrew/Millennium
    ```

  - **Verification**: `git rev-parse --short HEAD` in the checkout starts with 401d532, and
    `src/engine/http_hooks.cc` exists.

- [ ] 0.3 Build the DevTools observer
  - **File**: `docs/llm/active/steam-test-tools/cdp_observe.mjs` (untracked)
  - **Dependencies**: none
  - **Who**: Claude alone
  - **Steps**: write the tool to the DevTools observer contract. Leave `cdp_console.mjs` and
    `cdp_peek.mjs` as they are.
  - **Verification**, against the Steam session running now (S0):
    - `targets` lists `SharedJSContext` and a page titled "Steam";
    - `check --target SharedJSContext` prints JSON with `readyState` "complete";
    - `shot --target '^Steam$'` with `--out-dir` in the scratchpad saves a PNG there, or reports a
      timeout within 10 s;
    - `watch --target 'store\.steampowered\.com' --seconds 10` exits cleanly after about 10 s;
    - an `--out-dir` inside the repository is refused;
    - `grep -n 'Fetch\.\|setAutoAttach' cdp_observe.mjs` finds nothing.

- [ ] 0.4 Build the quit and relaunch tool, and start the quit log
  - **File**: `docs/llm/active/steam-test-tools/steam_restart.sh`,
    `docs/llm/active/quit-log-steam-bugs.md` (both untracked)
  - **Dependencies**: none
  - **Who**: Claude alone
  - **Steps**: write the tool to the quit and relaunch contract, and the quit log's header.
  - **Verification**: `bash -n` passes. Against S0, `status` prints the client pid, the Lua host,
    `["gratitude"]` and that all three display settings are present, and `plugin off` refuses.
    `quit` and `start` are proven in 0.5 and 1.1.

- [ ] 0.5 Quit S0, back up and build
  - **File**: none
  - **Dependencies**: 0.1, 0.3, 0.4
  - **Who**: Claude alone
  - **Steps**: progress note, then `steam_restart.sh quit "enabled, d1ae411"`. With Steam quit:
    `cp ~/.config/millennium/config.json ~/.config/millennium/config.json.before-steam-bugs`, copy
    `backend/gratitude_*` to a new `~/gratitude-backup-<YYYY-MM-DD>-steam-bugs/`, and run
    `npm run build`.
  - **Verification**: the quit log's first row has every column filled; both backups exist and
    match the originals' sizes; the build passes.

### Phase 1: Store loading

- [ ] 1.1 Baseline with Gratitude disabled (S1)
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 0.5
  - **Who**: Claude alone. If the Store tab can't be clicked through DevTools, the tab path moves
    to 5.3.
  - **Steps**:
    1. `steam_restart.sh plugin off`, then `start`.
    2. Start this watch in the background, then click the Store tab in the `^Steam$` window:
       `watch --target 'store\.steampowered\.com|steamcommunity\.com' --seconds 90 --label s1-tab`.
       Once the Store has loaded, find a selector for the Featured and Recommended carousel with a
       read-only `eval`, and record it in the progress notes.
    3. Repeat the watch, with `--carousel` from here on, for
       `xdg-open 'steam://openurl/https://store.steampowered.com/'` (label `s1-link`) and
       `xdg-open 'steam://openurl/https://steamcommunity.com/my/friends/'` (label `s1-community`).
    4. Screenshot the Store. Progress note, then `quit "disabled, d1ae411"`.
  - **Verification**: every load finished (A10); no request to `millennium.host/v1/themes/`; no
    "Is a directory" line in this session's log. If the Store hangs with Gratitude disabled, the
    plan's premise doesn't hold: stop phase 1's code tasks and put it to Tim.

- [ ] 1.2 Reproduce the hang with the hooks (S2)
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 1.1
  - **Who**: Claude alone (tab path as in 1.1)
  - **Steps**: `plugin on`, `start`, then the three watches of 1.1 (labels `s2-*`). For each page,
    note whether it logged `[Gratitude] WebkitMain loaded` and whether the backend logged
    `SetGameLicenseData called` or `Stored N friends`. Match each hung load against
    `console-linux.txt`: an "Is a directory" line within a second of a "reloaded page" line.
    Screenshot. Progress note, then `quit "enabled, d1ae411"`.
  - **Verification**: the hang is recorded with its evidence: `readyState` "interactive", no load
    event, the themes request pending with no performance entry, and the "Is a directory" line. If
    the Store loads normally, try once more on another restart. If it loads again, the cause isn't
    confirmed: stop phase 1's code tasks and put it to Tim. Phases 2 to 4 continue either way.

- [ ] 1.3 Show the hang gone with only the hook calls removed (S3)
  - **File**: `backend/main.lua` (temporary edit), `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 1.2 reproduced the hang
  - **Who**: Claude alone (tab path as in 1.1)
  - **Steps**: delete exactly the two `millennium.add_browser_js` lines; `git diff --stat` shows
    `backend/main.lua` with 2 deletions and nothing else. `start`, the three watches (labels
    `s3-*`), a screenshot, a progress note, then `quit "enabled, hook calls removed"`. With only
    that edit in the file, `git checkout -- backend/main.lua`. Write the findings' Store section:
    the cause, the S1 to S3 evidence, and N7's side effect.
  - **Verification**: every load finished (A10), no themes request, no "Is a directory" line, and
    the licence and friends syncs ran (the page and backend lines of 1.2). After the revert,
    `git diff backend/main.lua` is empty. If the hang persists, the traced cause is wrong: stop
    phase 1's code tasks and put it to Tim.

- [ ] 1.4 Record hook calls and a configurable version in the Lua test stub (red-green)
  - **File**: `tools/lua_test_support.lua`, `tools/test_lua_test_support.lua`
  - **Dependencies**: 0.1
  - **Red**: new `TestLuaTestSupport` tests:
    - with `env.millennium_version = "v3.2.0"`, `require("millennium").version()` returns
      "v3.2.0", and "v3.6.1" again after `support.new_env()`. Expected failure today: "v3.6.1".
    - `add_browser_js("p", ".*x.*")` makes `env.browser_js_calls` equal
      `{ { path = "p", pattern = ".*x.*" } }`, and a new env starts with `{}`. Expected failure
      today: `env.browser_js_calls` is nil.
    - `cmp_version("unknown", "3.3.0")` returns -2, and `cmp_version("v3.6.1", "3.3.0")` still
      returns 1. Expected failure today: -1 for the first.
  - **Green**: the stub reads the version and records calls through the current env, as
    `millennium.config` already does; `cmp_version` returns -2 when either argument has no digit.
  - **Verification**: the whole Lua suite passes: 223 tests plus the new ones.

- [ ] 1.5 Test which Millennium versions register the hooks (red)
  - **File**: `tools/test_browser_hooks.lua` (new, `TestBrowserHooks`)
  - **Dependencies**: 1.4, and `git diff backend/main.lua` empty
  - **Red**: each test sets `env.millennium_version`, calls `env.start_backend()`, then checks
    `env.browser_js_calls`:
    - "v3.6.1": `{}`. Expected failure today: two calls.
    - "v3.3.0": `{}`. Expected failure today: two calls.
    - "v3.2.0": exactly the two calls of the hook gate contract, Store first. Characterisation;
      passes today.
    - "unknown" (`cmp_version` returns -2): the same two calls. Characterisation; passes today.
  - **Verification**: the two new behaviour tests fail on their assertions; the two
    characterisation tests pass.

- [ ] 1.6 Skip the hooks on Millennium 3.3.0 and later (green)
  - **File**: `backend/main.lua`
  - **Dependencies**: 1.5
  - **Green**: wrap the two calls in
    `if millennium.cmp_version(millennium.version(), "3.3.0") < 0 then ... end`, and replace the
    TODO with the comment the hook gate contract describes. The rest of `on_load` stays as it is.
  - **Verification**: `TestBrowserHooks` passes; `npm run test:lua` and `npm test` pass;
    `git diff backend/main.lua` touches only the hook lines and their comment.

- [ ] 1.7 Add the changelog entry
  - **File**: `CHANGELOG.md`
  - **Dependencies**: 1.6
  - **Steps**: add one line to the existing `### Fixed` list under `## Unreleased`, wording
    proposed (A12): "Fixed Steam Store and Community pages never finishing loading while Gratitude
    is enabled on Millennium 3.3.0 and later."
  - **Verification**: one line added; nothing else in the file changed.

- [ ] 1.8 Run every automated check
  - **File**: none
  - **Dependencies**: 1.7, with Steam quit (after S3)
  - **Verification**: `npm run test:lua`, `npm test` (log privacy check included),
    `npm run type-check`, `npm run lint` and `npm run build` pass. `git status --short` lists only
    `backend/main.lua`, `tools/lua_test_support.lua`, `tools/test_lua_test_support.lua`,
    `CHANGELOG.md`, `?? tools/test_browser_hooks.lua` and `?? docs/`.

- [ ] 1.9 Live acceptance on three restarts (S4, S5, S6)
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 1.8
  - **Who**: Claude alone (tab path as in 1.1)
  - **Steps**: in each session, `start`, then the three watches of 1.1 with `--carousel`, the
    first path alternating per A8: S4 tab, S5 link, S6 tab. The other checks planned for the same
    session run after these. Progress note before each `quit "enabled, fix"`.
  - **Verification** (the plan's Store acceptance criteria), in all three sessions:
    - every Store and Community load finished (A10), with no `millennium.host/v1/themes/` request;
    - no "Is a directory" line in the session's log;
    - each Store visit shows the licence sync: `[Gratitude]` page lines, and
      `SetGameLicenseData called` or the "unchanged from backend cache" skip;
    - each Community visit shows the friends sync: `Stored N friends` or
      `Friends list unchanged`.

    Results go in the findings' Store section.

- [ ] 1.10 Sync links still show the overlay and return to the Library (S4)
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 1.9's S4 checks
  - **Who**: Claude alone for the steps below. The consent dialog's Allow and the settings panel's
    Grant Permission are 5.1 (needs Tim).
  - **Steps**, each with a watch running:
    1. `xdg-open 'steam://openurl/https://store.steampowered.com/?gratitude_sync=1'` and
       `xdg-open 'steam://openurl/https://steamcommunity.com/my/friends/?gratitude_sync=1'`, the
       exact links the buttons open (three open the first, the gift modal's refresh the second).
    2. The gift modal's friends refresh: open a gifted game's library page, click the Gifted
       badge's text, then the refresh button (A7).
    3. The missing data badge, if some game page shows it without any data change: click it.
       Otherwise it moves to 5.1.
  - **Verification**: each shows the overlay (`check`'s overlay text starts with "Gratitude:"),
    then a screenshot shows the Library, and the sync's log lines appear as in 1.9.

### Phase 2: Quit hang

- [ ] 2.1 Check the quit log
  - **File**: `docs/llm/active/quit-log-steam-bugs.md`
  - **Dependencies**: S7's quit (4.4)
  - **Who**: Claude alone
  - **Steps**: `steam_restart.sh quit` writes each row. Check that every quit since 0.5 has one,
    that at least one hung quit has its thread states summarised, and that S1 and S7 had Gratitude
    disabled.
  - **Verification**: the plan's acceptance: every quit recorded, including at least one with
    Gratitude disabled.

- [ ] 2.2 Write the quit hang conclusion
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 2.1; updated later if 5.4 produces a backtrace
  - **Who**: Claude alone
  - **Steps**: state the conclusion as one of: the hang is Millennium issue 931; it isn't; or the
    evidence is inconclusive. Rest it on the quit log (hangs with Gratitude disabled, whether
    "Unloading Millennium..." ever followed Shutdown, the thread states), research section 2's
    earlier quits, and the backtrace if there is one. If the evidence shows Gratitude involved,
    for example hangs only with it enabled, or "Unloading Millennium..." followed by a stall in
    plugin shutdown, write it up as a fix decision for Tim. No Gratitude code changes for it here.
  - **Verification**: the plan's acceptance: a conclusion, said as such.

- [ ] 2.3 Draft the issue 931 comment
  - **File**: `docs/llm/active/drafts/millennium-931-comment.md`
  - **Dependencies**: 2.2
  - **Who**: Claude alone; Tim posts
  - **Steps**: first re-read issue 931 and PRs 937 and 938 with read-only `gh` calls
    (`gh issue view 931 -R SteamClientHomebrew/Millennium --comments`, `gh pr view 937 -R ...`),
    since new replies may change the draft. Then draft a few short paragraphs, written as one user
    to others, covering:
    - Ubuntu 24.04, GNOME on Wayland, Millennium v3.6.1;
    - the quits before and since installing Millennium, including the hangs with no plugin loaded
      (the full table collapsed in a `<details>` block);
    - "Unloading Millennium..." never logged after Shutdown, and the thread states;
    - the five live Gratitude disables taking 3.005 to 3.009 s (median 3.007 s) from "Stopping
      plugin" to "Successfully unloaded", as a data point for PR 937;
    - the backtrace, if 5.4 produced one.
  - **Verification**: no account IDs, hostnames or home folder paths; claims research marks as
    inferred are worded as such.

### Phase 3: Carried items

- [ ] 3.1 Security check (details in `docs/llm/active/private-security-notes.md`)

- [ ] 3.2 Private report draft for Tim (details in the private notes)

- [ ] 3.3 Confirm the app ID cause on Total War: WARHAMMER III (S4)
  - **File**: `docs/llm/active/steam-test-tools/appid_images.js` (untracked),
    `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 1.9's S4 checks
  - **Who**: Claude alone (A7)
  - **Steps**: open the game's library page, by a click in the library list or with
    `steam://nav/games/details/1142710` if that opens it; record which. Save research's "Checking
    app ID detection live" expression, extended to return the window's location path (research's
    unverified lead: a `/library/app/<id>` route), and run it with `eval` on `^Steam$`. Note the
    "Detected App ID" line it produced, in `webhelper_js.txt` or the `SharedJSContext` console.
    Screenshot.
  - **Verification**: the plan's acceptance: the cause confirmed live, or recorded as not
    confirmed with what was seen. Recorded like a sweep finding (A3), with the route's result as a
    fact for open question 1.

- [ ] 3.4 Record what an account over 256 KB sees today
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: none
  - **Who**: Claude alone; no Steam
  - **Steps**: check research section 6 against `backend/lib/config_store.lua` (`migrate`,
    `copy_missing`, `save`), `UpsertGiverData` and `DeleteGiverData` in `backend/main.lua`,
    `frontend/utils/giverSave.ts`, and the existing tests (`TestConfigStore`, `TestConfigMigration`,
    `giverSave.test.ts`). Where no test covers a point, for example that the refused copy still
    shows the account's gifts, a throwaway LuaUnit scenario in the scratchpad may confirm it;
    nothing is added to the repository.
  - **Verification**: the findings record what the badge and modal show, the log line at every
    start, what an edit and a delete do, and the choice for Tim (open question 2), with the plan's
    lean towards a specific message over a file fallback.

- [ ] 3.5 Draft the upstream issue for the missing uninstall prompt
  - **File**: `docs/llm/active/drafts/millennium-uninstall-prompt-issue.md`
  - **Dependencies**: 0.2
  - **Who**: Claude alone; Tim posts
  - **Steps**: search Millennium's issues again with read-only `gh`, for example
    `gh search issues --repo SteamClientHomebrew/Millennium uninstall --state all` and the phrase
    "delete saved settings". If an issue exists, record it in the findings and draft a comment on
    it instead. Read the bug template
    (`gh api repos/SteamClientHomebrew/Millennium/contents/.github/ISSUE_TEMPLATE`) and follow it.
    Content from research section 5: the source path from `uninstallPlugin` through
    `uninstall_plugin`'s disable to the Steam UI reload, the 2026-10-18 log timeline, and
    uninstalling an already disabled plugin as a suggested check, not a result (5.5 may make it
    one).
  - **Verification**: the plan's acceptance: an upstream report drafted, or an existing one
    found; no personal paths.

### Phase 4: Sweep

Each sweep check runs a `watch` on the pages involved and on `SharedJSContext`, and records
Gratitude's console lines, errors, failed or unexpected requests (repeated fetches, non-2xx
responses, unexpected hosts) and a screenshot. Anything from Gratitude that looks wrong is a
candidate finding, listed in the progress notes until 4.5.

- [ ] 4.1 Library game pages (S5)
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 1.9's S5 checks
  - **Who**: Claude alone (A7)
  - **Steps**: visit at least a gifted game with its badge, an owned game that wasn't a gift,
    Total War: WARHAMMER III and Warhammer 40,000: Darktide (app ID detection), a game showing the
    missing data badge if there is one, and a non-Steam shortcut if the library has one.
  - **Verification**: each page's console and requests recorded; candidates listed.

- [ ] 4.2 Store and Community pages (S5)
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 4.1
  - **Who**: Claude alone
  - **Steps**: the Store home page, a gifted game's Store page,
    `https://store.steampowered.com/account/licenses/`, the Community friends page and the
    account's own profile page.
  - **Verification**: each page's console and requests recorded; candidates listed.

- [ ] 4.3 Gift modal and settings panel, without saving (S6)
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 1.9's S6 checks
  - **Who**: Claude alone (A7); saving and deleting are 5.2
  - **Steps**: open the gift modal on a gifted game, type a few letters into the friend search,
    and close it without saving. Open Millennium's settings and Gratitude's panel without changing
    anything.
  - **Verification**: console and requests recorded for both; candidates listed.

- [ ] 4.4 Compare candidates with Gratitude disabled (S7)
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 4.1 to 4.3, and 3.1 and 3.3
  - **Who**: Claude alone
  - **Steps**: `plugin off`, `start`, revisit the pages behind each candidate, and record whether
    it still happens. Progress note, `quit "disabled, fix"`, then `plugin on`.
  - **Verification**: every candidate reads "same", "doesn't happen" or "not checked, and why";
    after `plugin on`, `plugins.enabledPlugins` is `["gratitude"]` and the config key count is
    unchanged.

- [ ] 4.5 Write the findings entries
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 4.4
  - **Who**: Claude alone
  - **Steps**: one F entry per bug, in the findings document's format. A finding that turns out to
    be part of the Store or quit problem gets a proposed task under phase 1, put to Tim before
    it is built. Bring the Questions for Tim section up to date: N1 to N8, the open questions, every
    needs Tim task still open, and anything a screenshot couldn't settle.
  - **Verification**: the plan's sweep acceptance: every surface checked with console and network
    watched, every Gratitude error or unexpected request compared with Gratitude disabled, and
    each bug its own entry.

### Phase 5: Tim's checks (needs Tim)

Batched for Tim's return. Claude prepares each one (backups, a Steam start, watches) and records
the result.

- [ ] 5.1 Consent dialog and Grant Permission (needs Tim)
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 1.9
  - **Steps**: with Steam quit and `config.json` backed up, Tim removes `consent.<accountId>` from
    Gratitude's config, or approves Claude doing it with `jq`. On the next start the consent
    dialog appears (its sweep check); Allow opens the Store sync link, which should show the
    overlay and return to the Library. For Grant Permission, consent must be stored as declined
    (Deny in the dialog, after removing consent again); then Gratitude's settings panel shows the
    button, which should do the same. Include the missing data badge if 1.10 couldn't. Afterwards
    consent is allowed again and the config key count matches the backup's.
  - **Verification**: the plan's acceptance for the consent dialog and settings panel buttons.

- [ ] 5.2 Gift modal save and delete (needs Tim)
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 4.3
  - **Steps**: with `config.json` backed up, add a gift record with a short note through the
    modal, edit it and delete it, with a watch on `SharedJSContext` and the backend log followed.
    Restore `config.json` or keep the result, as Tim prefers.
  - **Verification**: console, requests and backend lines recorded; any bug becomes an F entry.

- [ ] 5.3 Store tab path (needs Tim, only if DevTools couldn't click the tab)
  - **File**: `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: 1.9
  - **Steps**: after a restart on the fix, Tim clicks the Store tab while a watch runs.
  - **Verification**: the load finished (A10) with the syncs as in 1.9.

- [ ] 5.4 Backtrace of a hung quit (needs Tim, optional)
  - **File**: `docs/llm/active/quit-log-steam-bugs.md`, `docs/llm/active/findings-steam-bugs.md`
  - **Dependencies**: none
  - **Steps**: Tim quits Steam from its menu. Once the log shows Shutdown and the client is still
    running after about 30 s, Tim runs the following. Claude then adds the quit log row by hand
    and summarises where the main thread sits, for example in `~millennium_lifecycle`,
    `pthread_cond_destroy` or `StopMillennium`.

    ```bash
    sudo gdb -p "$(pgrep -x steam)" -batch -ex 'thread apply all bt' > ~/steam-hang-backtrace.txt 2>&1
    kill -KILL "$(pgrep -x steam)"
    ```

  - **Verification**: 2.2 and 2.3 updated; home folder paths removed from anything quoted.

- [ ] 5.5 Retest the uninstall prompt on a normal install (needs Tim, optional)
  - **File**: `docs/llm/active/drafts/millennium-uninstall-prompt-issue.md`
  - **Dependencies**: 3.5
  - **Steps**: never on the symlinked dev install. Make a normal install as in steps 1 to 3 of
    task 2F.7 in the data storage spec
    (`docs/llm/completed/2026-10-18-feat-safe-durable-data-storage/spec-data-storage.md`), and
    back up `config.json`. Disable Gratitude in Millennium's settings, then uninstall it. Research
    inferred that the "delete saved settings" prompt appears for an already disabled plugin.
    Answer No. Restore the dev link as in 2F.7 step 8.
  - **Verification**: the result is in 3.5's draft as a tested fact.

- [ ] 5.6 Tim's decisions
  - **File**: `docs/llm/active/findings-steam-bugs.md`, this spec
  - **Dependencies**: 4.5
  - **Steps**: Tim answers the findings' Questions for Tim: open questions 1, 2, 4 and 5, N1 to
    N8, which sweep findings become work, and whether to post each draft. He posts; Claude gives
    him the joined text.
  - **Verification**: answers recorded in the progress notes; any that change a task here are
    applied before the commit.

### Final

- [ ] Code Review
  - **Dependencies**: 1.9, 1.10
  - **Steps**: `git add -N tools/test_browser_hooks.lua` (intent to add, so `git diff HEAD`
    includes it), then run Tim's `/deep-review` skill with `Scope: uncommitted` and
    `feat/config-storage` named as the base, as in the data storage spec's "How `/deep-review`
    runs here"; the repo has no remote. Fix every Blocker, Critical and Major finding, or record
    why it stays where the code or repository docs will show it next time. Rerun 1.8, and if
    `on_load` changed, repeat one restart's Store and Community checks.
  - **Verification**: no open Blocker, Critical or Major finding.

- [ ] Commit the Store fix (needs Tim)
  - **Dependencies**: Code Review, 5.1, and 5.3 if it was needed
  - **Steps**: `git config user.email` prints `timmblyth@gmail.com`. `git status --short` lists
    only the five files of 1.8 plus `?? docs/`. Stage the five by path. Show Tim the message
    (A12), then commit:

    ```text
    fix: let store and community pages finish loading on millennium 3.3.0 and later

    - skip the manual store and community browser hooks where millennium injects webkit scripts itself
    - record browser hook calls and a configurable millennium version in the lua test stub
    - test which millennium versions register the hooks
    ```

  - **Verification**: `git log -1 --format='%ae %ce'` prints
    `timmblyth@gmail.com timmblyth@gmail.com`; `git status --short` shows only `?? docs/`; nothing
    pushed.

- [ ] Spec Audit
  - **Dependencies**: Commit the Store fix
  - **Steps**: run the spec-auditor agent over `git diff feat/config-storage fix/steam-bugs`, the
    findings document, the quit log and the drafts, against the plan and this spec.
  - **Verification**: every plan acceptance criterion maps to a passing test, a recorded Steam
    check, or a needs Tim task with its status; every assumption Tim overrode is reflected.

## Verification

### Success Criteria

- [ ] All tests pass: `npm run test:lua` and `npm test`, the log privacy check included
- [ ] `npm run type-check`, `npm run lint` and `npm run build` pass
- [ ] Store loading: 1.1 to 1.3 (cause shown live), 1.5 and 1.6 (version gate), 1.9 (three
  restarts, no themes error, syncs), 1.10 and 5.1 (sync buttons)
- [ ] Quit hang: 2.1 (every quit recorded, at least one with Gratitude disabled), 2.2
  (conclusion), 2.3 (draft)
- [ ] Sweep: 4.1 to 4.5, with 5.2 for saving and deleting
- [ ] Carried items: 3.1 and 3.2 (config), 3.3 (app ID), 3.4 (256 KB), 3.5 (uninstall)
- [ ] No regressions: the 223 Lua and 98 vitest baseline tests still pass
- [ ] One commit on `fix/steam-bugs` above d1ae411, with Tim's identity, nothing pushed and nothing
  from `docs/llm/active/` committed; no personal data in findings, the quit log or drafts

### Ralph Completion (for autonomous execution)

When ALL of the following are true, output `<promise>COMPLETE</promise>`:

- All tasks above show `[✅]`
- All tests pass
- No TypeScript or lint errors

Tasks marked "needs Tim" are not stuck tasks. While Tim is away, finish every task Claude can do
alone, skip the rest, and make sure each waiting item is in the findings' Questions for Tim. If
stuck on the same task for 3+ iterations, output `<promise>BLOCKED: [reason]</promise>`.

## Progress Notes

_Real-time updates during implementation_

- [2026-10-18 21:13] ✅ Specification created from plan file
