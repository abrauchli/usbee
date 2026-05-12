# Architecture Research

**Domain:** GNOME 46+ Shell extension, pure D-Bus client of an existing session-bus daemon (`org.usbeehive.Devices1`)
**Researched:** 2026-05-11
**Confidence:** HIGH (GNOME 46 Quick Settings + GJS D-Bus surface is well documented and stable; one MEDIUM-confidence pick called out below)

---

## TL;DR

USBee is a single ES-module GNOME Shell extension. It consists of one `SystemIndicator` that owns one `QuickMenuToggle`. A small `DBusClient` module wraps `Gio.DBusProxy.makeProxyWrapper()` against `org.usbeehive.Devices1` and is the single source of truth for "what does usbeehive say right now." A `NotifierService` translates `CapabilityDegraded` / `CapabilityRestored` signals into `MessageTray` notifications, gated by a `port-mutes` GSettings key. `prefs.js` is a thin libadwaita window bound to the same GSettings schema. There is no companion daemon, no Rust binary, no separate UI process — usbeehive does all heavy lifting and USBee is ~500-1000 lines of GJS.

The whole thing is one extension package built from one source tree, shipped to extensions.gnome.org as a single `.zip`.

---

## Standard Architecture

### System Overview

```
                ╔══════════════════════════════════════════════════════════╗
                ║                  GNOME Shell process (gjs)               ║
                ║                                                          ║
                ║  ┌────────────────── extension.js (Extension) ────────┐  ║
                ║  │                                                    │  ║
                ║  │  enable()  ──┐                                     │  ║
                ║  │              ▼                                     │  ║
                ║  │   ┌────────────────────────────────────────────┐   │  ║
                ║  │   │      USBeeIndicator (SystemIndicator)      │   │  ║
                ║  │   │  - panel icon + visibility                 │   │  ║
                ║  │   │  - owns 1 QuickMenuToggle                  │   │  ║
                ║  │   └──────────────────┬─────────────────────────┘   │  ║
                ║  │                      │                             │  ║
                ║  │                      ▼                             │  ║
                ║  │   ┌────────────────────────────────────────────┐   │  ║
                ║  │   │       USBeeToggle (QuickMenuToggle)        │   │  ║
                ║  │   │  - tile title/subtitle (headline)          │   │  ║
                ║  │   │  - this.menu = popover, lazy-populated     │   │  ║
                ║  │   │    on 'open-state-changed'                 │   │  ║
                ║  │   └──────────────────┬─────────────────────────┘   │  ║
                ║  │                      │ reads model                 │  ║
                ║  └──────────────────────┼─────────────────────────────┘  ║
                ║                         │                                ║
                ║   ┌─────────────────────┼──────────────────────────┐     ║
                ║   │   model & services (plain JS modules)          │     ║
                ║   │                     ▼                          │     ║
                ║   │ ┌─────────────┐ ┌──────────────┐ ┌──────────┐  │     ║
                ║   │ │ DBusClient  │→│ DeviceStore  │ │ Notifier │  │     ║
                ║   │ │ (proxy +    │ │  (cached     │ │ Service  │  │     ║
                ║   │ │  name watch)│ │   snapshot)  │ │          │  │     ║
                ║   │ └──────┬──────┘ └──────┬───────┘ └────┬─────┘  │     ║
                ║   └────────┼───────────────┼──────────────┼────────┘     ║
                ║            │ signals       │ "changed"    │ uses GSettings║
                ║            │ + methods     │              │ port-mutes   ║
                ╚════════════╪═══════════════╪══════════════╪══════════════╝
                             │               │              │
                ─────────────▼─── session D-Bus ────────────▼──── MessageTray
                             │                              ▲
                ┌────────────▼───────────────┐              │
                │ usbeehive (separate proc)  │              │
                │  org.usbeehive.Devices1    │──notifies────┘
                │  methods + properties +    │
                │  signals                   │
                └────────────────────────────┘

                 (separate Gtk4 process, only when user opens prefs)
                ╔══════════════════════════════════════════════════════════╗
                ║                  prefs.js (gjs, Gtk4/Adw)                ║
                ║   ExtensionPreferences.fillPreferencesWindow()           │
                ║   - Adw.PreferencesPage(s)                              │
                ║   - binds widgets to GSettings org.gnome.shell.          │
                ║     extensions.usbee                                     │
                ╚══════════════════════════════════════════════════════════╝
```

### Component Responsibilities

