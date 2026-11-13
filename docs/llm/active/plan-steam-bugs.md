# Plan: fix Gratitude bugs in the live Steam client

**Status**: draft, for Tim's review  
**Date**: 2026-10-18  
**Tracking**: local only, no GitHub issue  
**Branch**: its own branch from `feat/config-storage` (commit d1ae411)

## What this is

Gratitude is a plugin for Millennium, a framework that adds plugins to the Steam desktop client. It
marks games in the Steam library that were gifted to you, and lets you record who gave each gift.
This plan covers bugs that only show up in the live Steam client:

1. **The Steam Store never finishes loading while Gratitude is enabled.** Steam's own Store is
   broken for anyone running the plugin. Gratitude's own sync buttons open the Store the same way,
   so new gifts can go unnoticed.
2. **Steam hangs on quit** and has to be killed. Research points to Millennium, not Gratitude: it
   happens with no plugin loaded and matches an open Millennium issue.
3. **Other Gratitude bugs nobody has found yet**, because nothing checks Gratitude end to end in
   the live client.

Tim observed (1) and (2) on 2026-10-17 and 2026-10-18, on Millennium v3.6.1, Ubuntu 24.04 and
GNOME on Wayland with an AMD GPU. Research (see
[research-steam-bugs.md](research-steam-bugs.md)) traced a likely cause for each from the
Millennium source and Steam's logs; neither is confirmed live yet.

## Proposal

Work through the three problems in that order:

- **Store loading:** confirm the traced cause live, then fix it without breaking Gratitude's
  licence and friends syncs.
- **Quit hang:** confirm it is Millennium issue 931 rather than Gratitude, and draft a comment on
  that issue with the evidence.
- **Sweep:** go through library pages, the Store, Community and the gift modal with Steam's
  DevTools open, and record each bug found as its own item rather than fixing it.

Four items carried over from the data storage plan get looked at along the way (see **Items
carried from the data storage plan**). Most of the work can run while Tim is away (see **Working
without Tim**).

## Deliverables

- **The Store finishes loading with Gratitude enabled**, whether opened from Steam's Store tab or
  from a `steam://openurl` link, and the licence and friends syncs still work. If the cause turns
  out to be Millennium's and Gratitude can't avoid it, this becomes a drafted upstream report
  instead.
- **A recorded answer on whether the quit hang is Millennium issue 931**, with the evidence, and a
  drafted comment on that issue for Tim to post.
- **A findings document** with one entry per bug found in the sweep, each with reproduction steps
  and evidence, written so it could become a GitHub issue later.
- **Answers for the carried items:** a security question about Millennium (details kept in the untracked `docs/llm/active/private-security-notes.md` until Tim has told Millennium privately); the facts Tim needs to decide the other two open items; and a drafted upstream report on
  Millennium's uninstall prompt.
- **CHANGELOG entries under Unreleased** for each user visible fix.

## Background

Gratitude has three parts:

- a **Lua backend** that owns storage;
- a **frontend** inside Steam's library UI, which draws the "Gifted" badge and the gift modal;
- a **webkit script** that Millennium runs on Steam Store and Community pages. On a Store visit it
  reads the account's licence pages, which is how Gratitude learns about gifts. On a Community
  visit it reads the friends list used to autocomplete gifter names.

[AGENTS.md](../../../AGENTS.md) describes the architecture in full.

### The Store never finishes loading

With Gratitude disabled the Store loads normally. With it enabled the Store stays loading and the
"Featured and Recommended" carousel never appears. It shows up after a Steam restart: Steam lands
on the Library, and the Store is opened afterwards.

An earlier observation, from 2026-10-17, may be the same bug. A Store page opened from outside
Steam with a `steam://openurl` link stayed at document `readyState` "interactive". Gratitude's
webkit script never ran, and no licence sync happened until the page was reloaded.

That observation matters because Gratitude's own buttons open pages this way. Each opens a
`steam://openurl` link with a `gratitude_sync=1` parameter:

- the consent dialog's Allow button, so a new user's first sync goes through this path;
- the settings panel's Grant Permission button;
- the badge shown when licence data isn't found;
- the gift modal's friends refresh, which opens Community rather than the Store.

