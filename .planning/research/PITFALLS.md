# Pitfalls Research

**Domain:** GNOME 46+ Quick Settings Shell extension consuming an existing D-Bus service (`org.usbeehive.Devices1`)
**Researched:** 2026-05-11
**Confidence:** HIGH (Context7-equivalent: official GJS Guide + EGO review guidelines + real-world extension bug reports + recent upstream kernel patches)

Scope: pitfalls specific to GNOME Shell extensions, GJS D-Bus clients, EGO submission, and the USB / UCSI data USBee surfaces. Generic JS / project-management mistakes are out of scope.

---

## Critical Pitfalls

### Pitfall 1: Doing work in `init()` / module top-level instead of `enable()`

**What goes wrong:**
Creating actors, connecting signals, subscribing to D-Bus, or registering a `QuickToggle`/`SystemIndicator` at module load time (top-level `import`/`init` side effects) instead of inside `enable()`. The extension then leaks state across enable/disable cycles, lock/unlock, and `dconf` writes that toggle `disable-extensions`. The shell can cascade-disable/enable extensions; with state created outside `enable()` you get duplicate indicators, double-fired callbacks, and "Object … already disposed" warnings.

**Why it happens:**
GJS makes top-level code "just work" once. The shell's enable/disable contract (per the EGO review guidelines) is non-obvious unless you read it: "Don't create or modify anything before `enable()` is called; Use `enable()` to create objects, connect signals and add main loop sources; Use `disable()` to cleanup anything done in `enable()`." Violating this is an **automatic EGO rejection criterion**.

**How to avoid:**
- All state goes on the `Extension` subclass instance in `enable()`, cleaned up in `disable()`.
- Module top-level may only contain pure imports, class declarations, and `GObject.registerClass(...)` calls (registration is idempotent and required at parse time).
- Set every cleaned-up reference to `null` in `disable()` so the GC can reclaim it.
- Treat the screen lock/unlock cycle as a real test: it calls `disable()` then `enable()`. Test it before EGO submission.

**Warning signs:**
- "Object … has been already disposed — impossible to access it" in `journalctl --user-unit gnome-shell`.
- Two indicators in Quick Settings after locking and unlocking.
- "instance '0x…' has no handler with id N" warnings.

**Phase to address:** Foundation phase — encode the enable/disable contract in the very first extension skeleton and add a screen-lock test to the manual QA checklist.

---

### Pitfall 2: Forgetting to disconnect D-Bus signals (and GLib timeouts) in `disable()`

**What goes wrong:**
`Gio.DBusProxy` signal connections (`g-properties-changed`, `g-signal`, `notify::g-name-owner`) and raw `Gio.DBusConnection.signal_subscribe()` subscriptions remain attached across `disable()`. On the next `enable()` you have 2× handlers, then 4×, then 8×. Notifications fire per handler, so a single `CapabilityDegraded` can produce a notification storm. References captured in callback closures keep the entire old extension graph alive — classic GJS reference-trace leak.

**Why it happens:**
Devs connect signals without storing the handler ID, or store it in a local variable that goes out of scope. The GJS memory model is unforgiving: as long as a callback closure holds a reference, the GObject is rooted and never collected.

**How to avoid:**
- Store **every** handler ID on `this` (`this._addedId`, `this._removedId`, `this._nameOwnerId`, `this._degradedId`, etc.).
- In `disable()`, call `disconnectSignal()` (for proxies created via `makeProxyWrapper`) or `signal_unsubscribe()` (for raw connections) for each.
- For `GLib.timeout_add` / `GLib.idle_add`, store the source ID and `GLib.Source.remove(id)` on disable. Reset to `0` after removal so re-entry is safe.
- For debounce timers (see Pitfall 9) reset the source ID to 0 inside the callback when it fires naturally, so disable doesn't double-remove.
- Be aware: per the GIO docs, queued callbacks may still fire *after* `signal_unsubscribe` returns. Every callback must guard against `this._destroyed === true`.

**Warning signs:**
- Notifications duplicate after a lock/unlock cycle.
- `gnome-shell` RAM grows monotonically over hours.
- `instance '…' has no handler with id N` warnings.

**Phase to address:** Foundation phase — write a `SignalRegistry` helper that tracks IDs and bulk-disconnects on disable. Use it everywhere.

---

### Pitfall 3: Using the Quick Settings legacy/internal API or a stale tutorial

**What goes wrong:**
Code accesses `Main.panel.statusArea.quickSettings._indicators.add_child(...)` and `_addItems(this.quickSettingsItems)` — the pre-GNOME 45 internal API. EGO reviewers reject this on sight as private-API use, and it breaks across releases (GNOME 46 removed the `actor-added` signal on `StWidget`; GNOME 48 migrated the `vertical` property on layout containers). The public, supported API is `Main.panel.statusArea.quickSettings.addExternalIndicator(indicator, position?)`.

