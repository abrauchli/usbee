---
name: 260905-b0s-context
description: Consume usbeehive's additive BOS + connector/power/quirks/hwdb keys; contain the property dump
status: Executed
gathered: 2026-09-05
---

# Quick Task 260905-b0s: BOS + trimmed-key consumer UI — Context

<domain>
## Task Boundary

`usbeehive` shipped two purely-additive waves on the **unchanged**
`org.usbeehive.Devices5` interface (daemon commits `42633bb`→`508dd95`):

1. **BOS wave** — 13 `properties` keys describing what a device is
   *capable* of (`usb_capable_*`, `usb_link_verdict`,
   `usb_functional_floor_mbps`, `usb_bos_*`, `usb_altmode_*`) plus two new
   signals `DataRateDegraded (sss)` / `DataRateRestored (s)`, keyed on the
   **string device `id`**, not a Type-C port number.
   Spec: `../usbeehive/.planning/specs/DBUS-BOS-CONSUMER-SPEC.md`.
2. **Trim wave** — 11 `properties` keys describing the physical connector,
   power source, kernel quirks and the hwdb model name (`port.*`, `hub.*`,
   `power.source`, `kernel.quirks`, `product_db`). No new signal.
   Spec: `../usbeehive/.planning/specs/DBUS-TRIM-CONSUMER-SPEC.md`.

Everything in `DBUS-FURTHER-SPEC.md` marked DEFERRED (`pm.*`, `function.*`,
`interface.<N>.name`, `authorized`, `port.disabled`, `hub.multi_tt`,
`power.remote_wakeup_capable`, `PortOverCurrent`) is **not emitted by the
daemon** and gets no UI here.

The interface generation stays `Devices5`; `MIN_USBEEHIVE_VERSION` stays
`0.10.0`. USBee must keep working against a daemon that emits **none** of
these keys — every one is optional and absence means *unknown*, never zero.
</domain>

<decisions>
## Decisions

### D-1 — Per-device link speed becomes a first-class row

`link_speed_mbps` / `usb_version` are structured tuple fields the popover
never rendered. They now drive (a) a dim trailing rate caption on every
collapsed device row and (b) a `Link` row at the top of the detail panel,
which is also where the BOS verdict attaches.

### D-2 — REVERSAL of locked decision 260526-c6p D-2 ("deny-list, never allow-list")

**Superseded decision.** `.planning/quick/260526-c6p-…/260526-c6p-CONTEXT.md`
§"Forward-compat for unknown keys" locked:

> Any property key NOT in either list (e.g. future daemon additions) must
> default to **always visible** — the daemon adds keys for a reason;
> gating an unknown key would silently hide useful info. The gate must be
> an explicit-deny list, not an allow-list.

**New decision (authorised by the user, 2026-09-05).** Unknown property
keys render **only** when `show-technical-details` is on.

**Reason the premise no longer holds.** The locked call was correct while
the daemon added one or two keys per release. These two waves add **24
keys at once**, several of them opaque to any user (`usb_bos_container_id`
= a bare UUID, `port.peer_id`, `usb_capable_rx_lanes`). Under the
deny-list an *unmodified* USBee 2.6.0 renders ~12 extra raw
`machine_key: value` rows per device the moment the daemon updates — no
extension release is required to *cause* the regression. A glanceable
Quick Settings surface cannot be a `busctl` dump, so the forward-compat
guarantee is narrowed from "unknown keys are visible by default" to
"unknown keys never throw, never log, and stay reachable one toggle away".

**What is preserved from the original intent.** Unknown keys are still
never dropped, never crash the renderer, and are still discoverable
(`show-technical-details`, plus `SnapshotJson` for the wire-only set).

**What is added.** A `HIDDEN_KEYS` tier for keys with no user meaning at
any tier — they are reachable only via `SnapshotJson`.

The tiering table now lives in one zero-import module,
`usbee@bitcreed.us/src/property-policy.js`, so it is unit-testable under
bare gjs and cannot drift between the renderer and the schema description.

### D-3 — Warnings come only from the daemon's own verdict

