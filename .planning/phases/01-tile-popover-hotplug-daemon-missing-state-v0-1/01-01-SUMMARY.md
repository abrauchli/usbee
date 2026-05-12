---
phase: 01-tile-popover-hotplug-daemon-missing-state-v0-1
plan: 01
subsystem: gnome-shell-extension
tags:
  - gnome-shell
  - extension
  - gjs
  - d-bus
  - quick-settings
  - walking-skeleton
dependency_graph:
  requires: []
  provides:
    - extension-skeleton
    - dbus-client-singleton
    - device-store-with-changed-signal
    - signal-registry-lifecycle
    - empty-state-widget
    - popover-render-stubs
    - tile-toggle-indicator
  affects:
    - "Plan 02 will replace device-store.subhead getter body, populateDeviceRows body, and add signal subscriptions + 150ms debounce inside DBusClient._onAppeared"
tech_stack:
  added:
    - "GJS (SpiderMonkey) ESM modules (gi:// + resource:///)"
    - "Gio.DBusProxy.makeProxyWrapper for org.usbeehive.Devices1"
    - "Gio.bus_watch_name on org.usbeehive.Devices (session bus)"
    - "QuickSettings.SystemIndicator + QuickSettings.QuickMenuToggle (GNOME 46+)"
    - "PopupMenu.PopupMenuSection lazy populate on open-state-changed"
    - "Empty GSettings schema scaffold org.gnome.usbee"
  patterns:
    - "SignalRegistry hygiene pattern — every connect/connectSignal/bus_watch_name/timeout_add tracked, dispose() reverses in best-effort order with logError fallback"
    - "Single connectivity authority (DBusClient owns bus_watch_name + proxy)"
    - "Lazy popover repopulation (Pattern 2 from RESEARCH.md)"
    - "Headline derivation in the store (only the body changes in Plan 02)"
    - "Indicator ownership confined to extension.js (D-16)"
key_files:
  created:
    - usbee@bitcreed.us/metadata.json
    - usbee@bitcreed.us/extension.js
    - usbee@bitcreed.us/dbus-iface.xml
    - usbee@bitcreed.us/stylesheet.css
    - usbee@bitcreed.us/src/signal-registry.js
    - usbee@bitcreed.us/src/dbus-client.js
    - usbee@bitcreed.us/src/device-store.js
    - usbee@bitcreed.us/src/tile.js
    - usbee@bitcreed.us/src/popover.js
    - usbee@bitcreed.us/src/empty-state.js
    - usbee@bitcreed.us/schemas/org.gnome.usbee.gschema.xml
    - usbee@bitcreed.us/schemas/gschemas.compiled
    - usbee@bitcreed.us/icons/usb-symbolic.svg
  modified: []
decisions:
  - "D-Bus wire names: BUS_NAME='org.usbeehive.Devices', OBJECT_PATH='/org/usbeehive/Devices', INTERFACE_NAME='org.usbeehive.Devices1' (CONTEXT.md's '…Devices1' for bus name was wrong; verified against ../usbeehive/src/dbus.rs:290-292)"
  - "IFACE_XML loading: Pattern 1 (inlined template literal in src/dbus-client.js, with dbus-iface.xml as on-disk diff target) — avoids async file load at enable() time"
  - "Daemon NOT running on dev machine and no pre-built binary; used RESEARCH.md §Introspection-XML Capture Option B (hand-written XML) — every member signature verified against ../usbeehive/src/dbus.rs"
  - "Plan 01 DBusClient subscribes to NO D-Bus signals (DeviceAdded/Removed); only bus_watch_name + notify::g-name-owner. Plan 02 Task 2 adds the signal subscriptions and 150ms debounce."
  - "Plan 01 DeviceStore.subhead is hardcoded (Daemon not running / Nothing connected / N devices); Plan 02 Task 1 replaces it with the 4-tier D-09 algorithm."
  - "Plan 01 populateDeviceRows renders headline-only rows; Plan 02 Task 3 replaces it with full LIST-01..06 + DIAG-01/02 multi-bullet rendering."
metrics:
  duration: "~30 minutes"
  completed: 2026-05-11
---

# Phase 1 Plan 01: Walking Skeleton Summary

