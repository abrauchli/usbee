---
phase: 04-devices2-wire-shape-migration-v2-0
plan: 01
subsystem: prep-and-ux
tags: [devices2-prep, ux-lock, icon-audit, label-table, empty-state, adr]
dependency-graph:
  requires: []
  provides:
    - "labelForKey() machine-key → display-label resolver for Plan 04-02 popover wiring"
    - "buildDaemonOutOfDateItem() empty-state builder for Plan 04-02 'daemon-too-old' signal handler"
    - "Locked UX-1..UX-4 decisions for Plan 04-02 implementation tasks"
    - "Adwaita symbolic icon table + fallback chain for Plan 04-02 device-icon.js rewrite"
    - "MIN_USBEEHIVE_VERSION placement + 'daemon-too-old' signal contract for Plan 04-02 gate wiring"
  affects:
    - Plan 04-02 (consumes all of the above mechanically)
    - Plan 04-03 (xgettext picks up new strings from label-table.js + empty-state.js)
tech-stack:
  added: []
  patterns:
    - "Machine-key resolver Map with `?? key` fallthrough (forward-compat for unknown daemon variants)"
    - "Sibling empty-state builder mirroring buildEmptyStateItem() shape with distinct title + hint + entry"
    - "ADR-driven decision artefacts under .planning/phases/04-…/ so Plan 04-02 has zero open questions"
key-files:
  created:
    - "usbee@bitcreed.us/src/label-table.js"
    - ".planning/phases/04-devices2-wire-shape-migration-v2-0/04-01-ADR-daemon-version-gate.md"
    - ".planning/phases/04-devices2-wire-shape-migration-v2-0/04-01-UX-DECISIONS.md"
    - ".planning/phases/04-devices2-wire-shape-migration-v2-0/04-01-ICON-AUDIT.md"
  modified:
    - "usbee@bitcreed.us/src/empty-state.js"
decisions:
  - "MIN_USBEEHIVE_VERSION = '0.6.0' lives in src/dbus-client.js immediately after INTERFACE_NAME"
  - "DBusClient gains a fourth signal 'daemon-too-old' (distinct from 'lost')"
  - "Version comparison is lexical-tuple semver, fail-closed on any non-major.minor.patch input"
  - "UX-1: primary_driver=='' renders as an italic detail-panel row 'Driver: not bound' (never a row-level badge)"
  - "UX-2: device_subclass renders as a 'Subclass' property row only when non-empty; never appended to row title"
  - "UX-3: Status::Sourcing does NOT trigger issue-first sort; hasIssue() collapses to charging_diag.is_warning only"
  - "UX-4: tile subtitle reuses existing _('Powering: %s out') string; Tier-1 filter widens to include status==='Sourcing'"
  - "device_class → icon lookup table covers all 19 daemon variants; SecurityKey uses auth-fingerprint-symbolic (closest semantic match)"
  - "Fallback chain: daemon device.icon → TypeCPort shortcut → device_class enum → default drive-removable-media-symbolic"
metrics:
  duration: ~22 min
  completed: 2026-05-14
---

# Phase 04 Plan 01: Devices2 Prep & UX Lock-in Summary

Land all decision-and-staging work for the Devices2 wire-shape migration
WITHOUT touching the wire shape itself, so Plan 04-02's cutover commit
stays atomic.

## Outcome

Plan 04-01 ships two new code modules (one wholly new — `src/label-table.js`;
one extended sibling builder — `src/empty-state.js::buildDaemonOutOfDateItem()`)
plus three planning artefacts (ADR for the daemon-version gate, locked UX
decisions for the four §Open-Questions, and an Adwaita icon audit covering
all 19 `device_class` variants). The runtime wire shape is unchanged —
`dbus-iface.xml` and `IFACE_XML` remain `Devices1` — so USBee against the
current daemon is functionally identical after this plan. Plan 04-02
consumes every artefact mechanically: the ADR pins constant placement and
signal name, the UX decisions remove the four open questions, the icon
audit becomes the new `device-icon.js` lookup table, `label-table.js` is
imported by `popover.js::buildDeviceRow`, and `buildDaemonOutOfDateItem()`
is called from a new `populateOutOfDateState` triggered by the
`'daemon-too-old'` signal.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Daemon-version-gate ADR | `e572471` | `.planning/phases/04-…/04-01-ADR-daemon-version-gate.md` |
| 2 | UX decisions UX-1..UX-4 | `4f44eeb` | `.planning/phases/04-…/04-01-UX-DECISIONS.md` |
| 3 | Adwaita icon audit (19 variants) | `f0902cf` + `9f30181` | `.planning/phases/04-…/04-01-ICON-AUDIT.md` |
| 4 | `src/label-table.js` machine-key resolver | `1415eef` | `usbee@bitcreed.us/src/label-table.js` |
| 5 | `buildDaemonOutOfDateItem()` builder | `60f8caa` | `usbee@bitcreed.us/src/empty-state.js` |

