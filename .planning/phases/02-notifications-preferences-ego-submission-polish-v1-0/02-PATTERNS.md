# Phase 2: Notifications, Preferences, EGO Submission Polish (v1.0) — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 13 (5 new, 7 modified, 1 new packaging template)
**Analogs found:** 11 / 13 (2 have no in-repo analog — `prefs.js`, `COPYING`; both have authoritative external anchors)

> Every "Copy from … (lines X-Y)" reference below points at an exact, paste-quality region of an existing Phase 1 file or `02-RESEARCH.md` code example. The planner threads these into `must_haves.artifacts` and `acceptance_criteria` of each Plan; the executor reads them as the canonical model to mirror.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `usbee@bitcreed.us/src/notifier.js` (**NEW**) | service / signal-driven module | event-driven (D-Bus signal in → MessageTray side-effect out) | `usbee@bitcreed.us/src/dbus-client.js` | role-match (singleton signal consumer; both own a Map/cache + lifecycle disposal) |
| `usbee@bitcreed.us/prefs.js` (**NEW**) | controller / preferences entry-point | request-response (GSettings ⇄ Adwaita widgets) | `/usr/share/gnome-shell/extensions/auto-move-windows@gnome-shell-extensions.gcampax.github.com/prefs.js` (system-vetted reference; **out-of-tree**) + `02-RESEARCH.md` Code Example #9 | external-reference (no in-repo analog — D-17 reserves Gtk/Adw to `prefs.js` alone) |
| `usbee@bitcreed.us/COPYING` (**NEW**) | license text | n/a (static blob) | none | no-analog (verbatim GPL-3.0 text — single authoritative source: <https://www.gnu.org/licenses/gpl-3.0.txt>) |
| `usbee@bitcreed.us/README.md` (**NEW**) | documentation | n/a (static markdown) | none | external-anchor (structure pinned by `02-UI-SPEC.md` §Packaging Copy) |
| `usbee@bitcreed.us/po/usbee@bitcreed.us.pot` (**NEW**) | gettext template | batch (toolchain artifact) | none | toolchain-generated (`xgettext` invocation — not hand-written) |
| `usbee@bitcreed.us/schemas/org.gnome.usbee.gschema.xml` (**MODIFY**) | config / schema declaration | n/a (XML, build-time → dconf runtime) | the file itself (Phase 1 empty scaffold at lines 1-9) | extend-in-place (scaffold already exists; Phase 2 populates two keys) |
| `usbee@bitcreed.us/src/dbus-client.js` (**MODIFY**) | service / D-Bus client | event-driven | itself (lines 164-177 — the existing `DeviceAdded`/`DeviceRemoved` subscription block is the literal template for the new `CapabilityDegraded`/`CapabilityRestored` block) | exact (same file, same idiom) |
| `usbee@bitcreed.us/src/tile.js` (**MODIFY**) | component / Quick Settings tile | event-driven | itself (lines 30-52 — existing `setHeader` + `addMenuItem` + `registry.addSignal` pattern; lines 58-62 — the Phase-2 seam comment already documents where Preferences row goes) | exact (same file; Phase 1 left an explicit comment-marked seam) |
| `usbee@bitcreed.us/src/popover.js` (**MODIFY**) | render-function module | pure transform (store → menu items) | itself (lines 39-51 — existing `populateDeviceRows` signature is the patch target; one parameter added, one filter inserted) | exact (same file) |
| `usbee@bitcreed.us/extension.js` (**MODIFY**) | lifecycle owner | startup/shutdown | itself (lines 18-32 enable + 34-57 disable — the existing construction-order block is the literal template; Notifier insertion is one line each in enable / disable) | exact (same file) |
| `usbee@bitcreed.us/metadata.json` (**MODIFY**) | config / EGO manifest | n/a (JSON, build-time) | itself (lines 1-9 — current file) | extend-in-place (add `version-name`; everything else already correct) |
| `usbee@bitcreed.us/icons/` (no change) | n/a | n/a | n/a | n/a (Phase 2 adds zero icon files — all four icons used are system-provided symbolic icons) |
| `usbee@bitcreed.us/stylesheet.css` (no change) | n/a | n/a | n/a | n/a (UI-SPEC §Spacing: Phase 2 adds **zero** CSS rules — libadwaita and MessageTray own all styling) |

---

## Pattern Assignments

### `usbee@bitcreed.us/src/notifier.js` (NEW — service, event-driven)

**Primary analog:** `src/dbus-client.js` — both files are singleton signal consumers with their own private state, a `dispose()`-equivalent path, and a `registry`-tracked subscription model. **Reference skeleton:** `02-RESEARCH.md` Code Example #1 (lines 552-704) is paste-quality and already paths-its-imports correctly.

#### Imports pattern (mirror of `src/dbus-client.js:15-17`)

```javascript
// src/dbus-client.js:15-17 — the exact import shape Phase 2 mirrors:
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
```

For `src/notifier.js`, swap `GObject` (not needed — Notifier is a plain class, not a GObject subclass) for the Shell-process notification modules. Add the gettext import:

```javascript
// Target imports for src/notifier.js (composed from RESEARCH §Code Example #1):
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
```

**Why this exact set:** `gettext as _` from the `extension.js` resource path is the same import already used at `src/tile.js:15`, `src/popover.js:15`, `src/empty-state.js:14`, and `src/device-store.js:13` — the project's established gettext idiom for Shell-process code.

#### Lifecycle pattern (mirror of `src/dbus-client.js:88-100, 117-122`)

The constructor stores `_registry`, `_store`, and lazy-null fields; a `stop()` / `dispose()` symmetric method exists for `extension.disable()` to call. Copy this shape:

```javascript
// src/dbus-client.js:88-100 — constructor template:
constructor(registry, store) {
    super();
    this._registry = registry;
    this._store = store;
    this._proxy = null;
    this._debounceId = 0;
    this._dropDebounce = null;
}
```

```javascript
// src/dbus-client.js:117-122 — symmetric stop() / null-out template:
stop() {
    // No-op: SignalRegistry.dispose() (called from extension.disable())
    // handles the bus_watch_name, all proxy signal connections, and the
    // notify::g-name-owner handler. This method exists for symmetry.
    this._proxy = null;
}
```

**Apply to Notifier:** constructor stores `_settings`, `_registry`, `_extension`, `_notifications = new Map()`, `_source = null`, `_suppressUntil = 0`. `dispose()` calls `onDaemonVanished()` then `this._source?.destroy()` (RESEARCH Example #1, lines 693-702).

#### Error-handling pattern (mirror of `src/dbus-client.js:142-148, 245-249`)

Phase 1 established **one** logError call per failed op, no retry loops:

```javascript
// src/dbus-client.js:142-148 — proxy construction error path:
if (error) {
    // Per PITFALLS §6: one logError, then the empty state
    // remains. name-vanished/appeared will retry naturally.
    logError(error, 'USBee: proxy construction failed');
    return;
}
```

```javascript
// src/dbus-client.js:245-249 — async catch with explicit recovery comment:
} catch (e) {
    // Per PITFALLS §7 — catch only because we have a recovery strategy:
    // keep prior store state, log once, let next signal retry.
    logError(e, 'USBee: ListDevices failed');
}
```

**Apply to Notifier:** any `try { n.destroy(...) }` in `onDaemonVanished()` (RESEARCH Example #1 lines 598-602) uses the identical `logError(e, 'USBee: ...')` form — no silent swallow, no retry loop. The try/catch is **only** there because the notification may already be destroyed when daemon vanish coincides with user dismissal.

#### Core pattern — destroy-signal-based map cleanup (RESEARCH §Pitfall C, lines 466-477)

This is the load-bearing safety pattern and has **no Phase 1 analog** (Phase 1 has no equivalent self-cleaning Map). Copy verbatim:

```javascript
// RESEARCH §Pitfall C — identity-checked cleanup pattern (mandatory):
notification.connect('destroy', (_n, _reason) => {
    if (this._notifications.get(portNumber) === notification)
        this._notifications.delete(portNumber);
});
```

**Why `=== notification`:** when a stale destroy fires AFTER a new notification for the same port has already replaced the entry, the identity check prevents the new entry being wiped.

#### Coalescing pattern — `.update()` on existing instance (RESEARCH §Code Example #2)

The GNOME-46-specific replacement for legacy XDG `replaces_id`:

```javascript
// RESEARCH Example #1 lines 644-650 + Example #2:
const existing = this._notifications.get(portNumber);
if (existing) {
    existing.update(title, body, {clear: true});  // {clear:true} removes prior actions
    this._addActions(existing, portNumber);        // re-add the same two actions
    return;
}
```

The `{clear: true}` parameter is non-obvious and is the specific item flagged as `[ASSUMED-A1]` in RESEARCH §Assumptions Log — the executor must smoke-test it via `busctl --user emit … CapabilityDegraded` and verify exactly one banner with non-duplicated action buttons.

---

### `usbee@bitcreed.us/prefs.js` (NEW — controller / preferences entry-point, request-response)

**No in-repo analog exists** — D-17 explicitly forbids `gi://Gtk` and `gi://Adw` imports in any other USBee file. Phase 2's `prefs.js` is the **first and only** file in the repository carrying these imports.

**Authoritative external analog:** `/usr/share/gnome-shell/extensions/auto-move-windows@gnome-shell-extensions.gcampax.github.com/prefs.js` (system-installed reference; lines 9-15 for imports, lines 349-353 for the entry-point class).

**Paste-quality reference:** `02-RESEARCH.md` Example #9 (lines 888-1002) is the literal skeleton — every Phase-2-specific binding (`port-mutes` rebuild, `hide-empty-ports` switch, About group) is already wired with the correct constructor property bags.

#### Imports pattern (from auto-move-windows/prefs.js:9-15)

```javascript
// /usr/share/gnome-shell/extensions/auto-move-windows@…/prefs.js:9-15:
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
```

**Critical case note:** the prefs gettext import path is `…/Shell/Extensions/js/extensions/prefs.js` (capital `S` in `Shell`, capital `E` in `Extensions`) — **different** from the Shell-process path `…/shell/extensions/extension.js` (lowercase). Easy to typo. Phase 2 USBee uses **`gi://Adw?version=1` and `gi://Gtk?version=4.0`** (explicit versions per `02-RESEARCH.md` §Standard Stack line 189-190) — auto-move-windows omits versions, but USBee's CLAUDE.md C-03 pins libadwaita 1.5+ and GTK 4.14+, so explicit versions are the correct discipline.

#### Entry-point pattern (from auto-move-windows/prefs.js:349-353)

```javascript
// /usr/share/gnome-shell/extensions/auto-move-windows@…/prefs.js:349-353:
export default class AutoMovePrefs extends ExtensionPreferences {
    getPreferencesWidget() {
        return new AutoMoveSettingsWidget(this.getSettings());
    }
}
```

**Deviation:** USBee uses the **modern** `fillPreferencesWindow(window)` hook (RESEARCH §State of the Art table — `buildPrefsWidget` is deprecated; `getPreferencesWidget` is the same-era legacy form). Auto-move-windows is on the legacy form; USBee mirrors RESEARCH Example #9 instead. Reference auto-move-windows only for the import block and the destructive-button + dynamic-row patterns (lines 285-292, 165-181).

#### Dynamic-row tracking pattern (Pitfall J — RESEARCH lines 533-537)

Auto-move-windows uses `Gtk.ListBox.bind_model(listModel, item => …)` (lines 176-180) — a heavier Gio.ListModel approach. RESEARCH explicitly recommends the simpler **track-and-remove** pattern for USBee's smaller list:

```javascript
// RESEARCH Example #9 lines 922-937 — Phase 2 track-and-remove pattern:
const mutedRows = [];
const rebuildMutedRows = () => {
    for (const row of mutedRows) notifGroup.remove(row);
    mutedRows.length = 0;
    // ... populate from settings.get_strv('port-mutes') ...
};
rebuildMutedRows();
const mutesChangedId = settings.connect('changed::port-mutes', rebuildMutedRows);
window.connect('close-request', () => {
    settings.disconnect(mutesChangedId);
    return false;
});
```

**Why not bind_model:** GSettings `as` arrays are small (≤ N USB-C ports per host; typically ≤ 4). The ListModel ceremony costs more lines than it saves. Track-and-remove is also closer to the Phase-1 `section.removeAll()` idiom (`src/popover.js:40`).

#### Destructive trash-button pattern (cherry-picked from auto-move-windows/prefs.js:285-292)

```javascript
// /usr/share/gnome-shell/extensions/auto-move-windows@…/prefs.js:285-292:
const button = new Gtk.Button({
    action_name: 'rules.remove',
    action_target: new GLib.Variant('s', id),
    icon_name: 'edit-delete-symbolic',
    has_frame: false,
    valign: Gtk.Align.CENTER,
});
this.add_suffix(button);
```

**USBee deviation:** Phase 2 uses **direct `connect('clicked', ...)`** (RESEARCH Example #9 lines 945-955) instead of the `install_action` / `action_name` flow — simpler, fewer moving parts for a one-row-one-action case. The `css_classes: ['flat', 'destructive-action']` set comes from UI-SPEC §Color (destructive role introduced for this button only) and is **not** in auto-move-windows; libadwaita-style-classes ref pinned in RESEARCH §Sources.

```javascript
// Target Phase 2 shape (RESEARCH Example #9 lines 945-955):
const button = new Gtk.Button({
    icon_name: 'user-trash-symbolic',
    tooltip_text: _('Unmute this port'),
    valign: Gtk.Align.CENTER,
    css_classes: ['flat', 'destructive-action'],
});
button.connect('clicked', () => {
    const current = settings.get_strv('port-mutes');
    settings.set_strv('port-mutes', current.filter(x => x !== id));
});
row.add_suffix(button);
```

#### GSettings.bind pattern (RESEARCH §Don't Hand-Roll row 3 + Example #9 line 982)

```javascript
// RESEARCH Example #9 line 982-983 — the canonical one-liner:
settings.bind('hide-empty-ports', hideRow, 'active', Gio.SettingsBindFlags.DEFAULT);
```

**No in-repo analog** — Phase 1 has no GSettings reads or writes; Phase 2 introduces the first ones. The auto-move-windows file uses `set_strv` / `get_strv` heavily (lines 113-114, 122) but does not use `.bind()` (workspace numbers there are not bool toggles). The one-line `.bind` is the documented `Gio.Settings.bind` API.

---

### `usbee@bitcreed.us/schemas/org.gnome.usbee.gschema.xml` (MODIFY — config, build-time)

**Analog:** the file itself (Phase 1 empty scaffold at lines 1-9). The scaffold already declares the schema id and gettext-domain — Phase 2 inserts two `<key>` elements between the existing `<schema>` open and close tags.

**Existing content** (`schemas/org.gnome.usbee.gschema.xml:1-9`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist gettext-domain="usbee@bitcreed.us">
  <schema id="org.gnome.usbee" path="/org/gnome/usbee/">
    <!-- Phase 2 (PREFS-02, PREFS-03) populates this schema with:
           <key name="port-mutes" type="as"> ...
           <key name="hide-empty-ports" type="b"> ...
         For Phase 1, the empty schema makes `dconf-editor` show `org.gnome.usbee`. -->
  </schema>
</schemalist>
```

**Target shape** (verbatim from `02-RESEARCH.md` Example #5, lines 745-776):

```xml
<key name="port-mutes" type="as">
  <default>[]</default>
  <summary>Muted USB-C ports</summary>
  <description>
    Stringified USB-C port numbers (the daemon's "port_number" int32
    cast to a string) that should not raise CapabilityDegraded
    notifications. Written by the "Don't notify for this port again"
    notification action and by the per-row trash button in the
    preferences window. Read live on every CapabilityDegraded event
    by src/notifier.js.
  </description>
</key>

<key name="hide-empty-ports" type="b">
  <default>false</default>
  <summary>Hide empty USB-C ports from the popover</summary>
  <description>
    When true, USB-C port rows whose status is "Empty" are not
    rendered in the tile popover. Toggled from the "Hide empty
    USB-C ports" switch in the preferences window. Read once per
    popover rebuild by src/popover.js populateDeviceRows.
  </description>
</key>
```

**Build-loop discipline (RESEARCH §Pitfall E, lines 491-499):** during dev with a symlinked extension dir, run `glib-compile-schemas schemas/` after every edit; `gnome-extensions install --force` auto-compiles for production.

---

### `usbee@bitcreed.us/src/dbus-client.js` (MODIFY — service, event-driven)

**Analog:** itself. Lines 164-177 are the **literal template** for the Phase-2 patch — the existing `DeviceAdded`/`DeviceRemoved` block is structurally identical to what `CapabilityDegraded`/`CapabilityRestored` needs.

#### Existing pattern to mirror (lines 164-177)

```javascript
// src/dbus-client.js:164-177 — the template Phase 2 mirrors:
// D-06: subscribe to DeviceAdded / DeviceRemoved for the
// whole extension lifetime. We deliberately do NOT subscribe
// to CapabilityDegraded / CapabilityRestored — those are
// Phase 2 NOTIF-* work (RESEARCH.md §Pitfall F).
// Use proxy.connectSignal (NOT .connect) — these are D-Bus
// signals, not GObject property notifies (RESEARCH §Pitfall E).
const addedId = this._proxy.connectSignal('DeviceAdded',
    () => this._scheduleRefresh());
this._registry.addProxySignal(this._proxy, addedId);

const removedId = this._proxy.connectSignal('DeviceRemoved',
    () => this._scheduleRefresh());
this._registry.addProxySignal(this._proxy, removedId);
```

#### Target pattern (RESEARCH §Code Example #6, lines 786-806)

Append immediately after the existing block (still inside the `new UsbeehiveProxy(…)` callback), using the destructured-payload form so payloads aren't re-extracted in the Notifier:

```javascript
const degradedId = this._proxy.connectSignal('CapabilityDegraded',
    (_proxy, _sender, [portNumber, summary, detail]) => {
        this._notifier?.onCapabilityDegraded(portNumber, summary, detail);
    });
this._registry.addProxySignal(this._proxy, degradedId);

const restoredId = this._proxy.connectSignal('CapabilityRestored',
    (_proxy, _sender, [portNumber]) => {
        this._notifier?.onCapabilityRestored(portNumber);
    });
this._registry.addProxySignal(this._proxy, restoredId);
```

**Suppression-window hook locations** (RESEARCH Example #3 + Example #6 lines 801-805):

- In `_onAppeared`, **after** `this._store.setDaemonRunning(true)` (current line 178) and before `this._snapshotImmediate()` (line 179): insert `this._notifier?.onDaemonAppeared();`
- In `_onVanished`, **after** `this._store.setDevices([])` (current line 227): insert `this._notifier?.onDaemonVanished();`

#### Constructor patch (RESEARCH Example #6, lines 808-816)

Existing constructor signature (`src/dbus-client.js:88`): `constructor(registry, store)`. Phase 2 adds an optional `notifier` param:

```javascript
constructor(registry, store, notifier) {
    super();
    this._registry = registry;
    this._store = store;
    this._notifier = notifier; // may be null in unit tests
    this._proxy = null;
    this._debounceId = 0;
    this._dropDebounce = null;
}
```

The optional-chaining `this._notifier?.…` calls (above) tolerate a null notifier — keeps the unit-test path live.

#### IFACE_XML is already correct (NO patch needed)

`src/dbus-client.js:68-75` already declares the `CapabilityDegraded` and `CapabilityRestored` signals (the Phase-1 commit pulled the full daemon XML even though signal handlers were intentionally unused — see `src/dbus-client.js:25-38` comment). **No XML edits.** The signals are already in `makeProxyWrapper`'s output; `connectSignal` works immediately.

---

### `usbee@bitcreed.us/src/tile.js` (MODIFY — component, event-driven)

**Analog:** itself. Phase 1 left an explicit Phase-2 seam at lines 58-62:

```javascript
// src/tile.js:58-62 — the seam Phase 2 fills:
// Phase 2 seam: a "Preferences" / "Open Settings" menu item belongs
// BELOW this._rowsSection here, gated by STATE-04. Phase 1 leaves
// the seam empty by design (UI-SPEC #component-inventory note).
```

#### Existing pattern — addMenuItem + registry.addSignal (lines 34-52)

```javascript
// src/tile.js:34-52 — pattern Phase 2 mirrors for the Preferences row:
// Lazy-populated device list section (D-11; Pattern 2).
this._rowsSection = new PopupMenu.PopupMenuSection();
this.menu.addMenuItem(this._rowsSection);

// Bind subtitle to the store. ...
const changedId = store.connect('changed', () => {
    this.subtitle = store.subhead;
});
registry.addSignal(store, changedId);

// Lazy popover rebuild on open (D-11). Tracked via SignalRegistry.
const openId = this.menu.connect(
    'open-state-changed', (_menu, open) => {
        if (open) this._rebuildPopover();
    });
registry.addSignal(this.menu, openId);
```

**Apply to Phase 2:** every new connect-or-addMenuItem in `src/tile.js` follows the exact same `const id = X.connect(...); registry.addSignal(X, id);` pattern. The new `Main.sessionMode.connect('updated', …)` site is the highest-risk Pitfall (H) and MUST register with `registry.addSignal(Main.sessionMode, smId)` — RESEARCH Example #8 line 883.

#### Target pattern (RESEARCH §Code Example #8, lines 855-884)

```javascript
this._extension = extension; // new constructor param — added in same patch

const buildPrefsRow = () => {
    if (!Main.sessionMode.allowSettings) return;
    this._prefsSeparator = new PopupMenu.PopupSeparatorMenuItem();
    this._prefsItem = new PopupMenu.PopupMenuItem(_('Preferences…')); // U+2026
    this._prefsItem.connect('activate', () => this._extension.openPreferences());
    this.menu.addMenuItem(this._prefsSeparator);
    this.menu.addMenuItem(this._prefsItem);
};

const destroyPrefsRow = () => {
    if (this._prefsItem)      { this._prefsItem.destroy();      this._prefsItem = null; }
    if (this._prefsSeparator) { this._prefsSeparator.destroy(); this._prefsSeparator = null; }
};

buildPrefsRow();

const smId = Main.sessionMode.connect('updated', () => {
    if (Main.sessionMode.allowSettings) {
        if (!this._prefsItem) buildPrefsRow();
    } else {
        destroyPrefsRow();
    }
});
registry.addSignal(Main.sessionMode, smId); // §Pitfall H
```

#### Import additions

Existing imports at `src/tile.js:11-17` already include `PopupMenu` and `gettext`. Phase 2 adds **one** new import:

```javascript
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
```

Already imported in `extension.js:10` — same path. Easy to copy. The `_('Preferences…')` literal uses **U+2026 horizontal ellipsis** as a single character per UI-SPEC §Copywriting line 298-300 (GNOME HIG rule for menu items that open a window).

#### Constructor signature change

`USBeeToggle` constructor at line 21 currently takes `(store, registry)`. Phase 2 changes it to `(store, registry, extension)` so the `Preferences…` activation handler can call `extension.openPreferences()`. The `USBeeIndicator` constructor (line 74) likewise gains the `extension` param and forwards it. `extension.js` enable() (line 25) passes `this` as the third arg.

---

### `usbee@bitcreed.us/src/popover.js` (MODIFY — render module, pure transform)

**Analog:** itself. Lines 39-51 (`populateDeviceRows`) are the patch target.

#### Existing pattern (lines 39-51)

```javascript
// src/popover.js:39-51 — current signature + body:
export function populateDeviceRows(section, store) {
    section.removeAll();
    if (store.devices.length === 0) {
        section.addMenuItem(new PopupMenu.PopupMenuItem(
            _('No USB devices attached'),
            {reactive: false, can_focus: false},
        ));
        return;
    }
    for (const device of store.devices) {
        section.addMenuItem(buildDeviceRow(device));
    }
}
```

#### Target pattern (RESEARCH §Code Example #10, lines 1010-1030)

Add an `extension` parameter; read GSettings once at the top; insert the filter before the device loop:

```javascript
export function populateDeviceRows(section, store, extension) {
    section.removeAll();

    const hideEmpty = extension.getSettings().get_boolean('hide-empty-ports');
    let devices = store.devices;
    if (hideEmpty) {
        devices = devices.filter(d =>
            !(d.category === 'TypeCPort' && d.status === 'Empty'));
    }

    if (devices.length === 0) {
        section.addMenuItem(new PopupMenu.PopupMenuItem(
            _('No USB devices attached'),
            {reactive: false, can_focus: false},
        ));
        return;
    }
    for (const device of devices) {
        section.addMenuItem(buildDeviceRow(device));
    }
}
```

**Threading point in `src/tile.js`:** the call site is currently `populateDeviceRows(this._rowsSection, this._store)` at line 68. Phase 2 patches this to `populateDeviceRows(this._rowsSection, this._store, this._extension)`.

**Empty / Status detection:** `'TypeCPort'` and `'Empty'` are the daemon-emitted strings already consumed by `src/device-store.js:124-125` (Tier 1 filter) — the same predicate is reused here. Direct grep for the literals in `src/device-store.js` confirms they are the canonical category/status tokens for Phase 2 to filter against.

---

### `usbee@bitcreed.us/extension.js` (MODIFY — lifecycle owner)

**Analog:** itself. Lines 18-32 (enable) and 34-57 (disable) are the literal template.

#### Existing pattern (lines 18-32)

```javascript
// extension.js:18-32 — the construction-order block:
enable() {
    // Construction order matters — RESEARCH §Pitfall D.
    this._registry  = new SignalRegistry();
    this._store     = new DeviceStore();
    this._indicator = new USBeeIndicator(this._store, this._registry);
    this._client    = new DBusClient(this._registry, this._store);

    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    this._client.start();
}
```

#### Target pattern (RESEARCH §Code Example #7, lines 821-848)

Insert `this._notifier` between `_indicator` and `_client` (the Notifier is constructed before DBusClient so DBusClient's constructor can receive it):

```javascript
enable() {
    this._registry  = new SignalRegistry();
    this._store     = new DeviceStore();
    this._indicator = new USBeeIndicator(this._store, this._registry, this); // +extension
    this._notifier  = new Notifier(this.getSettings(), this._registry, this); // NEW
    this._client    = new DBusClient(this._registry, this._store, this._notifier); // +notifier

    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    this._client.start();
}
```

#### Existing disable() pattern (lines 34-57) and target patch

The disable path already nulls `_registry`, `_client`, `_indicator`, `_store` in that order. Phase 2 inserts `_notifier` disposal between `_client.stop()` and `_indicator` destruction (RESEARCH Example #7 line 840):

```javascript
if (this._notifier) { this._notifier.dispose(); this._notifier = null; }
```

Order rationale: `_client.stop()` first so no more signals arrive at the notifier; then `_notifier.dispose()` clears live notifications cleanly; then `_indicator` teardown. The `SignalRegistry.dispose()` already at the top of `disable()` (line 39) has by this point disconnected the proxy signal handlers feeding the notifier, so the order is belt-and-suspenders.

#### Import addition

Add to the existing import block (`extension.js:9-15`):

```javascript
import {Notifier} from './src/notifier.js';
```

---

### `usbee@bitcreed.us/metadata.json` (MODIFY — config / EGO manifest)

**Analog:** itself (`metadata.json:1-9`). Already correct in 7 of 8 fields; Phase 2 adds **one** optional field.

#### Existing content (verbatim — lines 1-9)

```json
{
  "uuid": "usbee@bitcreed.us",
  "name": "USBee",
  "description": "Glanceable USB and USB-C capability + charging info, powered by usbeehive.\n\n...",
  "shell-version": ["46", "47", "48"],
  "url": "https://github.com/abrauchli/usbee",
  "gettext-domain": "usbee@bitcreed.us",
  "settings-schema": "org.gnome.usbee"
}
```

#### Target patch (RESEARCH §metadata.json — required Phase 2 edits, lines 251-258)

Insert `"version-name": "1.0.0"` after `"settings-schema"`. **Do NOT add** the integer `"version"` field — EGO sets it on upload; manual writes are flagged in the audit gates (RESEARCH §EGO submission audit row 8).

**Do NOT add:** `license` / `license-version` (not metadata.json fields — license lives in `COPYING`), `donations` (no valid entries), `session-modes` (would fight STATE-04).

---

### `usbee@bitcreed.us/README.md` (NEW — documentation)

**No in-repo analog.** Structure pinned verbatim by **02-UI-SPEC.md §Copywriting Contract** lines 350-362 — the planner must copy that section as the README contents (or compose to the same headings and copy).

**Anchor:** the `systemctl --user enable --now usbeehive` line MUST match `src/empty-state.js:16` (`SYSTEMCTL_CMD` constant) **character-for-character**. This is a triple-locked invariant — same string in README, prefs About row, and popover empty state (UI-SPEC §Continuity with Phase 1 line 514-515).

---

### `usbee@bitcreed.us/COPYING` (NEW — license text)

**No analog. Single authoritative source:** <https://www.gnu.org/licenses/gpl-3.0.txt> — verbatim, no header, no footer, no modifications. Filename is uppercase `COPYING` (no extension) per GNU + GNOME convention (RESEARCH §Packaging — COPYING file, lines 1157-1159).

**Location:** inside `usbee@bitcreed.us/` directory (NOT repository root) — keeps the zip self-contained and lets the `gnome-extensions pack --extra-source=COPYING` invocation use a relative path without `../` traversal.

---

### `usbee@bitcreed.us/po/usbee@bitcreed.us.pot` (NEW — gettext template)

**Not hand-written.** Generated by the `xgettext` command pinned in RESEARCH §gettext / `.pot` generation, lines 1206-1212:

```bash
xgettext --from-code=UTF-8 \
    --output=po/usbee@bitcreed.us.pot \
    usbee@bitcreed.us/extension.js \
    usbee@bitcreed.us/prefs.js \
    usbee@bitcreed.us/src/*.js
```

**Anchor (Pitfall I, RESEARCH lines 522-530):** every user-visible string in `.js` source MUST be wrapped in `_(STATIC_STRING).format(...)` — **no template literals** as the argument to `_()`, or xgettext silently skips the string. Audit gate at RESEARCH §EGO submission row 4 (≥ 14 entries matching UI-SPEC §Copywriting).

---

## Shared Patterns

### SignalRegistry discipline (applies to: `src/notifier.js`, `src/dbus-client.js` patch, `src/tile.js` patch)

**Source:** `src/signal-registry.js` (whole file, lines 16-108).

**Every** new `connect` / `connectSignal` / `bus_watch_name` / `timeout_add` call site MUST register a dispose-fn via `_registry.addSignal(...)` / `addProxySignal(...)` / `addTimeout(...)`. This is CONTEXT.md D-14 (Phase 1) and RESEARCH §Pitfall H (Phase 2 reinforcement specifically for `Main.sessionMode`, which is a Shell singleton that survives `disable()`/`enable()` cycles).

```javascript
// src/dbus-client.js:153-162 — the canonical idiom:
const ownerId = this._proxy.connect(
    'notify::g-name-owner', () => { ... });
this._registry.addSignal(this._proxy, ownerId);
```

**Phase 2 sites requiring SignalRegistry registration:**

1. `src/dbus-client.js` — two new `connectSignal('CapabilityDegraded'/'CapabilityRestored')` calls (already covered in Plan analog above).
2. `src/tile.js` — one new `Main.sessionMode.connect('updated', …)` call. **Highest-risk omission** (Pitfall H).
3. `src/notifier.js` — `MessageTray.Source` lifetime is managed by its own `'destroy'` signal handler (RESEARCH §Pitfall B), so no registry entry strictly required for the source; but `notification.connect('destroy', ...)` per-notification handlers are self-disposing too. Net: no new registry entries in Notifier; the disposal happens through `Notifier.dispose()` calling `n.destroy()` on every map entry.
4. `prefs.js` — runs in a different process; manages its own lifecycle via `window.connect('close-request', () => settings.disconnect(mutesChangedId))` (RESEARCH Example #9 lines 967-971). **Does NOT use SignalRegistry** (the registry is a Shell-process construct).

### Verbatim daemon strings (applies to: `src/notifier.js`)

**Source:** `src/popover.js:25-30` comment block + `src/popover.js:101` (`new St.Label({text: bullet, …})`).

> Per UI-SPEC #copywriting + RESEARCH §Threat T-01-02 / T-02-01, all daemon strings are rendered verbatim via `.text = …` — never via markup APIs (untrusted data from session D-Bus).

Phase 2 reinforcement: the notification `body` is set from the daemon's `detail` string **verbatim** (`02-UI-SPEC.md` §Copywriting line 250). USBee MUST NOT call `notification.set_use_markup(true)` anywhere. The `MessageTray.Notification` constructor's `body` field is plain-text by default (RESEARCH §Security Domain V5 row).

### Async-only D-Bus discipline (applies to all new code)

**Source:** `src/dbus-client.js:231-250` — the canonical async pattern:

```javascript
// src/dbus-client.js:236-244 — paste-quality callback-wrapped-as-Promise:
const [entries] = await new Promise((resolve, reject) => {
    this._proxy.ListDevicesRemote((result, error) => {
        if (error) reject(error);
        else resolve(result);
    });
});
```

**Phase 2 does NOT add any new D-Bus method calls** (Notifier only consumes signals; prefs.js never touches D-Bus). The discipline is inherited but no new code applies it. EGO audit gate 6 (`grep -E '\.call_sync\b|new_for_bus_sync'` returns empty) is automatic for Phase 2.

### SPDX header (applies to: every new `.js` file in Phase 2 + retrofitted to every Phase 1 `.js` file)

**Source:** `02-UI-SPEC.md` §Copywriting line 366-368 + RESEARCH §SPDX headers lines 1196-1202.

Every `.js` file gains line 1 (or line 1 after a shebang — no .js in this repo has a shebang):

```javascript
// SPDX-License-Identifier: GPL-3.0-or-later
```

**Phase 1 files to retrofit:** `extension.js`, `src/dbus-client.js`, `src/device-store.js`, `src/empty-state.js`, `src/popover.js`, `src/signal-registry.js`, `src/tile.js`. All seven currently lack the header (verified by reading each — `extension.js:1` starts with `// extension.js`, no SPDX). The planner should include this retrofit in the appropriate plan's `files_modified` list.

**Audit gate** (RESEARCH §EGO audit row 3): `grep -L 'SPDX-License-Identifier' usbee@bitcreed.us/**/*.js` must return empty after Phase 2.

### `_(…).format(…)` for user-visible strings (applies to: `src/notifier.js`, `prefs.js`)

**Source:** `src/device-store.js:137-139, 162-163` — the canonical Phase-1 usage:

```javascript
// src/device-store.js:137-139:
if (top.direction === 'sink')
    return _('Charging: %s in').format(formatWatts(top.watts));
if (top.direction === 'source')
    return _('Powering: %s out').format(formatWatts(top.watts));
```

```javascript
// src/device-store.js:162-163:
return attached.length === 1
    ? _('1 device')
    : _('%d devices').format(attached.length);
```

**Phase 2 sites:** notification title `_('USB-C Port %d — %s').format(portNumber, summary)`, muted-port row title `_('USB-C Port %d').format(portNumber)`, About version row `_('Version')` + plain (untranslated) version-string subtitle (the version number itself isn't translated — comment-noted in `02-UI-SPEC.md` §Copywriting line 290).

**Never:** `_(\`USB-C Port ${portNumber}\`)` (Pitfall I — xgettext silently skips template literals).

---

## No Analog Found

| File | Role | Data Flow | Reason | Anchor instead |
|------|------|-----------|--------|----------------|
| `usbee@bitcreed.us/prefs.js` | controller / preferences | request-response (Adwaita widgets ⇄ GSettings) | D-17 reserves `gi://Gtk` and `gi://Adw` to this file alone — there is no in-repo file to copy from | `/usr/share/gnome-shell/extensions/auto-move-windows@gnome-shell-extensions.gcampax.github.com/prefs.js` (system-installed reference, vetted) + `02-RESEARCH.md` Example #9 lines 888-1002 (paste-quality skeleton) |
| `usbee@bitcreed.us/COPYING` | static license blob | n/a | first license file in repo; verbatim text from external source | <https://www.gnu.org/licenses/gpl-3.0.txt> (verbatim — no modifications, see RESEARCH §Packaging — COPYING file) |

Both files have **authoritative external anchors**; neither requires the planner to invent structure.

---

## Metadata

**Analog search scope:** `usbee@bitcreed.us/` (all subdirs), `.planning/phases/01-tile-popover-hotplug-daemon-missing-state-v0-1/` (Phase 1 artifacts), `/usr/share/gnome-shell/extensions/auto-move-windows@…/` (external reference).
**Files scanned:** 7 in-repo `.js` source files, 1 schema XML, 1 metadata.json, 1 dbus-iface.xml, 1 external reference `prefs.js`.
**Pattern extraction date:** 2026-05-12
**Confidence:** HIGH — every Phase-2 file either has an exact in-repo analog (8 of 13) or an authoritative external anchor with paste-quality skeleton in RESEARCH (3 of 13: `prefs.js`, `COPYING`, `README.md`); the remaining 2 (`po/*.pot`, `metadata.json` patch) are mechanical toolchain output / one-line additions.
