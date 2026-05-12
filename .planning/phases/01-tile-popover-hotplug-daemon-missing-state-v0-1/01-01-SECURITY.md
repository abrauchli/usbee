---
phase: 01-tile-popover-hotplug-daemon-missing-state-v0-1
plan: 01
audit_date: 2026-05-12
asvs_level: L1
threats_total: 9
threats_closed: 9
threats_open: 0
block_on: any OPEN with disposition=mitigate that lacks evidence in code
result: SECURED
---

# Phase 01 Plan 01 — Security Audit Report

## Result

**SECURED.** All 8 STRIDE threats + 1 informational EGO-compliance threat are CLOSED against the implemented Walking Skeleton (`usbee@bitcreed.us/`). No active mitigation is missing from code; all `accept`-disposition rationales remain intact in Plan 01 scope.

## Verification Matrix

| Threat ID | Category | Disposition | Verdict | Evidence |
|-----------|----------|-------------|---------|----------|
| T-01-01 | Spoofing (session-bus name `org.usbeehive.Devices`) | accept | CLOSED | Accepted-risk entry below. Session bus is user-private; same-user bus-name spoofing is out of ASVS L1 scope. No code change required. |
| T-01-02 | Tampering (`DeviceEntry` strings rendered into St.Label / PopupMenuItem.label) | mitigate | CLOSED | `grep -rn 'set_markup\|use_markup' usbee@bitcreed.us/extension.js usbee@bitcreed.us/src/` returns zero matches. Plain-text render sites verified: `src/empty-state.js:26` (`item.label.text = …`), `src/empty-state.js:34-36` (St.Label `text:` ctor prop), `src/empty-state.js:43` (St.Entry `text:` ctor prop), `src/popover.js:24-33` (`new PopupMenu.PopupMenuItem(string)` — non-markup constructor), `src/tile.js:21-26,30,42,56` (QuickMenuToggle `title:` / `subtitle:` / `setHeader(…)` — all non-markup APIs). |
| T-01-03 | Tampering (third-party package installs) | mitigate | CLOSED | No `package.json`, `node_modules`, or `Cargo.toml` exists at repo root or under `usbee@bitcreed.us/`. Extension imports only `gi://` and `resource:///org/gnome/shell/…` modules (platform-provided GNOME libraries). |
| T-01-04 | Repudiation (logging) | accept | CLOSED | Accepted-risk entry below. All error paths use `logError(…)` to the journal (`src/dbus-client.js:127,175`; `src/signal-registry.js:92`). No user-action audit log required at ASVS L1. |
| T-01-05 | Information disclosure (D-Bus introspection / SnapshotJson data) | accept | CLOSED | Accepted-risk entry below. Daemon and extension run as the same user; no new disclosure surface. Note: `SnapshotJson` is exposed in the introspection XML (`src/dbus-client.js:47-49`) but is not consumed by Plan 01 code. |
| T-01-06 | DoS (signal storm — `DeviceAdded` / `DeviceRemoved` bursts) | accept (Plan 01) / mitigate (Plan 02) | CLOSED | Accepted-risk entry below. Plan 01 has NO active `proxy.connectSignal(…)` calls — verified: the only `connectSignal` matches in the codebase are (a) doc comments + a `disconnectSignal` helper definition in `src/signal-registry.js:10,38,40,46` (registry infrastructure pre-built for Plan 02; no subscription installed), and (b) two `//`-prefixed planning comments in `src/dbus-client.js:141-142` describing Plan 02's future additions. Zero attack surface. Plan 02 will introduce the 150 ms trailing-edge debounce (D-10) when subscriptions are added. |
| T-01-07 | DoS (`gnome-shell` blocking on sync D-Bus) | mitigate | CLOSED | `grep -rnE '(_sync\(|\.call_sync\|callSync)' usbee@bitcreed.us/extension.js usbee@bitcreed.us/src/` returns zero matches. Async paths verified: `src/dbus-client.js:119-148` (proxy constructed via async callback variant of `new UsbeehiveProxy(bus, name, path, callback)`), `src/dbus-client.js:158-177` (`_snapshotImmediate` wraps `proxy.ListDevicesRemote(callback)` in a `Promise` and `await`s it). |
| T-01-08 | EoP (subprocess spawning) | mitigate | CLOSED | `grep -rnE '(Gio\.Subprocess\|GLib\.spawn_)' usbee@bitcreed.us/extension.js usbee@bitcreed.us/src/` returns zero matches. Empty-state command at `src/empty-state.js:15` is a string literal `'systemctl --user enable --now usbeehive'` placed in a read-only St.Entry (`editable=false, selectable=true` at lines 51-52) for copy-only UX. No execution path. |
| T-01-INFO | Informational — EGO review rejection compliance | mitigate | CLOSED | All gates clean: no `_addItems(`, no `_init(` constructors, no `gi://Gtk` or `gi://Adw` imports in Shell-process code, no `imports.gi.*` / `imports.ui.*` legacy module paths, no `readFileSync` / `require(`, no minified or obfuscated code. Only two `try { … }` blocks present (`src/dbus-client.js:160`, `src/signal-registry.js:89`) — both recovery-path catches as declared in the threat model, each followed by a single `logError(…)` call. No bundled binaries (no `Cargo.toml`, no compiled artifacts beyond `schemas/gschemas.compiled` which is GNOME-standard). |

## Accepted Risks Log

The following dispositions are explicitly accepted for Plan 01-01 scope and remain valid for the implemented code as audited 2026-05-12.

