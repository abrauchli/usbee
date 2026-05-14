# Requirements: USBee

**Defined:** 2026-05-11
**Last milestone-update:** 2026-05-14 (v1.1 → v2.0)
**Core Value:** A GNOME-native, glanceable answer to "is this the fast port?" and "why is my laptop charging slowly?" — without opening a terminal.

## v2.0 Requirements (current milestone)

Devices2 wire-shape migration. usbeehive shipped a structured 19-field
D-Bus interface (`org.usbeehive.Devices2`); USBee migrates in lockstep
and deletes its entire bullet-prose regex layer. Hard cut, no
compatibility shim. First EGO submission ships with this milestone as
USBee v2.0.0.

### D-Bus Wire (WIRE)

- [ ] **WIRE-01**: USBee proxy targets `org.usbeehive.Devices2`; `dbus-iface.xml` and the embedded `IFACE_XML` in `src/dbus-client.js` match the daemon's published interface verbatim, including the 19-field per-device tuple
- [ ] **WIRE-02**: `unpackDeviceEntry` exposes every Devices2 field by name (`id`, `category`, `device_class`, `device_subclass`, `status`, `headline`, `subtitle`, `icon`, `vendor`, `product`, `vendor_id`, `product_id`, `primary_driver`, `properties`, `port_number`, `link_speed_mbps`, `usb_version`, `power`, `charging_diag`) so downstream consumers never index by tuple position
- [ ] **WIRE-03**: Consumers of `Diagnose(port)` read the new `(present, bottleneck, summary, detail, is_warning)` shape and use the `present` bool as the absence sentinel — never the bottleneck string emptiness
- [ ] **WIRE-04**: Unknown enum values for `device_class`, `device_subclass`, `status`, `power_role`, `bottleneck` fall back to `Unknown` (or sensible per-enum default) without raising; covered by a regression test asserting forward-compatibility with future daemon variants

### Cleanup (CLEAN)

- [ ] **CLEAN-01**: All bullet-prose regex helpers in `src/device-store.js` are removed: `WATT_RE`, `DIRECTION_RE`, `USB_VERSION_RE` (including the WR-03 lookahead patch), `SPEED_RE`, `parseWatts`, `parseDirection`, `parseLinkSpeed`
- [ ] **CLEAN-02**: `hasIssue()` collapses to `device.charging_diag.present && device.charging_diag.is_warning`; the `DIAG_PHRASES` substring scan is removed
- [ ] **CLEAN-03**: `keyForBullet()` in `src/popover.js` and the `KEYWORD_MAP` + headline substring scan in `src/device-icon.js` are removed; the defensive `SYMBOLIC_ICON_RE` daemon-icon guard remains for security mitigation T-03-01

### Display (DISP)

- [ ] **DISP-01**: A new `src/label-table.js` maps daemon machine keys (`serial`, `mount`, `drivers`, `data_role`, `power_mode`, `pd_revision`, `plug_orientation`, `pd_contract`, `cable_speed`, `cable_current`, `cable_max_power`, `cable_type`, `cable_vendor`, `charger_max`, `usb_power_ma`) to gettext-wrapped display labels; unknown keys render the raw key without crashing
- [ ] **DISP-02**: Device-row symbolic icons resolve from a `device_class` enum lookup table covering all 19 daemon variants; the daemon-supplied `icon` field is preferred when it passes `SYMBOLIC_ICON_RE`
- [ ] **DISP-03**: Tile subtitle Tier-1 surfaces `Status::Sourcing` (outbound charging) as "Powering: %s out"; Sourcing entries do not trigger the issue-first sort
- [ ] **DISP-04**: Devices with `primary_driver == ""` and non-Empty status are visibly flagged in the popover (badge or detail-panel note — exact treatment decided during planning, must be observable in the UI)
- [ ] **DISP-05**: `device_subclass` rendering policy is implemented per the planning decision (append to row title, surface in the detail panel only, or ignore for v2.0) and documented

### Daemon Compatibility (COMPAT)

- [ ] **COMPAT-01**: USBee reads the daemon's `Version` property on proxy-ready and refuses to consume a daemon older than the pinned minimum version constant
- [ ] **COMPAT-02**: When the daemon is too old, the popover shows a dedicated "Daemon out of date — please update usbeehive" empty state with copy distinct from the existing "Daemon not running" state

### Release (REL)

