---
quick_id: 260915-mpf
slug: release-v2-9-0-bump-metadata-version-rol
date: 2026-09-15
status: in-progress
---

# Quick Task 260915-mpf — Cut v2.9.0 and deploy locally (no tag, no push)

## Problem

Four quick tasks have landed on `master` since v2.8.0 was cut
(`260915-i4w`, `260915-ib9`, `260915-ikd`, `260915-mk0`), all unpushed.
`CHANGELOG.md` carries a populated `## [Unreleased]` section;
`usbee@bitcreed.us/metadata.json` still reads `13` / `2.8.0`. The
release needs cutting and installing locally so the next Shell restart
loads it. The tag and the push are explicitly held back.

Separately, `260915-ikd` never appended its row to the Quick Tasks
table in `.planning/STATE.md` — the table jumps `ib9` → `mk0`.
`260915-mk0` noticed this and deliberately left it as found. It is
reconstructed here.

## Bump sizing

Read from the actual `## [Unreleased]` body, not assumed:

- **Added** — popover Options submenu, `hide-builtin-devices` filter,
  the always-on USB ID row, the `(max)` PDO ceiling marker.
- **Changed** — the "All devices hidden by the current filters" empty
  state.
- **Removed** — the client-side `SnapshotJson` interface declaration.

New user-facing features with no user-facing breaking change ⇒
**MINOR**. The `Removed` entry is a *client-side declaration* only:
usbeehive still serves `SnapshotJson`, and `busctl` / the usbeehive CLI
reach it exactly as before, so it does not force a major.

`version-name` 2.8.0 → **2.9.0**; `version` 13 → **14** (monotonic
integer, unrelated to semver).

## Tasks

1. **Bump `usbee@bitcreed.us/metadata.json`** — both fields.
2. **Roll `CHANGELOG.md`** — move the `[Unreleased]` body verbatim into
   a new `## [2.9.0] — 2026-09-15`, leave `## [Unreleased]` present and
   empty, append a `[2.9.0]:` reference link in the file's existing
   `releases/tag/vX.Y.Z` style. The file has **no `[Unreleased]:`
   compare link** — do not invent one. Line count guard (`wc -l`):
   722 → **725** (+2 for the new heading and its blank line, +1 for the
   link ref). Count with `wc -l`, not a file viewer's display numbering
   — the two disagree by one here, and only the `wc` baseline makes the
   +3 arithmetic check out. The stronger guard is the diff itself:
   exactly **+3 / −0**, with no `\ No newline at end of file` marker on
   either side.
3. **Commit** `chore: release v2.9.0` (documented convention; no
   quick-task scope on the release commit).
4. **Pack** with the full CLAUDE.md invocation — `--extra-source=src`
   is mandatory. Verify the zip under `rtk proxy unzip -l`: a wrong
   `--extra-source` path exits 0 and prints nothing, so the `src/`
   prefix appearing at all is the real gate, not the entry total.
5. **`ls -ld` pre-flight under `rtk proxy`**, then install. The
   destination must be a real directory: per `260910-hrj`,
   `install --force` through a symlink into this repo deletes the
   symlink target's contents. The rtk hook strips the type/permission
   field from bare `ls -ld`, hence `rtk proxy`.
6. **Read back on-disk metadata** under `rtk proxy` — not via
   `gnome-extensions info`, which reports the previously loaded
   in-process version until the Shell restarts. Confirm the repo's own
   extension sources survived.
7. **Backfill the `260915-ikd` row** into the STATE.md Quick Tasks
   table between `ib9` and `mk0`, matching the 6-pipe / 5-field column
   shape, reconstructed from that task's own PLAN and SUMMARY. Append
   this task's own row after `mk0`.

## Verification

- All four CI suites green before packing — floor **483 assertions**
  (dbus-client 66, daemon-status 94, forward-compat 266,
  service-probe 57). Run under `rtk proxy`: the rtk hook drops
  `test result:`-shaped lines, so an unproxied pass check succeeds
  vacuously.
- Zip contains `src/` entries.
- On-disk `metadata.json` reads `14` / `2.9.0`.
- `git tag -l 'v2.9*'` empty; nothing pushed.
- STATE.md table row and field counts verified after the insert — a
  prior task welded two rows together by consuming a trailing newline.

## Out of scope

- Tagging and pushing (explicitly held back by the user).
- Gating the USB ID row behind `show-technical-details` — an open
  taste call the user has not decided (`260915-ikd` D-3).
- The untracked `.gsd/` directory; the gitignored zip.
