---
phase: 03-popover-ui-rework-accordion-rows-class-icons-issue-first-sor
verified: 2026-05-12T23:30:00Z
remediated: 2026-05-12T22:35:00Z
verdict: PASS
success_criteria:
  passed: 6
  partial: 0
  failed: 0
  total: 6
requirements:
  total: 5
  covered: 5
  uncovered: 0
status: complete
score: 6/6 must-haves verified
overrides_applied: 0
remediation_notes:
  - "SC-6 BLOCKER closed in commit ee30c99: re-ran egp-repack-recipe at repo root. New zip SHA-256 2c930dd5c453578267d55c1f717abaf5cb5f12396f18c0e4350b351896beb582 (45381 bytes) carries version-name 1.1.0, src/device-icon.js, the new accordion popover.js, and CR-01-fixed device-store.js. .pot regenerated with canonical relative paths (43 msgid). All 9 EGO audit gates re-validated PASS inline against the new zip."
human_verification:
  - test: "Live GNOME Shell smoke test of v1.1 popover (Task 7 sections A-I)"
    expected: "Per-device PopupSubMenuMenuItem accordion rows with class-derived icons, single-row accordion behaviour, issue-first sort, Adwaita-coherent labelled detail panel"
    why_human: "Requires live gnome-shell session with usbeehive daemon; checkpoint:human-verify gate explicitly requires operator interaction (Task 7 in plan)"
  - test: "Section H: enable/disable hygiene loop"
    expected: "Zero 'already disposed', 'handler not found', or 'JS ERROR' lines in journalctl after 10 enable/disable cycles"
    why_human: "Requires live gnome-shell with journalctl access"
---

# Phase 03: Popover UI Rework — Verification Report

**Phase Goal:** Users opening the USBee popover see a per-device accordion list visually matching the GNOME Wi-Fi/Bluetooth pattern (class icon, headline, chevron) with issue-flagged devices floating to the top. Clicking a row expands an Adwaita-coherent detail panel; opening a different row collapses the previous one. Shipped artifact is a re-packed `usbee@bitcreed.us.shell-extension.zip` carrying `version-name: 1.1.0` ready for EGO upload.

**Verdict:** PARTIAL — source code is correct, but the shipped EGO zip artifact is stale.

## Goal Achievement

### Success Criteria Mapping

| #   | Success Criterion (UI-XX)                                                       | Status     | Evidence                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | One row per device using `PopupSubMenuMenuItem` (UI-01)                         | PASS       | `usbee@bitcreed.us/src/popover.js:174` — `new PopupMenu.PopupSubMenuMenuItem(headline, true)` inside `buildDeviceRow`; called per device from loop at L89-93. No `PopupMenuItem`-stacked-bullet pattern remains.                  |
| 2   | Single-row accordion via `open-state-changed` (UI-02)                           | PASS       | `popover.js:101-109` — `open-state-changed` handler closes all other rows when one opens; CR-02 mitigation tracks signal IDs at L101/110 and disconnects on next rebuild (L51-60).                                                |
| 3   | Issue-first sort using non-empty diagnostic (UI-03)                             | PASS       | `popover.js:84-85` stable sort `(a,b) => Number(hasIssue(b)) - Number(hasIssue(a))`; `device-store.js:209-223` `hasIssue` predicate uses CR-01-narrowed `DIAG_PHRASES` ('limited to', 'limiting', 'slower than', etc.) — no longer matches daemon's routine 'Passive cable'/'Active cable'/'Cable speed' bullets. Verified against `../usbeehive/src/summary.rs:295,297`. |
| 4   | Class/driver-derived symbolic icon per row (UI-04)                              | PASS       | `usbee@bitcreed.us/src/device-icon.js:54-81` — daemon-precedence with strict regex `/^[a-z0-9][a-z0-9-]*-symbolic$/` (WR-02 fix, no `/i`), category shortcut for hub/typecport→`network-usb-symbolic`, headline-only keyword scan (WR-01 fix), full keyword table for keyboard/mouse/storage/audio/camera/printer/phone, fallback `network-usb-symbolic`. Wired at `popover.js:175`.                                                |
| 5   | Adwaita-coherent labelled-property detail panel (UI-05)                         | PASS       | `popover.js:170-206` `buildDeviceRow` constructs detail rows via `buildPropertyRow` (L220-251) with explicit `vertical:false` (WR-06 fix), `.usbee-detail-key` + `.usbee-detail-value` style classes, gettext-marked left-column labels (Power/Speed/Version/Direction/Role/Diagnostic/Detail/Summary), Pango.WrapMode.WORD_CHAR for multi-line wrapping (DIAG-02). Stylesheet rules at `stylesheet.css:24-54`. Daemon strings rendered via `.text =` (no `set_markup`) — security invariant preserved. |
| 6   | Clean `gnome-extensions pack` v1.1.0 zip; regenerated `.pot`; 9 EGO gates green | **FAIL**   | **The on-disk zip is the STALE Phase 02 v1.0 zip — see Gap section below.**                                                                                                                                                       |

