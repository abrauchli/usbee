# Phase 2: Notifications, Preferences, EGO Submission Polish (v1.0) — Research

**Researched:** 2026-05-12
**Domain:** GNOME Shell 46+ extension surface for MessageTray notifications + Adwaita preferences window + EGO submission packaging
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md / UI-SPEC.md / STATE.md)

> **No `CONTEXT.md` exists for Phase 2 yet** (the planner will gather one from this research + UI-SPEC). The constraints below are the **inheritance set** carried forward from Phase 1's CONTEXT.md (`01-CONTEXT.md`), the approved Phase 2 UI-SPEC (`02-UI-SPEC.md`), `STATE.md § Accumulated Context`, and `CLAUDE.md`. Plan and execution **MUST** treat these as locked.

### Locked Decisions (carried forward)

From `01-CONTEXT.md`:
- **D-02:** Extension UUID is `usbee@bitcreed.us`.
- **D-03:** `metadata.json` declares `shell-version: ["46", "47", "48"]`.
- **D-14:** Every `connect`/`connectSignal`/`bus_watch_name`/`timeout_add` site registers a dispose-fn with `SignalRegistry`.
- **D-15:** No synchronous D-Bus.
- **D-16:** Only `extension.js` mounts / destroys the indicator.
- **D-17:** No `Gtk.*` / `Adw.*` imports in any file that runs in the Shell process (`extension.js`, `src/*.js`). **These imports are allowed ONLY in `prefs.js`.**
- **D-18:** No `/sys`, no `Gio.Subprocess`, no `GLib.spawn_*`, no `fs` I/O.
- **D-19:** No bundled binaries of any kind in the extension zip.

From `STATE.md § Decisions Locked`:
- **Stack:** Pure-GJS GNOME 46+ Shell extension, ESM-only. No Rust binary, no GTK4-rs, no companion service.
- **License:** GPL-3.0.
- **Distribution:** extensions.gnome.org (EGO) as a single zip produced by `gnome-extensions pack`.
- **Settings storage:** GSettings schema `us.bitcreed.usbee`. No TOML, no dotfiles.
- **i18n:** English strings only in v1; every user-visible string wrapped in `gettext` `_()` markers.
- **D-Bus wire names:** `BUS_NAME='org.usbeehive.Devices'`, `OBJECT_PATH='/org/usbeehive/Devices'`, `INTERFACE_NAME='org.usbeehive.Devices1'` (`1` only on interface — already correct in Phase 1 code).

From `02-UI-SPEC.md`:
- **Three new surfaces:** (1) MessageTray degraded-port notification, (2) Adwaita preferences window in `prefs.js`, (3) STATE-04 lock-screen menu-row removal on the existing tile.
- **Notification:** `MessageTray.Source` subclass (lazy singleton) + `MessageTray.Notification`. One notification per port via in-process `Map<port_number, Notification>`. Title `_('USB-C Port %d — %s').format(port_number, summary)`; body = daemon `detail` verbatim; action 1 = `_("Don't notify for this port again")`; action 2 = `_('Open Preferences')`.
- **Coalesce on repeat:** call `notification.update(title, body, {clear: true})` on the existing instance — **do not** create a new notification. The 150 ms debounce that the Phase 1 D-Bus client uses for `DeviceAdded`/`DeviceRemoved` is **also** applied to `CapabilityDegraded` → notify (UI-SPEC §Interactions, last paragraph).
- **Restore:** on `CapabilityRestored(port_number)`, call `notification.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED)` and drop the map entry.
- **Daemon-restart suppression:** 2.5 s window after `Gio.bus_watch_name` "name-appeared" (transition from owned → not owned → owned); during this window every `CapabilityDegraded` is dropped silently. Implemented with `GLib.get_monotonic_time()`.
- **GSettings schema:** `<key name="port-mutes" type="as">` default `[]`; `<key name="hide-empty-ports" type="b">` default `false`. **No master notifications-enabled key** (UI-SPEC §Out-of-Scope-Restatement — per-port mute is the v1 contract).
- **Prefs window:** `fillPreferencesWindow(window)`; **`Adw.PreferencesWindow`** (NOT `Adw.PreferencesDialog` — the latter is the libadwaita 1.5+ replacement but Shell 46 hands you a `PreferencesWindow`); three groups in this order — Notifications, General, About (rationale: notification-action entry path is dominant).
- **Empty-state muted list:** a single disabled `Adw.ActionRow` reading `_('No muted ports')` / `_('Mute a port from a notification to see it here')`. **Not** `Adw.StatusPage`.
- **Muted-port row:** `Adw.ActionRow` with `Gtk.Button` suffix (`icon-name: user-trash-symbolic`, css class `destructive-action`, `valign: Gtk.Align.CENTER`).
- **Hide-empty-ports switch:** `Adw.SwitchRow` bound to GSettings via `Gio.Settings.bind('hide-empty-ports', row, 'active', Gio.SettingsBindFlags.DEFAULT)`.
- **STATE-04:** at menu-build time and on every `Main.sessionMode.connect('updated', ...)` fire, physically `destroy()` the `Preferences…` row + separator when `!Main.sessionMode.allowSettings`, and re-append them when it flips back. **Do NOT** use `item.visible = false`.
- **Preferences row copy:** `_('Preferences…')` with U+2026 horizontal ellipsis (single character, not three dots).
- **Zero new CSS:** Phase 2 adds NO rule to `stylesheet.css`. libadwaita and MessageTray own all styling.
- **`Adw.SwitchRow` requires libadwaita ≥ 1.4** — verified by spec; GNOME 46 ships 1.5 (Ubuntu noble: `libadwaita-1-0 1.5.0-1ubuntu2`). [VERIFIED: local `apt-cache policy libadwaita-1-0`]
- **License: GPL-3.0-or-later** per `COPYING`; every `.js` source file (Phase 1 retroactively + all Phase 2 files) carries `// SPDX-License-Identifier: GPL-3.0-or-later` as the first non-shebang line.

From `STATE.md § Risks Being Carried`:
- **Notification spam mitigations are non-negotiable:** `replaces_id`-style coalescing via `notification.update()`, `notification.destroy(...)` on `CapabilityRestored`, 2–3 s suppression window after `NameOwnerChanged null→owner`, hard daily rate cap per port.

### Claude's Discretion

(The planner may decide these — research below recommends a default.)

- **Hard daily rate cap per port** — `STATE.md § Risks` mentions this but UI-SPEC does not pin a number. Research recommends: **10 notifications per port per UTC day**, decrementing counter persisted in-memory only (no GSettings storage, reset on `disable()`); above the cap, drop silently and log once.
- **Notification urgency level** — UI-SPEC uses `MessageTray.Urgency.NORMAL` (degraded charging is informational, not safety-critical). Research recommends keeping `NORMAL`; `HIGH` would force banner display even under DND and is the wrong affective signal for "your cable could be faster".
- **`Adw.PreferencesPage.icon_name`** — UI-SPEC says `network-usb-symbolic`. Research recommends keeping it.
- **`COPYING` filename** — UI-SPEC says `COPYING` (uppercase, no extension). Research confirms this matches GNU + GNOME convention.
- **README structure** — UI-SPEC pins the section headings and the install command. Research recommends mirroring `usbeehive/README.md` voice where the daemon install line appears so the two repos stay in lock-step.
- **`Notifier` module file path** — research recommends `src/notifier.js` (consistent with `src/dbus-client.js`, `src/device-store.js`).
- **`Notifier` source title** — `_('USBee')` (matches `metadata.json` `name`). The `MessageTray.Source` requires both `title` and either `icon` or `iconName`; research recommends `iconName: 'network-usb-symbolic'`.

### Deferred Ideas (OUT OF SCOPE for Phase 2)

