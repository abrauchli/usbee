# Feature Research

**Domain:** GNOME 46+ Quick Settings indicator for USB device + USB-C charging capabilities (WhatCable-equivalent for GNOME)
**Researched:** 2026-05-11
**Confidence:** HIGH (WhatCable feature inventory and GNOME Quick Settings patterns are well documented; LOW confidence flags only where noted)

## Category Prefixes (for REQ-IDs downstream)

| Prefix | Scope |
|--------|-------|
| `TILE` | Quick Settings tile itself — headline, icon, placement, lock-screen behaviour |
| `LIST` | Per-device / per-port rows inside the popover menu |
| `DIAG` | Plain-English diagnostic strings rendered per port |
| `NOTIF` | Desktop notifications for `CapabilityDegraded` / restored |
| `PREFS` | GSettings-backed preferences (per-port mute, empty-port visibility, etc.) |
| `STATE` | Daemon-missing / no-USB / lock-screen / error states |
| `LIVE` | Hotplug and live wattage updates via D-Bus signals |
| `PACK` | Packaging, distribution (EGO), GSettings schema install, gettext scaffolding |

These map 1:1 to REQ-ID prefixes in REQUIREMENTS.md.

## WhatCable Feature Inventory (the reference product)

Extracted from `github.com/darrylmorley/whatcable`, `whatcable.uk`, the HN Show HN thread, and the Adafruit / Boing Boing / byteiota writeups. Every row below is something the macOS app actually does today — this is the bar USBee is measured against by anyone who has used WhatCable on a Mac.

| WhatCable feature | What it shows / does | USBee equivalent? |
|---|---|---|
| **Menu-bar status icon** | Compact icon, click for popover | YES — Quick Settings tile (GNOME-native replacement) |
| **Headline classification per port** | "Thunderbolt / USB4", "USB device", "Charging only", "Slow USB / charge-only cable", "Nothing connected" | YES — diagnostic string per port (`DIAG`) |
| **Cable speed tier** | USB 2.0 / 5 / 10 / 20 / 40 / 80 Gbps | YES if `usbeehive` exposes; otherwise upstream change |
| **Cable current rating** | 3 A / 5 A → 60 W / 100 W / 240 W | YES (USB-PD via UCSI) |
| **Cable vendor identity (e-marker)** | VID/PID of cable chip | YES |
| **PDO ladder with negotiated profile highlighted** | "Charger offers 20V/5A, 15V/3A, 9V/3A, 5V/3A — currently using 20V/5A" | YES (differentiator vs naive lists) |
| **Charging diagnosis** | "Cable limits to 60 W but charger offers 100 W", "Mac throttling demand at full charge", "Charger insufficient" | YES — this is the headline value (`DIAG`) |
| **Per-port attached device list** | Storage / hubs / docks / peripherals with negotiated speed under their physical port | YES (`LIST`) |
| **Active transports** | USB 2 / USB 3 / USB4 / Thunderbolt / DisplayPort alt-mode | YES (`LIST` / `DIAG`) |
| **Data role / power role** | UFP/DFP, source/sink, DRP | YES (`LIST`) |
| **Live wattage** | Actual W being drawn or supplied, updates in real time | YES — already in usbeehive UCSI (`LIVE`) |
| **Trust signals on suspect e-markers** | Orange card for zero VIDs, reserved bits, unregistered VIDs | DEFER — usbeehive can emit signal but v1 doesn't render |
| **Raw IOKit details** | Option-click reveals registry-level facts | DEFER — equivalent would be "Copy diagnostic JSON" |
| **Empty-port visibility toggle** | Hide ports with nothing connected | YES (`PREFS`) |
| **Launch-at-login toggle** | App auto-starts | N/A — Shell extension is always loaded by Shell; `usbeehive` is `systemctl --user enable` |
| **Connect/disconnect notifications** | Toast on hotplug | NO — anti-feature for USBee (see below) |
| **Dock-app vs menu-bar toggle** | Run as windowed app instead of menu bar | NO — Quick Settings tile is the only UI surface |
| **"Report this cable" → GitHub issue** | Pre-fills a GH issue with VID/PID/VDOs of a suspect e-marker | DEFER post-v1 (`DIAG` add-on); requires opening a URL — fine in extension prefs |
| **CLI binary (`whatcable`)** | JSON, watch mode, raw dump, snapshot | NO — `usbeehive` already ships `SnapshotJson` / `Diagnose` D-Bus methods and (per its own roadmap) a CLI. USBee does not duplicate this. |
| **Open-source under permissive license** | MIT | DIFFERENT — USBee is GPL-3.0 per user directive |
| **Privacy: no telemetry, no network** | Stated explicitly | YES — must mirror, this is a desktop-trust requirement |

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these = "this isn't really WhatCable-for-GNOME, it's a worse `lsusb`".

