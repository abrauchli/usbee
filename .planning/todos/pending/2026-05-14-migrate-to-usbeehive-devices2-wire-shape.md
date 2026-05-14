---
created: 2026-05-14T01:58:27.730Z
title: Migrate to usbeehive Devices2 wire shape
area: general
resolves_phase: 4
files:
  - usbee@bitcreed.us/dbus-iface.xml
  - usbee@bitcreed.us/src/dbus-client.js:40-78
  - usbee@bitcreed.us/src/device-store.js:36-117
  - usbee@bitcreed.us/src/device-store.js:209-223
  - usbee@bitcreed.us/src/popover.js:138-153
  - usbee@bitcreed.us/src/device-icon.js:29-42
  - usbee@bitcreed.us/src/device-icon.js:60-90
---

## Problem

usbeehive is implementing a new `org.usbeehive.Devices2` D-Bus interface that
replaces today's prose-bullet wire shape with structured fields. The
cross-team spec is locked. USBee migrates in lockstep the week the daemon
ships v2.

The migration deletes every regex/heuristic on the UI side and replaces it
with direct field access. Everything below is settled and must not be
re-litigated when the phase starts.

### Locked wire shape (Devices2)

`org.usbeehive.Devices1` → `org.usbeehive.Devices2`. Hard cut, no parallel.
Same bus name + object path. Method/signal names unchanged; tuple shapes
change.

Per-device top-level fields:

- `id` (s)
- `category` (s) — enum: `Hub` | `TypeCPort` | `UsbDevice`
- `device_class` (s) — enum: `Keyboard` | `Mouse` | `Storage` | `Display` |
  `Audio` | `Camera` | `Printer` | `Phone` | `Hub` | `NetworkWired` |
  `NetworkWireless` | `InputTablet` | `Gamepad` | `SecurityKey` |
  `SmartcardReader` | `Bluetooth` | `Serial` | `VideoCapture` | `Unknown`.
  `TypeCPort` removed from this enum; device_class is `Unknown` when
  category=TypeCPort.
- `device_subclass` (s) — daemon-curated, non-binding, may be empty
- `status` (s) — existing values + new `Sourcing` for outbound charging
- `headline` (s), `subtitle` (s), `icon` (s) — display prose, rendered
  verbatim, NOT gettext-wrapped
- `vendor` (s), `product` (s) — manufacturer prose, top-level (hoisted out
  of properties)
- `vendor_id` (q), `product_id` (q) — uint16, UI formats as
  `${hex(4)}:${hex(4)}`
- `primary_driver` (s) — empty when unbound
- `properties` (a(ss)) — flat (machine_key, value) pairs; replaces v1
  `bullets`
- `port_number` (i) — `-1` if not a Type-C port
- `link_speed_mbps` (u) — uint32 Mbit/s (NOT bps); `0` if unknown
- `usb_version` (s) — canonical short form (`"3.2 Gen 2x2"`, no `"USB "`
  prefix); empty if unknown
- `power` ((uus)) — `(power_in_mw, power_out_mw, power_role)`. role enum:
  `Source` | `Sink` | `DualRole` | `Unknown`. Non-zero `power_in_mw` ⟺
  PD-sinking right now (does NOT include bMaxPower).
- `charging_diag` ((bsssb)) — `(present, bottleneck, summary, detail,
  is_warning)`. bottleneck enum: `NoCharger` | `ChargerLimit` |
  `CableLimit` | `DeviceLimit` | `Fine`. Absent on Sourcing.

`Diagnose(port)` returns `(bsssb)` to match.

Property machine-key vocabulary (USBee maps key → localized display label):
`serial`, `mount`, `drivers` (composite list), `data_role`, `power_mode`,
`pd_revision`, `plug_orientation`, `pd_contract`, `cable_speed`,
`cable_current`, `cable_max_power`, `cable_type`, `cable_vendor`,
`charger_max`, plus `usb_power_ma` or `usb_power_mw` (daemon's call on
units; voltage assumption to be documented daemon-side).

Enum extensibility contract: adding variants to `device_class` /
`device_subclass` / `status` / `power_role` / `bottleneck` is non-breaking.
UIs MUST treat unknown values as `Unknown` / fallback. USBee asserts this
with a test.

