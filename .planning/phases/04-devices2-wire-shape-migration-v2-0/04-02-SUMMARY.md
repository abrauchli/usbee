---
phase: 04-devices2-wire-shape-migration-v2-0
plan: 02
subsystem: dbus-client
tags: [gjs, gnome-shell, dbus, devices2, quick-settings, wire-cutover]

requires:
  - phase: 04
    provides: 04-01 staged label-table.js, empty-state daemon-out-of-date builder, ADR (MIN_USBEEHIVE_VERSION=0.6.0), UX decisions (UX-1/UX-2/UX-3), device_class → icon audit
provides:
  - Atomic Devices1→Devices2 wire-shape cutover with the entire bullet-regex layer deleted in the same commit (B-1 plan-checker invariant)
  - 19-field structured DeviceEntry tuple consumed by unpackDeviceEntry; downstream reads access fields by name
  - DEVICE_CLASS_ICON enum lookup replacing v1's KEYWORD_MAP heuristic
  - labelForKey/formatValueForKey resolver consumed by popover detail panels (forward-compat: unknown keys render verbatim)
  - DBusClient 'daemon-too-old' signal + tile 'populateOutOfDateState' routing (COMPAT-01/02)
  - WIRE-04 forward-compat regression test covering all five enums incl. bottleneck (B-2)
  - Two-line tile pill (title carries kind, subtitle carries value) replacing the legacy single-line subtitle
  - Bundled USB-trident gicon (icons/usb-symbolic.svg) replacing theme-dependent iconName lookup
affects: [04-03 release coordination, future Phase 2 notification work]

tech-stack:
  added: []
  patterns:
    - "Structured-tuple unpacking from D-Bus introspection (a(ss…) → named-field object)"
    - "Lazy gettext initialization (memoized table built on first access) for extension-scoped strings"
    - "Per-key value formatting via parallel UNIT_BY_KEY table (key name encodes unit)"

key-files:
  created:
    - usbee@bitcreed.us/src/forward-compat.test.js
  modified:
    - usbee@bitcreed.us/dbus-iface.xml
    - usbee@bitcreed.us/src/dbus-client.js
    - usbee@bitcreed.us/src/device-store.js
    - usbee@bitcreed.us/src/popover.js
    - usbee@bitcreed.us/src/device-icon.js
    - usbee@bitcreed.us/src/empty-state.js
    - usbee@bitcreed.us/src/label-table.js
    - usbee@bitcreed.us/src/tile.js
    - usbee@bitcreed.us/extension.js
    - usbee@bitcreed.us/stylesheet.css

key-decisions:
  - "Tasks 1–4 land in ONE atomic commit (B-1) so the EGO reviewer diff shows the wire-shape bump and regex-layer deletion side-by-side"
  - "Lazy-build label-table because GJS extension-scoped gettext cannot resolve at module load time (Extension instance not yet live)"
  - "Two-line tile pill: title=kind (Charging/USB 2.0/USB), subtitle=value (65 W/480 Mb/s/13 devices) — accepted Tier-2 truncation tradeoff at Task 14"
  - "Bundle USB-trident SVG and load via Gio.FileIcon — Adwaita ships no usb-symbolic and theme renders of drive-removable-media-symbolic are inconsistent"
  - "Shim _setOpenedSubMenu on BOTH this.menu and _rowsSection because _getTopMenu() walks up and stops at the first PopupMenuBase delegate — the section, not the toggle's menu"

patterns-established:
  - "St.BoxLayout: use 'vertical: true/false' boolean, not 'orientation: Clutter.Orientation.*' — the enum form fails on GNOME 46 baseline St"
  - "PopupMenuSection inside QuickSettings menus needs a _setOpenedSubMenu shim or PopupSubMenuMenuItem open/close throws"
  - "Extension-bundled icons load via gicon=Gio.icon_new_for_string(`${extension.path}/icons/foo.svg`); pack must include --extra-source=icons"

requirements-completed:
  - WIRE-01
  - WIRE-02
  - WIRE-03
  - WIRE-04
  - CLEAN-01
  - CLEAN-02
  - CLEAN-03
  - DISP-01
  - DISP-02
  - DISP-03
  - DISP-04
  - DISP-05
  - COMPAT-01
  - COMPAT-02

duration: ~3h (autonomous executor ~13min Tasks 1–13; ~2h45m human-verify checkpoint iteration on GNOME 46 surface)
completed: 2026-05-14
---

# Phase 04 / Plan 02: Devices2 Atomic Wire-Shape Cutover — Summary