| Feature | Why Expected | Complexity | Notes / Category |
|---|---|---|---|
| Quick Settings tile that mounts next to Wi-Fi / Bluetooth / Sound with an icon + one-line headline | This is literally what "GNOME-native WhatCable" means; a non-tile UI defeats the goal stated in PROJECT.md | LOW | `TILE`. Use `QuickSettings.QuickMenuToggle` from `quickSettings.js`; register via `Main.panel.statusArea.quickSettings.addExternalIndicator()`. |
| Tile headline summarising the most relevant fact ("USB-C: 100 W in, 10 Gb/s" or "2 devices, none charging") | Quick Settings tiles are useless if you must open the popover to learn anything | LOW–MED | `TILE`. Use `title` / `subtitle` properties (GNOME 44+ API). |
| Expanded popover listing every attached USB device / USB-C port | The popover *is* the product; WhatCable's headline is "what each cable can do" | MED | `LIST`. Use `PopupMenu.PopupMenuSection` + `removeAll()` + repopulate pattern (same pattern as `backgroundApps.js` in GNOME Shell). |
| Per-row: friendly vendor + product name | Users don't recognise `0x05ac:0x12a8` | LOW | `LIST`. Comes from `usbeehive` device summary. |
| Per-row: negotiated USB version + link speed | Single most-asked question ("is this the fast port?") | LOW | `LIST`. |
| Per-row: power direction + live wattage when UCSI exposes it | WhatCable's flagship live-data feature | LOW–MED | `LIST` + `LIVE`. Re-render on `PropertiesChanged` or a `usbeehive` "tick" signal. |
| Per-port plain-English charging diagnostic | "Cable limited to USB 2.0 — swap for a full-featured cable to reach 10 Gb/s" is the literal example in USBEE.md | LOW (rendering); the strings come pre-baked from `usbeehive` | `DIAG`. |
| Live hotplug via `DeviceAdded` / `DeviceRemoved` D-Bus signals | A static list is broken UX; users plug things in to find out | LOW | `LIVE`. |
| `CapabilityDegraded` notification once per event per port | Explicitly required by PROJECT.md and USBEE.md | LOW | `NOTIF`. Use `MessageTray`/`Main.notify` — extension's normal path. |
| "Don't notify for this port again" notification action that persists | Without this the notification is spam | LOW | `NOTIF` + `PREFS`. Persists in GSettings `org.gnome.usbee` as a per-port-id key set. |
| Graceful "usbeehive daemon not running" empty state | Without it the tile is just broken when the daemon is off | LOW | `STATE`. Watch `org.freedesktop.DBus`'s `NameOwnerChanged` for `org.usbeehive.Devices1`. |
| Lock-screen safety — hide preferences / "more settings" entry when locked | Review-guideline requirement: `settingsItem.visible = Main.sessionMode.allowSettings` | LOW | `TILE` / `PREFS`. |
| GSettings schema `org.gnome.usbee` installed and readable in dconf-editor | Required by PROJECT.md constraints | LOW | `PACK` + `PREFS`. |
| Strings wrapped in `gettext` / `_()` markers | Required by PROJECT.md (English-only v1, but no churn later) | LOW | `PACK`. |
| Distributed via EGO | The discoverable, audited GNOME extension channel; users don't `cargo install` shell tiles | LOW | `PACK`. |

### Differentiators (Competitive Advantage)

Where USBee can beat both WhatCable-on-Mac and the lsusb-and-dmesg status quo on Linux.

