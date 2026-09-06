---
name: 260526-c6p-context
description: Locked decisions for connect-disconnect notifications + tech-details toggle
status: Ready for planning
gathered: 2026-05-26
---

# Quick Task 260526-c6p: Device-change notifications + technical-details toggle — Context

<domain>
## Task Boundary

Implement two extension-only changes identified during 2026-05-26 review of UI_PLAN.md gaps:

1. **Device-change notifications** — surface `DeviceAdded` and `DeviceRemoved` as MessageTray toasts (currently both signals only drive a popover refresh in `src/dbus-client.js:219-225`).

2. **"Show technical details" preferences toggle** — gate a subset of detail-panel rows behind a new GSettings boolean so the default view stays glanceable for non-technical users.

Out of scope for this task (deferred per discussion):
- Trust-signals card (needs usbeehive backend work)
- Charger PDO list (needs usbeehive backend work)
- Active-transports flags (needs usbeehive backend work)
- 8087:0029 headline fix (usbeehive backend change)
- Cat S61 / Android phone classification (usbeehive backend change)
- Cable-report flow, font-size slider, inline footer toggles

</domain>

<decisions>
## Implementation Decisions (LOCKED via AskUserQuestion 2026-05-26)

### Change 1 — Device-change notifications

**Notification scope (default behaviour):** Notify on **every** `DeviceAdded` / `DeviceRemoved` (matches upstream WhatCable behaviour). Use the existing 2.5s `SUPPRESSION_WINDOW_US` baseline-priming pattern from `Notifier.onDaemonAppeared()` so the burst replay on daemon reconnect doesn't spam 20 toasts at once.

**Scope is user-configurable** via a new GSettings enum key (NOT a plain boolean):

| Value | Behaviour |
|---|---|
| `all`     | Notify on every DeviceAdded/Removed (DEFAULT) |
| `power`   | Notify only when `category == 'TypeCPort'` or `device_class in {Phone, Storage}` (charging-relevant) — exact set finalised by planner; conservative cut is fine |
| `off`     | Suppress device-change notifications entirely |

Existing per-port `port-mutes` continues to apply independently to `CapabilityDegraded` events — unchanged.

**Notification copy** (English-only per project constraint, all through `gettext`):
- Added: `Connected: <headline>`
- Removed: `Disconnected: <headline>` — headline resolved from `DeviceStore` last-known snapshot at notification time (DeviceRemoved payload only carries `id`).

**Coalescing:** Use the existing `MessageTray.Source` (lazy `_ensureSource()`). Device-change toasts are transient (do NOT persist across emit, unlike the per-port CapabilityDegraded map). Pattern: construct a new `MessageTray.Notification` each emit; let GNOME stack them in the tray. **Don't** add them to the per-port coalescing map.

**Action buttons:** None. Device-change toasts have no actionable user choice (CapabilityDegraded keeps its mute/prefs actions).

**Urgency:** `Urgency.NORMAL` — informational.

### Change 2 — "Show technical details" toggle

**Toggle location:** Preferences window only. One `Adw.SwitchRow` (matching pattern of existing `hide-empty-ports` / `show-hubs`). NO inline footer toggle in the popover.

**GSettings key:** `show-technical-details` (boolean, default `false`).

**Property split — "Balanced" — LOCKED:**

ALWAYS VISIBLE (default, no toggle needed):
- Summary (subtitle row)
- Charging / Charging issue / Detail (charging_diag rows)
- Driver-not-bound badge (already special-cased in popover.js:216)
- Subclass
- `cable_speed`
- `cable_max_power`
- `cable_vendor`
- `charger_max`
- `pd_contract`
- `usb_power_ma`
- `mount`

GATED behind `show-technical-details = true`:
- `serial`
- `data_role`
- `power_mode`
- `pd_revision`
- `plug_orientation`
- `cable_current`
- `cable_type`
- `drivers`

