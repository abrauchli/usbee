# Project Research Summary

**Project:** USBee — WhatCable for GNOME/Linux
**Domain:** GNOME 46+ Quick Settings Shell extension; pure D-Bus client of sibling `usbeehive` daemon
**Researched:** 2026-05-11
**Confidence:** HIGH

## Executive Summary

USBee is a small (~500–1000 LoC), pure-GJS GNOME Shell extension that surfaces what `usbeehive` already knows about USB and USB-C state. Two independent constraints converge on the same architectural verdict and rule out every other option: the GNOME Extensions website forbids bundled binary executables, and the project itself bars heavy lifting in the indicator. There is no companion Rust binary, no GTK4-rs / libadwaita-rs / zbus / tokio in the deliverable — those would only exist if USBee owned domain logic, and it deliberately does not. The Quick Settings tile widget lives inside the `gnome-shell` process; nothing but GJS can render there, so the stack chooses itself.

The product bar is set by the macOS app WhatCable plus the four explicit MVP requirements in PROJECT.md: a Quick Settings tile with a live one-line headline, a popover listing every attached USB device and USB-C port with vendor / speed / role / live wattage, a plain-English diagnostic per USB-C port sourced verbatim from `usbeehive.Diagnose`, hotplug via `DeviceAdded`/`DeviceRemoved`, `CapabilityDegraded` notifications with a "Don't notify for this port" action persisted in GSettings, and a graceful daemon-missing state that auto-recovers via `NameOwnerChanged`. All four researchers independently propose the same two-phase split (tile + popover + hotplug + daemon-missing state first; notifications + per-port mute + prefs.js + EGO submission readiness second), which matches the user's "1–2 phases, 1–3 plans each" target exactly. Phase 1 is shippable to EGO as v0.1; Phase 2 turns it into v1.0.

Key risks cluster in three places. (1) **EGO review hazards** — automatic rejection criteria include bundled binaries, log spam, excessive `try`/`catch` (the new December 2025 AI-code rule), synchronous D-Bus calls on the Shell main loop, and use of underscored private APIs like `quickSettings._addItems`. (2) **GJS lifecycle discipline** — failing to mirror every `enable()` allocation in `disable()` produces duplicate indicators and "already disposed" warnings on the lock/unlock cycle; the screen-lock test is the single highest-yield manual QA gate. (3) **Notification spam** from flapping USB-C ports or daemon restarts — must coalesce per-port with `replaces_id`, withdraw on `CapabilityRestored`, and suppress for ~2 s after `NameOwnerChanged` `null→owner` transitions while the daemon replays state. All three risks have well-known mitigations baked into the architecture researchers proposed.

## Key Findings

### Recommended Stack

Pure-GJS GNOME 46+ Shell extension, ESM-only, distributed via extensions.gnome.org as a single `.zip`. No npm, no cargo, no build pipeline beyond `glib-compile-schemas` and `gnome-extensions pack`. Detailed rationale in [STACK.md](./STACK.md).

**Core technologies:**
- **GJS (SpiderMonkey) 1.80+** — the only language that runs inside `gnome-shell`; ESM-only since GNOME 45, full GObject Introspection access.
- **`QuickSettings.SystemIndicator` + `QuickMenuToggle`** — canonical GNOME 46+ tile pattern, registered via `addExternalIndicator()`. Matches the Wi-Fi / Bluetooth / Sound UX explicitly called for in PROJECT.md.
- **`Gio.DBusProxy.makeProxyWrapper(IFACE_XML)`** — first-class typed D-Bus client; pair with `Gio.bus_watch_name` for daemon-presence tracking. Async-only.
- **`MessageTray.Source` + `MessageTray.Notification`** — the documented extension notification path, supports the mandatory "Don't notify for this port" action button. Not `Gio.Notification` (wrong tool for in-shell code) and not `Main.notify` (no action buttons).
- **GSettings via `Extension.getSettings()`** with compiled schema `org.gnome.usbee` — `port-mutes` (`as`) and `notifications-enabled` (`b`). Visible in `dconf-editor`, shared seamlessly between the shell process and the prefs process.
- **GTK 4 + libadwaita 1.5+ in `prefs.js` only** — runs in the separate `gnome-shell-extension-prefs` process; the in-shell code has zero GTK dependency.