| Component | File | Responsibility | Implementation |
|-----------|------|----------------|----------------|
| Extension entry | `extension.js` | `enable()` constructs the indicator chain; `disable()` tears everything down. No business logic. | `class extends Extension` |
| Panel surface | `lib/indicator.js` | One `SystemIndicator` instance; owns icon visibility and pushes the toggle into `quickSettingsItems`. | `class extends QuickSettings.SystemIndicator` |
| Tile + popover | `lib/toggle.js` | The Quick Settings tile (headline) and the popover menu (per-device rows). Reads from `DeviceStore`; emits no business state of its own. | `class extends QuickSettings.QuickMenuToggle` |
| D-Bus client | `lib/dbusClient.js` | Wraps `Gio.DBusProxy.makeProxyWrapper(IFACE_XML)`. Constructs the proxy async, watches `g-name-owner`, exposes `ready/lost` events, surfaces `DeviceAdded` / `DeviceRemoved` / `CapabilityDegraded` / `CapabilityRestored`, and calls `SnapshotJson` on demand. **Single source of truth for daemon connectivity.** | Module with a class + emitter |
| Device store | `lib/deviceStore.js` | Holds the current device list as a JS array; emits `'changed'` when it mutates. Maintains the headline string. Pure data — no UI, no D-Bus. | Plain `GObject` or `EventEmitter`-style class |
| Notifier | `lib/notifier.js` | Owns one `MessageTray.Source` (custom, named "USBee"). Listens to `CapabilityDegraded` / `Restored` from the client. Filters via `port-mutes` GSettings list. Adds a "Don't notify for this port" action button. **Single source of truth for notification policy.** | Module with a class |
| Settings schema | `schemas/org.gnome.shell.extensions.usbee.gschema.xml` | Declares `port-mutes` (array of strings), plus any later prefs (e.g. `show-when-empty`, `notification-enabled`). | XML + `glib-compile-schemas` |
| Preferences UI | `prefs.js` | `Adw.PreferencesPage` bound to GSettings keys. Shows a list of currently-muted ports with un-mute actions. | `class extends ExtensionPreferences` |
| Metadata | `metadata.json` | Declares `uuid`, `shell-version: ["46", "47", "48"]`, `settings-schema`, `gettext-domain`. | JSON |
| i18n stubs | wrapped in code | `gettext as _` import in every UI module; no `po/` files in v1 (gettext scaffolding only). | Per `Extension`/`ExtensionPreferences` |

**Why this carve-up:**

- **`DBusClient` is isolated** so the rest of the codebase never imports `Gio.DBus*` directly. This makes mocking trivial and makes the daemon-missing state a single concern in one file.
- **`DeviceStore` is the model.** The toggle and the headline-renderer both read from it. The store decides what "the headline" is, so headline logic isn't duplicated between the tile (collapsed) and the popover (open).
- **`Notifier` is sibling to the UI**, not inside it. The popover never sends notifications; the notifier never touches the popover. They share data via the store + client only.

---

## Recommended Project Structure

```
usbee/
├── metadata.json                                # uuid, shell-version, settings-schema, gettext-domain
├── extension.js                                 # Extension subclass; enable/disable wiring only
├── prefs.js                                     # ExtensionPreferences subclass; Adw UI bound to GSettings
├── stylesheet.css                               # any CSS tweaks for the tile rows
├── lib/
│   ├── indicator.js                             # SystemIndicator subclass
│   ├── toggle.js                                # QuickMenuToggle subclass + popover rows
│   ├── dbusClient.js                            # makeProxyWrapper + bus_watch_name
│   ├── deviceStore.js                           # cached snapshot + 'changed' signal + headline derivation
│   ├── notifier.js                              # MessageTray.Source + per-port mute logic
│   ├── format.js                                # pure functions: speed → "10 Gb/s", power → "100 W in"
│   └── ifaceXml.js                              # const IFACE_XML = `<node>…</node>` (or read from data/)
├── schemas/
│   └── org.gnome.shell.extensions.usbee.gschema.xml
├── data/
│   └── org.usbeehive.Devices1.xml               # introspection XML (copy from usbeehive)
├── icons/
│   └── usbee-symbolic.svg                       # follows GNOME symbolic icon convention
├── locale/                                      # empty in v1; gettext markers only
├── Makefile                                     # pack, install, schemas
└── COPYING                                      # GPL-3.0
```

### Structure Rationale