- [ ] **REL-01**: `usbee@bitcreed.us/metadata.json` `version-name` bumped to `2.0.0`; `version` integer incremented per the EGO rule
- [ ] **REL-02**: `CHANGELOG.md` carries a `## [2.0.0]` entry naming the minimum required usbeehive version, listing the breaking daemon dependency, and noting the deletion of the regex layer
- [ ] **REL-03**: USBee v2.0.0 zip built via `gnome-extensions pack` and uploaded as the first EGO submission; release tag pushed so the GitHub release workflow produces the same zip

## v1.1 Requirements (validated — shipped in v1.1)

UI rework: per-device selectable accordion list with class-derived icons, expandable diagnostic detail panels styled coherently with Wi-Fi/Bluetooth, and an issue-first sort order. No daemon-side or schema changes — purely the visual surface of `src/popover.js` + supporting modules.

### UI Rework (UI)

- [x] **UI-01**: Popover renders one row per device using `PopupSubMenuMenuItem` (matches the gnome-shell network/Bluetooth row pattern); the v1.0 two-column staircase layout is replaced
- [x] **UI-02**: Clicking a device row expands its diagnostic detail panel; only one row is expanded at a time (accordion behaviour — opening a new row collapses the previous one)
- [x] **UI-03**: Devices with a non-empty daemon-emitted `diagnostic` field sort to the top of the popover list; the rest follow in daemon-emit order
- [x] **UI-04**: Each device row displays a class/driver-derived symbolic icon — `network-usb-symbolic` for hubs and unrecognised devices, `input-keyboard-symbolic` / `input-mouse-symbolic` for HID, plus matching symbolic icons for common storage / audio / video classes
- [x] **UI-05**: Expanded device-detail panel is rendered as a structured Adwaita-coherent layout (labelled property rows, consistent vertical rhythm, monospace where appropriate) — not raw `St.Label` bullets stacked vertically

## v1 Requirements (validated — shipped in v1.0)

Initial release: a GNOME 46+ Shell extension that mounts a Quick Settings tile, talks to the `usbeehive` daemon over D-Bus, and ships to extensions.gnome.org. All v1 requirements validated by Phase 01 + Phase 02 smoke tests on GNOME Shell 46 Xorg with `usbeehive` v0.5.1.

### Tile (TILE)

- [x] **TILE-01**: User sees a USBee Quick Settings tile alongside Wi-Fi, Bluetooth, and Sound when the extension is enabled
- [x] **TILE-02**: Tile displays a symbolic USB icon and a one-line title
- [x] **TILE-03**: Tile shows a live subtitle summarising the most relevant USB-C state (charging direction + wattage, or fastest attached link speed, or "Nothing connected")
- [x] **TILE-04**: Tile subtitle updates live (no popover open required) when devices are added, removed, or change power state

### Device List (LIST)

- [x] **LIST-01**: User can open the tile popover to see one row per attached USB device and USB-C port
- [x] **LIST-02**: Each row shows the device's friendly vendor + product name
- [x] **LIST-03**: Each row shows negotiated USB version (1.1 / 2.0 / 3.x) and link speed
- [x] **LIST-04**: Each USB-C port row shows data role (host/device) and power role (source/sink)
- [x] **LIST-05**: Each row shows power direction and live wattage when usbeehive exposes UCSI live-power data
- [x] **LIST-06**: Rows reflect the current daemon snapshot every time the popover opens

### Diagnostics (DIAG)

- [x] **DIAG-01**: Each USB-C port row carries a plain-English diagnostic string (e.g. "Cable limited to USB 2.0 — swap for a full-featured cable to reach 10 Gb/s") sourced verbatim from usbeehive's `Diagnose` output
- [x] **DIAG-02**: Diagnostic strings render correctly when usbeehive emits multi-line or multi-sentence text

### Live Updates (LIVE)

- [x] **LIVE-01**: Popover device list updates without user action when usbeehive emits `DeviceAdded`
- [x] **LIVE-02**: Popover device list updates without user action when usbeehive emits `DeviceRemoved`
- [x] **LIVE-03**: Tile subtitle re-derives from the current device set on every relevant signal so it never goes stale

### Notifications (NOTIF)

- [x] **NOTIF-01**: When usbeehive emits `CapabilityDegraded` for a port, USBee surfaces a desktop notification describing the degradation (e.g. "Charging slower than expected on USB-C port 1 — cable limits to 60 W")
- [x] **NOTIF-02**: A given port emits at most one notification per degradation event (uses `replaces_id` for coalescing across daemon restarts within a short window)
- [x] **NOTIF-03**: The notification carries a "Don't notify for this port again" action that persists the mute decision in GSettings
- [x] **NOTIF-04**: Muted ports never raise further `CapabilityDegraded` notifications until unmuted via preferences

### Preferences (PREFS)

