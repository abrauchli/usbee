---
quick_id: 260526-dmj
type: summary
status: complete
subsystem: dbus, ui
tags: [devices3, pdo, gjs, gnome-shell, dbus, popover]

requires:
  - quick: 260526-c6p
    provides: show-technical-details GSettings toggle + GATED_KEYS deny-list

provides:
  - org.usbeehive.Devices3 wire (interface name, IFACE_XML signature, MIN_USBEEHIVE_VERSION=0.7.0)
  - device.pdo_list (named-key objects) + device.active_pdo_index on unpacked DeviceEntry
  - HANDLED_BY_DEDICATED_UI deny-list filter in popover.js property-bag loop
  - Cable trust amber row driven by cable.trust.zero_vid / vid_unknown / reserved_bits
  - Transport pill strip driven by transport.usb2 (TypeCPort only) / usb3 / dp_altmode / tb
  - Structured Charger PDOs block with active-PDO ◀ marker
  - formatVolts(mv), formatAmps(ma) helpers in device-store.js (formatWatts now exported)
  - .usbee-pill-strip, .usbee-pill, .usbee-pdo-active stylesheet classes

affects: [release v2.1.0, future transport.usb4 surfacing, USB4 pill, PDO sorting]

key-files:
  modified:
    - usbee@bitcreed.us/src/dbus-client.js
    - usbee@bitcreed.us/src/device-store.js
    - usbee@bitcreed.us/src/popover.js
    - usbee@bitcreed.us/stylesheet.css
    - usbee@bitcreed.us/dbus-iface.xml
    - usbee@bitcreed.us/prefs.js
    - usbee@bitcreed.us/metadata.json
    - usbee@bitcreed.us/src/device-icon.js
    - usbee@bitcreed.us/src/label-table.js

key-decisions:
  - "Hard cut Devices2 → Devices3, no alias — mirrors usbeehive 0.7.0 wire contract"
  - "HANDLED_BY_DEDICATED_UI filter is a tight deny-list, not allow-list — unknown property keys still render through the generic loop (forward-compat)"
  - "Cable trust + Charger PDOs ALWAYS visible when fired (not gated on show-technical-details) — both are glance-priority for the user"
  - "PDO row format: 'V — A — W' (em-dash separators); PPS/range PDOs as '5–11 V'; non-Fixed kinds appended as ' (Kind)' raw passthrough"

requirements-completed: []

duration: 30m
completed: 2026-05-26
---

# Quick Task 260526-dmj: Devices3 wire migration + PDO list + trust signals

**Wires the extension to usbeehive 0.7.0's `org.usbeehive.Devices3` interface and surfaces three new daemon capabilities — cable trust, transport pills, structured Charger PDOs — in the popover detail panel.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-26 (after PLAN.md staged at 09:53)
- **Completed:** 2026-05-26
- **Tasks:** 3 (all atomic)
- **Files modified:** 9

## Accomplishments

