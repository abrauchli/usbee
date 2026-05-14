# Roadmap: USBee

**Created:** 2026-05-11
**Last updated:** 2026-05-14 (v2.0 milestone — Phase 04 appended: Devices2 migration)
**Mode:** mvp
**Granularity:** coarse
**Phases:** 4 (v1.0: Phases 01+02 Complete; v1.1: Phase 03 Complete; v2.0: Phase 04 Pending)
**Coverage:** 34/34 v1.0 + 5/5 v1.1 + 16/16 v2.0 requirements mapped

## Core Value

A GNOME-native, glanceable answer to "is this the fast port?" and "why is my laptop charging slowly?" — without opening a terminal.

## Strategy

Two phases, derived directly from the unanimous research recommendation in `.planning/research/SUMMARY.md`. Phase 1 ships the load-bearing skeleton (tile + popover + hotplug + daemon-missing graceful state) as v0.1 to EGO. Phase 2 layers notifications, per-port mute, preferences, and EGO submission polish on top — without modifying Phase 1 modules — to ship v1.0. The codebase is ~500–1000 LoC of pure GJS; finer decomposition would spend more on phase ceremony than on actual work.

**v1.1 (added 2026-05-13):** Phase 03 is a single-phase UI rework milestone. It replaces the v1.0 two-column staircase popover layout with a per-device accordion (`PopupSubMenuMenuItem`), introduces class/driver-derived symbolic icons, issue-first sort order, and an Adwaita-coherent expanded detail panel. Scope is strictly the visual surface of `src/popover.js` and its immediate collaborators — no daemon-side, schema, or D-Bus changes. Ships as v1.1.0 to the existing EGO listing.

**v2.0 (added 2026-05-14):** Phase 04 is a single-phase wire-shape migration milestone. usbeehive shipped `org.usbeehive.Devices2` with 19 structured top-level fields plus a `properties: a(ss)` machine-key bag, replacing the v1 `bullets` prose array. USBee migrates in lockstep: the regex/heuristic layer is deleted, label-table + icon-table replace per-bullet classification, a daemon-version gate guards against running against pre-Devices2 daemons, and new fields (`device_subclass`, `primary_driver`, `Status::Sourcing`) get UI treatments. **Hard cut, no compatibility shim** — old daemon falls through to a dedicated "daemon out of date" empty state. Ships as v2.0.0 and is USBee's first EGO submission (v1.0/v1.1 were never submitted).

## Phases

- [x] **Phase 1: Tile, Popover, Hotplug, Daemon-Missing State (v0.1)** — Quick Settings tile mounts with a live headline, popover lists every device/port with vendor/speed/role/wattage/diagnostic, hotplug works, daemon-missing empty state auto-recovers via `NameOwnerChanged`. Shippable to EGO as v0.1.
- [x] **Phase 2: Notifications, Preferences, EGO Submission Polish (v1.0)** — `CapabilityDegraded` notifications with per-port mute, GSettings schema `us.bitcreed.usbee`, gettext scaffolding, README + COPYING + final EGO submission polish. Shippable as v1.0.
- [x] **Phase 3: Popover UI Rework — Accordion Rows, Class Icons, Issue-First Sort (v1.1)** — Replace the staircase popover with per-device `PopupSubMenuMenuItem` rows (single-row accordion), class/driver-derived symbolic icons, issue-first sort order, and an Adwaita-coherent expanded detail panel. Re-pack as v1.1.0 for EGO. (completed 2026-05-13)
- [ ] **Phase 4: Devices2 wire-shape migration (v2.0)** — Cut over to `org.usbeehive.Devices2`. Delete every prose-parsing regex; add `label-table.js` + `device_class` enum-keyed icon table; gate on daemon `Version` property with a distinct "Daemon out of date" empty state; surface `primary_driver == ""`, `device_subclass`, and `Status::Sourcing`. Ship as v2.0.0 — USBee's first EGO submission.

## Phase Details

### Phase 1: Tile, Popover, Hotplug, Daemon-Missing State (v0.1)