**Score: 5/6 success criteria PASS, 1/6 FAIL**

### Requirements Coverage (UI-01..UI-05)

| ID    | Requirement                                                          | Plan Lists | Source Evidence                                                                            | Status    |
| ----- | -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ | --------- |
| UI-01 | `PopupSubMenuMenuItem` device rows                                   | yes        | `popover.js:174`                                                                           | SATISFIED |
| UI-02 | Accordion behaviour (one open at a time)                             | yes        | `popover.js:101-109`                                                                       | SATISFIED |
| UI-03 | Diagnostic-flagged devices float to top                              | yes        | `popover.js:84-85` + `device-store.js:209-223` (CR-01 narrowed)                            | SATISFIED |
| UI-04 | Class/driver-derived symbolic icons                                  | yes        | `device-icon.js` + import in `popover.js:25` + use at `popover.js:175`                     | SATISFIED |
| UI-05 | Adwaita-coherent labelled-property detail panel                      | yes        | `popover.js:170-251` + `stylesheet.css:24-54`                                              | SATISFIED |

**5/5 requirements covered in source code.** All UI-0x requirements are satisfied at the JS+CSS level; the gap is purely the unshipped EGO zip artifact.

### Required Artifacts

| Artifact                                              | Expected                                                            | Status     | Details                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usbee@bitcreed.us/src/device-icon.js`                | `iconForDevice` mapper, ≥30 lines                                   | PASS       | 81 lines, exports `iconForDevice`; SPDX header line 1; daemon-precedence regex; full keyword table; fallback verified.                                                |
| `usbee@bitcreed.us/src/popover.js`                    | Accordion `populateDeviceRows` using `PopupSubMenuMenuItem`         | PASS       | 251 lines; contains `PopupSubMenuMenuItem`, `iconForDevice`, `hasIssue`, `open-state-changed`, `usbee-detail-key`/`value`, `removeAll`, `hide-empty-ports`. No markup APIs. No Gtk/Adw imports. |
| `usbee@bitcreed.us/src/device-store.js`               | `hasIssue(device)` exported; `diagnostic` derived from bullets[]    | PASS       | 261 lines; `hasIssue` exported at L209; existing `deriveSubtitle` and `DeviceStore` exports intact.                                                                  |
| `usbee@bitcreed.us/stylesheet.css`                    | `.usbee-detail-key`, `.usbee-detail-value`, panel styling           | PASS       | All four `.usbee-detail-*` rules present; existing `usbee-popover-scroll` and `usbee-empty-state-*` preserved.                                                       |
| `usbee@bitcreed.us/metadata.json` (working tree)      | `"version-name": "1.1.0"`                                           | PASS       | Working-tree file shows `"version-name": "1.1.0"` at line 9; all other fields unchanged.                                                                              |
| `usbee@bitcreed.us/po/usbee@bitcreed.us.pot`          | Regenerated; `Project-Id-Version: USBee 1.1.0`; new property strings| PASS       | Header line 9 `Project-Id-Version: USBee 1.1.0`; 37 msgid entries (33 unique source strings — note: SUMMARY claims 42, the actual `grep -c '^msgid '` returns 37, still well above the ≥20 gate); contains `Power`, `Speed`, `Version`, `Direction`, `Role`, `Diagnostic`, `Detail`, `Summary`. ⚠️ msgid count discrepancy (37 vs SUMMARY's claimed 42) is informational; >20 gate still passes.   |
| `usbee@bitcreed.us.shell-extension.zip` (v1.1.0 EGO submission)   | v1.1.0 contents; passes 9 EGO gates                     | **FAIL**   | **STALE v1.0 zip — see Gap analysis below.**                                                                                                                         |

### Key Link Verification

| From                                  | To                                  | Via                                                          | Status | Details                                                                  |
| ------------------------------------- | ----------------------------------- | ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------ |
| `src/popover.js`                      | `src/device-icon.js`                | `import {iconForDevice} from './device-icon.js'`             | WIRED  | Line 25; used at line 175 (`row.icon.icon_name = iconForDevice(device)`).|
| `src/popover.js`                      | `src/device-store.js`               | `import {hasIssue} from './device-store.js'`                 | WIRED  | Line 24; used at line 84 (sort comparator).                              |
| `src/popover.js`                      | `gnome-shell popupMenu.js`          | `new PopupMenu.PopupSubMenuMenuItem(headline, true)`         | WIRED  | Line 174 inside `buildDeviceRow`.                                        |
| `src/tile.js`                         | `src/popover.js`                    | `populateDeviceRows(this._rowsSection, this._store, this._extension)` | WIRED  | `tile.js:116` inside `_rebuildPopover`. Called from `open-state-changed` lazy populate at `tile.js:67-70`. |

### EGO Audit Gates — On-Disk Zip vs. Current Source

The 9 EGO gates that the SUMMARY claims pass were re-run by this verifier:

| # | Gate                                            | Working-Tree Source | On-Disk Zip                                          |
| - | ----------------------------------------------- | ------------------- | ---------------------------------------------------- |
| 1 | No bundled binaries                             | PASS                | PASS (no `.so/.bin/.a/.dll` — but it's the v1.0 zip) |
| 2 | No junk dirs                                    | PASS                | PASS                                                 |
| 3 | Full SPDX coverage on `.js` files               | PASS (all 9 files)  | PASS for the 7 .js files in the zip — but `device-icon.js` is MISSING from the zip (Phase 03 file never shipped) |
| 4 | ≥20 msgid in `.pot`                             | PASS (37 msgid)     | PASS for the OLD .pot in zip (28 msgid) — but new strings missing |
| 5 | No Gtk/Adw in Shell-process code                | PASS                | PASS                                                 |
| 5b| `prefs.js` imports Adw                          | PASS                | PASS                                                 |
| 6 | No sync D-Bus / spawn                           | PASS                | PASS                                                 |
| 7 | `shell-version == ["46","47","48"]`             | PASS                | PASS                                                 |
| 8 | No manual `version` field                       | PASS                | PASS                                                 |
| 9 | Both schema keys (`port-mutes`, `hide-empty-ports`) in zip | n/a (working tree)  | PASS                                                 |

**The 9 gates pass — but they pass against the WRONG zip.** A clean v1.1.0 zip has not actually been produced.

### Anti-Patterns Found

None of significance. The code is clean, follows the v1.0 invariants:
- No `set_markup` / `set_use_markup` calls anywhere in `src/` or `extension.js`
- No `gi://Gtk` or `gi://Adw` imports in Shell-process code
- No `.call_sync` / `new_for_bus_sync` / `spawn_sync`
- All user-visible strings wrapped in gettext markers
- All `.js` files carry SPDX header

