---
quick_id: 260910-myu
slug: fix-daemon-status-misreport-ellipsized-e
date: 2026-09-10
status: planned
---

# Quick task 260910-myu — daemon-state honesty, a readable command line, and a Start button

## Problem

Four user-reported problems against the Quick Settings popover and the
preferences window, plus one feature ask.

### P1 — "usbeehive not installed" for a daemon that IS installed (root bug)

`src/empty-state.js` `isUsbeehiveServiceInstalled()` decides installed-ness by
stat()ing three paths (`empty-state.js:73-77`):

```
${GLib.get_user_data_dir()}/systemd/user/usbeehived.service   → ~/.local/share/…
/usr/lib/systemd/user/usbeehived.service
/etc/systemd/user/usbeehived.service
```

usbeehive's own installer writes the unit to the **XDG _config_ dir**, not the
data dir — `../usbeehive/src/bin/usbeehived.rs` `user_unit_dir()` returns
`$XDG_CONFIG_HOME/systemd/user`, falling back to `$HOME/.config/systemd/user`.
That path is not in the list, and it is systemd's *highest-priority* user-unit
search path. Verified on this machine: the unit lives at
`/home/blk/.config/systemd/user/usbeehived.service`, `UnitFileState=enabled`,
`ActiveState=active`, and every one of USBee's three probe paths is absent.

So whenever the daemon is off the bus, USBee tells a correctly-installed user
that usbeehive is "not installed" and hands them a `cargo install` they do not
need.

There is also a second, real state the boolean cannot express: binary installed
(`cargo install` done) but the systemd unit never created
(`usbeehived --install-service` not run). Today that also renders as
"not installed" with the full three-step chain.

### P2 — the command line is ellipsized

`buildCommandRow()` puts the command in an `St.Entry`. St.Entry is single-line
and does not reflow; the file's own comment admits it. A truncated shell
command is the one thing in that popover the user needs verbatim. The nine
labels fixed in `d6806ed` were `St.Label`s — the command row was a different
widget and was not covered.

### P3 — the preferences window says only "Start usbeehived daemon"

`prefs.js` `setStopped()` sets that one subtitle and hides everything else. It
says nothing about whether usbeehive is installed, how to install it, or how to
start it.

### P4 — the user wants a button that starts the daemon

## Design fork evaluated: (a) extension-side StartUnit vs (b) D-Bus activation

**Recommendation: do BOTH, in that order — (b) upstream is the durable fix, (a)
is the fix USBee can ship today and is not a partial (b).**

(b) is architecturally right and belongs in usbeehive: its unit is already
`Type=dbus` with `BusName=org.usbeehive.Devices`, so all that is missing is a
`org.usbeehive.Devices.service` activation file carrying
`SystemdService=usbeehived.service`. Verified: no such file exists in
`~/.local/share/dbus-1/services/` or `/usr/share/dbus-1/services/`, and
`install_service()` in `usbeehived.rs` does not write one. That is an usbeehive
change; it is written up, not built here.

(b) does not, however, retire the extension-side work:

- It helps nobody until they upgrade usbeehive and re-run `--install-service`.
  USBee must serve users on today's 0.12.0.
- Activation fires on a *method call*. USBee deliberately watches the name
  (`Gio.bus_watch_name`) and never calls into an unowned name — calling
  speculatively to trigger activation is a different design with its own
  battery and log-noise cost.
- The "not installed / not set up / stopped" distinction (P1) and the
  wording (P2/P3) are wrong regardless of activation.

(a) is small and EGO-clean: a single async `StartUnit` method call on
`org.freedesktop.systemd1` on the **session** bus. No `Gio.Subprocess`, no
`systemctl` fork. Verified live on this machine:

- `Manager.GetUnitFileState("usbeehived.service")` → `('enabled',)`
- `Manager.GetUnitFileState("nope.service")` → `org.freedesktop.DBus.Error.FileNotFound`
- `Manager.StartUnit("usbeehived.service","replace")` → a job object path
- `Manager.StartUnit("usbee-nonexistent.service","replace")` → `org.freedesktop.systemd1.NoSuchUnit`

Both failure shapes are distinguishable and reportable, which is what makes a
visible-failure button possible.

Architecture-rule check: none of this is USB knowledge. USBee reads no `/sys`
and no udev; it stats unit files and asks systemd about its own unit. All USB
facts still arrive over `org.usbeehive.Devices5`.

## Tasks

### T1 — `src/service-probe.js`: a real install probe + the start call

New module. Imports **only** `gi://Gio` and `gi://GLib` — no gettext, no
`resource:///…` URIs — so it loads in the Shell process, the prefs process and
bare-gjs CI alike. That contract is the reason `daemon-status.js` has to stay
zero-import; a gi-only module is the next tier and is safe in all three.

