# Phase 1: Tile, Popover, Hotplug, Daemon-Missing State (v0.1) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 1-Tile-Popover-Hotplug-Daemon-Missing-State-v0.1
**Mode:** --auto (Claude auto-selected the recommended option for every gray area)
**Areas discussed:** Project scaffold, D-Bus integration, Snapshot strategy, Tile headline derivation, Hotplug debounce, Empty-state UX, Lifecycle hygiene, Architectural invariants

---

## Project scaffold

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-roll file layout from ARCHITECTURE.md | ESM GNOME 45+ layout, follows research-validated component map | ✓ |
| `gnome-extensions create --template=quick-settings` | Generates a starter but pulls in legacy `imports.*` patterns | |

**Auto-selected:** Hand-roll. Template path drags in deprecated patterns; research already prescribed the layout.

| Option | Description | Selected |
|--------|-------------|----------|
| UUID `usbee@bitcreed.us` | Matches user's email domain; clean EGO identifier | ✓ |
| UUID `usbee@github.com` / `usbee@local` | Less specific, may collide on EGO | |

**Auto-selected:** `usbee@bitcreed.us`.

---

## D-Bus integration

| Option | Description | Selected |
|--------|-------------|----------|
| Capture introspection XML from live daemon, check `dbus-iface.xml` into repo | One source of truth, diff-able against upstream `usbeehive/src/dbus.rs` | ✓ |
| Inline XML string literal inside the JS source | Quicker initial diff, but rots silently when upstream changes | |

**Auto-selected:** Captured `dbus-iface.xml` file.

| Option | Description | Selected |
|--------|-------------|----------|
| Construct `Gio.DBusProxy.makeProxyWrapper` proxy async inside `bus_watch_name` "appeared" callback | "Daemon not running" becomes the natural startup state | ✓ |
| Construct eagerly at `enable()`, treat ENOENT as an error | Forces error-handling branches everywhere | |

**Auto-selected:** Async, inside `bus_watch_name` callback.

---

## Snapshot strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Full re-snapshot on every relevant signal | Eliminates desync bugs, can optimize later if profiling demands | ✓ |
| Incremental cache patched by `DeviceAdded`/`DeviceRemoved` | Faster on paper, but races with initial `ListDevices` settle | |

**Auto-selected:** Full re-snapshot. Per ARCHITECTURE.md open-question default.

---

## Tile headline derivation

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit four-tier priority (charging → fastest-link → device-count → empty) | Predictable, observable, single-place to tweak | ✓ |
| Concatenated multi-fact string | Crowded subtitle, hard to read at a glance | |
| Per-device cycle | Adds animation cost, ambiguous on hover | |

**Auto-selected:** Explicit four-tier priority. See D-09 in CONTEXT.md.

---

## Hotplug debounce

| Option | Description | Selected |
|--------|-------------|----------|
| 150 ms trailing-edge debounce on UI re-render | Coalesces dock-attach bursts; users perceive a single update | ✓ |
| Immediate re-render on every signal | Tile flickers visibly on Thunderbolt enumeration | |
| Longer debounce (500 ms+) | Adds perceptible lag between plug and visual feedback | |

**Auto-selected:** 150 ms. Per PITFALLS.md recommendation.

---

## Empty-state UX (daemon not running)

| Option | Description | Selected |
|--------|-------------|----------|
| Selectable `St.Entry` with the systemctl command | User copies; no spawning | ✓ |
| Button that runs `systemctl --user enable --now usbeehive` | EGO would reject — extensions cannot spawn subprocesses | |
| Plain label, user types the command from memory | Bad UX, defeats the "copyable hint" requirement | |

**Auto-selected:** Selectable `St.Entry`. Honest about the "no subprocess" EGO rule and still copyable.

---

## Lifecycle hygiene

| Option | Description | Selected |
|--------|-------------|----------|
| Track every signal/timeout/bus-watch ID in a `SignalRegistry` helper; tear down in `disable()` | Eliminates the #1 EGO rejection vector | ✓ |
| Track ad-hoc per file | Easy to miss one and produce "already disposed" warnings | |

**Auto-selected:** `SignalRegistry` helper.

| Option | Description | Selected |
|--------|-------------|----------|
| Async-only D-Bus (`proxy.call(...)` + finish callback / `Gio._promisify`) | Doesn't block `gnome-shell` | ✓ |
| Allow `proxy.call_sync` at startup for simplicity | Blocks the entire Shell process | |

**Auto-selected:** Async-only.

---

## Architectural invariants (locked from first commit)

These weren't really "gray" — research and PROJECT.md already locked them — but recorded for the audit trail:

- No `Gtk` / `Adw` in Shell-process code (allowed only in Phase 2's `prefs.js`)
- No `/sys`, `Gio.Subprocess`, `GLib.spawn_*`, or `fs` access
- No bundled binaries in the extension zip
- All USB data flows through `org.usbeehive.Devices1`

---

## Claude's Discretion

- Icon source (theme icon `network-usb-symbolic` vs bundled `usb-symbolic.svg`) — defer to planner / `/gsd-ui-phase 1`
- JSDoc `@ts-check` typing strategy — fine either way for v0.1
- Whether to ship an empty `usbee.gschema.xml` in Phase 1 even though keys land in Phase 2 — lean yes, leave the call to the executor

---

## Deferred Ideas

See `01-CONTEXT.md` `<deferred>` section. Highlights:
- Everything `prefs.js` / GSettings-population / notifications → Phase 2
- COPYING + README + EGO-pack zip → Phase 2
- Clipboard-copy diagnostic, PDO ladder, trust glyph, notification coalescing, per-port history graph → v1.x or v2
- Upstream-`usbeehive` work: atomic `DevicesChanged` signal, per-port wattage `PropertiesChanged`, stable port identifier