Task 3 has two commits because the initial commit `f0902cf` formatted icon
names with Markdown inline-code backticks, which broke the plan's verify
regex (`^\| [A-Z][a-zA-Z]+ \| [a-z][a-z0-9-]+-symbolic`). The follow-up
`9f30181` strips the backticks from the table column (every name still
matches `SYMBOLIC_ICON_RE` in plain text). Same content, regex-clean
formatting — no semantic change.

## Decisions Made

### UX-1 — `primary_driver == ""` (DISP-04)
**Locked:** Detail-panel italic row `_('Driver: not bound')` when
`device.primary_driver === ''` AND `device.status !== 'Empty'`. Keeps the
collapsed row visually unchanged (no badge clutter); reuses
`buildPropertyRow()` (no new widget); empty Type-C ports are suppressed.

### UX-2 — `device_subclass` rendering (DISP-05)
**Locked:** Detail-panel property row only, gated on non-empty.
`device_subclass` is daemon-curated and non-binding (D-2.0-02); promoting
to a title-suffix would clutter the at-a-glance headline. Reversible in v2.1
if demand data justifies it.

### UX-3 — `Status::Sourcing` sort interaction (DISP-03)
**Locked:** Sourcing does NOT trigger issue-first sort. `hasIssue()`
collapses to `Boolean(device.charging_diag?.is_warning)`. Sourcing is
healthy by definition (host charging a downstream device); hoisting it
would push genuinely-degraded ports below it.

### UX-4 — Tile subtitle copy for Sourcing (DISP-03)
**Locked:** Reuse the existing `_('Powering: %s out')` at
`device-store.js:149`. No `.pot` churn from this decision. The Tier-1
subtitle filter widens to include `status === 'Sourcing'`.

### Daemon-version gate (COMPAT-01/02)
**Locked:** `MIN_USBEEHIVE_VERSION = "0.6.0"` in `src/dbus-client.js`
immediately after `INTERFACE_NAME`; check fires inside `_onAppeared` after
`new UsbeehiveProxy()` resolves and BEFORE `setDaemonRunning(true)`; a new
`'daemon-too-old'` signal routes the tile to `populateOutOfDateState`;
comparison is lexical-tuple semver, fail-closed on parse errors. Full
seven-bullet wiring checklist in the ADR.

