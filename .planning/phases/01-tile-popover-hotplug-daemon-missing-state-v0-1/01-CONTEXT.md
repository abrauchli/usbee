# Phase 1: Tile, Popover, Hotplug, Daemon-Missing State (v0.1) - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning
**Mode:** mvp
**Discussion mode:** --auto (single-pass, Claude auto-selected the recommended option for every gray area)

<domain>
## Phase Boundary

Deliver a load-bearing v0.1 of the USBee GNOME Shell extension that:
- Mounts a Quick Settings tile alongside Wi-Fi / Bluetooth / Sound
- Renders a live tile subtitle headline derived from the current device snapshot
- Opens to a popover that lists every attached USB device and USB-C port with vendor/product, USB version, link speed, data + power role, live wattage (when UCSI exposes it), and the daemon's plain-English diagnostic string
- Updates live on `DeviceAdded` / `DeviceRemoved` signals from `org.usbeehive.Devices1`
- Shows a graceful empty state when the daemon is not running and auto-recovers when it appears (`NameOwnerChanged`)
- Disables cleanly across screen-lock / unlock cycles with no leaks

In scope: TILE-01..04, LIST-01..06, DIAG-01..02, LIVE-01..03, STATE-01..03, STATE-05, PACK-04, PACK-05 (21 v1 requirements).