- `UNIT_SEARCH_PATHS` — systemd's real user-unit search path, config dir FIRST.
- `InstallState` frozen enum: `NOT_INSTALLED` / `SERVICE_MISSING` / `INSTALLED`.
- `classifyInstall(hasUnit, hasBinary)` — pure, unit-testable.
- `probeInstallState()` — sync stat() + `GLib.find_program_in_path`, TTL-cached.
- `refreshInstallStateAsync(cb)` — asks systemd `GetUnitFileState` and corrects
  the cache, so a unit in a path we did not enumerate still resolves.
- `startDaemonUnit(cb)` — async `StartUnit`; `cb(null)` on success,
  `cb(message)` on failure.

**Files:** `usbee@bitcreed.us/src/service-probe.js` (new)

### T2 — empty states: correct routing, a wrapping command line, a Start button

- `daemon-status.js`: add `SETUP_CMD` (`usbeehived --install-service && …`) for
  the binary-present-but-no-unit state.
- `empty-state.js`:
  - `buildCommandRow()` swaps the non-reflowing `St.Entry` for a selectable,
    wrapping `St.Label` (`line_wrap = true` + `ellipsize = NONE` +
    `WrapMode.WORD_CHAR`) — the exact mechanism `d6806ed` proved works in this
    file. The copy button stays. St.Entry multi-line is unverifiable without a
    Shell restart, which this task may not do; the label wrap is already
    proven in-tree.
  - `buildEmptyStateItem()` (installed but stopped) gains a **Start usbeehive
    daemon** button with visible failure: in-flight "Starting…", D-Bus error
    text surfaced verbatim, and a 8 s watchdog for "systemd accepted the job
    but the daemon never reached the bus", pointing at `journalctl`.
  - New `buildServiceNotSetUpItem()` for `SERVICE_MISSING`.
  - `isUsbeehiveServiceInstalled()` re-exported as a thin shim over the probe
    so nothing else has to change at once.
- `popover.js`: `populateServiceNotSetUpState()`.
- `tile.js`: route the STOPPED default through the tri-state probe.
- `stylesheet.css`: code-block look for the command label; Start button style.

**Files:** `src/daemon-status.js`, `src/empty-state.js`, `src/popover.js`,
`src/tile.js`, `stylesheet.css`

### T3 — preferences window: say what is actually wrong and offer the button

`prefs.js` `setStopped()` becomes state-aware via `service-probe.js`:

- `INSTALLED` → "usbeehived is installed but not running" + **Start** button,
  with success/failure reported in the row subtitle.
- `SERVICE_MISSING` → "usbeehive is installed, but its service is not set up"
  + a copyable `SETUP_CMD` row.
- `NOT_INSTALLED` → "usbeehive is not installed" + a copyable `INSTALL_CMD` row.

The About group's single hard-coded update row generalises into one reusable
command row so all three commands share it.

**Files:** `usbee@bitcreed.us/prefs.js`

### T4 — tests

- `tests/daemon-status.test.js`: `SETUP_CMD` constants; relax the "prefs.js
  imports exactly one src/ module" guard to an allowlist of
  `daemon-status.js` + `service-probe.js`, and add a guard that
  `service-probe.js` imports only `gi://`.
- New `tests/service-probe.test.js`: real unit tests — `classifyInstall`
  truth table, `InstallState` frozen/distinct, **the config-dir path is in
  `UNIT_SEARCH_PATHS` and comes first** (the P1 regression guard), systemd bus
  coordinates, and that the module has no `_()`/resource imports.
- `.github/workflows/ci.yml`: run the new file.

**Files:** `tests/daemon-status.test.js`, `tests/service-probe.test.js` (new),
`.github/workflows/ci.yml`

### T5 — write up what usbeehive must do

`.planning/quick/260910-myu-…/260910-myu-USBEEHIVE-ASK.md` — the exact
activation-file change, why it is the durable fix, and what it does *not*
retire.

## Verification

- `gjs -m tests/daemon-status.test.js`, `tests/dbus-client.test.js`,
  `tests/forward-compat.test.js`, `tests/service-probe.test.js` — all via
  `rtk proxy` so filtered output cannot fake a pass.
- Drive the state machine synthetically: the daemon is running right now, so
  the empty states cannot be observed. `classifyInstall` is exercised directly
  in the test, and the live probe is exercised against the real filesystem.
- Pack + install per CLAUDE.md, **after** the `ls -ld` symlink pre-flight.
  Verify `src/` is in the zip and `service-probe.js` landed on disk.
- No version bump, no tag, no push. Commit to `master`.

## Out of scope

- Restarting the Shell (explicitly forbidden this run).
- Any change inside `../usbeehive` — written up only.
- A release. 2.7.1 stands; the next cut is deliberate and later.