- INTERFACE_NAME and IFACE_XML cut over to Devices3 with the 21-field per-entry signature `a(ssssssssssqqsa(ss)ius(uus)(bsssb)a(usuuuub)i)`.
- MIN_USBEEHIVE_VERSION bumped to `0.7.0`; 0.6.x daemons fall through to the existing daemon-too-old empty state with no extra wiring.
- `unpackDeviceEntry` exposes `pdo_list` (named-key objects per PDO) and `active_pdo_index` so popover.js never positionally indexes the new tuple slots.
- Three new detail-panel features live: amber "Cable trust" row, horizontal transport pill strip (USB → DisplayPort → Thunderbolt), and structured "Charger PDOs" block with active-PDO `◀` marker + bolder key label.
- Generic property-bag loop now filters `HANDLED_BY_DEDICATED_UI` (cable.trust.* / transport.*) unconditionally and suppresses legacy `charger_max` when `pdo_list` is non-empty — no key double-renders.
- `formatVolts`/`formatAmps` join `formatWatts` (now exported) for PDO row composition; all three share the WR-05 defensive guard.
- prefs.js, dbus-iface.xml, and metadata.json moved to Devices3 / 0.7.0 alongside the wire migration; stale Devices2 references purged across src/*.js.

## Task Commits

Each task was committed atomically:

1. **Task 1: Devices3 wire migration** — `ed7acd6` (feat)
2. **Task 2: Cable trust row + transport pill strip** — `c130b50` (feat)
3. **Task 3: Charger PDOs block (structured pdo_list)** — `6cad52f` (feat)

## Daemon Introspection Capture

Local `busctl --user introspect org.usbeehive.Devices /org/usbeehive/Devices` against the user's currently-installed daemon still shows `org.usbeehive.Devices2` and `Version "0.6.0"`. The user is on the pre-0.7.0 daemon, so the extension will route into the daemon-too-old empty state until they install usbeehive 0.7.0+ (sibling project at `../usbeehive/`, currently at `0.8.0`).

The plan's required live-introspection capture against a 0.7.0 daemon is therefore deferred to the user's next daemon upgrade. The wire contract itself is verified against `../usbeehive/src/dbus.rs:23` and `../usbeehive/src/dbus.rs:25-52` which both declare the Devices3 interface and the 21-field per-entry signature.

## Files Modified

- `usbee@bitcreed.us/src/dbus-client.js` — interface name, IFACE_XML signature, MIN_USBEEHIVE_VERSION
- `usbee@bitcreed.us/src/device-store.js` — unpackDeviceEntry pdo_list/active_pdo_index, formatVolts/formatAmps, formatWatts now exported
- `usbee@bitcreed.us/src/popover.js` — HANDLED_BY_DEDICATED_UI, buildTransportPillStrip, cable trust row, buildPdoListBlock, charger_max filter
- `usbee@bitcreed.us/stylesheet.css` — `.usbee-pill-strip` / `.usbee-pill` / `.usbee-pdo-active`
- `usbee@bitcreed.us/dbus-iface.xml` — Devices3 + new signature (kept byte-equal to the embedded IFACE_XML template per Plan 04-02 Task 13)
- `usbee@bitcreed.us/prefs.js` — IFACE_XML pin to Devices3 (Version property only)
- `usbee@bitcreed.us/metadata.json` — EGO description updated to reference Devices3 + 0.7.0
- `usbee@bitcreed.us/src/device-icon.js` — comment hygiene (Devices2 → Devices3)
- `usbee@bitcreed.us/src/label-table.js` — comment hygiene (removed Devices2-specific phrasing)

## Decisions Made

- **prefs.js + dbus-iface.xml + metadata.json folded into Task 1.** Plan listed only `dbus-client.js` and `device-store.js` for Task 1, but all three additional files bind to the interface name and would break if left on Devices2. Rolled them into the same atomic wire-migration commit (8 files total) so the cut is functionally complete in one commit rather than smeared across follow-ups.
- **Stale comment cleanup folded into Task 1.** The plan's verification step #2 (`grep -rn "Devices2" usbee@bitcreed.us/src/ --include='*.js'` returns no matches) required cleaning lingering Devices2 mentions in label-table.js, device-icon.js, popover.js, and device-store.js. Done as part of the same wire-migration commit.

## Deviations from Plan

None on the locked CONTEXT decisions — every UX call (CONTEXT §A–§E) landed as specified.

The only departure was scope-coverage in Task 1, where the plan's explicit `<files>` list was tighter than the change needed to fully migrate the wire (see Decisions Made). The plan's `must_haves.truths` and verification steps already anticipated the broader cut; no decision was overridden.

## Issues Encountered

- **Plan's `set_markup` grep gate is overly literal.** The Task 2 and Task 3 automated gates assert `! grep -n "set_markup" usbee@bitcreed.us/src/popover.js`, but popover.js has a long-standing docstring at line 188 saying "never .set_markup" as a security invariant comment. There are no actual `.set_markup(` call sites. Re-verified with `grep -cE '\.set_markup\(' usbee@bitcreed.us/src/popover.js` → 0.
- **Local daemon stuck at 0.6.0.** The user's running usbeehive is pre-0.7.0, so live smoke testing requires upgrading the daemon (sibling project at `../usbeehive/` is at 0.8.0).

## Forward-Compat Observations (not in scope)

- Upstream usbeehive 0.8.0 already adds `transport.usb4` (USB4 detection from Thunderbolt sysfs). Our pill strip handles only usb2/usb3/dp/tb per the locked CONTEXT §C; a `transport.usb4: true` flag would currently fall through to the generic property-bag loop as a bare row. Surfacing it as a "USB 4" pill is a natural follow-up.
- Upstream usbeehive 0.8.0 also adds active-PDO inference via cross-referencing live UCSI voltage to the PDO list. Our active-PDO logic already uses the belt-and-braces `is_active === true || index === active_pdo_index` check, so the new inference is transparent to us.

## User Setup Required

- Install or upgrade `usbeehive` to ≥ 0.7.0 (the sibling project at `../usbeehive/` is currently at 0.8.0). `systemctl --user restart usbeehive` after install.
- Hot-reload the extension (`gnome-extensions disable usbee@bitcreed.us && gnome-extensions enable usbee@bitcreed.us` on X11 or full session re-login on Wayland).
- Open the tile and confirm the device list populates (no "daemon out of date" state).

## Next Steps

- Smoke-test against a Type-C port with a known PD source (laptop charger / PD hub) to verify the Charger PDOs block renders correctly with the `◀` active marker and PPS range voltages.
- Consider following up with a tiny patch to add a `USB 4` pill when `transport.usb4` fires (out of scope here per the locked CONTEXT, but readily addable now that the pill-strip infrastructure exists).
- Bump `version` (EGO integer) and `version-name` (semver → 2.1.0) and append a `## [2.1.0]` section in CHANGELOG.md before the next EGO submission per CLAUDE.md release process.

---
*Quick task: 260526-dmj*
*Completed: 2026-05-26*
