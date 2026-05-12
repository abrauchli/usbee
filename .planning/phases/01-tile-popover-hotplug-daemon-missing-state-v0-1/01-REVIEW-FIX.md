---
phase: 01-tile-popover-hotplug-daemon-missing-state-v0-1
fixed_at: 2026-05-12T00:00:00Z
review_path: .planning/phases/01-tile-popover-hotplug-daemon-missing-state-v0-1/01-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-05-12
**Source review:** `.planning/phases/01-tile-popover-hotplug-daemon-missing-state-v0-1/01-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (1 Critical, 5 Warning)
- Fixed: 6
- Skipped: 0

## Fixed Issues

### CR-01: Duplicate vanish path — `_onVanished` runs twice on daemon disconnect

**Files modified:** `usbee@bitcreed.us/src/dbus-client.js`
**Commit:** 9ac363e
**Applied fix:** Early-return guard at the top of `_onVanished()`: if
`this._store.daemonRunning` is already false, the second emitter (either
`bus_watch_name` vanish or `notify::g-name-owner`) becomes a no-op.
Eliminates duplicate `setDevices([])`, duplicate `'lost'` emissions, and
the double-repaint on the tile.

### WR-01: Timer registry leak — every fired debounce emits `GLib-CRITICAL` on disable

**Files modified:** `usbee@bitcreed.us/src/signal-registry.js`,
`usbee@bitcreed.us/src/dbus-client.js`
**Commit:** 4a69006
**Applied fix:** `SignalRegistry.addTimeout()` now returns a dispose
handle (idempotent function) that removes the entry from `_entries`.
`DBusClient._scheduleRefresh` stores the handle in `this._dropDebounce`
and invokes it in both branches: when cancelling an in-flight timer AND
when the timeout callback runs to completion. The registry no longer
carries stale source ids, so `GLib.Source.remove()` is never called on
a stale id and the `GLib-CRITICAL` spam at disable is eliminated.

### WR-02: No user-visible string is wrapped in `gettext` — violates project i18n constraint

**Files modified:** `usbee@bitcreed.us/src/tile.js`,
`usbee@bitcreed.us/src/device-store.js`,
`usbee@bitcreed.us/src/empty-state.js`,
`usbee@bitcreed.us/src/popover.js`
**Commit:** 92441b7
**Applied fix:** Imported `{gettext as _}` from
`resource:///org/gnome/shell/extensions/extension.js` in all four
files. Wrapped every user-facing literal in `_()`:
- `tile.js`: `_('USBee')`, `_('USB devices')`
- `device-store.js`: `_('Daemon not running')`, `_('Charging: %s in')`,
  `_('Powering: %s out')`, `_('USB-C: %s')`, `_('USB-C: charging')`,
  `_('1 device')`, `_('%d devices')`, `_('Nothing connected')`. Template
  literals rewritten to `.format(...)` per CLAUDE.md i18n rule.
- `empty-state.js`: `_('usbeehive daemon not running')`, `_('Run this
  command, then this list will populate automatically:')`
- `popover.js`: `_('No USB devices attached')`
- `metadata.json` already declared `gettext-domain` — no change needed.

Tier-2 daemon-supplied strings (USB version label, human rate) remain
unwrapped because they are data passed through verbatim from the
daemon, not extension copy.

Also incorporated **IN-02** in this same commit (touched `tile.js`):
removed the dead `subtitle: 'Starting…'` constructor arg in favour of
`subtitle: store.subhead`, since the immediate `this.subtitle =
store.subhead` reassignment made the literal unreachable.

### WR-03: `_onAppeared` re-entrant branch silently calls `_snapshotImmediate` on a dead/changing proxy

**Files modified:** `usbee@bitcreed.us/src/dbus-client.js`
**Commit:** 041e41f
**Applied fix:** In the re-entrant branch (proxy already constructed),
added `if (this._proxy.gNameOwner === null) return;` before the
`_snapshotImmediate()` call. Owner-churn orderings that deliver
name-appeared before the proxy's owner property has propagated now
short-circuit; the next `notify::g-name-owner` (or `bus_watch_name`
appear) drives the refresh. Uses the camelCase accessor recommended by
gjs.guide (also resolves IN-05 for this site).

### WR-04: `PopupMenuItem` `style_class` constructor param is not part of the documented API

**Files modified:** `usbee@bitcreed.us/src/empty-state.js`,
`usbee@bitcreed.us/src/popover.js`
**Commit:** 16b68c4
**Applied fix:** Dropped `style_class:` from both `PopupMenuItem`
constructor param objects (`'usbee-empty-state'` and
`'usbee-device-row'`) and applied them via `item.add_style_class_name(...)`
post-construction. Pattern uses only the documented `PopupBaseMenuItem`
surface; no longer depends on params leaking through to `St.BoxLayout`.

### WR-05: `notify::g-name-owner` handler retains `this._proxy` after `stop()` nulls it

**Files modified:** `usbee@bitcreed.us/src/dbus-client.js`
**Commit:** 7707e0f
**Applied fix:** Guarded the handler with `this._proxy &&` before
dereferencing the owner property, and switched the dereference to
camelCase `gNameOwner` for consistency with GJS conventions (this also
addresses IN-05 for the handler site). Paired with the CR-01 idempotency
guard, the duplicate-vanish-path risk is now defended at both ends.

## Skipped Issues

None — all findings in scope were fixed.

## Out-of-Scope Notes

Info-severity findings (IN-01, IN-03, IN-04, IN-05) were not in scope
for this run (`fix_scope: critical_warning`). IN-02 and IN-05 were
incidentally addressed where they overlapped with Warning fixes (in the
WR-02 and WR-03/WR-05 commits respectively); IN-01, IN-03, IN-04 remain
open for a future Info-scope iteration.

---

_Fixed: 2026-05-12_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
