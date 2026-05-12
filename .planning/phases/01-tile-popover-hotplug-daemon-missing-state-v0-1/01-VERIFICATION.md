---
phase: 01-tile-popover-hotplug-daemon-missing-state-v0-1
verified: 2026-05-12T18:30:00Z
status: human_needed
score: 8/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "STATE-05 — Lifecycle Test Matrix (Tests 1, 3, 4, 5 + debounce burst + lock/unlock x3)"
    expected: |
      Test 1 (enable/disable x10): zero 'already disposed', 'has no handler', or 'leak' lines
      in journalctl. Test 3 (daemon stop/start): empty error log; tile auto-recovers on restart.
      Test 4 (disable-while-popover-open): popover closes cleanly, no warnings.
      Test 5 (combined stress): same as Test 1. Debounce burst: subtitle changes exactly ONCE
      after a 5-15 device dock-attach burst. Lock/unlock x3: tile correct after each unlock,
      no 'already disposed' warnings.
    why_human: "Requires a live gnome-shell session. Cannot execute enable/disable cycles,
      daemon stop/start, or lock/unlock sequences inside a worktree agent context.
      Plan 02 Task 4 was explicitly marked checkpoint:human-verify and deferred."
  - test: "ROADMAP SC-3 — Open-popover live update while open (LIVE-01, LIVE-02)"
    expected: "ROADMAP Success Criterion 3 says 'Plugging or unplugging a device updates
      both the tile subtitle and the OPEN POPOVER live, with no manual refresh required.'
      The implementation uses D-11 lazy-rebuild: the popover rebuilds on next open, NOT
      while currently open. Verify with the developer: is D-11 lazy-rebuild an accepted
      deviation from SC-3, or must store.connect('changed', rebuild) be added to the toggle?"
    why_human: "The plan deliberately narrowed LIVE-01/02 to 'while popover is closed'.
      REQUIREMENTS text says 'without user action' — closing and reopening IS a user action.
      This is a scope-narrowing deviation from ROADMAP SC-3 that requires developer acceptance."
  - test: "CR-01 — Double-fire of _onVanished() impact assessment"
    expected: "When the daemon disconnects, _onVanished() fires twice: once via bus_watch_name
      vanish callback and once via notify::g-name-owner. Each call does setDevices([]) and
      emits 'changed'/'lost'. In practice: tile subtitle double-repaints, 'lost' emits twice.
      Verify in a live session whether this causes visible flicker or observable duplicate
      notifications. If visible: apply the idempotency guard from CR-01 fix before sign-off."
    why_human: "Whether duplicate 'changed' emissions cause user-visible flicker requires
      live observation. The code reviewer flagged this as a BLOCKER in 01-REVIEW.md; the
      phase completion note says code-review findings are tracked separately. Needs developer
      decision on whether to fix before phase close."
---

# Phase 01: Tile, Popover, Hotplug, Daemon-Missing State Verification Report

**Phase Goal:** Users can glance at the GNOME Quick Settings tile to see USB-C charging state and the fastest attached link, open the popover to read a plain-English diagnostic per port and a live device list, watch the list update as they plug things in or out, and see a graceful empty state (that auto-recovers) when the `usbeehive` daemon is not running.
**Verified:** 2026-05-12T18:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

