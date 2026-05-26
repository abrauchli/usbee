---
id: 260526-warning-badges-charging-diag
status: complete
date: 2026-05-26
commit: 1306c09
---

## Summary

Implemented both UI gaps from the 2026-05-15 diagnostic review todo.

**Changes:**

- `src/popover.js`: `usbee-row-warning` class added to rows where
  `charging_diag.is_warning`; new `charging_diag` detail rows inserted
  before the properties bag (key `_('Charging issue')` / `_('Charging')` +
  optional `_('Detail')` row); `usbee-detail-warning` class applied to key
  labels on warning rows via `get_children()[0]`.
- `stylesheet.css`: `.usbee-row-warning` (amber left-border `#e5a50a`,
  3 px + 4 px padding-left) and `.usbee-detail-warning` (amber key label
  colour).
- `po/usbee@bitcreed.us.pot`: regenerated; `Charging issue`, `Charging`,
  `Detail` msgids added.

**Not addressed (daemon-side, out of scope):** `ChargerLimit` dead enum
variant in `usbeehive/src/diagnostic.rs` — logged in the source todo as
lower priority and requires a daemon change, not a USBee change.