**Explicitly rejected:** Rust user-service binary (EGO ban + duplicates `usbeehive`), `gtk4-rs`/`libadwaita-rs`/`zbus`/`tokio` (cannot run inside `gnome-shell`), `libappindicator`/AppIndicator tray (deprecated, off-spec), top-panel `PanelMenu.Button` (we target the modern tile), legacy `imports.*` / `_init()` / `_addItems` (pre-GNOME-45 patterns, EGO red flags), `Gio.Notification` (semantics wrong inside the Shell), any `*Sync` D-Bus method, any `GLib.spawn_*` or bundled binary, any direct `/sys` / udev access.

### Expected Features

Detailed inventory and competitor matrix in [FEATURES.md](./FEATURES.md).

**Must have (table stakes — v1):**
- `TILE` — Quick Settings tile mounting alongside Wi-Fi/BT/Sound with icon + live one-line headline (e.g. "USB-C: 100 W in, 10 Gb/s").
- `LIST` — popover row per device/port with friendly name, USB version, negotiated speed, power direction, live wattage, role.
- `DIAG` — one plain-English diagnostic per USB-C port, sourced verbatim from `usbeehive.Diagnose`.
- `LIVE` — list and headline re-render on `DeviceAdded` / `DeviceRemoved` (and `PropertiesChanged` if exposed).
- `NOTIF` — `CapabilityDegraded` raises a notification with "Don't notify for this port" action; once per event per port.
- `STATE` — "usbeehive daemon not running" empty state with copyable `systemctl --user enable --now usbeehive` hint; auto-recovers via `NameOwnerChanged`; lock-screen safety hides prefs entry when `!Main.sessionMode.allowSettings`.
- `PREFS` — GSettings schema `org.gnome.usbee` installed with `port-mutes` (`as`) and `notifications-enabled` (`b`); preferences window via `prefs.js` for unmute / master switch.
- `PACK` — every user-visible string wrapped in `gettext` `_()` markers; GPL-3.0; EGO submission ready.

**Should have (competitive differentiator — already in v1):**
- Live wattage in the **tile subtitle** (beats WhatCable, which requires a click).
- First-class "Linux is finally telling me why charging is slow" UX — no other GNOME surface does this today.
- Auto-recovery via `NameOwnerChanged` so `systemctl --user restart usbeehive` re-lights the tile without re-enabling.

**Defer (v1.x / v2+):**
- "Copy diagnostic to clipboard" via `usbeehive.SnapshotJson` (must declare clipboard usage in extension description per EGO rules).
- PDO ladder rendering with negotiated profile highlighted.
- Trust-signal glyph on suspect e-markers (waits on daemon-side field).
- Notification coalescing tuning (`replaces_id` is in v1; rate-cap policy may need iteration).
- Per-port wattage history graph.
- Translations beyond English (gettext markers in v1; `.po` files in v2).
- "Report this cable" pre-filled GitHub-issue flow.

**Explicit anti-features (rejected by design):** connect/disconnect toast for every hotplug (spam), standalone Adwaita window, CLI shipped from this repo (lives in `usbeehive`), KDE/Plasma support (separate C++ project), any privileged subprocess or `/sys` access, auto-installing / managing the daemon, in-tile theme customisation.

### Architecture Approach

Single ES-module extension, ~500–1000 LoC, one source tree, one zip. Detailed in [ARCHITECTURE.md](./ARCHITECTURE.md).