**Forward-compat for unknown keys:** Any property key NOT in either list (e.g. future daemon additions) must default to **always visible** — the daemon adds keys for a reason; gating an unknown key would silently hide useful info. The gate must be an explicit-deny list, not an allow-list.

> ⚠️ **SUPERSEDED 2026-09-05 by quick task 260905-b0s §D-2** (reversal
> authorised by the user). Unknown property keys now render **only** when
> `show-technical-details` is on, and a new `HIDDEN_KEYS` tier drops
> wire-only keys entirely. Reason the premise no longer holds: usbeehive's
> BOS + connector waves add **24 keys in one go**, several of them opaque
> to any user (`usb_bos_container_id` — a bare UUID, `port.peer_id`,
> `usb_capable_rx_lanes`). Under the deny-list an *unmodified* USBee 2.6.0
> renders ~12 raw `machine_key: value` rows per device the day the daemon
> updates — no extension release is needed to cause it. The forward-compat
> guarantee is narrowed, not dropped: unknown keys still never throw,
> never log, and stay reachable one toggle away (plus `SnapshotJson`).
> See `.planning/quick/260905-b0s-bos-trim-consumer-ui/260905-b0s-CONTEXT.md`.

**Render integration:** The filter applies inside `populateDeviceRows` / `buildDeviceRow` in `src/popover.js`. Live setting read on every popover open (consistent with `hide-empty-ports` live-read at `popover.js:69-70`).

### Claude's Discretion (within locked decisions)

- Exact GSettings schema XML shape (enum vs flags), Adw widget choice for the scope picker (likely `Adw.ComboRow`).
- Whether to add a constant or set for the gated-keys list (style call).
- Whether to extend `Notifier` with the new entry points or introduce a thin helper — the existing class is the natural home.
- Test coverage: the project uses manual smoke tests + a `tests/` directory; add tests where they fit the existing pattern, don't introduce a new test framework.

</decisions>

<specifics>
## Specific Code References

- `src/dbus-client.js:219-225` — currently `DeviceAdded`/`DeviceRemoved` only call `_scheduleRefresh()`. Wire through to a new `Notifier.onDeviceAdded(id, headline)` and `Notifier.onDeviceRemoved(id)` while keeping the refresh path intact.
- `src/notifier.js:65-67` — existing `onDaemonAppeared()` 2.5s suppression must also apply to the new device-change emit path (same `_suppressUntil` guard).
- `src/notifier.js:107-120` — existing `_ensureSource()` Source pattern works for new toasts; reuse.
- `src/device-store.js` — `DeviceStore.devices` holds the current snapshot; the `DeviceRemoved` handler needs to resolve `id → headline` from the **pre-removal** snapshot (lookup must happen BEFORE the store is updated).
- `src/popover.js:235-238` — the `for (const [key, value] of (device.properties || []))` loop is where the gating filter lands.
- `schemas/us.bitcreed.usbee.gschema.xml` — add `show-technical-details` (b) and `device-change-notify-scope` (s enum) keys.
- `prefs.js` — add two new rows to the Preferences page (one Adw.SwitchRow for tech details, one Adw.ComboRow for notify scope).

## Source verifications already done

- DeviceAdded signal payload confirmed `(s id, s headline)` at `dbus-client.js:90-93`.
- DeviceRemoved signal payload confirmed `(s id)` only at `dbus-client.js:94-96`.
- Notifier already takes `settings` in constructor (`notifier.js:45`), so GSettings reads land cleanly.

</specifics>

<canonical_refs>
## Canonical References

- `../usbeehive/UI_PLAN.md` §7 item 4 — connect/disconnect notifications design intent ("baseline-primed at launch... include the kernel driver in the body").
- `../usbeehive/src/dbus.rs` lines 363-380 — confirms DeviceAdded/Removed signal signatures the extension consumes.
- Existing pattern reference: `CapabilityDegraded` flow in `src/notifier.js` lines 83-92 (suppression + live-read settings + per-port mute) is the closest analog.

</canonical_refs>