**Traced cause, not yet confirmed live.** When the backend loads, it hooks every Store and
Community page by hand, as a workaround for a Millennium bug that once stopped automatic
injection on Steam URLs. The hooks pass an empty script path. For each matching page, Millennium
then adds a script tag pointing at the root of its own themes folder. Reading a folder as a file
fails, Millennium only logs the error, and that script request is never answered, so the page
waits forever before finishing its load. The Store's own start-up code, which draws the carousel,
never runs. Steam's log shows that exact error 28 times, only in sessions with Gratitude enabled,
each about a second after a page load; Community pages carry the same hook and should hang the
same way.

The upstream fix the workaround waits for is already released: it has been in Millennium since
v3.3.0 (2026-06-23). Since then Millennium injects every enabled plugin's webkit script into Steam
pages itself, so on current versions the hooks add nothing except the broken script tag.

**Ruled less likely.** The licence cache loses its licence count when it loads (a separate bug,
out of scope here), so the first Store visit after every restart runs a full licence sync. The
sync's requests run in the background and don't block the page, so it is unlikely to be the
cause, though that is inferred rather than shown.

### Steam hangs on quit

Since 2026-10-17 nearly every quit has logged "Shutdown" and then hung until the client was killed
with SIGKILL; SIGTERM is ignored. Millennium's Lua host process, which runs Gratitude's backend,
only exits when the client is killed. One quit on 2026-10-18 that looked like a slow exit, 43
seconds after Shutdown, actually aborted on heap corruption with a core dump.

The evidence points to Millennium:

- The very first hang happened with no plugin loaded: Millennium had logged "Enabled Plugins: 0".
  A second one, on 2026-10-18, came after the uninstall test had disabled Gratitude.
- The three quits before Millennium was installed (2026-10-17, before 01:10) all exited normally.
  None of the 12 since has.
