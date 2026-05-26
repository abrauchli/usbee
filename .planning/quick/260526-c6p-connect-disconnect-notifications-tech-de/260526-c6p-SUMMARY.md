---
quick_id: 260526-c6p
status: complete
executed: 2026-05-26
commits:
  - 250aec7 — feat(notifier): emit device-change toasts on DeviceAdded/Removed with configurable scope
  - 286c85f — feat(popover,prefs): gate technical detail rows behind show-technical-details setting
files_changed:
  - usbee@bitcreed.us/schemas/org.gnome.shell.extensions.usbee.gschema.xml
  - usbee@bitcreed.us/src/notifier.js
  - usbee@bitcreed.us/src/dbus-client.js
  - usbee@bitcreed.us/src/popover.js
  - usbee@bitcreed.us/prefs.js
files_unchanged_but_referenced:
  - usbee@bitcreed.us/src/device-store.js
---

# Quick Task 260526-c6p — Execution Summary

## Outcome

Both tasks executed cleanly in two atomic commits. The extension now:

1. Emits transient "Connected: %s" / "Disconnected: %s" MessageTray toasts
   on every `DeviceAdded` / `DeviceRemoved` D-Bus signal from `usbeehive`,
   gated by the new `device-change-notify-scope` GSettings string enum
   (`all` / `power` / `off`, default `all`). Device-change toasts share the
   2.5 s `SUPPRESSION_WINDOW_US` baseline-priming guard with
   `CapabilityDegraded` and are deliberately stateless (no per-port
   coalescing, no actions).

2. Hides an explicit-deny list of eight advanced property rows in the
   device detail panel behind the new `show-technical-details` GSettings
   boolean (default `false`). Unknown property keys are NEVER gated —
   forward-compat by design.

3. Surfaces both new settings in the prefs window's General group: an
   `Adw.SwitchRow` for the tech-details toggle and an `Adw.ComboRow` for
   the notify-scope enum, with manual two-way wiring and lifecycle
   teardown on the window's `close-request`.

## Files changed

| File | Change |
|------|--------|
| `usbee@bitcreed.us/schemas/org.gnome.shell.extensions.usbee.gschema.xml` | Added two new `<key>` elements: `show-technical-details` (boolean, default false) and `device-change-notify-scope` (string with `<choices>` all/power/off, default 'all'). |
| `usbee@bitcreed.us/src/notifier.js` | Added `onDeviceAdded(id, headline, kind?)` and `onDeviceRemoved(id, headline, kind?)` public methods plus a shared `_emitDeviceChange(headline, kind, added)` helper that applies the suppression guard, live-reads the scope setting, applies the 'power' classifier filter, and emits a fresh title-only `MessageTray.Notification`. Did NOT touch the per-port coalescing map. |
| `usbee@bitcreed.us/src/dbus-client.js` | Replaced the two `connectSignal('DeviceAdded'…)` / `connectSignal('DeviceRemoved'…)` registrations with handlers that destructure the payload, resolve `id → headline` + `kind = {category, deviceClass}` against the pre-mutation `_store.devices` snapshot, call the Notifier, then `_scheduleRefresh()`. Registry tracking unchanged. |
| `usbee@bitcreed.us/src/popover.js` | Added the module-level `GATED_KEYS` Set constant near the top. `populateDeviceRows` now live-reads `show-technical-details` (parallel to the existing `hide-empty-ports` / `show-hubs` reads) and passes it as a second arg to `buildDeviceRow`. The property-bag loop skips gated keys when `showTech === false`. |
| `usbee@bitcreed.us/prefs.js` | Extended `_buildGeneralGroup` signature to accept `window`; updated `fillPreferencesWindow` call site. Added two new rows in the General group: an `Adw.SwitchRow` bound to `show-technical-details` and an `Adw.ComboRow` with three localized choice labels wired manually to `device-change-notify-scope`. `close-request` disconnects both scope-related signal ids. |

`src/device-store.js` was re-read (per Task 1D verify-only sanity check) to
confirm `id`, `category`, `device_class`, and `headline` are exposed by
`unpackDeviceEntry()` — all four are present (tuple indices 0/1/2/5). No
code change required.

## New gettext strings introduced

The following user-visible strings are NEW in this task and must land in
the next `.pot` regeneration (run `xgettext` per the project release flow,
or re-pack the extension — `gnome-extensions pack` does not regenerate the
`.pot` automatically).

```
Connected: %s
Disconnected: %s
Show technical details
Include advanced rows (serial, data role, cable details, drivers) in the device popover
Notify on device changes
Toasts when a USB device is connected or disconnected
Notify on all device changes
Notify only on charging-relevant changes
Do not notify on device changes
```

Eight of the nine are bare strings (no interpolation). The two notifier
titles use the canonical `_('…%s').format(...)` shape — `xgettext` skips
template literals, per `notifier.js:128-130` and RESEARCH §Pitfall I.

Schema `<summary>` / `<description>` text is NOT user-visible at runtime
in our extension surface and is not gettext-wrapped (consistent with the
existing schema entries).

## Verification run

| Check | Result |
|-------|--------|
| `glib-compile-schemas --strict usbee@bitcreed.us/schemas/` | OK (silent) |
| `gjs` schema-key probe — both new keys present | OK (`device-change-notify-scope,hide-empty-ports,port-mutes,show-hubs,show-technical-details`) |
| `GATED_KEYS` constant exists with all eight keys + the `!showTech && GATED_KEYS.has` guard | OK |
| Prefs binds both new keys + uses `Adw.ComboRow` | OK |
| No `set_markup` / `use_markup` calls added to notifier.js or popover.js | OK (only matches are JSDoc comments warning against them) |
| `_notifications.set` count in notifier.js | 1 (existing `_emitDegraded` line — coalescing map untouched) |
| Both new title strings wrapped in `_('…').format(...)` | OK |
| Node syntax-check on all modified `.js` files | OK |

