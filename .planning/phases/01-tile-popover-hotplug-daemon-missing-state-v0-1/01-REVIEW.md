---
phase: 01-tile-popover-hotplug-daemon-missing-state-v0-1
reviewed: 2026-05-12T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - usbee@bitcreed.us/dbus-iface.xml
  - usbee@bitcreed.us/extension.js
  - usbee@bitcreed.us/metadata.json
  - usbee@bitcreed.us/schemas/org.gnome.usbee.gschema.xml
  - usbee@bitcreed.us/src/dbus-client.js
  - usbee@bitcreed.us/src/device-store.js
  - usbee@bitcreed.us/src/empty-state.js
  - usbee@bitcreed.us/src/popover.js
  - usbee@bitcreed.us/src/signal-registry.js
  - usbee@bitcreed.us/src/tile.js
  - usbee@bitcreed.us/stylesheet.css
findings:
  critical: 1
  warning: 5
  info: 5
  total: 11
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-12
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 01 lands a clean separation between the bus client, store, signal
registry, and tile. Lifecycle ownership in `extension.js` is correct, the
proxy is constructed asynchronously, and untrusted daemon strings are
rendered via `.text =` (not `set_markup`), neutralising the obvious
markup-injection vector.

That said, the review surfaces one BLOCKER and several WARNINGs that
should be addressed before this code is treated as stable:

1. **BLOCKER — duplicate vanish path emits redundant signals and risks
   double-disconnect.** `_onVanished()` is wired both as the
   `bus_watch_name` vanish callback *and* as the `notify::g-name-owner`
   handler. When the daemon disconnects, both fire, producing duplicate
   `'changed'` / `'lost'` emissions and (worse) duplicate
   `setDaemonRunning(false)` + `setDevices([])` mutations. This will
   manifest as visible double-repaint on the tile and, more critically,
   when combined with the timer registry leak (WR-01) makes the post-
   vanish state hard to reason about. Needs an idempotency guard.
2. **WARNING — timer registry leak emits `GLib-CRITICAL` on disable.**
   `_scheduleRefresh` appends a registry entry per timer but never
   removes entries for timers that have already fired naturally
   (returning `GLib.SOURCE_REMOVE`). On `disable()` the registry calls
   `GLib.Source.remove()` on each stale id, which GLib treats as a
   warning, not the "no-op" the inline comment claims.
3. **WARNING — i18n constraint in `CLAUDE.md` is violated everywhere.**
   No user-visible string passes through `gettext`. The project
   constraint is explicit: "every user-visible string must go through
   gettext" — this includes `'Starting…'`, `'USB devices'`, `'No USB
   devices attached'`, `'Daemon not running'`, the empty-state copy,
   and every `Charging:` / `Powering:` / `1 device` literal in
   `deriveSubtitle`. Also blocks future translation work.

Three additional WARNINGs cover style_class-on-PopupMenuItem
compatibility, the magic `2` for `Pango.WrapMode.WORD_CHAR`, and the
re-entrant `_onAppeared` path that no longer surfaces errors.

## Critical Issues

### CR-01: Duplicate vanish path — `_onVanished` runs twice on daemon disconnect

**File:** `usbee@bitcreed.us/src/dbus-client.js:138-142, 201-206`
**Issue:**
`_onVanished()` is registered in two places:

1. As the `name_vanished` callback of `Gio.bus_watch_name` (line 103).
2. Indirectly, via the `notify::g-name-owner` handler installed in
   `_onAppeared` (lines 138-142), which calls `this._onVanished()`
   whenever `g_name_owner === null`.

When the daemon goes away both fire (the bus watch fires the vanish
callback and the proxy notifies the property change). The current
implementation has no idempotency guard, so:

- `setDevices([])` is called twice → `'changed'` emits twice → toggle
  subtitle is re-read twice → popover/empty-state re-rebuild twice on
  next open.
- `'lost'` is emitted twice from `DBusClient`.
- `setDaemonRunning(false)` self-guards by identity, but every other
  side effect runs twice.

This is a correctness bug per the project's "drive UI from signals,
not polling" rule (CLAUDE.md "What NOT to Use"): consumers of the
`changed`/`lost` signals will get duplicate notifications and must
defensively dedupe.

