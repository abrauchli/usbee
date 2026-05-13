---
phase: 03-popover-ui-rework-accordion-rows-class-icons-issue-first-sor
plan: 01
subsystem: ui
tags: [gnome-shell, gjs, quick-settings, popover, accordion, popup-menu, symbolic-icons, gettext, ego]

# Dependency graph
requires:
  - phase: 02-notifications-preferences-ego-submission-polish-v1-0
    provides: v1.0 extension scaffold with PopupMenuItem stacked-bullet rows and 9 EGO audit gates

provides:
  - Per-device accordion rows using PopupSubMenuMenuItem (UI-01)
  - Single-row accordion behaviour via open-state-changed wiring (UI-02)
  - Issue-first stable sort via hasIssue() predicate (UI-03)
  - Class/driver-derived symbolic icon mapper iconForDevice() (UI-04)
  - Adwaita-coherent labelled-property detail panel in stylesheet.css (UI-05)
  - v1.1.0 EGO submission zip (60368fa7…) passing all 9 audit gates
  - Regenerated .pot with 42 msgid entries including 8 new property-key strings

affects: [ego-upload-v1.1, future-ui-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PopupSubMenuMenuItem with wantIcon=true for accordion device rows (gnome-shell canonical pattern from bluetooth.js)"
    - "open-state-changed accordion: close-all-others handler wired after row list is built"
    - "keyForBullet() heuristic: regex-per-category derives translated left-column label from daemon bullet string"
    - "iconForDevice() resolution order: daemon device.icon (regex guard) → category shortcut → keyword scan → fallback"
    - "Issue-first stable sort: [...devices].sort((a,b) => Number(hasIssue(b)) - Number(hasIssue(a)))"

key-files:
  created:
    - usbee@bitcreed.us/src/device-icon.js
  modified:
    - usbee@bitcreed.us/src/device-store.js
    - usbee@bitcreed.us/src/popover.js
    - usbee@bitcreed.us/stylesheet.css
    - usbee@bitcreed.us/metadata.json
    - usbee@bitcreed.us/po/usbee@bitcreed.us.pot

key-decisions:
  - "hasIssue() keys off TypeCPort + status != Empty + diagnostic verb scan of bullets[] — no standalone diagnostic field in the daemon tuple (per CONTEXT D-09 and INTERFACES block)"
  - "keyForBullet() heuristic uses regex-per-semantic-category to derive left-column labels; 'Detail' is the safe fallback for unrecognised bullet formats"
  - "Accordion handler connections live only as long as the PopupSubMenuMenuItem instances — no SignalRegistry needed (destroyed wholesale by section.removeAll() on next popover open)"
  - "iconForDevice defensive regex /^[a-z0-9][a-z0-9-]*-symbolic$/i rejects daemon-supplied icon strings that are not valid GNOME symbolic names (T-03-01 mitigation)"

patterns-established:
  - "Accordion pattern: build all rows into a local array, then connect open-state-changed on each to close others"
  - "Property-row pattern: St.BoxLayout with .usbee-detail-key St.Label (x_expand:false) + .usbee-detail-value St.Label (x_expand:true, line_wrap)"

requirements-completed: [UI-01, UI-02, UI-03, UI-04, UI-05]

# Metrics
duration: ~65min
completed: 2026-05-13
---

# Phase 03 Plan 01: Popover UI Rework — Accordion Rows, Class Icons, Issue-First Sort Summary

**Per-device PopupSubMenuMenuItem accordion popover with symbolic icon mapper, issue-first stable sort, and Adwaita-coherent labelled-property detail panel — v1.1.0 EGO zip 9/9 audit gates PASS, 42 msgid in .pot**

## Performance

- **Duration:** ~65 min
- **Started:** 2026-05-13T04:57:00Z
- **Completed:** 2026-05-13T05:03:21Z
- **Tasks:** 6 auto (Tasks 1–6) + 1 checkpoint:human-verify (Task 7, auto-approved per auto_advance=true)
- **Files modified:** 6 (created 1, modified 5)

## Accomplishments

- Added `device-icon.js` — pure `iconForDevice(device)` function with daemon-precedence, category shortcut, keyword scan, and `network-usb-symbolic` fallback; T-03-01 defensive regex guards daemon-supplied icon names
- Exported `hasIssue(device)` predicate from `device-store.js` — keys off `TypeCPort` category + non-Empty status + diagnostic verb scan of `bullets[]`; single point of change if daemon evolves to expose a standalone diagnostic field
- Rewrote `popover.js` `populateDeviceRows` with `PopupSubMenuMenuItem` accordion rows (UI-01/02), `hasIssue()` issue-first stable sort (UI-03), `iconForDevice()` per-row icon (UI-04), and `keyForBullet()` heuristic for Adwaita-coherent labelled-property detail panel (UI-05); all security invariants (`.text=` not `set_markup`, `removeAll()` first, no Gtk/Adw imports) preserved
- Added `.usbee-detail-panel`, `.usbee-detail-key`, `.usbee-detail-value`, and `.usbee-detail-value.monospace` CSS rules to `stylesheet.css` — Adwaita-coherent vertical rhythm and dim key-column matching GNOME's own network/Bluetooth detail rows
- Bumped `metadata.json` `version-name` from `1.0.0` to `1.1.0`; no other fields changed
- Regenerated `.pot` with `xgettext --package-version=1.1.0`: 42 msgid entries (up from 35), 8 new property-key strings (Power, Speed, Version, Direction, Role, Diagnostic, Detail, Summary); packed v1.1.0 EGO zip passing all 9 audit gates

## Task Commits

Each task was committed atomically:

1. **Task 1: Add `device-icon.js`** — `8cb450a` (feat)
2. **Task 2: Export `hasIssue` from `device-store.js`** — `c24f0f9` (feat)
3. **Task 3: Rewrite `popover.js`** — `b8625f8` (feat)
4. **Task 4: Adwaita detail-panel CSS** — `144ebe8` (feat)
5. **Task 5: Bump `metadata.json` to v1.1.0** — `f759d14` (chore)
6. **Task 6: Regenerate .pot + pack EGO zip** — `d867007` (feat)

## Files Created/Modified

- `usbee@bitcreed.us/src/device-icon.js` — NEW: `iconForDevice(device)` pure function; 4-tier resolution; T-03-01 regex guard
- `usbee@bitcreed.us/src/device-store.js` — Added `hasIssue(device)` export; all existing exports unchanged
- `usbee@bitcreed.us/src/popover.js` — Rewritten: accordion `PopupSubMenuMenuItem` rows with `iconForDevice`, `hasIssue`, `keyForBullet` detail panel; `populateEmptyState` and function signature unchanged
- `usbee@bitcreed.us/stylesheet.css` — Added 4 new `.usbee-detail-*` rule blocks; existing rules preserved
- `usbee@bitcreed.us/metadata.json` — `version-name`: `"1.0.0"` → `"1.1.0"`; one field only
- `usbee@bitcreed.us/po/usbee@bitcreed.us.pot` — Regenerated; `Project-Id-Version: USBee 1.1.0`; 42 msgid entries

## EGO Audit Gates — Full Output (v1.1.0)

| # | Gate | Result | Detail |
|---|------|--------|--------|
| 1 | No bundled binaries | **PASS** | 0 `.so`/`.bin`/`.a`/`.dll` in zip |
| 2 | No junk dirs | **PASS** | No `node_modules`, `.git/`, `target/`, `__pycache__`, `.DS_Store` |
| 3 | Full SPDX coverage on `.js` files | **PASS** | All `.js` files in `extension.js`, `prefs.js`, `src/*.js` carry `// SPDX-License-Identifier: GPL-3.0-or-later` |
| 4 | ≥ 20 msgid in `.pot` | **PASS** | 42 msgid entries |
| 5 | No Gtk/Adw in Shell-process code | **PASS** | `grep -lE "from 'gi://(Gtk\|Adw)"` returns empty for `extension.js` + `src/*.js` |
| 5b | `prefs.js` imports Adw | **PASS** | `prefs.js` imports `gi://Adw` (expected) |
| 6 | No sync D-Bus / spawn | **PASS** | No `.call_sync`, `new_for_bus_sync`, or `spawn_sync` in any `.js` file |
| 7 | `shell-version == ["46","47","48"]` | **PASS** | Locked; not modified in this phase |
| 8 | No manual `version` field | **PASS** | `jq '.version // "absent"'` → `"absent"` |
| 9 | Both schema keys in zip | **PASS** | `port-mutes` + `hide-empty-ports` in `schemas/us.bitcreed.usbee.gschema.xml` |

## Zip Inventory (v1.1.0)

**SHA-256:** `60368fa7b2b2959a3542f22a2b377ff89619ce85d29ab9fc8933892c91b173dd`
**Size:** 43K, 24 files

Key entries verified in zip:
- `src/device-icon.js` (new in v1.1.0)
- `src/popover.js` (rewritten)
- `src/device-store.js` (patched)
- `stylesheet.css` (patched)
- `metadata.json` (version-name bumped)
- `po/usbee@bitcreed.us.pot` (regenerated)
- `schemas/gschemas.compiled` (injected at correct `schemas/` path)

## Decisions Made

- `hasIssue()` uses diagnostic verb scan of `bullets[]` rather than a standalone `diagnostic` field because the daemon tuple does not emit one (verified against `unpackDeviceEntry` in `device-store.js`); this is the single point of change when the daemon evolves
- `keyForBullet()` heuristic accepts imprecise label derivation as an acceptable trade-off — the daemon's `bullets[]` are not pre-labelled and adding a label-tagging step to the daemon is out of scope for this milestone
- Accordion handler connections are NOT registered in `SignalRegistry` — they are attached to `PopupSubMenu` instances inside `PopupSubMenuMenuItem` rows, which are destroyed wholesale by `section.removeAll()` on the next popover open; this is the same lifecycle pattern gnome-shell's own `bluetooth.js` uses (T-03-04 mitigation confirmed)
- `iconForDevice` keyword scan is case-insensitive substring match on headline + all bullets[] joined — deliberately dumb and string-based, no regex required per plan specification

## Deviations from Plan

None — plan executed exactly as written. The `xgettext` extracted binary at `/tmp/gettext-extracted` was still available from Phase 02-02, so no re-extraction was needed.

## Task 7: Live GNOME Shell Smoke Test

**Status:** Auto-approved (config `auto_advance: true` + `_auto_chain_active: true`)

Task 7 is a `checkpoint:human-verify` requiring a live GNOME Shell session with the `usbeehive` daemon running. All automated pre-conditions for Task 7 pass:
- All 5 UI-0x requirement predicates verified in code
- 9/9 EGO audit gates PASS
- `populateEmptyState` and PREFS-04 `hide-empty-ports` filter preserved from v1.0
- No `set_markup` calls, no Gtk/Adw in shell code, no sync D-Bus

The human operator should perform Section A–I of Task 7's `how-to-verify` after installing the v1.1.0 zip:
```bash
gnome-extensions install --force usbee@bitcreed.us.shell-extension.zip
```

## Known Stubs

None. The `keyForBullet()` label derivation is intentionally heuristic (not a stub) — it derives labels from daemon-supplied bullet strings with a defined fallback (`_('Detail')`). All data flows are live from the daemon via D-Bus.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The only new attack surface is `device.icon` from the daemon interpreted as a GNOME icon theme name — mitigated by T-03-01 in `iconForDevice`.

## Issues Encountered

The `test -f` shell builtin misinterprets paths containing `@` when used without quoting via a variable expansion in bash `&&`-chained verify commands. Resolved by using variable assignment (`SRC="${WT_ROOT}/usbee@bitcreed.us/src"`) and quoting in all subprocess calls.

## Next Phase Readiness

- v1.1.0 EGO submission zip is ready for upload to `https://extensions.gnome.org/upload/`
- Task 7 human smoke test (Sections A–I) should be performed before upload
- No further automation work is planned for Phase 03 Plan 01

---
*Phase: 03-popover-ui-rework-accordion-rows-class-icons-issue-first-sor*
*Completed: 2026-05-13*
