---
phase: 260915-ung
verified: 2026-09-15T23:40:00Z
status: human_needed
score: 4/7 must-haves verified (3 present, behavior-unverified — pending Shell restart)
covered_files:
  - .planning/quick/260915-ung-replace-the-multi-second-0-devices-flash-after-the-daemon-st/260915-ung-PLAN.md
  - .planning/quick/260915-ung-replace-the-multi-second-0-devices-flash-after-the-daemon-st/260915-ung-SUMMARY.md
  - CHANGELOG.md
  - po/usbee@bitcreed.us.pot
  - tests/daemon-status.test.js
  - tests/dbus-client.test.js
  - tests/forward-compat.test.js
  - usbee@bitcreed.us/src/daemon-status.js
  - usbee@bitcreed.us/src/dbus-client.js
  - usbee@bitcreed.us/src/device-store.js
  - usbee@bitcreed.us/src/popover.js
  - usbee@bitcreed.us/src/tile.js
covered_digest: "v1:sha256:df50f88958300751a379066d23a09992705e26378839867aa288c4fe9bb04584"
behavior_unverified: 3
overrides_applied: 0
behavior_unverified_items:
  - truth: "Between the daemon appearing on the bus and its first ListDevices reply landing, the tile pill reads USB / Loading… — never Nothing connected."
    test: "Restart GNOME Shell with this checkout installed, then restart usbeehive (systemctl --user restart usbeehived) and watch the Quick Settings pill for the first seconds."
    expected: "Pill reads 'USB' / 'Loading…' until the first snapshot lands, then switches to the real count (or 'Nothing connected' on a genuinely empty machine)."
    why_human: "device-store.js imports the gnome-shell resource URI for gettext, so no suite can load it and call store.tileText; the branch is pinned structurally only, and the pill itself only renders inside gnome-shell."
  - truth: "A popover opened during that window shows a Loading… row, not No USB devices attached."
    test: "During the same window, open the Quick Settings tile."
    expected: "A single non-interactive 'Loading…' row, no 'No USB devices attached', header reads the count-free 'USB devices'."
    why_human: "popover.js/tile.js build St/Clutter actors that only instantiate inside gnome-shell."
  - truth: "A popover already open when the first snapshot lands repaints itself from Loading… to the device list without the user closing and reopening it."
    test: "Open the popover during the loading window and hold it open until the daemon answers."
    expected: "The Loading… row is replaced by the device list in place, exactly once, with no flicker on subsequent snapshots."
    why_human: "Requires a live Shell; additionally, no suite exercises the _renderedLoading latch (see Anti-Patterns — coverage note), so there is no behavioral evidence at all for this one."
human_verification:
  - test: "Daemon restart during a live session: watch the pill, then open the popover, then hold the popover open across the first snapshot."
    expected: "USB / Loading… → real list; popover shows a Loading… row → repaints in place; a genuinely empty machine still ends at 'Nothing connected' / 'No USB devices attached'."
    why_human: "The tile and popover only render inside gnome-shell after a restart. Restart debt now spans i4w, ikd, mpf, unf, ung, unh."
---

# Quick Task 260915-ung: Loading state instead of a "0 devices" flash — Verification Report

