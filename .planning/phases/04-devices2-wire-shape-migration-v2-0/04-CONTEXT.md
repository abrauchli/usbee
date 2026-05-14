# Phase 04: Devices2 wire-shape migration (v2.0) — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Discuss-phase replacement:** This document was synthesised directly from the
captured phase-seed todo (`.planning/todos/pending/2026-05-14-migrate-to-usbeehive-devices2-wire-shape.md`,
commit `724c22a`) which itself encodes a fully-negotiated cross-team spec.
A live `/gsd-discuss-phase` was skipped because every decision below was
either pre-locked in that negotiation or trivially derivable from the
shipped daemon source. If new ambiguities surface during planning,
re-open with `/gsd-discuss-phase 4`.

## Phase Goal (from ROADMAP)

With usbeehive having shipped `org.usbeehive.Devices2`, USBee migrates
its proxy and every downstream consumer to the new structured wire in
a single lockstep release. Users on a current daemon see the same UX
as today (plus fixed-up subtitles for outbound charging and a visible
flag for driver-less devices); users on an outdated daemon see a clear
"please update usbeehive" empty state instead of garbage data. The
shipped artifact is `usbee@bitcreed.us.shell-extension.zip` carrying
`version-name: 2.0.0`, first ever uploaded to extensions.gnome.org.

## Requirements In Scope

`WIRE-01, WIRE-02, WIRE-03, WIRE-04, CLEAN-01, CLEAN-02, CLEAN-03,
DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, COMPAT-01, COMPAT-02,
REL-01, REL-02, REL-03` (16 total). See `.planning/REQUIREMENTS.md`
§v2.0 for full bodies.

## Plan Split (locked, from ROADMAP §Phase 4)

| Plan | Title | Covers |
|------|-------|--------|
| 04-01 | Pre-wire-cut prep & UX decisions | DISP-01 staging, DISP-02 design, DISP-03 copy, DISP-04 design, DISP-05 decision, COMPAT-02 copy |
| 04-02 | Wire-shape cutover | WIRE-01..04, CLEAN-01..03, DISP-01..05 integration, COMPAT-01..02 integration |
| 04-03 | Release coordination | REL-01..03 |

Wave 1 = 04-01. Wave 2 = 04-02 (blocked on 04-01). Wave 3 = 04-03
(blocked on 04-02). The split is **locked** unless the plan-checker
catches a coverage gap.

## Locked Decisions

### D-2.0-01 — Interface name bump

`org.usbeehive.Devices1` → `org.usbeehive.Devices2`. `BUS_NAME`
(`org.usbeehive.Devices`) and `OBJECT_PATH` (`/org/usbeehive/Devices`)
unchanged. Both the `dbus-iface.xml` file on disk and the `IFACE_XML`
template literal in `src/dbus-client.js` get rewritten verbatim from
the shipped daemon's interface definition.

### D-2.0-02 — Authoritative wire shape

The 19-field `DeviceEntry` tuple shape is read directly from
`../usbeehive/src/dbus.rs:108-260`. Fields, in tuple order:

1. `id` (s)
2. `category` (s) — `Hub` | `TypeCPort` | `UsbDevice`
3. `device_class` (s) — `Keyboard` | `Mouse` | `Storage` | `Display` |
   `Audio` | `Camera` | `Printer` | `Phone` | `Hub` | `NetworkWired` |
   `NetworkWireless` | `InputTablet` | `Gamepad` | `SecurityKey` |
   `SmartcardReader` | `Bluetooth` | `Serial` | `VideoCapture` |
   `Unknown`. `Unknown` when `category=TypeCPort`.
4. `device_subclass` (s) — daemon-curated, non-binding, may be empty
5. `status` (s) — pre-existing values + new `Sourcing` (host charging
   a downstream device)
6. `headline` (s)
7. `subtitle` (s)
8. `icon` (s)
9. `vendor` (s) — manufacturer prose
10. `product` (s) — raw USB iProduct
11. `vendor_id` (q) — uint16, zero for non-USB entries
12. `product_id` (q) — uint16
13. `primary_driver` (s) — empty when unbound
14. `properties` (a(ss)) — flat `(machine_key, value)` pairs
15. `port_number` (i) — `-1` if not a Type-C port
16. `link_speed_mbps` (u) — uint32 Mbit/s, 0 if unknown
17. `usb_version` (s) — canonical short form (`"2.0"`, `"3.2"`,
   `"4.0"`), empty if unknown