| Feature | Value Proposition | Complexity | Notes / Category |
|---|---|---|---|
| **Live wattage in the tile subtitle**, not just inside the popover | Glance value beats WhatCable: WhatCable requires a click. GNOME's tile subtitle gives one-line live readout for free. | LOW | `TILE`. |
| **First-class "Linux is finally telling me why charging is slow"** UX | Today on Linux this answer requires `upower`, `/sys`, `dmesg`. Even Windows only does it via a single toast. None of GNOME Settings → Power surfaces UCSI slow-charge state today. | MED | `DIAG` + `NOTIF`. The actual diagnostic lives in `usbeehive`; USBee surfaces it. |
| **Pure D-Bus client, no `/sys` / udev / polkit / root** | Cleanly reviewable for EGO; no privilege escalation; no "this extension wants device access" prompts | LOW (it's an architectural property) | `PACK` / architectural. |
| **Auto-recovery when daemon (re)starts** via `NameOwnerChanged` watch | Users can `systemctl --user restart usbeehive` and the tile lights up without re-enabling the extension | LOW | `STATE`. |
| **Per-port mute persisted in GSettings** (visible in dconf-editor, syncs across sessions) | Beats macOS WhatCable's plist; debuggable, scriptable | LOW | `PREFS`. |
| **Copy diagnostic to clipboard** action (uses `usbeehive`'s `SnapshotJson`) | Forum / support ticket workflow; aligns with HN feedback "wish I could paste this in a thread" | LOW | `DIAG`. Must declare clipboard usage in extension metadata per EGO rules. Could be v1.x rather than v1. |
| **Trust signals propagated from `usbeehive`** (suspect e-markers) | Counterfeit-cable problem was explicit HN feedback; usbeehive can detect, USBee shows a warning glyph | LOW (rendering) / MED (semantics agreed with daemon) | `DIAG`. |
| **PDO ladder with negotiated profile highlighted** (in expanded row) | Matches WhatCable's strongest "explain why" feature; nothing on Linux desktop renders this today | MED | `LIST`. |

### Anti-Features (Commonly Requested, Often Problematic)

Each of these is something a reasonable user or contributor will ask for — and each is one we deliberately reject for v1, with reasons.

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Read `/sys` / udev / sysfs directly from the extension** | "Then we don't need the daemon at all" | (1) GJS in the Shell process must not block on I/O; (2) EGO reviewers reject extensions that do privileged device probing; (3) duplicates work `usbeehive` already does well; (4) violates PROJECT.md's stated constraint | All USB knowledge flows through `usbeehive` D-Bus. If a field is missing, change the daemon. |
| **Run any component as root** | "USB-PD reading needs root" | False premise — `usbeehive` already gets what it needs as a user-level service. Also: EGO review guidelines require `pkexec` for any privileged subprocess and reject most of them anyway | `usbeehive` as `systemctl --user` service. |
| **Top-panel `StatusIcon` / `libappindicator` tray icon** | "Broader desktop reach without an extension" | (1) Explicitly out-of-scope per USBEE.md ("KDE/Plasma applet — there's already a c++ project for that"); (2) AppIndicator is a deprecated pattern on GNOME; (3) contradicts the "Quick Settings tile" goal | Quick Settings tile only. KDE users use the existing C++ Plasmoid. |
| **Standalone Adwaita window / "open USBee" desktop entry** | "I want to see all my USB stuff full screen" | (1) Out-of-scope per USBEE.md; (2) usbeehive already has a CLI / `SnapshotJson` for that audience; (3) doubles the surface area we'd need to maintain and i18n | Use Quick Settings popover. Power users use `usbeehive --json`. |
| **CLI shipped from this repo** | "WhatCable has a CLI" | `usbeehive` already owns the CLI surface (and is the right place — it has the data). Shipping a second CLI from USBee would duplicate logic and confuse users. | Point users at `usbeehive` CLI in README. |
| **Configuration GUI for the daemon** | "Let me toggle daemon settings from the tile" | (1) Out-of-scope per USBEE.md ("USBee is read-mostly"); (2) blurs the daemon/client boundary; (3) extension prefs windows are not the right place for daemon admin | `systemctl --user` + `usbeehive`'s own future config surface. |
| **Re-implement USB enumeration / USB-PD decoding in JS or Rust here** | "I don't trust the daemon" / "we can do it leaner" | Duplicates `usbeehive`; means USB-PD bugs need fixing in two places; impossible to do correctly in GJS in the Shell process | If `usbeehive` is missing something, fix `usbeehive`. |
| **Connect / disconnect toast for every hotplug** | "WhatCable can do it" | Notification spam — every coffee-shop visit on a thunderbolt-dock laptop triggers 5+ toasts. Users plug things in *intentionally* and look at the popover when they want detail. | Tile updates live (`LIVE`); only `CapabilityDegraded` raises a toast. |
| **Per-port history graph / wattage over time** | "I want to see when charging dropped" | Adds state, persistence, and a chart widget to what should be a glance-only surface. PROJECT.md lists this only as a *potential* post-MVP. | Defer to v2 (with an in-extension small ringbuffer if/when justified). |
| **Translations bundled in v1** | "I want German strings" | PROJECT.md explicitly defers translation to v2; locking strings before they stabilise creates churn | `gettext` markers in v1, translations in v2. |
| **Auto-installing / managing `usbeehive` from the extension** | "Make the tile bootstrap the daemon" | EGO review forbids extensions that install binaries without explicit user action; doing it silently is a security smell | Show "daemon not running" empty state with a copyable `systemctl --user enable --now usbeehive` hint. |
| **Ship as Flatpak** for the extension itself | "Flatpak is the GNOME way" | Shell extensions are not Flatpak-distributable — they load into `gnome-shell`. Only a *companion binary* could be Flatpak, and we resolved not to have one. | EGO is the distribution channel. |
| **macOS-style "report this cable" auto-uploading data** | "Help build a cable database" | Even WhatCable doesn't auto-upload; it opens a GitHub issue *the user submits*. Auto-upload from a desktop indicator is a privacy footgun. | Defer; if added, mirror WhatCable: open a pre-filled URL, no auto-submission. |
| **In-tile theming / colour customisation** | "Make it match my Shell theme" | Quick Settings tiles use Shell theming by design; extensions that fight the Shell theme get rejected at review | None — use stock styling and Adwaita icons. |

## Feature Dependencies

```
TILE (Quick Settings tile mounts + headline)
  └── requires ── usbeehive on session bus (org.usbeehive.Devices1)
                    └── requires ── usbeehive systemd --user unit
LIST (popover rows)
  └── requires ── TILE (the menu hangs off the tile)
  └── requires ── usbeehive ListDevices method
DIAG (plain-English strings)
  └── requires ── usbeehive Diagnose method (strings come pre-baked from daemon)
LIVE (hotplug + live wattage)
  └── requires ── usbeehive DeviceAdded / DeviceRemoved / PropertiesChanged signals
  └── enhances ── TILE (subtitle reflects current state)
  └── enhances ── LIST (rows mutate without re-open)
NOTIF (CapabilityDegraded toast)
  └── requires ── usbeehive CapabilityDegraded signal
  └── requires ── PREFS (per-port-mute persistence — otherwise "don't notify again" can't work)
PREFS (GSettings schema)
  └── requires ── PACK (schema must be compiled + installed)
STATE (daemon-missing / lock-screen / no-USB)
  └── requires ── NameOwnerChanged watch on org.usbeehive.Devices1
  └── conflicts── any code path that assumes the daemon is present (must be defensive everywhere)
PACK (EGO submission, gettext, GSettings schema)
  └── prerequisite for v1 ship
```

### Dependency Notes

- **NOTIF requires PREFS:** the "Don't notify for this port again" notification action is meaningless unless the choice is persisted; that persistence is a GSettings key.
- **DIAG depends entirely on `usbeehive`:** every diagnostic string in v1 must originate in the daemon's `Diagnose` output. USBee renders, it does not author diagnostics. This keeps the WhatCable-quality bar in one codebase.
- **LIVE enhances TILE and LIST:** without it the tile is technically functional (re-render on popover open), but the differentiator collapses.
- **STATE conflicts with assume-daemon-present:** every D-Bus call site must handle "no name owner". This is a cross-cutting requirement that shows up in every category.

## MVP Definition

### Launch With (v1)

The minimum that earns the name "WhatCable for GNOME".

- [ ] `TILE` — Quick Settings tile mounts, registers via `addExternalIndicator()`, renders icon + title + subtitle headline summarising USB-C charging direction + best attached link speed
- [ ] `LIST` — popover lists every device/port with vendor+product name, USB version, negotiated speed, power direction, live wattage (when UCSI provides), data role, power role
- [ ] `DIAG` — one plain-English diagnostic string per USB-C port, sourced verbatim from `usbeehive`'s `Diagnose`
- [ ] `LIVE` — list and tile re-render on `DeviceAdded` / `DeviceRemoved` (and `PropertiesChanged` if exposed) without user action
- [ ] `NOTIF` — `CapabilityDegraded` raises a notification with a "Don't notify for this port again" action; once-per-event per port
- [ ] `NOTIF` — `CapabilityRestored` either dismisses the notification or no-ops (decision: no-op in v1; see PITFALLS)
- [ ] `PREFS` — GSettings schema `org.gnome.usbee` installed, contains per-port-mute key set, "hide empty ports" toggle
- [ ] `STATE` — "usbeehive daemon not running" empty state with copyable `systemctl --user enable --now usbeehive` hint
- [ ] `STATE` — automatic recovery via `NameOwnerChanged` when daemon appears
- [ ] `STATE` — lock-screen safety (prefs entry hidden when `!Main.sessionMode.allowSettings`)
- [ ] `PACK` — extension submitted to EGO, GPL-3.0, English strings wrapped in `_()` gettext markers, no `Gtk`/`Adw` imports in the Shell process

### Add After Validation (v1.x)

Triggered by user feedback after v1 lands on EGO.

- [ ] `DIAG` — "Copy diagnostic to clipboard" using `usbeehive`'s `SnapshotJson` (declare clipboard usage in extension description per EGO rules) — trigger: support-ticket / forum-post feedback
- [ ] `LIST` — PDO ladder rendering with negotiated profile highlighted — trigger: power-user demand for WhatCable parity on charger inspection
- [ ] `LIST` — trust-signal glyph on suspect e-markers — trigger: usbeehive ships the trust-signal field
- [ ] `PREFS` — preferences window (prefs.js) with toggles for "show empty ports", "show notifications" master switch — trigger: more than ~3 preferences accumulate
- [ ] `NOTIF` — coalesce successive degraded/restored events within N seconds — trigger: real-world noise reports

### Future Consideration (v2+)

- [ ] Per-port wattage history graph (small in-process ringbuffer) — defer until product-market fit confirmed; adds state
- [ ] Translations beyond English — defer until string set stabilises (PROJECT.md decision)
- [ ] "Report this cable" pre-filled GitHub-issue URL flow — defer; requires a maintained cable-VID database to be useful
- [ ] KDE Plasmoid / non-GNOME ports — explicitly out of scope; a separate C++ project covers KDE
- [ ] "Deep dive" full-screen view (topology tree, charger PDO ladder, cable e-marker) — defer; if it ever ships, it lives in `usbeehive`'s GUI or a separate app, not in the Shell extension

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Quick Settings tile mounts with headline | HIGH | LOW | P1 |
| Popover per-device list with name + speed + power | HIGH | MEDIUM | P1 |
| Plain-English diagnostic per USB-C port | HIGH | LOW (renders daemon output) | P1 |
| Hotplug live updates | HIGH | LOW | P1 |
| CapabilityDegraded notification with per-port mute | HIGH | LOW–MEDIUM | P1 |
| Daemon-missing empty state + auto-recovery | HIGH | LOW | P1 |
| GSettings schema for prefs | MEDIUM | LOW | P1 |
| gettext-wrapped strings | LOW (today) / HIGH (v2) | LOW | P1 |
| EGO submission readiness | HIGH | LOW–MEDIUM | P1 |
| Live wattage in tile *subtitle* | HIGH | LOW | P1 |
| Copy diagnostic JSON to clipboard | MEDIUM | LOW | P2 |
| PDO ladder rendering | MEDIUM (power users) | MEDIUM | P2 |
| Suspect-e-marker trust glyph | MEDIUM | LOW | P2 |
| Preferences window with master toggles | MEDIUM | LOW | P2 |
| Notification coalescing | MEDIUM | LOW | P2 |
| Per-port wattage history graph | LOW–MEDIUM | HIGH | P3 |
| "Report this cable" GitHub-issue flow | LOW | LOW | P3 |
| Translations | MEDIUM (v2 only) | MEDIUM (ongoing) | P3 |

**Priority key:**
- P1: Must have for v1 launch
- P2: v1.x, add after EGO listing earns first feedback
- P3: v2+, defer until product-market fit

## Competitor / Prior-Art Feature Analysis

| Feature | WhatCable (macOS) | `lsusb` + `upower` (Linux today) | GNOME Settings → Power | USBee (planned) |
|---|---|---|---|---|
| At-a-glance per-port headline | Menu-bar icon + popover | None (terminal only) | None | **Quick Settings tile** |
| Plain-English "why is charging slow" | YES (flagship feature) | Implicit only, requires kernel-log spelunking | NO — only shows battery % and "plugged in" | **YES, via usbeehive Diagnose** |
| Live wattage | YES | `upower -i` if hardware exposes | NO | **YES, in tile subtitle** |
| PDO ladder with negotiated row | YES | `cat /sys/.../usb_power_delivery/...` | NO | YES (P2) |
| Hotplug-live UI | YES | N/A (CLI snapshot only) | N/A | **YES** |
| Connect/disconnect notifications | Optional toggle | NO | NO | **Deliberately not** — only CapabilityDegraded raises a toast |
| CLI | YES (`whatcable`) | YES (`lsusb`, `upower`) | N/A | **Not shipped from this repo** — `usbeehive` owns the CLI |
| Trust signals on suspect e-markers | YES | NO | NO | YES (P2) |
| Configuration UI for the underlying USB stack | NO (read-only) | NO | NO (power settings only) | **NO — explicitly read-mostly** |
| Runs as user (no root) | YES | YES | YES | **YES** |
| Distribution | Notarized DMG / Homebrew | Distro package | Built into GNOME Settings | **EGO (GNOME Extensions)** |
| License | MIT | GPL-2 (kernel) / various | GPL | **GPL-3.0** |

## Sources

- [WhatCable repository (darrylmorley/whatcable)](https://github.com/darrylmorley/whatcable) — primary feature inventory
- [WhatCable landing page (whatcable.uk)](https://whatcable.uk/) — feature pitch + screenshots
- [Show HN: WhatCable (HN thread)](https://news.ycombinator.com/item?id=47972511) — user requests, missing-feature signal, Linux/Windows port discussion
- [Adafruit blog write-up of WhatCable](https://blog.adafruit.com/2026/05/04/a-mac-app-to-answer-what-can-this-usb-c-cable-actually-do/)
- [byteiota WhatCable overview](https://byteiota.com/whatcable-free-macos-usb-c-cable-inspector-for-devs/)
- [GNOME JavaScript Quick Settings guide](https://gjs.guide/extensions/topics/quick-settings.html) — `QuickMenuToggle`, header pattern, dynamic `PopupMenuSection` repopulation
- [Port Extensions to GNOME Shell 44](https://gjs.guide/extensions/upgrading/gnome-shell-44.html) — `BackgroundApps` dynamic-list-in-popover precedent; `title` / `subtitle` API
- [GNOME Shell Extensions Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) — EGO rules: no `Gtk`/`Adw` in Shell process, no privileged subprocesses without `pkexec`, clipboard declaration requirement, AI-content rule
- [GSConnect Quick Settings tile feature request (#1506)](https://github.com/GSConnect/gnome-shell-extension-gsconnect/issues/1506) — real-world feedback that a tile saying just "GSConnect" is useless; argument for live headline data in the subtitle
- [Microsoft UCSI slow-charging notification spec](https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/usb-type-c-slow-charging-notification-requirements) — confirms "Windows shows a slow-charge toast" as the bar; GNOME today does not
- [Framework community: viewing USB-C PD info on Linux](https://community.frame.work/t/viewing-information-about-usb-c-power-delivery-in-linux/9362) — confirms power users today resort to `/sys` spelunking; market gap
- [usbview / usbutils (gregkh/usbutils)](https://github.com/gregkh/usbutils) — confirms there is no GNOME-native interactive USB-C capability indicator on Linux today

---
*Feature research for: GNOME Quick Settings USB / USB-C capability indicator*
*Researched: 2026-05-11*