**Major components:**
1. **`extension.js`** — `Extension` subclass; `enable()` wires the chain, `disable()` tears it down. No business logic.
2. **`lib/dbusClient.js`** — single connectivity authority; wraps `makeProxyWrapper` + `bus_watch_name`; emits `ready`/`lost`/`devices-changed`/`capability-degraded`/`capability-restored`. Every other module talks to this, never to Gio directly.
3. **`lib/deviceStore.js`** — pure data model; cached snapshot + derived headline string; emits `'changed'`. The toggle binds title/subtitle to derived properties so headline logic isn't duplicated.
4. **`lib/indicator.js` + `lib/toggle.js`** — `SystemIndicator` + `QuickMenuToggle`. Always-on signal subscription; lazy popover row construction on `open-state-changed`.
5. **`lib/notifier.js`** — `MessageTray.Source` named "USBee"; reads `port-mutes` GSettings on every event; provides the in-notification mute action that writes back to GSettings.
6. **`schemas/org.gnome.usbee.gschema.xml` + `prefs.js`** — `Adw.PreferencesPage` bound to the same schema. Shell process and prefs process share state purely via GSettings; no IPC, no file-watching.

**Key patterns:** D-Bus proxy as singleton; always-on signal subscription with lazy view construction; GSettings as the single notification-policy source-of-truth; headline derivation in the store, not the view.

### Critical Pitfalls

Top hazards from [PITFALLS.md](./PITFALLS.md). All have known, documented mitigations.

1. **Work in module top-level instead of `enable()`** — causes duplicate indicators and "already disposed" warnings across lock/unlock; auto EGO rejection. Mitigation: every allocation in `enable()`, matching disposal in `disable()`, lock/unlock cycle as mandatory QA test.
2. **Forgotten signal disconnects** — `g-signal`, `g-name-owner` notify, and `GLib.timeout_add` IDs accumulate across enable/disable; notifications duplicate, RAM grows. Mitigation: `SignalRegistry` helper, store every handler ID on `this`, bulk-disconnect on disable.
3. **Excessive `try`/`catch` and excessive logging** — the December 2025 AI-code rule rejects extensions with unnecessary defensive wrapping or log spam. Mitigation: thin Logger gated by a GSettings debug key, ≤5 `try` blocks across the whole extension each with a real recovery, pre-submission `grep` audits.
4. **Synchronous D-Bus on the Shell main loop** — freezes the entire desktop; auto EGO rejection. Mitigation: async-only proxy construction, `Gio._promisify`, 5 s call timeouts, `grep -nE '\bSync\b'` clean before submission.
5. **Notification spam on flapping ports / daemon restart** — `CapabilityDegraded` floods bury everything. Mitigation: `replaces_id` map keyed by stable port ID, `CloseNotification` on `CapabilityRestored`, 2–3 s suppression window after `NameOwnerChanged` `null→owner`, hard daily-rate cap per port.
6. **`DeviceAdded` burst from a single hub plug-in** — naive listener re-renders 5–15× per dock attach. Mitigation: 150 ms debounce on the refresh source, single shared timeout ID, skip refresh while popover closed.
7. **Bundled binary / subprocess** — automatic EGO rejection; if `usbeehive` is missing something, fix `usbeehive`. Mitigation: zero `GLib.spawn_*` and zero `bin/` directory; architecture rule enforced at code review.

## Implications for Roadmap

All four researchers — independently — proposed the same two-phase decomposition. It matches the user's stated coarse-granularity / yolo / parallel project mode and the "1–2 phases, 1–3 plans each" target. **The roadmapper should adopt this split verbatim**; further decomposition is unnecessary for a ~500–1000 LoC extension.

### Phase 1: Tile, Popover, Hotplug, Daemon-Missing State