Out of scope (handled in Phase 2): NOTIF-*, PREFS-*, STATE-04 (lock-screen prefs hiding — there's no prefs window until Phase 2), PACK-01 / PACK-02 / PACK-03 / PACK-06 (final EGO submission polish).

Out of scope (handled elsewhere): anything that would touch `/sys`, udev, polkit, or root; CLI / standalone window / daemon configuration; re-implementing USB-PD logic.

</domain>

<decisions>
## Implementation Decisions

### Project scaffold

- **D-01:** Hand-roll the extension file layout to match ARCHITECTURE.md exactly, rather than starting from `gnome-extensions create --template=quick-settings`. Rationale: the template generates legacy `imports.*` patterns and our research already pins the ES-module GNOME 45+ layout. Target file layout for Phase 1:
  ```
  extension.js          # ESM default-exported Extension subclass
  metadata.json         # uuid: usbee@bitcreed.us; shell-version ["46","47","48"]
  dbus-iface.xml        # captured from live `busctl --user introspect`
  src/dbus-client.js    # makeProxyWrapper + bus_watch_name singleton
  src/device-store.js   # client-side device cache + headline derivation
  src/tile.js           # QuickSettings.QuickMenuToggle subclass
  src/popover.js        # PopupMenuSection rebuild on open-state-changed
  src/empty-state.js    # daemon-not-running UI fragment
  schemas/              # empty in Phase 1, populated in Phase 2
  stylesheet.css        # minimal — rely on Shell theming
  icons/usb-symbolic.svg
  COPYING               # GPL-3.0 (added in Phase 2 per PACK-01)
  README.md             # added in Phase 2 per PACK-06
  ```
- **D-02:** Extension UUID is `usbee@bitcreed.us` (matches the user's email domain — `andy@bitcreed.us`). This is what gets uploaded to EGO and what `gnome-extensions` uses as the install key.
- **D-03:** `metadata.json` declares `shell-version: ["46", "47", "48"]`. GNOME 46 is the dev baseline (Ubuntu 24.04 LTS); 47 and 48 must be smoke-tested before final EGO submission (Phase 2 task), but the modern Quick Settings API is stable across all three.

### D-Bus integration

- **D-04:** Capture the live `org.usbeehive.Devices1` introspection XML *at the start of Phase 1* from a running `usbeehive` daemon:
  ```bash
  busctl --user introspect org.usbeehive.Devices1 /org/usbeehive/Devices1 --xml-interface > dbus-iface.xml
  ```
  Check the resulting `dbus-iface.xml` into the repo and load it as a string at extension init time. Rationale: future-proofs the proxy against drift in upstream signatures; one source of truth versus an inline JS string literal that's hard to diff against the daemon.
- **D-05:** Use `Gio.DBusProxy.makeProxyWrapper(xml)` to generate the proxy class. Construct the proxy asynchronously inside the `Gio.bus_watch_name` "name-appeared" callback — *not* eagerly at `enable()` time. This makes "daemon not running" the natural startup state rather than an error path.
- **D-06:** Subscribe to `DeviceAdded` / `DeviceRemoved` signals for the *whole extension lifetime* — not only while the popover is open. The tile subtitle needs them for live headline derivation (LIVE-03).
- **D-07:** Wire `notify::g-name-owner` on the proxy to handle the daemon-disappears-mid-session case (STATE-03). Do NOT recreate the proxy on disappearance — clear the cache and wait for the name to reappear.

### Device snapshot & headline derivation

- **D-08:** **Full re-snapshot strategy.** On every relevant signal (`DeviceAdded`, `DeviceRemoved`, initial `name-appeared`), call `ListDevices` (or `SnapshotJson` if that's the cheaper round-trip — confirm during planning) and replace the client-side device list in `device-store.js` wholesale. Do not maintain incremental per-device patches. Rationale: eliminates a whole class of desync bugs (`DeviceAdded` arriving before `ListDevices` settles, etc.); measurably-slow only with hundreds of devices, which is unrealistic; can be optimized later if profiling demands.
- **D-09:** Tile subtitle priority order (LIVE-03), evaluated in this order — first match wins:
  1. **Active USB-C charging port** → `"Charging: 65 W in"` / `"Powering: 15 W out"` (direction + wattage from UCSI; charging vs powering picked from power-role)
  2. **Fastest attached non-charging link** → `"USB 3.2 · 10 Gb/s"` (USB version + negotiated speed from fastest device)
  3. **Devices attached but no link-speed data** → `"{N} devices"`
  4. **Nothing attached** → `"Nothing connected"`
- **D-10:** **Hotplug debounce** — coalesce signal-driven UI re-renders behind a 150 ms trailing-edge debounce (one `GLib.timeout_add` source, refresh-on-each-signal, replace-on-each-signal). Subscribe to signals immediately; defer the actual `device-store` re-snapshot + tile/popover repaint by 150 ms. Rationale: dock attach / Thunderbolt enumeration emits 5-15 signals in quick succession; un-debounced this paints the tile 15× and looks jittery. Per PITFALLS.md.

### Popover rendering

- **D-11:** Rebuild popover rows lazily on `menu.connect('open-state-changed', (_, open) => { if (open) populate(devices) })`. Use `PopupMenuSection.removeAll()` + re-append (same pattern as GNOME Shell's `backgroundApps.js`). Signal subscriptions stay live; only the UI cost is lazy.
- **D-12:** Diagnostic strings (DIAG-01, DIAG-02) come from the daemon's `Diagnose` output and are rendered verbatim. Multi-line strings use `St.Label` with `clutter_text.line_wrap = true`. USBee adds no diagnostic logic — if a string is wrong or missing, the fix goes upstream into `usbeehive`.

### Empty-state UX

- **D-13:** Daemon-not-running empty state shows a single `PopupMenu.PopupMenuItem` containing:
  - Title: `"usbeehive daemon not running"`
  - Body: a selectable `St.Entry` (read-only) pre-populated with `systemctl --user enable --now usbeehive` so the user can keyboard-copy without ambiguity
  - Help text: `"Start the daemon, then this list will populate automatically."`
  - **No button that runs commands.** EGO rejects extensions that spawn subprocesses; we keep this honest by making the user run it themselves.

### Lifecycle hygiene

- **D-14:** **Signal-registry pattern.** Every `signal_connect_id` / `bus_watch_name_id` / `GLib.timeout_add` source gets tracked in a per-instance `SignalRegistry` helper and torn down in `disable()`. No raw `proxy.connect()` calls floating around. Rationale: PITFALLS.md flagged this as the #1 source of "already disposed" warnings and EGO rejection.
- **D-15:** **Async-only D-Bus.** No synchronous `proxy.call_sync()` — every call is `proxy.call(...)` with a finish callback or `await` via a `Gio._promisify`'d wrapper. Synchronous D-Bus blocks the entire `gnome-shell` process.
- **D-16:** Only `extension.js` enables / disables the system indicator. Do NOT add the indicator from inside any submodule. Symmetry on enable/disable is the single hardest part of an EGO-clean extension.

### Architectural invariants (locked from Phase 1 first commit)

- **D-17:** No `Gtk.*` / `Adw.*` imports in any file that runs in the Shell process (`extension.js`, `src/*.js`). These are only allowed in `prefs.js`, which is added in Phase 2.
- **D-18:** No `/sys`, no `Gio.Subprocess`, no `GLib.spawn_*`, no `fs` I/O. All USB data flows through `org.usbeehive.Devices1`. (PACK-05)
- **D-19:** No bundled binaries of any kind in the extension zip. (PACK-05)

### Claude's Discretion

- Icon choice for `metadata.json` — start with the symbolic GNOME `network-usb-symbolic` if the icon theme provides it; otherwise add a minimal `icons/usb-symbolic.svg` following the GNOME symbolic-icon spec. Final visual polish belongs in `/gsd-ui-phase 1`.
- File-level JSDoc / `@ts-check` typing strategy. Stack research mentioned `@girs/*` typings; either inline `@ts-check` JSDoc or no typings at all is fine for v0.1 — defer the call to the planner.
- Whether to ship a `usbee.gschema.xml` empty-schema scaffold in Phase 1 even though the keys land in Phase 2. (Lean: yes, install the empty schema so `dconf-editor` shows `org.gnome.usbee` from day one — but executor may decide.)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` — Locked decisions: GPL-3.0, GNOME 46+, GSettings `org.gnome.usbee`, gettext-marked English-only, systemd `--user` daemon, pure D-Bus client architecture, no `/sys`, no companion binary
- `.planning/REQUIREMENTS.md` — All 34 v1 REQ-IDs with traceability table; phase 1 covers TILE-*, LIST-*, DIAG-*, LIVE-*, STATE-01..03/05, PACK-04, PACK-05
- `.planning/ROADMAP.md` — Phase 1 goal and 5 success criteria; phase 2 dependency map
- `USBEE.md` — Original idea doc with the user's answered open questions (notably: "if we can do everything in a gnome-shell extension that's probably for the best")

### Research outputs (all required reading for the planner)
- `.planning/research/SUMMARY.md` — Executive summary; flags the 4 Phase-1 open questions as validation items
- `.planning/research/STACK.md` — Pure-GJS verdict, exact API surface (`QuickSettings.SystemIndicator`, `QuickSettings.QuickMenuToggle`, `addExternalIndicator`, `Gio.DBusProxy.makeProxyWrapper`, `Gio.bus_watch_name`, `MessageTray.Source`), GNOME 45+ ESM import rules, version compatibility
- `.planning/research/FEATURES.md` — Table-stakes vs differentiators vs anti-features; explicit MVP definition for v1; competitor matrix
- `.planning/research/ARCHITECTURE.md` — Component map (`DBusClient` / `DeviceStore` / `Notifier` trio), file layout, 4 patterns (D-Bus singleton, always-on/lazy-popover, GSettings as policy SoT, headline derivation in store), 4 data-flow diagrams, MVP build order
- `.planning/research/PITFALLS.md` — 10 critical pitfalls; the Dec-2025 EGO AI-code rule; signal-registry pattern; "push upstream to usbeehive" items

### Upstream daemon (sibling repo)
- `../usbeehive/src/dbus.rs` — Authoritative `org.usbeehive.Devices1` source. Read before capturing introspection XML
- `../usbeehive/README.md` — Daemon install / `systemctl --user` instructions (mirror these in USBee's daemon-not-running empty state)

### GNOME / EGO references (linked from STACK/PITFALLS, do not duplicate)
- gjs.guide Quick Settings, D-Bus, Notifications, Popup Menu, Translations, Preferences, ESM-port-to-45/46 guides — all linked from `STACK.md` and `PITFALLS.md`
- EGO Review Guidelines — linked from `PITFALLS.md`
- GNOME Shell extensions Dec-2025 AI-code rule — linked from `PITFALLS.md`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **None in this repo** — Phase 1 is greenfield. `USBEE.md` and the planning directory are the only existing files.
- **Sibling daemon at `../usbeehive`** — already implements the entire `org.usbeehive.Devices1` D-Bus interface used by this extension. No changes required for Phase 1; if Phase 1 surfaces a gap (e.g. missing field on a row), the fix goes upstream.

### Established Patterns
- **GNOME Shell Quick Settings canonical pattern** (from `STACK.md`): `SystemIndicator` subclass → contains `QuickMenuToggle` → has a `menu` of type `PopupMenu.PopupMenuSection` → mounted via `Main.panel.statusArea.quickSettings.addExternalIndicator(indicator)`. Follow this exactly.
- **`backgroundApps.js`-style dynamic-list popover** (from `ARCHITECTURE.md`): rebuild the `PopupMenuSection` on `open-state-changed`, not on every signal.
- **`SignalRegistry` lifecycle pattern** (from `PITFALLS.md`): track every `id` from `connect` / `bus_watch_name` / `timeout_add`, disconnect/unwatch/remove on `disable`. This is the load-bearing hygiene rule.

### Integration Points
- **Session-bus D-Bus name `org.usbeehive.Devices1`** at path `/org/usbeehive/Devices1` (verify exact path during XML introspection capture).
- **GNOME Shell's `Main.panel.statusArea.quickSettings`** — the only legal entry point for tile registration.
- **`Main.sessionMode.allowSettings`** — read for STATE-04 in Phase 2; not needed in Phase 1 (there's no prefs entry yet).

</code_context>

<specifics>
## Specific Ideas

- **Reference product framing**: USBee is "WhatCable for GNOME" — when in doubt, mirror WhatCable's behavior unless it's listed in FEATURES.md anti-features.
- **Tile subtitle is the differentiator vs WhatCable**: WhatCable requires a click; USBee shows live wattage in the subtitle. Treat the subtitle as a first-class deliverable, not an afterthought.
- **The "daemon not running" empty state is part of the product, not an error path**: it is the *first* thing a user with no daemon sees. It must be friendly, informative, and copyable.

</specifics>

<deferred>
## Deferred Ideas

### To Phase 2
- `prefs.js` Adwaita preferences window (PREFS-V2-01 also)
- GSettings schema population beyond an empty scaffold
- `CapabilityDegraded` notification handling (NOTIF-*)
- COPYING + README + final `gnome-extensions pack` zip (PACK-01/02/03/06)
- STATE-04 lock-screen prefs-entry hiding (no prefs entry to hide yet)
- gettext `_()` wrapping of strings — Phase 1 may write raw strings; Phase 2 wraps them and generates the `.pot`

### To post-v1.x
- "Copy diagnostic to clipboard" action (DIAG-V2-01)
- PDO ladder rendering (LIST-V2-01)
- Trust-signal glyph on suspect e-markers (DIAG-V2-02)
- Notification coalescing window (NOTIF-V2-01)
- Per-port wattage history graph (out-of-scope v1; revisit if user feedback demands)
- KDE / non-GNOME ports (out-of-scope; separate C++ Plasmoid covers KDE)

### Push upstream to `usbeehive` (not a USBee task)
- If `SnapshotJson` proves slow, request an atomic `DevicesChanged` signal carrying the new snapshot payload (flagged in PITFALLS.md)
- If UCSI live-wattage updates need their own signal, request `PropertiesChanged` on per-port wattage (flagged in PITFALLS.md)
- If a stable port identifier format is needed for Phase 2's per-port mute, confirm or request one upstream

</deferred>

---

*Phase: 1-Tile-Popover-Hotplug-Daemon-Missing-State-v0.1*
*Context gathered: 2026-05-11*