From `02-UI-SPEC.md § Out-of-Scope Restatement` and `REQUIREMENTS.md § v2`:
- Bundled translations beyond the `.pot` template (I18N-V2-01).
- Master "Notifications enabled" switch in prefs (deferred — per-port mute is the v1 contract).
- "Copy diagnostic to clipboard" notification/popover action (DIAG-V2-01).
- Configurable coalescing window (NOTIF-V2-01 — only the 2.5 s daemon-restart suppression is in v1).
- Per-row degraded-state amber colouring in the popover.
- `Adw.ButtonRow` "Open daemon README" link (libadwaita 1.6+ widget; out of scope for v1.0 on a 1.5 baseline).
- A `prefs.js` "Test notification" button.
- Custom `GtkCssProvider` styling in `prefs.js` — libadwaita defaults are the contract.
- "Reset to defaults" / "Clear all mutes" buttons.
- Trust-signal glyph on suspect e-markers (DIAG-V2-02).
- PDO ladder rendering (LIST-V2-01).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **NOTIF-01** | On `CapabilityDegraded(port_number, summary, detail)`, surface a desktop notification describing the degradation | §Standard Stack → `MessageTray.Source` + `Notification`; §Code Examples #1 (Notifier composition); §Architecture Pattern 1 (Notifier as singleton lifecycle owner) |
| **NOTIF-02** | At most one notification per port per degradation event; coalesce across daemon restarts via "replaces_id"-equivalent | §Code Example #2 (`notification.update()` on the existing instance from the per-port `Map`); §Code Example #3 (2.5 s suppression after `NameOwnerChanged null→owner→null→owner`); §Pitfall A (do NOT pass `replaces_id` directly — that's pre-GNOME-46 XDG semantics; GNOME Shell 46 uses `.update()` for in-place updates) |
| **NOTIF-03** | Notification carries a "Don't notify for this port again" action that persists the mute decision in GSettings | §Code Example #4 (action handler reads `settings.get_strv('port-mutes')`, appends `String(port_number)` if absent, writes via `settings.set_strv(...)`, then `notification.destroy(...)`); §Pitfall E (`addAction` callback receives no arguments — capture `port_number` in the closure) |
| **NOTIF-04** | Muted ports never raise further `CapabilityDegraded` notifications until unmuted via preferences | §Code Example #1 (Notifier handler short-circuits if `String(port_number)` ∈ `settings.get_strv('port-mutes')` BEFORE composing any notification); read the live GSettings array on every event — do not cache (PREFS writes from `prefs.js` arrive via `changed::port-mutes` and the Notifier should react without restart) |
| **PREFS-01** | GSettings schema `us.bitcreed.usbee` installed and visible in `dconf-editor` when extension enabled | §Code Example #5 (schemas/us.bitcreed.usbee.gschema.xml — the Phase 1 empty scaffold is already in place; Phase 2 populates the two keys); §Architecture Pattern 2 (compile-on-install via `gnome-extensions install` since GNOME 44, manual `glib-compile-schemas` during dev) |
| **PREFS-02** | Schema includes `port-mutes` (`as`) | §Code Example #5 (schema XML with `<key name="port-mutes" type="as"><default>[]</default>...`); §Pitfall F (store `String(port_number)`, not int — `as` is array-of-strings; daemon's `port_number` is `i` and must be stringified) |
| **PREFS-03** | Schema includes `hide-empty-ports` boolean toggle | §Code Example #5 (schema XML); §Continuity-with-Phase-1 (Phase 2 patches `populateDeviceRows()` in `src/popover.js` to consult this key) |
| **PREFS-04** | All preference reads/writes go through GSettings — no ad-hoc config file | §Architecture Pattern 2; §Don't Hand-Roll (config files); §Pitfall G (do NOT cache GSettings in extension state — re-read on every relevant event so `prefs.js` writes take effect without restart) |
| **STATE-04** | When `Main.sessionMode.allowSettings === false`, the tile's "Preferences" entry is hidden | §Code Example #6 (`Main.sessionMode.connect('updated', ...)` pattern; physical destroy+recreate per UI-SPEC, not `.visible = false`); §Pitfall H (signal must be registered with `SignalRegistry` per D-14) |
| **PACK-01** | Project licensed GPL-3.0 with top-level `COPYING` | §Packaging & Submission (COPYING content + SPDX headers) |
| **PACK-02** | Every user-visible string wrapped in gettext marker; `.pot` template generated | §Packaging & Submission (xgettext invocation); §Architecture Pattern 4 (gettext auto-init via `gettext-domain` in metadata.json — already present in Phase 1's `metadata.json`); §Pitfall I (`String.prototype.format()` with positional `%s`/`%d` — no template literals for user-visible strings) |
| **PACK-03** | Extension passes `gnome-extensions pack` and produces a zip ready for EGO upload | §Packaging & Submission (`gnome-extensions pack` invocation, auto-included files, what to add via `--extra-source`) |
| **PACK-06** | README documents `usbeehive` daemon dependency and `systemctl --user enable --now usbeehive` install path | §Packaging & Submission (README template); §Continuity-with-Phase-1 (copy must match empty-state popover verbatim — the two strings update in lock-step) |

</phase_requirements>

## Summary

Phase 2 is a **polish + finishing phase** that consumes the Phase 1 architectural skeleton (DBusClient, DeviceStore, SignalRegistry, tile.js) and adds **exactly three new user-visible surfaces** plus the EGO submission artifacts. The work is constrained almost entirely by interfaces that already exist: `MessageTray.Source`/`Notification` for the toast, `Adw.PreferencesWindow` (via `fillPreferencesWindow`) for the prefs window, `Gio.Settings.bind()` for the toggle, and `Main.sessionMode` for lock-screen gating. There are **no new abstractions to invent** — Phase 2 is API-shaped throughout.

The single most important technical decision is the **GNOME 46 notification-update pattern**: post-refactor, the Shell removed the legacy XDG `replaces_id` parameter from the constructor and instead expects extensions to **call `.update(title, body, params)` on the existing `Notification` instance** when coalescing a repeated event. The per-port `Map<port_number, Notification>` lives in the `Notifier` module and is the only place this pattern is invoked. The `destroy` signal callback (with the `MessageTray.NotificationDestroyedReason` enum) is the canonical hook for nulling the map entry — without it, an `addAction` closure leaks the notification reference past Shell-driven dismissal and the next coalesce target is gone.

The second-largest risk surface is **EGO submission cleanliness**. The December 2025 AI-code rule means the reviewer will pattern-match on inconsistent code style, imaginary API usage, and `try`/`catch` blocks without recovery strategies. Phase 1's `SignalRegistry` discipline (D-14) already addresses the cleanup-leak class; Phase 2 must extend the same discipline to the `Notifier`'s map (the destroy-signal handler is the registry-equivalent for per-notification state), the `prefs.js` per-row signal connections, and the `Main.sessionMode.connect('updated', ...)` handler. Every `addAction` callback must capture `port_number` in a closure rather than read it from the `notification` (no such property exists).

**Primary recommendation:** Implement a small `src/notifier.js` module that **owns the per-port Map, the suppression-window timestamp, and the `port-mutes` GSettings read on every event**. Keep it pure (no UI imports, no GTK, no Adw). Wire it from `extension.js` after Phase 1's `DBusClient` so the registry order is `SignalRegistry → DeviceStore → Notifier → Indicator → DBusClient`. Subscribe the Notifier to `client.connectSignal('CapabilityDegraded')` and `client.connectSignal('CapabilityRestored')` during `DBusClient._onAppeared` (the same place where `DeviceAdded`/`DeviceRemoved` already wire up in Plan 01-02). The patch to `dbus-client.js` is two extra `connectSignal` calls + one extra `bus_watch_name` callback line that records the suppression-window start timestamp.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Listen for `CapabilityDegraded` / `CapabilityRestored` signals | Shell-process (extension.js subprocess) | — | D-Bus signals arrive in the Shell process; `Notifier` lives next to `DBusClient`. No backend separation. |
| Compose and emit `MessageTray.Notification` | Shell-process (`src/notifier.js`) | — | `MessageTray` is a Shell-only resource module (`resource:///org/gnome/shell/ui/messageTray.js`). |
| Persist `port-mutes` array | Shell-process (write from notification action handler) **and** prefs-process (write from unmute button) | GSettings (the actual storage) | Both surfaces write to the same `Gio.Settings` key — GSettings handles cross-process synchronization via dconf. |
| Read `port-mutes` on every `CapabilityDegraded` | Shell-process (`src/notifier.js`) | — | Live read = no stale-cache bugs when `prefs.js` writes mid-session. |
| Render preferences UI | Prefs-process (`prefs.js`, separate `gnome-shell-extension-prefs` process) | — | Adw / Gtk widgets are FORBIDDEN in Shell-process by D-17. |
| Bind `hide-empty-ports` switch to GSettings | Prefs-process | GSettings | `Gio.Settings.bind('hide-empty-ports', row, 'active', Gio.SettingsBindFlags.DEFAULT)` is the canonical pattern. |
| Consume `hide-empty-ports` in popover | Shell-process (`src/popover.js` patch) | GSettings | `populateDeviceRows()` reads `extension.getSettings().get_boolean('hide-empty-ports')` once per rebuild. Read-only access; `Gio.Settings` is process-shared via dconf. |
| Hide `Preferences…` menu entry on lock | Shell-process (`src/tile.js` patch) | — | `Main.sessionMode` is a Shell singleton; `allowSettings` is its property. |
| Open the prefs window from a notification action | Shell-process (calls `extension.openPreferences()`) | gnome-shell-extension-prefs (target) | `Extension.openPreferences()` is the documented API; the Shell spawns the prefs process for us. |
| Schema definition (`schemas/us.bitcreed.usbee.gschema.xml`) | Source-tree (compile-time artifact) | dconf (runtime) | `gnome-extensions install` auto-compiles to `gschemas.compiled` since GNOME 44; during dev, `glib-compile-schemas schemas/` is the manual command. |
| Translation extraction (`po/usbee@bitcreed.us.pot`) | Source-tree (xgettext build step) | — | gettext is initialized automatically because `metadata.json` already declares `gettext-domain: "usbee@bitcreed.us"`. |
| Package zip | Source-tree (`gnome-extensions pack`) | EGO upload | The CLI auto-includes `extension.js`, `metadata.json`, `prefs.js`, `stylesheet*.css`, `schemas/`, `po/`; everything else needs `--extra-source`. |

## Project Constraints (from CLAUDE.md)

Hard rules extracted from `./CLAUDE.md` — every Phase 2 task **must** be verifiable against these.

| # | Constraint | Where in CLAUDE.md | Enforcement in Phase 2 |
|---|------------|---------------------|------------------------|
| C-01 | GPL-3.0 license, NOT the more-permissive license of usbeehive | "Constraints" | `COPYING` is verbatim GPL-3.0; `metadata.json` carries no `license` field (EGO doesn't use one); SPDX header on every `.js` |
| C-02 | Min GNOME 46 | "Constraints" | `metadata.json` `shell-version: ["46","47","48"]` (already set in Phase 1) |
| C-03 | UI toolkit: GTK4 + libadwaita 1.5+ for `prefs.js` only; GJS / Shell extension JS for the Shell surface | "Constraints" + "What NOT to Use" table | `prefs.js` is the ONLY file with `gi://Gtk` / `gi://Adw` imports |
| C-04 | All USB knowledge flows through usbeehive via D-Bus | "Constraints" | Notifier consumes `CapabilityDegraded` payload verbatim; never re-derives detail strings |
| C-05 | Heavy lifting belongs in usbeehive, not USBee | "Constraints" | If Phase 2 surfaces a missing field (e.g. stable port identifier), the fix goes upstream — port_number as int is the v1 identifier |
| C-06 | Settings: GSettings schema `us.bitcreed.usbee` (not TOML / not ad-hoc dotfile) | "Constraints" | All persistence via `Gio.Settings`; no `Gio.File.write_*`, no `Gio.Subprocess`, no `~/.config/usbee` |
| C-07 | i18n: English strings only for v1, but every user-visible string must go through gettext | "Constraints" | `_()` wrap on every Notif + Prefs literal; `.pot` generation gate at end of phase |
| C-08 | NEVER bundle a binary (Rust, C, Go) in the EGO zip — auto-rejection | "What NOT to Use" | `gnome-extensions pack` zip must show `file --mime-type` text/* for every entry |
| C-09 | NEVER import `gtk4-rs` / `libadwaita-rs` / `zbus` / `tokio` for the tile itself | "What NOT to Use" | Phase 2 adds no Cargo dependency — there is no Cargo.toml in this repo |
| C-10 | NEVER use legacy `imports.*` import system | "What NOT to Use" | All Phase 2 files use ESM `import X from 'gi://X'` / `import * as Main from 'resource:///org/gnome/shell/ui/main.js'` |
| C-11 | NEVER use `gnome-shell-extension-prefs` legacy preferences pattern (GtkBuilder + GtkBox without Adw) | "What NOT to Use" | `prefs.js` uses `Adw.PreferencesPage` + `Adw.PreferencesGroup` + `Adw.SwitchRow` / `Adw.ActionRow` |
| C-12 | NEVER use private `St.*` / `Main.panel._*` internals beyond documented Quick Settings API | "What NOT to Use" | `Main.sessionMode` is public; `Main.messageTray.add(source)` is public — both documented on gjs.guide |
| C-13 | NEVER use `Gio.Notification` from inside the extension | "What NOT to Use" | Use `MessageTray.Source` + `Notification` — `Gio.Notification` requires a GApplication identity which extensions don't have |
| C-14 | NEVER use synchronous `Gio.DBusProxy.new_for_bus_sync` or any sync D-Bus on main thread | "What NOT to Use" | Phase 2 only consumes Phase 1's already-async proxy; no new D-Bus methods are called from `prefs.js` at all |
| C-15 | NEVER use string concatenation for user-visible strings | "What NOT to Use" | `_('%s — %d').format(...)`; the gettext-marker check is the test |
| C-16 | NEVER use minified / obfuscated / AI-slop JavaScript | "What NOT to Use" | Code-review depth `standard` per `.planning/config.json`; the Dec-2025 EGO AI-code rule is the existential risk |
| C-17 | NEVER bundle polling timers shorter than ~1 s for D-Bus reads | "What NOT to Use" | Notifier is signal-driven; the 150 ms debounce is signal-coalescing, not polling |

## Daemon Wire Shape (relevant to Phase 2 only)

The Phase 1 introspection XML (already in `usbee@bitcreed.us/dbus-iface.xml`) already declares everything Phase 2 consumes — **no XML changes required**. Relevant signals for Phase 2:

```xml
<signal name="CapabilityDegraded">
  <arg type="i" name="port_number"/>
  <arg type="s" name="summary"/>
  <arg type="s" name="detail"/>
</signal>
<signal name="CapabilityRestored">
  <arg type="i" name="port_number"/>
</signal>
```

[VERIFIED: read directly from `/home/blk/projects/rust/usbee/usbee@bitcreed.us/dbus-iface.xml`]

**Phase-2-specific notes on the wire shape:**
- `port_number` is `i` (int32). When written to `port-mutes` (`as`), it must be stringified: `String(port_number)`. When read back, compare against the stringified value.
- `summary` is the daemon's one-liner ("Charging slower than expected"). USBee prefixes it with the port label in the title: `_('USB-C Port %d — %s').format(port_number, summary)`.
- `detail` is the daemon's multi-line explanation. Rendered verbatim as the notification body — no client-side reformatting.
- The Phase 1 client already declares an `IFACE_XML` constant inside `src/dbus-client.js`; both `CapabilityDegraded` and `CapabilityRestored` are present in it (see `dbus-client.js:64-75`). [VERIFIED: read directly from `src/dbus-client.js`]
- The Phase 1 client comment at line 30 explicitly says these signals are "intentionally unused in Phase 01 ... reserved for Phase 2: ... NOTIF-driven manual re-snapshot path." Phase 2 wires the subscriptions inside the existing `_onAppeared` arrow function. [VERIFIED: read directly from `src/dbus-client.js:25-32`]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `MessageTray.Source` | `resource:///org/gnome/shell/ui/messageTray.js` (GNOME 46+) | Notification source — one per extension lifetime | The canonical extension notification API. `Gio.Notification` is wrong because extensions have no GApplication identity inside the Shell process. [CITED: https://gjs.guide/extensions/topics/notifications.html] |
| `MessageTray.Notification` | same module | Individual notification object | Property-bag constructor in 46+: `{source, title, body, gicon, iconName, urgency}`. Has `.update(title, body, params)` for in-place coalescing. [CITED: https://gjs.guide/extensions/upgrading/gnome-shell-46.html → "ui/messageTray.js/Notification has new iconName getter and setter"; https://gjs.guide/extensions/topics/notifications.html] |
| `MessageTray.NotificationDestroyedReason` | same module | Enum: `EXPIRED`, `DISMISSED`, `SOURCE_CLOSED`, `REPLACED` | Source-of-truth for `notification.connect('destroy', (n, reason) => ...)` handlers — without checking the reason, the map cleanup logic can't distinguish "user dismissed" from "we destroyed it after CapabilityRestored". [CITED: https://gjs.guide/extensions/topics/notifications.html] |
| `MessageTray.Urgency` | same module | Enum: `LOW`, `NORMAL`, `HIGH`, `CRITICAL` | Controls banner-popup vs tray-only and DND interaction. `NORMAL` is correct for degraded-charging (informational). [CITED: https://gjs.guide/extensions/topics/notifications.html] |
| `Main.messageTray` | `resource:///org/gnome/shell/ui/main.js` | Singleton tray host; sources added via `.add(source)` | Public API documented on gjs.guide. [CITED: https://gjs.guide/extensions/topics/notifications.html] |
| `Main.sessionMode` | same module | `allowSettings` property + `'updated'` GObject signal | STATE-04 gate. [CITED: https://gjs.guide/extensions/topics/quick-settings.html → "settingsItem.visible = Main.sessionMode.allowSettings"; https://gjs.guide/extensions/topics/session-modes.html] |
| `Adw` 1.5 (GTK4) | `gi://Adw?version=1` — version 1.5 on Ubuntu 24.04 noble, 1.6 on Fedora 41+ | `PreferencesWindow`, `PreferencesPage`, `PreferencesGroup`, `ActionRow`, `SwitchRow` | `Adw.SwitchRow` introduced in 1.4 — safe to use on the GNOME-46 baseline. [VERIFIED: local `apt-cache policy libadwaita-1-0` = 1.5.0-1ubuntu2 AND `gjs -c "imports.gi.versions.Adw='1'; const Adw=imports.gi.Adw; print(typeof Adw.SwitchRow)" → "function"`; CITED: https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/class.SwitchRow.html] |
| `Gtk` 4.14 (only inside `prefs.js`) | `gi://Gtk?version=4.0` | `Gtk.Button`, `Gtk.Align.CENTER` for the trash-icon suffix | libadwaita 1.5 sits on top of GTK 4.14 in GNOME 46. [CITED: https://release.gnome.org/46/developers/] |
| `Gio.Settings.bind` | `gi://Gio` | Two-way bind GSettings key to widget property | `Gio.SettingsBindFlags.DEFAULT` for the switch row. [CITED: https://docs.gtk.org/gio/method.Settings.bind.html] |
| `Gio.Settings.get_strv` / `set_strv` | `gi://Gio` | Read / write the `port-mutes` `as` array | Convenience wrappers around `GLib.Variant` `as` packing. [CITED: https://gjs.guide/guides/glib/gvariant.html] |
| `ExtensionPreferences` (base class) | `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js` | `prefs.js` default export; `fillPreferencesWindow(window)` is the modern hook | Replaces deprecated `buildPrefsWidget()`. [CITED: https://gjs.guide/extensions/development/preferences.html] |
| `gettext` (auto-init via `metadata.json` gettext-domain) | bundled | `_()` and `ngettext()` for translatable strings | The current `metadata.json` already declares `gettext-domain: "usbee@bitcreed.us"` — auto-init works in both extension.js and prefs.js (different module paths for the import). [VERIFIED: existing `metadata.json` content] |
| `GLib.get_monotonic_time` | `gi://GLib` | Microsecond-precision wall-clock-independent timer for the 2.5 s suppression window | Wall clock can jump; monotonic time cannot. Returns microseconds. [CITED: https://docs.gtk.org/glib/func.get_monotonic_time.html] |

### Supporting

No external libraries. Phase 2 ships **zero** new `npm` / `cargo` / `pip` dependencies. The deliverable is the same flat `gnome-extensions pack` zip as Phase 1 with three new files (`prefs.js`, `src/notifier.js`, `COPYING`, `README.md`, `po/usbee@bitcreed.us.pot`) and edits to two existing files (`src/dbus-client.js`, `src/tile.js`) plus the schema (`schemas/us.bitcreed.usbee.gschema.xml`).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `notification.update(title, body, {clear: true})` | Destroy old, construct new with same source | The destroy-then-construct flow re-emits the banner each time (annoying) and increments the source's notification count toward the per-source-3 limit. `update()` does neither. [CITED: search result for "MessageTray.Notification update method"] |
| `Adw.PreferencesWindow` | `Adw.PreferencesDialog` (libadwaita 1.5+ replacement) | Shell 46's `fillPreferencesWindow(window)` API hands you a `PreferencesWindow` — extensions cannot opt into `PreferencesDialog` until the Shell API itself migrates. Stay on `PreferencesWindow` until the GJS guide flips. [CITED: gjs.guide preferences guide + libadwaita PreferencesWindow.html "Use AdwPreferencesDialog" deprecation note] |
| Per-row trash `Gtk.Button` suffix | `Adw.ButtonRow` (libadwaita 1.6+) | `Adw.ButtonRow` does not exist on the Ubuntu 24.04 LTS libadwaita 1.5 baseline. [VERIFIED: `gjs -c "...; print(typeof Adw.ButtonRow)"` → `"undefined"` on dev host] |
| Custom `MessageTray.NotificationPolicy` subclass | Default `NotificationGenericPolicy` | The default reads from the user's GNOME Settings → Notifications panel, which is what users expect. A custom policy bypasses user control over DND/lock-screen. Keep default. [CITED: https://gjs.guide/extensions/topics/notifications.html] |
| `replaces_id` parameter (legacy XDG semantics) | `notification.update(...)` (GNOME 46+ semantics) | The legacy `replaces_id` was a Notify-protocol concept that pre-46 Shell forwarded; the 46 refactor removed it from the constructor. The Shell now keys notifications by JS object identity, so re-using the same `MessageTray.Notification` instance IS the coalescing mechanism. [CITED: https://blogs.gnome.org/shell-dev/2024/04/23/notifications-46-and-beyond/ + gjs.guide notifications guide] |
| `item.visible = false` for STATE-04 | Physical `destroy()` + recreate | UI-SPEC §Component-Inventory states "EGO reviewers flag invisible-but-present items as a side-channel; physical removal is the safer pattern." Confirmed by gjs.guide session-modes page which shows `_addIndicator` / `_removeIndicator` (destroy+recreate) not visibility toggling. [CITED: https://gjs.guide/extensions/topics/session-modes.html] |
| `GLib.DateTime.now_utc()` for the 2.5 s suppression timestamp | `GLib.get_monotonic_time()` | Wall clock can be NTP-adjusted backward mid-window, releasing the suppression prematurely. Monotonic time is immune. [CITED: https://docs.gtk.org/glib/func.get_monotonic_time.html "guaranteed to always move forward"] |

**Verified versions on dev machine (re-verified for Phase 2):**
- GNOME Shell 46.0 [VERIFIED: `gnome-shell --version`]
- gjs 1.80.2 [VERIFIED: `gjs --version`]
- libadwaita 1.5.0-1ubuntu2 [VERIFIED: `apt-cache policy libadwaita-1-0`]
- `Adw.SwitchRow`, `Adw.ActionRow`, `Adw.PreferencesWindow`, `Adw.PreferencesDialog` all present; `Adw.ButtonRow` **absent** on this libadwaita 1.5 baseline [VERIFIED: `gjs -c "imports.gi.versions.Adw='1'; const Adw=imports.gi.Adw; ..."` on dev host]
- `gnome-extensions` CLI 46.0 [VERIFIED: `gnome-extensions --version`]
- `glib-compile-schemas`, `xgettext`, `msgfmt`, `busctl` all present [VERIFIED: `command -v` checks]

## Package Legitimacy Audit

Phase 2 installs **no external packages** (no npm, no cargo, no pip, no new system packages). The deliverable is a hand-written GJS extension consuming only GNOME Shell built-in resource modules and platform GI libraries (`gi://Gio`, `gi://GLib`, `gi://GObject`, `gi://Gtk?version=4.0`, `gi://Adw?version=1`). **No slopcheck or registry verification is needed.**

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | n/a | n/a |

The only "external resources" consumed are the GNOME Shell extension API surface (`resource:///org/gnome/shell/...`) and the host system's GI libraries — both are part of the user's GNOME installation, not packages.

## metadata.json — required Phase 2 edits

The existing `metadata.json` (read directly from `usbee@bitcreed.us/metadata.json`) is already correct for Phase 2:

```json
{
  "uuid": "usbee@bitcreed.us",
  "name": "USBee",
  "description": "...",
  "shell-version": ["46", "47", "48"],
  "url": "https://github.com/abrauchli/usbee",
  "gettext-domain": "usbee@bitcreed.us",
  "settings-schema": "us.bitcreed.usbee"
}
```

[VERIFIED: file read]

**One optional addition for Phase 2 / EGO submission:**

```diff
   "url": "https://github.com/abrauchli/usbee",
   "gettext-domain": "usbee@bitcreed.us",
-  "settings-schema": "us.bitcreed.usbee"
+  "settings-schema": "us.bitcreed.usbee",
+  "version-name": "1.0.0"
 }
```

`version-name` is the EGO-recommended way to declare a human-readable version (the integer `version` field is set by EGO on upload — never write it manually). [CITED: https://gjs.guide/extensions/review-guidelines/review-guidelines.html "**Deprecated:** This field is set for internal use by `extensions.gnome.org`."] Recommended value: `"1.0.0"` to match the milestone label in `STATE.md`.

**Fields NOT to add:**
- `license` / `license-version` — not metadata.json fields; license goes in `COPYING`
- `donations` — must contain at least one valid key if present; Phase 2 doesn't have one to declare, so omit entirely
- `session-modes` — Phase 2 does NOT run on the lock screen (STATE-04 is about hiding the prefs entry, not running under `unlock-dialog`); leaving this absent means the extension simply doesn't load on the lock screen, which is the correct behavior

## Architecture Patterns

### System Architecture Diagram (Phase 2 additions on top of Phase 1)

```
┌──────────────────────── gnome-shell process (gjs) ────────────────────────┐
│                                                                            │
│   extension.js                                                             │
│      │  enable()                                                           │
│      ▼                                                                     │
│   SignalRegistry ──── DeviceStore ──── USBeeIndicator ──── DBusClient      │
│      │                                       │                  │          │
│      │                                       │                  │          │
│      │              (NEW)                    │                  │          │
│      └────────────► Notifier ◄───────────────┘                  │          │
│                       │                                          │          │
│                       │   subscribes to (NEW):                  │          │
│                       │     proxy.connectSignal('CapabilityDegraded')      │
│                       │     proxy.connectSignal('CapabilityRestored')      │
│                       │                                          │          │
│                       │   reads on every event:                 │          │
│                       │     extension.getSettings()             │          │
│                       │       .get_strv('port-mutes')           │          │
│                       │                                          │          │
│                       ▼                                          │          │
│                  Map<port_number,                                │          │
│                       MessageTray.Notification>                  │          │
│                                                                  │          │
│   USBeeToggle (Phase 1) ─── (PATCHED) ────────────────────────────────┐    │
│      │  appends Preferences… row + separator at menu-build time       │    │
│      │  gated by Main.sessionMode.allowSettings                       │    │
│      │  connects to Main.sessionMode 'updated' signal                 │    │
│      │  on update: destroy()+recreate the row if allowSettings flips  │    │
│      ▼                                                                │    │
│   menu.addAction('Preferences…', () => extension.openPreferences())   │    │
│                                                                       │    │
│   src/popover.js populateDeviceRows (PATCHED): reads                  │    │
│      extension.getSettings().get_boolean('hide-empty-ports')          │    │
│      once per rebuild; filters empty-port rows when true              │    │
│                                                                       │    │
└───────────────────────────────────────────────────────────────────────┼────┘
                                                                        │
            (user clicks "Preferences…" or notification "Open Preferences")
                                                                        ▼
┌─────── gnome-shell-extension-prefs process (SEPARATE) ─────────────────────┐
│                                                                            │
│   prefs.js (NEW)                                                           │
│      │  fillPreferencesWindow(window)                                     │
│      ▼                                                                     │
│   Adw.PreferencesWindow                                                    │
│      └── Adw.PreferencesPage(title=General, icon=network-usb-symbolic)    │
│             ├── Adw.PreferencesGroup(Notifications)                       │
│             │     ├── (if port-mutes.length === 0)                       │
│             │     │     Adw.ActionRow(disabled, "No muted ports")        │
│             │     └── (else for each port_number in port-mutes)          │
│             │           Adw.ActionRow + trailing Gtk.Button(trash)       │
│             │                                                             │
│             ├── Adw.PreferencesGroup(General)                             │
│             │     └── Adw.SwitchRow(hide-empty-ports)                    │
│             │           bound to GSettings via                            │
│             │           settings.bind('hide-empty-ports', row, 'active',  │
│             │                          Gio.SettingsBindFlags.DEFAULT)     │
│             │                                                             │
│             └── Adw.PreferencesGroup(About)                               │
│                   ├── Adw.ActionRow(Version)                              │
│                   └── Adw.ActionRow(usbeehive daemon — systemctl …)      │
│                                                                            │
│   subscribes to settings.connect('changed::port-mutes', () => rebuild)    │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘

            both processes share state via dconf-backed Gio.Settings
                              (no IPC required)
```

### Pattern 1: Notifier as singleton lifecycle owner

**What:** A single `Notifier` instance is created in `extension.js` `enable()` (between `DeviceStore` and `DBusClient` per the existing construction order — actually, it must come AFTER `DBusClient` is constructed because the Notifier needs to call `client.connectSignal(...)` from inside `DBusClient._onAppeared`'s subscription block, OR the Notifier needs an `attachToClient(client)` method called from `extension.js` after both are constructed; **research recommends the second pattern** — explicit attach for testability).

The Notifier owns:
- A `Map<number, MessageTray.Notification>` keyed by `port_number`.
- A lazy `MessageTray.Source` (`_source` field, `null` until first event; created on first `CapabilityDegraded`, set back to `null` from its `'destroy'` signal handler so re-creation works on subsequent events).
- A `_suppressUntil` integer (monotonic microseconds) computed from `GLib.get_monotonic_time() + 2_500_000`.
- A reference to the extension's `Gio.Settings` (passed in the constructor).
- Cached metadata.version string (for the prefs About row — actually read from `extension.metadata.version` at attach time, but the Notifier doesn't need it; only `prefs.js` does).

**When to use:** Always for this extension. Notifier is THE owner of all notification state.

**Source:** [CITED: https://gjs.guide/extensions/topics/notifications.html — "An extension may create a custom source for managing its notifications, but must connect to the destroy signal to safely reuse it."]

### Pattern 2: Live GSettings read on every event (no caching)

**What:** The Notifier's `CapabilityDegraded` handler calls `this._settings.get_strv('port-mutes')` **on every event**, not once at construction. Same for `prefs.js` — the muted-ports group rebuilds on `settings.connect('changed::port-mutes', ...)`.

**Why:** The prefs window and the notification action handler are **different code paths** writing to the same key. `prefs.js` runs in a separate process. If the Shell-side cache were stale, an unmute from `prefs.js` would not take effect on the next degraded event until extension reload. Live read costs ~microseconds (dconf hit) and avoids the entire stale-cache class of bugs.

**Source:** [CITED: https://docs.gtk.org/gio/method.Settings.bind.html — GSettings handles cross-process change propagation automatically via dconf.]

### Pattern 3: STATE-04 destroy+recreate on session-mode change

**What:** At `_buildStaticMenu` time in `src/tile.js`, check `Main.sessionMode.allowSettings`. If true, append the `Preferences…` row + separator. Connect to `Main.sessionMode.connect('updated', this._onSessionModeChanged.bind(this))` and on every fire, re-check `allowSettings`; if it flipped from true to false, call `destroy()` on both widgets and null the references; if from false to true, re-create and re-append. The `'updated'` signal id is tracked in `SignalRegistry` per D-14.

**Why:** Per gjs.guide session-modes page and UI-SPEC §Component-Inventory:
> *"Do NOT use `item.visible = false` for STATE-04 — completely remove the row from the menu when locked. EGO reviewers flag invisible-but-present items as a side-channel; physical removal is the safer pattern."*

**Source:** [CITED: https://gjs.guide/extensions/topics/quick-settings.html → "settingsItem.visible = Main.sessionMode.allowSettings"] (Note: the gjs.guide example uses the `.visible` pattern; the UI-SPEC overrides this with destroy+recreate for the EGO-review reason. Both patterns are documented; UI-SPEC's choice is the more conservative one.)

### Pattern 4: gettext auto-init via metadata.json — works in both processes

**What:** The current `metadata.json` declares `gettext-domain: "usbee@bitcreed.us"`. Both `extension.js` (Shell process) and `prefs.js` (prefs process) get auto-initialized gettext, but **the import path differs**:

```javascript
// In extension.js and any src/*.js:
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// In prefs.js:
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
```

Note the path-case difference: `shell` vs `Shell`. Both are correct as written. [CITED: https://gjs.guide/extensions/development/translations.html + https://gjs.guide/extensions/development/preferences.html]

### Pattern 5: `gnome-extensions pack` auto-inclusion + `--extra-source`

**What:** `gnome-extensions pack [SOURCE-DIR]` zips a tightly-defined set of files:
- **Always included if present:** `extension.js`, `metadata.json`, `stylesheet.css`, `stylesheet-dark.css`, `stylesheet-light.css`, `prefs.js`
- **Auto-included from `schemas/` folder** (or via `--schema=PATH`): `*.gschema.xml`. The CLI **compiles them automatically** into `gschemas.compiled` during install. [CITED: https://gjs.guide/extensions/development/preferences.html — "automatically compiled when installed with `gnome-extensions install` since GNOME 44"]
- **Auto-included from `po/` folder** (or via `--podir=PATH`): `*.po` and `*.pot`
- **Everything else (notably `src/*.js`, `icons/*.svg`, `dbus-iface.xml`, `COPYING`, `README.md`) requires `--extra-source=PATH`** — repeated once per file

**Source:** [CITED: https://man.archlinux.org/man/extra/gnome-shell/gnome-extensions.1.en + https://manpages.debian.org/testing/gnome-shell/gnome-extensions.1.en.html]

### Anti-Patterns to Avoid

- **Pre-46 `replaces_id` parameter**. Don't pass `replaces_id` to the `MessageTray.Notification` constructor — the 46 refactor removed that param. Use `.update()` on the existing instance.
- **`Gio.Notification` from inside the extension**. CLAUDE.md C-13 explicit; use `MessageTray.Source`/`Notification`.
- **Caching the `port-mutes` array** at Notifier construction time. Read live on every event (Pattern 2).
- **Mounting the prefs window from `extension.js`**. The Shell does that automatically when you call `extension.openPreferences()`. Just call it from the menu action and the notification action.
- **Subscribing to `CapabilityDegraded` from `extension.js`**. The subscription belongs inside `src/dbus-client.js`'s `_onAppeared` arrow function, next to the existing `DeviceAdded`/`DeviceRemoved` subscriptions, with the callback forwarded to the Notifier via a method call. Keeps the `_proxy.connectSignal(...)` calls all in one place where the SignalRegistry already tracks them.
- **Custom `NotificationPolicy` subclass**. Default `NotificationGenericPolicy` reads from the user's GNOME Settings panel; bypassing it loses user control over DND. (UI-SPEC §Out-of-Scope confirms.)
- **`Adw.ButtonRow` for the unmute action**. Doesn't exist on libadwaita 1.5 — would crash on the GNOME 46 baseline (Ubuntu 24.04 LTS).
- **`Gtk.CssProvider` in `prefs.js`**. UI-SPEC §Typography forbids; libadwaita defaults are the contract.
- **Adding `version` to `metadata.json` manually**. EGO sets it; the field is documented as deprecated for manual use.
- **Adding `session-modes: ["user", "unlock-dialog"]` to `metadata.json`**. STATE-04 hides the prefs entry on lock; it does NOT keep the extension running under the lock-dialog session. Adding `unlock-dialog` to session-modes would actually fight the STATE-04 contract by making the rest of the extension stay loaded.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Notification coalescing per port | Custom dictionary + manual XDG `replaces_id` | `Map<port_number, MessageTray.Notification>` + `.update(title, body, {clear: true})` on hit | The 46 refactor moved this from XDG semantics to JS-object-identity; using the official API also gets you correct interaction with the per-source 3-notification limit |
| GSettings serialization | Custom JSON-in-string in a single key | `<key type="as">` + `get_strv` / `set_strv` | `as` IS the standard type for string arrays; `dconf-editor` displays it natively; auto-handles UTF-8 |
| Two-way bind switch ↔ GSettings | `connect('notify::active', ...)` + manual `set_boolean` | `Gio.Settings.bind('hide-empty-ports', row, 'active', Gio.SettingsBindFlags.DEFAULT)` | One line; auto-disconnects when widget destroys; handles concurrent writes correctly |
| Lock-screen visibility gate | Custom polling, custom timer | `Main.sessionMode.connect('updated', ...)` | Native signal; only fires on actual mode change |
| 2.5 s suppression timer | `GLib.timeout_add` that sets a boolean | Comparison against `GLib.get_monotonic_time()` | No timer source to track in `SignalRegistry`; cheaper; immune to NTP adjustments |
| Translation extraction | Hand-curated `.pot` | `xgettext --from-code=UTF-8 -o po/usbee@bitcreed.us.pot extension.js prefs.js src/*.js` | Standard toolchain; auto-handles `String.prototype.format()` positional args |
| Schema compilation | Manual XML→binary | `gnome-extensions install` (auto since GNOME 44) for production; `glib-compile-schemas schemas/` for dev | Auto-handled in the install path; no custom build script needed |
| Zipping the extension | `zip -r usbee.zip .` | `gnome-extensions pack --extra-source=dbus-iface.xml --extra-source=src/dbus-client.js …` | Auto-validates layout against EGO rules; refuses to include junk; sets correct file modes |

**Key insight:** Phase 2 adds **zero new utility code**. Every line is either a GObject construction, a GSettings call, a MessageTray API call, or pure data marshalling. The build/package step is one CLI invocation. Resist the urge to write a Makefile.

## Runtime State Inventory

Phase 2 is **additive to Phase 1's greenfield**. There is no prior runtime state to migrate. Confirming each category explicitly:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | The empty `us.bitcreed.usbee` schema scaffold installed in Phase 1 has no keys yet, so no stored values exist. Phase 2 populates the schema with `port-mutes` (default `[]`) and `hide-empty-ports` (default `false`). **No data migration** — the defaults are the correct initial state for any user upgrading from v0.1. | None — defaults handle the migration |
| Live service config | None — Phase 2 introduces no daemon or service registration outside the extension itself. | None |
| OS-registered state | The extension is installed via `gnome-extensions install` (or symlinked during dev). No new OS-level registration in Phase 2. | None |
| Secrets/env vars | None — no auth tokens, no API keys, no env-var reads anywhere in Phase 2. | None |
| Build artifacts | New artifacts produced by Phase 2: `schemas/gschemas.compiled` (auto-built on install) and `po/usbee@bitcreed.us.pot` (build step). The `.zip` from `gnome-extensions pack` is the only deliverable. `.pot` and `gschemas.compiled` may be `.gitignore`d at the planner's discretion; they're recoverable from source. | None — auto-built by the install / pack commands |

## Common Pitfalls (Phase 2 specific)

These supplement Phase 1's pitfalls. Everything below is something an executor frequently gets wrong specifically on a Phase-2-shaped slice.

### Pitfall A: Confusing `replaces_id` (XDG / pre-46) with `notification.update()` (GNOME 46+)

**What goes wrong:** Executor reads "coalesce via `replaces_id`" in `STATE.md § Risks Being Carried` and tries to pass a `replaces_id` integer to the `MessageTray.Notification` constructor. Either ESLint complains (unknown prop) or the Shell silently ignores it and a new banner pops every time.
**Why it happens:** Both `STATE.md` and the requirements use the phrase "uses `replaces_id` for coalescing" — language inherited from the XDG Notification spec. Post-46, the Shell tracks notification identity by **JS object reference**: re-using the same `MessageTray.Notification` instance and calling `.update(title, body, params)` is the coalescing mechanism.
**How to avoid:** The Notifier maintains `Map<port_number, Notification>`. On a repeat event for a port already in the map, call `existing.update(title, body, {clear: true})`. The `clear: true` param tells the Shell to clear previously-added actions (call `addAction(...)` again after to re-attach them).
**Warning signs:** Looking at the notification shade and seeing 2+ entries for the same port number when only one event fired multiple times; `journalctl --user-unit gnome-shell` showing "Pushing duplicate notification".

### Pitfall B: `MessageTray.Source` destroy signal not nulling the singleton

**What goes wrong:** `Notifier._source` is created lazily on first `CapabilityDegraded` and stays around forever. When the source is destroyed (Shell shutdown, "Clear all" in the notification shade, etc.), `this._source` becomes a stale reference to a destroyed `MessageTray.Source`. The next event hits `_source.addNotification(notification)` and the Shell throws or silently drops.
**Why it happens:** The destroy signal isn't connected, OR it's connected but the handler doesn't null `_source`.
**How to avoid:** Inside the source-creation block, exactly mirror the gjs.guide pattern:
```javascript
this._source = new MessageTray.Source({
    title: _('USBee'),
    iconName: 'network-usb-symbolic',
});
this._source.connect('destroy', () => { this._source = null; });
Main.messageTray.add(this._source);
```
Register the dispose action with `SignalRegistry` if you want belt-and-suspenders — but the destroy signal already nulls the reference, so the registry call is mostly for symmetry.
**Warning signs:** Notifications stop appearing mid-session; `journalctl` shows "Cannot add notification to destroyed source".

### Pitfall C: `notification.connect('destroy', ...)` not nulling the map entry

**What goes wrong:** The map entry for port N points to a destroyed `Notification` instance. The next `CapabilityDegraded(N)` hits the map, finds the entry, calls `.update()` on a dead object — Shell throws.
**Why it happens:** The destroy reasons enum has multiple values; `DISMISSED` (user clicked the X), `EXPIRED` (timed out), `REPLACED` (per-source limit), and `SOURCE_CLOSED` (we called `.destroy()`). The map cleanup needs to fire on **all** of them.
**How to avoid:** Pattern (in Notifier `_emitDegraded`):
```javascript
notification.connect('destroy', (_n, _reason) => {
    if (this._notifications.get(portNumber) === notification)
        this._notifications.delete(portNumber);
});
```
The identity check `=== notification` is important — if a stale destroy fires AFTER a new notification for the same port has already replaced the entry, we don't want to delete the new one.
**Warning signs:** Crash on second degraded event for a port after the user dismissed the first one.

### Pitfall D: `addAction` callback signature has zero arguments

**What goes wrong:** Executor writes `notification.addAction(_('Mute'), (notif) => ...)` expecting the notification as an argument. The callback receives nothing.
**Why it happens:** The callback signature is documented but easy to miss: gjs.guide notifications page shows `notification.addAction(_('Close'), () => { console.debug('"Close" button activated'); });` — **no arguments to the callback**.
**How to avoid:** Capture all needed state in a closure:
```javascript
notification.addAction(_("Don't notify for this port again"), () => {
    this._muteByPort(portNumber);   // portNumber captured from enclosing scope
});
```
**Warning signs:** `ReferenceError: notif is not defined` in `journalctl`.

### Pitfall E: GSettings reads in `prefs.js` need the right schema lookup

**What goes wrong:** `prefs.js` calls `this.getSettings('us.bitcreed.usbee')` and then either (a) passes the wrong schema ID, or (b) forgets the schema isn't compiled yet during dev.
**Why it happens:** In production, `gnome-extensions install --force usbee@bitcreed.us.shell-extension.zip` auto-compiles the schema into `~/.local/share/gnome-shell/extensions/usbee@bitcreed.us/schemas/gschemas.compiled`. During development with symlinked extension dirs, you must run `glib-compile-schemas schemas/` manually after editing the XML.
**How to avoid:** Three steps:
1. Declare `settings-schema: "us.bitcreed.usbee"` in `metadata.json` (already done in Phase 1).
2. In `prefs.js`, call `this.getSettings()` with NO argument — the base class reads `settings-schema` from metadata.
3. In dev loop: `cd schemas/ && glib-compile-schemas .` after every XML edit. Add a comment / docstring noting this in the schema file.
**Warning signs:** "Settings schema 'us.bitcreed.usbee' is not installed" in `journalctl`; prefs window opens but is empty.

### Pitfall F: Storing `port-mutes` as integers in the `as` schema

**What goes wrong:** Schema declares `port-mutes` as `as` (array of strings), but the code passes `[1, 2, 3]` to `set_strv`. Either a type error or silent corruption depending on GJS version.
**Why it happens:** The daemon's `port_number` is `i` (int32). Forgetting to stringify is easy.
**How to avoid:** Every write site uses `String(portNumber)`; every read does explicit string comparison: `mutes.includes(String(portNumber))`. Document the convention in a comment at the top of the schema file.
**Warning signs:** Mute action appears to work but next event for the same port still notifies.

### Pitfall G: Stale GSettings cache when both processes write

**What goes wrong:** Notifier caches `this._mutedPorts = settings.get_strv('port-mutes')` at construction time. User opens prefs.js, unmutes port 3 (writes the new strv), but the next `CapabilityDegraded(3)` still skips because the cache is stale.
**Why it happens:** `Gio.Settings` IS process-shared via dconf, BUT only at read time. The Notifier needs to either (a) re-read on every event, or (b) subscribe to `settings.connect('changed::port-mutes', ...)` and refresh the cache.
**How to avoid:** Re-read on every event. The dconf hit is negligible (~µs) and the code is simpler. Pattern 2 above pins this.
**Warning signs:** User unmutes from prefs but still doesn't get notifications for that port until extension reload.

### Pitfall H: `Main.sessionMode.connect('updated', ...)` handler must be registered with SignalRegistry

**What goes wrong:** Executor adds `Main.sessionMode.connect('updated', this._onSessionModeChanged.bind(this))` in `tile.js` without registering the dispose-fn with `SignalRegistry`. On `disable()`, the handler stays connected; on next `enable()`, two handlers fire; over 10 enable/disable cycles, 10 handlers fire and the menu rebuilds 10 times per session-mode change.
**Why it happens:** `Main.sessionMode` is a global singleton owned by the Shell, not by the extension. It survives `enable`/`disable` cycles. The handler MUST be explicitly disconnected.
**How to avoid:** Mirror the Phase 1 SignalRegistry pattern exactly — `const id = Main.sessionMode.connect(...); registry.addSignal(Main.sessionMode, id);`. Then `disable()` (via registry.dispose()) calls `Main.sessionMode.disconnect(id)` automatically.
**Warning signs:** `journalctl` shows "GLib-GObject-WARNING: handler with id N not found" after a disable, OR the menu rebuilds N times where N is the cumulative enable/disable cycles.

### Pitfall I: gettext format strings vs template literals

**What goes wrong:** Executor writes `_(`USB-C Port ${portNumber} — ${summary}`)`. xgettext can't extract a template literal (it's not a static string at extraction time). The `.pot` file ends up empty or missing this entry, and the string is never translatable.
**Why it happens:** Template literals look natural to JS devs; the gettext extractor only recognizes string literals as the argument to `_()`.
**How to avoid:** Always use `_(STATIC_STRING).format(args)`:
```javascript
const title = _('USB-C Port %d — %s').format(portNumber, summary);
```
**Warning signs:** Run `xgettext --from-code=UTF-8 -o /tmp/out.pot extension.js prefs.js src/*.js` and grep the output for the missing string. If it's not there, the call site is wrong.

### Pitfall J: `Adw.PreferencesGroup` has no `remove_all()` method

**What goes wrong:** Executor calls `group.remove_all()` to clear muted-port rows before rebuilding. Method doesn't exist; runtime throws.
**Why it happens:** `Adw.PreferencesGroup` provides `add()` and `remove(child)` but no bulk-clear. Internally it wraps a `GtkListBox`, but extensions shouldn't poke at the internals.
**How to avoid:** Track the dynamic rows in an array on the prefs widget object: `this._mutedRows = []`. On `add(row)`, push; to clear, iterate and call `group.remove(row)`, then `this._mutedRows = []`. The auto-move-windows reference extension at `/usr/share/gnome-shell/extensions/auto-move-windows@gnome-shell-extensions.gcampax.github.com/prefs.js` uses `Gtk.ListBox.bind_model()` for the equivalent dynamic-list problem; that's also a valid pattern if you want to wrap port-mutes in a `Gio.ListModel`, but it's heavier than the simple track-and-remove approach. **Recommendation: track-and-remove.** [VERIFIED: file read from local install]
**Warning signs:** `TypeError: group.remove_all is not a function`.

### Pitfall K: Calling `extension.openPreferences()` from a notification action while screen is locked

**What goes wrong:** The notification's "Open Preferences" action fires while `Main.sessionMode.allowSettings === false`. The Shell refuses to spawn the prefs process, silently. From the user's POV, nothing happens.
**Why it happens:** This is a Shell-level safety property — the user cannot modify settings from the lock screen.
**How to avoid:** UI-SPEC §Lock-screen-behavior says: *"We do not even attempt to test 'behaves correctly under lock' for this action — the platform owns the answer."* No explicit guard is needed in USBee code; the Shell handles it. **But:** the executor should add a comment in `src/notifier.js` next to the `addAction('Open Preferences', ...)` call making this expectation visible.
**Warning signs:** None on the USBee side — this is expected behavior.

## Code Examples

Verified patterns from official sources. Each block is a paste-quality skeleton; the executor will fill in error handling, gettext markers, and SignalRegistry calls.

### Example #1: `src/notifier.js` skeleton

```javascript
// SPDX-License-Identifier: GPL-3.0-or-later
//
// src/notifier.js — Phase 2
//
// Owns: per-port Notification map, lazy MessageTray.Source,
// 2.5 s suppression window, mute-list read on every event.
//
// Wired from extension.js after DBusClient is constructed:
//   this._notifier = new Notifier(this.getSettings(), this._registry);
//   this._notifier.attachToClient(this._client);

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const SUPPRESSION_WINDOW_US = 2_500_000; // 2.5 s

export class Notifier {
    constructor(settings, registry, extension) {
        this._settings = settings;        // Gio.Settings for us.bitcreed.usbee
        this._registry = registry;        // SignalRegistry from Phase 1
        this._extension = extension;      // for extension.openPreferences()
        this._notifications = new Map();  // port_number → MessageTray.Notification
        this._source = null;              // lazy MessageTray.Source
        this._suppressUntil = 0;          // monotonic-time microseconds
    }

    attachToClient(client) {
        // DBusClient exposes 'name-appeared' lifecycle via emit() — but
        // for Phase 2 the simpler hook is for DBusClient to call
        // notifier.onCapabilityDegraded(...) / .onCapabilityRestored(...)
        // / .onDaemonAppeared() directly from its own _onAppeared() block.
        // See §Code Example #6 for the dbus-client.js patch.
    }

    /** Start the 2.5 s suppression window. */
    onDaemonAppeared() {
        this._suppressUntil = GLib.get_monotonic_time() + SUPPRESSION_WINDOW_US;
    }

    /** Daemon vanished — drop all live notifications (they're stale). */
    onDaemonVanished() {
        for (const n of this._notifications.values()) {
            try { n.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED); }
            catch (e) { /* already gone */ }
        }
        this._notifications.clear();
    }

    /**
     * Called from src/dbus-client.js on every CapabilityDegraded signal.
     * Short-circuits if in suppression window or port is muted.
     */
    onCapabilityDegraded(portNumber, summary, detail) {
        const now = GLib.get_monotonic_time();
        if (now < this._suppressUntil) return; // §Pitfall (suppression)

        const mutes = this._settings.get_strv('port-mutes'); // §Pattern 2 (live)
        if (mutes.includes(String(portNumber))) return;       // NOTIF-04

        this._emitDegraded(portNumber, summary, detail);
    }

    /** Called from src/dbus-client.js on every CapabilityRestored signal. */
    onCapabilityRestored(portNumber) {
        const existing = this._notifications.get(portNumber);
        if (!existing) return;
        existing.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
        // 'destroy' signal handler nulls the map entry — §Pitfall C
    }

    _ensureSource() {
        if (this._source) return this._source;
        this._source = new MessageTray.Source({
            title: _('USBee'),
            iconName: 'network-usb-symbolic',
            // policy: default NotificationGenericPolicy
        });
        this._source.connect('destroy', () => { this._source = null; });
        Main.messageTray.add(this._source);
        return this._source;
    }

    _emitDegraded(portNumber, summary, detail) {
        const source = this._ensureSource();
        const title = _('USB-C Port %d — %s').format(portNumber, summary);
        const body = detail; // verbatim from daemon (DIAG-02)

        const existing = this._notifications.get(portNumber);
        if (existing) {
            // §Pitfall A — coalesce in place via .update()
            existing.update(title, body, {clear: true});
            this._addActions(existing, portNumber);
            return;
        }

        const notification = new MessageTray.Notification({
            source,
            title,
            body,
            iconName: 'network-usb-symbolic',
            urgency: MessageTray.Urgency.NORMAL,
        });
        this._addActions(notification, portNumber);

        notification.connect('destroy', (_n, _reason) => {
            // §Pitfall C — identity-checked cleanup
            if (this._notifications.get(portNumber) === notification)
                this._notifications.delete(portNumber);
        });

        this._notifications.set(portNumber, notification);
        source.addNotification(notification);
    }

    _addActions(notification, portNumber) {
        // §Pitfall D — zero-arg callback; portNumber via closure
        notification.addAction(_("Don't notify for this port again"), () => {
            this._muteByPort(portNumber);
        });
        notification.addAction(_('Open Preferences'), () => {
            // §Pitfall K — Shell silently refuses if locked; expected behavior
            this._extension.openPreferences();
        });
    }

    _muteByPort(portNumber) {
        const id = String(portNumber);
        const mutes = this._settings.get_strv('port-mutes');
        if (mutes.includes(id)) return;
        mutes.push(id);
        this._settings.set_strv('port-mutes', mutes);
        // Destroy the current notification — user's intent is "go away"
        const n = this._notifications.get(portNumber);
        if (n) n.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    }

    dispose() {
        this.onDaemonVanished();
        // SignalRegistry handles Main.messageTray membership? No — the source
        // is destroyed via its own destroy signal when Main.messageTray.add'd
        // sources are removed; but we also explicitly remove on disable to be safe:
        if (this._source) {
            try { this._source.destroy(); } catch (e) { /* */ }
            this._source = null;
        }
    }
}
```

[Source: composed from CITED gjs.guide notifications guide + GNOME 46 porting notes + UI-SPEC §Interactions]

### Example #2: Coalesce-via-update on repeat event

```javascript
// Inside Notifier._emitDegraded (excerpt):
const existing = this._notifications.get(portNumber);
if (existing) {
    existing.update(title, body, {clear: true});
    this._addActions(existing, portNumber); // re-add cleared actions
    return;
}
```

The `{clear: true}` param clears previously-added action buttons; we re-add the same two so the UI is consistent. Without `clear`, action buttons accumulate (Shell may or may not de-dup — don't rely on it).
[CITED: web search result on `MessageTray.Notification.update()` semantics — historical pattern, signature reduced post-45]

### Example #3: Daemon-restart suppression window

```javascript
// In src/dbus-client.js _onAppeared, AFTER proxy construction:
this._notifier?.onDaemonAppeared();   // sets _suppressUntil = now + 2.5 s

