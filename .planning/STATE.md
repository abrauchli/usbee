---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Devices2 wire-shape migration
status: planning
last_updated: "2026-05-14T02:15:04.116Z"
last_activity: 2026-05-14
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 3
  completed_plans: 0
  percent: 0
---

# State: USBee

**Last updated:** 2026-05-14 (milestone v2.0 opened — Phase 04 Devices2 migration roadmapped)

## Project Reference

- **Core value:** A GNOME-native, glanceable answer to "is this the fast port?" and "why is my laptop charging slowly?" — without opening a terminal.
- **Current focus:** Phase 04 — devices2-wire-shape-migration (v2.0)
- **Mode:** mvp
- **Granularity:** coarse
- **Workflow mode:** yolo (parallelization enabled)

## Current Position

Phase: 04 — Devices2 wire-shape migration
Plan: 3 plans drafted (04-01: 5 tasks, 04-02: 14 tasks, 04-03: 8 tasks) — all PASS plan-checker
Status: Ready for execution — `/gsd-execute-phase 4`
Last activity: 2026-05-14 — Plan-checker PASS after B-1 (atomic-commit) + B-2 (bottleneck coverage) fixes landed in `60effc0`

## Performance Metrics

| Metric | Value |
|--------|-------|
| Total requirements | 55 (34 v1.0 + 5 v1.1 + 16 v2.0) |
| Mapped to phases | 55 (100%) |
| Orphaned | 0 |
| Phases | 4 (3 complete, 1 planned + ready) |
| v2.0 plans queued | 3 (5 + 14 + 8 = 27 tasks) |
| v2.0 plans complete | 0 |
| Plan-checker | PASS (post B-1/B-2 fix, 2026-05-14) |

## Accumulated Context

### Decisions Locked