**Rationale:** This is the load-bearing, end-to-end skeleton. Nothing in Phase 2 makes sense until the tile mounts, talks to the daemon, lists devices, updates on hotplug, and degrades gracefully when the daemon vanishes. It is also the natural moment to bake in every Foundation-phase pitfall mitigation (enable/disable contract, signal registry, logger, async-only D-Bus, modern Quick Settings API) — retrofitting these later is painful.
**Delivers:** Shippable v0.1 zip on EGO. Quick Settings tile appears with a live headline; popover lists every device/port with friendly name, USB version, negotiated speed, power direction, live wattage, and the daemon's plain-English diagnostic; hotplug works; killing `usbeehive` swaps to the "daemon not running" empty state with a copyable systemctl hint; restarting the daemon re-lights the tile automatically via `NameOwnerChanged`.
**Addresses (FEATURES.md):** `TILE`, `LIST`, `DIAG`, `LIVE`, `STATE`, and the architectural / `PACK` invariants (gettext markers, GPL-3.0, GJS-only).
**Uses (STACK.md):** GJS 1.80+, `QuickSettings.SystemIndicator`, `QuickMenuToggle`, `Gio.DBusProxy.makeProxyWrapper`, `Gio.bus_watch_name`, `Gio._promisify`, GLib timeouts for debounce.
**Implements (ARCHITECTURE.md):** `extension.js`, `lib/ifaceXml.js`, `lib/dbusClient.js`, `lib/deviceStore.js`, `lib/format.js`, `lib/indicator.js`, `lib/toggle.js`.
**Avoids (PITFALLS.md):** #1 (work in init), #2 (signal disconnect), #3 (legacy API), #4 (sync D-Bus), #5 (daemon absence), #6 (log spam), #9 (hotplug burst), #10 (no subprocess), and the stale-tutorial / private-API hazards.

**Plans within Phase 1 (suggested ≤3):** the roadmapper may keep this as one plan covering the full slice, or split into (a) skeleton + dbusClient + deviceStore and (b) tile + popover + daemon-missing state. Either is defensible at coarse granularity.

### Phase 2: Notifications, Per-Port Mute, Prefs, EGO Submission

**Rationale:** Everything in Phase 2 layers cleanly on Phase 1 without modifying it (except adding the `port-mutes` / `notifications-enabled` schema keys and wiring the notifier into `enable()`). Critical-pitfall #8 (notification spam) has the largest design surface in the project and deserves its own phase rather than being a sub-task of "build the tile." EGO submission polish (icon, README, version matrix testing, AI-code review gate, "looks done but isn't" checklist) lives here because it's only meaningful once feature work is complete.
**Delivers:** Shippable v1.0 zip on EGO. `CapabilityDegraded` raises a notification with a working "Don't notify for this port" action; muted ports persist across shell restarts; preferences window lists muted ports with unmute affordances and exposes the master notifications toggle; master switch silences notifications without disabling the tile; the extension passes the full pre-submission checklist (lock/unlock cycle, 10× enable/disable, burst hotplug, GNOME 46/47/48 matrix).
**Addresses (FEATURES.md):** `NOTIF`, `PREFS`, completing `STATE` (lock-screen prefs hiding), completing `PACK` (EGO submission readiness).
**Uses (STACK.md):** `MessageTray.Source` + `Notification` + `addAction`, GSettings schema compilation, GTK 4.14 + libadwaita 1.5 in `prefs.js` only, `Adw.PreferencesPage`/`PreferencesGroup`/`SwitchRow`/`ActionRow`.
**Implements (ARCHITECTURE.md):** `schemas/org.gnome.usbee.gschema.xml`, `lib/notifier.js`, `prefs.js`, `icons/usbee-symbolic.svg`, `stylesheet.css`, EGO submission artifacts.
**Avoids (PITFALLS.md):** #8 (notification spam — `replaces_id`, `CloseNotification`, owner-transition suppression, rate cap), #7 (AI-smell `try`/`catch` review gate), the security/UX traps (stable port IDs, plain-text not markup, clipboard-disclosure if added), and the "looks done but isn't" checklist as the exit gate.

**Plans within Phase 2 (suggested ≤3):** roadmapper may keep this as one plan or split into (a) schema + notifier + per-port mute action and (b) prefs.js + EGO submission polish.

### Phase Ordering Rationale

