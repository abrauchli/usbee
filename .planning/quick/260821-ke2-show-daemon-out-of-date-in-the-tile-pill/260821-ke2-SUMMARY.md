---
phase: quick-260821-ke2
plan: 01
subsystem: daemon-state-surfacing
status: complete
tags: [daemon-state, version-gate, i18n, clipboard, prefs, popover]

requires:
  - "usbeehive daemon exposing a readable Version property on org.usbeehive.Devices5"
provides:
  - "usbee@bitcreed.us/src/daemon-status.js — zero-import module shared by the Shell process, the prefs process and bare-gjs CI"
  - "DeviceStore tri-state daemon state (running / stopped / out-of-date) + detected version"
  - "DBusClient._applyVersionGate() — single write path for the out-of-date state"
  - "populateOutOfDateState(section, detectedVersion)"
  - "buildCommandRow(command) — entry + St.Clipboard copy button"
  - "prefs About group: gated daemon version + copyable Update command row"
affects:
  - "usbee@bitcreed.us/src/dbus-client.js"
  - "usbee@bitcreed.us/src/device-store.js"
  - "usbee@bitcreed.us/src/tile.js"
  - "usbee@bitcreed.us/src/popover.js"
  - "usbee@bitcreed.us/src/empty-state.js"
  - "usbee@bitcreed.us/prefs.js"
  - "po/usbee@bitcreed.us.pot"

tech-stack:
  added: []
  patterns:
    - "Zero-import module as the cross-process sharing mechanism (Shell process / prefs process / bare-gjs CI)"
    - "Store-owned enum replacing a boolean + a private per-widget latch"
    - "Source-level structural guards in gjs tests for files that cannot be imported under bare gjs"
    - "Per-actor Set of pending GLib source ids, drained on 'destroy'"

key-files:
  created:
    - "usbee@bitcreed.us/src/daemon-status.js"
    - "tests/daemon-status.test.js"
  modified:
    - "usbee@bitcreed.us/src/dbus-client.js"
    - "usbee@bitcreed.us/src/device-store.js"
    - "usbee@bitcreed.us/src/tile.js"
    - "usbee@bitcreed.us/src/popover.js"
    - "usbee@bitcreed.us/src/empty-state.js"
    - "usbee@bitcreed.us/src/label-table.js"
    - "usbee@bitcreed.us/prefs.js"
    - "usbee@bitcreed.us/stylesheet.css"
    - "tests/dbus-client.test.js"
    - ".github/workflows/ci.yml"
    - "po/usbee@bitcreed.us.pot"
    - "CHANGELOG.md"

decisions:
  - "DaemonState lives in daemon-status.js, not device-store.js, because dbus-client.js must keep importing only gi:// modules — importing device-store.js would pull the gnome-shell resource URI in and break tests/dbus-client.test.js under bare-gjs CI (C4)."
  - "'daemon-too-old' stays parameterless. The detected version travels through the store, which is the single source of truth the whole point of this task establishes; a second channel would reintroduce the disagreement being fixed."
  - "daemonRunning became a derived getter rather than being deleted, so all existing call sites (tile checked, DBusClient guards, tests) needed no changes."
  - "The _onVanished idempotency guard was re-keyed from !daemonRunning to daemonState === STOPPED — the old predicate was already false in the out-of-date state, which is what left the store stuck there."
  - "Both clipboard buttons write a module constant, never interpolated data (T-ke2-02), and no command is ever executed (T-ke2-03 / D-18 / EGO PACK-05)."
  - "Two translator comments that existed only inside the old .pot were re-homed as 'Translators:' source comments rather than hand-edited back into the template, so they survive future regenerations."

metrics:
  duration: "~35 min"
  completed: 2026-08-21

actuals:
  tokens: 41000
  tasks: 3
  commits: 3
---

# Quick Task 260821-ke2: Daemon Out of Date in the Tile Pill — Summary

Collapsed two competing sources of daemon state into one store-owned
tri-state, then used it to name the required *and* detected usbeehive
version wherever the version gate rejects a daemon — with copy buttons on
every command shown, in both processes.

## What Was Built

**Task 1 — one daemon state, end to end** (`3346345`)

- New `usbee@bitcreed.us/src/daemon-status.js`: a module with **zero
  imports**, which is the only shape that loads in the gnome-shell
  process, the separate preferences process, and bare `gjs` in CI. It
  exports `MIN_USBEEHIVE_VERSION` (still `'0.10.0'`), `isVersionAtLeast`
  (moved verbatim, still fail-closed), a frozen `DaemonState`
  (`running` / `stopped` / `out-of-date`) and `UPDATE_CMD`.