- **Flat `lib/`, no deeper nesting.** The extension is small (~500-1000 LoC). Premature subdivision (`lib/services/`, `lib/ui/`) is unhelpful at this scale. One folder, descriptive filenames.
- **`data/org.usbeehive.Devices1.xml` mirrored from upstream.** Keep the interface XML as a build-time artifact copied/regenerated from `usbeehive`, not hand-written. If the daemon adds a method, this file is the seam.
- **`ifaceXml.js` re-exports the XML as a JS string** because `makeProxyWrapper` takes a string; this avoids any runtime file I/O at enable() time.
- **`format.js` is pure.** All "human strings" funnel through it so a future i18n pass touches one file.
- **No TypeScript** for v1: shipping to EGO is simpler with raw GJS, and the surface area doesn't justify a build pipeline. Revisit post-MVP if `lib/` grows past ~1500 LoC.

---

## Architectural Patterns

### Pattern 1: D-Bus Proxy as the Connectivity Singleton

**What:** A single `DBusClient` instance is created in `enable()` and torn down in `disable()`. It owns the `Gio.DBusProxy` (built via `makeProxyWrapper`) and a `Gio.bus_watch_name` handle. Every other module talks to *it*, never to D-Bus directly.

**When to use:** Always, for any extension that depends on a third-party session-bus service that may not be running.

**Trade-offs:** One extra layer of indirection vs. inlining proxy calls in the toggle. Worth it because daemon-missing handling becomes one switch in one file, signals can be re-broadcast as JS events (no GObject signal disconnect bookkeeping for downstream modules), and unit-testing becomes possible by swapping the client.

**Skeleton:**

```javascript
// lib/dbusClient.js
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import {IFACE_XML} from './ifaceXml.js';

const BUS_NAME = 'org.usbeehive';
const OBJ_PATH = '/org/usbeehive/Devices1';
const UsbeehiveProxy = Gio.DBusProxy.makeProxyWrapper(IFACE_XML);

export const DBusClient = GObject.registerClass({
    Signals: {
        'ready':   {},                                  // daemon appeared
        'lost':    {},                                  // daemon vanished
        'devices-changed':       {param_types: []},     // added or removed
        'capability-degraded':   {param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING]},
        'capability-restored':   {param_types: [GObject.TYPE_STRING]},
    },
}, class DBusClient extends GObject.Object {
    start() {
        this._watchId = Gio.bus_watch_name(
            Gio.BusType.SESSION, BUS_NAME, Gio.BusNameWatcherFlags.NONE,
            () => this._onAppeared(),
            () => this._onVanished(),
        );
    }
    stop() {
        if (this._signalIds) this._signalIds.forEach(id => this._proxy?.disconnect(id));
        this._proxy = null;
        if (this._watchId) { Gio.bus_unwatch_name(this._watchId); this._watchId = 0; }
    }
    _onAppeared() {
        new UsbeehiveProxy(Gio.DBus.session, BUS_NAME, OBJ_PATH, (proxy, error) => {
            if (error) { console.error(error); return; }
            this._proxy = proxy;
            this._signalIds = [
                proxy.connectSignal('DeviceAdded',   () => this.emit('devices-changed')),
                proxy.connectSignal('DeviceRemoved', () => this.emit('devices-changed')),
                proxy.connectSignal('CapabilityDegraded', (_p, _s, [port, reason]) =>
                    this.emit('capability-degraded', port, reason)),
                proxy.connectSignal('CapabilityRestored', (_p, _s, [port]) =>
                    this.emit('capability-restored', port)),
            ];
            this.emit('ready');
        });
    }
    _onVanished() {
        this._proxy = null;
        this.emit('lost');
    }
    async snapshot() {
        if (!this._proxy) throw new Error('daemon-not-running');
        const [json] = await this._proxy.SnapshotJsonAsync();
        return JSON.parse(json);
    }
});
```

### Pattern 2: Always-On Signal Subscription, Lazy Popover Population

**What:** Subscribe to D-Bus signals continuously in `enable()` (cheap — they're just signal handlers on a proxy that's idle when nothing changes). Use the `open-state-changed` signal on `QuickMenuToggle.menu` to rebuild the *visible* per-device rows only when the user opens the popover.

**When to use:** Whenever (a) you need to react to events even when UI is closed (notifications!) and (b) building the UI rows is more expensive than holding a small JS array.