- **Two phases, not three or more, because the codebase is ~500–1000 LoC** and any finer split spends more time on phase ceremony than on actual work. The architecture is intentionally small.
- **Daemon-missing state belongs in Phase 1**, not Phase 2 polish. Without it, every D-Bus call site has to be retrofitted to defensiveness later — exactly the cross-cutting concern pattern that costs the most when deferred.
- **GSettings schema lands in Phase 2**, not Phase 1, because nothing in Phase 1 reads/writes settings. Building it earlier is dead code.
- **Phase 2 strictly builds on Phase 1** with one architectural addition (the schema) and two new modules (`notifier.js`, `prefs.js`). No Phase 1 module needs to change — confirms the boundary is at the right place.
- **EGO submission polish lives at the end of Phase 2**, not as a Phase 3, because polish without features is hollow and features without polish can't ship.

### Research Flags

Both phases are well-trodden ground; the research depth is already sufficient to plan and execute without a `/gsd-research-phase` call.

Phases likely needing deeper research during planning: **none.** The architecture document already pins exact API surfaces, file layout, signal flow, and skeleton code for every component in both phases.

Phases with standard patterns (skip research-phase):
- **Phase 1** — canonical Quick Settings + D-Bus client patterns documented authoritatively on gjs.guide; skeleton code in ARCHITECTURE.md is paste-ready.
- **Phase 2** — `MessageTray` notifications with actions, GSettings binding to libadwaita widgets, and EGO review checklist are all in PITFALLS.md / STACK.md / ARCHITECTURE.md.

The only items worth a quick **validation pass during Phase 1 implementation** (not full research) are the four "Open Questions to Resolve in Phase 1" in ARCHITECTURE.md: snapshot strategy on `ready` (re-snapshot vs incremental), whether to use the cached `DeviceCount` property, whether `Diagnose` is called in v1 (default: no), and the icon set for degraded state. None blocks roadmap construction.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Two independent hard constraints (EGO no-binary rule + "no heavy lifting in indicator") plus the UI-architecture reality that the tile lives in the `gnome-shell` process all converge on pure-GJS. Authoritative gjs.guide + EGO review guidelines as sources. |
| Features | HIGH | WhatCable feature inventory verified against upstream repo + landing page + HN thread + multiple writeups; GNOME-side requirements pin directly to PROJECT.md "Active" list. The only LOW-confidence item is whether `Diagnose` strings should render in tooltips vs row body — a UX choice, not a research gap. |
| Architecture | HIGH | Component decomposition matches reference extensions (Quick Settings Audio Panel, quick-settings-tweaks) and gjs.guide canonical patterns. One MEDIUM-confidence pick is snapshot strategy (re-snapshot on every signal vs incremental update); both work, decision can be made during Phase 1 implementation. |
| Pitfalls | HIGH | Anchored in official EGO review guidelines, gjs.guide memory-management page, freedesktop Notifications spec, real-world bug reports (GSConnect, dash-to-panel, Clipboard Indicator, pop-os), and the December 2025 AI-code rule (Phoronix + Rahmatzadeh blog). Upstream UCSI kernel context (October 2025 patch series) confirms the 0.1 A flicker quirk that should be pushed to `usbeehive`. |

**Overall confidence:** HIGH

### Gaps to Address

None blocks roadmap construction. Items below are validation passes during Phase 1 implementation:

- **Snapshot strategy:** Re-call `SnapshotJson` on every `DeviceAdded`/`Removed`, or incremental-update from signal payloads. Default: re-snapshot (simpler). Reassess if measured cost is non-trivial on real hardware.
- **GNOME 48 smoke test:** API surface is stable from 46, but minor signatures (`addExternalIndicator` position arg, layout `vertical` migration) should be re-verified on a GNOME 48 VM before claiming the version in `metadata.json`.
- **Stable port identifier format:** Per-port mute must persist by a stable hardware key (port path or controller GUID), not by enumeration index. The exact field comes from `usbeehive`; if absent, that's an upstream PR to file during Phase 2.
- **`usbeehive` `DevicesChanged` atomic snapshot signal:** Defense-in-depth against the hotplug burst pitfall. Extension already debounces; upstream signal would be an optimisation. File as a `usbeehive` issue, do not block USBee.
- **Daemon-restart degradation replay:** Until `usbeehive` exposes `LastDegradationTimestamp`, the extension uses a 2–3 s owner-transition suppression window. Document the workaround; track upstream improvement.
- **Icon set for degraded state:** Default to one symbolic icon + amber subtitle; revisit if a designer disagrees. Cosmetic, not blocking.