### NO backwards compatibility — HARD RULE

This phase does NOT plan, ship, or scaffold support for any pre-Devices2
daemon. When the phase starts, the minimum-supported usbeehive version is
**whatever usbeehive has released by that date** — not whatever was current
when this todo was written.

- Encode that exact version as a constant; do not parameterize, do not
  feature-detect, do not write compat shims.
- If a user runs old usbeehive against new USBee: show a dedicated "Daemon
  out of date — please update usbeehive" empty state (distinct from
  "Daemon not running"). That's it. No degraded mode, no v1 fallback path,
  no dual-shape unpacker.

The point of the hard cut is to delete the regex/heuristic layer
**entirely**. A compat shim re-imports the prose-parsing this cross-team
negotiation removed. Reject any plan task that adds one.

## Solution

Run pre-implementation prep tasks while waiting for usbeehive v2 to ship.
Then run a single phase that bumps everything in lockstep.

### Pre-implementation prep (can land before daemon ships)

1. **Daemon-version gate design** — ADR for where the version check lives
   (proxy-ready introspection vs `Version` property), the distinct "out of
   date" empty-state copy, and the min-version constant location
   (`dbus-client.js`).
2. **Property-label gettext catalogue** — stage `_("…")` calls in a new
   `label-table.js` for the machine-key vocabulary above, so translations
   enter the `.pot` pipeline before code wires the table up. Test: unknown
   key renders raw key, not crash.
3. **`device_class` → icon mapping table** — audit Adwaita symbolic icon
   names for every enum variant. Decide icons for `SmartcardReader`,
   `Bluetooth`, `Serial`, `VideoCapture` (no obvious Adwaita fit for some
   — pick now). Decide policy on `device_subclass` affecting icon choice
   (recommend: ignore for v2.0, subclass surfaces in metadata only).
4. **New-signal UX decisions:**
   - `primary_driver == ""` on a connected device: badge? Detail-panel
     note? Ignore?
   - `device_subclass` display: append to row title (`"Storage · SSD"`),
     detail panel only, or ignore in v2.0?
   - `Status::Sourcing`: confirm Tier-1 subtitle copy (`"Powering: %s out"`
     — already present at `device-store.js:148`); confirm Sourcing does
     NOT trigger issue-first sort.
5. **Phase plan skeleton** — pre-stage
   `.planning/phases/NN-devices2-migration/` with the task list mapped:
   XML bump → unpackDeviceEntry → delete regex layer → label-table
   wire-up → icon-table wire-up → version-gate wire-up →
   Sourcing/primary_driver UX wire-up → tests → CHANGELOG/min-version
   note.

### Code USBee deletes during the migration

Sanity check that the wire shape covers everything currently
regex-derived:

- `src/device-store.js`: `WATT_RE`, `DIRECTION_RE`, `USB_VERSION_RE`
  (including the "USB 3xtra" lookahead patch WR-03), `SPEED_RE`,
  `parseWatts`, `parseDirection`, `parseLinkSpeed`, the `DIAG_PHRASES`
  substring scan inside `hasIssue()` (becomes one-liner
  `device.charging_diag.present && device.charging_diag.is_warning`).
- `src/popover.js::keyForBullet`: deleted entirely; rows iterate
  `device.properties` and resolve labels via the new gettext catalogue.
- `src/device-icon.js::KEYWORD_MAP` and the headline substring scan:
  replaced by the enum lookup table. `SYMBOLIC_ICON_RE` defensive guard
  stays (security mitigation, T-03-01).

### Release coordination

Lockstep release: USBee v2.0.0 ships the same week as the usbeehive
release introducing Devices2.

EGO submission strategy: hold v1.2.0 from EGO entirely. First EGO
submission is v2.0.0 with the clean wire (avoids burning a manual review
cycle on a known-deprecated shape).

CHANGELOG for v2.0.0 names the minimum usbeehive version explicitly and
notes the breaking daemon dependency.

### Out of scope for this phase

- Per-property markup/warnings (plain strings only).
- Non-USB-C diagnostics.
- Speculative diagnostics ("would charge faster on a PD port").
- i18n of daemon prose fields (`headline`, `subtitle`, `vendor`,
  `product`).
- Any compatibility path with Devices1.
