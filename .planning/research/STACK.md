# Stack Research

**Domain:** GNOME 46+ Quick Settings indicator (thin D-Bus client for sibling `usbeehive` daemon)
**Researched:** 2026-05-11
**Confidence:** HIGH

---

## Headline Recommendation

**Build USBee as a pure-GJS GNOME Shell extension. No companion Rust binary. No GTK4-rs. No libadwaita-rs.**

- Confidence: **HIGH**
- Two independent constraints force this verdict:
  1. **EGO review guidelines explicitly forbid bundled binary executables.** A Rust user-service binary cannot ship through extensions.gnome.org — it would have to be a separate Flatpak/distro package, which adds an entire packaging pipeline for zero functional gain.
  2. **The user directive is "no heavy lifting in the indicator."** All USB enumeration, USB-PD decoding, UCSI parsing, and diagnostics live in `usbeehive` already. What's left in USBee is: subscribe to D-Bus signals, render a list, fire a notification, read/write GSettings. GJS does every one of these as a first-class language operation via GObject Introspection.

The GTK4 + libadwaita + zbus + tokio stack from `USBEE.md` is a fine stack for a *standalone Adwaita app*. It is the wrong stack for a *Quick Settings tile*, because the Quick Settings panel lives inside `gnome-shell` and cannot host an out-of-process GTK widget — you communicate with it via its JS module system. A Rust process can talk *to* the extension over D-Bus, but the tile UI itself must be JS that runs in the shell process.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **GJS (SpiderMonkey)** | gjs 1.80+ (ships with GNOME 46) | Implementation language — ECMAScript modules via GObject Introspection | The only supported language for code running inside `gnome-shell`. ESM-only since GNOME 45 (`import` statements, no `imports.*`). Has direct access to every Gio/GLib/St/Clutter API via gi:// URIs. |
| **GNOME Shell Extension API** | shell-version `"46"`, `"47"`, `"48"` | Extension lifecycle, `enable()`/`disable()`, settings access | Modern `Extension`-class pattern (default-exported subclass from `resource:///org/gnome/shell/extensions/extension.js`). Mandatory since GNOME 45. |
| **`QuickSettings.SystemIndicator`** | resource://…/ui/quickSettings.js (GNOME 46+) | Hosts the indicator icon + Quick Settings items | Canonical 2026 pattern. Replaces the legacy `addQuickSettingsItems` helper. Registered with `Main.panel.statusArea.quickSettings.addExternalIndicator(indicator)`. |
| **`QuickSettings.QuickMenuToggle`** | resource://…/ui/quickSettings.js (GNOME 46+) | The clickable tile + popover for the device list | Exactly matches the Wi-Fi / Bluetooth / Sound UX the project goals call for. Built-in header via `menu.setHeader(icon, title, subtitle)`. |
| **`PopupMenu.PopupMenuSection`** | resource://…/ui/popupMenu.js | Dynamic device list inside the toggle's menu | Allows `removeAll()` + repopulate when `DeviceAdded`/`DeviceRemoved` fires. Same pattern GNOME Shell's own `js/ui/status/network.js` and `bluetooth.js` use. |
| **`Gio.DBusProxy`** (via `makeProxyWrapper`) | Gio 2.80+ (GLib bundled with GNOME 46) | D-Bus client for `org.usbeehive.Devices1` on the session bus | First-class D-Bus support in GJS. `makeProxyWrapper(xml)` produces a typed class with `MethodRemote()` async wrappers and `connectSignal()` for signals. Caches properties; `g-properties-changed` notifies on change. |
| **`Gio.DBusWatchName`** (`Gio.bus_watch_name`) | Gio 2.80+ | Detect when `org.usbeehive.Devices1` appears / disappears | Required for the "daemon not running" empty state and auto-light-up. Native primitive — no polling. |
| **`MessageTray.Source` + `MessageTray.Notification`** | resource://…/ui/messageTray.js | Desktop notifications for `CapabilityDegraded` events | The documented extension API. Supports actions (the "Don't notify for this port" button). `Gio.Notification` is for standalone GTK apps with a `.desktop` file — wrong tool for an extension. |
| **`Extension.getSettings()` (GSettings)** | Provided by base `Extension` class | Persisting per-port mute preferences under `org.gnome.usbee` | One call returns a `Gio.Settings` bound to the extension's compiled schema. Native — visible in `dconf-editor`, Flatpak-safe. |
| **`gettext` (from extension module)** | bundled | i18n scaffolding for v1 English-only strings | `import {Extension, gettext as _} from '…/extension.js'`. Auto-initialised when `gettext-domain` is set in `metadata.json`. |

