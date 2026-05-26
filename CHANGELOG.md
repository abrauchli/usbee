# Changelog

All notable changes to USBee are recorded here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versions follow semantic versioning for the human-facing
`version-name`, while the EGO `version` integer is monotonic and
unrelated.

## [2.2.0] — 2026-05-26

Requires usbeehive >= 0.7.0 (unchanged from v2.1.0 — the new
`transport.usb4` property is additive on the existing Devices3 wire, so
USBee 2.2.0 runs against both 0.7.0 and 0.8.0 daemons; the USB4 pill
only renders when the 0.8.0 daemon's thunderbolt sysfs scan emits the
flag).

### Added

- `USB 4` pill in the transport pill strip when the daemon emits
  `transport.usb4=true` (usbeehive 0.8.0+). Renders between USB 3 and
  DisplayPort, preserving the locked
  USB → DisplayPort → Thunderbolt pill order.
- `transport.usb4` added to the `HANDLED_BY_DEDICATED_UI` deny-list so
  it never double-renders as a bare property row.
- "Interesting" predicate now fires on `transport.usb4` directly: a
  USB4 link is glance-worthy on its own, alongside DisplayPort
  alt-mode and Thunderbolt.

### Notes

- Active-PDO inference (the other usbeehive 0.8.0 change — nearest-PDO
  matching against live UCSI voltage) needs no client work. USBee's
  existing belt-and-braces active-PDO check (`is_active` OR `index
  === active_pdo_index`) already picks up the daemon's improved
  inference through the same wire fields.
- D-Bus interface name and signature unchanged from v2.1.0.

## [2.1.0] — 2026-05-26

Requires usbeehive >= 0.7.0. USBee now consumes
`org.usbeehive.Devices3`, surfaces cable trust signals, transport-altmode
pills, and the new structured Charger PDO list.

### Changed (breaking — D-Bus interface)

- Hard cut from `org.usbeehive.Devices2` to `org.usbeehive.Devices3`, no
  alias. `MIN_USBEEHIVE_VERSION` bumped to `0.7.0`; 0.6.x daemons fall
  through to the existing "Daemon out of date" empty state.
- `ListDevices` inner-tuple signature gains two trailing fields:
  `a(usuuuub)` for `pdo_list` and `i` for `active_pdo_index` (full
  signature: `a(ssssssssssqqsa(ss)ius(uus)(bsssb)a(usuuuub)i)`).

### Added

- Cable-trust amber detail row appears whenever any
  `cable.trust.zero_vid`, `cable.trust.vid_unknown`, or
  `cable.trust.reserved_bits` flag fires. Always visible — independent
  of the `show-technical-details` toggle, because cable safety is
  glance-priority.
- Transport pill strip at the top of the expanded device row when the
  device exposes a non-baseline transport: a DisplayPort alt-mode flag,
  a Thunderbolt flag, or a Type-C port that only negotiated USB 2.
  Pills render in fixed `USB → DisplayPort → Thunderbolt` order with
  rounded ends and a theme-neutral muted background.
- Structured `Charger PDOs` block renders one row per advertised PDO
  when `pdo_list` is non-empty. PPS / range-voltage PDOs render as
  `5–11 V`; non-Fixed kinds are appended as `(Kind)`. The active PDO
  gets a `◀` marker and a bolder key label (belt-and-braces:
  `is_active` OR `index === active_pdo_index`). Always visible — not
  gated on `show-technical-details`.
- `formatVolts(mv)` and `formatAmps(ma)` helpers in
  `src/device-store.js` joining `formatWatts` (now exported). All
  three share the WR-05 defensive guard for malformed inputs.
- `.usbee-pill-strip`, `.usbee-pill`, and `.usbee-pdo-active` style
  classes in `stylesheet.css`.

### Filtered

- `cable.trust.*` and `transport.*` property-bag keys are filtered out
  of the generic property-bag loop unconditionally (new
  `HANDLED_BY_DEDICATED_UI` deny-list) so they never double-render
  alongside their dedicated handlers. Forward-compat: unknown keys
  still fall through to the generic loop.
- Legacy `charger_max` row is suppressed in the generic loop when the
  structured `pdo_list` is non-empty; still renders for daemons that
  emit `charger_max` without the structured list.

### Notes

- `shell-version` array unchanged at `["46", "47", "48", "49", "50"]`;
  no GNOME Shell API surface change.
- The embedded `IFACE_XML` in `src/dbus-client.js` and the on-disk
  `usbee@bitcreed.us/dbus-iface.xml` are kept byte-equal (less the
  doctype) per the long-standing 04-02 Task 13 invariant.

## [2.0.0] — 2026-05-14