Truths are merged from ROADMAP.md Success Criteria (5) and Plan 01 + Plan 02 `must_haves.truths` (7 total across both plans). Where a plan truth clearly restates a roadmap SC, the roadmap SC is authoritative.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | With `usbeehive` running, USBee tile appears alongside Wi-Fi/BT/Sound; subtitle reflects USB-C charging direction + wattage (or fastest link speed, or "Nothing connected") and updates live without opening the popover | VERIFIED | `tile.js:41-43` wires `store.connect('changed', () => this.subtitle = store.subhead)`; `device-store.js:121-165` implements 4-tier D-09 `deriveSubtitle`; `dbus-client.js:151-198` subscribes `DeviceAdded`/`DeviceRemoved` with 150 ms debounce; UAT Test 4 confirmed live device list with 12 real devices |
| SC-2 | Opening the popover shows one row per device/port with friendly name, USB version + link speed, data + power role, live wattage, and plain-English diagnostic — including multi-line strings | VERIFIED (source-level) | `popover.js:76-105` `buildDeviceRow` renders `device.headline` + one `St.Label` per `device.bullets[]` with `clutter_text.line_wrap = true` + `line_wrap_mode = 2`; data for LIST-02..05 flows through daemon `bullets[]` (verbatim rendering); verified by UAT Test 4 (12 devices listed) |
| SC-3 | Plugging or unplugging updates the tile subtitle AND the open popover live, with no manual refresh required | UNCERTAIN | Tile subtitle: VERIFIED live via `store.connect('changed')`. Open-popover live update: implementation deliberately uses D-11 lazy-rebuild (popover rebuilds on next open, NOT while currently open). ROADMAP SC-3 explicitly says "open popover live" — this is a design deviation. See Human Verification item 2. |
| SC-4 | With `usbeehive` stopped: popover shows copyable `systemctl` hint; starting daemon repopulates tile within ~1s via `NameOwnerChanged`; stopping mid-session transitions cleanly to empty state | VERIFIED | UAT Tests 2, 3, 4, 5 all passed. `empty-state.js:15-59` provides copyable `St.Entry` with `systemctl --user enable --now usbeehive`; `dbus-client.js:98-106` wires `Gio.bus_watch_name` for auto-recovery; `_onVanished` flips store to empty state |
| SC-5 | Lock/unlock x3 and disable/enable x10 produce no duplicate tiles, no "already disposed" warnings, no leaked handlers in journalctl | UNCERTAIN | Code structure is correct: `SignalRegistry.dispose()` tracks all handlers. UAT Test 6 (clean disable) passed. However Plan 02 Task 4 (full lifecycle test matrix: Tests 1/3/4/5 + lock/unlock x3) was explicitly deferred as `checkpoint:human-verify`. CR-01 (double-fire of `_onVanished`) could produce duplicate 'changed' emissions during daemon stop. See Human Verification items 1 and 3. |
| P01-T3 | Tile displays a symbolic USB icon and title `USBee` (TILE-02) | VERIFIED | `tile.js:22-24` sets `title: 'USBee'`, `iconName: 'network-usb-symbolic'`; `metadata.json` declares `"uuid": "usbee@bitcreed.us"`; UAT Test 2 confirmed visual appearance |
| P01-T4 | `metadata.json` declares `shell-version ["46","47","48"]`, stable UUID, no binary version field (PACK-04) | VERIFIED | `metadata.json` confirmed: `"shell-version": ["46","47","48"]`, `"uuid": "usbee@bitcreed.us"`, no `"version"` field |
| P01-T5 | Extension honors architectural invariants: no `gi://Gtk`/`gi://Adw`, no sync D-Bus, no subprocess, no legacy `imports.*`, no `_addItems`, EGO-clean (PACK-05) | VERIFIED | All 5 grep gates pass (see Required Artifacts section). `addExternalIndicator` in exactly 1 file (`extension.js`). `gschemas.compiled` exists. |
| P02-T4 | Lifecycle test matrix passes: 10x enable/disable, daemon stop/start, disable-while-open, combined stress — zero `already disposed` / `has no handler` warnings (STATE-05) | UNCERTAIN | Not yet executed — requires live gnome-shell session. See Human Verification item 1. |
| P02-T3 | Debounce coalesces N signals within 150 ms to exactly 1 snapshot and 1 tile repaint (D-10) | VERIFIED (source-level) | `dbus-client.js:183-198` implements single shared `_debounceId` reset-on-arrival debounce via `GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, ...)`. Wiring is correct. Runtime burst test deferred to human verification (Plan 02 Task 4). |

**Score: 8/10 truths verified** (2 UNCERTAIN → human_needed)

---

### Deferred Items

