---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-05-12T03:24:35.129Z"
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# State: USBee

**Last updated:** 2026-05-11 (Plan 01-01 Walking Skeleton committed; Task 7 awaiting human verification)

## Project Reference

- **Core value:** A GNOME-native, glanceable answer to "is this the fast port?" and "why is my laptop charging slowly?" — without opening a terminal.
- **Current focus:** Phase 01 — Tile, Popover, Hotplug, Daemon-Missing State (v0.1)
- **Mode:** mvp
- **Granularity:** coarse
- **Workflow mode:** yolo (parallelization enabled)

## Current Position

Phase: 01 (Tile, Popover, Hotplug, Daemon-Missing State (v0.1)) — EXECUTING
Plan: 1 of 2

- **Phase:** 01 — Tile, Popover, Hotplug, Daemon-Missing State (v0.1)
- **Plan:** 01 (Walking Skeleton) — tasks 1-6 complete and committed; Task 7 (human-verify checkpoint) awaiting live `gnome-shell` smoke test
- **Status:** Plan 01-01 PAUSED at Task 7 checkpoint; Plan 01-02 not yet started
- **Progress:** [█████░░░░░] ~50% of Plan 01 acceptance gates passing automatically; manual verification pending

## Performance Metrics

| Metric | Value |
|--------|-------|
| Total v1 requirements | 34 |
| Mapped to phases | 34 (100%) |
| Orphaned | 0 |
| Phases | 2 |
| Plans drafted | 0 |
| Plans complete | 0 |
| Phase 01 P01 | 30min | 6 tasks | 13 files |

## Accumulated Context

### Decisions Locked

- **Stack:** Pure-GJS GNOME 46+ Shell extension, ESM-only. No Rust binary, no GTK4-rs, no companion service. (See `.planning/research/STACK.md`.)
- **License:** GPL-3.0 (matches GNOME ecosystem norms; explicitly different from `usbeehive`'s permissive license).
- **Distribution:** extensions.gnome.org (EGO) as a single zip produced by `gnome-extensions pack`. No Flatpak for the extension itself.
- **Min target:** GNOME Shell 46. `metadata.json` `shell-version` will declare `["46", "47", "48"]`.
- **Settings storage:** GSettings schema `org.gnome.usbee`. No TOML, no dotfiles.
- **i18n:** English strings only in v1; every user-visible string wrapped in `gettext` `_()` markers from day one. Translations deferred to v2.
- **Architecture rule:** All USB knowledge flows through `usbeehive` via D-Bus. USBee performs no `/sys` or udev access of its own.
- **D-Bus wire names (Plan 01):** `BUS_NAME='org.usbeehive.Devices'` and `OBJECT_PATH='/org/usbeehive/Devices'` (NO trailing 1); `INTERFACE_NAME='org.usbeehive.Devices1'` (the `1` is only on the interface). Verified against `../usbeehive/src/dbus.rs:290-292`; CONTEXT.md's original wording had this wrong.
- **Plan 01 IFACE_XML source (Plan 01 Task 2):** Used RESEARCH.md Option B (hand-written XML) because the daemon was not running on the dev machine and no pre-built binary was available. Every member signature verified against `../usbeehive/src/dbus.rs:197-292`. Capture a fresh `busctl --user introspect` XML when the daemon is later running and diff against the committed version.
- **Plan 01 stubs handed to Plan 02:** `DeviceStore.subhead` (Plan 02 Task 1 swaps in D-09 derivation), `populateDeviceRows` (Plan 02 Task 3 swaps in full LIST-01..06 + DIAG-01/02), and `DBusClient._onAppeared` lacks `DeviceAdded/Removed` subscriptions + 150 ms debounce (Plan 02 Task 2 adds them). Module interfaces are unchanged.

### Open Questions (validate during Phase 1 implementation, not blockers)

- Snapshot strategy on `ready`: re-snapshot on every signal vs. incremental update (default: re-snapshot).
- Whether to use the cached `DeviceCount` D-Bus property (default: ignore in v1; use array length).
- Whether `Diagnose` D-Bus method is called in v1 (default: no — `DIAG-01` text comes from the per-device diagnostic field in `SnapshotJson`/`ListDevices`).
- Icon set for degraded state (default: same symbolic + amber subtitle; revisit if a designer disagrees).

### Todos

(none — populated as plans are drafted)

### Blockers

()

- Plan 01 Task 7 awaits human verification: live gnome-shell smoke test (A daemon missing, B daemon appears, C daemon vanishes, D clean disable). See 01-01-SUMMARY.md §Awaiting Human Verification

### Risks Being Carried

- **EGO review hazards:** bundled binaries, log spam, excessive `try`/`catch` (December 2025 AI-code rule), synchronous D-Bus calls, private `_addItems`-style API. Mitigations baked into Phase 1 architecture per `.planning/research/PITFALLS.md`.
- **GJS lifecycle discipline:** lock/unlock cycle is the highest-yield manual QA gate. Mandatory before each phase exit.
- **Notification spam:** Phase 2 must implement `replaces_id` keyed by stable port ID, `CloseNotification` on `CapabilityRestored`, 2–3 s suppression window after `NameOwnerChanged` `null→owner`, and a hard daily rate cap per port.
- **Upstream dependencies pushed to `usbeehive`:** stable per-port identifier, optional `DevicesChanged` atomic-snapshot signal, optional `LastDegradationTimestamp`. Track upstream; do not work around in USBee.

## Session Continuity

### Latest Session

- **2026-05-11 — Plan 01-01 Walking Skeleton executed:**
  Committed 6 atomic task commits (`1c6e8ae`, `1a8ce26`, `e5ccd86`, `cfb6f81`, `272bb5b`, `637e274`) creating the full Phase-1 extension scaffold under `usbee@bitcreed.us/`. All plan-level automated gates pass. Task 7 (`checkpoint:human-verify`) awaits live `gnome-shell` smoke test by the user — see `.planning/phases/01-tile-popover-hotplug-daemon-missing-state-v0-1/01-01-SUMMARY.md` §Awaiting Human Verification. Plan 02 swap-in seams documented inline in `src/dbus-client.js`, `src/device-store.js`, and `src/popover.js`.
- **2026-05-11 — Roadmap creation:**
  Created `.planning/ROADMAP.md` with 2 phases, `.planning/STATE.md`, and updated the Traceability table in `.planning/REQUIREMENTS.md`. All 34 v1 requirements mapped (21 to Phase 1, 13 to Phase 2). Adopted the unanimous research recommendation from `.planning/research/SUMMARY.md`.

### Next Action

User to execute the Plan 01-01 manual smoke test (Task 7) per `01-01-SUMMARY.md` §Awaiting Human Verification (sections A–D). Upon `approved`, proceed to Plan 01-02 (live signal subscriptions, debounce, headline derivation, full bullet renderer).

### Files of Record

- `.planning/PROJECT.md` — project charter
- `.planning/REQUIREMENTS.md` — 34 v1 requirements with traceability table
- `.planning/ROADMAP.md` — 2 phases, success criteria, coverage map
- `.planning/research/SUMMARY.md` — synthesized research
- `.planning/research/STACK.md` — pure-GJS verdict + rationale
- `.planning/research/FEATURES.md` — feature inventory + MVP definition
- `.planning/research/ARCHITECTURE.md` — component map + build order + skeleton code
- `.planning/research/PITFALLS.md` — EGO + Shell-extension trap inventory
- `.planning/config.json` — coarse / yolo / parallel

---
*State initialized: 2026-05-11 after roadmap creation*