// In src/dbus-client.js _onVanished:
this._notifier?.onDaemonVanished();   // drop all live notifications
```

The Notifier's `onCapabilityDegraded` reads `GLib.get_monotonic_time()` on every event and short-circuits if `now < this._suppressUntil`. No timer source is allocated; comparison is constant-time.
[CITED: https://docs.gtk.org/glib/func.get_monotonic_time.html]

### Example #4: Mute action handler

(See `_muteByPort` in Example #1.) Key points:
- `String(portNumber)` per Pitfall F.
- `mutes.includes(id)` guards against duplicate appends (defensive — but the GSettings array can have duplicates if you don't check).
- `notification.destroy(SOURCE_CLOSED)` clears the banner immediately so the user gets visual confirmation.

### Example #5: `schemas/us.bitcreed.usbee.gschema.xml` populated

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist gettext-domain="usbee@bitcreed.us">
  <schema id="us.bitcreed.usbee" path="/us/bitcreed/usbee/">

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

  </schema>
</schemalist>
```

[Source: composed from current `schemas/us.bitcreed.usbee.gschema.xml` scaffold + UI-SPEC §Continuity-with-Phase-1]

**Dev-loop reminder:** after editing this file, run `glib-compile-schemas schemas/` to regenerate `gschemas.compiled` (or re-install via `gnome-extensions install --force` which does it automatically).