- [x] **PREFS-01**: GSettings schema `us.bitcreed.usbee` is installed and visible in `dconf-editor` when the extension is enabled
- [x] **PREFS-02**: Schema includes a per-port-mute key (`port-mutes` as `as`) that the notification action writes and the notifier reads
- [x] **PREFS-03**: Schema includes a "hide empty ports" boolean toggle that hides USB-C ports with nothing attached from the popover
- [x] **PREFS-04**: All preference reads/writes go through GSettings (no ad-hoc config file)

### State Handling (STATE)

- [x] **STATE-01**: When the usbeehive D-Bus name is not owned, the popover shows a graceful empty state with a copyable `systemctl --user enable --now usbeehive` hint instead of erroring or crashing
- [x] **STATE-02**: USBee watches `NameOwnerChanged` and automatically transitions out of the empty state when the daemon appears, without the user re-enabling the extension
- [x] **STATE-03**: USBee transitions back into the empty state cleanly if the daemon disappears at runtime
- [x] **STATE-04**: When the screen is locked (`Main.sessionMode.allowSettings === false`), the tile's "Preferences" / "More settings" entry is hidden
- [x] **STATE-05**: Extension correctly disables: all signal handlers, D-Bus proxies, GSettings bindings, and notification sources are released without "already disposed" warnings across screen-lock / unlock cycles

### Packaging & Distribution (PACK)

- [x] **PACK-01**: Project is licensed GPL-3.0 with a top-level `COPYING` file
- [x] **PACK-02**: Every user-visible string is wrapped in a gettext marker (`_()` / `gettext()`); a `.pot` template is generated from the source
- [x] **PACK-03**: Extension passes `gnome-extensions pack` and produces a zip ready for upload to extensions.gnome.org
- [x] **PACK-04**: `metadata.json` declares `shell-version` `["46", "47", "48"]` and a stable `uuid` rooted on the project's domain
- [x] **PACK-05**: Extension contains no bundled binaries, no `Gtk` / `Adw` imports in the Shell-process code, and no synchronous D-Bus or I/O calls — meeting EGO review guidelines
- [x] **PACK-06**: README documents the `usbeehive` daemon dependency and the `systemctl --user enable --now usbeehive` install path

## v2 Requirements

Deferred to a future release. Tracked but not in the v1 roadmap.

### Diagnostics (DIAG)

- **DIAG-V2-01**: "Copy diagnostic to clipboard" popover action that copies `usbeehive`'s `SnapshotJson` output (declare clipboard usage in EGO description)
- **DIAG-V2-02**: Trust-signal glyph on rows where usbeehive flags a suspect e-marker

### Device List (LIST)

- **LIST-V2-01**: PDO ladder rendering inside each USB-C port row, with the negotiated profile highlighted

### Preferences (PREFS)

- **PREFS-V2-01**: Adwaita preferences window (`prefs.js`) with master toggles for notifications and empty-port visibility, exposing the same GSettings keys as v1 dconf

### Notifications (NOTIF)

- **NOTIF-V2-01**: Coalesce successive degraded / restored events within a configurable window to avoid dock-attach noise

### Internationalisation (I18N)

- **I18N-V2-01**: Bundled translations for at least one additional locale (likely `de`) wired through the v1 gettext scaffolding

## Out of Scope

| Feature | Reason |
|---------|--------|
| Reading `/sys`, udev, or any USB data outside the usbeehive D-Bus interface | Violates the project's architectural rule; duplicates daemon work; EGO reviewers reject privileged probing |
| Running any USBee component as root | usbeehive is user-level; EGO forbids privilege escalation without `pkexec`; not needed |
| Top-panel `StatusIcon` / `libappindicator` tray | Deprecated GNOME pattern; KDE has its own C++ Plasmoid project; USBee is Quick Settings only |
| Standalone Adwaita window / "Open USBee" desktop entry | Out of scope per USBEE.md; `usbeehive --json` already serves the deep-dive audience |
| CLI shipped from this repo | usbeehive already owns the CLI surface; duplicating it would split bugs across two codebases |
| Configuration GUI for usbeehive itself | USBee is read-mostly; daemon configuration belongs upstream |
| Re-implementing USB enumeration or USB-PD decoding | usbeehive owns all USB knowledge; fixes go upstream |
| Connect / disconnect toast for every hotplug | Notification spam; users plug things in intentionally — only `CapabilityDegraded` raises a toast |
| Per-port wattage history graph | Adds persistent state to a glance-only surface; defer until validated demand |
| Auto-installing or auto-managing usbeehive from the extension | EGO forbids silent binary installs; daemon-missing state shows a copyable hint instead |
| Shipping USBee as a Flatpak | Shell extensions are not Flatpak-distributable — EGO is the distribution channel |
| "Report this cable" auto-upload | Even WhatCable doesn't auto-upload; privacy footgun |
| In-tile theming / colour customisation | Quick Settings tiles use Shell theming by design; review rejects theme-fighting |
| KDE / Plasma / Sway / non-GNOME desktop support | Out of scope per USBEE.md; a separate C++ Plasmoid project covers KDE |
| Bundled translations in v1 | Strings will churn during MVP; gettext markers ship in v1, translations in v2 |

