# Handover: Gratitude data storage (done) and Steam bugs (ready to execute)

**Written**: 2026-11-14, for an agent picking this work up cold  
**Branch with this file**: `wip/steam-bugs-handover`, a WIP docs commit on top of
`feat/config-storage`

## What this is

Gratitude is a Millennium plugin for the Steam desktop client. It marks gifted games in the
library and lets the user record who gave each gift, with a note. Two pieces of work live in this
folder:

1. **Safe and durable storage for user data: finished.** Two commits, both local until this push:
   - `c78c754` on `fix/safe-saves`: atomic saves, set-aside of unreadable files, no shutdown
     save, unconsented data kept off disk, no personal data in logs.
   - `d1ae411` on `feat/config-storage`: gift records, consent and settings moved into
     millennium.config with a migration from the old files, a 2,000 character note cap, error
     codes from `UpsertGiverData`, read-only sessions when stored data couldn't be read.
   - The plan, spec (every task ticked, spec audit passed) and research are archived in
     [completed/2026-10-18-feat-safe-durable-data-storage/](completed/2026-10-18-feat-safe-durable-data-storage/).
   - Branch stack: `build/regenerate-lockfile` (b6c9087, 8a4f08f), then `fix/safe-saves`, then
     `feat/config-storage`. None of these has been merged to `main` or opened as a pull request.
2. **Gratitude bugs in the live Steam client: planned, researched and specced, not started.**
   - [active/plan-steam-bugs.md](active/plan-steam-bugs.md): the plan, with five open questions
     each proceeding on its recommended option.
   - [active/research-steam-bugs.md](active/research-steam-bugs.md): causes traced from
     Millennium v3.6.1's source and Steam's logs.
   - [active/spec-steam-bugs.md](active/spec-steam-bugs.md): 37 tasks in phases 0 to 5 plus a
     final review; no task started.
   - [active/steam-test-tools/](active/steam-test-tools/): helper scripts from the storage work
     (console replay, page peek, mid-sync kill, data file check).

## Where the Steam bugs work stands

- **Store never finishes loading with Gratitude enabled.** Traced, not confirmed live:
  `backend/main.lua`'s `on_load` calls `millennium.add_browser_js("", ...)` for Store and
  Community pages. The empty path makes Millennium request its own themes folder as a script,
  the read throws, the request is never answered, and the page waits forever. Millennium has
  injected plugin webkit scripts itself since v3.3.0, so the planned fix skips the hooks on 3.3.0
  and later. The spec has the live proof (with and without the hooks) before the code change.
- **Steam hangs on quit.** Evidence points to Millennium issue 931, not Gratitude: it hangs with
  no plugin loaded, Millennium's unload step never runs, and quits before Millennium was installed
  exited normally. Deliverable: a drafted comment on issue 931, no Gratitude change.
- **Sweep and carried items.** App ID detection picks sidebar icons (cause traced, record only);
  the missing uninstall prompt is caused by the plugin disable reloading the Steam UI mid
  uninstall (draft an upstream issue); an account over 256 KB of old gift records needs a design
  call from Tim.
- **A Millennium security matter** came out of the research. Its details are deliberately not in
  this repository: Tim is telling Millennium in person, and the notes live in an untracked file on
  his machine (`docs/llm/active/private-security-notes.md`). Spec tasks 3.1 and 3.2 point there.
  Don't reconstruct or publish the details.

## How to pick it up

1. Read the plan, then the spec's "Open questions from the plan" and "New points for Tim" (N1 to
   N8). Points Tim hasn't answered yet:
   - N1: the plan's "Working without Tim" is treated as approved, including `kill -9` on a hung
     quit for this work.
   - N2: clicking in Steam's UI through DevTools only where the click saves nothing.
   - N4: if `steam -shutdown` never logs Shutdown, stop Steam work rather than kill.
   - N7: removing the hooks also stops Millennium adding theme colour CSS to Store pages.
2. Run `/execute-plan-spec` (Tim's skill; it is user-invocable only, so Tim types it). It starts
   at task 0.1, creating `fix/steam-bugs` from `feat/config-storage`.
3. Tasks marked "needs Tim" (phase 5, the optional sudo gdb backtrace, uninstall retests on a
   normal install, anything posted) wait for him; record them in the findings document's
   "Questions for Tim".

## Rules that matter here

- **Git identity.** The machine's global git identity is a work account. This repo has a local
  personal identity (`git config user.email` should print the personal address); check it before
  every commit. The `gh` CLI is normally logged in to the work account: never post or push with
  it.
- **Nothing is posted to GitHub by an agent.** Drafts are files for Tim.
- **Never uninstall Gratitude through Millennium's settings while it is the symlinked dev
  install** (`~/.local/share/millennium/plugins/gratitude` points at the checkout). Millennium
  follows the link and deletes the checkout, `.git` included.
- **Steam hangs on quit.** Start a quit with `steam -shutdown`, wait for "Shutdown" in
  `~/.local/share/Steam/logs/console-linux.txt`, and `kill -9` the client if it is still running
  60 s later. Gratitude's data is safe across kills (atomic saves, nothing saved at shutdown). Use
  `pgrep -x steam`, never `pgrep -f`, which matches the checking command itself.
- **Launching Steam** in dev mode: `gtk-launch steam-dev` with `DISPLAY=:0`,
  `WAYLAND_DISPLAY=wayland-0` and `XAUTHORITY` read fresh from `systemctl --user
  show-environment`. After a desktop session restart the old value fails with "Unable to open X11
  display". DevTools is at 127.0.0.1:8080.
- **Back up `~/.config/millennium/config.json`** before editing it, and only edit it with Steam
  fully quit. Gratitude's live data on this machine is migrated: consent and settings in
  config.json, the three old files renamed to `.migrated` in `backend/`.
- **`npm run build`** rewrites the Dist that a running Steam loads; build with Steam quit.
- **Testing.** Red then green for every behaviour change. Lua tests: `npm run test:lua`
  (LuaUnit, Lua 5.1, lua-cjson). Frontend logic as pure functions with vitest (`npm test`), no
  DOM libraries. Also `npm run type-check` and `npm run lint`. Baseline: Lua 223, vitest 98.
- **No personal data in logs, findings or drafts**: no gifter names, notes, friend names or
  unmasked account IDs. A static log privacy check runs in `npm test`.
- **Code comments describe behaviour, never plan or spec IDs.** US English in code, UK English
  in prose, no em or en dashes.
- **`docs/llm/active/` is a working folder.** It is committed here only as a WIP handover; it
  must never reach `main`.

## Loose ends outside the Steam bugs plan

- The data storage branches need merging and a release; the CHANGELOG has their entries under
  Unreleased.
- Run the test suites in CI (not set up).
- The licence cache drops its licence count at load, so every Steam start re-syncs all licence
  pages.
- An earlier docs change (`npm ci` in MILLENNIUM_DEVELOPMENT.md section 5.3, and an
  "Uninstalling" warning about the symlink) was approved but never applied.
- `@steambrew/api` looks unused; Tim hasn't decided whether to remove it.
- Whether the archived plan, spec and research should stay in a public repository is still Tim's
  call; they name local paths.