**Trade-offs:**
- *Why not "only listen when open"?* Because `CapabilityDegraded` notifications must fire whether or not the user has the tile open. The whole point of the notification is to surface a problem the user *hasn't* noticed.
- *Why lazy-populate the menu?* Per the GJS guide, GNOME Quick Settings popovers conventionally rebuild on open to avoid stale rows and to amortise cost. The headline (tile subtitle) stays live because it's cheap to update.

**Skeleton:**

```javascript
// lib/toggle.js (excerpt)
this.menu.connect('open-state-changed', (_m, open) => {
    if (!open) return;
    this._rowsSection.removeAll();
    for (const dev of this._store.devices) {
        this._rowsSection.addMenuItem(this._buildDeviceRow(dev));
    }
});

// Always-on: headline updates whenever the store changes
this._store.connect('changed', () => {
    this.title = this._store.headline;          // e.g. "USB-C: 100 W in, 10 Gb/s"
    this.subtitle = this._store.subhead;        // e.g. "2 devices, 1 charging"
});
```

### Pattern 3: GSettings as the Single Notification-Policy Source

**What:** Per-port mute state lives in one GSettings key, `port-mutes` (type `as` — array of strings, each entry a stable port identifier from `usbeehive`). `Notifier` reads it on each degraded event; `prefs.js` displays/edits the same key; the "Don't notify for this port" action in the notification mutates the same key. Three writers, one store, automatic cross-process sync (the whole point of GSettings).

**When to use:** Any state that must be reachable from both the Shell process (`extension.js`) and the prefs process (`prefs.js`).

**Trade-offs:** Slightly more ceremony than a JS Map, but trivial for the user to inspect via `dconf-editor` and survives extension reloads / Shell restarts.

**Skeleton:**

```xml
<!-- schemas/org.gnome.shell.extensions.usbee.gschema.xml -->
<schemalist>
  <schema id="org.gnome.shell.extensions.usbee"
          path="/org/gnome/shell/extensions/usbee/">
    <key name="port-mutes" type="as">
      <default>[]</default>
      <summary>Ports muted from CapabilityDegraded notifications</summary>
    </key>
    <key name="notifications-enabled" type="b">
      <default>true</default>
      <summary>Master switch for all USBee notifications</summary>
    </key>
  </schema>
</schemalist>
```

```javascript
// lib/notifier.js (excerpt)
onDegraded(port, reason) {
    if (!this._settings.get_boolean('notifications-enabled')) return;
    if (this._settings.get_strv('port-mutes').includes(port)) return;
    const n = new MessageTray.Notification({source: this._source,
        title: _('Charging degraded on %s').format(port), body: reason});
    n.addAction(_("Don't notify for this port"), () => {
        const muted = this._settings.get_strv('port-mutes');
        if (!muted.includes(port)) this._settings.set_strv('port-mutes', [...muted, port]);
    });
    this._source.addNotification(n);
}
```

### Pattern 4: Headline Derivation in the Store, Not the View

**What:** The one-line tile headline ("USB-C: 100 W in, 10 Gb/s" vs "2 devices, none charging" vs "usbeehive not running") is a computed property of `DeviceStore`, not a chunk of code inside `toggle.js`. The toggle binds its `title`/`subtitle` to the store's derived strings.

**When to use:** Whenever the same logical string is read from multiple places (here: the tile + potentially the notification body + a future panel-icon tooltip).

**Trade-offs:** Adds ~30 lines of pure JS to the store. Pays for itself the first time the headline format changes.

---

## Data Flow

### Steady-State (daemon running, user idle)

```
usbeehive ─DeviceAdded/Removed─►  DBusClient ─emit 'devices-changed'─►  DeviceStore
                                                                          │
                                                       (re-call SnapshotJson, parse, replace)
                                                                          │
                                                                          ▼
                                                                    emit 'changed'
                                                                          │
                                                ┌─────────────────────────┴──────────────┐
                                                ▼                                        ▼
                                          USBeeToggle                              (no notifier
                                          updates title/subtitle                    interest in
                                          (popover, if open,                        Added/Removed)
                                          rebuilds its rows)
```

### User Opens the Popover

```
User clicks tile  ─►  QuickMenuToggle.menu  emits 'open-state-changed'(open=true)
                                                       │
                                                       ▼
                                            toggle._rowsSection.removeAll()
                                                       │
                                            for each device in store:
                                              build PopupMenuItem
                                              (icon, friendly name,
                                               negotiated speed, watts,
                                               cable diagnostic string)
                                                       │
                                                       ▼
                                            section.addMenuItem(row)
```

### CapabilityDegraded event