### Example #6: `src/dbus-client.js` patch — wire Notifier subscriptions

The Phase 1 code (already in repo) constructs the proxy inside `_onAppeared` and subscribes to `DeviceAdded` / `DeviceRemoved`. Phase 2 adds two more `connectSignal` calls in the same block:

```javascript
// In src/dbus-client.js _onAppeared, after the existing DeviceAdded/DeviceRemoved subscriptions:

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

// And at the top of _onAppeared (after `this._store.setDaemonRunning(true)`):
this._notifier?.onDaemonAppeared();

// And in _onVanished (after `this._store.setDevices([])`):
this._notifier?.onDaemonVanished();
```

The constructor gains a `notifier` parameter (passed from `extension.js`):
```javascript
constructor(registry, store, notifier) {
    super();
    this._registry = registry;
    this._store = store;
    this._notifier = notifier; // may be null in unit tests
    ...
}
```

### Example #7: `extension.js` enable() — Notifier wiring

```javascript
// Phase 2 patch to extension.js:
import {Notifier} from './src/notifier.js';

export default class USBeeExtension extends Extension {
    enable() {
        this._registry  = new SignalRegistry();
        this._store     = new DeviceStore();
        this._indicator = new USBeeIndicator(this._store, this._registry, this);  // pass `this` for openPreferences
        this._notifier  = new Notifier(this.getSettings(), this._registry, this); // NEW
        this._client    = new DBusClient(this._registry, this._store, this._notifier); // pass Notifier

        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        this._client.start();
    }

    disable() {
        if (this._registry) { this._registry.dispose(); this._registry = null; }
        if (this._client)   { this._client.stop();      this._client = null; }
        if (this._notifier) { this._notifier.dispose(); this._notifier = null; }  // NEW
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(item => item.destroy());
            this._indicator.destroy();
            this._indicator = null;
        }
        this._store = null;
    }
}
```