**Why it happens:**
A large fraction of Quick Settings tutorials on the public web predate GNOME 45 and use the underscore-prefixed (private) helpers. AI code generators reproduce them verbatim. Real extensions in the wild still ship the old form for compatibility.

**How to avoid:**
- Use `Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator, optionalPosition)`. Nothing else.
- Subclass `QuickSettings.SystemIndicator` for the panel icon and push `QuickToggle` / `QuickMenuToggle` instances into `this.quickSettingsItems`.
- For the tile, subclass `QuickSettings.QuickToggle` (simple) or `QuickSettings.QuickMenuToggle` (USBee's case — needs a per-port popover). Register with `GObject.registerClass`.
- Use `constructor()`, not `_init()` — `_init()` is the legacy pre-45 form and is another EGO red flag.
- Track GNOME `shell-version` in `metadata.json` accurately. List `"46", "47", "48"` if all are supported; do not list `"45"` unless every code path is actually tested there.

**Warning signs:**
- Code references `quickSettings._indicators` or `quickSettings._addItems` (leading underscore = private).
- Any code path uses `_init()` for a subclass instead of `constructor()`.
- The extension only works on one GNOME version.

**Phase to address:** Foundation phase — base the skeleton on the current [gjs.guide Quick Settings page](https://gjs.guide/extensions/topics/quick-settings.html), not third-party tutorials.

---

### Pitfall 4: Synchronous D-Bus calls / sync file I/O on the Shell main loop

**What goes wrong:**
Calling `proxy.ListDevicesSync()` or any `*_sync` D-Bus method blocks the Shell's compositor thread until the daemon responds. If `usbeehive` is slow, restarting, or wedged, the entire GNOME desktop freezes. The same applies to `Gio.DBusProxy.new_for_bus_sync()` during startup. The shell does not have a "this extension is slow" sandbox — its main loop *is* your main loop.

**Why it happens:**
GJS exposes both `*Sync` and `*Async` variants of every D-Bus method. The sync form is shorter, returns directly, and "just works" in interactive testing. Devs reach for it for the same reason they reach for synchronous file reads.

**How to avoid:**
- Always use the async constructors: `Gio.DBusProxy.new()` / `new_for_bus()` (callback) or the wrapped form via `Gio.DBusProxy.makeProxyWrapper(xml)` which gives both async and sync variants — only call the async ones.
- Wrap every D-Bus call with `await` via `Gio._promisify(ProxyClass.prototype, 'ListDevicesAsync', 'ListDevicesFinish')` at module load.
- Set sensible call timeouts on the proxy (`g-default-timeout`). 30 s default is too long for a UI thread; use 5 s and treat timeout as "daemon not responsive."
- Never call `Mainloop.run()` or any sync waiter in the shell process. The shell already owns the main loop.
- Audit: `grep -nE '\b\w+Sync\b' extension.js prefs.js` should produce zero hits before submission.

**Warning signs:**
- Cursor freeze when the indicator is opened.
- "Compositor stutter" reports from users with slow disks or busy systems.
- The first paint of the tile takes longer than other tiles.

**Phase to address:** D-Bus integration phase — pin the async-only rule in code review.

---

### Pitfall 5: Not handling daemon absence / `NameOwnerChanged` properly

**What goes wrong:**
The extension proxies `org.usbeehive.Devices1` at startup. If `usbeehive` isn't running, calls fail with `Gio.IOErrorEnum: Timeout was reached` or `org.freedesktop.DBus.Error.ServiceUnknown`. Worse: if the daemon dies later, the proxy stays "alive" but every call errors out and `DeviceAdded`/`DeviceRemoved` stop arriving — UI shows stale state forever.

**Why it happens:**
A `Gio.DBusProxy` does not auto-tear-down when its name owner vanishes; it just dispatches its `notify::g-name-owner` to `null`. New developers expect "proxy gone = daemon gone" and don't wire the reverse direction.

**How to avoid:**
- Construct the proxy with `Gio.DBusProxyFlags.NONE` (not `DO_NOT_AUTO_START`) only if you *want* D-Bus activation to start the daemon. The user has chosen `systemctl --user`, so prefer `NONE` and treat "no owner" as a UI state, not an error.
- Connect to `proxy.notify::g-name-owner` and re-render the popover on every transition:
  - `g-name-owner === null` → show "usbeehive daemon not running" with a copyable `systemctl --user start usbeehive` hint and a "Try again" button.
  - `g-name-owner !== null` → re-subscribe to `DeviceAdded`/`DeviceRemoved`, re-fetch `ListDevices` to repopulate.
- Do **not** create a fresh proxy on re-appearance; reuse the existing one (signal subscriptions survive owner transitions per the GJS D-Bus guide).
- Use `Gio.DBusProxy.makeProxyWrapper` and check `proxy.g_name_owner` (not just method results) before rendering UI.
- Test by killing `usbeehive` with `kill -9` while the popover is open. Then `systemctl --user start usbeehive` and verify the popover repopulates without a manual refresh.

**Warning signs:**
- After `systemctl --user restart usbeehive`, the tile shows stale devices forever.
- Error logs about `Timeout was reached` or `Spawn.ChildExited`.
- "remote peer vanished with error: Underlying GIOStream returned 0 bytes" in `journalctl`.

**Phase to address:** Daemon-lifecycle phase — design the empty / disconnected state up front, not as polish.

---

### Pitfall 6: Excessive logging — automatic EGO rejection

**What goes wrong:**
Code peppered with `log()`, `console.log()`, `print()`, or `console.debug()` calls in hot paths (per-signal handlers, every device-list refresh, every property change). The EGO guideline is explicit: *"Extensions MUST NOT print excessively to the log. The log should only be used for important messages and errors. If a reviewer determines that an extension is writing excessively to the log, the extension will be rejected."* GNOME Shell's journal becomes unreadable, which is the actual harm.

**Why it happens:**
GJS lacks a built-in log-level abstraction. Devs use `log()` as a print-debug tool and never strip the calls.

**How to avoid:**
- Build a thin `Logger` with `error / warn / info / debug` levels; default to `error+warn` in production builds.
- Gate `debug` on a GSettings key (`org.gnome.usbee.debug-logging`) or a `metadata.json`-stripped build flag.
- Use `logError(error, prefix)` for caught exceptions only — never `log(e.toString())`.
- Pre-submission grep: `grep -nE '\b(log|console\.(log|debug|info))\b\s*\(' *.js | wc -l` should be tiny. Strip anything not in a catch block.
- Run the extension for an hour and inspect `journalctl --user-unit gnome-shell --since "1 hour ago" | grep -i usbee | wc -l`. Expect single digits or zero.

**Warning signs:**
- `journalctl --user-unit gnome-shell` shows USBee lines on every hotplug.
- Reviewer feedback mentions "log spam."

**Phase to address:** Foundation phase — install the logger before any other code.

---

### Pitfall 7: Unnecessary `try`/`catch` blocks (AI-code-smell, automatic EGO rejection)

**What goes wrong:**
Every function wrapped in `try { ... } catch (e) { log(e); }` because "AI suggested it" or "defensive programming." Per the December 2025 EGO rule, this is the **single biggest tell of AI-generated extension code** and is explicitly grounds for rejection: *"Submissions with large amounts of unnecessary code, inconsistent code style, imaginary API usage, comments serving as LLM prompts, or other indications of AI-generated output will be rejected."* The reviewer Javad Rahmatzadeh called out *excessive try-catch* by name.

**Why it happens:**
LLMs systematically over-defend. The pattern looks responsible but is meaningless when the catch only logs and continues — it hides real bugs behind silent failures.

**How to avoid:**
- Only wrap calls that **can** throw and that **have** a non-trivial recovery. D-Bus async calls, file I/O, JSON parsing of `SnapshotJson` — yes. Pure data manipulation — no.
- Either re-throw, recover with a UI state change, or let the exception bubble. Never just `log` and continue.
- Use `try`/`catch` around `await` in async functions where promise rejections must not propagate to the shell.
- The developer must be able to explain in plain English what each `try`/`catch` protects against. If you can't, delete it.

**Warning signs:**
- More than ~5 `try` blocks in the entire extension.
- A `catch` block whose body is `log(e)` or `console.error(e)`.
- Identical catch blocks duplicated across multiple functions.

**Phase to address:** Every phase — code-review gate. Especially important if any AI assistance is used (which itself must be disclosed and justified per EGO rules).

---

### Pitfall 8: Notification spam from `CapabilityDegraded` (flapping ports, dock cycles)

**What goes wrong:**
Each `CapabilityDegraded` signal triggers a new freedesktop notification. A flaky USB-C dock that renegotiates every few seconds, a charger that flaps power roles, or a daemon-restart that re-emits `CapabilityDegraded` for every already-degraded port produces a notification flood that buries everything else and trains users to mass-dismiss all GNOME notifications.

**Why it happens:**
The naive implementation is "signal in → notification out." The freedesktop `Notify` spec returns a `replaces_id` mechanism, but it's invisible unless you look for it.

**How to avoid:**
- **Use `replaces_id` per port.** Keep a `Map<port_id, notification_uint32>`. On the first `Notify` call, save the returned UINT32; on subsequent `CapabilityDegraded` for the same port, pass that UINT32 as `replaces_id` — GNOME Shell atomically updates the existing bubble.
- **Coalesce on a per-port hash.** If `CapabilityDegraded` fires twice with the same `(port, reason)` tuple within N seconds, suppress the second.
- **Withdraw on `CapabilityRestored`.** Call `CloseNotification(uint32)` (or `g_application_withdraw_notification(id)` if using `GNotification`) when the port recovers, so the user doesn't have to dismiss stale bubbles.
- **Suppress during daemon-restart bursts.** When `notify::g-name-owner` transitions `null → owner`, drop all `CapabilityDegraded` notifications for the first 2–3 seconds — the daemon is replaying state, not reporting fresh events.
- **Per-port mute persistence (already in spec).** When the user clicks "Don't notify for this port," store the port's stable identifier in `org.gnome.usbee` GSettings (a string array, not the dock-attach-order-dependent index).
- **Daily-rate cap.** Hard ceiling of N notifications per port per hour as a final safety net.

**Warning signs:**
- A loose USB-C dock produces > 1 notification per second.
- Stopping/starting `usbeehive` produces a notification per attached device.
- Users report "I muted USBee globally" rather than per-port.

**Phase to address:** Notification-policy phase — explicitly call it out as its own milestone, not a sub-task of "Quick Settings tile."

---

### Pitfall 9: `DeviceAdded`/`DeviceRemoved` flood from a single physical plug

**What goes wrong:**
Plugging in one USB-C hub fires `DeviceAdded` 5–15 times in rapid succession (one per child device, interface, partition). The naive listener calls `ListDevices` after each one, hammering the daemon and re-rendering the popover repeatedly. Worse, intermediate paints show partial trees that the user perceives as flicker.

**Why it happens:**
Hotplug events naturally arrive in bursts. The kernel uevent → udev → daemon → D-Bus pipeline preserves that burst-ness. Each event is real; you just don't want to re-render per event.

**How to avoid:**
- **Debounce the refresh.** On every `DeviceAdded`/`DeviceRemoved`, reset a single `GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150ms, refreshFn)`. Only the trailing call hits the daemon.
- **Single shared source ID.** `if (this._refreshTimerId) GLib.Source.remove(this._refreshTimerId); this._refreshTimerId = GLib.timeout_add(...)`. Reset to `0` inside the callback.
- **Differentiate "tile headline" vs "popover detail" refresh frequency.** The tile's one-line summary can refresh on a 500 ms debounce; the open popover may want 150 ms for responsiveness.
- **Don't refetch if popover is closed.** Subscribe to `menu.open` / `menu.close` and skip `ListDevices` calls while the popover is closed; just dirty a flag and refetch on next open.
- **Push upstream:** if `usbeehive` doesn't already provide a single `DevicesChanged` (atomic snapshot diff) signal in addition to per-device add/remove, that is a daemon-side improvement worth proposing — see "Push Upstream" section.

**Warning signs:**
- Popover visibly flickers when a dock is plugged in.
- `journalctl` shows N `ListDevices` D-Bus calls per plug event.

**Phase to address:** Hotplug phase — design debounce up front; retrofitting it later is painful because every consumer of `currentDevices` has to learn it's eventually-consistent.

---

### Pitfall 10: Bundling a binary or running a subprocess

**What goes wrong:**
The temptation is to bundle a small Rust helper (or even `lsusb`) inside the extension zip and `GLib.spawn_async()` it to do something the daemon doesn't expose yet. EGO rejects this for several reasons: extensions MUST be GJS unless required functionality is only in another language (and you must justify it); spawning privileged subprocesses should be avoided at all costs; and bundling pre-built native binaries makes the extension unreviewable.

**Why it happens:**
"I need to read one sysfs file" or "I need to call usbutils for product names." Both are tempting shortcuts.

**How to avoid:**
- **Hard rule from PROJECT.md: USBee performs no `/sys` or udev access of its own.** All USB knowledge flows through `usbeehive` via D-Bus.
- If a capability is missing from the daemon's D-Bus surface, that's a `usbeehive` PR, not a workaround in the extension.
- No `GLib.spawn_*` calls. No `Gio.Subprocess`. No bundled binaries.
- Distribute `usbeehive` separately (user-level systemd, distro packaging, source build) — never inside the extension zip.

**Warning signs:**
- Any `import GLib from 'gi://GLib'` followed by `spawn`.
- A `bin/` or `helper/` directory in the extension source tree.
- The reviewer comment "Why is there a native binary in this zip?"

**Phase to address:** Foundation phase — bake the no-subprocess rule into the architecture doc and the project README.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Synchronous D-Bus call during `enable()` "just for startup" | One less callback to wire | Shell freeze if daemon is slow; cascades into compositor stutter reports | **Never** — use async constructor + render "loading" state |
| Skip handler-ID tracking for "trivial" signals | Less code | Memory leak on every lock/unlock; nondeterministic test failures | **Never** — always track |
| Use `_init()` pattern from old tutorials | Code compiles | EGO rejection; breaks on GNOME 48 | **Never** — use `constructor()` |
| Hard-code device-name strings in English literals | Faster than gettext scaffolding | Forces a rewrite to add i18n; PROJECT.md explicitly requires gettext markers | **Never** — wrap every user-visible string in `_('…')` from day one |
| Bundle a copy of `usbeehive` D-Bus XML and let it drift | No coordinated release | Wire-format drift, silent type mismatches; reviewer sees stale interface | Only with a build-time check that re-extracts XML from the installed `usbeehive` (or fetched from upstream tag) |
| Inline a single `try { ... } catch { log() }` around a synchronous op "to be safe" | Looks defensive | Triggers EGO AI-code rejection signal | **Never** — only when a real recovery exists |
| Skip the screen-lock/unlock manual test | Saves 30 s per QA pass | Memory leaks and duplicate indicators caught only by EGO reviewer | **Never** — it's the single highest-yield manual test |
| Read `/sys` "just for vendor names" since the daemon hasn't exposed them yet | Faster than upstreaming | Violates architecture rule; can't run in Flatpak sandbox if ever considered | **Never** — push upstream |
| Use `console.log` instead of building a Logger | One less file | Log spam → EGO rejection; users see USBee in `journalctl` constantly | **Never** — Logger is ~30 lines |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `org.usbeehive.Devices1` proxy creation | Sync constructor at top of `enable()` | `Gio.DBusProxy.makeProxyWrapper(xml)` + async instantiation; render "connecting" state until the proxy resolves |
| `notify::g-name-owner` | Only connecting once at startup; ignoring the null transition | Treat owner transitions as the source of truth for "is the daemon there"; re-fetch full state on `null → owner` |
| `CapabilityDegraded` signal | Emit one `Notify` per signal | Use `replaces_id` keyed by stable port ID; `CloseNotification` on `CapabilityRestored` |
| `DeviceAdded` / `DeviceRemoved` | Re-fetch full device list per signal | Debounced refresh; skip when popover closed |
| Freedesktop Notifications | Hard-code a fresh notification each call | Store the returned UINT32 per logical event group; reuse as `replaces_id` |
| GSettings access | `getSettings()` called in module top-level | `getSettings()` only inside `enable()` / `Extension` instance methods; PROJECT.md uses schema `org.gnome.usbee` (note: technically EGO conventions prefer `org.gnome.shell.extensions.usbee`, see Pitfall 12) |
| Quick Settings menu opening | Lazy-fetch on first open without a spinner | Pre-warm a cached snapshot; show stale data instantly + refresh in background |
| Extension preferences | Use `Adw.PreferencesWindow` features from a libadwaita version newer than the GNOME 46 baseline (1.5) | Test on a pristine Ubuntu 24.04 LTS VM; pin the libadwaita minimum |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Re-render per signal in burst | Popover flicker on dock attach | Debounce (Pitfall 9) | Any dock with > 2 child devices |
| Sync D-Bus on UI thread | Cursor freeze | Async-only (Pitfall 4) | Daemon under load or paused for debugging |
| Subscribing while popover closed | Daemon does work for invisible UI | Subscribe lazily on `menu.open`, unsubscribe on `menu.close` — *but* keep the lightweight headline subscription always on | Battery-sensitive scenarios; mobile workstations |
| Reconnecting proxy on every owner transition | Subscription churn; missed early signals during reconnect | Reuse the single proxy across owner transitions per GJS guide | Any daemon restart |
| `ListDevices` polling fallback | Constant low CPU drag | Use signals only; if signals seem unreliable, that's a daemon bug — push upstream | All scales |
| Animations / GLib timeouts firing on disposed actors | "already disposed" warnings, eventual `gnome-shell` segfault | Cancel timeouts and animations in `disable()`; guard callbacks with `_destroyed` flag | Lock/unlock cycle |

---

## Security & Privacy Pitfalls

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging full `SnapshotJson` payloads (vendor/product strings, serial numbers) | Privacy leak via system journal which can be shared in bug reports | Never log device identifiers above `debug` level; redact serials |
| "Copy diagnostic to clipboard" feature (a planned post-MVP item) without declaring clipboard access in `metadata.json` description | EGO rejection per clipboard rules | Disclose clipboard access in extension description; ship without default keyboard shortcuts for clipboard interaction |
| Accepting D-Bus signals without validating types | Malicious or buggy `usbeehive` could push malformed data into the Shell process | `Gio.DBusProxy.makeProxyWrapper` does basic signature validation; additionally validate string lengths and numeric ranges before display to avoid UI weirdness |
| Trusting daemon-supplied diagnostic text as plain text | If `usbeehive` ever produces strings containing pango markup or worse, displaying them in `St.Label` with `use_markup=true` becomes an injection vector | Use `set_text()` (plain) not `set_markup()` for daemon-supplied strings; format USBee's own diagnostic templates locally |
| Spawning a privileged subprocess to "fix" charging | Critical EGO violation + privilege escalation | Don't. Surface diagnosis only; remediation is documented text |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Empty popover when daemon is absent | User thinks USBee is broken | Explicit "usbeehive daemon not running" state with copyable `systemctl --user start usbeehive` and a "Try again" button (per PROJECT.md requirement) |
| Tile headline that changes every second when wattage fluctuates | Distracting peripheral motion | Snap headline updates to a 1 Hz update tick; reserve sub-second updates for the open popover |
| Generic "USB device" name when product strings are missing | "I have 3 things called 'USB device' — which is which?" | Fall back to vendor name + interface class + port path, in that order; never just "USB device" |
| Cable diagnostic written in pure tech-speak ("USB 2.0 BC1.2 SDP attached at HS") | Confuses non-experts (target users explicitly include "ordinary users") | Plain-English templates per PROJECT.md ("Cable limited to USB 2.0 — swap for a full-featured cable to reach 10 Gb/s") — even at the cost of some precision |
| Notification "Don't notify for this port" persists by dock-attach order | User mutes port 1 today, plugs a different dock tomorrow, suddenly muted the wrong port | Persist by stable hardware identifier (port path, controller GUID), not by enumeration index |
| Icon never changes regardless of state | No glanceable information | Three or four symbolic icons: idle, charging-in, providing-power, degraded-warning |
| Localization deferred but strings inline | Inevitable rewrite when translation lands | Wrap every user-visible string in `_('…')` (gettext) from day one — PROJECT.md mandates this |
| Per-port mute UI buried | User can't find the off-switch and resorts to disabling the extension | "Don't notify for this port" as a notification action button (freedesktop spec supports actions); also a list in prefs |

---

## "Push Upstream to `usbeehive`" — NOT Bugs to Fix Here

Per the architecture rule, the following should be filed against the daemon, not worked around in the extension:

| Symptom in USBee | Real Issue | Upstream Fix in `usbeehive` |
|------------------|------------|------------------------------|
| Wattage flickers to 0.1 A when no device is connected | Known UCSI kernel quirk (max-current defaults to 0.1 A) — see [linux-usb patch series, October 2025](https://patchew.org/linux/20251007000007.3724229-1-jthies@google.com/) | Daemon should detect "no partner" and report `null`/"none" rather than 0.1 A; possibly track upstream kernel fix |
| `CapabilityDegraded` fires for one transient renegotiation | Daemon's degradation detector is too eager | Daemon-side hysteresis (e.g., must remain degraded for N seconds before signalling) — but **also keep extension-side coalescing** (Pitfall 8) as defense-in-depth |
| Vendor / product strings missing for some devices | Daemon hasn't consulted `usb.ids` or libusb descriptor strings | Daemon-side lookup; extension never reads `/sys` |
| `power_role` reads "unknown" on some hardware | UCSI driver constraints — driver always selects host role; `/sys/class/typec/portX/power_role` may be empty on UCSI-only systems | Daemon documents the limitation; extension surfaces "power direction unknown" rather than guessing |
| Daemon-restart replays all `CapabilityDegraded` events | No persistence of last-emitted state | Daemon could expose a `LastDegradationTimestamp` per port so extension can suppress stale replays. Until then, extension uses the 2–3 s "owner transition mute" workaround (Pitfall 8) |
| Need atomic device-list snapshot to avoid `ListDevices` polling | Burst of per-device signals creates the flood in Pitfall 9 | Daemon could add a `DevicesChanged` signal with a sequence number; extension consumes that instead of N adds/removes |
| Need to know if hardware actually supports per-port wattage | Without it, extension can't decide whether to show "—" or "0 W" | Daemon-side per-port `Capabilities` property listing which fields are real-time vs unknown vs unsupported |
| Charging-direction control | User wants "stop charging this power bank" | **Out of scope for both projects** per PROJECT.md ("USBee is read-mostly"; usbeehive likely the same) — document as a kernel/firmware limitation |

**Action:** when one of these surfaces during development, file an issue against `~/projects/rust/usbeehive` immediately; do not patch around it in USBee.

---

## "Looks Done But Isn't" Checklist

- [ ] **Quick Settings tile:** Verify it survives screen lock/unlock at least 3 times with no duplicates and no "already disposed" warnings. Bonus: lock/unlock 20× in a script to surface slow leaks.
- [ ] **Tile:** Verify it appears in the correct ordinal position (alongside Wi-Fi/BT/Sound) and doesn't get pushed into the overflow on a small monitor.
- [ ] **Disable cleanup:** Run `gnome-extensions disable usbee@... ; gnome-extensions enable usbee@...` 10× and check `journalctl --user-unit gnome-shell` for handler/dispose warnings.
- [ ] **Daemon absence:** With `usbeehive` stopped, the popover renders the empty-state UI within 500 ms and never shows a spinner forever.
- [ ] **Daemon disappearance mid-session:** Open popover, `systemctl --user stop usbeehive`, watch popover transition; restart daemon; watch popover repopulate. Without manual refresh.
- [ ] **Burst hotplug:** Plug a powered hub with 4 devices; verify popover renders once (or twice), not 4–8 times.
- [ ] **Notification coalescing:** Loop emit `CapabilityDegraded` 20× from a test harness; verify exactly one notification per logical port, not 20.
- [ ] **Notification withdrawal:** Verify `CapabilityRestored` actually withdraws the bubble (or marks it resolved), not just leaves it in the tray.
- [ ] **Per-port mute persistence:** Mute port A; restart shell; reopen popover; verify port A is still muted.
- [ ] **Per-port mute key stability:** Mute port A on dock 1; swap to dock 2 (different topology); verify mute doesn't accidentally apply to a different physical port.
- [ ] **GSettings schema:** `gsettings list-schemas | grep usbee` returns the schema; `gsettings list-keys org.gnome.usbee` lists every defined key.
- [ ] **Schema install path:** Compiled `gschemas.compiled` lives in `<ext>/schemas/` and is found by `getSettings()`.
- [ ] **i18n scaffolding:** `xgettext` over `*.js` produces a non-trivial `.pot` file with every user-visible string.
- [ ] **No sync calls:** `grep -nE '\b\w+Sync\b' *.js` outputs nothing (or only entries with a justifying comment).
- [ ] **No spawn:** `grep -nE 'spawn|Subprocess' *.js` outputs nothing.
- [ ] **No `/sys` access:** `grep -n '/sys/' *.js` outputs nothing.
- [ ] **Log volume:** 1-hour idle journal has < 10 USBee lines.
- [ ] **Metadata sanity:** `metadata.json` has correct `uuid`, `name`, `shell-version`, `url`, no stale `settings-schema` if no schema, no 404 URLs.
- [ ] **No stray files:** Zip contains no `.git/`, `.github/`, `node_modules/`, `*.ts` (only transpiled JS), `.eslintrc`, `package-lock.json`, etc.
- [ ] **License header in every source file** + `LICENSE` file present + matches GPL-3.0 per PROJECT.md.
- [ ] **GNOME version matrix:** Manually tested on GNOME 46 (Ubuntu 24.04 LTS), 47, and 48 (or whatever ships at submission time).
- [ ] **No AI-smell code:** Self-review for unjustified `try`/`catch`, copy-pasted boilerplate, dead variables, comments that read like LLM prompts, imaginary API calls.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Memory leak from missed signal disconnect | LOW | Find the missed `disconnect`; add a `SignalRegistry`; refactor all sites |
| EGO rejection for sync calls | LOW | Replace `*Sync` with `*Async` + `Gio._promisify` |
| EGO rejection for AI-smell code | MEDIUM | Strip unnecessary `try`/`catch`, simplify logic; the codebase may need a second pass and is **likely faster to rewrite** the offending file from scratch |
| EGO rejection for excessive logging | LOW | Add a Logger, gate everything below `warn` |
| Quick Settings API breaks on next GNOME release | MEDIUM | Treat as a minor release; gate API differences with `Config.PACKAGE_VERSION` checks if necessary; bump `shell-version` in `metadata.json` |
| Notification spam already shipped to users | MEDIUM | Hotfix that adds `replaces_id` + rate cap; ship a "reset notification preferences" prefs button as a safety net |
| Stale UI after daemon restart | LOW | Wire `notify::g-name-owner` re-fetch path; ship hotfix |
| Schema file forgotten in zip | LOW | Re-zip with `schemas/*.gschema.xml` + `gschemas.compiled`; resubmit |
| Bundled binary discovered | HIGH | Remove the binary, push the feature upstream into `usbeehive`, resubmit — likely a multi-week round trip |
| Wrong shell-version in metadata.json | LOW | Bump and resubmit; users on the unlisted versions will re-enable on next session |

---

## Pitfall-to-Phase Mapping

Mapping pitfalls to the milestone phases USBee will go through.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| #1 Work in init not enable | Foundation (skeleton) | Lock/unlock cycle test passes |
| #2 Missed signal disconnect | Foundation (SignalRegistry helper) | 10× disable/enable produces no GLib warnings |
| #3 Legacy/internal Quick Settings API | Foundation (tile skeleton) | Code review — no underscore-prefixed access |
| #4 Sync D-Bus on main loop | D-Bus client phase | `grep -nE '\bSync\b'` is clean |
| #5 Daemon absence / vanish | Daemon-lifecycle phase | Manual test of `systemctl --user stop/start usbeehive` while popover is open |
| #6 Log spam | Foundation (Logger before any feature code) | 1-hour idle log has < 10 USBee lines |
| #7 AI-smell `try`/`catch` | Every phase (review gate) | Reviewer can explain every catch block |
| #8 Notification spam | Notification-policy phase | `replaces_id` map + restart-suppression window verified by harness |
| #9 Hotplug burst flood | Hotplug phase | Plug 4-device hub: ≤ 2 popover repaints |
| #10 Subprocess / native binary | Architecture phase (and review gate) | Zip contains only `.js` / `.xml` / `.css` / `.po` / `LICENSE` / `metadata.json` |
| Stale tutorial code | Foundation | Source: only [gjs.guide](https://gjs.guide/extensions/) and current GNOME Shell git |
| GNOME 48 "already disposed" | Foundation (destroy-pattern discipline) | Lock/unlock test under GNOME 48 specifically |
| GSettings schema misplacement | Foundation (build/install) | Fresh install via `gnome-extensions install <zip>` works without manual `glib-compile-schemas` |
| i18n absent | Foundation | `xgettext` over `*.js` extracts every UI string |

---

## Sources

**Authoritative (HIGH confidence):**
- [GNOME Shell Extensions Review Guidelines — gjs.guide](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) — the EGO rulebook; binding for submission
- [Quick Settings — GJS Guide](https://gjs.guide/extensions/topics/quick-settings.html) — current Quick Settings API (`addExternalIndicator`, `QuickToggle`, `QuickMenuToggle`, `SystemIndicator`)
- [D-Bus — GJS Guide](https://gjs.guide/guides/gio/dbus.html) — `Gio.DBusProxy`, `makeProxyWrapper`, async constructors, `g-name-owner` semantics
- [Asynchronous Programming — GJS Guide](https://gjs.guide/guides/gjs/asynchronous-programming.html) — promisify pattern, why sync I/O is unacceptable
- [Tips on Memory Management — GJS Guide](https://gjs.guide/guides/gjs/memory-management.html) — handler-ID tracking, reference tracing
- [Style Guide — GJS Guide](https://gjs.guide/guides/gjs/style-guide.html) — official ESLint rules, code style
- [Preferences — GJS Guide](https://gjs.guide/extensions/development/preferences.html) — GSettings + `getSettings()` + `metadata.json` `settings-schema`
- [AI and GNOME Shell Extensions (Javad Rahmatzadeh, Dec 2025)](https://blogs.gnome.org/jrahmatzadeh/2025/12/06/ai-and-gnome-shell-extensions/) — the December 2025 AI-code rejection rule
- [Phoronix coverage of the AI ban](https://www.phoronix.com/news/GNOME-Extensions-Block-AI)
- [Desktop Notifications Specification — freedesktop.org](https://specifications.freedesktop.org/notification-spec/latest/) (via the linked archived spec) — `replaces_id` and `CloseNotification` semantics
- [Using Notifications — GNOME Developer Docs](https://developer.gnome.org/documentation/tutorials/notifications.html) — `GNotification` ID/withdraw semantics
- [glib-compile-schemas reference](https://docs.gtk.org/gio/glib-compile-schemas.html) — schema install / compile

**Real-world signals (MEDIUM confidence — bug reports and extension source):**
- [GSConnect issue #666 — high RAM use under GNOME Shell](https://github.com/andyholmes/gnome-shell-extension-gsconnect/issues/666) — example of GJS leak symptoms
- [Clipboard Indicator issue #499 — "already disposed"](https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator/issues/499) — example of GNOME 48 dispose-pattern fallout
- [Dash-to-Panel issue #1924 — "already disposed"](https://github.com/home-sweet-gnome/dash-to-panel/issues/1924)
- [pop-os/pop#2867 — "Object St.Bin has been already disposed" log spam](https://github.com/pop-os/pop/issues/2867)
- [appindicator extension #485 — D-Bus startup timing](https://github.com/ubuntu/gnome-shell-extension-appindicator/issues/485)
- [quick-settings-tweaks GNOME 46 issue #133](https://github.com/qwreey/quick-settings-tweaks/issues/133) — `actor-added` signal removal on GNOME 46
- [quick-settings-tweaks releases — GNOME 48 `vertical` migration + "already disposed"](https://github.com/qwreey/quick-settings-tweaks/releases) — concrete API churn 46→47→48
- [Quick Settings Audio Panel (QSAP)](https://github.com/Rayzeq/quick-settings-audio-panel) — example covering 45/46/47/48

**Upstream UCSI/kernel context (HIGH confidence — kernel patches):**
- [UCSI Power Supply patch series, Oct 2025](https://patchew.org/linux/20251007000007.3724229-1-jthies@google.com/) — confirms 0.1 A default, missing change notifications, DRP enum quirks
- [Red Hat Bug 1891807 — UCSI psy false AC source](https://bugzilla.redhat.com/show_bug.cgi?id=1891807)
- [Framework community thread — controlling USB-C power direction](https://community.frame.work/t/tracking-controlling-power-direction-for-usb-c/19259) — `/sys/class/typec/portX/power_role` limits on UCSI
- [kernel.org sysfs-class-power docs](https://www.kernel.org/doc/Documentation/ABI/testing/sysfs-class-power)

---
*Pitfalls research for: USBee — GNOME 46+ Quick Settings extension for `org.usbeehive.Devices1`*
*Researched: 2026-05-11*