**Fix:**
Guard `_onVanished` with the daemon flag (the `notify::g-name-owner`
path will then be a no-op when the bus watch has already vanished):

```js
_onVanished() {
    if (!this._store.daemonRunning) return; // already vanished
    this._store.setDaemonRunning(false);
    this._store.setDevices([]);
    this.emit('lost');
}
```

Or, alternatively, drop the `notify::g-name-owner` handler entirely
and rely solely on `bus_watch_name`. The two mechanisms cover the
same event; the second one was added for owner-transition handling
but `bus_watch_name` already fires vanish-then-appear on owner
churn.

## Warnings

### WR-01: Timer registry leak — every fired debounce emits `GLib-CRITICAL` on disable

**File:** `usbee@bitcreed.us/src/dbus-client.js:183-199`
**Issue:**
`_scheduleRefresh` appends a new entry to `SignalRegistry` for every
timer it schedules. When a timer fires naturally, the callback returns
`GLib.SOURCE_REMOVE` (line 195) and GLib auto-removes the source —
but the corresponding `SignalRegistry` entry is *not* removed. The
in-code comment (lines 187-189) claims "GLib treats this as a no-op
(returns false)", but that is incorrect: `GLib.Source.remove()` on
an unknown source id prints

```
GLib-CRITICAL **: Source ID <N> was not found when attempting to remove it
```

to stderr. Every USB hotplug burst that ran during the extension's
lifetime contributes one critical-level log on disable. Beyond the
noise:

- The registry array grows unboundedly for the whole extension
  lifetime (small but unbounded).
- The "previous timer in registry, new timer also in registry" pattern
  inside `_scheduleRefresh` means even when the *current* timer is
  cancelled (line 185), its registry entry still lives. Same problem
  in miniature.

**Fix:**
Have `SignalRegistry.addTimeout` return a dispose handle and let
`_scheduleRefresh` (a) drop the previous handle when cancelling, and
(b) drop the entry when the callback runs to completion:

```js
// signal-registry.js
addTimeout(sourceId) {
    if (this._disposed) throw new Error('...');
    const entry = {
        kind: 'timeout',
        dispose: () => GLib.Source.remove(sourceId),
    };
    this._entries.push(entry);
    return () => {                          // caller may eagerly drop
        const i = this._entries.indexOf(entry);
        if (i >= 0) this._entries.splice(i, 1);
    };
}

// dbus-client.js
_scheduleRefresh() {
    if (this._dropDebounce) {
        GLib.Source.remove(this._debounceId);
        this._dropDebounce();
        this._dropDebounce = null;
    }
    this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        this._dropDebounce?.();
        this._dropDebounce = null;
        this._debounceId = 0;
        this._snapshotImmediate();
        return GLib.SOURCE_REMOVE;
    });
    this._dropDebounce = this._registry.addTimeout(this._debounceId);
}
```

### WR-02: No user-visible string is wrapped in `gettext` — violates project i18n constraint

**File:** `usbee@bitcreed.us/src/tile.js:22-30`, `src/device-store.js:121-165`, `src/empty-state.js:26-43`, `src/popover.js:41`
**Issue:**
`CLAUDE.md` is explicit: *"every user-visible string must go through
gettext"*, and `metadata.json` already declares
`"gettext-domain": "usbee@bitcreed.us"`. Yet every user-facing
literal is hardcoded:

- `tile.js`: `'USBee'`, `'Starting…'`, `'USB devices'`.
- `device-store.js`: `'Daemon not running'`, `'Charging: ...'`,
  `'Powering: ... out'`, `'USB-C: charging'`, `'1 device'`,
  `'${n} devices'`, `'Nothing connected'`.
- `empty-state.js`: `'usbeehive daemon not running'`, `'Run this
  command, then this list will populate automatically:'`.
- `popover.js`: `'No USB devices attached'`.

The "Don't use string concatenation for user-visible strings" rule in
CLAUDE.md applies to the template-literal patterns in
`deriveSubtitle` too (`` `Charging: ${formatWatts(...)} in` ``).

**Fix:**
Import gettext from the extension module and switch to
`_('...').format(...)`:

