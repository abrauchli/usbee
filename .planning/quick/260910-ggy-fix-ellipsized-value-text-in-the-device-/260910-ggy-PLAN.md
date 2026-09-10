---
phase: 260910-ggy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - usbee@bitcreed.us/src/popover.js
  - usbee@bitcreed.us/src/empty-state.js
  - tests/forward-compat.test.js
autonomous: true
requirements: [QUICK-260910-ggy]

must_haves:
  truths:
    - "Device property-panel values render in full, wrapped over as many lines as needed — never cut off with an ellipsis"
    - "Property key labels (left column) render in full and top-align beside a wrapped value"
    - "Every label that already sets clutter_text.line_wrap also clears the St.Label default ellipsize"
    - "No user-visible string is changed, shortened, or concatenated — gettext call sites are untouched"
  artifacts:
    - path: "usbee@bitcreed.us/src/popover.js"
      provides: "buildPropertyRow() rows whose value labels actually wrap"
    - path: "tests/forward-compat.test.js"
      provides: "CI structural guard against the ellipsize/line_wrap regression"
  key_links:
    - "St.Label ships ellipsize=PANGO_ELLIPSIZE_END; Pango ellipsizes the first line and ignores wrap unless layout height is set, which ClutterText never sets"
---

# Quick Task 260910-ggy: Fix ellipsized value text in the device property panel

## Problem

In the expanded device detail panel every value renders as one truncated
line:

```
Summary         Realtek · Vendor Spec…
Link            480 Mb/s (USB 2.1) —…
Max bus power   350 mA
```

The panel exists to answer "what can this port actually do"; a cut-off
answer defeats it.

## Root cause

`usbee@bitcreed.us/src/popover.js:718-725` (`buildPropertyRow`) builds the
value label and sets:

```js
valLbl.clutter_text.line_wrap      = true;
valLbl.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
```

but never touches `ellipsize`. `St.Label` constructs its internal
`ClutterText` with `ellipsize = PANGO_ELLIPSIZE_END` by default, and
`ClutterText` pushes both `pango_layout_set_ellipsize()` and
`pango_layout_set_wrap()` onto the same layout without ever calling
`pango_layout_set_height()`. Pango's layout height defaults to `-1`, i.e.
"ellipsize at one line", so ellipsization wins and the wrap setting is
inert.

Verified directly against the system Pango (same layout settings
ClutterText applies):

| ellipsize | wrap | lines | ellipsized |
|-----------|------|-------|------------|
| END       | WORD_CHAR | 1 | yes |
| NONE      | WORD_CHAR | 3 | no  |

So this is a one-property bug, not a layout-width bug. The popover's width
is fixed by the Quick Settings grid and cannot be widened from an
extension; wrapping is the only way to show the whole value, and vertical
space is already bounded by `.usbee-popover-scroll { max-height: 50ex }`.

The same latent bug sits in `src/empty-state.js`, where eight labels set
`line_wrap = true` and are likewise silently ellipsized to one line.

## Approach

1. Clear the inherited ellipsize on the value label so the existing
   `line_wrap` takes effect.
2. Clear it on the key label too and top-align it. With `ellipsize` set,
   `ClutterText`'s minimum width collapses to 0, so a squeezed row could
   truncate the key as well; with `ellipsize = NONE` and no wrap, the key
   label's minimum width equals its natural width, so the key is always
   shown in full and the value column absorbs the squeeze.
3. Apply the same one-line fix to the eight already-wrapping labels in
   `empty-state.js`.
4. Add a CI structural guard so the pairing cannot regress.

Rejected alternatives (recorded for audit):

- **Hover-to-expand tooltip** — GNOME Shell has no public tooltip API for
  extensions; it would mean private Shell internals (CLAUDE.md "What NOT
  to Use"), and it has no keyboard or touch path. Moot once nothing is
  truncated.
- **Shortening the source strings** — the truncated text is real
  information (verdicts, vendor class, remedies), not redundancy.
- **Stacking label above value for long values** — buys ~100px at the cost
  of a second, inconsistent row shape; wrapping already shows everything.
- **Widening the popover** — not available to an extension; the Quick
  Settings grid owns the width.

## Tasks

### Task 1 — popover.js: make property-row labels wrap instead of truncate

**Files:** `usbee@bitcreed.us/src/popover.js`

**Action:** In `buildPropertyRow()`, set
`clutter_text.ellipsize = Pango.EllipsizeMode.NONE` on the value label
(next to the existing `line_wrap` lines) and on the key label; give the
key label `y_align: Clutter.ActorAlign.START` so it sits on the first line
of a wrapped value. Update the function's doc comment to record why the
ellipsize reset is load-bearing.

**Verify:** `grep -n "EllipsizeMode.NONE" usbee@bitcreed.us/src/popover.js`
shows both labels; no gettext call site changed
(`git diff -- usbee@bitcreed.us/src/popover.js | grep '^[-+].*_('` is empty).

**Done:** Value labels wrap; key labels cannot be truncated.

### Task 2 — empty-state.js: same fix for the already-wrapping labels

**Files:** `usbee@bitcreed.us/src/empty-state.js`

**Action:** For each label that sets `clutter_text.line_wrap = true`, also
set `clutter_text.ellipsize = Pango.EllipsizeMode.NONE`. Add the `Pango`
import if absent.

**Verify:** count of `line_wrap = true` equals count of
`ellipsize = Pango.EllipsizeMode.NONE` in the file.

**Done:** Long daemon-state hints wrap instead of being cut.

### Task 3 — CI guard against the regression

**Files:** `tests/forward-compat.test.js`

**Action:** In the existing `# popover.js contains the property dump`
block (and a matching empty-state assertion), assert that every
`line_wrap = true` in `src/popover.js` and `src/empty-state.js` is
accompanied by an `ellipsize = Pango.EllipsizeMode.NONE`, since St.Label
defaults to ellipsizing and that silently disables wrapping.

**Verify:** `gjs -m tests/forward-compat.test.js` passes; temporarily
reverting Task 1 makes it fail.

**Done:** The pairing is enforced in CI.

## Out of scope

- Collapsed device-row headline ellipsis — correct behaviour for a
  single-line row.
- Popover width / padding changes.
- Any change to daemon strings or to `label-table.js` formatting.