- `DeviceStore` replaced `_daemonRunning` with `_daemonState` +
  `_daemonVersion`, exposed `daemonState` / `daemonVersion` getters, and
  redefined `daemonRunning` as a derived getter so no existing call site
  changed. `tileText` became a switch whose `OUT_OF_DATE` branch reads
  **"Daemon out of date"** and whose `default` branch fails closed to
  "Daemon not running".
- `DBusClient` extracted the gate into `_applyVersionGate()`, which calls
  `store.setDaemonOutOfDate(version)` as the single write path, and
  re-keyed the `_onVanished` idempotency guard to `DaemonState.STOPPED`.
- `tile.js` deleted its private `_daemonTooOld` latch and now routes
  `_rebuildPopover()` from `store.daemonState`; `daemon-too-old` and
  `ready` collapsed to pure repaint triggers.
- The out-of-date popover item now renders
  "Requires usbeehive 0.10.0 or newer — detected 0.11.0", falling back to
  "detected unknown" when the version is unreadable.

**Task 2 — copy button on every command line** (`32760d7`)

- One private `buildCommandRow(command)` in `empty-state.js` now backs all
  three daemon empty states: the existing read-only-but-selectable
  `St.Entry` (now `x_expand`) plus an `St.Button` writing to
  `St.Clipboard`, flashing `object-select-symbolic` for 1.5 s.
- Every pending feedback timeout is tracked in a per-row `Set` and removed
  on the button's `destroy` signal (T-ke2-04) — the popover section is torn
  down on each rebuild, so an orphaned source would raise GLib-CRITICAL on
  the mandatory lock/unlock QA gate.
- `UPDATE_CMD` moved out of this file into the shared module and grew its
  second half: `cargo install usbeehive --features=dbus && systemctl
  --user restart usbeehived`.

**Task 3 — prefs, .pot, CHANGELOG** (`02a14c4`)

- `prefs.js` imports `./src/daemon-status.js` (its only `src/` import) and
  applies the same gate. The About daemon row now distinguishes accepted /
  reported-but-rejected / unreadable, and a new **Update command** row with
  a GTK4 clipboard copy button appears only when the gate fails.
- Regenerated `po/usbee@bitcreed.us.pot`; new `## [Unreleased]` CHANGELOG
  section.

## Verification

| Check | Result |
|-------|--------|
| `gjs -m tests/daemon-status.test.js` | ALL TESTS PASSED (74 assertions) |
| `gjs -m tests/dbus-client.test.js` | ALL TESTS PASSED (extended with 20 new assertions) |
| `node --check` on all `src/*.js` + `prefs.js` | clean |
| `daemon-status.js` has no import statements | verified in test + by grep |
| `dbus-client.js` imports only `gi://` + `./daemon-status.js` | verified in test |
| `.pot` carries the new msgids | "Daemon out of date", "Copy command", "Update command", "unknown", "Requires usbeehive %s or newer — detected %s" all present |
| `MIN_USBEEHIVE_VERSION` still `0.10.0` | asserted in the test suite as a C1 guard |
| `metadata.json` unchanged | `git diff HEAD` empty |
| `venv/bin/shexli` EGO pre-check | **0 errors**, 1 warning + 1 manual_review (see below) |
| CI runs both suites | `.github/workflows/ci.yml:52-53` |