```
usbeehive ──CapabilityDegraded(port, reason)──►  DBusClient
                                                    │
                                                    ├─emit 'capability-degraded'(port, reason)──►  Notifier
                                                    │                                                │
                                                    │                                  read GSettings 'port-mutes'
                                                    │                                                │
                                                    │                                       muted?  ─yes─► drop
                                                    │                                                │ no
                                                    │                                                ▼
                                                    │                                  MessageTray.Source.addNotification(
                                                    │                                    title, body,
                                                    │                                    action "Don't notify for this port")
                                                    │
                                                    └─ (optionally also force a store refresh so the popover row
                                                       reflects the degraded state next time it opens)
```

### Daemon Missing → Daemon Appears

```
enable()
  │
  ▼
DBusClient.start()  →  Gio.bus_watch_name(BUS_NAME, ...)
                              │
                  daemon NOT yet on the bus
                              │
                              ▼
                       'name vanished' callback (initial state)
                              │
                              ▼
                       DBusClient emits 'lost'
                              │
                              ▼
            DeviceStore enters "daemon-missing" state
              .headline = _('usbeehive daemon not running')
              .devices = []
                              │
                              ▼
              Toggle renders the missing state:
                 - title:    "USB info unavailable"
                 - subtitle: "usbeehive daemon not running"
                 - popover (when opened): one PopupMenuItem with
                   the install hint (copyable label)
                              │
            ... later: user runs `systemctl --user start usbeehive`
                              │
                              ▼
                       'name appeared' callback
                              │
                              ▼
              DBusClient builds the proxy, connects signals,
              emits 'ready'
                              │
                              ▼
              DeviceStore calls snapshot(), populates devices,
              emits 'changed'
                              │
                              ▼
              Toggle lights up automatically. No user action needed.
```

### Preferences Flow (separate Gtk4 process)

```
User: gnome-extensions prefs usbee@…   (or via Extensions app)
                              │
                              ▼
                  prefs.js: ExtensionPreferences.fillPreferencesWindow(window)
                              │
                              ▼
                  window._settings = this.getSettings()      ──reads/writes──►  dconf
                  Adw.SwitchRow ◄─binds──► 'notifications-enabled'                │
                  Adw.PreferencesGroup lists 'port-mutes' entries                 │
                    each row has [Unmute] which removes from strv                 │
                              │                                                   │
                              ▼                                                   │
                          (on close: nothing to do; bindings persist)             │
                                                                                  │
                                                       ┌──────────────────────────┘
                                                       ▼
                              extension.js side (gnome-shell process):
                                Gio.Settings emits 'changed::port-mutes'
                                Notifier picks it up automatically on the next event;
                                no extension reload required.
```

### Key Data Flows (one-line summaries)

1. **Device snapshot:** `usbeehive.SnapshotJson()` → `DBusClient` → `DeviceStore` → tile/popover. Called once on `ready`, then on every `DeviceAdded`/`Removed`.
2. **Headline derivation:** `DeviceStore` computes `headline` / `subhead` strings from its device list whenever it mutates; toggle binds `title`/`subtitle` to them.
3. **Notification policy:** `DBusClient.capability-degraded` → `Notifier` → GSettings check → `MessageTray.Source.addNotification`. Action button writes back to GSettings.
4. **Settings sync:** `prefs.js` (Gtk4 proc) and `notifier.js` (Shell proc) share state purely through GSettings. No IPC.
5. **Daemon presence:** `Gio.bus_watch_name` callbacks → `DBusClient` ready/lost signals → store reset → UI re-render. **No polling.**

---

## MVP Slice and Build-Order Implications

**Coarse decomposition into two phases.** USBee is small; two phases is the honest number.

### Phase 1 — "It shows up and reflects reality" (MVP slice)

Ship a tile that lists devices and updates on hotplug. No notifications, no prefs, no per-port mute. This is shippable to EGO as v0.1.

Build order *within* the phase (each step is a prerequisite for the next):

1. **`metadata.json` + skeleton `extension.js`** — empty `enable`/`disable` that just logs. Confirms the extension installs and toggles.
2. **`lib/ifaceXml.js`** — copy `org.usbeehive.Devices1` introspection XML from upstream.
3. **`lib/dbusClient.js`** — proxy + name-watch only; expose `ready` / `lost` / `devices-changed`. Test by `journalctl -f /usr/bin/gnome-shell`.
4. **`lib/format.js` + `lib/deviceStore.js`** — pure logic; unit-testable in isolation with a fake client.
5. **`lib/indicator.js` + `lib/toggle.js`** — wire the SystemIndicator + QuickMenuToggle, headline binding, lazy popover.
6. **Daemon-missing state** in the toggle (the install-hint row). This is the natural place to verify the `lost` path.