`usb_link_verdict == "Degraded"` (equivalently the `usb_link_degraded`
flag key) is the **only** data-rate warning source. USBee never synthesises
one from `usb_capable_speed_mbps > link_speed_mbps` — per BOS spec §6 that
comparison fires on 2 of 2 BOS-bearing devices on the reference machine,
both working exactly as their vendors intend. `BelowCapability` is
informational, phrased as a possibility ("could run at 5 Gb/s on a faster
port"), never as a fault. `usb_bos_suppressed` never produces a verdict:
it means capability is **unknown**, not "USB 2 only".

### D-4 — `port.peer_state` explains, it never warns

Rendered per BOS-spec §6 × TRIM-spec §6, and only when a BOS verdict
exists:

| verdict | `port.peer_state` | copy |
|---|---|---|
| `BelowCapability` / `Degraded` | `not attached` | "The SuperSpeed lines of this connector never linked — a USB 2-only cable or port" |
| `BelowCapability` / `Degraded` | `powered` / `reconnecting` | "The SuperSpeed link on this connector is unstable — try another cable" |
| `BelowCapability` / `Degraded` | `configured` / `suspended` | "This connector's high-speed lanes are up, but this device is not on them" (descriptive, no instruction) |
| any | absent | say nothing |
| absent (no BOS) | any | say nothing |

Guarded additionally on `capable >= 5000 && negotiated <= 480` so the hint
can only appear where the SuperSpeed half of a connector is the plausible
explanation. `port.peer_*` exists only on **root-hub** ports, so the hint
lands on the hub row, not on devices behind it. USBee deliberately does
**not** walk the topology to propagate it — that is non-trivial logic in
the indicator (CLAUDE.md architecture rule) and belongs in the daemon's
`diagnostic.rs`. Filed upstream as an ask, not implemented here.

### D-5 — Notification tiering for the two new signals

| Event | Treatment |
|---|---|
| `DataRateDegraded (id, summary, detail)` | Persistent, coalesced by the **string** `id` in the existing `_notifications` map (string keys cannot collide with the int Type-C port keys). Mutable via a new `data-rate-mutes` `a(ss)` GSettings key holding `(id, headline)`. Honours the 2.5 s daemon-appear suppression window. |
| `DataRateRestored (id)` | Dismiss-only. Never a toast. |
| `BelowCapability` | Silent. No toast, no badge, no tile tier. |
| `DeviceAdded`/`Removed` with `port.connect_type == "hardwired"` | No connect/disconnect toast — a soldered-down device the user cannot unplug re-enumerates on suspend/resume and on `RESET_RESUME` quirks. |

### D-6 — `product_db` names the silicon, it never overrides a real name

Used as the row headline **only** when the device publishes no `iProduct`
(`product === ''`), prefixed with the vendor when the hwdb name does not
already start with it. Otherwise it is a technical row (`Identified as`).
Correction to the UX proposal's premise: the daemon already synthesises
usable headlines, so `product_db`'s real value is naming the chip
(`RTS5411 Hub` reveals that the "4-Port USB 2.0 Hub" is USB 3 silicon on a
dead SuperSpeed lane); the repo screenshot showing `8087:0029` is stale.

### D-7 — The daemon-*newer* case gets its own state

`DaemonState.TOO_NEW`. When the `Version` read fails, the gate still fails
closed to `OUT_OF_DATE` **synchronously** (unchanged contract), then
asynchronously introspects `/org/usbeehive/Devices` and looks for an
`org.usbeehive.Devices<N>` interface with `N > 5`. If found, the state is
upgraded to `TOO_NEW`, whose copy tells the user to update the
*extension* — and shows no `cargo install` command, which would have
changed nothing.

### D-8 — Deferred

UX-WINS item 8 (a11y / theme: scroll-into-view on keyboard focus,
`accessible_name` for colour-only warnings, hard-coded white-alpha CSS,
the translatable `◀` glyph) is **not** in this task. UX-WINS item 9 is
implemented only where item 5 forces it (the muted-devices list — without
it a muted device could only be unmuted through `dconf`); no new toggles.
</decisions>

<specifics>
## Specific Code References

- `src/property-policy.js` (new, zero imports) — `HIDDEN_KEYS`,
  `DEDICATED_KEYS`, `GATED_KEYS`, `KNOWN_KEYS`, `propertyTier`,
  `shouldRenderProperty`.
- `src/link-verdict.js` (new, zero imports) — `formatRate`,
  `deriveLinkInfo`, `deriveHubInfo`, `deriveAltMode`, `resolveProductName`,
  `hasLinkIssue`.
- `src/notify-policy.js` (new, zero imports) — `shouldToastDeviceChange`,
  `isDataRateMuted`, `withDataRateMute`, `dataRateMuteEntries`.
- `src/popover.js` — Link/Detail/Fix rows, hub occupancy + bus power,
  alt-mode row, containment, tech separator, `{count, issues}` return.
- `src/device-store.js` — Tier-0 tile text, `hasIssue` widened.
- `src/dbus-client.js` — two new signal subscriptions + IFACE_XML,
  `connectType` in the notifier `kind`, interface-generation probe.
- `src/notifier.js` — data-rate notifications, hardwired suppression.
- `usbee@bitcreed.us/dbus-iface.xml` — byte-equality invariant with the
  IFACE_XML literal (less the doctype) must be preserved.
</specifics>
