---
status: resolved
resolution: wont_fix
trigger: "When expanding a listing, it seems that an invisible entry at the end is causing some delayed relayouting causing the list to shrink just a tiny bit (a few px). Could that be the extended attributes? Pills also never visible. Wasn't there before today. On every single device."
created: 2026-05-26T21:02:37Z
updated: 2026-05-26T22:30:00Z
closed_reason: "Accepted as cosmetic (a few px, not user-blocking). Five experimental patches failed to eliminate the wobble; runtime bisect dead-ended at ed7acd6 because the user's usbeehive 0.8.0 daemon only speaks Devices3 and pre-ed7acd6 extension code is bound to Devices2. Pinning the root cause would require a usbeehive daemon downgrade or instrumenting Clutter natural-height measurements, both deferred."
---

## Current Focus

hypothesis: The bisect range the orchestrator note suggested (f37d157..HEAD) does NOT contain any commits that touch popover.js — the v2.2.0 chore commit and everything after it leave the per-row build path identical. The actual range of interest is `5802711..f37d157` (1306c09, 286c85f, ed7acd6, c130b50, 6cad52f, 6d6c58c) — all of today's popover changes, all already in v2.2.0. Re-reading buildDeviceRow, no NEW unconditional actor was added today; the unconditional skeleton (PopupSubMenuMenuItem + detailItem wrapper + detailBox) is byte-identical to the known-good 5802711 baseline. So an "always-empty wrapper" cannot be the regression — it was there before.

What IS new today and runs on every row: (1) `new Map(device.properties)` lookup map, (2) the call to `buildTransportPillStrip` that may add a PopupBaseMenuItem ABOVE the detailItem, (3) the call to `buildPdoListBlock` that adds rows when pdo_list is non-empty, (4) HANDLED_BY_DEDICATED_UI filtering that REMOVES property-bag rows that previously rendered, (5) `if (charging_diag?.is_warning) row.add_style_class_name('usbee-row-warning')` which adds a 3px left border + 4px padding on the row.

Leading candidate flipped: the user says pills are never visible, so `buildTransportPillStrip` returns null and no extra PopupBaseMenuItem is added. But the user's daemon is emitting `transport.usb3` (and possibly `transport.usb2` for type-A) as property-bag keys — those USED to render as bare rows in v2.1.0 and NOW get filtered out by HANDLED_BY_DEDICATED_UI. So the regression is `c130b50` (cable-trust + pill strip + HANDLED_BY_DEDICATED_UI) — that commit removed previously-rendered rows from the property bag while keeping the same wrapper skeleton.

But this still doesn't explain the WOBBLE direction (shrink) — fewer rows means smaller panel from the start, not a delayed shrink. The delayed shrink mechanism is most likely the `line_wrap = true` two-pass Pango measurement: first pass returns natural height with no wrapping (one line per row); after the open animation completes and final width is allocated, Pango re-measures and one or more rows compute a *smaller* natural height (Pango can shrink natural height when constrained width allows tighter line-spacing on certain font/locale combos, or when ellipsis hints kick in). This was present pre-today too, but in v2.1.0 the property bag had MORE rows so the per-row rounding error was masked / averaged out. With today's filtering, the panel is smaller and any single row's two-pass rounding is proportionally more visible.

test: Patch applied (commit f5042b9) — gated `clutter_text.line_wrap = true` to ONLY the four labels that can legitimately wrap (Summary, Charging summary, Charging Detail, Cable trust). Single-line property values now use Clutter's default single-line behaviour, so Pango performs no two-pass natural-height measurement on them.
expecting: If wobble disappears, line_wrap on single-line labels is confirmed as the wobble source and we ship the gated fix. If wobble persists, fall back to bisecting `5802711..f37d157` — 6 commits, log2(6) ≈ 2-3 hops, manageable on Xorg.
next_action: User reloads shell (Alt+F2 → r on Xorg, confirmed session type) and reports whether the wobble is gone on row expand.
reasoning_checkpoint: null
tdd_checkpoint: null

## Symptoms

expected: Expanding a device row in the USBee Quick Settings popover should be a clean static-size layout — the row opens to its natural height and stays put.
actual: The expanded panel briefly relayouts and shrinks by a few px shortly after opening — visible as a subtle "wobble" on every single device. User suspects "an invisible entry at the end" of the menu.
errors: None reported. Likely silent — needs `journalctl --user -f /usr/bin/gnome-shell` during repro to confirm.
reproduction: 1. Have USBee enabled with the current master build. 2. Open Quick Settings, expand the USBee tile. 3. Click any device row to expand its accordion sub-menu. 4. Observe a brief vertical relayout where the list shrinks a few px after the open animation settles.
started: Between v2.1.0 release (commit f6719d3, 2026-05-26 morning) and HEAD. Multiple popover-touching commits landed today: 1306c09 (warning badges), 286c85f (technical-details gate), ed7acd6 (Devices3 migration), c130b50 (cable-trust + pill strip + HANDLED_BY_DEDICATED_UI), 6cad52f (Charger PDOs block), 6d6c58c (USB 4 pill), fe2c748 (tile rebuild fix). User confirmed the wobble is on every device — so the culprit is something unconditional in the per-row build path OR something pre-existing whose visibility changed when other rows disappeared.

