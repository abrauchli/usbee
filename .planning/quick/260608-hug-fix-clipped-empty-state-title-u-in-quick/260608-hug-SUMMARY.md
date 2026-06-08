---
phase: 260608-hug
plan: "01"
subsystem: empty-state UI
tags: [quick-fix, ui, layout, css, gettext]
dependency_graph:
  requires: []
  provides: [unclipped-empty-state-titles]
  affects: [usbee@bitcreed.us/src/empty-state.js, usbee@bitcreed.us/stylesheet.css]
tech_stack:
  added: []
  patterns: [St.Label as vertical-box first-child, item.label.hide() pattern]
key_files:
  created: []
  modified:
    - usbee@bitcreed.us/src/empty-state.js
    - usbee@bitcreed.us/stylesheet.css
decisions:
  - "Hide item.label with .hide() rather than leaving it empty to eliminate residual minimum-width allocation"
  - "Add title as St.Label with x_expand:true inside the vertical box, not as item.label replacement"
  - "CSS margin-bottom: 2px on title supplements the 8px box spacing without introducing a font-size change"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-08T18:55:56Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 260608-hug Plan 01: Fix clipped empty-state title Summary

Fix PopupMenuItem layout bug that caused all three empty-state titles to render as "u..." (ellipsized) in the USBee Quick Settings popover. Title St.Label moved from `item.label` (horizontal sibling competing with x_expand box) into the vertical body box as its first child.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Move titles into the vertical body box in all three builder functions | 647fbd6 | usbee@bitcreed.us/src/empty-state.js |
| 2 | Add CSS rule for .usbee-empty-state-title in stylesheet.css | e0f3bc0 | usbee@bitcreed.us/stylesheet.css |

## What Was Built

Three builder functions in `src/empty-state.js` (`buildEmptyStateItem`, `buildDaemonNotInstalledItem`, `buildDaemonOutOfDateItem`) were modified identically:

1. `item.label.text = _(...)` replaced with `item.label.hide()` — eliminates residual minimum-width allocation from the built-in PopupMenuItem label widget.
2. A new `St.Label` with `style_class: 'usbee-empty-state-title'` and `x_expand: true` is created with `line_wrap = true`, wrapping the original title string (unchanged) in the existing `_()` gettext call.
3. `box.add_child(title)` is called before `box.add_child(hint)`, making the final child order inside the vertical box: title -> hint -> entry.

A `.usbee-empty-state-title` CSS rule was added to `stylesheet.css` between the existing `.usbee-empty-state-body` and `.usbee-empty-state-entry` rules, with `font-weight: bold` and `margin-bottom: 2px`.

## Decisions Made

- **item.label.hide() over clearing text**: An empty `item.label` still allocates minimum width in `PopupMenuItem`'s horizontal layout. `hide()` removes it from the layout pass entirely, ensuring the body box gets the full available width.
- **x_expand: true on title label**: Consistent with the hint and entry widgets in the same box; ensures the title fills the full box width rather than shrinking to text width.
- **No font-size change in CSS**: `font-weight: bold` alone is sufficient to read as a heading; changing font-size would disrupt the Adwaita vertical rhythm.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None - both modified files contain only developer-controlled string constants; no user input crosses either boundary.

## Self-Check: PASSED

- `usbee@bitcreed.us/src/empty-state.js` - present and contains 3 occurrences of `usbee-empty-state-title`, 0 occurrences of `item.label.text`
- `usbee@bitcreed.us/stylesheet.css` - present and contains 1 occurrence of `usbee-empty-state-title`
- Commit 647fbd6 - exists (Task 1)
- Commit e0f3bc0 - exists (Task 2)
