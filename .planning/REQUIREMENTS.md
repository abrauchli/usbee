# Requirements: USBee

**Defined:** 2026-05-11
**Core Value:** A GNOME-native, glanceable answer to "is this the fast port?" and "why is my laptop charging slowly?" — without opening a terminal.

## v1 Requirements

Initial release: a GNOME 46+ Shell extension that mounts a Quick Settings tile, talks to the `usbeehive` daemon over D-Bus, and ships to extensions.gnome.org.

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

**Coverage:**
- v1 requirements: 34 total
- Mapped to phases: 34 (100%) ✓
- Unmapped: 0
- Phase 1: 21 requirements (TILE × 4, LIST × 6, DIAG × 2, LIVE × 3, STATE-01/02/03/05, PACK-04/05)
- Phase 2: 13 requirements (NOTIF × 4, PREFS × 4, STATE-04, PACK-01/02/03/06)

---
*Requirements defined: 2026-05-11*
*Last updated: 2026-05-11 — traceability populated by roadmapper*