## Sources

### Primary (HIGH confidence)

- [Quick Settings — GJS Guide](https://gjs.guide/extensions/topics/quick-settings.html) — `SystemIndicator`, `QuickMenuToggle`, `addExternalIndicator` canonical patterns.
- [D-Bus — GJS Guide](https://gjs.guide/guides/gio/dbus.html) — `makeProxyWrapper`, async constructors, name-owner tracking.
- [Notifications — GJS Guide](https://gjs.guide/extensions/topics/notifications.html) — `MessageTray.Source` for extensions vs `Gio.Notification`.
- [Popup Menu — GJS Guide](https://gjs.guide/extensions/topics/popup-menu.html) — `open-state-changed` lazy-population pattern.
- [Preferences — GJS Guide](https://gjs.guide/extensions/development/preferences.html) — GSettings + `Extension.getSettings()` + schema compilation.
- [Port Extensions to GNOME Shell 45/46 — GJS Guide](https://gjs.guide/extensions/upgrading/gnome-shell-45.html) — ESM migration, `Extension` subclass, modern lifecycle.
- [GNOME Shell Extensions Review Guidelines — GJS Guide](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) — authoritative for EGO submission (no binaries, no minification, enable/disable contract, no sync I/O, clipboard disclosure).
- [AI and GNOME Shell Extensions — Javad Rahmatzadeh, Dec 2025](https://blogs.gnome.org/jrahmatzadeh/2025/12/06/ai-and-gnome-shell-extensions/) — December 2025 AI-code rejection rule.
- [Asynchronous Programming — GJS Guide](https://gjs.guide/guides/gjs/asynchronous-programming.html) — `Gio._promisify` pattern.
- [Tips on Memory Management — GJS Guide](https://gjs.guide/guides/gjs/memory-management.html) — handler-ID tracking, reference tracing.
- [Desktop Notifications Specification — freedesktop.org](https://specifications.freedesktop.org/notification-spec/latest/) — `replaces_id`, `CloseNotification`.
- [WhatCable repository (darrylmorley/whatcable)](https://github.com/darrylmorley/whatcable) + [whatcable.uk](https://whatcable.uk/) — primary feature inventory.

### Secondary (MEDIUM confidence)

- [GNOME 46/47/48 Release Notes](https://release.gnome.org/) — GTK/libadwaita baseline versions per Shell release.
- [Quick Settings Audio Panel (Rayzeq)](https://github.com/Rayzeq/quick-settings-audio-panel), [quick-settings-tweaks (qwreey)](https://github.com/qwreey/quick-settings-tweaks) — reference implementations covering GNOME 45–48 API churn.
- Real-world bug reports: GSConnect #666 (RAM leak), Clipboard Indicator #499 (dispose pattern), Dash-to-Panel #1924, pop-os/pop #2867, appindicator #485, qsap #133.
- [Show HN: WhatCable (HN thread)](https://news.ycombinator.com/item?id=47972511) — user feature requests, missing-feature signal.
- [Microsoft UCSI slow-charging notification spec](https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/usb-type-c-slow-charging-notification-requirements) — confirms "Windows has a slow-charge toast" as the bar; GNOME today does not.
- [Framework community thread — USB-C PD info on Linux](https://community.frame.work/t/viewing-information-about-usb-c-power-delivery-in-linux/9362) — market gap confirmation.

### Tertiary (LOW confidence — flag during implementation)

- [UCSI Power Supply patch series, Oct 2025](https://patchew.org/linux/20251007000007.3724229-1-jthies@google.com/) — confirms the 0.1 A default quirk; daemon-side handling, not USBee-side.
- Exact GJS / GLib / GTK versions per GNOME release — six-month cadence means numbers move; re-verify against `release.gnome.org/<n>/` when targeting a specific minor.

---
*Research completed: 2026-05-11*
*Ready for roadmap: yes*