## Traceability

All v1 requirements mapped to exactly one phase by the roadmapper.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TILE-01 | Phase 1 | Complete |
| TILE-02 | Phase 1 | Complete |
| TILE-03 | Phase 1 | Complete |
| TILE-04 | Phase 1 | Complete |
| LIST-01 | Phase 1 | Complete |
| LIST-02 | Phase 1 | Complete |
| LIST-03 | Phase 1 | Complete |
| LIST-04 | Phase 1 | Complete |
| LIST-05 | Phase 1 | Complete |
| LIST-06 | Phase 1 | Complete |
| DIAG-01 | Phase 1 | Complete |
| DIAG-02 | Phase 1 | Complete |
| LIVE-01 | Phase 1 | Complete |
| LIVE-02 | Phase 1 | Complete |
| LIVE-03 | Phase 1 | Complete |
| NOTIF-01 | Phase 2 | Complete |
| NOTIF-02 | Phase 2 | Complete |
| NOTIF-03 | Phase 2 | Complete |
| NOTIF-04 | Phase 2 | Complete |
| PREFS-01 | Phase 2 | Complete |
| PREFS-02 | Phase 2 | Complete |
| PREFS-03 | Phase 2 | Complete |
| PREFS-04 | Phase 2 | Complete |
| STATE-01 | Phase 1 | Complete |
| STATE-02 | Phase 1 | Complete |
| STATE-03 | Phase 1 | Complete |
| STATE-04 | Phase 2 | Complete |
| STATE-05 | Phase 1 | Complete |
| PACK-01 | Phase 2 | Complete |
| PACK-02 | Phase 2 | Complete |
| PACK-03 | Phase 2 | Complete |
| PACK-04 | Phase 1 | Complete |
| PACK-05 | Phase 1 | Complete |
| PACK-06 | Phase 2 | Complete |
| UI-01 | Phase 3 | Complete |
| UI-02 | Phase 3 | Complete |
| UI-03 | Phase 3 | Complete |
| UI-04 | Phase 3 | Complete |
| UI-05 | Phase 3 | Complete |
| WIRE-01 | Phase 4 | Pending |
| WIRE-02 | Phase 4 | Pending |
| WIRE-03 | Phase 4 | Pending |
| WIRE-04 | Phase 4 | Pending |
| CLEAN-01 | Phase 4 | Pending |
| CLEAN-02 | Phase 4 | Pending |
| CLEAN-03 | Phase 4 | Pending |
| DISP-01 | Phase 4 | Pending |
| DISP-02 | Phase 4 | Pending |
| DISP-03 | Phase 4 | Pending |
| DISP-04 | Phase 4 | Pending |
| DISP-05 | Phase 4 | Pending |
| COMPAT-01 | Phase 4 | Pending |
| COMPAT-02 | Phase 4 | Pending |
| REL-01 | Phase 4 | Pending |
| REL-02 | Phase 4 | Pending |
| REL-03 | Phase 4 | Pending |

**Coverage:**
- v1.0 requirements: 34 total, all Complete (Phase 01 + Phase 02 shipped)
- v1.1 requirements: 5 total (UI × 5), all Complete (Phase 03 shipped)
- v2.0 requirements: 16 total (WIRE × 4, CLEAN × 3, DISP × 5, COMPAT × 2, REL × 3), all mapped to Phase 4
- Phase 1: 21 requirements (TILE × 4, LIST × 6, DIAG × 2, LIVE × 3, STATE-01/02/03/05, PACK-04/05)
- Phase 2: 13 requirements (NOTIF × 4, PREFS × 4, STATE-04, PACK-01/02/03/06)
- Phase 3: 5 requirements (UI × 5)
- Phase 4: 16 requirements (WIRE × 4, CLEAN × 3, DISP × 5, COMPAT × 2, REL × 3)

---
*Requirements defined: 2026-05-11*
*Last updated: 2026-05-14 — v2.0 milestone added (Devices2 migration: WIRE × 4, CLEAN × 3, DISP × 5, COMPAT × 2, REL × 3); v1.1 marked Complete*