### Notable Artefact / Documentation Discrepancies (informational)

- **SUMMARY.md claims 42 msgid; verifier counts 37** — `grep -c '^msgid '` returns 37 (one of which is the empty-string header), so 36 unique msgids. Still >20 gate. Minor — likely a counting-method discrepancy.
- **SUMMARY.md claims zip SHA-256 `60368fa7…`; on-disk SHA-256 is `8534fd87…`** — confirms the on-disk zip is not the one the SUMMARY refers to.
- **`.pot` source-file references point at `/home/blk/projects/rust/usbee/.claude/worktrees/agent-a99a42eb6d10dd40b/usbee@bitcreed.us/...`** — confirms the `.pot` was generated from a worktree that has since been removed, suggesting the v1.1.0 packaging step happened in a transient worktree whose `usbee@bitcreed.us.shell-extension.zip` artifact never made it back to the repo root. Cosmetic for the `.pot` (gettext consumers don't care about the path), but a smoking gun for the zip-staleness root cause.

## Gap Analysis

### Gap 1 (BLOCKER): EGO submission zip is stale

The `usbee@bitcreed.us.shell-extension.zip` at the repo root is the Phase 02 v1.0.0 zip, not the v1.1.0 zip the phase claims to ship.

**Concrete evidence (4 independent failure modes):**

1. **`unzip -p ... metadata.json`** → `"version-name": "1.0.0"` (working tree is `1.1.0`).
2. **`unzip -l ...`** → no `src/device-icon.js` entry (file was added in Phase 03 commit `8cb450a`).
3. **`unzip -p ... src/popover.js | grep -c PopupSubMenuMenuItem`** → 0 matches (working tree has 1).
4. **`unzip -p ... src/device-store.js | grep -c hasIssue`** → 0 matches (working tree has 1 export + JSDoc references).

**Additional corroboration:**

- Zip mtime `2026-05-12 18:00` predates all Phase 03 source commits (latest source commit `b3db4df` "fix(03): WR-06 — declare BoxLayout orientation explicitly" timestamp May 12 22:24).
- Zip SHA-256 `8534fd877fc3ee16d625ef7658f83864d4d10665d65e3ee48425e0c4303a2159` ≠ SUMMARY-claimed `60368fa7b2b2959a3542f22a2b377ff89619ce85d29ab9fc8933892c91b173dd`.
- Internal stylesheet inside zip (524 bytes) lacks `.usbee-detail-*` rules (working tree is 1494 bytes).
- Internal `.pot` inside zip (2749 bytes, 28 msgid) lacks the new property strings.

**Impact:** Phase 03's headline deliverable — "the shipped artifact is a re-packed `usbee@bitcreed.us.shell-extension.zip` carrying `version-name: 1.1.0` … ready for upload to the existing EGO listing" — is not actually present. If the user uploaded the current zip to EGO, they would re-upload the v1.0 they already shipped.

**Remediation steps (per the plan's `<egp-repack-recipe>` block):**

```bash
cd /home/blk/projects/rust/usbee
rm -f usbee@bitcreed.us.shell-extension.zip
glib-compile-schemas usbee@bitcreed.us/schemas/
gnome-extensions pack \
  --extra-source=src \
  --extra-source=po \
  --extra-source=icons \
  --extra-source=COPYING \
  --extra-source=README.md \
  --extra-source=dbus-iface.xml \
  -f usbee@bitcreed.us
zip -d usbee@bitcreed.us.shell-extension.zip gschemas.compiled 2>/dev/null || true
( cd usbee@bitcreed.us && zip ../usbee@bitcreed.us.shell-extension.zip schemas/gschemas.compiled )
sha256sum usbee@bitcreed.us.shell-extension.zip
unzip -l usbee@bitcreed.us.shell-extension.zip | grep -E 'device-icon|popover|metadata|stylesheet|\.pot|gschemas'
```

Then re-run all 9 EGO audit gates against the resulting zip and update SUMMARY.md with the real SHA-256.

### Human Verification Required

- **Task 7 (Sections A–I)**: Live gnome-shell smoke test of v1.1 popover (per phase-plan checkpoint:human-verify gate). The Phase 03 plan declared this `gate="blocking"` but the SUMMARY records it as auto-approved via `auto_advance: true`. The verifier defers the operator-interaction gate to the user — sections A (rows render), B (single-row accordion), C (issue-first sort), D (icons), E (detail panel), F (hide-empty-ports regression), G (notification regression), H (lock/unlock + enable/disable hygiene), and I (EGO audit gate spot-check).

## Conclusion

The Phase 03 source-code deliverables (UI-01 through UI-05) are correctly implemented, well-commented, defensively coded, and pass every grep-able invariant from the plan + code-review fix list. The `.pot` is regenerated and the working-tree `metadata.json` carries `version-name: 1.1.0`.

The **single failing must-have** is SC-6's "shipped artifact" — the `gnome-extensions pack` step, while claimed in commit `d867007` and SUMMARY.md, did not result in an updated zip at the repo root. The on-disk zip is the v1.0 zip from Phase 02. This is a packaging artefact bug, not a code bug; the working-tree source is fully ready and a single re-pack command will close the gap.

After re-packing and re-running the 9 EGO audit gates against the new zip, this phase is ready for EGO upload pending Task 7 human smoke test.

---

_Verified: 2026-05-12T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