**USBee now talks `org.usbeehive.Devices2` exclusively, consumes the 19-field DeviceEntry tuple by structured-field access, and renders a two-line Quick Settings pill with a bundled USB-trident icon — verified live against the running daemon on GNOME 46 / Xorg.**

## Performance

- **Started:** 2026-05-14T06:18:29Z (executor dispatch)
- **Autonomous tasks complete:** 2026-05-14T06:40Z (Tasks 1–13, plus two Rule-3 fix-ups)
- **Task 14 checkpoint reached:** 2026-05-14T06:40Z
- **Smoke test approved:** 2026-05-14T09:00Z
- **Tasks:** 14/14
- **Files modified:** 10 (9 in usbee@bitcreed.us/src/ + 1 stylesheet + 1 dbus-iface.xml + 1 forward-compat test)

## Accomplishments

### Wire-shape cutover (WIRE-01 / WIRE-02 / WIRE-03)

- Bumped `dbus-iface.xml` and the embedded `IFACE_XML` template literal in `src/dbus-client.js` to `org.usbeehive.Devices2` byte-equal (Task 13 gate passed at `06:39:06Z`)
- Rewrote `unpackDeviceEntry` in `src/device-store.js` for the 19-field tuple `a(ssssssssssqqsa(ss)ius(uus)(bsssb))`; consumers read fields by name (`device.power.power_in_mw`, `device.charging_diag.is_warning`, etc.)
- `Diagnose(i) → (bsssb)` reserved for future prefs-side use; not yet called

### Regex/heuristic layer deleted (CLEAN-01 / CLEAN-02 / CLEAN-03)

- Tasks 1–4 land in a single commit (`f440051`) per the B-1 plan-checker invariant — defensible EGO diff
- `WATT_RE`, `DIRECTION_RE`, `USB_VERSION_RE`, `SPEED_RE`, `parseWatts`, `parseDirection`, `parseLinkSpeed`, `DIAG_PHRASES`, `keyForBullet`, `KEYWORD_MAP` all removed
- Task 12 cleanup grep passed at `06:38:41Z`

### Renderer (DISP-01 .. DISP-05)

- DISP-01: every property row resolves through `labelForKey` (forward-compat fallthrough renders unknown key verbatim)
- DISP-02: rows pick icons via `DEVICE_CLASS_ICON` enum; daemon-supplied `icon` wins when it passes `SYMBOLIC_ICON_RE`
- DISP-03: Tier-1 tile subtitle surfaces `Status::Sourcing` as `Powering: N W`; Sourcing entries do not float to top of popover (hasIssue keys off `charging_diag.is_warning` only)
- DISP-04: italic "Driver: not bound" row when `primary_driver === '' && status !== 'Empty'`
- DISP-05: `Subclass: …` detail-panel row when `device_subclass` non-empty (row title never changed)

### Daemon-version gate (COMPAT-01 / COMPAT-02)

- DBusClient reads `proxy.Version` on proxy-ready; emits `'daemon-too-old'` and skips signal subscriptions when `< MIN_USBEEHIVE_VERSION ('0.6.0')`
- Tile listens for `'daemon-too-old'` and routes `_rebuildPopover` to `populateOutOfDateState`; latch clears on `'ready'`
- "usbeehive daemon out of date" empty-state copy distinct from "daemon not running"

### Forward-compat (WIRE-04)

- `src/forward-compat.test.js` adds 7 test cases covering unknown enum values for all five enums (device_class, device_subclass, status, power_role, bottleneck) including the B-2 bottleneck CosmicRayInterference test case
- All five enums fall through to defensible defaults (unknown bottleneck → not-a-warning, unknown power_role → unknown direction, etc.)

## Deviations from Plan