- Upstream [Millennium issue 931 "Steam Hangs On Exit"](https://github.com/SteamClientHomebrew/Millennium/issues/931)
  (open, Linux) has four reporters, all with plugins disabled, and a backtrace showing the hang in
  Millennium's own teardown during exit. The same code path is in v3.6.1.
- Millennium's first unload log line never appears after any "Shutdown" in Tim's logs, so its
  plugin shutdown, the only part a plugin could slow down, never even starts.
- [Millennium PR 938](https://github.com/SteamClientHomebrew/Millennium/pull/938) targets that
  mechanism; [PR 937 "fix(posix): reap exited plugin children during shutdown"](https://github.com/SteamClientHomebrew/Millennium/pull/937)
  fixes a separate 3 second delay per plugin, which every live Gratitude disable here showed. Both
  are open and unreviewed.

On 2026-10-18, 30 seconds into one hung shutdown, the AMD GPU driver logged a page fault and a
failed reset in gnome-shell, and the GNOME session died. The machine stayed up. Any link to Steam
is unestablished.

Gratitude's data is safe against these kills: since the data storage work, every save is atomic
and nothing is saved at shutdown. The cost is a manual kill on every quit, and if Gratitude is the
cause, users will hit it too.

### Unknown bugs in the live client

Gratitude's tests cover its logic as pure functions. Nothing checks the plugin end to end inside
Steam, and the two bugs above were noticed during other work. Steam's dev mode exposes Chromium
remote debugging at 127.0.0.1:8080, which shows each page's console messages and network traffic.

### Items carried from the data storage plan

Tim agreed to move these four follow-ups from the
[data storage plan](../completed/2026-10-18-feat-safe-durable-data-storage/plan-data-storage.md)
into this one:

- **App ID detection can pick another app's image.** On the Total War: WARHAMMER III library page
  it reported 345260 instead of 1142710, and the badge silently fell back to matching by name.
- **A security question about Millennium.** Details are kept in the untracked `docs/llm/active/private-security-notes.md` until Tim has told Millennium privately.
- **An account whose gift records were already over 256 KB in the old file gets stuck.**
  millennium.config caps each value at 256 KB. That account's copy into config is refused every
  session, and every edit is refused unless that one edit brings it under the limit. It needs a
  design choice: a file fallback for that account, or a message naming the problem. Unlikely in
  practice, because it needs very long notes written before the 2,000 character cap.
- **Millennium v3.6.1 never showed its "delete saved settings" prompt on uninstall**, though its
  source has one. Research found why: uninstalling first disables the plugin, which reloads the
  Steam UI page that was about to show the prompt. Millennium's to fix; no upstream issue exists.

Research also traced the wrong app ID: detection searches the whole window and takes the first
game image it finds, and the library sidebar's game icons come before the game page's own images.

## Key decisions

**Confirm each traced cause live before fixing.** Both causes come from reading source and logs.
A fix ships only once its cause is shown live: the bug reproduces with the suspected cause
present, and goes away when only that is removed. For the Store, that means removing only the
hooks.

**The Store fix keeps every sync working.** Gratitude gets its data from three things, and a fix
that makes the Store load by stopping any of them is not a fix:

- the licence sync on Store visits;
- the friends sync on Community visits;
- the explicit sync links Gratitude's own buttons open, which show a progress overlay and then
  return to the Library.

**The Store fix relies on Millennium 3.3.0's own injection.** Removing the hooks only works where
Millennium injects the webkit script itself, which it does from v3.3.0. A Lua plugin can't detect
that capability directly, but it can compare versions, and `on_load` already does. Proposed:
skip the hooks on 3.3.0 and later, and keep today's hooks below it, so older versions behave as
they do now. That likely keeps the hang on those older versions; dropping the hooks everywhere
instead would stop the syncs there. Tim decides (see **Open questions**).

**Every quit is logged from the start.** Reproducing the Store bug needs Steam restarts, and most
quits hang. Proposed: record every quit throughout the work with:

- its configuration: Gratitude enabled or disabled, and which build;
- how it ended: exited by itself and after how long, or killed;
- whether the Lua host outlived the client;
- whether the kernel log shows a GPU fault around it.

The quit study then starts with evidence rather than from nothing, and the kills the Store work
costs are not wasted.

**What counts as a hang, and what settles the cause.** A quit has hung if the client is still
running 60 seconds after logging Shutdown, and it is then killed. The cause is settled by
evidence, not by a count of quits: Millennium's unload log line never appearing after Shutdown,
the hang with no plugin loaded, and, if Tim can provide one, a backtrace of a hung client. A
backtrace needs debugger permission the session doesn't have, so it is Tim's to run.

**Sweep findings are recorded, not fixed.** This is Tim's direction. A list lets him prioritise,
and keeps unreviewed changes out of this branch. The exception is anything that turns out to be
part of the Store or quit problems. Each finding records:

- the surface: library page, Store, Community or gift modal;
- what happened, and how to reproduce it;
- the evidence: console lines, failed or unexpected requests, and what a screenshot showed;
- whether it also happens with Gratitude disabled;
- whether the cause looks like Gratitude's, Millennium's or Steam's.

**A cause in Millennium gets a drafted report that Tim posts.** Nothing from this work is posted
to GitHub: the repository has no remote, and the `gh` CLI is logged in to a work account. Where a
cause is Millennium's, the work produces a draft (a new issue, or a comment on an existing one
such as 931) with the reproduction and evidence. A Gratitude change can still be the Store fix if
Gratitude's own behaviour triggers the Millennium bug, as long as it meets the bar above; the
manual hooks are already a workaround of this kind. If the quit hang happens as often with
Gratitude disabled as enabled, Gratitude makes no change for it.

**Carried items: facts settled here, design choices left to Tim.**

- The Millennium security question is handled privately; details are kept in the untracked `docs/llm/active/private-security-notes.md` until Tim has told Millennium privately.
- App ID detection and the account over 256 KB each need a call from Tim (see **Open
  questions**). The work gathers the facts each one needs first.
- The uninstall prompt gets a drafted upstream report, based on what was already observed, after
  checking Millennium's issue tracker for an existing one. Re-testing it needs a normal install
  rather than the symlinked dev install, so it waits for Tim.

## Working without Tim

Tim prefers this work to run on its own and will be away. This arrangement is proposed for his
approval along with the rest of the plan.

Claude may:

- quit Steam with `steam -shutdown`, and SIGKILL the client if it hangs (see the hang cut-off in
  **Key decisions**);
- relaunch Steam in dev mode using the current desktop session's display settings;
- open the Store with a `steam://openurl` link once Steam has landed on the Library;
- observe pages through DevTools: console, network requests, load state, whether the carousel
  exists, and screenshots;
- turn Gratitude off for comparisons by editing Millennium's enabled plugins list in its
  `config.json` while Steam is quit, after backing the file up, and turn it back on afterwards;
- use the existing helper scripts in [steam-test-tools/](steam-test-tools/) for console reads,
  kills during a sync and data file checks.

Tim is needed for:

- anything a screenshot or log can't settle;
- anything riskier than restarting Steam, such as installing a patched Millennium or an uninstall
  test on a normal install;
- a backtrace of a hung Steam, which needs debugger permission (for example `sudo gdb`);
- recovering if the GNOME session crash recurs. After the 2026-10-18 crash, Steam couldn't be
  launched from a shell started in the old session.

The quit study repeats the situation the GNOME crash happened in, so each quit's result is written
down as it happens. A crash then loses at most the quit in progress.

## Scope

**In scope:**

- Finding and fixing why the Store doesn't finish loading with Gratitude enabled, including the
  half loaded page from a `steam://openurl` link.
- Establishing whether the quit hang depends on Gratitude, and fixing it if it does.
- A sweep of library game pages, the Store, Community and the gift modal, with the DevTools
  console and network traffic watched.
- The four carried items, as described in **Key decisions**.

**Out of scope:**

- Fixing sweep findings, other than ones that turn out to be part of the Store or quit problems.
  They become separate items for Tim to schedule.
- Running the test suites in CI. Separate work.
- The licence cache losing its licence count at load. Separate work, even though it makes every
  restart run a full licence sync. If the Store investigation shows that sync is what stalls the
  Store, it comes back to Tim as a decision rather than being fixed here.
- Building or installing a patched Millennium, for example one with PR 937.
- Diagnosing the GNOME session crash, beyond noting whether a GPU fault shows up around each hang.
- Posting anything to GitHub, whether upstream or to Gratitude's own repository.
- An automated live Steam test suite (jsdom, or Playwright attached to Steam's DevTools). The
  DevTools checks here are run by hand, with the evidence recorded.

## Constraints

- **Branch and commits.** Its own branch from `feat/config-storage` (d1ae411), proposed name
  `fix/steam-bugs`. One conventional commit per deliverable or phase, with Tim's personal git
  identity. Nothing is pushed.
- **Back up before Steam testing.** Back up `~/.config/millennium/config.json` and Gratitude's
  data files before the first Steam test, and `config.json` again before any edit to it.
- **Never uninstall Gratitude through Millennium's settings while it is the symlinked dev
  install.** Millennium follows the link and deletes the checkout, `.git` included.
- **Red then green.** Every behaviour change starts as a failing test: vitest for frontend and
  webkit logic written as pure functions (no DOM libraries), LuaUnit for the backend
  (`npm run test:lua`). For the Store and quit problems, the live reproduction is also recorded
  failing before the fix and passing after.
- **No personal data in logs, findings or drafts.** The static log privacy check stays green.
  Findings and drafted reports never carry gifter names, notes, friend names or unmasked account
  IDs, because archived plan files get committed and drafts get posted. The config check shows
  whether values are readable without printing them. Screenshots stay outside the repository.
- **Conventions.** Code comments describe behaviour, never plan or spec IDs. US English in code,
  UK English in prose. CHANGELOG entries go under Unreleased.
- **Budget for kills.** Steam hangs on quit, and that is part of what's being studied, so most
  restarts will cost a SIGKILL.

## Acceptance criteria

**Store loading:**

- After a Steam restart with Gratitude enabled, the Store finishes loading (`readyState`
  "complete", Featured and Recommended carousel present) when opened from Steam's Store tab and
  from a `steam://openurl` link, as it does with Gratitude disabled. A Community page finishes
  loading too. Checked on three separate restarts (proposed).
- The themes folder read error no longer appears in Steam's log with Gratitude enabled.
- A Store visit runs the licence sync and a Community visit runs the friends sync, confirmed by
  Gratitude's console and backend log lines.
- The sync buttons in the consent dialog, settings panel, missing data badge and gift modal still
  show their progress overlay and return to the Library.
- The cause is written down with the evidence that showed it.

**Quit hang:**

- Every quit during the work recorded as described in **Key decisions**, including at least one
  with Gratitude disabled.
- A conclusion, said as such: the hang is Millennium issue 931, it isn't, or the evidence is
  inconclusive.
- A drafted comment for issue 931 with the evidence, including the 3 second disable delay for PR
  937. If the evidence instead shows Gratitude involved, that becomes a fix decision for Tim.

**Sweep:**

- Library game pages, the Store, Community and the gift modal have each been checked with the
  DevTools console and network traffic watched, and every Gratitude error or unexpected request
  has been compared with Gratitude disabled.
- Each bug found is its own entry in the findings document, recorded as described in **Key
  decisions**.

**Carried items:**

- The Millennium security question is settled privately (see the private notes).
- The cause of the wrong app ID on the Total War: WARHAMMER III page is confirmed live.
- What a user with over 256 KB of old gift records sees today is recorded, with the choice put to
  Tim.
- An upstream report on the missing uninstall prompt is drafted, or an existing one found.

**Throughout:** existing tests keep passing, and the log privacy check stays green.

## Open questions

Tim was away when this plan was written. Until he answers, the work proceeds on the recommended
option for each question and records that it did.

1. **Fix app ID detection in this plan?** Recommended yes, as its own commit after the Store work:
   the cause is traced (sidebar icons win), it is reproduced on a known page, and the silent
   fallback to name matching hides it from users. Until Tim answers, the work confirms the cause
   live and records it like a sweep finding.
2. **Account over 256 KB: file fallback or a specific message?** Leaning towards the message. The
   case needs very long notes written before the cap, and a file fallback for one account adds a
   second storage path to the migration. Not verified: what the gift modal shows in this state
   today, which the work records first.
3. **May Claude also kill a Lua host left running after the client is killed?** Probably moot:
   research found Millennium makes the host exit when Steam dies, and no observation shows a host
   surviving a killed client (the one case on record was while the client was still hung). If one
   ever does survive, it belongs to the same hung Steam and is killed too.
4. **Below Millennium 3.3.0: keep the hooks, or drop them everywhere?** Research narrowed this:
   only v3.2.0 lacked automatic injection on Steam pages, and releases before it injected
   everywhere, so the hooks only ever helped on 3.2.x. An untested alternative for 3.2.x is a hook
   naming a file that doesn't exist, which should fail fast instead of hanging the page while
   still making it qualify for injection. Recommended for now: skip the hooks on 3.3.0 and later,
   the only change this machine can test, and leave older versions as they are. Until Tim
   answers, the fix does exactly that.
5. **Should the sweep cover more surfaces?** The sweep list is library pages, the Store,
   Community and the gift modal. The consent dialog, Gratitude's settings panel and Big Picture
   Mode aren't on it. Recommended: add the consent dialog and settings panel, since both open the
   sync links from the Store problem and get partly checked anyway. Big Picture Mode is Tim's
   call; the frontend's own guide asks for Big Picture checks after any frontend change, so any
   frontend fix here gets checked there regardless.

## Related

- [Data storage plan](../completed/2026-10-18-feat-safe-durable-data-storage/plan-data-storage.md)
  (archived 2026-10-18): the Follow-ups section the carried items came from, and background on
  millennium.config.
- [AGENTS.md](../../../AGENTS.md): Gratitude's architecture.
- [MILLENNIUM_DEVELOPMENT.md](../../../MILLENNIUM_DEVELOPMENT.md): Steam's dev mode and DevTools.
- [Millennium issue 931](https://github.com/SteamClientHomebrew/Millennium/issues/931) and
  [PR 937](https://github.com/SteamClientHomebrew/Millennium/pull/937): the upstream quit hang.
- [Millennium commit 84d9122](https://github.com/SteamClientHomebrew/Millennium/commit/84d912263ba08f07b101957481c98cb5ff7ffbb4):
  the upstream fix the backend's TODO waits for before its manual hooks can go.