### Adwaita icon table (DISP-01, WIRE-04 forward-compat)
**Locked:** 19 `device_class` variants mapped to verified Adwaita symbolic
icons; `SmartcardReader` → `auth-smartcard-symbolic`, `SecurityKey` →
`auth-fingerprint-symbolic` (no `security-key-symbolic` in Adwaita),
`Serial` → `utilities-terminal-symbolic` (legacy/), `VideoCapture` →
`camera-video-symbolic` (distinct from Camera's webcam icon). Fallback
chain documented for the default route.

## Files Created

- **`usbee@bitcreed.us/src/label-table.js`** — exports `labelForKey(key)`;
  `LABEL_TABLE` Map covers all 15 machine keys from CONTEXT D-2.0-04;
  unknown keys fall through to the raw key string per WIRE-04. 15 gettext
  markers — entire vocabulary is translatable.
- **`.planning/phases/04-…/04-01-ADR-daemon-version-gate.md`** — five
  numbered decisions plus a seven-bullet wiring checklist that Plan 04-02's
  daemon-version-gate task consumes verbatim.
- **`.planning/phases/04-…/04-01-UX-DECISIONS.md`** — four `## UX-N`
  sections (UX-1..UX-4) each with one locked one-line decision plus 3–4
  rationale bullets and a cross-reference to the implementing Plan 04-02
  task.
- **`.planning/phases/04-…/04-01-ICON-AUDIT.md`** — 19-row
  device_class → icon table, copy-pasteable verification one-liner, and a
  four-step fallback chain documenting the order `iconForDevice` will
  resolve in.

## Files Modified

- **`usbee@bitcreed.us/src/empty-state.js`** — adds a sibling
  `buildDaemonOutOfDateItem()` exported alongside the unchanged
  `buildEmptyStateItem()`. Same widget shape (PopupMenuItem + Label +
  read-only-but-selectable Entry), distinct copy: title `'usbeehive
  daemon out of date'`, hint `'Update usbeehive, then restart it. This
  list will populate automatically:'`, entry `'systemctl --user restart
  usbeehive'`. All three strings are gettext-wrapped.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Task 3 verify regex required no backticks on icon-name column**

- **Found during:** Task 3 verification run (`grep -c -E "^\| [A-Z]…"` returned 0)
- **Issue:** Initial ICON-AUDIT.md table cells formatted icon names with Markdown inline-code backticks (`\`input-keyboard-symbolic\``). The plan's automated verify regex required the icon name to appear immediately after the second pipe with no backtick prefix.
- **Fix:** Stripped backticks from the icon-name column of all 19 table rows. Plain text is unambiguous (every name still matches `SYMBOLIC_ICON_RE` in the body text), and the table renders cleanly in Markdown viewers either way.
- **Files modified:** `.planning/phases/04-devices2-wire-shape-migration-v2-0/04-01-ICON-AUDIT.md`
- **Commit:** `9f30181`
- **Rule applied:** Rule 3 (auto-fix blocking issue — verify gate failure prevented marking the task done; surface fix is purely formatting, no semantic change).

## Plan-Level Verification

Run by hand at end-of-plan per the `<verification>` block:

| Check | Expected | Actual |
|---|---|---|
| `node --check src/label-table.js` | exit 0 | exit 0 ✅ |
| `node --check src/empty-state.js` | exit 0 | exit 0 ✅ |
| `grep -c '_(' src/label-table.js` | ≥ 15 | 15 ✅ |
| 3 planning docs exist under `.planning/phases/04-…/` | yes | yes ✅ |
| `git log --oneline -5` shows 5 distinct task commits | yes | yes (plus 1 Rule-3 fix commit on Task 3) ✅ |

## Success Criteria

1. ✅ `src/label-table.js` exists, exports `labelForKey`, covers every machine key in CONTEXT D-2.0-04, renders unknown keys as the raw key.
2. ✅ `src/empty-state.js` gains `buildDaemonOutOfDateItem()` with the locked COMPAT-02 copy; the existing `buildEmptyStateItem` is byte-for-byte unchanged inside its function body.
3. ✅ ADR doc fixes `MIN_USBEEHIVE_VERSION` placement, the `'daemon-too-old'` signal name, the version-comparison rule, and a 7-bullet wiring checklist for Plan 04-02.
4. ✅ UX-DECISIONS doc records four one-line locked decisions (UX-1..UX-4) with rationale and Plan 04-02 cross-references.
5. ✅ ICON-AUDIT doc lists all 19 `device_class` variants, every icon name matches `SYMBOLIC_ICON_RE`, fallback chain is documented.
6. ✅ Nothing in this plan changes the wire shape; `dbus-iface.xml` and `IFACE_XML` remain `Devices1`. Running USBee against the current daemon is functionally unchanged after this plan.

## Known Stubs

None. `labelForKey` and `buildDaemonOutOfDateItem` are intentionally unwired
in this plan — Plan 04-02 imports them during the wire cutover. This is
not a stub (an unused implementation that flows empty data to the UI); it
is staged code that has no caller until 04-02 lands. Documented in PLAN's
`<action>` blocks for both Task 4 and Task 5.

## Self-Check: PASSED

- `usbee@bitcreed.us/src/label-table.js` — FOUND
- `usbee@bitcreed.us/src/empty-state.js` — FOUND (modified, `buildDaemonOutOfDateItem` exported)
- `.planning/phases/04-devices2-wire-shape-migration-v2-0/04-01-ADR-daemon-version-gate.md` — FOUND
- `.planning/phases/04-devices2-wire-shape-migration-v2-0/04-01-UX-DECISIONS.md` — FOUND
- `.planning/phases/04-devices2-wire-shape-migration-v2-0/04-01-ICON-AUDIT.md` — FOUND
- Commits `e572471`, `4f44eeb`, `f0902cf`, `9f30181`, `1415eef`, `60f8caa` — all FOUND in `git log`
