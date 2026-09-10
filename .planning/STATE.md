---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Devices2 wire-shape migration
status: complete
last_updated: "2026-05-26T20:15:00.000Z"
last_activity: 2026-05-26 - Quick task 260526-i7q: daemon-state hints (install/update) + shorter notify-changes ComboRow labels
progress:
  total_phases: 1
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
  percent: 100
---

# State: USBee

**Last updated:** 2026-05-14 (milestone v2.0 opened — Phase 04 Devices2 migration roadmapped)

## Project Reference

- **Core value:** A GNOME-native, glanceable answer to "is this the fast port?" and "why is my laptop charging slowly?" — without opening a terminal.
- **Current focus:** Phase 04 — devices2-wire-shape-migration-v2-0
- **Mode:** mvp
- **Granularity:** coarse
- **Workflow mode:** yolo (parallelization enabled)

## Current Position

Phase: 04 (devices2-wire-shape-migration-v2-0) — COMPLETE
Plan: 3 of 3 (all done; EGO upload held for v2.1.0)
Status: v2.0.0 tagged + on GitHub; warning badge (1306c09) + device-change notifications + show-technical-details toggle landed (286c85f); ready for v2.1.0 release + first EGO submission
Last activity: 2026-09-10 -- Quick task 260910-lyx: withdrew the connector hints that named a socket and a cause. `ss-never-linked` / `ss-unstable` / `ss-elsewhere` all keyed off the kernel's root-port `peer` link, which ACPI `_PLD` gets wrong on this very machine (USB-C D+/D- on `usb5-port2`, SS lanes on `usb6-port1`, `_PLD` claims a clean index map), so a healthy 5 Gb/s USB 3 hub would have been called "a USB 2-only cable". The daemon excludes root hubs and never reads port `location`, so no correct positive claim was derivable -- one cause-agnostic sentence replaces three, and `deriveConnectorHint()` is the single gate to re-open once usbeehive ships `port.peer_confidence`. Folded into the still-untagged 2.7.1; packed + installed locally (real-directory pre-flight verified), Shell not restarted
Previous activity: 2026-09-10 -- Quick task 260910-hrj: v2.7.1 **prepared, not published** (metadata 2.7.1/12 + changelog; deliberately untagged, unpushed -- tagging fires the release workflow); packed and installed locally so the wrap fix is live at next login. Two defects found in CLAUDE.md's own release procedure and fixed: the zip entry count was stale (24/~198 KB, not 21/~140 KB), and `gnome-extensions install --force` follows a symlinked dev install and deletes the repo's `usbee@bitcreed.us/` sources -- it did exactly that here (recovered via `git checkout`, nothing uncommitted was lost) and the symlinked dev install is now a static copy
Earlier activity: 2026-08-21 -- Quick task 260821-ke2: one store-owned daemon tri-state (pill and popover can no longer disagree); required + detected usbeehive version shown wherever the gate fails; copy buttons on every displayed command; `.pot` regenerated (was stale since 2.2.0)

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
- **Settings storage:** GSettings schema `org.gnome.shell.extensions.usbee`. No TOML, no dotfiles. (EGO `shexli` lint requires the `org.gnome.shell.extensions.*` namespace for extension settings schemas; renamed from the original `us.bitcreed.usbee` in quick task `260514-mq0` on 2026-05-14.)
- **i18n:** English strings only in v1; every user-visible string wrapped in `gettext` `_()` markers from day one. Translations deferred to v2.
- **Architecture rule:** All USB knowledge flows through `usbeehive` via D-Bus. USBee performs no `/sys` or udev access of its own.
- **D-Bus wire names (Plan 01):** `BUS_NAME='org.usbeehive.Devices'` and `OBJECT_PATH='/org/usbeehive/Devices'` (NO trailing 1); `INTERFACE_NAME='org.usbeehive.Devices1'` (the `1` is only on the interface). Verified against `../usbeehive/src/dbus.rs:290-292`; CONTEXT.md's original wording had this wrong.
- **Plan 01 IFACE_XML source (Plan 01 Task 2):** Used RESEARCH.md Option B (hand-written XML) because the daemon was not running on the dev machine and no pre-built binary was available. Every member signature verified against `../usbeehive/src/dbus.rs:197-292`. Capture a fresh `busctl --user introspect` XML when the daemon is later running and diff against the committed version.
- **Plan 01 stubs handed to Plan 02:** `DeviceStore.subhead` (Plan 02 Task 1 swaps in D-09 derivation), `populateDeviceRows` (Plan 02 Task 3 swaps in full LIST-01..06 + DIAG-01/02), and `DBusClient._onAppeared` lacks `DeviceAdded/Removed` subscriptions + 150 ms debounce (Plan 02 Task 2 adds them). Module interfaces are unchanged.
- **Devices2 cross-team spec locked (2026-05-13):** Outcome of multi-round negotiation with usbeehive; full wire shape, machine-key vocabulary, enum extensibility convention, and "NO backwards compatibility" hard rule recorded in `.planning/todos/pending/2026-05-14-migrate-to-usbeehive-devices2-wire-shape.md` (commit 724c22a). Daemon implementation matches the spec verbatim (`../usbeehive` commit `5e216cd`).
- **Devices2 INTERFACE_NAME bump:** `org.usbeehive.Devices1` → `org.usbeehive.Devices2`. `BUS_NAME` and `OBJECT_PATH` unchanged. Hard cut; the previous "supports both" was rejected upstream and downstream.