End-to-end USBee Quick Settings tile that watches `org.usbeehive.Devices` and renders either a placeholder device list or the copyable `systemctl --user enable --now usbeehive` empty state. All CONTEXT.md D-01..D-19 architectural invariants are now load-bearing in code.

## What Was Built

Tasks 1-6 completed and committed atomically; Task 7 is a `checkpoint:human-verify` left open for the user (manual smoke test in a live `gnome-shell` session — cannot be executed by the agent).

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Project scaffold: `metadata.json`, empty GSettings schema (compiled), `usb-symbolic.svg` fallback, custom CSS, JS stubs | `1c6e8ae` |
| 2 | `dbus-iface.xml` (hand-written fallback path) | `1a8ce26` |
| 3 | `SignalRegistry` + `DeviceStore` + `DBusClient` (bus watch, lazy proxy, no signal subs yet) | `e5ccd86` |
| 4 | `empty-state.js` (selectable `St.Entry`) + `popover.js` render stubs | `cfb6f81` |
| 5 | `tile.js` — `USBeeToggle` + `USBeeIndicator`, wired to store + popover | `272bb5b` |
| 6 | `extension.js` — enable/disable lifecycle owner | `637e274` |

## Verification

All plan-level automated gates from `<verification>` PASSED:

- **Architectural invariants**: no `gi://Gtk` / `gi://Adw`, no `_sync(` / `.call_sync`, no `Gio.Subprocess` / `GLib.spawn_*`, no legacy `imports.*`, no `_addItems(`, no `readFileSync` / `require(` (D-15, D-17, D-18, D-19, PACK-05)
- **Wire-shape invariants**: `BUS_NAME='org.usbeehive.Devices'`, `OBJECT_PATH='/org/usbeehive/Devices'`, `INTERFACE_NAME='org.usbeehive.Devices1'` (no trailing 1 on bus name / object path — RESEARCH.md §Pitfall A)
- **UI-SPEC #copywriting strings verbatim**: `'USBee'`, `'USB devices'`, `'usbeehive daemon not running'`, `'Run this command, then this list will populate automatically:'`, `'systemctl --user enable --now usbeehive'`, `'No USB devices attached'`
- **metadata.json**: `"uuid": "usbee@bitcreed.us"`, `"shell-version": ["46", "47", "48"]`, no `"version":` field (PACK-04)
- **Schema**: `usbee@bitcreed.us/schemas/gschemas.compiled` exists
- **D-16 indicator ownership**: exactly one file (`extension.js`) contains `addExternalIndicator(`

## Deviations from Plan

### Plan-internal — fallback path used in Task 2

**[Plan-explicit alternative — Task 2 Step B]** The `usbeehive` daemon was not running on the dev machine and there was no pre-built `usbeehived` binary in `../usbeehive/target/release/`. Building it from source with `cargo build --release --no-default-features --features dbus` would have taken several minutes and was unnecessary because RESEARCH.md provides a hand-written fallback XML with every signature verified against `../usbeehive/src/dbus.rs:197-292`.

- **Action taken**: Used Task 2 Step B (transcribed XML from `01-RESEARCH.md` §Introspection-XML Capture Option B verbatim).
- **Drift risk**: zero (every member signature was already verified against `dbus.rs` during RESEARCH).
- **Plan 02 follow-up**: when the daemon is eventually running, capture a fresh XML with `busctl --user introspect org.usbeehive.Devices /org/usbeehive/Devices --xml-interface` and diff against the committed hand-written version. Any drift becomes a Plan 02 task or an upstream change request.

### Editorial — comment wording in `src/tile.js`

**[Rule 1 — Bug]** The Task 5 verification gate forbids the literal substring `addExternalIndicator(` anywhere in `src/tile.js` (enforces D-16: only `extension.js` mounts the indicator). The initial implementation included a documentation comment "// Per D-16: this file does NOT call addExternalIndicator" — which is correct conceptually but contains the forbidden substring (gate is grep-based, not lexer-based).

- **Fix**: Reworded the comment to "Per D-16: this file does NOT mount the indicator on the panel — extension.js owns the addExternal* / destroy lifecycle." (Removes the literal substring while preserving the intent.)
- **Files modified**: `usbee@bitcreed.us/src/tile.js` (single comment edit inside the same Task 5 commit `272bb5b`).
- **Lesson**: when a gate is a literal `grep`, comments are subject to the same constraint as code. Documented in-file alternatives use truncated identifiers or descriptive prose.