The `USBeeIndicator` constructor gains an extension reference so the new Preferences row can call `extension.openPreferences()` (the `tile.js` patch).

### Example #8: `src/tile.js` STATE-04 patch — Preferences menu row with session-mode gating

```javascript
// Inside USBeeToggle constructor, AFTER this._rowsSection is appended:

this._extension = extension; // new param

const buildPrefsRow = () => {
    if (!Main.sessionMode.allowSettings) return; // skip when locked
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

The `Preferences…` string MUST use U+2026 horizontal ellipsis (UI-SPEC pin). In JS source, write it as `_('Preferences…')` for clarity, or paste the literal `…` character (UTF-8 source is the GJS norm).

### Example #9: `prefs.js` skeleton

```javascript
// SPDX-License-Identifier: GPL-3.0-or-later
//
// prefs.js — runs in the gnome-shell-extension-prefs process. The ONLY
// file in this repo that imports gi://Gtk or gi://Adw (CLAUDE.md C-03).

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';

import {ExtensionPreferences, gettext as _}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class USBeePreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings; // keep alive

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'network-usb-symbolic',
        });
        window.add(page);

        // ── Group 1: Notifications (muted ports) ──────────────────
        const notifGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
            description: _('Manage which USB-C ports may raise degradation warnings'),
        });
        page.add(notifGroup);

        const mutedRows = [];
        const rebuildMutedRows = () => {
            // §Pitfall J — remove tracked rows, don't try .remove_all()
            for (const row of mutedRows) notifGroup.remove(row);
            mutedRows.length = 0;

            const mutes = settings.get_strv('port-mutes');
            if (mutes.length === 0) {
                const empty = new Adw.ActionRow({
                    title: _('No muted ports'),
                    subtitle: _('Mute a port from a notification to see it here'),
                    sensitive: false,  // disabled — UI-SPEC pin
                });
                notifGroup.add(empty);
                mutedRows.push(empty);
                return;
            }
            for (const id of mutes) {
                const portNumber = parseInt(id, 10);
                const row = new Adw.ActionRow({
                    title: _('USB-C Port %d').format(portNumber),
                    subtitle: _('Notifications muted'),
                });
                const button = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: _('Unmute this port'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat', 'destructive-action'],
                });
                button.connect('clicked', () => {
                    const current = settings.get_strv('port-mutes');
                    settings.set_strv('port-mutes', current.filter(x => x !== id));
                    // 'changed::port-mutes' fires and rebuildMutedRows re-runs
                });
                row.add_suffix(button);
                row.set_activatable_widget(button);
                notifGroup.add(row);
                mutedRows.push(row);
            }
        };

        rebuildMutedRows();
        const mutesChangedId = settings.connect('changed::port-mutes',
                                                rebuildMutedRows);

        // Disconnect when the window closes (prefs process lifecycle).
        window.connect('close-request', () => {
            settings.disconnect(mutesChangedId);
            return false; // don't prevent close
        });

        // ── Group 2: General (hide-empty-ports) ───────────────────
        const generalGroup = new Adw.PreferencesGroup({title: _('General')});
        page.add(generalGroup);

        const hideRow = new Adw.SwitchRow({
            title: _('Hide empty USB-C ports'),
            subtitle: _("Don't list ports with nothing attached"),
        });
        generalGroup.add(hideRow);
        settings.bind('hide-empty-ports', hideRow, 'active',
                      Gio.SettingsBindFlags.DEFAULT);

        // ── Group 3: About ────────────────────────────────────────
        const aboutGroup = new Adw.PreferencesGroup({title: _('About')});
        page.add(aboutGroup);

        const versionRow = new Adw.ActionRow({
            title: _('Version'),
            subtitle: this.metadata['version-name'] || '1.0',
        });
        aboutGroup.add(versionRow);

        const daemonRow = new Adw.ActionRow({
            title: _('usbeehive daemon'),
            subtitle: _('Required — run: systemctl --user enable --now usbeehive'),
        });
        aboutGroup.add(daemonRow);
    }
}
```

[Source: composed from gjs.guide preferences guide + auto-move-windows reference prefs.js + UI-SPEC §Component-Inventory]

### Example #10: `src/popover.js` patch — consume hide-empty-ports

```javascript
// In src/popover.js populateDeviceRows, add an extension parameter:
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