### Open Questions (v2.0 — surface during Plan 04-01)

- ✅ **CONFIRMED 2026-05-14:** `MIN_USBEEHIVE_VERSION = "0.6.0"`. usbeehive cut release 0.6.0 (Cargo.toml `0.6.0`, release commit `1258de4` "Release 0.6.0 — Devices2 wire (breaking)") — no remaining ambiguity for the version pin.
- `primary_driver == ""` UI treatment: badge on the device row vs. note in the detail panel vs. ignore for v2.0. Decided during Plan 04-01.
- `device_subclass` rendering: append to row title (`"Storage · SSD"`), surface only in the detail panel, or ignore for v2.0 (subclass-aware icons explicitly out per CHANGELOG). Decided during Plan 04-01.
- Adwaita symbolic icon picks for the four daemon `device_class` variants without an obvious fit: `SmartcardReader`, `Bluetooth`, `Serial`, `VideoCapture`. Decided during Plan 04-01 icon audit.

### Todos

- `.planning/todos/pending/2026-05-14-migrate-to-usbeehive-devices2-wire-shape.md` — full v2.0 phase context (locked wire spec + hard "no compat" rule). Tagged for Phase 4 in step 10.5.
- ~~`.planning/todos/pending/2026-05-15-show-warning-badges-and-in-panel-charging-diagnostics-in-pop.md`~~ — **Done (2026-05-26, commit 1306c09).** Daemon-side `ChargerLimit` dead variant deferred upstream.

### Blockers

()

- Pre-Devices2 orphan `.planning/phases/01-tile-popover-hotplug-daemon-missing-state-v0-1/01-RESEARCH.md` (1386 lines, untracked) was wiped by `gsd-sdk query phases.clear` at milestone switch (2026-05-14). Never committed; not in git, not on disk anywhere on the host, no SDK archive. Genuinely unrecoverable. Acknowledged 2026-05-14 — historical-only value, Phase 01 closed, not blocking anything.

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

**Release v2.1.0 → first EGO submission.**

v2.0.0 was tagged and pushed to GitHub but never submitted to EGO. The warning badge feature (commit 1306c09) was added after the tag, so the first EGO submission will be v2.1.0.