**Goal:** Replace the multi-second "0 devices" flash after daemon start with a distinct
loading state, distinguishing three states, driven off existing name-watch/snapshot
plumbing, no new polling, all strings through gettext.
**Verified:** 2026-09-15
**Status:** human_needed (0 gaps; 3 truths owed to the next Shell restart)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Pill reads USB / Loading… during the window | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `device-store.js:356-363` — RUNNING branch returns `{title: _('USB'), subtitle: _('Loading…')}` *before* delegating to `deriveTileText`. Wired to the pill at `tile.js:109-113` (`changed`) and `tile.js:162-164` (initial write). State half is behaviorally proven (`dbus-client.test.js:527-529` asserts RUNNING && awaiting===true after `_onProxyOwnerAcquired`); the render half needs a Shell. |
| 2 | Popover shows a Loading… row | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `popover.js:556-565` `populateLoadingState` → `clearSection` then one `PopupMenuItem(_('Loading…'), {reactive:false, can_focus:false})`. Routed at `tile.js:296-299`. Actor construction needs a Shell. |
| 3 | A measured zero still reads Nothing connected / No USB devices attached | ✓ VERIFIED | `setDevices` sets `_snapshotReceived = true` (`device-store.js:397`) before `emit('changed')`, so the branch is skipped and `deriveTileText` runs unchanged. `deriveTileText` untouched by the diff and pinned untouched by `forward-compat.test.js:1185`. Popover copy at `popover.js:219-225` unchanged by this item. |
| 4 | A daemon restart returns both surfaces to loading (not a one-shot latch) | ✓ VERIFIED | `_setDaemonState` writes `_snapshotReceived = false` **after** the no-op early-return guard (`device-store.js:433-441`), so an idempotent `setDaemonRunning(true)` cannot re-arm while a real STOPPED→RUNNING always does. Placement pinned by a sliced-body assertion in `daemon-status.test.js:306`; re-arm exercised on the double at `dbus-client.test.js:78`. |
| 5 | A failed ListDevices does not strand either surface in Loading… | ✓ VERIFIED | Real behavioral test, passing: `dbus-client.test.js:489-514` drives `ListDevicesRemote` into an error and asserts `noteSnapshotFailed` recorded, `awaitingFirstSnapshot === false`, and `setDevices` **not** called. Implementation: `dbus-client.js:531-538` (`this._store.noteSnapshotFailed?.()`) + `device-store.js:401-421` (edge-only emit, `_devices` untouched). |
| 6 | An already-open popover repaints itself loading→loaded | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Latch present and wired: `tile.js:46` init, `tile.js:125-127` transition-only rebuild (`isOpen && _renderedLoading && !awaitingFirstSnapshot`), `tile.js:333` cleared/re-armed from the same condition the routing switch used. No suite exercises `_renderedLoading` (grep over `tests/` returns nothing) — and rendering needs a Shell. |
| 7 | No new polling timer, no new D-Bus call, no /sys or udev access | ✓ VERIFIED | `git diff -U0 5e6ad7f -- usbee@bitcreed.us/src/` → **0** added lines matching `timeout_add\|setInterval\|bus_watch_name\|ListDevicesRemote\|/sys/\|udev` (verified with `rtk proxy`, not the filtering hook). The state rides entirely on the existing name-watch → `setDaemonRunning` → `_snapshotImmediate` path. |

**Score:** 4/7 truths verified (3 present, behavior-unverified — all three are the
render-side claims that are unobservable until a GNOME Shell restart, per the operator's
standing direction; none is a defect).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `usbee@bitcreed.us/src/daemon-status.js` | `isAwaitingFirstSnapshot()` pure predicate, still zero-import | ✓ VERIFIED | Exported at line 115; `daemonState === RUNNING && snapshotReceived !== true`. Import count = **0** (raw grep). No `_()`/gettext — the only matches are the contract comment at lines 7-25. Fails closed for unknown states. |
| `usbee@bitcreed.us/src/device-store.js` | `_snapshotReceived` + `awaitingFirstSnapshot` getter + Loading… tileText branch | ✓ VERIFIED | Field at 324-328, getter at 342-348 delegating to the predicate, tileText branch at 356-363. `noteSnapshotFailed()` added at 401-421. |
| `usbee@bitcreed.us/src/popover.js` | `populateLoadingState()` export | ✓ VERIFIED | Line 556. Not an empty-state item (no command row, no button), shares the tile's msgid. |
| `po/usbee@bitcreed.us.pot` | regenerated, "163 msgids" | ✓ VERIFIED (number corrected to 164) | Raw count = **164**. `git show e37ed78 -- po/...` adds exactly one msgid — `+msgid "Loading…"` — and zero removals; `Project-Id-Version` line untouched (still `USBee`, no version); `msgfmt --check-format` clean. The plan's 163 was written against baseline `5e6ad7f`; sibling `unf` took the file to 163 first. Correctly measured rather than assumed. |

### Key Link Verification

Line numbers shifted because sibling `unh` edited the same files afterwards; every link
re-located by symbol, per the batch note. A shifted line is not a gap.

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `_setDaemonState` | `_snapshotReceived` | reset on every real transition | ✓ WIRED | `device-store.js:441`, after the guard at 434-435. |
| `setDevices` | `_snapshotReceived` | the only place it becomes true by data | ✓ WIRED | `device-store.js:397`. `noteSnapshotFailed` is the only other writer, and it asserts nothing about devices. |
| `tile.js` RUNNING branch | `populateLoadingState` | routed while awaiting | ✓ WIRED | `tile.js:296-299`; `n` left at `-1` so the header renders the count-free `_('USB devices')`. |
| `dbus-client.js` `_snapshotImmediate` catch | `noteSnapshotFailed` | concludes the awaiting state | ✓ WIRED | `dbus-client.js:538`, before the existing `logError`; optional-call as planned. |

### Cross-Item Survival Check (sibling `260915-unh`)

**CONFIRMED — the fix survives, with two independent protections.**