## Deviations from plan

1. **`gschemas.compiled` NOT committed.** The plan's Task 1A directive and
   the orchestrator's `<constraints>` block both claimed the compiled
   schema is tracked in git and must be re-committed. This is factually
   incorrect: the file is listed in the repo's top-level `.gitignore`
   (`usbee@bitcreed.us/schemas/gschemas.compiled`) and is NOT tracked
   (`git ls-files usbee@bitcreed.us/schemas/` returns only the XML).
   It is generated at release time by `gnome-extensions pack` (verified
   2026-05-14 against the release workflow). Force-staging a gitignored
   file via `git add -f` is explicitly forbidden by the executor's safety
   protocol, and doing so would have introduced a build artifact into git
   history with no purpose. The XML source is committed; the compiled
   binary will be regenerated locally and by `gnome-extensions pack`
   during the release zip build, exactly as today. No functional impact.

2. **`device-store.js` re-read but not modified.** Plan Task 1D framed
   this as verify-only; the four required fields are all present. The
   file is recorded in the SUMMARY's `files_unchanged_but_referenced`
   list for traceability, but it is NOT in the commit set. No deviation
   from the plan's intent — just clarifying that the file appears in the
   plan frontmatter's `files_modified` list for inspection-only purposes.

3. **Worktree base reset.** The orchestrator instructed the executor to
   verify `merge-base HEAD == df1dc6c`; on entry, HEAD was at `5802711`
   (older — `df1dc6c` and four other commits had landed on master in the
   meantime but were not pulled into this worktree). Per the
   `<worktree_branch_check>` recovery clause, executed
   `git reset --hard df1dc6c23dfe97f6ab03e2e450d4601e54b8a706`, bringing
   the worktree current. No work lost (the prior worktree HEAD had no
   local changes). Both new commits sit on top of `df1dc6c` as intended.

No other deviations. The locked CONTEXT decisions (property split, toggle
location, notify-scope tri-state, copy strings, forward-compat semantics,
GATED_KEYS contents) were honored verbatim.

## Manual smoke test (run before merging)

1. **Schema sanity** (no install needed):
   ```
   glib-compile-schemas --strict usbee@bitcreed.us/schemas/
   gsettings --schemadir usbee@bitcreed.us/schemas list-keys \
       org.gnome.shell.extensions.usbee
   ```
   Expect the five keys: `device-change-notify-scope`, `hide-empty-ports`,
   `port-mutes`, `show-hubs`, `show-technical-details`.

2. **Pack the extension** — must succeed:
   ```
   cd usbee@bitcreed.us && gnome-extensions pack --force --extra-source=icons
   ```

3. **Install + enable in a nested Wayland session**:
   ```
   gnome-extensions install --force usbee@bitcreed.us.shell-extension.zip
   dbus-run-session -- gnome-shell --nested --wayland
   # (inside nested session) enable USBee from gnome-extensions-app
   ```

4. **Device-change toasts**:
   - With `usbeehived` running on the session bus, attach/detach a USB
     device. Confirm a "Connected: <headline>" toast appears on attach
     and "Disconnected: <headline>" on detach.
   - `gsettings set org.gnome.shell.extensions.usbee device-change-notify-scope off` — repeat
     the attach/detach; no toasts should appear.
   - `gsettings set … device-change-notify-scope power` — attach an HID
     keyboard (USB-A): no toast. Attach a phone in USB transfer mode or
     plug a USB-C charger: toast appears.

5. **Suppression window** — restart `usbeehived` while the extension is
   loaded. The 2.5 s suppression should swallow any burst of stale
   add/remove signals that usbeehive replays at NameOwnerChanged.

6. **CapabilityDegraded regression** — trigger a degraded port (or
   simulate via `busctl --user emit /org/usbeehive/Devices
   org.usbeehive.Devices2 CapabilityDegraded ...`); the existing port
   notification + mute action + prefs muted-port list must still work
   identically.

7. **Tech-details toggle**:
   - `gnome-extensions prefs usbee@bitcreed.us` → open the General group.
     Both new rows render in order: "Show technical details" SwitchRow,
     then "Notify on device changes" ComboRow.
   - Toggle "Show technical details" off → re-open the tile popover →
     expand a device row known to expose `serial` and `drivers`. The
     eight gated rows must disappear. The Summary row, charging_diag
     rows, "Driver: not bound" row, and Subclass row must remain.
   - Toggle on → all gated rows return.
   - Unknown-key forward-compat: confirm any property the daemon emits
     whose key is NOT in `GATED_KEYS` renders in both states.

8. **Notify-scope round-trip** — cycle the combo through all three
   options; `gsettings get … device-change-notify-scope` must reflect
   the selection. Set via `gsettings set …` to each value out-of-band;
   the combo must update its selection within one main-loop tick.

9. **Log clean** — `journalctl --user -f /usr/bin/gnome-shell` must show
   no warnings or errors from the extension across the above flow.

## Files of record

- Plan: `.planning/quick/260526-c6p-connect-disconnect-notifications-tech-de/260526-c6p-PLAN.md`
- Context (locked decisions): `.planning/quick/260526-c6p-connect-disconnect-notifications-tech-de/260526-c6p-CONTEXT.md`
- This summary: `.planning/quick/260526-c6p-connect-disconnect-notifications-tech-de/260526-c6p-SUMMARY.md`