Steps:
1. Bump `metadata.json` `version-name` → `"2.1.0"`, `version` → `3`.
2. Write `## [2.1.0]` CHANGELOG entry (warning badge + charging diag rows).
3. Regenerate `.pot` (already done in 1306c09 — re-run after any further string churn).
4. `gnome-extensions pack` + smoke-test + create annotated tag `v2.1.0`.
5. Push tag → release.yml builds zip + GitHub Release.
6. Upload zip to https://extensions.gnome.org/upload/ — first ever EGO submission.

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

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260514-g4x | For the bubble-tile icon use drive-harddisk-usb-symbolic instead of the shipped one | 2026-05-14 | a2bc54c | [260514-g4x-for-the-bubble-tile-icon-use-drive-hardd](./quick/260514-g4x-for-the-bubble-tile-icon-use-drive-hardd/) |
| fast | also use that icon in the expanded tile's header and as header text next to the icon use "{n} USB devices" | 2026-05-14 | 17d9906 | — |
| fast | Hub icon → network-proxy-symbolic (bundled SVG, Gio.FileIcon path) | 2026-05-14 | 4a2ab03 | — |
| fast | Storage→media-removable-symbolic; daemon version format; Show USB Hubs pref | 2026-05-14 | c5ce0b1 | — |
| 20260514-screenshot-and-release-prep | Add screenshot to README, move v2.0.0 tag to HEAD, push | 2026-05-14 | 8ea3c50 | [20260514-screenshot-and-release-prep](./quick/20260514-screenshot-and-release-prep/) |
| 260514-mq0 | Fix 3 EGO shexli lint errors: rename GSettings schema to org.gnome.shell.extensions namespace, move test file out of extension dir | 2026-05-14 | 3172694 | [260514-mq0-fix-ego-shexli-lint](./quick/260514-mq0-fix-ego-shexli-lint/) |
| 260526-warning-badges | Warning badge (amber border) on is_warning popover rows + charging_diag.summary/detail in expanded detail panel | 2026-05-26 | 1306c09 | [260526-warning-badges-charging-diag](./quick/260526-warning-badges-charging-diag/) |
| 260526-c6p | Device-change notifications (DeviceAdded/Removed toasts, scope enum all/power/off) + Show technical details toggle gating 8 advanced property rows | 2026-05-26 | 286c85f | [260526-c6p-connect-disconnect-notifications-tech-de](./quick/260526-c6p-connect-disconnect-notifications-tech-de/) |
| 260526-dmj | Devices3 wire migration (MIN_USBEEHIVE 0.7.0, pdo_list/active_pdo_index) + cable trust row + transport pill strip + structured Charger PDOs block | 2026-05-26 | ed7acd6, c130b50, 6cad52f | [260526-dmj-devices3-wire-migration-pdo-list-trust-s](./quick/260526-dmj-devices3-wire-migration-pdo-list-trust-s/) |
| 260526-i7q | Three-way daemon-state hints (not-installed / not-running / out-of-date) with `usbeehived --install-service` and `cargo install usbeehive --features=dbus` commands; shorter notify-changes ComboRow item labels | 2026-05-26 | 4b8c7bb, dec4dbb | [260526-i7q-daemon-status-hints-shorter-notify-chang](./quick/260526-i7q-daemon-status-hints-shorter-notify-chang/) |
| 260608-hug | Fix clipped empty-state title ("u...") — move titles into the vertical body box (hide built-in horizontal PopupMenuItem label) across all three daemon-state builders + `.usbee-empty-state-title` CSS rule | 2026-06-08 | 3229281, c6a2d43 | [260608-hug-fix-clipped-empty-state-title-u-in-quick](./quick/260608-hug-fix-clipped-empty-state-title-u-in-quick/) |
| 260616-c18 | Subscribe to the daemon's additive `DeviceChanged` signal and `_scheduleRefresh()` the tile (no notification) — consumer half of the stale "Charging 15W" after-unplug fix; byte-equal IFACE_XML/dbus-iface.xml preserved | 2026-06-16 | 5d6f6a4, 0395206, 10ce59d | [260616-c18-subscribe-to-devicechanged-signal-and-re](./quick/260616-c18-subscribe-to-devicechanged-signal-and-re/) |
| 260821-ke2 | Store-owned daemon tri-state so the pill reads "Daemon out of date" instead of contradicting the popover; required + detected usbeehive version surfaced in popover and prefs; copy buttons on every displayed command; new zero-import `src/daemon-status.js` shared across both processes + CI | 2026-08-21 | 3346345, 32760d7, 02a14c4 | [260821-ke2-show-daemon-out-of-date-in-the-tile-pill](./quick/260821-ke2-show-daemon-out-of-date-in-the-tile-pill/) |
| fast | EGO AI-reference pass: drop non-throwing try/catch around destroy()/disconnect()/dispose() in notifier.js, popover.js, signal-registry.js (+ orphaned `kind` field) | 2026-08-21 | c3db795 | — |
| 260822-hkn | Document the canonical `gnome-extensions pack` invocation (`--podir` + both `--extra-source` flags) in CLAUDE.md as shared source of truth with release.yml; warn that a wrong `--extra-source` is silently ignored and yields a `src/`-less zip; add local install + on-disk verification steps and the `gnome-extensions info` staleness caveat | 2026-08-22 | fc3c574 | [260822-hkn-document-pack-and-local-install](./quick/260822-hkn-document-pack-and-local-install/) |
| 260905-b0s | Consume usbeehive's additive BOS + connector/power/quirks/hwdb waves on the unchanged Devices5: per-device Link row + capability verdict, `port.peer_state` explanation, hub occupancy/bus power, tile issue tier, `DataRateDegraded`/`DataRateRestored` notifications + `data-rate-mutes`, `product_db`, `DaemonState.TOO_NEW`. **Reverses LOCKED decision 260526-c6p D-2** — unknown property keys are now tech-gated (24 new daemon keys would otherwise render as a property dump). Three new zero-import modules (`property-policy.js`, `link-verdict.js`, `notify-policy.js`) and a revived, CI-wired `tests/forward-compat.test.js` | 2026-09-05 | 168790e, ed57431, 9033390, f3ed164, 59e6c5c, e09e2dd | [260905-b0s-bos-trim-consumer-ui](./quick/260905-b0s-bos-trim-consumer-ui/) |
| 260910-ggy | Property-panel values no longer truncate: `St.Label`'s default `PANGO_ELLIPSIZE_END` was silently disabling the `line_wrap` `buildPropertyRow()` already asked for (Pango ellipsizes at line one when no layout height is set), so every value rendered as one cut-off line. Cleared on both the value and the key label (+ `y_align: START`), same nine-label fix in `empty-state.js`, and a CI guard on the `line_wrap`/`ellipsize` pairing | 2026-09-10 | 683708f, d6806ed, cedb4e8 | [260910-ggy-fix-ellipsized-value-text-in-the-device-](./quick/260910-ggy-fix-ellipsized-value-text-in-the-device-/) |

