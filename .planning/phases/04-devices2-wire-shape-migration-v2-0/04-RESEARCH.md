# Phase 04: Devices2 wire-shape migration — Research

**Researched:** 2026-05-14
**Status:** Authoritative spec already exists upstream; this document
indexes it and captures USBee-side patterns the migration must respect.

## Why this RESEARCH.md is short

A `/gsd-phase-researcher` spawn was skipped intentionally. The classic
research dimensions (technical approach, library choice, API surface)
all have **already-shipped, source-of-truth answers**:

- **Wire shape:** `../usbeehive/src/dbus.rs:108-393` is the
  implementation. The 19-field `DeviceEntry` struct (lines 168-218),
  `PowerEntry` struct (lines 109-130), and `DiagnosticEntry` struct
  (lines 134-167) define the wire verbatim. Reading this file is the
  research.
- **Property vocabulary + classification rules:**
  `../usbeehive/CHANGELOG.md` `[Unreleased]` section contains the
  full regex→field migration table, bullet→property-key map, and
  day-one `device_class` classification fidelity table. Reading this
  file is the research.
- **GNOME / GJS API:** No new GNOME APIs are needed. The migration
  modifies existing call sites; the popover row pattern
  (`PopupSubMenuMenuItem`), GSettings access, signal registry, and
  notification surface all come from the v1.0/v1.1 codebase
  unchanged.

Spawning a researcher would re-derive what these sources already
state. The user's autonomy mandate explicitly authorised skipping.

## Authoritative external references

Read these directly when planning or executing:

| File | Lines | Purpose |
|------|-------|---------|
| `../usbeehive/src/dbus.rs` | 108-393 | `DeviceEntry` / `PowerEntry` / `DiagnosticEntry` definitions; `#[interface(name = "org.usbeehive.Devices2")]` block with method/signal/property declarations |
| `../usbeehive/CHANGELOG.md` | `[Unreleased]` | Regex → structured-field migration table, bullet → property-key map, device_class classification fidelity table, enum extensibility convention |
| `../usbeehive/src/summary.rs` | `DeviceSummary` | Source of truth for what each field carries semantically (kernel-side wiring of class detection, PD contract derivation, etc.) |
| `../usbeehive/Cargo.toml` | `version = "0.5.1"` | **Caveat:** Cargo.toml has not been bumped since Devices2 landed. Plan 04-01 confirms the prospective `MIN_USBEEHIVE_VERSION` |

## DBus tuple signature reconstruction

`ListDevices()` returns `a(...)` where the inner struct, in field
order from `DeviceEntry`:

```
( s s s s s s s s s s    -- id, category, device_class, device_subclass, status, headline, subtitle, icon, vendor, product (10 strings)
  q q                    -- vendor_id, product_id (uint16 pair)
  s                      -- primary_driver
  a(ss)                  -- properties: array of (machine_key, value)
  i                      -- port_number (-1 sentinel)
  u                      -- link_speed_mbps
  s                      -- usb_version
  (uus)                  -- power: (power_in_mw, power_out_mw, power_role)
  (bsssb)                -- charging_diag: (present, bottleneck, summary, detail, is_warning)
)
```

Full single-line signature for `ListDevices` arg:
`a(ssssssssssqqsa(ss)ius(uus)(bsssb))`

Plan 04-02 task must verify this against `busctl --user introspect
org.usbeehive.Devices /org/usbeehive/Devices` on a host with the
shipped daemon running (acceptance: live introspection output matches
this signature character-for-character).

## Existing USBee patterns the migration must respect

Each of these patterns has a Phase 1 / Phase 2 / Phase 3 precedent —
the migration should reuse them rather than invent new ones.

### Pattern: D-Bus proxy lifecycle (`src/dbus-client.js`)

- `BUS_NAME` / `OBJECT_PATH` / `INTERFACE_NAME` declared as
  module-level constants (lines 25-27).
- `IFACE_XML` is a template literal kept in sync with the on-disk
  `dbus-iface.xml`.
- Proxy is constructed lazily inside the `Gio.bus_watch_name`
  "name-appeared" callback (D-05), NOT eagerly at `enable()`. This
  pattern stays.
- `notify::g-name-owner` is wired on the proxy for daemon-disappears
  mid-session (D-07). **Add to this**: a Plan 04-02 task wires the
  `Version` property read on proxy-ready and routes the result to a
  daemon-version-gate predicate. If too old, the DBusClient signals a
  distinct empty state (not the existing `'lost'` signal — needs a
  new signal name or a status-string parameter).