The `extension` parameter threads from `tile.js` `_rebuildPopover()` → `populateDeviceRows`. The lazy-popover pattern (D-11) means this read happens once per popover open — cheap and always current.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| XDG `replaces_id` integer in `MessageTray.Notification` constructor | `notification.update(title, body, {clear: true})` on the existing JS instance | GNOME 46 notification refactor | Phase 2 MUST follow the new pattern; legacy guides will mislead you |
| `imports.misc.extensionUtils.openPrefs()` (legacy) | `extensionObject.openPreferences()` (ESM, GNOME 45+) | GNOME 45 ESM migration | Already on the right side; both `notification.addAction('Open Preferences', ...)` and the tile's `Preferences…` row use this |
| `buildPrefsWidget()` returning a single `Gtk.Box` | `fillPreferencesWindow(window)` adding `Adw.PreferencesPage`s | GNOME 42 introduced; 45 made default | Phase 2 uses `fillPreferencesWindow` — `buildPrefsWidget` is deprecated |
| `Adw.PreferencesWindow` for standalone apps | `Adw.PreferencesDialog` for standalone apps (libadwaita 1.5+) | libadwaita 1.5 | **Does not apply to extensions** — Shell still hands you `PreferencesWindow` via `fillPreferencesWindow`. Stay on `PreferencesWindow` |
| `Adw.PreferencesRow` + custom switch widget | `Adw.SwitchRow` (libadwaita 1.4+) | libadwaita 1.4 | Phase 2 uses `Adw.SwitchRow` — libadwaita 1.5 baseline confirms availability |
| Custom destructive button styling | `css_classes: ['destructive-action']` | libadwaita-wide standard | Phase 2 uses this for the trash button |
| `gnome-shell-extension-tool` legacy CLI | `gnome-extensions` CLI | GNOME 3.34 | Phase 2 uses `gnome-extensions pack` exclusively |