| 260910-hrj | Release v2.7.1 prepared (metadata 2.7.1/12 + changelog; **untagged and unpushed** on purpose -- the tag fires the release workflow), packed and installed locally so the property-panel wrap fix is live at next login. Found and fixed two wrong facts in CLAUDE.md's release procedure: the "21 entries / ~140 KB" zip check was stale (a correct zip is 24 / ~198 KB, and grows with every `src/` module), and `gnome-extensions install --force` deletes through a symlinked dev install -- it wiped this repo's `usbee@bitcreed.us/` sources mid-run (restored with `git checkout`; nothing uncommitted was lost, and the mechanism was reproduced against a throwaway uuid rather than guessed). The symlinked dev install is now a real directory. | 2026-09-10 | 116c916, c6c7d38 | [260910-hrj-prepare-release-v2-7-1-version-bump-chan](./quick/260910-hrj-prepare-release-v2-7-1-version-bump-chan/) |
| 260910-lyx | Withdrew the three socket-level connector claims (`ss-never-linked` / `ss-unstable` / `ss-elsewhere`) that 2.7.0 derived from the kernel's USB2↔USB3 root-port `peer` link. That link comes from ACPI `_PLD` (exact `location` match) or a bare port-index guess, with **no provenance recorded anywhere in sysfs** — and `_PLD` is confidently wrong on this machine, where the sole USB-C socket is wired D+/D- to `usb5-port2` but its SuperSpeed lanes to `usb6-port1`. A healthy USB 3 hub on that socket would have been reported as "a USB 2-only cable". Checked the wire before choosing a fix: usbeehive 0.12.0 drops root hubs from summaries (`src/sysfs/manager.rs:420-423`) and never reads port `location`, so the pairing-free controller-level reformulation was **not available** — the claim was withdrawn, not re-derived. One cause-agnostic token replaces three; the `port.peer_state` **presence** gate stays (pure narrowing, nothing newly speaks) while its **value** now selects nothing, pinned by a regression test over all seven kernel states. Folded into the untagged 2.7.1 changelog; no version bump, no tag, no push. Packed + installed locally (24 entries / ~200 KB; `ls -ld` pre-flight confirmed a real directory, sources intact after). | 2026-09-10 | 18aff96, 2426820 | [260910-lyx-fix-ss-never-linked-false-positive-kerne](./quick/260910-lyx-fix-ss-never-linked-false-positive-kerne/) |
---
*State initialized: 2026-05-11 after roadmap creation*
*v2.0 milestone opened: 2026-05-14*