No items addressed in later milestone phases. The lazy-popover-update deviation (SC-3/LIVE-01/LIVE-02) and the STATE-05 lifecycle matrix are both Phase 1 items that require human verification rather than later-phase work.

---

### Required Artifacts

All 11 expected artifacts exist with substantive content and correct wiring.

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `usbee@bitcreed.us/metadata.json` | EGO metadata, uuid + shell-version | VERIFIED | `uuid: usbee@bitcreed.us`, `shell-version: ["46","47","48"]`, `gettext-domain`, `settings-schema` — valid JSON, no `version` field |
| `usbee@bitcreed.us/extension.js` | ESM Extension subclass; sole `addExternalIndicator` owner | VERIFIED | Default-export `USBeeExtension extends Extension`; `addExternalIndicator` in 1 file only; `enable()`/`disable()` lifecycle correct |
| `usbee@bitcreed.us/dbus-iface.xml` | org.usbeehive.Devices1 introspection XML | VERIFIED | Well-formed XML (`xmllint --noout` passes); `interface name="org.usbeehive.Devices1"` present; includes `DeviceAdded`, `DeviceRemoved`, `CapabilityDegraded` signals |
| `usbee@bitcreed.us/src/signal-registry.js` | SignalRegistry with addSignal/addProxySignal/addBusWatch/addTimeout/dispose | VERIFIED | All 5 methods implemented; `dispose()` is idempotent (`_disposed` guard); best-effort teardown with `logError` fallback |
| `usbee@bitcreed.us/src/dbus-client.js` | DBusClient: bus watch + lazy proxy + DeviceAdded/Removed + 150ms debounce | VERIFIED | `Gio.bus_watch_name` registered; `UsbeehiveProxy` via `makeProxyWrapper`; `connectSignal('DeviceAdded'/'DeviceRemoved')` tracked via `addProxySignal`; `_scheduleRefresh()` with `GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, ...)`; `addTimeout` tracked; no sync D-Bus; no `CapabilityDegraded` (Phase 2) |
| `usbee@bitcreed.us/src/device-store.js` | DeviceStore: 4-tier D-09 `deriveSubtitle` + 4 helpers + `'changed'` signal | VERIFIED | `deriveSubtitle` exported; `parseWatts`/`parseDirection`/`parseLinkSpeed`/`formatWatts` present; all Tier 1-4 literal strings present; U+00B7 middle dot confirmed; `GObject.registerClass` with `Signals: {'changed': {}}` |
| `usbee@bitcreed.us/src/tile.js` | USBeeIndicator + USBeeToggle wired to store | VERIFIED | `store.connect('changed', () => this.subtitle = store.subhead)` present; `open-state-changed` wired to `_rebuildPopover`; `addExternalIndicator` NOT in this file (D-16) |
| `usbee@bitcreed.us/src/popover.js` | `populateDeviceRows`/`populateEmptyState` with multi-bullet + line_wrap | VERIFIED | `buildDeviceRow` iterates `device.bullets[]`; `clutter_text.line_wrap = true`; `line_wrap_mode = 2`; `section.removeAll()` as first statement; no `set_markup`; no `gi://Gtk`/`gi://Adw` |
| `usbee@bitcreed.us/src/empty-state.js` | `buildEmptyStateItem()` with selectable `St.Entry` | VERIFIED | Title `'usbeehive daemon not running'`; hint `'Run this command…'`; `SYSTEMCTL_CMD` constant; `entry.clutter_text.editable = false; selectable = true` |
| `usbee@bitcreed.us/schemas/org.gnome.usbee.gschema.xml` | GSettings schema scaffold | VERIFIED | XML present; `schema id="org.gnome.usbee"`; Phase 2 keys noted as comments |
| `usbee@bitcreed.us/schemas/gschemas.compiled` | Compiled schema binary | VERIFIED | File exists (204 bytes) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `extension.js enable()` | `Main.panel.statusArea.quickSettings.addExternalIndicator` | `import * as Main` | WIRED | `extension.js:29` — D-16 sole mount site confirmed |
| `src/dbus-client.js start()` | `Gio.bus_watch_name` on session bus for `org.usbeehive.Devices` | `Gio.bus_watch_name(Gio.BusType.SESSION, BUS_NAME, ...)` | WIRED | `dbus-client.js:98-105`; watchId tracked via `_registry.addBusWatch` |
| `src/dbus-client.js _onAppeared()` | `UsbeehiveProxy` constructor via `makeProxyWrapper` | `new UsbeehiveProxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH, callback)` | WIRED | `dbus-client.js:123-163`; async callback-style, non-blocking |
| `src/dbus-client.js _onAppeared()` | `proxy.connectSignal('DeviceAdded'/'DeviceRemoved')` | `_registry.addProxySignal(proxy, id)` | WIRED | `dbus-client.js:151-157`; both signals trigger `_scheduleRefresh()` |
| `src/dbus-client.js _scheduleRefresh()` | `_snapshotImmediate()` after 150ms | `GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, ...)` tracked by `addTimeout` | WIRED | `dbus-client.js:191-198` |
| `src/dbus-client.js _snapshotImmediate()` | `store.setDevices(entries)` | `ListDevicesRemote` async callback → `this._store.setDevices(entries)` | WIRED | `dbus-client.js:214-221` |
| `src/tile.js USBeeToggle` | `store.subhead` → `this.subtitle` | `store.connect('changed', () => { this.subtitle = store.subhead })` | WIRED | `tile.js:41-43`; initial value also set at `tile.js:56` |
| `src/tile.js USBeeToggle` | `populateDeviceRows`/`populateEmptyState` | `open-state-changed` → `_rebuildPopover()` | WIRED | `tile.js:47-51, 63-68` |
| `src/device-store.js subhead getter` | `deriveSubtitle(this._devices)` | pure function call | WIRED | `device-store.js:184-186`; returns `'Daemon not running'` guard before delegation |
| `src/popover.js buildDeviceRow()` | `St.Label` per bullet with `clutter_text.line_wrap` | iterate `device.bullets`, create `St.Label`, set `line_wrap = true` | WIRED | `popover.js:96-101` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `tile.js` subtitle | `store.subhead` | `device-store.js deriveSubtitle(this._devices)` which reads from `store.setDevices(entries)` ← `ListDevicesRemote` → real D-Bus call | Yes (UAT Test 4 confirmed 12 real devices) | FLOWING |
| `popover.js buildDeviceRow()` | `device.headline`, `device.bullets[]` | `store._devices` array ← `unpackDeviceEntry(tuple)` ← daemon D-Bus response | Yes (daemon-sourced) | FLOWING |
| `empty-state.js buildEmptyStateItem()` | `SYSTEMCTL_CMD` constant | Static string — correct behavior; not a stub | N/A (intentional constant) | FLOWING |
| `tile.js _rebuildPopover()` | `store.daemonRunning` | `_store.setDaemonRunning(running)` ← `_onAppeared`/`_onVanished` | Yes (driven by `bus_watch_name`) | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED for interactive GNOME Shell extension components. The extension requires a live `gnome-shell` process — no headless entry point exists. Static analysis confirmed all data paths are wired; runtime behavior is delegated to human verification items 1-3.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TILE-01 | Plan 01 | USBee tile appears alongside Wi-Fi/BT/Sound | SATISFIED | UAT Test 2 passed; `extension.js:29` mounts via `addExternalIndicator` |
| TILE-02 | Plan 01 | Symbolic USB icon + one-line title | SATISFIED | `tile.js:22-24` sets `title: 'USBee'`, `iconName: 'network-usb-symbolic'`; UAT Test 2 confirmed |
| TILE-03 | Plan 02 | Live subtitle: USB-C charging/link speed/count | SATISFIED (source-level) | `deriveSubtitle` 4-tier algorithm verified; subtitle wired to `store.changed`; runtime accuracy needs live daemon |
| TILE-04 | Plan 02 | Subtitle updates live without popover open | SATISFIED (source-level) | `DeviceAdded`/`DeviceRemoved` → debounce → `_snapshotImmediate` → `store.changed` → subtitle update |
| LIST-01 | Plan 02 | Popover shows one row per device/port | SATISFIED (source-level) | `populateDeviceRows` iterates `store.devices`; UAT Test 4 confirmed 12 rows rendered |
| LIST-02 | Plan 02 | Friendly vendor + product name per row | SATISFIED (source-level) | `buildDeviceRow` uses `device.headline` (daemon-provided vendor+product name) verbatim |
| LIST-03 | Plan 02 | Negotiated USB version + link speed per row | SATISFIED (source-level) | Rendered as `device.bullets[]` entry verbatim from daemon |
| LIST-04 | Plan 02 | Data role + power role per USB-C port row | SATISFIED (source-level) | In `device.bullets[]`; rendered verbatim |
| LIST-05 | Plan 02 | Live wattage when UCSI exposes it | SATISFIED (source-level) | In `device.bullets[]`; rendered verbatim; `deriveSubtitle` parses for Tier 1 headline |
| LIST-06 | Plan 02 | Rows reflect current snapshot on every open | SATISFIED | `open-state-changed` triggers `_rebuildPopover()` → `populateDeviceRows(section, this._store)` reads current state |
| DIAG-01 | Plan 02 | Plain-English diagnostic string per USB-C port | SATISFIED (source-level) | In `device.bullets[]`; rendered verbatim via `St.Label({text: bullet})` — no markup parsing |
| DIAG-02 | Plan 02 | Multi-line/multi-sentence diagnostics render correctly | SATISFIED (source-level) | `clutter_text.line_wrap = true; line_wrap_mode = 2` (Pango WORD_CHAR) on every `St.Label` |
| LIVE-01 | Plan 02 | Popover device list updates when `DeviceAdded` fires | NEEDS HUMAN | Tile subtitle: VERIFIED live. Open-popover: uses D-11 lazy-rebuild (updates on next open). Deviates from ROADMAP SC-3 "open popover live" wording. See Human Verification item 2. |
| LIVE-02 | Plan 02 | Popover device list updates when `DeviceRemoved` fires | NEEDS HUMAN | Same as LIVE-01 — design decision to use lazy-rebuild rather than live-while-open. |
| LIVE-03 | Plan 02 | Tile subtitle re-derives on every relevant signal | SATISFIED | `store.connect('changed') → this.subtitle = store.subhead`; signal path fully wired |
| STATE-01 | Plan 01 | Graceful empty state with `systemctl` hint when daemon absent | SATISFIED | UAT Tests 2 and 3 passed; empty-state content verified against UI-SPEC strings |
| STATE-02 | Plan 01 | Auto-recover when daemon appears via `NameOwnerChanged` | SATISFIED | UAT Test 4 passed; `bus_watch_name` → `_onAppeared` path verified |
| STATE-03 | Plan 01 | Clean transition back to empty state when daemon disappears | SATISFIED | UAT Test 5 passed; `_onVanished` clears store + emits `'lost'` |
| STATE-05 | Plan 02 | Clean disable across lifecycle matrix Tests 1/3/4/5 + lock/unlock | NEEDS HUMAN | Plan 02 Task 4 explicitly deferred to human verification. CR-01 (double-fire) is an open code-review BLOCKER that could cause duplicate 'changed' emissions. See Human Verification items 1 and 3. |
| PACK-04 | Plan 01 | `metadata.json` shell-version `["46","47","48"]`, stable UUID | SATISFIED | Verified: correct shell-version, `uuid: usbee@bitcreed.us`, no `version` field |
| PACK-05 | Plan 01 | No bundled binaries, no Gtk/Adw in Shell process, no sync D-Bus | SATISFIED | All 5 grep invariant gates pass (no `gi://Gtk`, no `gi://Adw`, no `_sync(`, no `call_sync`, no `Gio.Subprocess`, no legacy `imports.*`, no `_addItems`) |

