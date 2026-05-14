# Changelog

All notable changes to USBee are recorded here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versions follow semantic versioning for the human-facing
`version-name`, while the EGO `version` integer is monotonic and
unrelated.

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

[1.2.0]: https://github.com/abrauchli/usbee/releases/tag/v1.2.0