**Goal:** Users can glance at the GNOME Quick Settings tile to see USB-C charging state and the fastest attached link, open the popover to read a plain-English diagnostic per port and a live device list, watch the list update as they plug things in or out, and see a graceful empty state (that auto-recovers) when the `usbeehive` daemon is not running.
**Mode:** mvp
**Depends on:** Nothing (foundation phase)
**Requirements:** TILE-01, TILE-02, TILE-03, TILE-04, LIST-01, LIST-02, LIST-03, LIST-04, LIST-05, LIST-06, DIAG-01, DIAG-02, LIVE-01, LIVE-02, LIVE-03, STATE-01, STATE-02, STATE-03, STATE-05, PACK-04, PACK-05
**Success Criteria** (what must be TRUE):
  1. With `usbeehive` running, a USBee tile appears alongside Wi-Fi/Bluetooth/Sound and its subtitle reflects the current USB-C charging direction + wattage (or fastest attached link speed, or "Nothing connected") and updates live without opening the popover.
  2. Opening the popover shows one row per attached USB device and USB-C port with friendly vendor + product name, negotiated USB version + link speed, data + power role, live wattage (when UCSI exposes it), and the daemon's plain-English diagnostic string rendered verbatim — including multi-line strings.
  3. Plugging or unplugging a device updates both the tile subtitle and the open popover live, with no manual refresh required, sourced from `usbeehive`'s `DeviceAdded` / `DeviceRemoved` signals.
  4. With `usbeehive` stopped, the popover shows a copyable `systemctl --user enable --now usbeehive` hint instead of an error or crash; starting the daemon repopulates the tile within ~1 second via `NameOwnerChanged` with no user action; stopping it mid-session transitions cleanly back to the empty state.
  5. Locking and unlocking the screen at least 3 times, and disabling/re-enabling the extension 10 times, produces no duplicate tiles, no "already disposed" warnings, and no leaked signal handlers in `journalctl --user-unit gnome-shell`.
**Plans:** 2 plans

Plans:
**Wave 1**
- [x] 01-01-PLAN.md — Walking Skeleton: project scaffold, dbus-iface.xml capture, DBusClient + DeviceStore + SignalRegistry, tile mount, daemon-missing empty state (covers TILE-01/02, STATE-01/02/03, PACK-04/05)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-02-PLAN.md — Live device list + headline derivation + lifecycle hygiene: full D-09 4-tier subtitle, DeviceAdded/Removed + 150 ms debounce, multi-bullet rows with DIAG-02 line-wrap, RESEARCH §Lifecycle Test Matrix Tests 1/3/4/5 (covers TILE-03/04, LIST-01..06, DIAG-01/02, LIVE-01/02/03, STATE-05)
**UI hint:** yes

### Phase 2: Notifications, Preferences, EGO Submission Polish (v1.0)

**Goal:** Users get a single, non-spammy desktop notification when a USB-C port degrades (e.g. slow-charging cable), can mute that port from the notification itself with the choice persisted across sessions, can manage muted ports and the master notification switch from a preferences window, and the extension is ready for upload to extensions.gnome.org.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, PREFS-01, PREFS-02, PREFS-03, PREFS-04, STATE-04, PACK-01, PACK-02, PACK-03, PACK-06
**Success Criteria** (what must be TRUE):
  1. When `usbeehive` emits `CapabilityDegraded` for a port, USBee raises exactly one desktop notification describing the degradation; repeated events for the same port coalesce via `replaces_id`; a 2–3 s suppression window after daemon-restart prevents replay floods.
  2. The degraded-port notification carries a "Don't notify for this port again" action that writes the port's stable identifier to GSettings; muted ports never raise further `CapabilityDegraded` notifications until unmuted via preferences; mute state survives shell restart, lock/unlock, and extension reload.
  3. `gsettings list-schemas | grep usbee` returns `us.bitcreed.usbee`; the schema exposes `port-mutes` (`as`) for per-port mute and a "hide empty ports" boolean toggle; all preference reads/writes go through GSettings (no ad-hoc config file); the schema is visible and editable in `dconf-editor`.
  4. The preferences window (Adwaita, opened via the Extensions app) lists currently muted ports with per-row unmute affordances and exposes the hide-empty-ports toggle; when the screen is locked the tile's preferences entry is hidden (`Main.sessionMode.allowSettings === false`).
  5. The repository ships `COPYING` (GPL-3.0); every user-visible string in `.js` source is wrapped in a `gettext` `_()` marker and `xgettext` produces a non-trivial `.pot` template; `gnome-extensions pack` produces a clean zip with `metadata.json` declaring `shell-version` `["46", "47", "48"]` and a stable `uuid`; the zip contains no bundled binaries, no `Gtk`/`Adw` imports in the Shell-process code, and no synchronous D-Bus or I/O calls; README documents the `usbeehive` daemon dependency and the `systemctl --user enable --now usbeehive` install path.