**Phase 1 exit criteria:** tile appears, headline reflects daemon state, popover lists devices, hotplug works, killing the daemon swaps to the missing-state view, restarting it relights the tile.

### Phase 2 — "It tells you when something is wrong"

Notifications + preferences + per-port mute. Everything in Phase 2 builds *on* Phase 1 without changing Phase 1 code (except adding the `port-mutes` schema key and wiring the notifier into `enable()`).

1. **`schemas/…gschema.xml`** + `Makefile` rule for `glib-compile-schemas`.
2. **`lib/notifier.js`** — `MessageTray.Source`, listens to `capability-degraded`/`-restored`, reads `port-mutes`.
3. **In-notification "Don't notify for this port" action** — mutates GSettings.
4. **`prefs.js`** — Adw page with master toggle and the list of muted ports.
5. **Polishing pass**: gettext markers on every user-visible string, icon SVG, README, EGO submission checklist.

**Phase 2 exit criteria:** degrading a port (test by patching `usbeehive` to emit on a timer) raises a notification with a working mute action; the muted port is visible in prefs and can be un-muted; toggling the master switch silences notifications without disabling the tile.

### Critical dependencies (what blocks what)

- **Everything depends on `DBusClient`.** Without it nothing else can be tested against the real daemon. Build it first, then build a fake of it for everything else's unit-level testing.
- **`Notifier` depends on the GSettings schema being compiled and installed.** Don't write `notifier.js` until `glib-compile-schemas schemas/` is in the build.
- **`prefs.js` depends on the schema and on `port-mutes` being writable from `notifier.js`** — i.e. the action-button code path. Build the in-notification action first, then expose the same state in prefs.

### What can ship at each phase boundary

| End of phase | Shippable to | What it does |
|--------------|--------------|--------------|
| Phase 1 | EGO as v0.1 | Tile + popover + hotplug + daemon-missing graceful state. No notifications, no settings. |
| Phase 2 | EGO as v1.0 | Adds CapabilityDegraded notifications with per-port mute and a prefs window. Matches `.planning/PROJECT.md` Active list exactly. |

---

## Scaling Considerations

USBee runs in `gnome-shell` itself. "Scale" here means UI responsiveness and Shell process health, not user count.

| Scale | What it looks like | Adjustment |
|-------|--------------------|------------|
| Typical user (1-5 USB devices, 1-2 USB-C ports) | A handful of `DeviceAdded`/`Removed` events per day | None needed; the patterns above are designed for this |
| Heavy user (laptop + dock + 10-15 devices) | Hotplug bursts when a dock attaches | `DeviceStore` should debounce its `SnapshotJson` refresh by ~50-100 ms so a dock-attach cascade refreshes once, not 15 times |
| Pathological (USB hub-of-hubs, kernel quirks) | Many signals/sec for short bursts | Same debounce. Beyond that, push the problem upstream into `usbeehive` (it owns enumeration) |

### Scaling Priorities

1. **First bottleneck: snapshot churn during dock-attach.** If `SnapshotJson` is called 15 times in 200 ms, the Shell main loop will judder. Mitigation: debounce/coalesce in `DeviceStore`. Implement only if measured — premature on a 2-device laptop.
2. **Second bottleneck: popover row construction.** If a user has 30+ devices visible, building 30 `PopupMenuItem`s on every `open-state-changed` could feel laggy. Mitigation: virtualise — show top-N "interesting" devices and a "Show all" expander. Defer until reported.

---

## Anti-Patterns

### Anti-Pattern 1: Touching D-Bus from the toggle

**What people do:** Put `Gio.DBusProxy` calls directly inside the `QuickMenuToggle` constructor or its open handler. "It's only one place."

**Why it's wrong:** Two things start using D-Bus (toggle + notifier), each maintaining its own proxy and name-watch. Daemon-missing state ends up duplicated, signal handler leaks proliferate, `disable()` becomes a footgun.

**Do this instead:** Force every D-Bus interaction through `lib/dbusClient.js`. The toggle never imports `gi://Gio`.

### Anti-Pattern 2: Subscribing to signals only when the popover is open

**What people do:** Wire signal handlers in `open-state-changed(open=true)` and disconnect them on `false`, "to be efficient."