### T-01-01 — Spoofing on session bus name `org.usbeehive.Devices`
- **Threat:** A malicious process running as the same user could claim the `org.usbeehive.Devices` bus name before the legitimate `usbeehived` daemon does, then serve crafted `ListDevices` / `SnapshotJson` payloads.
- **Acceptance rationale:** The session bus is user-private. Any process able to publish on the user's session bus has already achieved user-level code execution; defending against same-user bus-name spoofing is out of scope for any session-bus client. ASVS L1 does not require this control.
- **Compensating controls:** T-01-02 mitigation (plain-text rendering) limits the blast radius of a spoofed daemon to the rendered text contents — no markup injection, no execution paths.
- **Re-evaluation trigger:** Promotion to ASVS L2/L3, or a future feature that executes data received from the bus.

### T-01-04 — Repudiation (no user-action audit log)
- **Threat:** A user action taken via the extension cannot later be attributed.
- **Acceptance rationale:** Plan 01 has no destructive user actions to repudiate. All extension-internal errors are logged via `logError(…)` to the systemd journal (which is system-protected and timestamped). No PII or user-action records exist.
- **Compensating controls:** Journal-level `logError` provides forensic visibility for the only mutating operation surface (extension lifecycle).
- **Re-evaluation trigger:** Plan 02 / future feature introduces user-initiated mutations (e.g., "mute port X").

### T-01-05 — Information disclosure via D-Bus introspection / `SnapshotJson`
- **Threat:** D-Bus introspection on `org.usbeehive.Devices1` exposes the method/signal schema; `SnapshotJson` could leak full device topology to a same-user observer.
- **Acceptance rationale:** Both the daemon and the extension run as the same Unix user; everything they communicate is by definition already readable by that user. The introspection XML (`src/dbus-client.js:33-71`) is a static schema description with no secrets. `SnapshotJson` is not consumed by Plan 01.
- **Compensating controls:** None required — no trust boundary is crossed.
- **Re-evaluation trigger:** Daemon gains a multi-user mode or a system-bus interface; extension begins reading `SnapshotJson`.

### T-01-06 — DoS via signal storm (Plan 01 only)
- **Threat:** A misbehaving or malicious daemon could emit `DeviceAdded` / `DeviceRemoved` at high frequency, forcing `gnome-shell` to repaint the popover excessively.
- **Acceptance rationale (Plan 01):** Plan 01 installs NO signal subscriptions (verified by grep — see Verification Matrix). The popover is repopulated only on `open-state-changed` (lazy, user-driven, Pattern 2 — `src/tile.js:47-51`) and on `store.connect('changed', …)` which fires only when `DBusClient` mutates the store (Plan 01 mutates only on `_onAppeared` / `_onVanished`).
- **Compensating controls:** Lazy repopulate on menu open + single-call snapshot on bus state transitions caps Plan 01 repaint frequency to user-input rate.
- **Re-evaluation trigger:** Plan 02 Task 2 adds `proxy.connectSignal('DeviceAdded'/'DeviceRemoved')`. At that point this threat MUST move to `mitigate` disposition with the 150 ms trailing-edge debounce (D-10) installed inside `_onAppeared`.

## Unregistered Flags

`01-01-SUMMARY.md` does NOT contain a `## Threat Flags` section. No new attack surface was flagged by the executor during implementation.

Manual scan of new attack surface introduced by Plan 01 against the threat register:

| New surface in Plan 01 | Maps to threat | Notes |
|------------------------|----------------|-------|
| `Gio.bus_watch_name` registration on `org.usbeehive.Devices` | T-01-01 (accepted) | Bus-name watching is read-only and registered with `Gio.BusNameWatcherFlags.NONE`. No write capability. |
| `Gio.DBusProxy` for `org.usbeehive.Devices1` + `ListDevicesRemote` consumption | T-01-02, T-01-05, T-01-07 | All three covered: plain-text rendering (T-01-02), same-user data flow (T-01-05), async-only call site (T-01-07). |
| Read-only `St.Entry` containing `systemctl …` string | T-01-08 | Covered: read-only entry, no execution. |
| GSettings schema `org.gnome.usbee` (empty in Plan 01) | n/a | No keys defined yet (`schemas/org.gnome.usbee.gschema.xml`). Zero attack surface. |
| SignalRegistry lifecycle helper | n/a | Pure in-process bookkeeping with `try { … } catch` best-effort dispose. Matches T-01-INFO declared try/catch envelope. |

No unregistered flags.

## Notes on `dbus-iface.xml`

The on-disk `usbee@bitcreed.us/dbus-iface.xml` is informational (diff target). The runtime XML consumed by `Gio.DBusProxy.makeProxyWrapper` is the inlined `IFACE_XML` constant in `src/dbus-client.js:33-71`. Auditors verifying future XML changes must check both files in lockstep — drift between them is a documentation bug, not a security bug, because only the inlined string is wired to the runtime.

## Carry-over for Plan 02 Security Audit

When Plan 02 is implemented and re-audited, the following T-01-06 transition is mandatory:

- T-01-06 disposition flips from `accept` to `mitigate`.
- New required evidence: a 150 ms trailing-edge debounce (`GLib.timeout_add` + flag) installed at the seam at `src/dbus-client.js:140-143`, registered via `SignalRegistry.addTimeout(…)` for clean disposal.
- New required evidence: `proxy.connectSignal('DeviceAdded'/'DeviceRemoved', …)` registrations tracked via `SignalRegistry.addProxySignal(proxy, id)` — NOT `addSignal` (the registry has separate code paths for proxy signals vs GObject signals; using the wrong one will leak the subscription).

No other threat dispositions change in Plan 02 scope per the plan's threat model.
