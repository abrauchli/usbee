---
id: 260526-warning-badges-charging-diag
date: 2026-05-26
description: Show warning badges on is_warning popover rows and render charging_diag.summary/detail in the expanded detail panel
files:
  - usbee@bitcreed.us/src/popover.js
  - usbee@bitcreed.us/stylesheet.css
  - po/usbee@bitcreed.us.pot
source_todo: .planning/todos/pending/2026-05-15-show-warning-badges-and-in-panel-charging-diagnostics-in-pop.md
---

## Task

Three UX gaps from the post-v2.0.0 diagnostic review:

1. **Row warning badge** — `is_warning` rows sort to the top but have no
   visual indicator. Users who dismissed the notification have no way to
   spot the affected device at a glance.

2. **Charging diag in detail panel** — `charging_diag.summary` and
   `.detail` strings are available but never rendered. Expanding the row
   shows no explanation of the issue.

## Plan

### popover.js

- Add `row.add_style_class_name('usbee-row-warning')` when
  `device.charging_diag?.is_warning`.
- In `buildDeviceRow()`, when `charging_diag.present`, insert dedicated
  property rows before the `device.properties` loop:
  - Key: `_('Charging issue')` (is_warning) or `_('Charging')` (not)
  - Value: `charging_diag.summary`
  - If `charging_diag.detail` non-empty: second row with key `_('Detail')`
  - When `is_warning`, add `'usbee-detail-warning'` class to key labels
    via `get_children()[0]` on the returned `St.BoxLayout`.

### stylesheet.css

- `.usbee-row-warning` — amber left-border (3 px, `#e5a50a`) with 4 px
  compensating padding-left.
- `.usbee-detail-warning` — amber text color on warning key labels.

### po/.pot

- Regenerate via `xgettext` to capture `Charging issue`, `Charging`,
  `Detail`.