**Plans:** 2 plans

Plans:
**Wave 1**
- [x] 02-01-PLAN.md — Notifier vertical slice: GSettings schema, src/notifier.js (per-port Map + MessageTray.Source + 2.5 s suppression window + live mute read + mute action handler), CapabilityDegraded/Restored subscriptions in dbus-client.js, STATE-04 Preferences… menu row with Main.sessionMode gating, SPDX retrofit (covers NOTIF-01..04, PREFS-01..03, STATE-04)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-02-PLAN.md — Preferences + EGO packaging vertical slice: prefs.js (Adwaita window with three groups), src/popover.js hide-empty-ports consumer, metadata.json version-name, COPYING (verbatim GPL-3.0), README.md, po/usbee@bitcreed.us.pot, gnome-extensions pack zip passing automated EGO audit gates 1-9 (covers PREFS-04, PACK-01, PACK-02, PACK-03, PACK-06)
**UI hint:** yes

### Phase 3: Popover UI Rework — Accordion Rows, Class Icons, Issue-First Sort (v1.1)

**Goal:** Users opening the USBee popover see a per-device accordion list that visually matches the GNOME Wi-Fi / Bluetooth device-row pattern — a class-derived symbolic icon, a one-line headline, and a chevron — with devices flagged by the daemon (non-empty `diagnostic`) floating to the top. Clicking a device row expands an Adwaita-coherent detail panel showing the device's properties as labelled rows (not raw text bullets); opening a different row collapses the previously open one. The shipped artifact is a re-packed `usbee@bitcreed.us.shell-extension.zip` carrying `version-name: 1.1.0` in `metadata.json`, ready for upload to the existing EGO listing.
**Mode:** mvp
**Depends on:** Phase 2 (v1.0 EGO submission ready — `src/popover.js`, `src/tile.js`, `src/device-store.js`, and the GSettings schema all exist and are shipping)
**Requirements:** UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. Opening the popover shows one collapsed row per attached USB device / USB-C port, each rendered as a `PopupSubMenuMenuItem` (the same widget family `js/ui/status/network.js` and `bluetooth.js` use) — the v1.0 two-column staircase layout is fully gone. (UI-01)
  2. Clicking any device row expands its detail panel; opening a second row collapses the previously open row so that at most one row is expanded at any time. (UI-02)
  3. With at least one device carrying a non-empty `diagnostic` field present in the snapshot, those devices appear at the top of the popover list; remaining devices follow in the daemon's emit order. (UI-03)
  4. Each row displays a class/driver-derived symbolic icon: HID devices show `input-keyboard-symbolic` or `input-mouse-symbolic`; hubs and unrecognised devices fall back to `network-usb-symbolic`; common storage / audio / video classes resolve to their matching symbolic icons. (UI-04)
  5. The expanded detail panel renders as a structured Adwaita-coherent layout — labelled property rows with consistent vertical rhythm, monospace where appropriate — visually coherent with the Wi-Fi/Bluetooth detail UX, not stacked raw `St.Label` bullets. (UI-05)
  6. `gnome-extensions pack` produces a clean zip whose `metadata.json` declares `version-name: 1.1.0` and a regenerated `po/usbee@bitcreed.us.pot`; the zip still contains no bundled binaries, no `Gtk`/`Adw` imports in Shell-process code, and no synchronous D-Bus or I/O calls (EGO audit gates from Phase 02 remain green).
**Plans:** 1/1 plans complete

Plans:
**Wave 1**
- [x] 03-01-PLAN.md — Accordion popover rewrite (PopupSubMenuMenuItem rows + class/driver icons + issue-first sort + Adwaita-coherent detail panel) + v1.1.0 EGO repack (covers UI-01..UI-05)
**UI hint:** yes

### Phase 3 Implementation Scope

**Primary file (replaced):**
- `usbee@bitcreed.us/src/popover.js` (currently 121 lines, two-column staircase render) — wholesale replacement with a `PopupSubMenuMenuItem`-driven accordion that consumes a sorted device list from `DeviceStore`.