User-supplied side-observations:
- Technical-details rows (serial, data_role, etc.) are never visible even when the GSettings toggle is on — likely because the user's hardware doesn't emit those keys; not a bug, but it explains why a "Show technical details ON / OFF" test does not change the wobble.
- Transport pills (USB 2 / USB 3 / USB 4 / DisplayPort / Thunderbolt) are also never visible — this is consistent with `buildTransportPillStrip` returning null when none of the `interesting` conditions fire for the user's devices (no DP altmode, no Thunderbolt, no USB4, no TypeCPort stuck at USB 2).

These two observations together rule out the pill strip and the gated property rows as the wobble source (they don't render at all on the user's hardware), and point at something unconditional in `buildDeviceRow` OR something pre-existing that became visible after today's changes removed cover from neighbouring rows.

Session type: Xorg (Alt+F2 → r supports in-place shell reload).

## Eliminated

- hypothesis: Transport pill strip (popover.js:235–237) is the invisible entry
  evidence: `buildTransportPillStrip` returns null when not interesting; the call site is `if (pillStripItem) row.menu.addMenuItem(pillStripItem)` — null pillStripItem means no actor is added at all. User reports never seeing pills, consistent with the null branch. No actor → no wobble source from this code path.
  timestamp: 2026-05-26T21:02:37Z

- hypothesis: The `show-technical-details` gated rows (serial / data_role / power_mode / pd_revision / plug_orientation / cable_current / cable_type / drivers) are causing invisible entries
  evidence: `if (!showTech && GATED_KEYS.has(key)) continue;` is a clean continue in the property loop — no widget is added when the gate filters a key. When the gate is ON and the daemon DOES emit the key, the row renders normally and is visible. User reports never seeing the rows even with the gate on — explanation: their hardware doesn't emit those keys. Either way, no invisible widget.
  timestamp: 2026-05-26T21:02:37Z

- hypothesis: An always-empty `detailItem` wrapper at popover.js:241 is the invisible entry
  evidence: Verified via `git show 5802711:usbee@bitcreed.us/src/popover.js` — the identical detailItem + detailBox + `row.menu.addMenuItem(detailItem)` skeleton was already in the known-good baseline (commit 5802711, 2026-05-14). If this wrapper were the cause, the wobble would have existed pre-today. Falsified.
  timestamp: 2026-05-26T21:25:00Z

- hypothesis: An entirely new unconditional widget was added per row by today's changes
  evidence: `git diff 5802711..HEAD -- usbee@bitcreed.us/src/popover.js | grep -E '^\\s*\\+' | grep -iE 'add_child|addMenuItem|new (St\\.|PopupMenu\\.)'` shows every new actor sits behind a guard (`if (pillStripItem)`, `if (device.charging_diag?.present)`, `if (trustReasons.length > 0)`, `if (pdos.length === 0) return`). No unconditional new actor exists.
  timestamp: 2026-05-26T21:25:00Z

## Evidence