18. `power` (uus) — `(power_in_mw, power_out_mw, power_role)`.
   `power_role ∈ {Source, Sink, DualRole, Unknown}`. Invariant:
   `power_in_mw > 0` ⟺ port is actively sinking PD power
19. `charging_diag` (bsssb) — `(present, bottleneck, summary, detail,
   is_warning)`. `present == false` is the absence sentinel.
   `bottleneck ∈ {NoCharger, ChargerLimit, CableLimit, DeviceLimit,
   Fine}`

Full DBus tuple signature for `ListDevices` payload:
`a(ssssssssssqqsa(ss)ius(uus)(bsssb))` — verify by counting against
the daemon source before committing the XML.

### D-2.0-03 — `Diagnose(port)` return shape

`(present: b, bottleneck: s, summary: s, detail: s, is_warning: b)` —
the leading `present` bool replaces the v1 empty-string sentinel. USBee
must always check `present` before reading any other field.

### D-2.0-04 — Property machine-key vocabulary (daemon-shipped)

The daemon's `properties: a(ss)` bag emits keys from this initial set
(see `../usbeehive/CHANGELOG.md` `[Unreleased]` §"Bullet text →
property key migration"):

`serial`, `mount`, `drivers`, `data_role`, `power_mode`,
`pd_revision`, `plug_orientation`, `pd_contract`, `cable_speed`,
`cable_current`, `cable_max_power`, `cable_type`, `cable_vendor`,
`charger_max`, `usb_power_ma`

USBee maps each to a gettext-wrapped display label in
`src/label-table.js`. Unknown keys render the raw key as the row label
without crashing (forward-compat per the enum extensibility
convention, §D-2.0-06).

### D-2.0-05 — NO backwards compatibility (HARD RULE)

This phase does not plan, ship, or scaffold support for any pre-
Devices2 daemon. No compatibility shim. No dual-shape unpacker. No
feature-detect path that falls back to bullet parsing.

If a user runs an old usbeehive against new USBee:
- The popover shows a dedicated "Daemon out of date — please update
  usbeehive" empty state (copy distinct from "Daemon not running").
- That's it.

Reject any planner task that re-introduces prose parsing under any
guise. The point of the cut is to delete the regex layer entirely;
shimming it back is the failure mode this phase exists to prevent.

### D-2.0-06 — Enum extensibility convention (forward-compat)

Adding variants to `device_class`, `device_subclass`, `status`,
`power_role`, `bottleneck` is non-breaking. USBee MUST treat any
unrecognized enum string as `Unknown` (or sensible per-enum default)
and fall back to category-based behaviour. This is captured as
WIRE-04 and asserted by a regression test added in Plan 04-02.

### D-2.0-07 — Minimum usbeehive version constant

USBee declares `MIN_USBEEHIVE_VERSION = "0.6.0"` in
`src/dbus-client.js` and compares against the daemon's `Version`
D-Bus property on proxy-ready.

**Confirmed 2026-05-14:** usbeehive shipped 0.6.0 with the Devices2
wire (commit `1258de4` "Release 0.6.0 — Devices2 wire (breaking)";
`../usbeehive/Cargo.toml` reads `version = "0.6.0"`). The earlier
caveat about an untagged daemon is resolved — the version pin is
final.

### D-2.0-08 — Hold v1.0/v1.1 from EGO

v1.0 and v1.1 zips were built but never uploaded to extensions.gnome.org.
First EGO submission is v2.0.0, with the clean Devices2 wire and no
known-deprecated regex layer to defend during manual review.
Plan 04-03 covers the upload.

### D-2.0-09 — Lockstep release coordination

USBee v2.0.0 ships the same week as the usbeehive release carrying
Devices2. CHANGELOG.md for v2.0.0 names `MIN_USBEEHIVE_VERSION`
explicitly. Tag `v2.0.0` triggers the existing release.yml workflow
to build + attach the zip (no change to the release workflow needed).

## Decisions To Settle During Plan 04-01

These are the four §Open-Questions tracked in STATE.md. They are
intentionally deferred *into* planning (not pre-locked), because each
is a UX choice that benefits from being decided alongside the icon /
label staging work in 04-01:

1. **`primary_driver == ""` UI treatment.** Options: row badge,
   detail-panel note, or ignore for v2.0. Whichever the planner picks,
   it must be observable in the popover (per DISP-04 acceptance) — so
   "ignore for v2.0" is a defensible choice only if explicitly
   documented as deferred to v2.1.
2. **`device_subclass` rendering policy.** Options: append to row
   title (`"Storage · SSD"`), surface only in the detail panel, or
   ignore for v2.0. The daemon emits subclass strings non-bindingly;
   the choice is purely UX-side. (CHANGELOG explicitly says
   subclass-aware icons are out of scope.)
3. **Adwaita symbolic icon picks for the four daemon `device_class`
   variants without an obvious Adwaita fit.** Currently in scope:
   `SmartcardReader`, `Bluetooth`, `Serial`, `VideoCapture`. Plan
   04-01 must audit `/usr/share/icons/Adwaita/symbolic/` and either
   pick a defensible existing icon (e.g. `bluetooth-active-symbolic`
   for `Bluetooth`, `utilities-terminal-symbolic` for `Serial`) or
   document a fallback to the generic USB icon.
4. **`Status::Sourcing` interaction with issue-first sort.** The
   captured todo specifies Sourcing does NOT trigger issue-first sort
   (DISP-03 acceptance) — confirm and lock in 04-01 with a one-line
   note in the plan.

## Code USBee Deletes (sanity check, from todo)

Wire-shape cutover must demonstrably leave these greps empty:

```text
grep -E "WATT_RE|DIRECTION_RE|USB_VERSION_RE|SPEED_RE" usbee@bitcreed.us/src/
grep -E "parseWatts|parseDirection|parseLinkSpeed" usbee@bitcreed.us/src/
grep -E "DIAG_PHRASES|keyForBullet|KEYWORD_MAP" usbee@bitcreed.us/src/
```

Preserved (do NOT delete):
- `SYMBOLIC_ICON_RE` in `src/device-icon.js` — security mitigation
  T-03-01 (validates daemon-supplied icon names against the GNOME
  symbolic-icon pattern). Daemon trust is unchanged by Devices2.
- `formatWatts` in `src/device-store.js` — pure UI formatting; the
  daemon emits raw mW and USBee renders the human display string.

## Risk Register

- **Risk:** Planner re-introduces a compatibility shim under pressure
  to make migration "safer". **Mitigation:** D-2.0-05 hard rule;
  plan-checker scans tasks for "Devices1" / "fallback" / "dual" /
  "compat" terminology and rejects.
- **Risk:** Misalignment between USBee's `IFACE_XML` template literal
  and `dbus-iface.xml` on disk after the bump. **Mitigation:** Plan
  04-02 task explicitly verifies the two are byte-identical (less
  the surrounding XML doctype) via grep/diff.
- **Risk:** `MIN_USBEEHIVE_VERSION` ships pointing at a daemon
  version that was never tagged. **Mitigation:** Plan 04-01 confirms
  the version with the upstream side before Plan 04-02 wires the
  constant; Plan 04-03 fails the release tag if the version doesn't
  exist upstream.
- **Risk:** EGO reviewer flags the unused
  `keyForBullet`/`KEYWORD_MAP`/regex constants as dead code. **
  Mitigation:** Plan 04-02 deletes them in the same atomic commit as
  the wire bump, not "incrementally" — the diff shows insertion of
  structured-field reads alongside deletion of regex parsing, a
  defensible pattern to review.
- **Risk:** Forward-compat fallback gets accidentally regressed when
  a future daemon variant ships. **Mitigation:** WIRE-04 regression
  test in Plan 04-02 stubs a `device_class: "FutureGadget"` and
  asserts the row still renders, falling back to the generic USB
  icon.

## Canonical References

- `.planning/todos/pending/2026-05-14-migrate-to-usbeehive-devices2-wire-shape.md`
  (commit `724c22a`) — phase seed
- `.planning/ROADMAP.md` §Phase 4 — plan split, success criteria,
  implementation scope
- `.planning/REQUIREMENTS.md` §v2.0 — requirement bodies
- `../usbeehive/src/dbus.rs:108-393` — authoritative wire shape
- `../usbeehive/CHANGELOG.md` `[Unreleased]` — migration table +
  property-key vocabulary + classification fidelity table
- `usbee@bitcreed.us/src/device-store.js:36-117` and `:209-223` —
  bullet-regex helpers to delete
- `usbee@bitcreed.us/src/popover.js:138-153` — `keyForBullet` to
  delete
- `usbee@bitcreed.us/src/device-icon.js:29-90` — `KEYWORD_MAP` and
  headline scan to delete; `SYMBOLIC_ICON_RE` guard to preserve
- `usbee@bitcreed.us/src/dbus-client.js:25-78` — `IFACE_XML` /
  interface-name constants to rewrite