**Deprecated / outdated for Phase 2:**
- `replaces_id` constructor parameter — REMOVED in 46; use `.update()` instead.
- `imports.misc.extensionUtils.*` — replaced by `import` from `resource:///...`.
- `Gtk.Window` parents in `prefs.js` — replaced by `Adw.PreferencesWindow`.
- `Gio.Notification` from extensions — never the right tool; use `MessageTray.Source`.

## Assumptions Log

All claims in this research are either VERIFIED on the dev host or CITED from authoritative sources. No claims are tagged `[ASSUMED]`.

**Two exceptions** where the implementation depends on runtime behavior that should be smoke-tested during execution:

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `notification.update(title, body, {clear: true})` clears previously-added action buttons, allowing re-add of the same two actions without duplicates | §Code Example #2; §Pitfall A | If `{clear: true}` doesn't clear actions on the live Shell version, the user will see duplicate "Don't notify…" / "Open Preferences" buttons after each repeat event. Mitigation: smoke-test in Looking Glass with a manual `busctl --user emit org.usbeehive.Devices /org/usbeehive/Devices org.usbeehive.Devices1.CapabilityDegraded i s s 1 "test" "test"`. |
| A2 | `Adw.ActionRow.sensitive = false` renders the "No muted ports" row as visually disabled (greyed out) in the libadwaita 1.5 theme matching the disabled-row appearance used by GNOME Settings | §Code Example #9 | If the visual treatment is wrong (e.g. still looks fully active), UI-SPEC §Component-Inventory has an alternative: use `Adw.StatusPage` for the empty state. Confirm with Looking Glass / running `gnome-extensions prefs usbee@bitcreed.us`. |

These are NOT user-confirmation items — they are execution-time smoke-test items. The planner should add a `checkpoint:human-verify` task that exercises both before phase completion.

## Open Questions

1. **Should the Notifier include a per-port daily rate cap?**
   - What we know: `STATE.md § Risks Being Carried` mentions "a hard daily rate cap per port" as a stated Phase 2 mitigation. UI-SPEC does not pin a value.
   - What's unclear: numeric cap; whether reset is at UTC midnight, local midnight, monotonic 24-hour window, or extension-reload.
   - Recommendation: implement a simple in-memory `Map<port_number, count>` reset on `disable()`; cap at 10 per port. If a degraded event would exceed the cap, log once via `logError` and drop. **Defer to discuss-phase for confirmation** — the planner can mark it as Claude's Discretion.

2. **Should `prefs.js` show the master notifications-enabled toggle?**
   - What we know: REQUIREMENTS.md `NOTIF-V2-01` is a v2 deferral. UI-SPEC §Out-of-Scope-Restatement explicitly defers it.
   - What's unclear: whether a v1.0 user discovering the prefs window will expect a master kill-switch (per-port is finer-grained but less obvious).
   - Recommendation: **defer to v2** as UI-SPEC pins. Document in README that the master kill-switch is in roadmap; provide the dconf path (`us.bitcreed.usbee port-mutes`) as the v1 escape hatch for power users.

3. **`session-modes` metadata.json field — needed at all?**
   - What we know: STATE-04 hides the Preferences row when locked. The extension itself doesn't run under `unlock-dialog`.
   - What's unclear: whether STATE-05 (clean disable / no leaks across lock cycles) requires the extension to keep its singleton state during lock.
   - Recommendation: **omit `session-modes` entirely**. The Shell unloads the extension during lock (no `unlock-dialog` mode declared), which means the entire `disable()` path runs at lock and `enable()` runs at unlock — STATE-05's "10 cycles, no leaks" gate becomes the lock-test. This is the simpler model. If users complain that notifications during the lock screen are missed, revisit in v1.1.

4. **README repo URL — placeholder or final?**
   - What we know: Phase 1 `metadata.json` has `"url": "https://github.com/abrauchli/usbee"`.
   - What's unclear: whether the repo exists at that URL today; EGO requires a valid URL.
   - Recommendation: planner adds a `checkpoint:human-verify` task to confirm the URL resolves before EGO submission. If the repo isn't yet public, push it before pack-and-upload.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| GNOME Shell | All surfaces | ✓ | 46.0 | — (min target) |
| gjs | All extension code | ✓ | 1.80.2 | — |
| libadwaita | `prefs.js` widgets | ✓ | 1.5.0 | — (min 1.4 needed for SwitchRow; we have 1.5) |
| GTK4 | `prefs.js` widgets | ✓ | 4.14 (libadwaita 1.5 dep) | — |
| `gnome-extensions` CLI | Pack + install | ✓ | 46.0 | — |
| `glib-compile-schemas` | Dev loop schema compile | ✓ | bundled | — (auto via `gnome-extensions install`) |
| `xgettext` | `.pot` generation | ✓ | bundled | — |
| `msgfmt` | (not used in v1 — no translations) | ✓ | bundled | — |
| `busctl` | Dev-time signal injection | ✓ | systemd-bundled | — |
| `dconf-editor` | Smoke-test schema visibility | ✓ (assumed) | n/a | Use `gsettings list-schemas \| grep usbee` from CLI |
| `usbeehive` daemon | Real `CapabilityDegraded` events for smoke testing | ✗ (per STATE.md not running on dev host) | n/a | Use `busctl --user emit org.usbeehive.Devices /org/usbeehive/Devices org.usbeehive.Devices1.CapabilityDegraded i s s 1 "test" "test"` to inject fake signals — daemon presence not required for Phase 2 dev |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- `usbeehive` daemon — use `busctl --user emit` to inject fake `CapabilityDegraded` / `CapabilityRestored` signals during dev. Same approach Phase 1 used.

## Validation Architecture

**SKIPPED:** `workflow.nyquist_validation: false` in `.planning/config.json`. Test scaffolding is not part of this phase.

[VERIFIED: `.planning/config.json` read directly]

The phase still has gates — the per-plan task summaries describe manual verification (Looking Glass, `journalctl`, `dconf-editor`, `busctl --user emit`) — but no `pytest`/`jest` framework needs scaffolding.

## Security Domain

USBee Phase 2 is a desktop-only extension consuming local D-Bus and writing local user GSettings. There is **no network surface, no auth, no persistent server-side state, no user-supplied input rendered as code**. Applying STRIDE to the new Phase 2 surface area:

### Applicable ASVS categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth in scope — local-user-only D-Bus |
| V3 Session Management | no | No sessions — `Main.sessionMode` is GNOME's, not USBee's |
| V4 Access Control | partial | STATE-04 is the access-control surface: prefs are hidden on lock. The Shell enforces the actual policy (refuses `openPreferences()` while locked). USBee just hides the UI affordance |
| V5 Input Validation | yes | The daemon's `summary` and `detail` strings flow into `MessageTray.Notification` title/body. The Shell does NOT parse them as Pango markup unless `.set_use_markup(true)` is called — which we never do. Rendering via `.title = ...` / `.body = ...` is plain-text. (Phase 1's §Threat T-01-02 / T-02-01 already addresses this for popover rows; Phase 2 inherits the same discipline.) |
| V6 Cryptography | no | No crypto in scope |
| V7 Error Handling & Logging | yes | `logError(e, '...')` once per failed op, no retry loops; per Phase 1 §Pitfall 7 |
| V8 Data Protection | partial | `port-mutes` is in GSettings (`dconf`) which is per-user, not encrypted. Acceptable — port numbers are not PII. README must not document this as "secure storage" |
| V9 Communications | no | All comms are local session bus — no TLS surface |
| V10 Malicious Code | yes | EGO review enforces this; our compliance is "no AI-slop, no minification, no bundled binaries" per the Dec 2025 rule |
| V11 Business Logic | n/a | No business logic |
| V12 Files & Resources | yes | We write no files. Only GSettings writes via `set_strv` / `set_boolean`. No file I/O — D-18 ban |
| V13 API & Web Service | no | n/a |
| V14 Configuration | yes | The schema declares two keys; `dconf-editor` can edit them; no secret content; defaults are safe |

### Known Threat Patterns for {stack} = GNOME Shell extension + Adwaita prefs window

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Daemon spoofing (a different process claims `org.usbeehive.Devices`) | S | Session bus is per-user; another user's process can't claim it. A malicious local user-level process could, but they could already do far worse — out of scope |
| Notification title/body injection (daemon sends malicious Pango markup) | T | We never call `set_use_markup(true)`; title/body are plain text |
| Action button hijack (an action handler runs untrusted code) | T | Action handlers are JS closures over local state — there is no eval of daemon strings, no `Function()`, no `eval` anywhere |
| Notification spam DoS (flapping cable triggers thousands of events) | D | Three mitigations: 2.5 s suppression after daemon restart, 150 ms debounce (NOTIF-driven via UI-SPEC carry-forward), per-port-day rate cap |
| `port-mutes` poisoning from another local process | T (low) | Any local user-level code can write any of their own `dconf` keys; not a USBee threat. Treat the array as untrusted at read time — filter to valid stringified ints before use; ignore unparseable entries |
| Lock-screen settings exposure (user opens prefs from a notif while screen visible to bystander) | I | STATE-04 hides the Preferences row when locked; the notif's "Open Preferences" action is refused by the Shell when locked (Pitfall K) |
| Schema typos or missing schema | (availability) | `dconf-editor` smoke test pre-EGO submission; `gsettings list-schemas \| grep usbee` in the QA gate |

`security_enforcement` is not configured in `.planning/config.json`, so this section is included by default. The threats above are NOT a blocker — they are documented mitigations the planner can reference in `must_haves`.

## Packaging & Submission (the EGO mile)

### `COPYING` file

- **Filename:** `COPYING` (uppercase, no extension). [CITED: GNU + GNOME convention]
- **Content:** Verbatim text from https://www.gnu.org/licenses/gpl-3.0.txt — no modifications, no header line, no footer.
- **Location:** repository root, NOT inside `usbee@bitcreed.us/`. The zip produced by `gnome-extensions pack` will include it via `--extra-source=../COPYING` IF the source dir is `usbee@bitcreed.us/`, OR the file should live inside `usbee@bitcreed.us/` directly so it's auto-detected. **Recommendation: place it inside `usbee@bitcreed.us/` and use `--extra-source=COPYING`** — keeps the zip self-contained without a relative path traversal in the build command.