### No Rule 4 architectural deviations

Nothing in Plan 01 required structural changes beyond what was already prescribed.

## Plan 02 Carry-overs (key seams left in place)

These are the explicit extension points Plan 02 will mutate without changing the shape of any Plan-01 file:

1. **`src/device-store.js` — `subhead` getter body**
   - **Current**: hardcoded 4-state string (`Daemon not running` / `Nothing connected` / `1 device` / `{N} devices`).
   - **Plan 02 Task 1 swap-in**: full D-09 4-tier derivation (RESEARCH.md §Headline Derivation Algorithm). The store's interface (getter signature, `'changed'` signal, mutators) does not change.

2. **`src/dbus-client.js` — inside `_onAppeared`, after proxy construction**
   - **Current**: only `notify::g-name-owner` subscription + initial `_snapshotImmediate()`.
   - **Plan 02 Task 2 add-in**: `proxy.connectSignal('DeviceAdded', ...)` + `proxy.connectSignal('DeviceRemoved', ...)` + a 150 ms trailing-edge `GLib.timeout_add` debounce (D-10) coalescing onto `_snapshotImmediate()`. Use `registry.addProxySignal(proxy, id)` (not `addSignal` — RESEARCH.md §Pitfall E) and `registry.addTimeout(...)` for the debounce source.
   - **Seam location**: see the comment block `// Plan 02 Task 2 will additionally: …` at lines 138-141 of `src/dbus-client.js`.

3. **`src/popover.js` — `populateDeviceRows` body**
   - **Current**: one `PopupMenu.PopupMenuItem(device.headline || device.id)` per device.
   - **Plan 02 Task 3 swap-in**: full LIST-01..06 + DIAG-01/02 renderer using `PopupMenu.PopupMenuItem({reactive: false, can_focus: false, style_class: 'usbee-device-row'})` + nested `St.BoxLayout({vertical: true, x_expand: true})` + one `St.Label` per `device.bullets[i]` with `clutter_text.line_wrap = true; clutter_text.line_wrap_mode = 2;` per UI-SPEC #hierarchy. The function signature `populateDeviceRows(section, store)` stays the same; `populateEmptyState` is unchanged.

4. **`src/dbus-client.js` — IFACE_XML constant**
   - The template literal at lines ~32-69 is the source consumed by `Gio.DBusProxy.makeProxyWrapper`. `usbee@bitcreed.us/dbus-iface.xml` is the on-disk diff target. If the daemon's interface changes (Plan 02 adds notifications), update both in lockstep.

## Awaiting Human Verification

**Task 7 is a `checkpoint:human-verify` and CANNOT be self-executed by the agent.** It requires a live `gnome-shell` session: log out / log back in (Wayland) to load the symlinked extension, open Quick Settings, observe the tile, copy the empty-state command, etc.

### Setup the user must perform

```bash
# Symlink the extension into the user-extensions path:
ln -sf "$HOME/projects/rust/usbee/usbee@bitcreed.us" \
       "$HOME/.local/share/gnome-shell/extensions/usbee@bitcreed.us"

# Re-log Wayland (or Alt+F2 → 'r' under Xorg) so gnome-shell discovers it.
# Confirm:
gnome-extensions list | grep usbee
# Expected output: usbee@bitcreed.us

# Capture a journal baseline before enabling:
JOURNAL_SINCE=$(date --iso-8601=seconds)
```

### Verification A — daemon NOT running (STATE-01)

```bash
pgrep -f usbeehived && echo "Stop the daemon first (kill <pid>)" || echo "Daemon stopped — proceed"
gnome-extensions enable usbee@bitcreed.us
```

1. Open GNOME Quick Settings (Super+S or click the system menu).
2. **Expected**: a tile labelled `USBee` with subtitle `Daemon not running`.
3. Click the tile to open its popover.
4. **Expected**: header `USB devices`; one row with title `usbeehive daemon not running`, hint text `Run this command, then this list will populate automatically:`, and a focusable read-only text field with `systemctl --user enable --now usbeehive`.
5. Click into the text field, press Ctrl+A then Ctrl+C, paste elsewhere — clipboard must contain `systemctl --user enable --now usbeehive`.

