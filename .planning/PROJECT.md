# USBee

## What This Is

USBee is a GNOME 46+ Quick Settings indicator that shows, at a glance,
what each attached USB device and USB-C port can actually do — link
speed, USB version, power draw, charging diagnostics, and (where the
hardware exposes it) live wattage. It is the GNOME-side companion to
the [`usbeehive`](https://github.com/) daemon (sibling project at
`../usbeehive`) and a clone-in-concept of the macOS menu-bar app
[WhatCable](https://github.com/darrylmorley/whatcable).

## Core Value

A GNOME-native, glanceable answer to "is this the fast port?" and
"why is my laptop charging slowly?" — without opening a terminal.

## Current Milestone: v2.0 Devices2 wire-shape migration

**Goal:** Cut over to usbeehive's `org.usbeehive.Devices2` interface —
delete every prose-parsing regex in USBee in favour of the structured
top-level fields the daemon now emits. Hard cut, no backwards
compatibility with `Devices1`. Ships as USBee v2.0.0 with a minimum
usbeehive version constant and the first EGO submission.

**Target features:**
- Bump `IFACE_XML` / `dbus-iface.xml` to `org.usbeehive.Devices2` and
  the new 19-field tuple shape; rewrite `unpackDeviceEntry` accordingly
- Delete the regex layer: `parseWatts` / `parseDirection` /
  `parseLinkSpeed` / `USB_VERSION_RE` + the WR-03 lookahead patch /
  `DIAG_PHRASES` substring scan / `keyForBullet` regex / `KEYWORD_MAP`
  headline scan — every consumer reads structured fields directly
- New `src/label-table.js` maps the daemon's machine-key vocabulary
  (`serial`, `mount`, `drivers`, `data_role`, `power_mode`,
  `pd_revision`, `plug_orientation`, `pd_contract`, `cable_speed`,
  `cable_current`, `cable_max_power`, `cable_type`, `cable_vendor`,
  `charger_max`, `usb_power_ma`) to gettext-wrapped display labels;
  unknown keys render verbatim
- `device_class` enum → symbolic-icon lookup table replacing the
  headline substring scan; defensive `SYMBOLIC_ICON_RE` guard retained
- Daemon-version gate: read `Version` property on proxy-ready and show
  a dedicated "Daemon out of date — please update usbeehive" empty
  state (distinct from "Daemon not running") if below the pinned
  minimum
- New UX surfaces for fields the v1 wire couldn't carry:
  `primary_driver == ""` badge, `device_subclass` rendering policy,
  `Status::Sourcing` (outbound charging) on the Tier-1 subtitle
- Lockstep release coordination: CHANGELOG entry, min-version constant,
  version bump to USBee v2.0.0, EGO first-submission

**Out of scope (explicit non-goals):**
- Any compatibility path with `Devices1` — no dual-shape unpacker, no
  feature-detect, no fallback parser. Old daemon → out-of-date empty
  state, full stop.
- Per-property markup/warnings (plain strings only).
- Non-USB-C diagnostics or speculative diagnostics ("would charge
  faster on a PD port").
- i18n of daemon-supplied prose fields (`headline`, `subtitle`,
  `vendor`, `product`) — those render verbatim, never wrapped in `_()`.

## Requirements

### Validated (v1.0)

- [x] Quick Settings tile that mirrors the modern GNOME tile pattern
      (Wi-Fi / Bluetooth / Sound), with a one-line headline summarising
      USB-C charging + fastest attached device
- [x] Expanded view listing every attached USB device / USB-C port
      with vendor + product name, negotiated speed, USB version, power
      direction, and live wattage when UCSI exposes it
- [x] Plain-English diagnostic per USB-C port ("Cable limited to USB
      2.0 — swap for a full-featured cable to reach 10 Gb/s")
- [x] Hotplug: list updates live via usbeehive's `DeviceAdded` /
      `DeviceRemoved` D-Bus signals
- [x] Charging-degraded desktop notification on
      `CapabilityDegraded`, once per event, dismissable, with a
      "Don't notify for this port" action persisted in GSettings
- [x] Graceful "daemon not running" empty state that watches
      `NameOwnerChanged` and lights up automatically when usbeehive
      appears on the session bus
- [x] Per-port mute preferences persisted in GSettings
      (`us.bitcreed.usbee`)
- [x] Strings wrapped in gettext markers so localisation can be
      added later without churn
- [x] Ship as a GNOME Shell extension for the GNOME 46+ Quick
      Settings API; reachable via Extensions / EGO install

### Validated (v1.1)

- [x] Per-device popover row that visually matches the
      Wi-Fi/Bluetooth device-row pattern (icon + headline + chevron),
      not the v1.0 two-column staircase layout
- [x] Click a device row to expand its diagnostic details; only one
      device row is open at a time (accordion behaviour)
- [x] Devices with daemon-flagged issues (non-empty `diagnostic`
      field) sort to the top of the device list
- [x] Each device row shows a class/driver-derived symbolic icon —
      generic USB icon for hubs and unrecognised devices, input-class
      icons for HID devices (keyboard, mouse), and matching icons for
      common storage / audio / video classes
- [x] Expanded device detail panel is styled coherently with the
      GNOME Wi-Fi/Bluetooth detail UX (not raw text bullets)

### Active (v2.0)

- [ ] USBee reads device data exclusively from
      `org.usbeehive.Devices2` structured fields (no regex parsing of
      bullet prose; `bullets` array no longer exists on the wire)
- [ ] Every regex/heuristic listed in the migration table is removed:
      `WATT_RE`, `DIRECTION_RE`, `USB_VERSION_RE` (incl. WR-03 patch),
      `SPEED_RE`, `hasIssue()` substring scan, `keyForBullet()`,
      `KEYWORD_MAP` headline scan
- [ ] Property labels in the popover detail panel come from a
      machine-key → gettext-wrapped display-label table; unknown keys
      render the raw key without crashing
- [ ] Device-row icons resolve from `device_class` enum lookup
      (defensive `SYMBOLIC_ICON_RE` guard on daemon-supplied icon name
      retained for security)
- [ ] USBee detects an out-of-date daemon via the `Version` property
      and displays a distinct "Daemon out of date — please update
      usbeehive" empty state (different copy from "Daemon not running")
- [ ] Tier-1 tile subtitle handles `Status::Sourcing` (outbound
      charging): "Powering: %s out"
- [ ] Devices without a kernel driver bound (`primary_driver == ""`)
      are surfaced in the UI (badge or detail-panel note — final
      treatment decided in Plan 1 UX section)
- [ ] USBee v2.0.0 is submitted to EGO for the first time; CHANGELOG
      records the breaking daemon dependency and the minimum required
      usbeehive version

### Out of Scope

- Standalone window or full app shell — Quick Settings + popover is the
  whole UI
- Configuration GUI for the daemon — USBee is read-mostly
- Re-implementing USB enumeration or USB-PD decoding — that lives in
  `usbeehive`; if the D-Bus surface is missing something, the change is
  made upstream first
- KDE / Plasma support — a separate C++ project already covers that
- Sway / non-GNOME desktop support in v1
- Running as root or installing system-wide services
- Localisation beyond English in v1 (deferred to v2)
- Translation of strings shipped in v1 — only the gettext scaffolding
  is in scope

## Context

- **Sibling daemon**: `usbeehive` lives at `~/projects/rust/usbeehive`.
  Since commit `5e216cd` (master, pre-release as of milestone start)
  it exposes `org.usbeehive.Devices2` on the session bus with
  19 typed top-level fields per device plus a `properties: a(ss)`
  bag of `(machine_key, value)` pairs — see
  `../usbeehive/CHANGELOG.md` "Devices2 wire" entry and
  `../usbeehive/src/dbus.rs` for the authoritative shape. Methods
  (`ListDevices`, `SnapshotJson`, `Diagnose`), properties (`Version`,
  `DeviceCount`), and signals (`DeviceAdded`, `DeviceRemoved`,
  `CapabilityDegraded`, `CapabilityRestored`) keep their names; only
  the interface name and tuple shapes change. USBee is a pure D-Bus
  client — it never reads `/sys` directly.
- **Upstream inspiration**: The macOS menu-bar app
  [WhatCable](https://github.com/darrylmorley/whatcable). USBee copies
  what's possible; improvements are welcome if they align with the
  goal of a glanceable GNOME indicator.
- **Target distros**: Fedora Workstation, Ubuntu GNOME (24.04 LTS,
  25.04, and the upcoming LTS), Arch + GNOME, openSUSE Tumbleweed
  GNOME — all of which ship GNOME 46+ today or imminently.
- **Distribution channels**: GNOME Extensions (EGO) as the primary
  channel; Flatpak considered for any companion binary if the chosen
  architecture needs one.
- **Existing repo state**: Greenfield. Only `USBEE.md` and this
  planning directory exist; no source code yet.

## Constraints

- **License**: GPL-3.0 (matches GNOME ecosystem norms and EGO
  expectations) — *not* the more-permissive license of `usbeehive`
- **Min GNOME**: 46 (modernised Quick Settings API; Ubuntu LTS
  baseline)
- **UI toolkit**: GTK4 + libadwaita 1.5+ if any GTK code is needed;
  otherwise GJS / Shell extension JS for the Shell-extension surface
- **Architecture rule**: All USB knowledge flows through usbeehive
  via D-Bus. USBee performs no `/sys` or udev access of its own
- **Heavy lifting belongs in `usbeehive`**, not USBee. If a desired
  capability would require non-trivial logic in the indicator, push
  the work upstream into the daemon and consume the result via D-Bus
- **Settings**: `GSettings` schema `us.bitcreed.usbee` (not TOML / not
  ad-hoc dotfile). The `us.bitcreed.*` namespace is the project's own
  vendor ID — `org.gnome.*` is reserved for components endorsed by the
  GNOME project, which USBee is not.
- **i18n**: English strings only for v1, but every user-visible
  string must go through gettext

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Target GNOME 46+ Quick Settings (not panel/tray) | Modern GNOME pattern, matches Wi-Fi/Bluetooth UX, removes need for legacy AppIndicator | — Pending |
| GNOME Shell extension as the deliverable, no separate user-service binary unless forced | User directive: "if we can do everything in a gnome-shell extension that's probably for the best"; usbeehive owns all heavy lifting | — Pending |
| GPL-3.0 license | User directive; matches GNOME ecosystem and EGO norms | — Pending |
| All USB data via `org.usbeehive.Devices1` D-Bus interface | usbeehive already implements it; avoids duplicate enumeration logic | — Pending |
| `usbeehive` runs as user-level systemd unit (`systemctl --user`) | Predictable lifecycle, simpler than D-Bus activation, matches user default | — Pending |
| Notify once per `CapabilityDegraded` event with per-port mute | Loud-enough-to-notice without becoming notification spam | — Pending |
| GSettings schema `us.bitcreed.usbee` for preferences | GNOME-native, visible in `dconf-editor`, integrates with Flatpak | — Pending |
| English-only strings + gettext markers in v1 | Defer translation cost without locking it out | — Pending |
| Pick async runtime / tile-host language during research | User left these open ("evaluate, pick best") — research phase will decide | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-14 — milestone v2.0 (Devices2 wire-shape migration) started after v1.1 shipped*