**Why it's wrong:** `CapabilityDegraded` must fire even when the popover is closed — that's literally the only time it would matter. You'd also miss `DeviceAdded` events that occurred while closed, so the popover would show stale data the first frame after opening.

**Do this instead:** Always-on signal subscription in `enable()`. The cost of an idle GIO signal handler is effectively zero. Lazy-build the *view* (popover rows), never the *subscription*.

### Anti-Pattern 3: Storing per-port mute in a JS Map

**What people do:** Keep mute state in a module-level `Map` for "simplicity."

**Why it's wrong:** (a) Lost on every Shell restart / extension reload. (b) Not visible to `prefs.js` (separate process). (c) Not inspectable via `dconf`. (d) Users would lose their config every GNOME upgrade.

**Do this instead:** GSettings `as` key from day one (Phase 2). It's only 6 lines of XML.

### Anti-Pattern 4: Polling `SnapshotJson` on a timer

**What people do:** `GLib.timeout_add_seconds(2, () => snapshot())` to "keep things fresh."

**Why it's wrong:** Wastes CPU, drains battery, and the daemon already signals every state change. If the signal surface is incomplete, the fix is upstream in `usbeehive`, per project constraints.

**Do this instead:** Snapshot once on `ready`, then refresh only on the daemon's own signals (`DeviceAdded`, `DeviceRemoved`, and possibly on `CapabilityDegraded`/`Restored` if those imply a device-attribute change).

### Anti-Pattern 5: Forgetting `disable()` symmetry

**What people do:** Construct proxies, signal handlers, `MessageTray.Source`, and `Mainloop.timeout_add` calls in `enable()` and not undo them all in `disable()`.

**Why it's wrong:** Immediate rejection on EGO review. Also causes warnings about invalidated GObjects after extension reload.

**Do this instead:** Every `enable()` allocation has a matching disposal in `disable()`. Store handler IDs (signal IDs, bus-watch IDs, timeout IDs) as instance properties so disposal is mechanical. The 6 components above each export a `destroy()`-style method that `extension.disable()` calls in reverse order.

### Anti-Pattern 6: Using `Main.notify` for the degraded notification

**What people do:** `Main.notify('Charging degraded', reason)` because it's one line.

**Why it's wrong:** `Main.notify` uses the system source and exposes no action buttons. The "Don't notify for this port" affordance is a hard requirement.

**Do this instead:** A custom `MessageTray.Source` named "USBee", with `notification.addAction(label, callback)` for the mute action. (Per the GNOME 46 notifications guide.)

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| `org.usbeehive.Devices1` (session bus) | `Gio.DBusProxy.makeProxyWrapper(IFACE_XML)` constructed async on name-appearance; signals re-broadcast as JS signals on `DBusClient` | The interface XML is mirrored into `data/`; treat upstream changes to the XML as the API-versioning surface. Use `Gio.bus_watch_name`, **not** the proxy's internal `g-name-owner` notify, because the proxy doesn't exist yet during the daemon-missing state |
| `org.freedesktop.Notifications` | Via GNOME Shell's `MessageTray` — never via raw `Gio.DBus` calls | Using `MessageTray.Source` (custom-named) gives action buttons, urgency, and avoids GNOME 46's "3 most recent per app" limit for the system source |
| `dconf` (via GSettings) | `Extension.getSettings()` in `extension.js`; `ExtensionPreferences.getSettings()` in `prefs.js` — both resolved by `settings-schema` in `metadata.json` | Compile schemas with `glib-compile-schemas schemas/` as a build step and ship `gschemas.compiled` in the zip |
| GNOME Shell Quick Settings | `Main.panel.statusArea.quickSettings.addExternalIndicator(systemIndicator)` in `enable`; `systemIndicator.destroy()` in `disable` | API stabilised in GNOME 45; minor refinements in 46. Our `shell-version` in `metadata.json` should be `["46", "47", "48"]` and bumped as new Shell versions ship |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `extension.js` ↔ `lib/*.js` | Direct ES-module import; instances constructed in `enable()` | One-way: `extension.js` knows about every module, modules don't know about `extension.js` |
| `DBusClient` ↔ `DeviceStore` | GObject signal `devices-changed`; store reacts by calling `client.snapshot()` | Store does not import `gi://Gio` — only the client does |
| `DeviceStore` ↔ `USBeeToggle` | GObject signal `changed`; toggle reads `store.headline` / `store.devices` | One-way: store is upstream of view |
| `DBusClient` ↔ `Notifier` | GObject signals `capability-degraded` / `capability-restored` | Notifier is parallel to the store, not downstream of it — it doesn't need the full device list, only the port + reason payload |
| `Notifier` ↔ GSettings | Synchronous `get_strv` / `set_strv` on every event | Cheap; no caching needed |
| Shell process ↔ Gtk4 prefs process | Only via GSettings | No D-Bus IPC, no file watching, no custom protocol. This is the deliberate point of GSettings |

