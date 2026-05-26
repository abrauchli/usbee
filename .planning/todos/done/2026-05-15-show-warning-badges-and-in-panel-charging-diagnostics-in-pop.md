---
created: 2026-05-15T06:38:17.845Z
title: Show warning badges and in-panel charging diagnostics in popover
area: ui
files:
  - usbee@bitcreed.us/src/popover.js:158-219
  - usbee@bitcreed.us/src/device-store.js:201-204
  - usbee@bitcreed.us/src/notifier.js:83-101
  - usbeehive/src/diagnostic.rs:14-25
---

## Problem

Three related gaps surfaced in a diagnostic review:

**1. No visual warning indicator on popover rows (main gap)**

`hasIssue()` in `device-store.js:201` returns true when
`charging_diag.present && charging_diag.is_warning`, and `popover.js:87`
uses it only for issue-first sort order. There is no badge, colour change,
or icon on the row header itself. A user who dismissed the `CapabilityDegraded`
notification (or had port-mutes on, or started USBee after plugging in) will
open the tile, see the affected device sorted to the top, and have no idea why.

**2. Expanded detail panel doesn't show the active diagnostic**

`buildDeviceRow()` in `popover.js:158` builds the detail panel from
`device.subtitle` and `device.properties` key-value pairs. The
`charging_diag.summary` and `charging_diag.detail` fields are separate named
fields on the DeviceEntry — they are never rendered anywhere in the popover.
So even after expanding the accordion row for a CableLimit port, the user sees
no text explaining the issue. The daemon-generated strings ("Cable is limiting
charging speed", "Cable rated for 60W, but charger can deliver 100W") are
available but unused in the UI.

**3. `ChargerLimit` daemon enum variant is dead code**

`usbeehive/src/diagnostic.rs:17` defines `ChargerLimit` ("Charger is offering
less than expected") but `ChargingDiagnostic::evaluate()` at line 46 has no
code path that produces it. It can only emit `CableLimit`, `DeviceLimit`, or
`Fine`. Should either be implemented with real detection logic (e.g. when
cable e-marker rating exceeds charger's negotiated max) or removed from the
enum to avoid false promises. This is a daemon-side issue, not a USBee fix.

## Solution

**UI changes (USBee, main deliverable):**

1. When `charging_diag.is_warning`, add a warning style class to the
   `PopupSubMenuMenuItem` row header — e.g. `row.add_style_class_name('usbee-row-warning')`.
   Style it in `stylesheet.css` with a warning colour on the row label or a
   small warning icon overlay. The `is_warning` boolean is the canonical flag
   — don't re-derive from bottleneck string.

2. In `buildDeviceRow()`, when `charging_diag.present`, add a dedicated
   property row to the detail panel *before* the `device.properties` loop:
   - Key: `_('Charging issue')` (when `is_warning`) or `_('Charging')` (when not)
   - Value: `device.charging_diag.summary` (verbatim, `.text =` not markup)
   - If `charging_diag.detail` is non-empty, add a second row with key `_('Detail')`
   Both rows should use the existing `buildPropertyRow()` helper.
   When `is_warning`, optionally add `'usbee-detail-warning'` style class to the
   key label.

**Daemon change (usbeehive, lower priority):**

3. Either implement `ChargerLimit` detection in `evaluate()` — fire when the
   cable can handle more than the charger's negotiated max (opposite of
   `CableLimit`) — or remove the variant from the enum and add a code comment
   explaining why it was dropped.
