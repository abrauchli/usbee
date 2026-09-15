---
quick_id: 260915-i4w
slug: add-in-popover-options-quick-toggles-bou
date: 2026-09-15
status: complete
---

# Quick Task 260915-i4w — Summary

## What landed

An **Options** submenu inside the Quick Settings popover carrying the four
filter switches, two-way bound to the same GSettings keys the preferences
window binds — and a new **Hide built-in devices** filter surfaced in both
places.

### Files changed

| File | Change |
|------|--------|
| `usbee@bitcreed.us/schemas/org.gnome.shell.extensions.usbee.gschema.xml` | New `hide-builtin-devices` key (`b`, default `false`) |
| `usbee@bitcreed.us/src/link-verdict.js` | New zero-import `isBuiltInDevice()` predicate |
| `usbee@bitcreed.us/src/popover.js` | Built-in filter in `populateDeviceRows()`; filter-aware empty state; new exported `buildOptionsSection()` |
| `usbee@bitcreed.us/src/tile.js` | Mounts the Options submenu; rebuilds the list on any filter change |
| `usbee@bitcreed.us/prefs.js` | New `Adw.SwitchRow` for `hide-builtin-devices` |
| `tests/forward-compat.test.js` | 7 unit tests for `isBuiltInDevice` + 20 structural guards |
| `CHANGELOG.md` | `[Unreleased]` entry |

## Decisions (inferred — human unavailable)

- **`hide-builtin-devices`, default `false`.** Non-destructive: nothing
  disappears from an existing user's list on upgrade. Built-in devices are
  *real devices*, unlike hubs (`show-hubs` defaults to hiding) which are pure
  topology noise, so the polarity and default differ deliberately.
- **Predicate is `mount === 'fixed'`, verified at the daemon source** —
  usbeehive `src/summary.rs:645` emits `mount` only as `fixed` or
  `removable`, dropping `unknown`/`""` (`src/usb.rs:71`). Absence therefore
  means "the kernel did not say" and is never treated as built-in. Guarded by
  a test asserting an absent mount is not built-in, and another asserting the
  match is case-sensitive.
- **Built-in devices carrying an issue stay visible** — the same escape hatch
  `show-hubs` uses (260905-b0s). The header subtitle counts issues, so hiding
  an issue-carrying row would report a fault with no row to open.
- **Predicate lives in `link-verdict.js`** (zero-import) so bare-gjs CI can
  unit-test it; `popover.js` imports gnome-shell resources and can only be
  guarded structurally.
- **Options is a `PopupSubMenuMenuItem`**, not four flat rows, so it does not
  push the device list down.
- **No re-entrancy guard on the two-way binding** — `setToggleState()` sets
  the switch without emitting `toggled`, so settings→row cannot feed back
  into row→settings.
- **Empty state now distinguishes filtered-empty from bus-empty**, since "No
  USB devices attached" is false when the user's own filters emptied the list.

## Verification

- All four CI suites pass: `dbus-client`, `daemon-status`, `forward-compat`,
  `service-probe`. `forward-compat` is 203 assertions, 0 failures, exit 0.
- `glib-compile-schemas --strict` accepts the new schema.
- `gsettings` round-trip in an isolated `GSETTINGS_SCHEMA_DIR`:
  `hide-builtin-devices` defaults to `false` and `list-keys` shows all seven
  keys.
- All edited JS parses under gjs.
- `PopupSubMenuMenuItem` + `.menu.addMenuItem()` is the idiom the device-row
  accordion in this same file already relies on, so that part is proven in
  tree.

## Residual risk, and how it was removed rather than documented

`PopupSwitchMenuItem` is new to this codebase, and this machine runs GNOME
Shell 50.1 whose UI JavaScript is not extractable from any installed
gresource bundle (`gresource list` over `/usr/bin/gnome-shell` and every
`/usr/share/gnome-shell/*.gresource` finds no `ui/popupMenu.js`). So the
documented "`setToggleState()` does not emit `toggled`" behaviour could not be
confirmed against the Shell actually installed here.

Rather than ship a binding that is correct only if that holds, the two-way
sync now carries a `syncing` latch, so it is correct under either semantics.
Two surfaces bound to one key writing to each other in a loop is the failure
this removes. Asserted by a test.

## Not verified

- **The popover itself** — rendering, the submenu's expand/collapse, and the
  live two-way sync as seen on screen need a GNOME Shell restart (Wayland:
  full re-login). Everything statically checkable was checked instead.
- The preferences window was not exercised in-process: the installed
  extension at `~/.local/share/gnome-shell/extensions/usbee@bitcreed.us` is a
  real directory holding the released v2.8.0, not a symlink to this
  checkout, so testing the new row there would mean overwriting the user's
  installed release. Deliberately not done. The schema and the binding were
  verified out-of-process instead.
