---
quick_id: 260915-ib9
slug: remove-the-dead-snapshotjson-method-from
date: 2026-09-15
status: complete
---

# Quick Task 260915-ib9 — Summary

## What landed

`SnapshotJson` no longer appears in USBee's D-Bus interface declaration —
neither in the inlined `IFACE_XML` literal nor in the reference copy.

### Files changed

| File | Change |
|------|--------|
| `usbee@bitcreed.us/src/dbus-client.js` | `SnapshotJson` method removed from `IFACE_XML`; comment above it explains why `Refresh`/`Diagnose` stay |
| `usbee@bitcreed.us/dbus-iface.xml` | Same method removed, keeping the byte-equality invariant |
| `tests/forward-compat.test.js` | 5 new guards: absence on both sides, no surviving call site, `Refresh` and `Diagnose` still declared |
| `CHANGELOG.md` | `### Removed` entry under `[Unreleased]` |

## The no-caller check (done before removing)

`rtk proxy grep -rn "SnapshotJson" usbee@bitcreed.us/ tests/` returned four
hits; a call-shaped grep, `SnapshotJson(Async|Sync|Remote)?\s*\(`, returned
**none**.

| Hit | Kind | Action |
|-----|------|--------|
| `src/dbus-client.js:62` | the declaration | removed |
| `dbus-iface.xml:15` | reference copy | removed |
| `src/property-policy.js:15` | prose about the **daemon's** method | left alone |
| `src/property-policy.js:38` | prose about the **daemon's** method | left alone |

The two prose mentions were deliberately not touched: they tell a reader that
wire-only keys stay reachable *through the daemon*, and usbeehive still
exports `SnapshotJson` regardless of what USBee declares. To keep that from
reading as staleness later, the comment above `IFACE_XML` now states the
relationship explicitly.

## Invariant preserved, and proved twice

`dbus-iface.xml` is kept byte-equal to the `IFACE_XML` literal less the
doctype. Verified two independent ways:

1. The suite's own assertion — `IFACE_XML literal is byte-equal to
   dbus-iface.xml` — passes.
2. An independent normalisation outside the suite: both sides come to exactly
   **1464 bytes** and `diff` reports no difference.

## Decisions (inferred — human unavailable)

- **`Refresh` and `Diagnose` kept.** Both are equally uncalled, but the
  comment above `IFACE_XML` declares them reserved for planned call sites,
  whereas nothing claimed `SnapshotJson`. Two new tests pin them so this
  removal is not read as licence to strip them too.
- **usbeehive untouched**, per the explicit scope limit. The daemon may keep
  serving the method.

## Verification

- All four CI suites pass (`dbus-client`, `daemon-status`, `forward-compat`,
  `service-probe`), exit 0 each. All five new guards observed passing by name.
- No Shell restart needed for anything here: this changes only the XML string
  a proxy is built from, with no UI surface.