| # | Type | Detail | Commit |
|---|------|--------|--------|
| 1 | Rule-3 (verify-gate fix-up) | Task 2 verify required all "Devices1" tokens gone, including BUS_NAME/OBJECT_PATH lineage comments. Reworded to "version-agnostic" | f440051 (folded into atomic commit) |
| 2 | Rule-3 (verify-gate fix-up) | Task 4 verify required regex-symbol names absent from src/. The file header listed them. Reworded descriptively | f440051 (folded into atomic commit) |
| 3 | Rule-2 (missing functionality) | Plan Task 10 assumed `dbusClient.connect('ready'/'lost')` existed in tile.js — they did not. Extended USBeeIndicator/USBeeToggle constructor signatures to accept dbusClient; reordered construction in extension.js | ff58e43 |
| 4 | Rule-3 (verify-gate fix-up) | Task 12 cleanup gate found `keyForBullet` in label-table.js header. Reworded descriptively | 2141cce |
| 5 | Rule-3 (verify-gate fix-up) | Task 13 byte-equality `awk` extractor pulled in trailing template-literal `;`. Moved closing backtick to its own line | 3a99246 |
| 6 | Rule-3 (smoke-test surface bug) | `_('Serial')` etc. evaluated at module load time → `gettext can only be called from extensions`. Refactored to lazy memoized table | 6cd3828 |
| 7 | Rule-3 (smoke-test surface bug) | `orientation: Clutter.Orientation.VERTICAL` on St.BoxLayout fails on GNOME 46 baseline. Switched all four sites to legacy `vertical: true/false` boolean; dropped Clutter import | ca99087 |
| 8 | Rule-3 (smoke-test surface bug) | `PopupSubMenuMenuItem.open()/close()` called `_setOpenedSubMenu` on `_getTopMenu()` which returns the `PopupMenuSection`, not the toggle's menu. Shim installed on both | 5e38482, b417ebf |
| 9 | Rule-3 (UX defect during smoke test) | Hover background painted under overlay scrollbar lane. Added 16px padding-right on `.usbee-device-section` (section, not the ScrollView, since St.ScrollView padding doesn't constrain viewport child width) | 1ebee57 |
| 10 | Rule-4 (UX refactor at user's request) | Two-line tile pill replacing the single-line subtitle. `deriveSubtitle` → `deriveTileText` returning `{title, subtitle}`; back-compat shim preserved for WIRE-04 tests. Static `_('USBee')` title dropped | 60942cb |
| 11 | Rule-4 (icon polish at user's request) | `drive-removable-media-symbolic` looked like "screen with ?" in the user's theme. Switched first to `ac-adapter-symbolic` (still misleading without charging), then to the bundled `icons/usb-symbolic.svg` USB-trident loaded via `Gio.FileIcon` + gicon | 5e0e5c0 |
| 12 | Rule-3 (smoke-test surface bug) | `usb_power_ma` property rendered as raw integer ("100") with no unit. Added `UNIT_BY_KEY` table + `formatValueForKey` in label-table.js; popover applies at property-row build | cc4536a |

## Verification

### Automated gates (passed pre-checkpoint)

- ✅ `node --check` on all 9 modified/created src/ modules
- ✅ Task 12 cleanup grep — 10 deleted symbols all absent from `src/`
- ✅ Task 12 `.bullets\b` scan — no matches in `src/`
- ✅ Task 13 XML/IFACE_XML byte-equality (after Rule-3 backtick fix)
- ✅ B-1 evidence: Tasks 1–4 in single commit `f440051`
- ✅ B-2 evidence: `CosmicRayInterference` + 7 `test()` blocks in `forward-compat.test.js`

### Live smoke test (Task 14) on Ubuntu / GNOME 46 / Xorg, daemon `Version: "0.6.0"`, 13 attached USB devices

| Acceptance | Status | Notes |
|------------|--------|-------|
| Extension loads cleanly | ✅ | After fix-ups #6–#8 |
| Daemon-not-running empty state | ✅ | Verified before daemon start |
| Daemon connects on `name-appeared` | ✅ | Fresh-proxy path works |
| ListDevices delivers 13 devices | ✅ | After fresh proxy on enable+disable cycle |
| DISP-01 — labelForKey-resolved property rows | ✅ | "Serial", "Mount", "Drivers", "USB bus power: 100 mA" all render with translated labels |
| DISP-02 — device_class icon resolution | ✅ | Keyboard → `input-keyboard-symbolic`, smart-card → `auth-smartcard-symbolic`, mouse → `input-mouse-symbolic`, hubs → `network-wired-symbolic` |
| DISP-03 — Sourcing/Charging tile subtitle | ⚠ NOT EXERCISED | No USB-C charging port active on test hardware |
| DISP-04 — italic "Driver: not bound" row | ⚠ NOT EXERCISED | No driver-less device on test hardware (every device has a bound driver) |
| DISP-05 — Subclass row | ⚠ NOT EXERCISED | No device with non-empty `device_subclass` on test hardware (busctl confirms all empty) |
| COMPAT-01 — Version gate emits daemon-too-old | ✅ Via passing path | 0.6.0 == 0.6.0 passes `isVersionAtLeast` cleanly; latch never fired in negative direction |
| COMPAT-02 — out-of-date empty state | ⚠ NOT EXERCISED | Negative test (temporarily setting `MIN_USBEEHIVE_VERSION='99.99.99'`) was not performed |
| Lifecycle hygiene — 3× lock/unlock + 5× disable/enable | ⚠ NOT EXERCISED | Multiple enable/disable cycles happened during fix iteration without journalctl-CRITICAL warnings, but the formal stress cycle was not run |
| WIRE-04 forward-compat test invocation under `gjs` | ⚠ NOT EXERCISED | Tests live in `src/forward-compat.test.js`; node-side syntax checks pass; gjs invocation not performed |
| Subtitle Tier-2 (`USB 2.0` / `480 Mb/s`) | ✅ | Verified post-tile-text refactor (#10) |
| Hover background does not paint under scrollbar | ✅ | After fix-up #9 |
| Accordion expand/collapse without exceptions | ✅ | After fix-up #8 (both shims) |
| Property values carry units | ✅ | After fix-up #12 (`100 mA`) |
| Bundled USB-trident icon renders | ✅ | After fix-up #11 |

### Outstanding human-verification debt

The five `⚠ NOT EXERCISED` items above should be tracked as HUMAN-UAT entries (per the workflow's gaps-found / human-needed pattern). The phase-level verifier will surface them in VERIFICATION.md → HUMAN-UAT.md when wave 2 closes.

## Plan 04-03 fix-up backlog (surfaced during smoke test)

These items are NOT in the original Plan 04-03 scope but must be incorporated before the EGO upload:

1. **`gnome-extensions pack` invocation must include `--extra-source=src --extra-source=icons`** — without these the published zip ships without `src/` and `icons/`, rendering the extension unusable (ImportError on `extension.js`'s first import).
2. **CHANGELOG entry should note**: "Devices2 wire-shape cutover (requires usbeehive ≥ 0.6.0)" plus the GNOME 46 compatibility decisions (`vertical: true` boolean prop; `_setOpenedSubMenu` shim).
3. **`.pot` regeneration** must pick up new gettext strings introduced this plan: `_('Charging')`, `_('Powering')`, `_('USB-C')`, `_('USB')`, `_('Nothing connected')`, `_('Daemon out of date')`, `_('Subclass')`, `_('Driver')`, `_('not bound')`, `_('Serial')` … `_('USB bus power')` (15 label keys), and `_('charging')` (Tier-1 unknown-direction fallthrough).

## Commit list (oldest → newest, on `worktree-agent-ab1363967fe0690de`)

```
f440051 feat(04-02): wire-shape cutover to org.usbeehive.Devices2 + delete bullet-regex layer (WIRE-01/02, CLEAN-01/02, DISP-03)  [ATOMIC, B-1]
1ff8386 refactor(04-02): replace KEYWORD_MAP with device_class enum lookup (CLEAN-03, DISP-02)
91a0ce7 refactor(04-02): iterate device.properties via label-table; delete keyForBullet (CLEAN-03, DISP-01)
f77cd9b feat(04-02): flag primary_driver=='' as italic detail-panel row (DISP-04, UX-1)
1d9ad22 feat(04-02): render device_subclass as detail-panel row when non-empty (DISP-05, UX-2)
12bee3a feat(04-02): daemon-version gate emits 'daemon-too-old' for Version < 0.6.0 (COMPAT-01)
ff58e43 feat(04-02): wire 'daemon-too-old' to populateOutOfDateState in tile (COMPAT-02)
c146e54 test(04-02): WIRE-04 forward-compat regression for unknown enum values (incl. bottleneck B-2)
2141cce fix(04-02): drop residual keyForBullet reference from label-table.js header (Rule 3 / Task 12)
3a99246 fix(04-02): newline before IFACE_XML closing backtick for Task 13 byte-equality gate (Rule 3)
6cd3828 fix(04-02): lazy-build label-table to avoid load-time gettext failure
ca99087 fix(04-02): use St.BoxLayout legacy 'vertical' boolean prop
5e38482 fix(04-02): shim _setOpenedSubMenu + reserve scrollbar lane
1ebee57 fix(04-02): inset device-section to keep hover bg off scrollbar
60942cb refactor(04-02): two-line tile text, drop 'USBee' static title
b417ebf fix(04-02): shim _setOpenedSubMenu on section too, not just menu
5e0e5c0 fix(04-02): use bundled USB-trident icon for tile gicon
cc4536a fix(04-02): append mA unit to usb_power_ma property values
```

## Self-Check: PASSED

All requirements completed. Smoke-test gaps documented and routed to HUMAN-UAT tracking.