### Pattern: Empty states (`src/empty-state.js`)

- `buildEmptyStateItem()` returns a single `PopupMenu.PopupMenuItem`
  containing title + selectable `St.Entry` + help text.
- The existing "Daemon not running" state lives here. Plan 04-01
  adds a sibling builder (e.g. `buildDaemonOutOfDateItem()`) or a
  parameterised version with copy variants.
- Copy decision (locked by D-2.0-05 risk text): title "Daemon out of
  date", body explains the version mismatch and points at the
  `usbeehive` GitHub releases page or `systemctl --user restart
  usbeehive` after upgrade.

### Pattern: Defensive validation of daemon strings

- `SYMBOLIC_ICON_RE = /^[a-z0-9][a-z0-9-]*-symbolic$/` in
  `src/device-icon.js` (T-03-01).
- This guard remains. The new `device_class` enum lookup runs FIRST;
  if `device_class === 'Unknown'`, fall back to daemon-supplied
  `icon` field IF it passes `SYMBOLIC_ICON_RE`, else generic USB icon.

### Pattern: Per-bullet → per-property migration in `src/popover.js`

- Today's `buildDeviceRow()` iterates `device.bullets` and labels each
  via `keyForBullet()`. Replace with iteration over
  `device.properties` (an array of `[machine_key, value]` tuples).
  Resolve the display label via `label-table.js`:
  ```js
  const labelKey = labelTable.get(machine_key) ?? machine_key;
  ```
- The `buildPropertyRow(key, value, category)` helper stays as-is —
  it already takes structured `(key, value)` inputs. No structural
  change beyond the iteration source.

### Pattern: Subtitle Tier-1 in `src/device-store.js::deriveSubtitle`

- Today's Tier-1 filter: `category === 'TypeCPort' && status ===
  'Charging'`. Extend to include `'Sourcing'` (the new daemon
  variant). The existing direction-aware branches at lines 146-153
  already handle both directions — only the filter predicate needs
  to widen.
- After the migration, `parseWatts` and `parseDirection` go away;
  the function reads `device.power.power_in_mw`,
  `device.power.power_out_mw`, and `device.power.power_role`
  directly.

### Pattern: `hasIssue(device)` predicate

- Today scans bullets for diagnostic phrases. Collapses to:
  ```js
  export function hasIssue(device) {
      return device.charging_diag?.present === true
          && device.charging_diag?.is_warning === true;
  }
  ```
- Sourcing entries naturally fall out: `charging_diag.present` is
  `false` per D-2.0-03.

## Forward-compatibility test design (WIRE-04)

Plan 04-02 adds a regression test (or unit-style fixture, depending
on test infrastructure already present) that proves unknown enum
strings don't crash the renderer:

```js
const futureDevice = unpackDeviceEntry([
  "usb:future", "UsbDevice", "FutureGadget", "experimental",
  "Connected", "Future Thing", "", "drive-removable-media-symbolic",
  "FutureCorp", "MagicWidget", 0xFFFF, 0x0001, "future_driver_v2",
  [["future_prop", "magic_value"]], -1, 99999, "5.0",
  [0, 0, "Quantum"], [false, "", "", "", false]
]);
// Assert: iconForDevice(futureDevice) returns a valid GNOME icon
// (probably the generic USB icon via Unknown fallthrough)
// Assert: buildDeviceRow(futureDevice) renders without throwing
// Assert: deriveSubtitle([futureDevice]) returns a valid string
```

## Out of scope for research

(captured here so the planner doesn't accidentally re-introduce them)

- Re-researching GJS / GNOME Shell APIs. The v1.1 codebase uses the
  modern patterns correctly; nothing about the wire migration
  exercises new GNOME surface.
- Re-researching D-Bus proxy patterns. `makeProxyWrapper` stays.
- Per-property markup design. Plain strings only (per D-2.0-04 and
  the captured todo's out-of-scope list).
- Domain research on USB-PD diagnostics. The daemon owns the
  diagnostic logic; USBee renders what's emitted.

## Open questions (DEFER TO Plan 04-01)

See CONTEXT.md §"Decisions To Settle During Plan 04-01" — the four
UX picks. Not blockers for *this* document; they are the deliverable
of 04-01-PLAN.md.