- **Stack:** Pure-GJS GNOME 46+ Shell extension, ESM-only. No Rust binary, no GTK4-rs, no companion service. (See `.planning/research/STACK.md`.)
- **License:** GPL-3.0 (matches GNOME ecosystem norms; explicitly different from `usbeehive`'s permissive license).
- **Distribution:** extensions.gnome.org (EGO) as a single zip produced by `gnome-extensions pack`. No Flatpak for the extension itself.
- **Min target:** GNOME Shell 46. `metadata.json` `shell-version` will declare `["46", "47", "48"]`.
- **Settings storage:** GSettings schema `us.bitcreed.usbee`. No TOML, no dotfiles. (`org.gnome.*` is GNOME-endorsement namespace, not appropriate for a third-party extension; renamed 2026-05-12.)
- **i18n:** English strings only in v1; every user-visible string wrapped in `gettext` `_()` markers from day one. Translations deferred to v2.
- **Architecture rule:** All USB knowledge flows through `usbeehive` via D-Bus. USBee performs no `/sys` or udev access of its own.
- **D-Bus wire names (Plan 01):** `BUS_NAME='org.usbeehive.Devices'` and `OBJECT_PATH='/org/usbeehive/Devices'` (NO trailing 1); `INTERFACE_NAME='org.usbeehive.Devices1'` (the `1` is only on the interface). Verified against `../usbeehive/src/dbus.rs:290-292`; CONTEXT.md's original wording had this wrong.
- **Plan 01 IFACE_XML source (Plan 01 Task 2):** Used RESEARCH.md Option B (hand-written XML) because the daemon was not running on the dev machine and no pre-built binary was available. Every member signature verified against `../usbeehive/src/dbus.rs:197-292`. Capture a fresh `busctl --user introspect` XML when the daemon is later running and diff against the committed version.
- **Plan 01 stubs handed to Plan 02:** `DeviceStore.subhead` (Plan 02 Task 1 swaps in D-09 derivation), `populateDeviceRows` (Plan 02 Task 3 swaps in full LIST-01..06 + DIAG-01/02), and `DBusClient._onAppeared` lacks `DeviceAdded/Removed` subscriptions + 150 ms debounce (Plan 02 Task 2 adds them). Module interfaces are unchanged.
- **Devices2 cross-team spec locked (2026-05-13):** Outcome of multi-round negotiation with usbeehive; full wire shape, machine-key vocabulary, enum extensibility convention, and "NO backwards compatibility" hard rule recorded in `.planning/todos/pending/2026-05-14-migrate-to-usbeehive-devices2-wire-shape.md` (commit 724c22a). Daemon implementation matches the spec verbatim (`../usbeehive` commit `5e216cd`).
- **Devices2 INTERFACE_NAME bump:** `org.usbeehive.Devices1` → `org.usbeehive.Devices2`. `BUS_NAME` and `OBJECT_PATH` unchanged. Hard cut; the previous "supports both" was rejected upstream and downstream.

### Open Questions (v2.0 — surface during Plan 04-01)

- `MIN_USBEEHIVE_VERSION` constant value. usbeehive Cargo.toml currently reads `0.5.1` (unchanged from prior release; Devices2 commit landed on top without a version bump); CHANGELOG section is `[Unreleased]`. Assumption pending confirmation: usbeehive will be released as `0.6.0` to carry Devices2.
- `primary_driver == ""` UI treatment: badge on the device row vs. note in the detail panel vs. ignore for v2.0. Decided during Plan 04-01.
- `device_subclass` rendering: append to row title (`"Storage · SSD"`), surface only in the detail panel, or ignore for v2.0 (subclass-aware icons explicitly out per CHANGELOG). Decided during Plan 04-01.
- Adwaita symbolic icon picks for the four daemon `device_class` variants without an obvious fit: `SmartcardReader`, `Bluetooth`, `Serial`, `VideoCapture`. Decided during Plan 04-01 icon audit.

### Todos

- `.planning/todos/pending/2026-05-14-migrate-to-usbeehive-devices2-wire-shape.md` — full v2.0 phase context (locked wire spec + hard "no compat" rule). Tagged for Phase 4 in step 10.5.

### Blockers

()

- Pre-Devices2 orphan `.planning/phases/01-tile-popover-hotplug-daemon-missing-state-v0-1/01-RESEARCH.md` (1386 lines, untracked) was wiped by `gsd-sdk query phases.clear` at milestone switch (2026-05-14). Never committed; not recoverable from git. Low-stakes loss — Phase 01 closed; historical-only value.

### Risks Being Carried

- **EGO review hazards:** bundled binaries, log spam, excessive `try`/`catch` (December 2025 AI-code rule), synchronous D-Bus calls, private `_addItems`-style API. Mitigations baked into Phase 1 architecture per `.planning/research/PITFALLS.md`.
- **GJS lifecycle discipline:** lock/unlock cycle is the highest-yield manual QA gate. Mandatory before each phase exit.
- **Notification spam:** Phase 2 must implement `replaces_id` keyed by stable port ID, `CloseNotification` on `CapabilityRestored`, 2–3 s suppression window after `NameOwnerChanged` `null→owner`, and a hard daily rate cap per port.
- **Upstream dependencies pushed to `usbeehive`:** stable per-port identifier, optional `DevicesChanged` atomic-snapshot signal, optional `LastDegradationTimestamp`. Track upstream; do not work around in USBee.

## Session Continuity

### Latest Session

- **2026-05-14 — Milestone v2.0 opened + Phase 04 roadmapped:**
  Cross-team Devices2 wire-shape spec locked through multi-round negotiation with usbeehive (recorded as a pending todo); usbeehive shipped the matching daemon implementation on master (`5e216cd`). Captured the migration intent + locked spec + "NO backwards compatibility" hard rule as a phase seed todo (`724c22a`). Switched PROJECT.md to v2.0, reset STATE.md frontmatter via `state.milestone-switch`, cleared the previous milestone's phase directories, added Phase 04 to ROADMAP.md with 3 plans (prep & UX, wire cutover, release), added 16 v2.0 requirements (WIRE × 4, CLEAN × 3, DISP × 5, COMPAT × 2, REL × 3) to REQUIREMENTS.md with full traceability.

- **2026-05-13 — Phase 03 complete:**
  v1.1 UI rework shipped — accordion popover, class icons, issue-first sort, Adwaita-coherent detail panel. EGO not submitted (held for v2.0 first submission per Devices2 release strategy).

- **2026-05-12 — Phase 02 complete:**
  Notifications + preferences + EGO scaffolding shipped as v1.0; zip held from EGO submission.

- **2026-05-11 — Phase 01 complete + roadmap created:**
  Walking skeleton + live device list landed under `usbee@bitcreed.us/`. Tile, popover, hotplug, daemon-missing state all working.

### Next Action

Run `/gsd-plan-phase 04` (or `/gsd-discuss-phase 04` first if any of the captured-todo decisions need to be revisited live). All decisions needed for planning are already locked in the seed todo; expect the planner to surface the daemon-version constant and the four §Open-Questions UX picks as Plan 04-01 deliverables rather than mid-plan blockers.

**Pending — post-EGO-upload only (do NOT block submission on this):**

- **Update repo `homepageUrl` once the EGO extension ID is assigned.** Set it to a placeholder `https://extensions.gnome.org/extension/` during `gh repo create`, but EGO URLs use `https://extensions.gnome.org/extension/<id>/<slug>/`. After uploading to https://extensions.gnome.org/upload/ and getting the assigned ID, run:
  ```bash
  gh repo edit abrauchli/usbee --homepage "https://extensions.gnome.org/extension/<ID>/<slug>/"
  ```
  Doesn't affect EGO submission itself — purely cosmetic for the GitHub repo page.

### Files of Record

- `.planning/PROJECT.md` — project charter (now reflects v2.0 milestone)
- `.planning/REQUIREMENTS.md` — 55 requirements with traceability table
- `.planning/ROADMAP.md` — 4 phases, success criteria, coverage map
- `.planning/todos/pending/2026-05-14-migrate-to-usbeehive-devices2-wire-shape.md` — v2.0 phase seed: locked Devices2 wire spec + "no backcompat" rule
- `.planning/research/SUMMARY.md` — synthesized v1.0 research (still authoritative for the GJS / GNOME stack; Devices2 migration adds no new stack pieces)
- `.planning/config.json` — coarse / yolo / parallel
- `../usbeehive/src/dbus.rs` — authoritative wire shape for Devices2 (consult during Plan 04-02)
- `../usbeehive/CHANGELOG.md` — `[Unreleased]` section carries the regex → field migration table + property-key vocabulary

---
*State initialized: 2026-05-11 after roadmap creation*
*v2.0 milestone opened: 2026-05-14*