### The Single-Source-of-Truth Map

| Concern | Lives in | Read by | Written by |
|---------|----------|---------|------------|
| Is the daemon up? | `DBusClient` (in-memory) | `DeviceStore`, `Notifier`, `USBeeToggle` (indirectly via store) | `DBusClient` only |
| Current device list | `DeviceStore` (in-memory) | `USBeeToggle` | `DBusClient` → `DeviceStore` |
| Tile headline string | `DeviceStore` (computed property) | `USBeeToggle` | derived only — no writer |
| Per-port mute set | GSettings `port-mutes` | `Notifier`, `prefs.js` | `Notifier` (notification action), `prefs.js` (unmute button) |
| Notification master switch | GSettings `notifications-enabled` | `Notifier` | `prefs.js` |
| Notification dispatch decision | `Notifier` (combines client signal + GSettings) | nobody — terminal | `Notifier` only |

---

## Open Questions to Resolve in Phase 1

These are not blocking — they have sensible defaults — but flag for early validation.

1. **Snapshot strategy on `ready`:** Call `SnapshotJson` once and then incremental-update from `DeviceAdded` / `Removed`? Or call `SnapshotJson` again on every signal? **Default: re-snapshot on every signal** until proven slow. Simpler and matches the daemon's "JSON is the truth" stance. (LOW confidence — depends on `SnapshotJson` cost on real hardware.)

2. **Property `DeviceCount`:** Do we bind to the proxy's cached property or just use the array length from `SnapshotJson`? **Default: ignore the property** in v1; array length is the truth. Property cache is a nice-to-have for headline updates if `SnapshotJson` proves expensive.

3. **`Diagnose` method:** When is it called? **Default: never in v1.** It's a richer one-shot diagnostic and belongs in a post-MVP "Why is this slow?" deep-dive view, not the tile.

4. **`icon-name` for the tile when degraded:** `usb-symbolic` is the obvious normal-state icon; need a degraded variant. **Default: same icon + amber subtitle** until a designer disagrees.

---

## Sources

- [Quick Settings | GNOME JavaScript](https://gjs.guide/extensions/topics/quick-settings.html) — `QuickMenuToggle` / `SystemIndicator` canonical patterns for GNOME 45/46
- [D-Bus | GNOME JavaScript](https://gjs.guide/guides/gio/dbus.html) — `Gio.DBusProxy.makeProxyWrapper`, async construction, name-owner tracking
- [Popup Menu | GNOME JavaScript](https://gjs.guide/extensions/topics/popup-menu.html) — `open-state-changed` lazy-population pattern
- [Notifications | GNOME JavaScript](https://gjs.guide/extensions/topics/notifications.html) — `MessageTray.Source`, `getSystemSource()`, action buttons
- [Port Extensions to GNOME Shell 46 | GNOME JavaScript](https://gjs.guide/extensions/upgrading/gnome-shell-46.html) — GNOME 46 messaging changes (`getSystemSource()`, `NotificationPolicy.newForApp()`)
- [Preferences | GNOME JavaScript](https://gjs.guide/extensions/development/preferences.html) — `ExtensionPreferences`, `fillPreferencesWindow`, GSettings binding
- [Anatomy of an Extension | GNOME JavaScript](https://gjs.guide/extensions/overview/anatomy.html) — file layout, `metadata.json`, schema compilation
- [Extension (ESModule) | GNOME JavaScript](https://gjs.guide/extensions/topics/extension.html) — modern `class extends Extension` lifecycle
- [GNOME Shell Extensions Review Guidelines | GNOME JavaScript](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) — mandatory `disable()` teardown, signal-disconnect rules
- [qwreey/quick-settings-tweaks](https://github.com/qwreey/quick-settings-tweaks) — real-world GNOME 46-48 extension targeting Quick Settings (reference implementation)

---
*Architecture research for: GNOME 46+ Quick Settings extension acting as a thin D-Bus client of `org.usbeehive.Devices1`*
*Researched: 2026-05-11*