- timestamp: 2026-05-26T20:55:00Z
  checked: popover.js current source (after today's commits) — full buildDeviceRow function
  found: Unconditional widgets added per device row: (1) `row.icon` set, (2) `row.add_style_class_name('usbee-device-row')`, (3) `detailItem = new PopupMenu.PopupBaseMenuItem({...style_class: 'usbee-detail-panel'})` (line 241), (4) `detailItem.add_child(detailBox)` (line 251), (5) `row.menu.addMenuItem(detailItem)` (line 350). The detailItem wrapper is ALWAYS added even if detailBox ends up with zero children. usbee-detail-panel CSS gives it `padding: 6px 12px 6px 32px; spacing: 4px`.
  implication: First-pass candidate. Subsequently FALSIFIED — see Eliminated section: this skeleton is identical to known-good baseline 5802711.

- timestamp: 2026-05-26T20:55:00Z
  checked: `buildPropertyRow` at popover.js:477–505 — every value label has `clutter_text.line_wrap = true; line_wrap_mode = Pango.WrapMode.WORD_CHAR`.
  found: Pango wrapping labels typically require a two-pass measurement (natural-width first pass, constrained-width second pass) even when the text fits on one line. Tiny line-spacing rounding can compound across N rows.
  implication: PROMOTED to leading candidate. Same code was present in 5802711, but in v2.1.0 the property bag rendered more rows (transport.usb2 / transport.usb3 were not yet filtered) — the per-row rounding error was masked by the larger panel. After today's `HANDLED_BY_DEDICATED_UI` filtering, the panel got smaller (fewer property-bag rows) and the rounding-error wobble became proportionally visible.

- timestamp: 2026-05-26T20:55:00Z
  checked: commit c130b50 diff for popover.js
  found: Added `HANDLED_BY_DEDICATED_UI` set containing transport.usb2/3/4, transport.dp_altmode, transport.tb, cable.trust.zero_vid, cable.trust.vid_unknown, cable.trust.reserved_bits. These keys are now filtered out of the generic property-bag loop unconditionally (regardless of show-technical-details), and instead consumed by the conditional pill strip and cable-trust row.
  implication: This is the REGRESSION ENABLER (not the root cause). It removed previously-visible bare rows from the property bag, reducing detailBox child count, which exposed an already-present line_wrap two-pass measurement quirk that was previously masked.

- timestamp: 2026-05-26T21:25:00Z
  checked: Bisect range correction. `git log f37d157..HEAD -- usbee@bitcreed.us/src/popover.js` returns ONLY `fe2c748` (tile rebuild fix, doesn't touch buildDeviceRow). The orchestrator note's suggested bisect range is empty for popover.js. Correct range is `5802711..f37d157` (parent of 1306c09 through v2.2.0 chore commit) — 6 commits.
  implication: A bisect over `f37d157..HEAD` would falsely conclude "no bad commit" because the popover code at HEAD is identical to popover code at v2.2.0. The user is reporting v2.2.0 behaviour.

- timestamp: 2026-05-26T21:45:00Z
  checked: Patch f5042b9 applied — `buildPropertyRow` signature extended with `opts = {}`, `wrap = false` default. The two Pango lines (`clutter_text.line_wrap = true` + `line_wrap_mode = Pango.WrapMode.WORD_CHAR`) gated behind `if (wrap)`. Updated four call sites that pass legitimately multi-line prose to opt in: Summary (subtitle from daemon), Charging summary (charging_diag.summary, DIAG-02 multi-line), Charging Detail (charging_diag.detail, DIAG-02), Cable trust (joined prose from cable.trust.* reasons). Left at default (no wrap): PDO header, PDO entries, Driver row, Subclass row, generic property-bag loop.
  found: `node --check usbee@bitcreed.us/src/popover.js` returns OK. `git diff --stat` shows 39 insertions, 10 deletions in popover.js only. Commit f5042b9.
  implication: Awaiting Xorg shell reload by user to confirm wobble is gone. If confirmed, gating wrap to multi-line-only labels removes the wobble for the common single-line case without losing wrap-on-overflow for diagnostic prose.

## Resolution

root_cause: NOT IDENTIFIED. Runtime bisect confirmed wobble at c130b50 AND at ed7acd6 (parent of c130b50). Pre-ed7acd6 commits cannot be runtime-tested because the user's daemon (usbeehive 0.8.0) only speaks org.usbeehive.Devices3 and pre-ed7acd6 extension code is bound to Devices2 — the connection fails, popover shows empty/too-old state, no device rows to expand.

User-confirmed device profile: typical USB-A USB-3 devices. Every expanded panel renders Summary + Mount + USB bus power rows. No is_warning, no cable.trust.* flags, no PDOs, no DP/TB/USB4. Pills never appear. Wobble symptom: the expanded panel itself shrinks a few px after the open animation (NOT rows below shifting up).

Experimental patches applied + reverted — all failed to eliminate the wobble:
1. f5042b9 — `line_wrap` gated to Summary/Charging/Detail/Cable trust only. Reverted in 9a96ef5. Wobble persisted.
2. detailItem-when-empty guard at popover.js:350. Reverted. No-op for user (detailBox always has ≥3 children).
3. Full ellipsize (line_wrap = false, ellipsize = END on every value label). Reverted. Wobble persisted → eliminates Pango natural-height variance as the cause.
4. HANDLED_BY_DEDICATED_UI filter disabled (more rows render). Reverted. Wobble persisted → eliminates panel-size sensitivity.
5. buildTransportPillStrip + buildPdoListBlock calls commented out. Reverted. Wobble persisted → eliminates any function-call side effect from those two helpers.

Remaining hypotheses (untested):
- The wobble was actually present in 5802711-era extension code too, but the user's "wasn't there before today" perception was based on a different daemon (Devices2/0.6.x). Would need usbeehive downgrade to test.
- A GNOME Shell 46.2 / mutter natural-height-on-PopupSubMenu-open quirk that interacts subtly with St.BoxLayout. Untestable without a known-clean baseline to compare against.

fix: not applied
verification: blocked — runtime bisect dead-ended at ed7acd6 due to daemon-protocol incompatibility with pre-ed7acd6 extension code
files_changed: []