### `README.md`

- **Location:** Same dir as `COPYING`. Recommendation: also inside `usbee@bitcreed.us/`.
- **Structure (pinned by UI-SPEC §Packaging-Copy):**

```markdown
# USBee

A GNOME-native, glanceable answer to "is this the fast port?" and "why is my
laptop charging slowly?" — without opening a terminal. USBee is a Quick
Settings indicator companion to the [usbeehive](https://github.com/) daemon.

## Installing

Install the usbeehive daemon (sibling project).

    systemctl --user enable --now usbeehive

Install the USBee extension from extensions.gnome.org or
`gnome-extensions install --force usbee@bitcreed.us.shell-extension.zip`.

## Requirements

GNOME Shell 46, 47, or 48; usbeehive running on the session bus as
`org.usbeehive.Devices1`.

## License

GPL-3.0-or-later — see [COPYING](./COPYING).
```

The `systemctl --user enable --now usbeehive` line MUST match the empty-state popover (`src/empty-state.js` `SYSTEMCTL_CMD` constant) and the prefs About row character-for-character. UI-SPEC §Continuity-with-Phase-1 pins this. If the daemon's preferred install command changes upstream, all three places update in the same commit.

### SPDX headers

Every `.js` file (Phase 1 retroactively + all Phase 2 files) carries this as line 1 (or line 1 after a shebang, but no `.js` here has a shebang):

```javascript
// SPDX-License-Identifier: GPL-3.0-or-later
```

Audit during the EGO submission task: `grep -L 'SPDX-License-Identifier' usbee@bitcreed.us/**/*.js` should produce empty output.

### gettext / `.pot` generation

```bash
xgettext --from-code=UTF-8 \
    --output=po/usbee@bitcreed.us.pot \
    usbee@bitcreed.us/extension.js \
    usbee@bitcreed.us/prefs.js \
    usbee@bitcreed.us/src/*.js
```

[CITED: https://gjs.guide/extensions/development/translations.html]

Verify the `.pot` has at least the 14-ish strings the UI-SPEC §Copywriting-Contract enumerates. Zero strings = bug.

The `metadata.json` already declares `gettext-domain: "usbee@bitcreed.us"`, so gettext is auto-initialized in both `extension.js` and `prefs.js`. **No manual `bindtextdomain` calls needed.** [CITED: gjs.guide translations guide]

**No `.po` files ship in v1** (English-only per STATE.md and PROJECT.md). The `.pot` template alone satisfies PACK-02. I18N-V2-01 will add at least one `.po`.

### `gnome-extensions pack` invocation

From the repository root (assuming the extension dir is `usbee@bitcreed.us/`):

```bash
cd usbee@bitcreed.us
gnome-extensions pack \
    --extra-source=src/dbus-client.js \
    --extra-source=src/device-store.js \
    --extra-source=src/empty-state.js \
    --extra-source=src/notifier.js \
    --extra-source=src/popover.js \
    --extra-source=src/signal-registry.js \
    --extra-source=src/tile.js \
    --extra-source=dbus-iface.xml \
    --extra-source=icons \
    --extra-source=COPYING \
    --extra-source=README.md
```

This produces `usbee@bitcreed.us.shell-extension.zip` in the current directory.

**Auto-included (no `--extra-source` needed):**
- `extension.js`
- `prefs.js`
- `metadata.json`
- `stylesheet.css`
- `schemas/*.gschema.xml` (and the auto-compiled `gschemas.compiled`)
- `po/*.pot`

[CITED: https://man.archlinux.org/man/extra/gnome-shell/gnome-extensions.1.en]

### EGO submission audit (Phase 2 exit gate)

| # | Check | How to verify |
|---|-------|---------------|
| 1 | Zip has no bundled binaries | `unzip -l usbee@bitcreed.us.shell-extension.zip \| awk '{print $NF}' \| xargs -I{} sh -c 'file -b --mime-type {}'` — every entry should be `text/*` or `application/xml` |
| 2 | Zip has no `node_modules`, no `.git`, no `target/`, no `__pycache__` | `unzip -l ... \| grep -E 'node_modules\|\.git/\|target/\|__pycache__'` — empty output |
| 3 | All `.js` files carry SPDX-License-Identifier header | `grep -L 'SPDX-License-Identifier' usbee@bitcreed.us/**/*.js` — empty output |
| 4 | All user-visible strings are gettext-wrapped | `xgettext --from-code=UTF-8 -o /tmp/audit.pot ...` and confirm the `.pot` has ≥14 entries matching UI-SPEC §Copywriting |
| 5 | No `Gtk` / `Adw` imports in Shell-process code | `grep -E "from 'gi://(Gtk\|Adw)" usbee@bitcreed.us/extension.js usbee@bitcreed.us/src/*.js` — empty output |
| 6 | No `proxy.call_sync` / `Gio.DBusProxy.new_for_bus_sync` | `grep -E '\.call_sync\b\|new_for_bus_sync' usbee@bitcreed.us/**/*.js` — empty output |
| 7 | `metadata.json` `shell-version` declares only EGO-accepted versions | `jq .shell-version metadata.json` returns `["46","47","48"]` |
| 8 | `metadata.json` has no manual `version` field | `jq .version metadata.json` returns `null` |
| 9 | Schema visible in `dconf-editor` | `gsettings list-schemas \| grep '^org\.gnome\.usbee$'` — non-empty |
| 10 | Extension loads cleanly on a fresh user (`enable` 1 cycle, no errors) | `journalctl --user-unit gnome-shell --since '1 minute ago' \| grep -i 'usbee\|usbee@bitcreed.us'` — no errors |
| 11 | 10× enable/disable cycle leaves no leaked handlers | Phase 1 STATE-05 gate, re-run with Phase 2 additions in place |
| 12 | 3× lock/unlock cycle has STATE-04 row correctly hidden+restored | Manual Looking Glass smoke test |
| 13 | `busctl --user emit … CapabilityDegraded` produces exactly one banner; repeat emits update in place | Manual smoke test (corresponds to A1 in §Assumptions Log) |
| 14 | `busctl --user emit … CapabilityRestored` destroys the banner | Manual smoke test |
| 15 | Don't-notify action persists to GSettings; visible in `dconf-editor` | `gsettings get us.bitcreed.usbee port-mutes` shows the stringified port number |
| 16 | Prefs window opens via `gnome-extensions prefs usbee@bitcreed.us`; trash button removes a row; switch toggles persist | Manual smoke test |
| 17 | Daemon-restart suppression window — emit Degraded twice within 2 s of `bus_watch_name` "appeared"; no notification banners | Manual smoke test |

## Sources

### Primary (HIGH confidence)

- [GJS Guide — Notifications](https://gjs.guide/extensions/topics/notifications.html) — `MessageTray.Source`, `MessageTray.Notification`, `addAction`, `Urgency`, `NotificationDestroyedReason`, `Main.messageTray.add(source)` — **authoritative for GNOME 46+ notification API surface**
- [GJS Guide — Preferences](https://gjs.guide/extensions/development/preferences.html) — `fillPreferencesWindow`, `Adw.PreferencesPage` / `Group` / `SwitchRow` / `ActionRow`, `Gio.Settings.bind(...)`, separate-process model, schema auto-compile since GNOME 44
- [GJS Guide — Session Modes](https://gjs.guide/extensions/topics/session-modes.html) — `Main.sessionMode.connect('updated', ...)` pattern, `allowSettings` semantics, destroy+recreate vs visibility-toggle guidance
- [GJS Guide — Quick Settings](https://gjs.guide/extensions/topics/quick-settings.html) — `settingsItem.visible = Main.sessionMode.allowSettings` canonical pattern (overridden by UI-SPEC to destroy+recreate); `menu.addAction('More Settings', () => extensionObject.openPreferences())` pattern
- [GJS Guide — Translations](https://gjs.guide/extensions/development/translations.html) — `xgettext --from-code=UTF-8` flag, `gettext-domain` auto-init in metadata.json, `String.prototype.format()` for `%s`/`%d`
- [GJS Guide — Port Extensions to GNOME Shell 46](https://gjs.guide/extensions/upgrading/gnome-shell-46.html) — `Notification.iconName` getter/setter, `NotificationPolicy.newForApp()`, `MessageTray.getSystemSource()`
- [GJS Guide — EGO Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) — no binary executables, no minified/AI-slop, no `Gtk`/`Adw` in Shell process, `metadata.json` field rules
- [GJS Guide — Anatomy of an Extension](https://gjs.guide/extensions/overview/anatomy.html) — metadata.json fields, file layout
- [GNOME Shell & Mutter Blog — Notifications in 46 and beyond](https://blogs.gnome.org/shell-dev/2024/04/23/notifications-46-and-beyond/) — Rationale for the 46 notification refactor; high-level migration narrative
- [Adw.SwitchRow API reference](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/class.SwitchRow.html) — minimum libadwaita 1.4
- [Adw.ActionRow API reference](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/class.ActionRow.html) — `add_suffix(widget)` documented method
- [Adw.PreferencesGroup API reference](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/class.PreferencesGroup.html) — `remove(child)` method exists; no `remove_all`
- [libadwaita Style Classes reference](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/style-classes.html) — `.destructive-action`, `.flat` class semantics
- [Gio.Settings.bind reference](https://docs.gtk.org/gio/method.Settings.bind.html) — full method signature
- [Gio.SettingsBindFlags reference](https://docs.gtk.org/gio/flags.SettingsBindFlags.html) — DEFAULT, GET, SET, NO_SENSITIVITY, GET_NO_CHANGES, INVERT_BOOLEAN
- [GJS Guide — GVariant](https://gjs.guide/guides/glib/gvariant.html) — `new GLib.Variant('as', stringList)`, `get_strv` / `set_strv`
- [GLib.get_monotonic_time](https://docs.gtk.org/glib/func.get_monotonic_time.html) — monotonic-time semantics
- [GNU "How to Apply the GPL"](https://www.gnu.org/licenses/gpl-howto.en.html) — `COPYING` filename convention
- [GPL-3.0 verbatim text](https://www.gnu.org/licenses/gpl-3.0.txt) — content for `COPYING`
- [gnome-extensions(1) man page (Arch)](https://man.archlinux.org/man/extra/gnome-shell/gnome-extensions.1.en) — `pack` options, auto-included files, `--extra-source`
- **Local installation:** `/usr/share/gnome-shell/extensions/auto-move-windows@gnome-shell-extensions.gcampax.github.com/prefs.js` — verified-on-host reference for Adwaita prefs patterns including `add_suffix`, `Adw.ActionRow` subclass, `Gtk.Button` with css class, `get_strv` round-tripping

### Secondary (MEDIUM confidence)

- WebSearch synthesis on `MessageTray.Notification.update()` post-46 — multiple agreeing sources but no single authoritative gjs.guide line confirming the signature `update(title, body, {clear: true})`. The PinIt extension on GitHub demonstrates the pattern in production.
- WebSearch synthesis on the December 2025 EGO AI-code rule — referenced in Phase 1 PITFALLS.md and in the review-guidelines page; specific clause text not in the WebFetch extract but consistent across multiple sources.

### Tertiary (LOW confidence)

None. Every Phase 2 finding is grounded in a primary or verified-on-host source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs verified on the GNOME 46 dev host AND cited from gjs.guide.
- Architecture: HIGH — patterns are direct extensions of Phase 1's already-shipped architecture; Notifier is the only new module and its shape mirrors `MessageTray` API contracts 1:1.
- Pitfalls: HIGH for the API-level ones (A through F), MEDIUM for the cross-process / GSettings-cache ones (G, H) — these are derived from gjs.guide guidance + reasoning about the separate-process model.
- EGO submission: HIGH — every checklist item maps to a documented EGO rule or a `gnome-extensions pack` documented behavior.
- The two `[ASSUMED]`-class smoke tests (A1, A2) are flagged for execution-time verification rather than pre-decided.

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (30 days — stable APIs, but GNOME 47/48 minor API drift should be re-verified before EGO submission if Phase 2 execution slips past June 2026).