### Supporting Libraries (also via GI, no npm)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **St** (Shell Toolkit) | bundled w/ GNOME Shell 46+ | Custom widgets inside the Quick Settings menu (icon labels, two-line text rows, status badges) | When `PopupImageMenuItem` is insufficient (e.g. wattage badge on the right of a device row). St is the Clutter-based toolkit Shell uses internally. |
| **GLib** | 2.80+ | `GLib.Variant` packing for D-Bus args; `GLib.timeout_add` for any throttled refresh | Required for D-Bus method arguments and any deferred-callback work. |
| **GObject** | 2.80+ | `GObject.registerClass` for the `SystemIndicator` / `QuickMenuToggle` subclasses | Mandatory — Shell rejects non-registered GObject subclasses. |
| **Gtk 4.14 + Adw 1.5** | only in `prefs.js` | Preferences window UI (per-port mute toggles list) | Used **only** inside `prefs.js`, which runs in its own process (`gnome-shell-extension-prefs`), not in the Shell. `import Gtk from 'gi://Gtk?version=4.0'` + `import Adw from 'gi://Adw'`. The Shell extension itself does NOT depend on GTK. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **`gnome-extensions`** CLI | Scaffold, pack, install, enable, disable | Ships with `gnome-shell`. `gnome-extensions create --template`, `gnome-extensions pack`, `gnome-extensions install --force`. Auto-compiles schemas on install (since GNOME 44). |
| **`glib-compile-schemas`** | Compile `schemas/*.gschema.xml` → `schemas/gschemas.compiled` | Needed for local dev when not installing via the CLI. Auto-handled in `pack`. |
| **`xgettext`** + **`msgfmt`** | Extract `.pot`, compile `.mo` files | Standard gettext toolchain. `xgettext --from-code=UTF-8 -o po/usbee@bitcreed.us.pot *.js`. |
| **`dbus-monitor`** / **`busctl`** | Debug `org.usbeehive.Devices1` signals during dev | `busctl --user monitor org.usbeehive.Devices1`. |
| **Looking Glass** (`Alt+F2` → `lg`) | Inspect live extension state, eval JS in the Shell | Indispensable for debugging. |
| **`journalctl --user -f /usr/bin/gnome-shell`** | Live extension logs | `console.log()` and stack traces from extensions land here. |
| **ESLint with `eslint-config-gjs`** (optional) | Style + lint | Used by GNOME Shell itself. Not mandatory for EGO but recommended. |
| **TypeScript with `@girs/*` typings** (optional) | Type-checking against GI bindings | Allowed if transpiled to readable JS for submission (EGO requires reviewable JS, no minification). |

## Installation / Project Layout

There is **no `npm install`** and **no `cargo build`**. The deliverable is a zip file produced by `gnome-extensions pack`. Expected tree:

```
usbee@bitcreed.us/
├── metadata.json
├── extension.js              # main entry — Extension subclass
├── prefs.js                  # preferences window (uses GTK4 + Adw)
├── lib/
│   ├── indicator.js          # SystemIndicator + QuickMenuToggle subclass
│   ├── dbus.js               # makeProxyWrapper for org.usbeehive.Devices1
│   ├── notifications.js      # MessageTray.Source wrapper
│   └── deviceRow.js          # St-based row widget for the device list
├── schemas/
│   ├── org.gnome.usbee.gschema.xml
│   └── gschemas.compiled     # generated
├── locale/
│   └── en/LC_MESSAGES/usbee@bitcreed.us.mo
├── po/
│   └── usbee@bitcreed.us.pot
├── icons/
│   └── usbee-symbolic.svg    # symbolic icon for the tile
├── stylesheet.css            # optional St styling
├── LICENSE                   # GPL-3.0 (required by user, EGO-friendly)
└── README.md
```

### `metadata.json` (target shape)

```json
{
  "uuid": "usbee@bitcreed.us",
  "name": "USBee",
  "description": "Glanceable USB and USB-C capability + charging info, powered by usbeehive.",
  "shell-version": ["46", "47", "48"],
  "url": "https://github.com/<owner>/usbee",
  "gettext-domain": "usbee@bitcreed.us",
  "settings-schema": "org.gnome.usbee"
}
```

