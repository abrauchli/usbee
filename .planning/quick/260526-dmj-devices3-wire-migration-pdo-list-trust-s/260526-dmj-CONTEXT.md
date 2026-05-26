---
name: 260526-dmj-context
description: Locked decisions for Devices3 wire migration + PDO list, trust signals, transport pills
status: Ready for planning
gathered: 2026-05-26
---

# Quick Task 260526-dmj: Devices3 migration + 3 UI features — Context

<domain>
## Task Boundary

usbeehive shipped 0.7.0 on 2026-05-26 with `org.usbeehive.Devices3` (hard cut, no alias) plus:
- Two new structured wire fields on every `DeviceEntry`: `pdo_list: a(usuuuub)` and `active_pdo_index: i`
- Seven new fire-only machine-keyed properties: `cable.trust.{zero_vid,vid_unknown,reserved_bits}`, `transport.{usb2,usb3,dp_altmode,tb}`
- Phone classifier fix (pure-daemon — Cat S61 and other Android handsets now classified as `DeviceClass::Phone`, extension gets the right icon for free once Devices3 is wired)

This task implements the extension-side counterpart in **three atomic commits**:
1. Wire migration (mandatory prerequisite — extension cannot read Devices3 today).
2. Property-bag UI: cable trust signal row + transport-flag pill strip.
3. Structured PDO list rendering (replaces `charger_max` property row when `pdo_list` is non-empty).

Out of scope (NOT in this task):
- 8087:0029 headline fix — daemon still emits empty `iProduct` fallback to `vid:pid` hex. Not in upstream 0.7.0.
- Any new GSettings keys.
- Any change to the existing CapabilityDegraded notification flow.

</domain>

<decisions>
## Implementation Decisions (LOCKED via AskUserQuestion + analysis)

### A. Wire migration (Task 1 — mandatory prerequisite)

- `INTERFACE_NAME`: `'org.usbeehive.Devices2'` → `'org.usbeehive.Devices3'` (`src/dbus-client.js:26`).
- `MIN_USBEEHIVE_VERSION`: `'0.6.0'` → `'0.7.0'` (`src/dbus-client.js:33`).
- IFACE_XML `<interface name="org.usbeehive.Devices2">` → `Devices3` (same file line 71).
- `ListDevices` return signature update — append two trailing fields to the existing 19-field tuple:
  - `<arg type="a(usuuuub)" name="pdo_list" direction="out"/>`
  - `<arg type="i" name="active_pdo_index" direction="out"/>`

  Full new signature: `a(ssssssssssqqsa(ss)ius(uus)(bsssb)a(usuuuub)i)`.

  **NOTE:** The XML in `dbus-client.js` declares ListDevices as `aa(...inner tuple...)`. The inner-tuple element type is what needs the two trailing field entries. Verify the exact XML edit against current file shape.

- `DeviceStore.unpackDeviceEntry` (`src/device-store.js:27-61`): consume tuple[19] and tuple[20]. Add to the returned object:
  ```
  pdo_list:         tuple[19] || [],
  active_pdo_index: tuple[20] ?? -1,
  ```
  Where each PDO entry inside `pdo_list` is itself a tuple `[index, kind, voltage_mv, max_voltage_mv, current_ma, power_mw, is_active]` — see daemon `PdoEntry` type. Unpack each into a named object inside the loop so popover.js never indexes by tuple position (matches the existing pattern for power/charging_diag).

- The "daemon-too-old" path in `dbus-client.js:192` already exists and gates on `MIN_USBEEHIVE_VERSION`; bumping the constant automatically routes a user running 0.6.x to the existing "daemon out of date" empty state. No new copy needed.

- Devices2 → Devices3 is a hard cut. Match the codebase pattern set by the Devices1 → Devices2 migration (see `src/dbus-client.js:21-31` comment block). No backwards-compatible shim, no alias.

### B. UI Decision 1 — Trust signals (Task 2, "Single row, orange")

When ANY of `cable.trust.zero_vid`, `cable.trust.vid_unknown`, `cable.trust.reserved_bits` is set to `"true"` in the properties bag:

- Render exactly ONE detail-panel row, NOT one per fired flag.
- Key label: `_('Cable trust')`
- Value: gettext-translated hedged copy listing fired reasons. Tone is intentionally soft — "this looks unusual" not "this is fake" (upstream WhatCable convention per `../usbeehive/UI_PLAN.md` §5).
  - Reasons map (each is a separate gettext-marked string for translator clarity):
    - `cable.trust.zero_vid` → `_('vendor ID is zero')`
    - `cable.trust.vid_unknown` → `_('vendor ID not in USB-IF list')`
    - `cable.trust.reserved_bits` → `_('reserved bits set in Cable VDO')`
  - Joined with `_(', ')` separator (i18n-safe; some locales use a different separator).
  - Final string: `_('This cable looks unusual: %s').format(reasons)`.
- Visual style: amber/orange — reuse the existing `.usbee-detail-warning` color (#e5a50a), the same accent used for charging-issue rows. Apply that style class to the **key** label of the trust row (mirrors `usbee-detail-warning` usage in popover.js:202).
- The trust row is **always visible** when fired, regardless of `show-technical-details`. Cable safety is a glance-priority signal.
- Row ordering: place AFTER the charging diagnostic rows but BEFORE the property-bag loop (so it sits in the "headline diagnostics" zone, not buried among cable-vendor / cable-speed rows).

### C. UI Decision 2 — Transport flags (Task 2, hybrid "pill strip when interesting")

Render a horizontal pill strip as the FIRST element in the expanded detail panel — but **only when interesting**.

**"Interesting" predicate** (gate the pill strip's existence on this):
- `transport.dp_altmode = true` OR
- `transport.tb = true` OR
- `transport.usb2 = true` AND `device.category === 'TypeCPort'` (USB2 on Type-C is diagnostic — slow cable suggests an issue)
- For everything else (plain USB-A `transport.usb3`, plain USB-A `transport.usb2`), suppress the pill strip — it adds noise without signal.

**Pill set within the strip** (when the strip renders, ALL fired transports are shown):
- If `transport.usb2 = true` → pill labelled `_('USB 2')`
- If `transport.usb3 = true` → pill labelled `_('USB 3')`
- If `transport.dp_altmode = true` → pill labelled `_('DisplayPort')`
- If `transport.tb = true` → pill labelled `_('Thunderbolt')`

Order pills in this sequence: USB → DisplayPort → Thunderbolt. Skip pills whose flag is not set.

**Placement & widget shape:**
- A horizontal `St.BoxLayout` containing one `St.Label` per pill, wrapped in a non-reactive `PopupMenu.PopupBaseMenuItem` to fit the detail-panel rhythm.
- Style class `.usbee-pill-strip` on the container, `.usbee-pill` on each label.
- CSS adds: `border-radius: 999px; padding: 2px 10px;` muted background (use `rgba(255, 255, 255, 0.10)` for theme-neutral). Spacing between pills: 6px.
- Render at the TOP of the detail-panel `detailBox` (before Summary row), so it functions as a visual headline for the expanded card.

**No surprise-only highlighting** — all "interesting" cases render all fired pills uniformly. The "interesting" gate is binary; once it fires, show everything fired.

### D. UI Decision 3 — Structured PDO list (Task 3, "Replace charger_max")

When `pdo_list.length > 0`:

- **Suppress the legacy `charger_max` property row** from the property-bag loop (filter at iteration time — same site as the existing `GATED_KEYS` filter in popover.js).
- Render a dedicated PDO block AFTER the trust row but BEFORE the property-bag loop. Single header row (`_('Charger PDOs')`) followed by one row per PDO:
  - Row layout: `voltage` (e.g. `15V`) — `current` (e.g. `3A`) — `power` (e.g. `45W`).
  - Active PDO (where `is_active === true` OR the entry's `index === active_pdo_index`) gets a left arrow marker `◀` AND a bolder style class. Either signal alone is sufficient — both are belt-and-braces.
  - PDO kind (Fixed/PPS/Battery/Variable/Unknown) renders inline only when kind !== 'Fixed' (Fixed is the boring default; surfacing it on every row is noise).
- Formatting helpers (pure JS, lives near formatWatts in device-store.js or in a new tiny `pdo.js`):
  - `formatVolts(mv)` → `'15 V'` (whole) or `'4.7 V'` (one decimal if mv % 1000 !== 0).
  - `formatAmps(ma)` → `'3 A'` (whole) or `'1.5 A'` (one decimal if ma % 1000 !== 0).
  - Existing `formatWatts(w)` already lives in `device-store.js:72` — reuse for power-mw / 1000.
- PPS PDOs have a voltage range — display as `"5–11 V"` (using `min_voltage_mv` ≈ `voltage_mv`, max from `max_voltage_mv`).
- **Always visible when fired** (NOT gated behind `show-technical-details`) — the PDO list IS the "why am I charging slowly" answer per upstream WhatCable + UI_PLAN.md §5.

### E. Forward-compat invariants

- **Unknown property keys still render** by default (existing rule from the show-technical-details gate). The new `cable.trust.*` and `transport.*` keys are pulled OUT of the generic property-bag loop and rendered via dedicated handlers, but the loop's "render unknown" behaviour for other keys is preserved.
- After adding the new dedicated handlers, the trust/transport keys must NOT also render as bare rows in the property-bag loop. Filter them out of the loop, alongside `charger_max` when `pdo_list` is non-empty.

### Claude's Discretion (within locked decisions)

- Exact XML edit shape (must verify against the current `IFACE_XML` block — the current file uses inline XML, not a separate file).
- Whether the PDO render lives in a new helper module (`src/pdo-render.js`) or inline in `popover.js` — preference: inline if total LOC <30, extract if more.
- Whether `formatVolts` / `formatAmps` live in `device-store.js` (next to `formatWatts`) or are inlined in popover. Style call.
- Pill-strip widget choice (`PopupBaseMenuItem` wrapper vs. naked `St.BoxLayout` as the first child of `detailBox`). Pick whichever fits PopupSubMenu's child-element expectations cleanly.

</decisions>

<specifics>
## Specific Code References

- `src/dbus-client.js:21-33` — `INTERFACE_NAME` + `MIN_USBEEHIVE_VERSION` constants and the explanatory comment block.
- `src/dbus-client.js:71` — IFACE_XML `<interface name="...">` element.
- `src/dbus-client.js:73-83` — `<method name="ListDevices">` block; the inner tuple-element type needs the two trailing fields.
- `src/dbus-client.js:192` — daemon-too-old version check (no edit needed, just bumps automatically).
- `src/device-store.js:27-61` — `unpackDeviceEntry`. Add tuple[19] / tuple[20] unpacking; unpack each PDO entry into named keys.
- `src/device-store.js:72` — `formatWatts` reference for the PDO render row.
- `src/popover.js:196-211` — charging-diagnostic render site; trust row goes immediately after this block.
- `src/popover.js:235-238` — property-bag loop where filtering happens (the existing `GATED_KEYS` filter is at this site; extend it).
- `stylesheet.css:69-79` — existing `.usbee-row-warning` and `.usbee-detail-warning` color (#e5a50a) — reused for the trust row.
- `../usbeehive/CHANGELOG.md` §[0.7.0] — authoritative source for wire-shape spec.
- `../usbeehive/src/dbus.rs:251-336` — PdoEntry type definition + ListDevices signature + interface block.

## Verification ground truth

Run the daemon at 0.7.0 first to introspect the live shape:
```
busctl --user introspect org.usbeehive.Devices /org/usbeehive/Devices
```
Confirm `<interface name="org.usbeehive.Devices3">` and the new ListDevices signature before committing.

</specifics>

<canonical_refs>
## Canonical References

- `../usbeehive/CHANGELOG.md` lines 7–80 — full 0.7.0 release notes (wire spec, migration table, new keys exhaustive list).
- `../usbeehive/src/dbus.rs` lines 1–95 — interface module docs.
- `../usbeehive/src/dbus.rs` lines 224–336 — `PdoEntry`, `DeviceEntry` field additions, conversion impl.
- `../usbeehive/UI_PLAN.md` §5 "UI / UX patterns worth porting" — anchors the trust-row hedged copy + the PDO-list-as-headline-charging-answer guidance.

</canonical_refs>