1. **Ownership gate in `updateDeviceRowsInPlace` (`popover.js:302-309`).** `clearSection`
   (`popover.js:51-55`) nulls `_usbeeOwnedItems` at every teardown, and
   `populateLoadingState` does **not** re-set the token. A section holding the Loading…
   row therefore fails `Array.isArray(owned)` and the function returns `null` before any
   mutation — so the `rows.length === 0 → populateDeviceRows(...)` line at `popover.js:318`,
   which is precisely what would swap `Loading…` for `_('No USB devices attached')`, is
   unreachable during the window. `unh` documents this intent in-code at `popover.js:295-301`
   and `226-234`.
2. **Loading-window guard in the filter handler (`tile.js:204`).** `if
   (this._store.awaitingFirstSnapshot === true) return;` — the only call site of
   `updateDeviceRowsInPlace` (grep over `src/`: `tile.js:211` only) returns before reaching
   it. `=== true` so an older build without the getter behaves as before.

Both are pinned by regression tests in `forward-compat.test.js:778-779` (ownership proof)
and `:792-793` (awaiting guard). `git log -S` confirms the two load-bearing lines
(`populateLoadingState(this._rowsSection)`, `_('Loading…')`) are still the ones introduced
by `b50210c` — `unh` did not rewrite them.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| daemon-status suite | `rtk proxy gjs -m tests/daemon-status.test.js` | exit 0, **138 ok**, `ALL TESTS PASSED` | ✓ PASS |
| dbus-client suite | `rtk proxy gjs -m tests/dbus-client.test.js` | exit 0, **74 ok**, `ALL TESTS PASSED` | ✓ PASS |
| forward-compat suite | `rtk proxy gjs -m tests/forward-compat.test.js` | exit 0, **292 ok**, `ALL TESTS PASSED` | ✓ PASS |
| service-probe suite | `rtk proxy gjs -m tests/service-probe.test.js` | exit 0, **57 ok**, `ALL TESTS PASSED` | ✓ PASS |
| Predicate unit truth table | `daemon-status.test.js:159-188` | RUNNING/false→true, RUNNING/true→false, STOPPED / OUT_OF_DATE / TOO_NEW / unknown / undefined → false, RUNNING/undefined→true | ✓ PASS |
| Failed ListDevices concludes the wait | `dbus-client.test.js:489-514` | `noteSnapshotFailed` recorded, awaiting cleared, `setDevices` never called | ✓ PASS |
| Flash root cause pinned | `dbus-client.test.js:516-537` | store is RUNNING && awaiting at `_onProxyOwnerAcquired`; `setDaemonRunning` ordered before `setDevices` | ✓ PASS |
| Tile/popover rendering | — | needs a live gnome-shell | ? SKIP → human |

Suite counts differ from SUMMARY's 138/74/**273**/57 only in forward-compat, because
sibling `unh` added assertions to that file afterwards. Not a discrepancy.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD` / `FIXME` / `XXX` in any of the five modified source files (raw grep, exit 1) | — | none |
| `tests/*` | — | `_renderedLoading` (truth 6's latch) is not referenced by any suite — neither structurally nor behaviorally | ⚠️ Warning | The one new mechanism with zero test coverage. The plan's own Task 2 gate only counted occurrences in `tile.js` source (3, satisfied), never in tests. A future refactor could drop the latch and every suite would stay green. Not a defect in the shipped code. |

Note on method: `rtk`'s output filtering silently zeroed one comment-stripped grep
(`_renderedLoading` read as 0). Every count-based gate in this report was re-run through
`rtk proxy` and the raw values are the ones recorded.

### Requirements Coverage

Quick task — no REQUIREMENTS.md IDs declared.

### Deferred Items

None.

### Gaps Summary

**No gaps.** All three states are genuinely distinguished in code — absent
(`daemonState !== RUNNING`, untouched existing empty states), loading
(`RUNNING && !_snapshotReceived` → `Loading…` on both surfaces), loaded
(`RUNNING && _snapshotReceived` → today's copy) — derived entirely from the existing
name-watch and snapshot plumbing with zero new timers, D-Bus calls, or `/sys`/udev access.
The re-arm is correctly placed after the idempotence guard, the failure path concludes the
wait instead of stranding it, `daemon-status.js` keeps its zero-import string-free
contract, the one new string goes through gettext as a single shared msgid with no
concatenation, and all four suites pass. The sibling `unh` in-place update path cannot
reach the Loading… row.

What is outstanding is **visual confirmation only**, and only because the tile and popover
cannot render until GNOME Shell restarts — plus the coverage warning that the
open-popover repaint latch has no test of its own.

---

_Verified: 2026-09-15_
_Verifier: Claude (gsd-verifier)_