Requires usbeehive >= 0.6.0 (the value declared in `src/dbus-client.js` as
`MIN_USBEEHIVE_VERSION`). USBee refuses to consume any older daemon, surfacing
a dedicated "Daemon out of date" empty state instead. `MIN_USBEEHIVE_VERSION`
is declared in `src/dbus-client.js` and is the single source of truth for
the gate.

### Changed (breaking — D-Bus interface)

- Migrated to `org.usbeehive.Devices2` (was `Devices1`). 19-field structured
  `DeviceEntry` replaces the v1 prose-bullets shape. `Diagnose(port)` return
  type is now `(bsssb)` with a leading present bool.
- Daemon-version gate: USBee reads the `Version` D-Bus property on proxy-ready
  and refuses daemons older than `MIN_USBEEHIVE_VERSION` (currently `0.6.0`).

### Added

- `src/label-table.js` — machine-key to gettext display-label resolver covering
  `serial`, `mount`, `drivers`, `data_role`, `power_mode`, `pd_revision`,
  `plug_orientation`, `pd_contract`, `cable_speed`, `cable_current`,
  `cable_max_power`, `cable_type`, `cable_vendor`, `charger_max`,
  `usb_power_ma`. Unknown keys render the raw key (forward-compatible per
  D-2.0-06).
- `device_class` enum lookup table for symbolic icons (19 daemon variants).
  Daemon-supplied `icon` field is preferred when it passes the
  `SYMBOLIC_ICON_RE` guard.
- `Status::Sourcing` surfaced in the tile subtitle as "Powering: N W out".
  Sourcing entries do not trigger the issue-first sort.
- `primary_driver == ""` flag: an italic "Driver: not bound" row appears at
  the top of the detail panel for devices the daemon could not bind a driver to.
- `device_subclass` detail-panel row when the daemon emits a non-empty subclass
  string.
- New empty-state variant: "Daemon out of date — please update usbeehive" with
  copy distinct from the existing "Daemon not running".
- Forward-compatibility regression test (`src/forward-compat.test.js`)
  asserting unknown enum values fall through to safe defaults.

### Fixed (GNOME 46 compatibility)

- `St.BoxLayout` rows use the boolean `vertical: true/false` property (not the
  `orientation: Clutter.Orientation.*` enum, which is unavailable on GNOME 46).
- `_setOpenedSubMenu` shimmed on both `this.menu` and `this._rowsSection` to
  satisfy the GNOME 46 `QuickMenuToggle` subclass contract.

### Removed (regex layer)

Deleted from `src/device-store.js`:
- `WATT_RE`, `DIRECTION_RE`, `USB_VERSION_RE` (incl. WR-03 lookahead patch),
  `SPEED_RE`
- `parseWatts`, `parseDirection`, `parseLinkSpeed`, `DIAG_PHRASES`

Deleted from `src/popover.js`:
- `keyForBullet` (regex/keyword label-inference helper)

Deleted from `src/device-icon.js`:
- `KEYWORD_MAP` (driver/headline keyword table) and the headline-scan
  resolution path

Preserved (intentional):
- `SYMBOLIC_ICON_RE` in `src/device-icon.js` (security mitigation T-03-01)
- `formatWatts` in `src/device-store.js` (UI formatting helper)

### Notes

- First EGO submission. v1.0, v1.1, and v1.2 were built but never uploaded
  to extensions.gnome.org per CONTEXT D-2.0-08.
- `shell-version` array unchanged at `["46", "47", "48", "49", "50"]`; no
  GNOME Shell API surface change.

## [1.2.0] — 2026-05-13

Initial public release.

### Added
- Quick Settings tile rendering the live USB / USB-C state next to
  Wi-Fi, Bluetooth, and Sound.
- Subtitle line showing live charging wattage and aggregate link
  speed.
- Popover listing every attached USB device and USB-C port with a
  plain-English diagnostic per row.
- D-Bus client for `org.usbeehive.Devices1` with `DeviceAdded`,
  `DeviceRemoved`, and `CapabilityDegraded` signal handling.
- `Gio.bus_watch_name` integration so the tile shows an empty state
  when the `usbeehive` daemon is absent and auto-lights up when it
  appears.
- `MessageTray.Source` notifications for `CapabilityDegraded` events,
  with a "Don't notify for this port" action persisted in GSettings.
- Preferences window (libadwaita) listing per-port mute toggles.
- GSettings schema `us.bitcreed.usbee`.
- Symbolic-icon resolution with daemon-supplied icon trust + keyword
  fallback (keyboard, mouse, storage, audio, phone, etc.).
- GNOME Shell 46, 47, 48, 49, and 50 support.

[2.2.0]: https://github.com/abrauchli/usbee/releases/tag/v2.2.0
[2.1.0]: https://github.com/abrauchli/usbee/releases/tag/v2.1.0
[2.0.0]: https://github.com/abrauchli/usbee/releases/tag/v2.0.0
[1.2.0]: https://github.com/abrauchli/usbee/releases/tag/v1.2.0