**Supporting files (touched, not rewritten):**
- `usbee@bitcreed.us/src/tile.js` — the call site that invokes `populateDeviceRows`; adjust signature/usage to match the new popover API.
- `usbee@bitcreed.us/src/device-store.js` — surface the per-device `diagnostic` field (if not already exposed) and expose a `hasIssue(device)` predicate so popover sort + the issue-first ordering have a single source of truth.
- `usbee@bitcreed.us/stylesheet.css` — Adwaita-coherent detail-panel styling (label rows, monospace where appropriate, vertical rhythm matching the Wi-Fi/Bluetooth panels).
- `usbee@bitcreed.us/src/device-icon.js` (likely new) — class/driver → symbolic-icon mapping helper; keeps `popover.js` free of the icon switch.
- `usbee@bitcreed.us/metadata.json` — bump `version-name` to `1.1.0`.
- `usbee@bitcreed.us/po/usbee@bitcreed.us.pot` — regenerate via `xgettext` after string churn.

**Explicitly out of scope (carried forward from v1.0 as-is):**
- `src/notifier.js` — no changes
- `prefs.js` — no changes
- GSettings schema `us.bitcreed.usbee` — no new keys, no migrations
- `src/dbus-client.js` — no daemon-side or D-Bus surface changes
- Daemon-missing empty state — preserved
- `SignalRegistry` teardown — preserved
- EGO audit gates 1–9 — must remain green, not re-derived

### Phase 4: Devices2 wire-shape migration (v2.0)

**Goal:** With usbeehive having shipped `org.usbeehive.Devices2`, USBee migrates its proxy and every downstream consumer to the new structured wire in a single lockstep release. Users on a current daemon see the same UX as today (plus fixed-up subtitles for outbound charging and a visible flag for driver-less devices); users on an outdated daemon see a clear "please update usbeehive" empty state instead of garbage data. The shipped artifact is `usbee@bitcreed.us.shell-extension.zip` carrying `version-name: 2.0.0`, first ever uploaded to extensions.gnome.org.
**Mode:** mvp
**Depends on:** Phase 3 (v1.1 accordion popover is the surface being adapted; UI patterns reused), plus the upstream usbeehive Devices2 release (`5e216cd` on master; release version to be pinned during planning).
**Requirements:** WIRE-01, WIRE-02, WIRE-03, WIRE-04, CLEAN-01, CLEAN-02, CLEAN-03, DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, COMPAT-01, COMPAT-02, REL-01, REL-02, REL-03
**Success Criteria** (what must be TRUE):
  1. With a current usbeehive running, the popover renders one row per device exactly as today — but driven entirely by `Devices2` structured fields, with no regex parsing of bullet prose anywhere in the code (`grep -E 'WATT_RE|DIRECTION_RE|USB_VERSION_RE|SPEED_RE|DIAG_PHRASES|keyForBullet|KEYWORD_MAP' src/` returns no hits).
  2. Property rows in the expanded detail panel resolve their left-column label from `src/label-table.js` (machine key → gettext display string) for every key the daemon emits today; an unknown key still renders the row, falling back to the raw key as its label.
  3. Device-row icons come from a `device_class` enum lookup table covering all 19 daemon variants; rows for devices the daemon classifies as `Unknown` get the generic USB icon; the daemon-supplied `icon` field is preferred when it passes the existing `SYMBOLIC_ICON_RE` guard.
  4. With a stub usbeehive that reports `Version < MIN_USBEEHIVE_VERSION` over D-Bus, the popover shows a "Daemon out of date — please update usbeehive" empty state distinct in copy from the existing "Daemon not running" state; with the daemon stopped entirely, the existing "Daemon not running" state still renders.
  5. Plugging a phone into a Type-C port (host sources power) drives the tile subtitle to `Powering: N W out` via the new `Status::Sourcing`; plugging a charger (host sinks) still drives `Charging: N W in`; the issue-first sort puts only `charging_diag.is_warning` ports at the top — Sourcing ports do not float.
  6. A device with `primary_driver == ""` and non-Empty status is visibly flagged in the popover (badge or detail-panel note — implementation chosen during planning, must be observable).
  7. `gnome-extensions pack` produces a clean zip whose `metadata.json` declares `version-name: 2.0.0`, the EGO audit gates from Phase 02 remain green (no bundled binaries, no Gtk/Adw in Shell-process code, no sync D-Bus), and `CHANGELOG.md` names the minimum required usbeehive version. The zip is uploaded to extensions.gnome.org as USBee's first EGO submission.
**Plans:** 3 plans

