---
phase: 04-devices2-wire-shape-migration-v2-0
plan: 03
status: complete
completed: 2026-05-26
note: EGO upload (Task 8) superseded — first EGO submission will be v2.1.0
---

# Plan 04-03 Summary — Release Coordination

## What Was Executed

Tasks 1–7 completed manually between 2026-05-14 and 2026-05-14:

| Task | Outcome | Commit / Artifact |
|------|---------|-------------------|
| T1: Confirm MIN_USBEEHIVE_VERSION | Confirmed `0.6.0` — usbeehive tagged `v0.6.0` with Devices2 | — |
| T2: Bump metadata.json to v2.0.0 | version-name `2.0.0`, version `2`, description updated to Devices2 | `87e9add` |
| T3: ## [2.0.0] CHANGELOG entry | Full entry with daemon dependency, regex deletions, new features | `70fe02d` |
| T4: Regenerate .pot | New strings: Serial, Cable speed, Subclass, Driver, not bound, out of date | included in `87e9add`-era commits |
| T5: Build + smoke-test zip | `gnome-extensions pack` produced clean zip; install + enable succeeded | — (zip gitignored) |
| T6: Annotated tag v2.0.0 | `git tag -a v2.0.0` with CHANGELOG body as message | `git tag v2.0.0` |
| T7: Tag pushed (human checkpoint) | `git push origin v2.0.0` — release.yml ran, GitHub Release created | [v2.0.0](https://github.com/abrauchli/usbee/releases/tag/v2.0.0) |

## Task 8 — EGO Upload (Superseded)

Task 8 (upload to extensions.gnome.org) was deliberately held. After v2.0.0
was tagged, the warning badge feature was implemented (commit `1306c09` —
`charging_diag.is_warning` amber row badge + `charging_diag.summary/detail`
in the detail panel). The decision was made to submit v2.1.0 as USBee's first
EGO submission rather than v2.0.0 so the badge lands before any users see the
extension.

## Anti-Patterns Captured

Preserved in `.continue-here.md` (now deleted). Key ones for the record:

- `gnome-extensions pack` must include `--extra-source=src --extra-source=icons`
  or the zip is unusable (src/ and icons/ omitted by default).
- Gettext `_()` must not be called at module top-level — only after `enable()`.
  `label-table.js` uses the memoized pattern as the canonical example.
- `St.BoxLayout` uses `vertical: true/false`, not `Clutter.Orientation.*` on GNOME 46.
- Shim `_setOpenedSubMenu` on both `this.menu` and `this._rowsSection`.

## Next

v2.1.0 release as first EGO submission (see STATE.md §Next Action).