### Verification B — daemon appears mid-session (STATE-02)

With the extension still enabled and daemon stopped:

```bash
cd "$HOME/projects/rust/usbeehive"
cargo run --release --no-default-features --features dbus --bin usbeehived &
DPID=$!
sleep 3
```

6. Re-open the popover.
7. **Expected**: tile subtitle changes from `Daemon not running` to `Nothing connected` (no USB devices) or `N devices` / `1 device`. Popover lists `No USB devices attached` or headline-only rows.
8. **Expected**: `journalctl --user --since "$JOURNAL_SINCE" /usr/bin/gnome-shell` shows no `already disposed` / `has no handler` / `JS ERROR.*usbee` lines.

### Verification C — daemon vanishes mid-session (STATE-03)

```bash
kill $DPID
wait $DPID 2>/dev/null
```

9. After ~1-2 s, re-open the popover.
10. **Expected**: tile subtitle reverts to `Daemon not running`; popover shows the empty-state row again.
11. **Expected**: no `usbee.*(error|warning|already disposed)` lines in the journal since `$JOURNAL_SINCE`.

### Verification D — clean disable

```bash
gnome-extensions disable usbee@bitcreed.us
```

12. **Expected**: tile disappears; Wi-Fi / Bluetooth / Sound remain.
13. **Expected**: journal shows no `already disposed` / `has no handler` entries.

### Known-issue fallbacks the user may need to apply

- **[ASSUMED A1]** If the empty-state command field is non-selectable or accepts typing, the `St.Entry.clutter_text.editable / .selectable` property assignment may not take effect on this Shell build. Open Looking Glass (Alt+F2 → `lg`), inspect the live entry. If property assignment failed, swap for setter methods in `src/empty-state.js`:
  ```javascript
  entry.clutter_text.set_editable(false);
  entry.clutter_text.set_selectable(true);
  ```
  Reload (re-disable + re-enable the extension) and re-test.

- **[Pitfall D — defensive GetNameOwner]** If Verification B does NOT auto-recover even when `busctl --user list | grep org.usbeehive` shows the daemon owning the name, `Gio.bus_watch_name` may not be firing `name-appeared` for an already-owned name on this Shell build. Add a defensive `Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetNameOwner', ...)` at the top of `DBusClient.start()` to manually probe and call `_onAppeared` if the daemon is already up.

- **[Pitfall A regression]** If Verification B does not auto-recover at all, double-check `src/dbus-client.js`: `BUS_NAME` and `OBJECT_PATH` must NOT have a trailing `1`. The `1` lives only on the interface name.

### Resume signal

When all of A–D pass, the user should respond with `approved`. If any step fails, describe the failure verbatim and which Pitfall fallback was applied (if any).

## Self-Check: PASSED

- All 13 expected files exist (verified via `[ -f ... ]`).
- All 6 task commits exist (verified via `git log --oneline`): `1c6e8ae`, `1a8ce26`, `e5ccd86`, `cfb6f81`, `272bb5b`, `637e274`.
- All plan-level grep gates pass (verified by running every `grep` line from `<verification>`).
- `metadata.json` is valid JSON (verified via `python3 -c "import json; json.load(...)"`).
- `dbus-iface.xml` is well-formed XML (verified via `xmllint --noout`).
- `gschemas.compiled` exists (verified via `[ -f ... ]`).

## Known Stubs

These are intentional stubs that will be replaced in Plan 02 (documented in plan as Plan-01 minimal scope; not blocking Plan 01 completion):

- `src/device-store.js` `subhead` getter — hardcoded; Plan 02 Task 1 swaps in D-09 derivation.
- `src/popover.js` `populateDeviceRows` — headline-only rows; Plan 02 Task 3 implements full LIST-01..06 + DIAG-01/02.
- `src/dbus-client.js` `_onAppeared` — no `DeviceAdded` / `DeviceRemoved` subscriptions; no debounce; Plan 02 Task 2 adds both.

None of these stubs prevent Plan 01's goal (the Walking Skeleton). They are explicit hand-offs to Plan 02 and are referenced inline in code comments at the swap-in points.