```js
// tile.js
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
// ...
super({title: _('USBee'), subtitle: _('Starting…'), ...});
this.menu.setHeader('network-usb-symbolic', _('USB devices'), '');

// device-store.js — replace template literals with format()
if (top.direction === 'sink')
    return _('Charging: %s in').format(formatWatts(top.watts));
// ...
return n === 1 ? _('1 device') : _('%d devices').format(n);
```

Note that `device-store.js` does not currently import anything from
`extension.js`; that's the right reason to inject a `_` function via
constructor or pass strings up to `tile.js`, but the simplest fix is
to import the module-level `gettext` from `extension.js` directly
(it's a re-export and works at module load).

### WR-03: `_onAppeared` re-entrant branch silently calls `_snapshotImmediate` on a dead/changing proxy

**File:** `usbee@bitcreed.us/src/dbus-client.js:115-122`
**Issue:**
When `_onAppeared` fires a second time (proxy already constructed),
it calls `_snapshotImmediate()` without verifying that the proxy
actually has a current owner. In practice, `notify::g-name-owner`
runs *before* the bus-watch appeared callback in some orderings
(this is observable; both are queued on the main loop), so the
sequence on owner churn can be:

1. owner vanishes → `notify::g-name-owner` (null) → `_onVanished`.
2. owner reappears → bus_watch_name appeared → `_onAppeared`.
3. inside `_onAppeared`, `_snapshotImmediate` reads `this._proxy.g_name_owner`
   which may briefly be null again if the new owner has not propagated
   to the proxy yet — `ListDevicesRemote` then fails with
   `"GDBus.Error:org.freedesktop.DBus.Error.NameHasNoOwner"`, the
   error is logged once, and the tile is left in a stale state
   until the next signal.

This is not catastrophic because `setDevices([])` happened during
the vanish, so the tile reads "Nothing connected" — *not* the
correct empty-state body for the empty-popover path either.

**Fix:**
Defer the snapshot to the next main-loop tick using
`GLib.idle_add(GLib.PRIORITY_LOW, …)` (registered in the registry),
or check `this._proxy.g_name_owner !== null` before invoking
`_snapshotImmediate` in the re-entrant branch.

### WR-04: `PopupMenuItem` `style_class` and `reactive: false` constructor params are not part of the documented API

**File:** `usbee@bitcreed.us/src/empty-state.js:21-25`, `src/popover.js:40-43, 82-86`
**Issue:**
`PopupMenu.PopupMenuItem`'s constructor signature is
`new PopupMenuItem(text, params)`. While `reactive` and `can_focus`
flow through `PopupBaseMenuItem`, `style_class` is *not* in the
documented param list at
`https://gjs.guide/extensions/topics/popup-menu.html` and current
gnome-shell sources (`js/ui/popupMenu.js`) pass `params` to
`St.BoxLayout` only through specific keys. The current code
"happens to work" because `St.BoxLayout` accepts `style_class`, but
it relies on an implementation detail that has shifted between
46/47/48.

A safer pattern is `item.add_style_class_name('usbee-device-row')`
after construction. This also avoids a future EGO review flag.

**Fix:**

```js
const item = new PopupMenu.PopupMenuItem(headline, {
    reactive: false,
    can_focus: false,
});
item.add_style_class_name('usbee-device-row');
```

Same treatment in `empty-state.js` for `'usbee-empty-state'`.

### WR-05: `notify::g-name-owner` handler retains `this._proxy` after `stop()` nulls it

**File:** `usbee@bitcreed.us/src/dbus-client.js:138-142, 108-113`
**Issue:**
The arrow function reads `this._proxy.g_name_owner` (line 140). If a
`notify::g-name-owner` arrives between `extension.disable()` calling
`this._registry.dispose()` (which disconnects the handler) and
`this._client.stop()` (which nulls `_proxy`), nothing happens — fine.
But the *opposite* hazard exists if `stop()` is ever called before
`registry.dispose()` (e.g. future refactor, or a `_onVanished`-driven
teardown), the handler dereferences `this._proxy.g_name_owner` on
`null` and throws.

This is brittle. The handler should defend itself:

```js
const ownerId = this._proxy.connect('notify::g-name-owner', () => {
    if (this._proxy && this._proxy.g_name_owner === null)
        this._onVanished();
});
```

…or, paired with the CR-01 fix that makes `_onVanished` idempotent,
the entire `notify::g-name-owner` subscription becomes redundant
and can be removed (`bus_watch_name` covers the same event).

**Fix:**
Either guard with `this._proxy &&` or remove the
`notify::g-name-owner` subscription entirely (preferred — eliminates
the duplicate-vanish-path root cause from CR-01).

## Info

### IN-01: `Pango.WrapMode.WORD_CHAR` written as the literal `2`

**File:** `usbee@bitcreed.us/src/popover.js:100`
**Issue:**
`lbl.clutter_text.line_wrap_mode = 2;` with the comment
`// Pango.WrapMode.WORD_CHAR`. Magic number tied to a Pango ABI; if
that enum ever shifts (it has been stable, but still), the wrapping
silently changes mode.

**Fix:**
```js
import Pango from 'gi://Pango';
// ...
lbl.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
```

### IN-02: `'Starting…'` initial subtitle is dead code

**File:** `usbee@bitcreed.us/src/tile.js:22-23, 56`
**Issue:**
The constructor sets `subtitle: 'Starting…'` then immediately
overwrites it with `this.subtitle = store.subhead` (line 56), which
on first construction reads `'Daemon not running'`. The user never
sees `'Starting…'`. Either drop the literal or remove the
unconditional reassignment.

**Fix:**
Pass `store.subhead` as the initial subtitle and delete the
post-connect reassignment, or delete the `'Starting…'` literal.

### IN-03: Tuple signature documented as `a(sssssasi)` in comments but the actual signature is `a(ssssssasi)` (one extra `s`)

**File:** `usbee@bitcreed.us/src/device-store.js:14, 191`
**Issue:**
The XML (line 6 of both `dbus-iface.xml` and the inlined
`IFACE_XML`) declares `a(ssssssasi)` — six strings, then `as`, then
`i`. `unpackDeviceEntry` correctly reads 6 strings (`tuple[0..5]`),
the array (`tuple[6]`), and the int (`tuple[7]`). But the comment
on line 14 says `a(sssssasi)` (five `s`'s) and lists six labelled
fields, and line 191 repeats the wrong signature.

Code is correct; the comment is misleading. Anyone changing the
tuple later will read the wrong signature and miscount.

**Fix:**
Replace both comments with the correct `a(ssssssasi)`.

### IN-04: `Refresh` and `Diagnose` D-Bus methods are declared in `IFACE_XML` but never invoked

**File:** `usbee@bitcreed.us/src/dbus-client.js:43-51`, `dbus-iface.xml:11-20`
**Issue:**
Phase 01 never calls `RefreshRemote` or `DiagnoseRemote`. The XML
must match the daemon, so leaving these definitions in is correct,
but no code under review exercises them. A future phase plan should
either wire them in (e.g. a manual-refresh button, per-port
"Diagnose" affordance) or note explicitly that they remain in the
interface only for daemon compatibility.

**Fix:**
Add an explanatory comment on the `IFACE_XML` block noting that
`Refresh`/`Diagnose` are intentionally unused in Phase 01 and slated
for future phases — prevents a future reviewer from assuming dead
code can be deleted from the XML (it can't; the XML must match the
daemon-side interface).

### IN-05: `_proxy.g_name_owner` accessed via snake_case JS property — verify across GJS versions

**File:** `usbee@bitcreed.us/src/dbus-client.js:140`
**Issue:**
GJS auto-converts hyphenated GObject properties (`g-name-owner`) to
camelCase JS accessors (`gNameOwner`). Both forms generally work
because GJS keeps the GLib name accessible too, but the recommended
form is `this._proxy.gNameOwner`. Mixed case in the codebase
(`g_name_owner` here, `clutter_text` in `popover.js`/`empty-state.js`
which is correct because those are *function* names, not GObject
properties) is a style inconsistency.

**Fix:**
Read `this._proxy.gNameOwner` (camelCase) for consistency with GJS
conventions documented at `gjs.guide`.

---

_Reviewed: 2026-05-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