**Not run — manual QA (GNOME Shell UI cannot be asserted from a script).**
The plan's six-step manual matrix in `<verification>` remains outstanding,
in particular the deliberate out-of-date repro (temporarily setting the
*installed* copy's `MIN_USBEEHIVE_VERSION` to `'99.0.0'`), the
out-of-date → vanish transition, and the lock/unlock lifecycle gate after
clicking a copy button. These need a Shell reload and a human at the
screen. Task 3 also carried a `<human-check>` on the preferences window
(no markup artifacts in the daemon row; Update command row visible only
when the gate fails).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Structural import check missed multi-line imports**

- **Found during:** Task 1 verification
- **Issue:** The `daemon-status.test.js` guard "dbus-client.js imports are
  all gi:// or ./daemon-status.js" split the source by line, so the wrapped
  `import {DaemonState, …}\n    from './daemon-status.js';` statement failed
  the check — a false failure in the test, not a defect in the source.
- **Fix:** Added an `importSpecifiers(src)` helper matching
  `import … from '<spec>'` across newlines; both the `dbus-client.js` and
  the `prefs.js` import-scope guards now use it.
- **Files modified:** `tests/daemon-status.test.js`
- **Commit:** `3346345`

**2. [Rule 2 - Missing critical functionality] Regeneration would have
silently destroyed two translator comments**

- **Found during:** Task 3
- **Issue:** The committed `.pot` carried two `#.` translator comments
  ("Tile subtitle when the sink requests less than its PD contract
  allows…" and "Row value for cable.no_emarker=true…") whose text exists
  **nowhere in the source tree** — they had been hand-added to the template
  or came from a since-deleted source comment. The plan's `xgettext`
  invocation drops them, and the plan also forbids hand-editing the
  template afterwards, so translator context would have been lost with no
  way to get it back.
- **Fix:** Re-homed both as `// Translators:` comments above their strings
  in `src/device-store.js` and `src/label-table.js`, and regenerated with
  `--add-comments=Translators:` so they now survive every future
  regeneration.
- **Files modified:** `usbee@bitcreed.us/src/device-store.js`,
  `usbee@bitcreed.us/src/label-table.js`, `po/usbee@bitcreed.us.pot`
- **Commit:** `02a14c4`
- **Note:** `src/label-table.js` was not in the plan's `files_modified`.
  The change there is a three-line comment only — no logic touched.

### Expected, not a deviation

The regenerated `.pot` grew from 68 to 98 msgids. The template had gone
stale since 2.2.0 (STATE.md's own next-action list flagged "re-run after
any further string churn"), so this pass also absorbed the accumulated
strings from quick tasks 260526-c6p, 260526-dmj and 260526-i7q. Three
msgids disappeared: `"Cable current"` and `"USB bus power"` were renamed by
260526-dmj, and the bare `"usbeehived"` fallback subtitle was replaced by
this task's three explicit prefs branches.

## Known Stubs

None. Every surface the plan named is wired to real data.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns or schema
changes were introduced. The mitigations the plan's threat register
assigned were all implemented:

| Threat | Mitigation as shipped |
|--------|----------------------|
| T-ke2-01 | Version clamped to 32 chars in `empty-state.js`; clamped **and** `GLib.markup_escape_text()`-escaped in `prefs.js` before reaching an Adwaita subtitle |
| T-ke2-02 | Both copy buttons write module constants — no interpolation path into the clipboard |
| T-ke2-03 | Command displayed and copied only; no `Gio.Subprocess`, no spawn |
| T-ke2-04 | Pending `GLib.timeout_add` sources removed on `destroy` (Shell) and `close-request` (prefs) |

## EGO Pre-check Findings

`venv/bin/shexli` reports **0 errors**, so nothing here blocks a
submission, but two findings are worth carrying forward given the project's
pending first EGO upload:

1. **EGO-A-005 `manual_review` (introduced by this task)** — "Direct
   clipboard access via `St.Clipboard.get_default()` requires reviewer
   scrutiny", at `src/empty-state.js:159`. This is inherent to the feature
   the plan specified and is a *manual_review* class, not an error. The
   guidelines link is
   `https://gjs.guide/extensions/review-guidelines/review-guidelines.html#clipboard-access-must-be-declared`.
   The submission notes should state plainly that the extension writes only
   fixed module-constant shell commands to the clipboard, on explicit user
   click, and never reads the clipboard.
2. **EGO-P-006 `warning` (pre-existing, out of scope)** — a compiled
   `schemas/gschemas.compiled` is shipped in the extension directory.
   Untouched by this task; logged here so it is not lost before the EGO
   upload.

## Documented Follow-ups — deliberately NOT implemented

These come from the plan's `<constraints_and_followups>` and were out of
scope by design.

- **F1 — the observed out-of-date state is very likely a false positive.**
  usbeehive 0.11.0 ≥ 0.10.0, so the gate should pass. The most likely
  trigger is `this._proxy.Version` reading `undefined` at
  proxy-construction time, which fail-closes to `daemon-too-old`. After
  this task the popover and prefs say "detected unknown" / "version
  unknown", which makes the misdiagnosis **legible instead of silent** —
  that visibility was the goal here. A real fix (re-reading `Version` via
  `get_cached_property` after `g-properties-changed`, or a `GetRemote`
  fallback) is still needed and is not done.
- **F2 — the gate is not re-applied on owner re-acquire.** Restarting a
  genuinely too-old daemon flips the store to running without a re-check.
  Unchanged by design (C3): the proxy's cached `Version` may not have
  refreshed when `notify::g-name-owner` fires, and a fail-closed read there
  would strand a healthy daemon in the out-of-date state with nothing left
  to re-drive it.

## Self-Check: PASSED

- `usbee@bitcreed.us/src/daemon-status.js` — FOUND
- `tests/daemon-status.test.js` — FOUND
- Commit `3346345` — FOUND
- Commit `32760d7` — FOUND
- Commit `02a14c4` — FOUND
