---
quick_id: 260910-myu
slug: fix-daemon-status-misreport-ellipsized-e
date: 2026-09-10
status: complete
commits:
  - 4f88621 feat — src/service-probe.js
  - a1212ff feat — popover empty states, command wrap, Start button
  - 53fb967 feat — prefs window
  - d7f24ef test — service-probe suite + daemon-status updates + CI
  - 9f09baa i18n — regenerated .pot
  - 3c1a3b6 docs — CHANGELOG [Unreleased]
  - da4ad71 fix — Pango markup escape in Adwaita subtitles
  - 1e7f8de docs — CLAUDE.md zip count + prefs test loop
---

# Quick task 260910-myu — summary

## Already fixed vs genuinely open

The user's Shell predates `d6806ed`, so the screenshot could have been
showing already-fixed code. Checked each reported problem against the tree
rather than against the screenshot.

| Reported | Verdict |
|---|---|
| "usbeehive not installed" for an installed daemon | **Open.** `empty-state.js:73-77` |
| Ellipsized *hint* text ("This list will po…") | **Already fixed** in `d6806ed`; the labels pair `line_wrap` with `ellipsize = NONE`. The screenshot is stale for this line. |
| Ellipsized *command* line | **Open.** Different widget — `buildCommandRow()` used an `St.Entry`, which is single-line and does not reflow. `d6806ed` only touched `St.Label`s. |
| Prefs says only "Start usbeehived daemon" | **Open.** `prefs.js` `setStopped()` |
| No start-daemon button | **Open** (feature). |

One extra defect found during live verification, not reported: every command
USBee puts in an Adwaita subtitle was silently failing to render, because
Pango parses `&&` as an unterminated entity. Pre-existing since the update
row was added.

## P1 root cause

`isUsbeehiveServiceInstalled()` stat()ed three unit paths, one of which was
`$XDG_DATA_HOME/systemd/user`. usbeehive's own installer writes to
`$XDG_CONFIG_HOME/systemd/user` — `user_unit_dir()` in
`../usbeehive/src/bin/usbeehived.rs:279-291` — which is both absent from the
list and systemd's *highest-priority* user unit path. Confirmed on this
machine: unit at `/home/blk/.config/systemd/user/usbeehived.service`,
`UnitFileState=enabled`, `ActiveState=active`, all three probed paths absent.

Fixed in `src/service-probe.js`, which replaces the boolean with:

- systemd's real user-unit search path, config dir first;
- a tri-state (`NOT_INSTALLED` / `SERVICE_MISSING` / `INSTALLED`), because
  "binary installed, `--install-service` never run" is a real state that was
  also being reported as "not installed";
- `refreshInstallStateAsync()`, which asks systemd `GetUnitFileState` and
  corrects the cached answer, so a unit in a directory this list does not
  enumerate still resolves. Async because the sync render path cannot block
  on D-Bus (D-15).

## P2 — the command line

Wrapping `St.Label` with `line_wrap` + `ellipsize = NONE` +
`WrapMode.WORD_CHAR`, keeping selectability and the copy button, with the
code-block chrome moved into `stylesheet.css`.

Chosen over making `St.Entry` multi-line because the label wrap is the
mechanism `d6806ed`/`260910-ggy` already proved works in this exact file,
and this run could not restart the Shell to verify a new one. WORD_CHAR
rather than WORD because `--features=dbus` has no word break.

Copy-to-clipboard alone was rejected as sufficient: a user cannot judge
whether to run a command they cannot read.

## The (a)/(b) fork

**Recommendation: both, in that order.** (b) — usbeehive shipping a D-Bus
activation file with `SystemdService=usbeehived.service` — is the durable
fix and belongs upstream; written up in `260910-myu-USBEEHIVE-ASK.md`, not
built here. (a) was still shipped because it is a complete feature rather
than a partial (b): activation helps nobody until they upgrade usbeehive,
it only fires on a method call USBee deliberately never makes into an
unowned name, and it cannot explain a daemon that starts and dies.

(a) is EGO-clean: an async `StartUnit` on `org.freedesktop.systemd1` on the
**session** bus, never a `Gio.Subprocess` running `systemctl`. Verified live
before building: `GetUnitFileState` → `('enabled',)`, missing unit →
`FileNotFound`, `StartUnit` → a job path, missing unit → `NoSuchUnit`.

Failure is visible in three ways: the D-Bus refusal is shown with its GDBus
prefix stripped; an 8 s watchdog catches "systemd accepted the job and the
daemon exited" and names the journalctl command; and the button commits to
"Starting…" the moment it is pressed, so it can never appear to do nothing.

## Verification

All four suites pass under `rtk proxy gjs -m` (raw output, not filtered):
`daemon-status`, `dbus-client`, `forward-compat`, `service-probe`.

Beyond tests: the probe module was exercised against the live session bus,
and the preferences window was opened for real **with the daemon stopped**
(`systemctl --user stop usbeehived`, restored afterwards — `active`,
`enabled`, serving `0.12.0`). That is what caught the Pango markup bug. Note
that `org.gnome.Shell.Extensions` is D-Bus-activated, persists after the
window closes and caches its ESM modules — a reinstall alone re-runs the old
code, so the process must be killed between tests. Recorded in CLAUDE.md.

Deployed: `ls -ld` pre-flight confirmed a real directory (not a symlink);
zip is 25 entries / ~231 KB with `src/` and 14 modules; `service-probe.js`,
the markup escape and the absence of `new St.Entry(` all confirmed on disk;
`version-name` still `2.7.1`, `version` still `12`. No tag, no push. The
Shell reports the extension INACTIVE, which is the expected consequence of
replacing files under a loaded extension — it stays in `enabled-extensions`
and loads at next login.

## For a human to audit

- The wrapping `St.Label` command row and the Start button have never been
  rendered — the popover needs a Shell restart. Both use mechanisms verified
  elsewhere (label wrap in-tree, StartUnit against the live bus), but the
  visual result is unconfirmed.
- The 8 s watchdog is a judgement call. A cold `cargo`-built daemon on a
  loaded machine could conceivably exceed it and show a false "did not reach
  the bus" — recoverable (the message is advisory, the daemon appearing
  still repaints the popover), but the number is inferred, not measured.
- Relaxing "prefs.js imports exactly one src/ module" to a two-module
  allowlist is a deliberate loosening of a C5 guard. The reason for the rule
  (no `resource:///` URIs in the prefs process) still holds for both allowed
  modules, and both directions are now pinned by tests.