Plans:
**Wave 1**
- [ ] 04-01-PLAN.md — Pre-wire-cut prep & UX decisions: ADR for the daemon-version gate (where the check lives, copy of the new empty state, location of the `MIN_USBEEHIVE_VERSION` constant), `src/label-table.js` skeleton with gettext catalogue staged ahead of integration, audit of Adwaita symbolic icon names for the 19 `device_class` variants (decide picks for `SmartcardReader` / `Bluetooth` / `Serial` / `VideoCapture`), UX decisions for `primary_driver == ""` rendering, `device_subclass` rendering policy, and `Status::Sourcing` subtitle copy + sort behaviour. Lands code only for the prep modules; no wire-shape change yet (covers DISP-01 staging, DISP-02 design, DISP-03 copy, DISP-04 design, DISP-05 decision, COMPAT-02 copy)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 04-02-PLAN.md — Wire-shape cutover: bump `dbus-iface.xml` and `IFACE_XML` in `src/dbus-client.js` to `Devices2`; rewrite `unpackDeviceEntry` to the 19-field shape; switch consumers to typed fields; delete `WATT_RE` / `DIRECTION_RE` / `USB_VERSION_RE` / `SPEED_RE` / `parseWatts` / `parseDirection` / `parseLinkSpeed` / `DIAG_PHRASES` / `keyForBullet` / `KEYWORD_MAP`; wire `label-table.js` into the property-row renderer; wire the `device_class` icon lookup into `device-icon.js`; wire `Status::Sourcing` and `primary_driver` into the popover and tile subtitle; wire the daemon-version gate; add the forward-compat regression test for unknown enum values (covers WIRE-01..04, CLEAN-01..03, DISP-01..05 integration, COMPAT-01..02 integration)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 04-03-PLAN.md — Release coordination: bump `metadata.json` `version-name` to `2.0.0` and increment `version`; write the `## [2.0.0]` CHANGELOG entry naming the minimum required usbeehive version and listing the regex deletions; `gnome-extensions pack` + tag + GitHub release; first EGO upload (covers REL-01..03)
**UI hint:** yes

### Phase 4 Implementation Scope

**New files:**
- `usbee@bitcreed.us/src/label-table.js` — machine-key → gettext display label map; staged in Plan 04-01, integrated in Plan 04-02.

**Files rewritten:**
- `usbee@bitcreed.us/dbus-iface.xml` — replace with the `org.usbeehive.Devices2` interface description.
- `usbee@bitcreed.us/src/dbus-client.js` — `IFACE_XML` template literal regenerated; `INTERFACE_NAME` constant flipped from `Devices1` → `Devices2`; daemon-version gate added on proxy-ready; new "out of date" state path.
- `usbee@bitcreed.us/src/device-store.js` — delete all bullet-regex helpers, replace `unpackDeviceEntry`, collapse `hasIssue()` to a one-liner on `charging_diag`, add `Status::Sourcing` to the Tier-1 subtitle path.
- `usbee@bitcreed.us/src/popover.js` — delete `keyForBullet()`; iterate `device.properties` and resolve labels via `label-table.js`; surface `primary_driver`/`device_subclass` per the Plan 04-01 UX decision.
- `usbee@bitcreed.us/src/device-icon.js` — replace `KEYWORD_MAP` headline scan with a `device_class` enum lookup; keep `SYMBOLIC_ICON_RE` guard (T-03-01).

**Files touched:**
- `usbee@bitcreed.us/src/empty-state.js` — add the "Daemon out of date" variant.
- `usbee@bitcreed.us/metadata.json` — `version-name: 2.0.0`, `version` integer bump.
- `usbee@bitcreed.us/po/usbee@bitcreed.us.pot` — regenerate via `xgettext` (new label-table strings + new empty-state copy).
- `CHANGELOG.md` — `## [2.0.0]` entry.

**Explicitly out of scope (do not touch):**
- `src/notifier.js` and the `CapabilityDegraded`/`CapabilityRestored` signal pipeline — signal payloads are unchanged from Devices1.
- `prefs.js` and the GSettings schema — no preference changes.
- Any compatibility-shim path for `Devices1` — hard rejection per the captured todo's "NO backwards compatibility" rule.
- Per-property markup, non-USB-C diagnostics, speculative "would charge faster" diagnostics, i18n of daemon prose fields.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Tile, Popover, Hotplug, Daemon-Missing State (v0.1) | 2/2 | Complete | 2026-05-11 |
| 2. Notifications, Preferences, EGO Submission Polish (v1.0) | 2/2 | Complete | 2026-05-12 |
| 3. Popover UI Rework — Accordion Rows, Class Icons, Issue-First Sort (v1.1) | 1/1 | Complete   | 2026-05-13 |
| 4. Devices2 wire-shape migration (v2.0) | 0/3 | Pending  | —          |

