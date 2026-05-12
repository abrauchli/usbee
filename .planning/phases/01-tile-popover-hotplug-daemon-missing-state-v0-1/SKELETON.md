# Walking Skeleton — USBee

**Phase:** 1
**Generated:** 2026-05-11

## Capability Proven End-to-End

> One sentence: the smallest user-visible capability that exercises the full stack.

A user with the extension enabled sees a USBee Quick Settings tile in the GNOME panel; opening it shows either a live list of devices fetched from the `usbeehive` D-Bus daemon, or — if the daemon is not running — a copyable `systemctl --user enable --now usbeehive` empty state that auto-recovers when the daemon comes up.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language / Runtime | GJS (SpiderMonkey 1.80+) inside `gnome-shell` process | Only language that runs inside the Shell; ESM-only since GNOME 45 (CONTEXT.md D-01, RESEARCH.md §Standard Stack) |
| Module system | ESM with `gi://*` / `resource:///*` imports | Mandatory in GNOME 45+; no `imports.*` legacy form |
| Min target | GNOME Shell 46, declared compat 46/47/48 | CONTEXT.md D-03; PACK-04 |
| Extension UUID | `usbee@bitcreed.us` | CONTEXT.md D-02; matches user's email domain |
| File layout | Hand-rolled per CONTEXT.md D-01 (`extension.js`, `metadata.json`, `dbus-iface.xml`, `src/{dbus-client,device-store,tile,popover,empty-state,signal-registry}.js`, `schemas/`, `stylesheet.css`) | No `gnome-extensions create --template` — that pattern generates legacy `imports.*` (RESEARCH.md §Concrete File Layout) |
| Tile pattern | `QuickSettings.SystemIndicator` owns one `QuickMenuToggle`; mounted via `Main.panel.statusArea.quickSettings.addExternalIndicator(indicator)` | Canonical 2026 pattern (RESEARCH.md §Standard Stack); `_addItems` private and EGO-rejected |
| D-Bus client | One `Gio.DBusProxy.makeProxyWrapper(IFACE_XML)` proxy, constructed lazily inside `Gio.bus_watch_name` "name-appeared" callback | CONTEXT.md D-04, D-05; daemon-missing is the natural startup state, not an error path |
| D-Bus wire identifiers | Bus name `org.usbeehive.Devices`, object path `/org/usbeehive/Devices`, interface `org.usbeehive.Devices1` | VERIFIED against `../usbeehive/src/dbus.rs:290-292`; CONTEXT.md's `…Devices1` for bus name was wrong (RESEARCH.md §Daemon Wire Shape) |
| D-Bus invocation model | Async-only — `proxy.call(...)` with finish callback, or `Gio._promisify`'d `*Async` wrappers | CONTEXT.md D-15; sync D-Bus blocks `gnome-shell` and is EGO-rejected |
| Lifecycle hygiene | `SignalRegistry` helper tracks every `connect` / `connectSignal` / `bus_watch_name` / `timeout_add` source; `disable()` calls `registry.dispose()` once | CONTEXT.md D-14; #1 source of "already disposed" warnings if skipped (RESEARCH.md §SignalRegistry) |
| Indicator ownership | Only `extension.js` calls `addExternalIndicator()` / `indicator.destroy()`; no submodule mounts itself | CONTEXT.md D-16; enable/disable symmetry is the hardest part of an EGO-clean extension |
| Settings storage | GSettings schema `org.gnome.usbee` (empty scaffold in Phase 1; populated in Phase 2) | CONTEXT.md Discretion; lets `dconf-editor` show the schema from day one |
| Architectural bans | No `Gtk.*` / `Adw.*` imports in Shell-process code; no `/sys`; no `Gio.Subprocess` / `GLib.spawn_*`; no bundled binaries; no sync D-Bus | CONTEXT.md D-17, D-18, D-19; PACK-05 |
| Tile subtitle update | Always-on signal subscription (`DeviceAdded` / `DeviceRemoved`) → 150 ms trailing-edge debounce → store re-snapshot → `store 'changed'` signal updates `toggle.subtitle` | CONTEXT.md D-06, D-10; tile subtitle is the differentiator vs WhatCable |
| Popover repopulation | Lazy — only on `menu.connect('open-state-changed')`; signal subscriptions stay live | CONTEXT.md D-11; `backgroundApps.js` pattern |
| Daemon-vanish behaviour | Clear cache, do NOT recreate proxy; wait for `name-appeared` to fire again | CONTEXT.md D-07 |
| i18n | Raw English strings in Phase 1; gettext `_()` wrapping deferred to Phase 2 PACK-02 | CONTEXT.md Deferred Ideas |

## Stack Touched in Phase 1

- [x] Project scaffold — `metadata.json` + `extension.js` ESM module under `usbee@bitcreed.us/`
- [x] Module system — `gi://*` and `resource:///*` ESM imports throughout
- [x] D-Bus — captured `dbus-iface.xml` + `Gio.DBusProxy.makeProxyWrapper` + `Gio.bus_watch_name` for `org.usbeehive.Devices`
- [x] UI — `QuickSettings.QuickMenuToggle` tile with live subtitle, `PopupMenuSection` device-row list, `St.Entry` selectable empty-state command
- [x] Deployment — symlink to `~/.local/share/gnome-shell/extensions/usbee@bitcreed.us` + `gnome-extensions enable`; `gnome-extensions pack` is Phase 2 work

## Out of Scope (Deferred to Later Slices)

> Anything that is *not* in the skeleton. Be explicit — this list prevents future phases from re-litigating Phase 1's minimalism.

- `prefs.js` Adwaita preferences window (Phase 2; PREFS-*, STATE-04)
- GSettings schema keys (empty scaffold only in Phase 1; Phase 2 populates `port-mutes` etc.)
- `CapabilityDegraded` / `CapabilityRestored` signal subscription (Phase 2 NOTIF-*)
- Notification source + `replaces_id` coalescing (Phase 2 NOTIF-*)
- `COPYING`, `README.md`, `.pot` generation, `gnome-extensions pack` zip (Phase 2 PACK-01/02/03/06)
- `gettext _()` wrapping of user-visible strings (Phase 2 PACK-02)
- Per-row icons via `PopupImageMenuItem` (v1.x polish)
- Per-row degraded-state colour / amber subtitle (Phase 2 with `CapabilityDegraded`)
- PDO ladder, trust-signal glyph, history graph (v1.x / v2)
- "Hide empty ports" toggle (Phase 2 PREFS-03)
- Lock-screen prefs-entry hiding (Phase 2 STATE-04 — there's no prefs entry to hide yet)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- **Phase 2 — Notifications, Preferences, EGO Submission Polish (v1.0):** layer `Notifier` (subscribes to `CapabilityDegraded` from the same `DBusClient` proxy already in place) → GSettings schema population (`port-mutes`, `hide-empty-ports`) → `prefs.js` Adwaita preferences window (separate process — `Gtk`/`Adw` allowed there only) → STATE-04 lock-screen entry hiding → gettext `.pot` generation → `COPYING` + `README` + clean `gnome-extensions pack` zip ready for EGO submission. No file in `extension.js` / `src/{dbus-client,device-store,tile,popover,empty-state,signal-registry}.js` needs to change shape; Phase 2 adds files and consumes existing extension points.