Confirm GNOME 48 compatibility during a Phase-N validation pass; the modern Quick Settings API is stable since 46 but minor API surface (e.g. `addExternalIndicator` signature) should be re-tested per release.

### Common development loop

```bash
# Scaffold (one-time)
gnome-extensions create --template=quick-settings --uuid=usbee@bitcreed.us \
  --name="USBee" --description="USB capability indicator"

# Iterate
glib-compile-schemas schemas/                     # if you touched the schema
gnome-extensions pack --force                     # produces usbee@bitcreed.us.shell-extension.zip
gnome-extensions install --force usbee@bitcreed.us.shell-extension.zip
# Log out + log back in (Xorg: Alt+F2 → r works, Wayland: full re-login)
gnome-extensions enable usbee@bitcreed.us

# Debug
journalctl --user -f -o cat /usr/bin/gnome-shell
busctl --user monitor org.usbeehive.Devices1
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **Pure GJS extension** | Hybrid: GJS tile + Rust user-service binary owning the popover UI | **Never, for this project.** The popover lives in `gnome-shell`'s process; a Rust binary cannot inject widgets into it. The hybrid only makes sense if you also abandon Quick Settings and accept an Adwaita app window — which contradicts the project goal. |
| **Pure GJS extension** | Pure Rust standalone Adwaita app (`gtk4-rs` + `libadwaita-rs` + `zbus` + `tokio` + `relm4` or `async-std`) | When you want a launcher-style app, not a Quick Settings tile. Explicit non-goal in `PROJECT.md` ("Standalone window or full app shell — Quick Settings + popover is the whole UI"). |
| **GNOME 46+ Quick Settings** | Top-panel `PanelMenu.Button` (legacy panel indicator) | If you needed to support GNOME 42–44. We don't — `PROJECT.md` pins min GNOME 46. The modern QuickSettings tile is the user-visible answer to "matches Wi-Fi/Bluetooth UX". |
| **`Gio.DBusProxy.makeProxyWrapper`** | Hand-rolled `Gio.DBusProxy` subclass / raw `Gio.DBusConnection.call()` | If the introspection XML is missing or has unstable types. `usbeehive` already publishes a stable XML interface description — wrapper is the right tool. |
| **`MessageTray.Source/Notification`** | `Gio.Notification` + `Gio.Application.send_notification()` | Standalone GTK apps with a `.desktop` ID. An extension does not have its own GApplication identity inside the Shell process. |
| **GSettings (`org.gnome.usbee`)** | TOML under `$XDG_CONFIG_HOME/usbee/config.toml` | Never — `PROJECT.md` constraint pins GSettings. Also: GSettings is Flatpak-safe and visible in dconf-editor. |
| **`tokio` (Rust)** | `async-std` (Rust) | Only relevant if a Rust binary existed. It doesn't. GJS uses GLib's main loop — there is no choice to make. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **A bundled Rust / C / Go binary inside the EGO zip** | EGO review guidelines: *"Extensions MUST NOT include binary executables or libraries."* Rejected on submission. | All logic in `usbeehive` (already a separate process). If something is missing from the D-Bus surface, add it upstream — per the user's explicit project rule. |
| **`gtk4-rs` / `libadwaita-rs` / `zbus` / `tokio`** *for the tile itself* | They cannot run inside `gnome-shell`. They would only power a separate Rust binary, which (a) can't be on EGO, (b) duplicates effort with `usbeehive`, (c) the user explicitly said don't put heavy logic in the indicator. | GJS + `Gio.DBusProxy` + St/Clutter widgets inside the tile. |
| **Legacy `imports.*` import system** | Removed from `gnome-shell` 45+. Targeting 46 means ESM only. | `import X from 'gi://X'`, `import * as Main from 'resource:///org/gnome/shell/ui/main.js'`. |
| **Legacy `init()` + `enable()` + `disable()` top-level functions** | GNOME 45+ replaced with default-exported `Extension` subclass. | `export default class USBeeExtension extends Extension { enable() {…} disable() {…} }` |
| **`addQuickSettingsItems` helper / `QuickSettingsMenu._addItems`** | Legacy pre-46 helper, deprecated by `addExternalIndicator(indicator, [position])` + `SystemIndicator.quickSettingsItems`. | Modern `SystemIndicator` + `addExternalIndicator` pattern. |
| **`libappindicator` / `AppIndicator` / `XEmbed` system tray** | Removed from GNOME Shell years ago; only works via 3rd-party AppIndicator extension; not a "first-class Quick Settings UX". | Native Quick Settings tile. |
| **`gnome-shell-extension-prefs` legacy preferences pattern (GtkBuilder + GtkBox without Adw)** | Looks foreign next to other GNOME 46 extension prefs. | `Adw.PreferencesPage` + `Adw.PreferencesGroup` + `Adw.SwitchRow` / `Adw.ActionRow`. |
| **Private `St.*` / `Main.panel._*` internals beyond the documented Quick Settings API** | Breaks across releases; EGO reviewers flag it; you'll re-port every 6 months. | The documented `QuickSettings`/`PopupMenu`/`MessageTray` surface from `gjs.guide`. |
| **`Gio.Notification` from inside the extension** | Designed for GTK apps with their own `.desktop` ID; semantics are wrong in-shell. | `MessageTray.Source` + `MessageTray.Notification`. |
| **Synchronous `Gio.DBusProxy.new_for_bus_sync` on the main thread** | Blocks `gnome-shell` — the whole desktop freezes. EGO reviewers reject this. | `await Gio.DBusProxy.new_for_bus(…)` or `makeProxyWrapper` with the async constructor. |
| **String concatenation for user-visible strings** | Breaks gettext; reviewer-flagged. | `_('Charging slower than expected on %s').format(portName)` |
| **Minified / obfuscated / AI-slop JavaScript** | EGO reviewers will reject it. New 2025 rule explicitly bans AI-generated submissions. | Human-readable, reasonably-structured, single-author-style JS. |
| **Bundling polling timers shorter than ~1s for D-Bus reads** | Battery drain on idle. | Drive UI from `DeviceAdded` / `DeviceRemoved` / `CapabilityDegraded` *signals*. Snapshot only on tile-open or after `NameOwnerChanged`. |

---

## Stack Patterns by Variant

**If `usbeehive` adds a new signal or property:**
- Update the XML interface description embedded in `lib/dbus.js`.
- Regenerate the proxy by re-running `Gio.DBusProxy.makeProxyWrapper(NEW_XML)`.
- Wire a new `proxy.connectSignal('NewSignal', cb)` or read via cached property.
- No build step required — GJS picks up the new file on Shell restart.

**If a future capability genuinely cannot live in `usbeehive` (highly unlikely):**
- Ship that capability as a **separate Flatpak app** with its own D-Bus name on the session bus.
- USBee still stays pure-GJS; it just talks to two D-Bus services instead of one.
- Do **not** try to smuggle a binary into the EGO submission.

**If the project needs to support GNOME 45 in addition to 46+:**
- Modern Quick Settings (`SystemIndicator` / `addExternalIndicator`) exists from 45 onward, but several method signatures changed in 46. Test under 45 explicitly before adding `"45"` to `shell-version`.
- Currently out of scope — `PROJECT.md` pins min 46.

**If the project ever wants to also live as a Flatpak app:**
- Reuse `lib/dbus.js` semantics in a thin Rust wrapper around `zbus` (same XML).
- The GJS extension and a hypothetical Rust app remain independent — they share an interface, not code.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| GNOME Shell 46 | gjs 1.80, GLib 2.80, GTK 4.14 (prefs only), libadwaita 1.5 (prefs only) | Ubuntu 24.04 LTS baseline, Fedora 40, Arch rolling. Modern Quick Settings API. |
| GNOME Shell 47 | gjs 1.82, GLib 2.82, GTK 4.16 (prefs only), libadwaita 1.6 (prefs only) | Fedora 41, Ubuntu 24.10, Arch rolling. Toggle groups, dialog redesign — extension code unaffected. |
| GNOME Shell 48 | gjs 1.84, GLib 2.84, GTK 4.18, libadwaita 1.7 (prefs only) | Fedora 42, Ubuntu 25.04. **Verify in QA before claiming compatibility in `shell-version`** — minor API additions only, but worth a smoke test. |
| `metadata.json` `shell-version` | Array of major version strings | `["46", "47", "48"]` — no minor numbers. EGO accepts multi-version packages. |
| `gettext-domain` in `metadata.json` | Any UUID-shaped string | Convention: same as `uuid`. Auto-initialises gettext at extension load. |
| `settings-schema` in `metadata.json` | A schema id present under `schemas/*.gschema.xml` | Lets `Extension.getSettings()` return the right `Gio.Settings` without arguments. |

---

## Confidence Notes

- **HIGH** — pure-GJS verdict. Anchored in two independent hard constraints (EGO no-binary rule + project's "no heavy lifting in indicator" rule) plus a UI-architecture reality (the Shell process hosts the tile widget tree). All three converge on the same answer.
- **HIGH** — GNOME 46 Quick Settings API surface (`SystemIndicator`, `QuickMenuToggle`, `addExternalIndicator`). Documented on the canonical `gjs.guide`.
- **HIGH** — D-Bus client pattern via `Gio.DBusProxy.makeProxyWrapper`. Mature since GNOME 3 era, ESM-import-only is the only change for 45+.
- **HIGH** — `MessageTray` is the correct notification surface for extensions; `Gio.Notification` is not.
- **HIGH** — EGO review rule on binaries (verified against the official guidelines page on gjs.guide).
- **MEDIUM** — Exact GJS / GLib / GTK versions per GNOME release. These move on a 6-month cadence; numbers above are nominal and should be re-verified against `release.gnome.org/<n>/` when targeting a specific minor.

---

## Sources

- [Quick Settings | GNOME JavaScript (gjs.guide)](https://gjs.guide/extensions/topics/quick-settings.html) — `SystemIndicator`, `QuickMenuToggle`, `addExternalIndicator`. **Authoritative.**
- [Imports and Modules | GNOME JavaScript](https://gjs.guide/extensions/overview/imports-and-modules.html) — ESM import patterns for GNOME 45+.
- [Port Extensions to GNOME Shell 45 | GNOME JavaScript](https://gjs.guide/extensions/upgrading/gnome-shell-45.html) — Migration to ESM, `Extension` class, `gettext-domain` in metadata.
- [Anatomy of an Extension | GNOME JavaScript](https://gjs.guide/extensions/overview/anatomy.html) — `metadata.json` fields.
- [D-Bus | GNOME JavaScript](https://gjs.guide/guides/gio/dbus.html) — `Gio.DBusProxy`, `makeProxyWrapper`, async constructors, name-watching.
- [Notifications | GNOME JavaScript](https://gjs.guide/extensions/topics/notifications.html) — `MessageTray.Source` / `Notification` for extensions.
- [Popup Menu | GNOME JavaScript](https://gjs.guide/extensions/topics/popup-menu.html) — `PopupMenuSection`, `PopupImageMenuItem`, `PopupSwitchMenuItem`, ornaments.
- [Preferences | GNOME JavaScript](https://gjs.guide/extensions/development/preferences.html) — GSettings, schema compile, `Extension.getSettings()`.
- [Translations | GNOME JavaScript](https://gjs.guide/extensions/development/translations.html) — `gettext as _` from extension module, `xgettext`, `String.prototype.format()`.
- [GNOME Shell Extensions Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) — **No binary executables.** No minification. JS only. **Authoritative for EGO.**
- [Notifications in 46 and beyond — GNOME Shell & Mutter blog](https://blogs.gnome.org/shell-dev/2024/04/23/notifications-46-and-beyond/) — Distinction between `Gio.Notification`, XDG Notification, and XDG Portal.
- [Extensions in GNOME 45 — GNOME Shell & Mutter blog](https://blogs.gnome.org/shell-dev/2023/09/02/extensions-in-gnome-45/) — Rationale for the ESM migration.
- [GNOME 46 Release Notes — Developers](https://release.gnome.org/46/developers/) — GTK 4.14, libadwaita 1.5 baseline.
- [GNOME 47 Release Notes](https://release.gnome.org/47/) — Toggle groups, dialog redesign.
- [Gio.DBusProxy reference (gjs-documentation)](http://webreflection.github.io/gjs-documentation/Gio-2.0/Gio.DBusProxy.html) — `g-signal`, `g-properties-changed`.
- [GJS DBusClient example (GNOME Wiki Archive)](https://wiki.gnome.org/Gjs/Examples/DBusClient) — Concrete `makeProxyWrapper` walkthrough.
- [gnome-shell-extension-examples — Settings](https://gnome-shell-extension-examples.readthedocs.io/en/latest/gsettings1.html) — `schemas/` directory layout, `glib-compile-schemas`.

---
*Stack research for: GNOME 46+ Quick Settings indicator (D-Bus thin client)*
*Researched: 2026-05-11*
