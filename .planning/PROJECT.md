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

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Quick Settings tile that mirrors the modern GNOME tile pattern
      (Wi-Fi / Bluetooth / Sound), with a one-line headline summarising
      USB-C charging + fastest attached device
- [ ] Expanded view listing every attached USB device / USB-C port
      with vendor + product name, negotiated speed, USB version, power
      direction, and live wattage when UCSI exposes it
- [ ] Plain-English diagnostic per USB-C port ("Cable limited to USB
      2.0 — swap for a full-featured cable to reach 10 Gb/s")
- [ ] Hotplug: list updates live via usbeehive's `DeviceAdded` /
      `DeviceRemoved` D-Bus signals
- [ ] Charging-degraded desktop notification on
      `CapabilityDegraded`, once per event, dismissable, with a
      "Don't notify for this port" action persisted in GSettings
- [ ] Graceful "daemon not running" empty state that watches
      `NameOwnerChanged` and lights up automatically when usbeehive
      appears on the session bus
- [ ] Per-port mute preferences persisted in GSettings
      (`us.bitcreed.usbee`)
- [ ] Strings wrapped in gettext markers so localisation can be
      added later without churn
- [ ] Ship as a GNOME Shell extension for the GNOME 46+ Quick
      Settings API; reachable via Extensions / EGO install

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
  It already exposes `org.usbeehive.Devices1` on the session bus with
  methods (`ListDevices`, `SnapshotJson`, `Diagnose`), properties
  (`Version`, `DeviceCount`), and signals (`DeviceAdded`,
  `DeviceRemoved`, `CapabilityDegraded`, `CapabilityRestored`).
  USBee is a pure D-Bus client — it never reads `/sys` directly.
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
*Last updated: 2026-05-11 after initialization*
