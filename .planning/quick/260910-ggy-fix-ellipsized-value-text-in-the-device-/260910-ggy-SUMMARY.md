---
phase: 260910-ggy
plan: "01"
status: complete
subsystem: popover detail panel
tags: [quick-fix, ui, text-wrapping, st-label, pango]
dependency_graph:
  requires: []
  provides: [wrapping-property-panel-values]
  affects:
    - usbee@bitcreed.us/src/popover.js
    - usbee@bitcreed.us/src/empty-state.js
    - tests/forward-compat.test.js
tech_stack:
  added: []
  patterns: ["clutter_text.line_wrap must be paired with ellipsize = Pango.EllipsizeMode.NONE"]
key_files:
  created: []
  modified:
    - usbee@bitcreed.us/src/popover.js
    - usbee@bitcreed.us/src/empty-state.js
    - tests/forward-compat.test.js
commits:
  - 683708f  fix(popover): wrap property-panel values instead of truncating them
  - d6806ed  fix(empty-state): pair every line_wrap with an ellipsize reset
  - cedb4e8  test(quick-260910-ggy): guard the line_wrap/ellipsize pairing
---

# Quick Task 260910-ggy Summary

Every value row in the expanded device detail panel rendered as a single
ellipsized line — `Realtek · Vendor Spec…`, `480 Mb/s (USB 2.1) —…` — so
the panel whose entire job is to spell out what a port can do was hiding
the answer.

## Root cause

`buildPropertyRow()` in `src/popover.js` already asked for wrapping, but
never cleared the ellipsize mode `St.Label` ships with
(`PANGO_ELLIPSIZE_END`). `ClutterText` forwards both the ellipsize mode
and the wrap mode to the same `PangoLayout` and never calls
`pango_layout_set_height()`; Pango's default height of `-1` means
"ellipsize at line one", so ellipsization wins and `line_wrap` is inert.

Confirmed against the system Pango with the exact layout settings
ClutterText applies:

| ellipsize | wrap | lines | ellipsized |
|-----------|------|-------|------------|
| END       | WORD_CHAR | 1 | yes |
| NONE      | WORD_CHAR | 3 | no  |

This is a one-property bug, not a layout-width bug.

## What changed

1. **`src/popover.js`** — `buildPropertyRow()` clears `ellipsize` on the
   value label (activating the existing `line_wrap` + `WORD_CHAR`) and on
   the key label, and gives the key `y_align: START` so it sits on the
   first line of a wrapped value. With an ellipsize mode set, ClutterText
   reports a minimum width of 0 and a squeezed row could truncate the key
   as well; with `ellipsize = NONE` and no wrap its minimum width is its
   natural width, so the key always renders in full and the value column
   absorbs the squeeze.
2. **`src/empty-state.js`** — the same latent bug, nine wrapping labels
   fixed identically (+ the `Pango` import and a module-header note).
3. **`tests/forward-compat.test.js`** — a CI guard asserting the pairing
   per file (so a *new* wrapping label cannot reintroduce it) plus the
   property-row specifics. Verified the guard bites: removing the value
   label's ellipsize reset fails the suite.

No user-visible string was added, shortened or reworded; no gettext call
site moved.

## Two layout questions this fix depends on, both checked

- **Does a wrapped label in a *horizontal* box report the right height?**
  Yes. `St.BoxLayout` delegates to `ClutterBoxLayout`, whose
  `get_preferred_size_for_opposite_orientation()` distributes the width
  across children first and only then asks each child for its height at
  *its own* allocated width — true height-for-width. So the detail row
  grows to fit the wrapped value instead of clipping it.
- **Can the popover get wider as a result?** No. `ClutterText`'s
  *natural* width is the full unbroken string either way; an ellipsize
  mode only affects the *minimum* width. The fix therefore leaves every
  natural width untouched and only raises the key label's minimum from 0
  to its natural width — a few em on strings like "Max bus power".

## Alternatives rejected

- **Hover-to-expand tooltip** — GNOME Shell exposes no tooltip API to
  extensions; it would mean private Shell internals (CLAUDE.md "What NOT
  to Use"), and it has no keyboard or touch path. Moot once nothing is
  truncated.
- **Shortening the source strings** — the truncated text is real
  information (capability verdicts, vendor class, remedies), not
  redundancy.
- **Stacking the label above the value for long values** — buys ~100px at
  the cost of a second, inconsistent row shape.
- **Widening the popover** — the Quick Settings grid owns the width; an
  extension cannot change it.

## Tests

`gjs -m` on all three CI suites (`dbus-client`, `daemon-status`,
`forward-compat`) — all pass, run through `rtk proxy` so no output was
filtered.

## Inferred decisions to audit

- **D-1 — No per-value line cap.** A pathological daemon value now wraps
  to as many lines as it needs. Deemed acceptable because the popover is
  already height-capped and scrolls
  (`.usbee-popover-scroll { max-height: 50ex }`), every curated string is
  short, and the only unbounded source (unknown keys) is behind the
  "Show technical details" toggle. Revisit if a real daemon value ever
  produces a wall of text.
- **D-2 — Scope widened to `empty-state.js`.** Not in the original
  request, but the identical bug, a one-line fix each, and leaving known
  dead `line_wrap` calls in place would have made the new CI guard
  unenforceable.
- **D-3 — No CSS change.** The 32px left indent (icon alignment) and the
  `7em` key column were left alone rather than shaved for a few extra
  pixels; alignment is worth more than one word per line.

## Not verifiable without a live GNOME Shell

Everything here is a widget-property change that only takes visible
effect inside `gnome-shell`. Verified: the Pango-level behaviour that
proves the mechanism, the ClutterBoxLayout height-for-width contract, JS
syntax, and the source-level guards in CI. NOT verified: the rendered
panel itself. A human should restart the Shell (Xorg `Alt+F2` → `r`,
Wayland re-login), expand a device row and confirm the Summary / Link
rows now wrap and that the key column stays top-anchored beside them.