## Coverage Map

All 34 v1.0 requirements + 5 v1.1 requirements + 16 v2.0 requirements mapped to exactly one phase. No orphans, no duplicates.

| Requirement | Phase |
|-------------|-------|
| TILE-01, TILE-02, TILE-03, TILE-04 | Phase 1 |
| LIST-01, LIST-02, LIST-03, LIST-04, LIST-05, LIST-06 | Phase 1 |
| DIAG-01, DIAG-02 | Phase 1 |
| LIVE-01, LIVE-02, LIVE-03 | Phase 1 |
| STATE-01, STATE-02, STATE-03, STATE-05 | Phase 1 |
| PACK-04, PACK-05 | Phase 1 |
| NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04 | Phase 2 |
| PREFS-01, PREFS-02, PREFS-03, PREFS-04 | Phase 2 |
| STATE-04 | Phase 2 |
| PACK-01, PACK-02, PACK-03, PACK-06 | Phase 2 |
| UI-01, UI-02, UI-03, UI-04, UI-05 | Phase 3 |
| WIRE-01, WIRE-02, WIRE-03, WIRE-04 | Phase 4 |
| CLEAN-01, CLEAN-02, CLEAN-03 | Phase 4 |
| DISP-01, DISP-02, DISP-03, DISP-04, DISP-05 | Phase 4 |
| COMPAT-01, COMPAT-02 | Phase 4 |
| REL-01, REL-02, REL-03 | Phase 4 |

**Phase 1 count:** 21 requirements (v1.0)
**Phase 2 count:** 13 requirements (v1.0)
**Phase 3 count:** 5 requirements (v1.1)
**Phase 4 count:** 16 requirements (v2.0)
**Total:** 55 / 55 requirements mapped (34 v1.0 + 5 v1.1 + 16 v2.0)

### Mapping Rationale

- **STATE-04 (lock-screen prefs hiding) is in Phase 2**, not Phase 1, because the preferences-entry-to-hide does not exist until Phase 2 introduces `prefs.js`. STATE-01/02/03/05 (daemon-missing flow + clean disable) are foundational and land in Phase 1.
- **PACK-04 and PACK-05** (metadata.json `shell-version` declaration, no bundled binaries / no `Gtk` in Shell process / no sync D-Bus) are Phase 1 invariants — they describe the architectural shape of the very first commit, not a polish pass.
- **PACK-01, PACK-02, PACK-03, PACK-06** (COPYING, gettext scaffolding + .pot generation, `gnome-extensions pack` clean zip, README documenting daemon dependency) are Phase 2 because they are the final-mile EGO submission artifacts and only meaningful once feature work is complete.
- **LIVE-03 ("tile subtitle re-derives on every relevant signal so it never goes stale")** is in Phase 1 because the headline logic lives in `DeviceStore` from day one.
- **UI-01..UI-05 are all in Phase 3** because they form a single coherent visual rework of the popover surface — splitting them across phases would force partial states (e.g. accordion without icons, or sort without expanded panel) that have no user-visible value on their own. Coarse / mvp granularity confirms one phase is correct. The v1.1.0 EGO re-pack is part of Phase 3's exit criteria, not a separate phase, because it is a single `gnome-extensions pack` invocation against an already-audited codebase.
- **WIRE / CLEAN / DISP / COMPAT / REL all in Phase 4** because Devices2 is a single atomic wire bump — partial migrations are not coherent (the daemon does not emit Devices1 anymore). Split across **3 plans not 3 phases**: Plan 04-01 is decision-and-staging work that does not change the wire shape (lands `label-table.js`, ADRs, UX picks); Plan 04-02 is the wire-shape cutover proper; Plan 04-03 is the v2.0.0 release and EGO submission. This keeps wire-cut and release in separate atomic commits while keeping all v2.0 work in one phase whose success criteria measure the same user experience.

---
*Roadmap created: 2026-05-11*
*v1.1 milestone added: 2026-05-13 — Phase 03 appended (UI × 5)*
*v2.0 milestone added: 2026-05-14 — Phase 04 appended (WIRE × 4, CLEAN × 3, DISP × 5, COMPAT × 2, REL × 3)*
*Mode: mvp — emits `**Mode:** mvp` on every initial phase*