**21/21 requirements claimed by phase.** 18 SATISFIED, 2 NEEDS HUMAN (LIVE-01, LIVE-02), 1 NEEDS HUMAN (STATE-05).

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/dbus-client.js` | 103, 138-142 | `_onVanished()` registered in two places: `bus_watch_name` vanish callback AND `notify::g-name-owner` handler (CR-01 from 01-REVIEW.md) | WARNING | Both fire when daemon disconnects → `setDevices([])` + `'changed'` + `'lost'` emit twice → potential double-repaint; not a crash but a correctness issue. Fix: add `if (!this._store.daemonRunning) return;` guard at start of `_onVanished()`. |
| `src/dbus-client.js` | 183-198 | Timer registry leak: `_scheduleRefresh` appends a new `addTimeout` entry per call but never removes the entry for timers that have already fired naturally (WR-01 from 01-REVIEW.md) | WARNING | On `disable()`, `SignalRegistry.dispose()` calls `GLib.Source.remove(id)` on stale IDs → `GLib-CRITICAL: Source ID N was not found` in stderr. Registry array grows unboundedly over lifetime. |
| All `.js` source | Various | No user-visible string wrapped in `gettext/_()` (WR-02 from 01-REVIEW.md) | INFO | Violates `CLAUDE.md` "every user-visible string must go through gettext" constraint. However, PACK-02 (gettext scaffolding) is a Phase 2 requirement — absence of gettext markers in Phase 1 is explicitly expected per ROADMAP (Phase 2 "gettext scaffolding"). Tracked as deferred to Phase 2. |
| `src/tile.js` | 23 | `subtitle: 'Starting…'` in constructor immediately overwritten by `this.subtitle = store.subhead` at line 56 (IN-02 from 01-REVIEW.md) | INFO | Dead code; user never sees 'Starting…'. Cosmetic only — no behavioral impact. |
| `src/popover.js` | 85 | `style_class` passed in `PopupMenuItem` constructor params (WR-04 from 01-REVIEW.md) | INFO | `style_class` is not in documented `PopupMenu.PopupMenuItem` params; works via `St.BoxLayout` pass-through which is an implementation detail. EGO reviewers may flag. Safer: `item.add_style_class_name('usbee-device-row')` after construction. |
| `src/popover.js` | 100 | `line_wrap_mode = 2` (magic number for `Pango.WrapMode.WORD_CHAR`) (IN-01 from 01-REVIEW.md) | INFO | If Pango enum shifts this silently changes wrapping mode. Fix: `import Pango from 'gi://Pango'; lbl.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR`. |

**CR-01 and WR-01 are code-review findings noted here per the instructions; they are tracked in `01-REVIEW.md`. The instructions specify these do not block phase completion if goal-backward criteria are otherwise met.**

---

### Human Verification Required

#### 1. STATE-05 — Full Lifecycle Test Matrix

**Test:** Run RESEARCH.md §Lifecycle Test Matrix Tests 1, 3, 4, and 5 in a live GNOME Shell session:
- Test 1: `for i in $(seq 1 10); do gnome-extensions enable usbee@bitcreed.us; sleep 0.5; gnome-extensions disable usbee@bitcreed.us; sleep 0.5; done` — then `journalctl --user` grep for `already disposed | has no handler | leak`.
- Test 3: Enable → open popover (verify live data) → `kill -9 usbeehived` → verify empty state → restart daemon → verify auto-recovery.
- Test 4: Enable → open popover → `gnome-extensions disable usbee@bitcreed.us` → verify popover closes cleanly with no warnings.
- Test 5: Combined stress (5 cycles of enable + daemon pause/resume + disable in rapid succession).
- Debounce burst: Attach a USB dock with 5+ devices; verify subtitle changes exactly ONCE after the burst.
- Lock/unlock x3 (manual): `loginctl lock-session`, unlock, verify tile correct, repeat 3 times.

**Expected:** All log files empty (zero `already disposed`, `has no handler`, `leak` lines). Debounce burst: exactly 1 subtitle repaint per dock-attach event.

**Why human:** Requires live gnome-shell session with interactive enable/disable cycles, daemon process control, screen lock/unlock. Cannot be automated in an agent worktree context. Plan 02 Task 4 was explicitly deferred as `checkpoint:human-verify`.

---

#### 2. LIVE-01 / LIVE-02 — Live-while-open popover deviation from ROADMAP SC-3

**Test:** With the extension enabled and daemon running:
1. Open the USBee popover.
2. While the popover is open, plug or unplug a USB device.
3. Observe whether the popover device list updates immediately (without closing and reopening).

**Expected per ROADMAP SC-3:** "Plugging or unplugging a device updates both the tile subtitle and the open popover live, with no manual refresh required."

**Actual implementation:** The popover uses D-11 lazy-rebuild — it updates only on the NEXT open (`open-state-changed`), not while currently open. The tile subtitle DOES update live.

**Why human:** Developer must decide whether D-11 lazy-rebuild is an accepted deviation from ROADMAP SC-3 "open popover live" wording, or whether `store.connect('changed', () => this._rebuildPopover())` must be added to `USBeeToggle`. If accepted: update REQUIREMENTS.md LIVE-01/02 descriptions to match the implemented behavior. If not accepted: add a `store.connect('changed', ...)` listener inside `USBeeToggle` guarded by `this.menu.isOpen` to live-rebuild when open.

---

#### 3. CR-01 — _onVanished double-fire visual impact

**Test:** Enable the extension with the daemon running. Kill the daemon. Observe:
1. Does the tile subtitle flash or repaint twice visibly?
2. Does `journalctl --user` show duplicate `'changed'` or `'lost'` signal emissions?

**Expected:** Per `01-REVIEW.md` CR-01, `_onVanished()` fires twice when the daemon disconnects (once via `bus_watch_name` vanish callback at `dbus-client.js:103`, once via `notify::g-name-owner` at `dbus-client.js:140-142`). `setDaemonRunning(false)` is self-guarded but `setDevices([])` and `this.emit('lost')` run twice.

**Why human:** Whether duplicate firings cause visible user-facing flicker requires live observation. The review flagged CR-01 as a BLOCKER. If double-repaint is visually noticeable, apply the idempotency fix before phase sign-off:
```js
_onVanished() {
    if (!this._store.daemonRunning) return; // already vanished
    this._store.setDaemonRunning(false);
    this._store.setDevices([]);
    this.emit('lost');
}
```

---

### Gaps Summary

No BLOCKERS from goal-backward verification — all required source artifacts exist, are substantive, and are wired. The three human verification items are the remaining gate:

1. **STATE-05 lifecycle matrix** was deferred by the executing agent as `checkpoint:human-verify` (Plan 02 Task 4). This is the most significant remaining item — it must pass before Phase 1 can be declared complete.

2. **LIVE-01/LIVE-02 popover-while-open** is a deliberate design deviation (D-11 lazy-rebuild) that contradicts ROADMAP SC-3 wording. The developer must either accept the deviation (and update REQUIREMENTS.md) or implement live-while-open rebuild.

3. **CR-01 double-vanish** is a known code-review BLOCKER. The fix is a 2-line guard. While the phase instructions say code-review findings are "tracked separately," its potential for user-visible duplicate tile repaints makes it worth assessing before sign-off.

Additionally, the UAT (`01-UAT.md`) surfaced 4 open gaps deferred to Plan 02:
- Diagnose D-Bus method signature mismatch `(ssssb)` vs actual `(bsssb)` (minor — DIAG-01/02 not yet called in Phase 1)
- Tile subtitle string truncation (`Daemon not running` → `Daemon not r…`) — copywriting fix for Plan 02
- Empty-state popover vertical overflow — spacing fix for Plan 02
- Tile `checked` state not bound to `store.daemonRunning` — feature gap for Plan 02

These UAT gaps do not block the phase goal (walking skeleton + hotplug + empty state works) but should be addressed in Plan 02.

---

_Verified: 2026-05-12T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
