---
phase: 01-tile-popover-hotplug-daemon-missing-state-v0-1
plan: "02"
subsystem: gnome-shell-extension
tags:
  - gnome-shell
  - extension
  - gjs
  - d-bus
  - quick-settings
  - lifecycle
dependency_graph:
  requires:
    - 01-01  # Walking Skeleton — bus watch, lazy proxy, SignalRegistry, indicator
  provides:
    - D-09 full 4-tier tile subtitle derivation
    - D-06 DeviceAdded / DeviceRemoved live hotplug subscriptions
    - D-10 150 ms trailing-edge debounce (N signals -> 1 snapshot)
    - LIST-01..06 + DIAG-01..02 multi-bullet per-device popover rows
  affects:
    - tile.js (consumes store.subhead — unchanged interface, richer output)
    - popover.js (called from tile.js on open-state-changed — same call site, expanded render)
tech_stack:
  added: []
  patterns:
    - "GLib.timeout_add trailing-edge debounce (single shared _debounceId, reset on every signal)"
    - "proxy.connectSignal (D-Bus signals) vs .connect (GObject notifies) disambiguation"
    - "St.BoxLayout({vertical: true}) + per-bullet St.Label with clutter_text.line_wrap"
    - "Regex-based bullet parsing (WATT_RE / DIRECTION_RE / USB_VERSION_RE / SPEED_RE)"
key_files:
  created: []
  modified:
    - usbee@bitcreed.us/src/device-store.js
    - usbee@bitcreed.us/src/dbus-client.js
    - usbee@bitcreed.us/src/popover.js
decisions:
  - "Debounce uses single shared _debounceId reset-on-arrival pattern; N registry entries accumulate but all but the last are harmless no-ops on dispose (PITFALLS.md §9 — accepted)"
  - "Tier 2 Tier requires BOTH USB version label AND numeric speed; partial bullet matches fall through to Tier 3 (RESEARCH §Headline Derivation edge cases)"
  - "Task 4 (lifecycle test matrix) deferred to human verification — requires live gnome-shell session; cannot run inside worktree subagent context"
metrics:
  duration: "~20 minutes (implementation only; Task 4 deferred)"
  completed: "2026-05-12T17:25:39Z"
  tasks_completed: 3
  tasks_deferred: 1
  files_modified: 3
---

# Phase 01 Plan 02: Live Behaviour — Subtitle, Hotplug, Diagnostics Summary

**One-liner:** Full 4-tier D-09 tile subtitle (wattage/link-speed/count/empty), live DeviceAdded/DeviceRemoved subscriptions with 150 ms trailing-edge debounce, and multi-bullet line-wrapped diagnostic popover rows — USBee v0.1 feature-complete for Phase 1.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Full 4-tier D-09 headline derivation in DeviceStore | bdd7d3f | `src/device-store.js` |
| 2 | Subscribe DBusClient to DeviceAdded/DeviceRemoved with 150 ms debounce | 9a2aeb2 | `src/dbus-client.js` |
| 3 | Multi-bullet device rows with line-wrapped diagnostics | 0abe35e | `src/popover.js` |
| 4 | Full lifecycle test matrix (Tests 1, 3, 4, 5) | — | pending-human-verify |

## Task 4: Deferred to Human Verification

Task 4 is a `checkpoint:human-verify` requiring a live `gnome-shell` session (enable/disable x10 cycle, daemon stop/start, disable-while-popover-open, combined stress run). These tests cannot be automated inside a worktree subagent context. The orchestrator must surface this checkpoint to the user after the agent returns.

The lifecycle test matrix from RESEARCH.md §Lifecycle Test Matrix (Tests 1, 3, 4, 5 + debounce burst observation + manual lock/unlock x3) must be run manually in a live GNOME Shell session before declaring Phase 1 complete.

## What Was Built

### Task 1 — DeviceStore headline derivation (D-09)

Replaced the Plan-01 stub `subhead` getter in `src/device-store.js` with the full 4-tier algorithm:

- **Tier 1** — Active USB-C charging port (`category === 'TypeCPort' && status === 'Charging'`): ranked by wattage desc. Format: `Charging: {N} W in` / `Powering: {N} W out` / `USB-C: {N} W` / `USB-C: charging`
- **Tier 2** — Fastest attached link: sorted by bps desc. Format: `{USB version} · {speed}` using U+00B7 middle dot (not hyphen-minus)
- **Tier 3** — Count of attached devices (`status !== 'Empty'`): `1 device` / `{N} devices`
- **Tier 4** — `Nothing connected`

Four pure-function helpers added: `parseWatts`, `parseDirection`, `parseLinkSpeed`, `formatWatts`. All use bounded regex patterns — no nested quantifiers, no ReDoS risk (STRIDE T-02-02). `deriveSubtitle` is exported for plan-level gate verification.

Public surface (`devices`, `daemonRunning`, `subhead`, `setDevices`, `setDaemonRunning`, `'changed'` signal) is unchanged — `tile.js` continues to work without modification.

### Task 2 — DBusClient hotplug subscriptions + debounce (D-06, D-10)

Extended `src/dbus-client.js`:

- `this._debounceId = 0` initialised in constructor
- Two `proxy.connectSignal(...)` calls added in `_onAppeared` success branch (after owner-notify wire-up): `DeviceAdded` and `DeviceRemoved`; both tracked via `_registry.addProxySignal`
- New `_scheduleRefresh()` method: trailing-edge 150 ms debounce via single shared `_debounceId`. Every incoming signal removes the pending timer and arms a new one, so a burst of N signals collapses to exactly 1 `ListDevices` call + 1 store mutation + 1 tile repaint
- New timer tracked via `_registry.addTimeout` so `disable()` clears any in-flight callback (RESEARCH §Validation 23)
- First snapshot on appearance still bypasses debounce (existing `_snapshotImmediate()` call in `_onAppeared` preserved — RESEARCH §Pitfall G)
- No `CapabilityDegraded` / `CapabilityRestored` subscriptions (Phase 2 NOTIF work — RESEARCH §Pitfall F)

### Task 3 — Popover multi-bullet rows (LIST-01..06, DIAG-01..02)

Replaced `populateDeviceRows` in `src/popover.js`:

- Private `buildDeviceRow(device)` helper creates one `PopupMenuItem` per device with `device.headline` as the top-line label
- One `St.Label` per entry in `device.bullets[]` inside `St.BoxLayout({vertical: true, x_expand: true, style_class: 'body'})`
- Each label: `clutter_text.line_wrap = true` + `clutter_text.line_wrap_mode = 2` (Pango WORD_CHAR) for DIAG-02 multi-sentence diagnostic wrapping
- All text set via `.text = ...` — no markup APIs (STRIDE T-02-01; untrusted D-Bus data)
- No `gi://Gtk` or `gi://Adw` imports (PACK-05)
- `populateEmptyState` preserved from Plan 01

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written for Tasks 1-3.

### Deviation: connectSignal call site formatting (cosmetic only)

The plan's paste-ready code placed `connectSignal('DeviceAdded', ...)` on a single line. My initial edit split the call across two lines which caused the automated `grep -q "connectSignal('DeviceAdded'"` gate to fail. Fixed by reformatting to `connectSignal('DeviceAdded', \n    ...)` with the signal name on the same line as the method — no behavioral change.

## Plan-Level Verification Gates

All 26 automated invariants passed:

- Architectural: no `gi://Gtk`, no `gi://Adw`, no sync D-Bus, no subprocess, no legacy imports, no `_addItems`
- Headline derivation: `deriveSubtitle`, `TypeCPort` filter, `Charging` status, U+00B7 middle dot
- Live-update: `DeviceAdded`, `DeviceRemoved`, no `CapabilityDegraded/Restored`, `_scheduleRefresh`, `GLib.timeout_add`, 150ms priority, `addTimeout`
- Popover: `line_wrap`, `line_wrap_mode = 2`, `device.bullets`, no markup APIs
- Wire-shape: `BUS_NAME`, `INTERFACE_NAME` unchanged
- Indicator ownership: `addExternalIndicator` in exactly 1 file (`extension.js`)

## Notes for Phase 2

**Debounce coalescing:** The `_scheduleRefresh` trailing-edge debounce is a shared single-source pattern. Phase 2 NOTIF work (`CapabilityDegraded`) should NOT reuse this debounce — capability degradation notifications must fire promptly (not delayed 150 ms). Phase 2 should add an independent signal subscription without debouncing for `CapabilityDegraded`.

**Bullet-format regex parsing (Q1):** No real-world testing was performed in this plan (Task 4 is deferred). RESEARCH Open Question Q1 (switch from regex parsing to `SnapshotJson` structured parsing) remains open pending lifecycle test observations. If real daemon bullets differ significantly from the expected format, the regex helpers in `parseWatts` / `parseLinkSpeed` may produce empty results and the headline will fall through to Tier 3. `SnapshotJson` migration is the recommended remediation if Q1 proves to be an issue.

**Lock/unlock test (Test 2):** Non-automatable — must be run manually before declaring Phase 1 complete. Result: PENDING.

**[ASSUMED A6] GetNameOwner fallback:** Not applied — not needed unless Test 3 step 4 (auto-recovery) fails in practice. The code path is documented in Task 4's how-to-verify for the user to apply if needed.

**DBusClient._proxy and _debounceId after disable():** By design, `disable()` calls `SignalRegistry.dispose()` which removes all registered sources. `this._proxy` is set to null in `stop()` (called from `disable()`). `this._debounceId` is not explicitly zeroed in `stop()` but the timer source is removed by the registry, so the callback will never fire after dispose.

**Performance:** No performance observations available — Task 4 deferred. Open Question Q3 (ListDevicesAsync round-trip time under 10-signal burst) remains open.

**Known Stubs:** None introduced in this plan. The D-09 algorithm is fully implemented; `device.icon` is intentionally omitted (Phase 1 deferral per RESEARCH §Daemon Wire Shape — deferred to v1.x with `PopupImageMenuItem`).

## Threat Flags

No new threat surface introduced beyond what is documented in the Plan 02 threat model. T-02-01 through T-02-06 are all mitigated or accepted per the plan's STRIDE register.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `usbee@bitcreed.us/src/device-store.js` exists | FOUND |
| `usbee@bitcreed.us/src/dbus-client.js` exists | FOUND |
| `usbee@bitcreed.us/src/popover.js` exists | FOUND |
| `01-02-SUMMARY.md` exists | FOUND |
| commit bdd7d3f (Task 1) | FOUND |
| commit 9a2aeb2 (Task 2) | FOUND |
| commit 0abe35e (Task 3) | FOUND |
| No unexpected file deletions | PASS |
