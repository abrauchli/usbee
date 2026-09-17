---
phase: 260917-j6u
plan: 01
subsystem: release
status: complete
tags: [release, changelog, metadata, local-deploy, no-tag, no-push]
requires:
  - "260917-hkf (tile title names link capability) on master"
  - "260917-i43 (verdict-coloured speed rating) on master"
provides:
  - "v2.10.0 cut locally: metadata 15 / 2.10.0, CHANGELOG section, installed on disk"
affects:
  - "usbee@bitcreed.us/metadata.json"
  - "CHANGELOG.md"
  - "~/.local/share/gnome-shell/extensions/usbee@bitcreed.us/ (install destination)"
tech-stack:
  added: []
  patterns:
    - "Release preparation stops before the tag; the GitHub Release stays the user's to trigger"
    - "Structural zip gate (src/ prefix present) rather than byte-total matching"
key-files:
  created: []
  modified:
    - "usbee@bitcreed.us/metadata.json"
    - "CHANGELOG.md"
decisions:
  - "D-1 MINOR bump 2.9.0 -> 2.10.0, version 14 -> 15 (inferred, human unavailable)"
  - "D-2 Both entries under one ### Changed heading (inferred)"
  - "D-3 Colour-contrast limitation disclosed in user language, no ratios, no standard named (inferred)"
  - "D-4 Reference link added now though it 404s until the user tags (inferred)"
  - "D-5 Test suites not re-run; no JavaScript changed (inferred)"
  - "D-6 Committed straight to master with git.allow_default_branch_commits unset (inferred)"
  - "Plan's c7 link-count guard was mis-scoped and was corrected, not waved through"
metrics:
  duration: ~8m
  completed: 2026-09-17
actuals:
  tokens: 31000
  tasks: 3
  commits: 1
plan_head_before: 053fd53
---

# Quick Task 260917-j6u: Release Prep v2.10.0 — Version Bump and Local Deploy Summary

v2.10.0 is cut and installed on this machine at `15` / `2.10.0`, with the two
user-visible features that landed since v2.9.0 written up in the changelog. The
release stops deliberately at the local install: no tag exists, nothing was
pushed, and the GitHub Release remains entirely the user's to trigger.

## What Was Built

**`usbee@bitcreed.us/metadata.json` — `version` 14 → 15, `version-name` 2.9.0 →
2.10.0.** Two scoped replacements, nothing else in the file touched; the diff is
exactly 2 insertions / 2 deletions. MINOR per D-1: two user-facing behaviour
changes, nothing removed, nothing broken. The `version` integer is monotonic and
unrelated to semver (CLAUDE.md), so it advances by one regardless of the semver
shape.

**`CHANGELOG.md` — a new `## [2.10.0] — 2026-09-17` section.** Date checked with
`date -u`, not assumed. One `### Changed` heading (D-2) carrying two narrative
entries in the `[2.9.0]` section's register: the capability-named tile title
(260917-hkf) and the verdict-coloured speed rating (260917-i43). `## [Unreleased]`
survives above it and is still empty. The `[2.10.0]:` reference link was added in
the file's existing `releases/tag/vX.Y.Z` form, immediately above the `[2.9.0]:`
line; no `[Unreleased]:` compare link was invented, the file having never had one
(D-4). The whole changelog diff is **+31 / −0** — purely additive, no existing
prose disturbed.

**The colour-contrast limitation is disclosed** (D-3), inside the second entry
rather than split out, written as *"on a light theme the green and the orange sit
closer to the background than they should, and on a dark theme the red does …
the words beside the colour remain the thing to trust."* No ratio numbers, no
standard cited — the measured figures recorded in 260917-i43 stay in that task's
own record, where they belong.

**Commit `f9d03a6` — `chore: release v2.10.0`**, exactly two files, staged by
explicit path. The bare subject form is CLAUDE.md's documented convention for a
release commit; no quick-task scope was added.

## Verification

| Gate | Result |
|------|--------|
| Commit subject exactly `chore: release v2.10.0` | pass |
| Files in the release commit | **2** |
| `metadata.json` diff shape | 2 ins / 2 del |
| `CHANGELOG.md` deletions | **0** (purely additive, +31) |
| Three newest `## [` headings | Unreleased, 2.10.0, 2.9.0 |
| `## [Unreleased]` body | empty |
| Version reference links | **15**, newest `[2.10.0]` |
| Zip `src/` entries | **15** (14 modules + the dir entry) |
| Zip totals | **25 files / 316,932 B** |
| Zip embedded `metadata.json` | 15 / 2.10.0 |
| Symlink guard, re-run live pre-install | **REAL DIRECTORY** (`drwxrwxr-x`) |
| On-disk installed `metadata.json` | **15 / 2.10.0** |
| `schemas/gschemas.compiled` regenerated | yes, 692 B |
| Repo `usbee@bitcreed.us/` after install | **clean**, 0 changes |
| `v2.10*` tag, local and on remote | **none** |
| `origin/master` | unmoved at `ae3bc69` |
| Zip gitignored / unstaged | yes |

Every correctness-bearing check ran under `rtk proxy`. That is not ceremony: the
rtk hook strips the type and permission field from a bare `ls -ld`, which would
make the symlink guard pass vacuously against a symlink, and it filters the
`unzip -l` listing the zip gate reads.

## Deviations from Plan

### 1. [Rule 1 — Bug in the plan's own verification expression] The link-count guard was mis-scoped

**Found during:** Task A verification.

**Issue:** The plan's automated gate asserted
`test "$(grep -c "^\[2\." CHANGELOG.md)" -eq 15`. It returned **14** and the gate
failed. The cause was not the file: that expression counts only the `2.x`
reference links, of which there were **13** before this task and are **14** now.
The plan had assumed a 14-link baseline for a pattern that only ever matched 13,
because `[1.2.0]` sits at the bottom of the block and the `^\[2\.` anchor excludes
it.

**Fix:** The guard was corrected to `grep -c "^\[[0-9]"`, which counts every
version reference link and returns **15** — which is exactly what the plan's own
`must_haves` and verification step 4 state in prose ("15 version reference links
at the bottom"). The prose requirement was right; the regex implementing it was
not. The intended invariant passes: 15 links, descending, newest `[2.10.0]`
immediately above `[2.9.0]`.

**Why this was chased rather than waved through:** a guard that fails is either
telling the truth about the artifact or lying about itself, and those need
opposite responses. Bisecting the ten checks individually isolated it to one
expression and proved the other nine green, so the artifact was never in doubt.
This is the same class of failure 260915-mpf hit with its line-count guard, and
was handled the same way — correct the guard, record why.

**Files modified:** none (verification expression only).

### 2. [Flagged, not a fix] Committed to `master` with the default-branch override unset

D-6. `git.allow_default_branch_commits` remains unset in `.planning/config.json`,
as it has been for every prior quick task in this repo. Recorded for audit rather
than silently overridden.

## Inferences Made While the Human Was Unavailable

D-1 through D-6 were all settled from CLAUDE.md, the repo's own precedent and the
verified facts, and are flagged here for later audit:

- **D-1** — MINOR bump, `version` → 15.
- **D-2** — both entries under a single `### Changed`.
- **D-3** — contrast limitation disclosed in user language.
- **D-4** — reference link added now, though it 404s until the user tags. Same
  choice 260915-mpf made cutting 2.9.0 locally.
- **D-5** — test suites not re-run. This is safe rather than lazy because Task A's
  two-file diff *proved* no JavaScript changed; the 687-assertion green baseline
  from `9bdb485` still stands for the tree that was packed. Nothing in the repo
  reads `metadata.json` except `release.yml`, and only at tag time.
- **D-6** — committed straight to `master`.

## Notes for the User

**A GNOME Shell restart is outstanding** before 2.10.0 actually loads. This debt
is now accumulated across **260915-i4w, 260915-ikd, 260915-mpf, 260916-2qs,
260917-hkf, 260917-i43 and this task** — meaning the tile title change and the
verdict colouring have still never been seen rendered. Nothing here restarted the
Shell or prompted a re-login; that stays on the user's schedule. Xorg: `Alt+F2`
→ `r`; Wayland: full re-login.

**`gnome-extensions info usbee@bitcreed.us` will report 2.9.0** until that restart.
It reads live in-process metadata, not the disk. This is documented behaviour in
CLAUDE.md, it is not a failed install, and it was deliberately not used as the
verification instrument — the on-disk `metadata.json` was read directly instead,
and reads 15 / 2.10.0.

**The zip grew to 316,932 B from the 258,765 B recorded for 2.9.0.** This was
checked rather than accepted: the listing accounts for it entirely as code growth
in the files 260917-hkf and 260917-i43 touched — `popover.js` at 63,208 B and
`link-verdict.js` at 34,343 B, both timestamped today alongside `tile.js` and
`device-store.js`. No foreign content, no stray files, `dbus-iface.xml` correctly
absent per CLAUDE.md. The structural gate (the `src/` prefix appearing at all) is
the real signal and it passed at 14 modules; the ~231 KB figure in CLAUDE.md is a
drifting reference, not an invariant, and is now two releases stale.

**To finish the release** when ready: tag `v2.10.0` with the changelog body as the
annotated message (use `--cleanup=verbatim`, or git strips every `###` header —
the trap 260916-2qs caught), then `git push origin v2.10.0`. `release.yml` asserts
`version-name` matches the tag, which it does. There are **12 commits unpushed**
on `master`; `origin/master` sits at `ae3bc69`.

## What Was NOT Done

- **No tag.** `git tag -l "v2.10*"` and `git ls-remote --tags origin "v2.10*"`
  both empty; newest local tag is still `v2.9.0`.
- **No push.** `origin/master` is byte-identical to where it started.
- **No `gh release`.** No `git push`, `git tag` or `gh release` command was issued
  at any point in this task.
- **No `.pot` regeneration.** No user-visible strings changed here; 260917-hkf
  already regenerated it when its strings changed.
- **No Shell restart, no re-login prompt, no `pkill`.**
- **No `glib-compile-schemas` run** — `gnome-extensions install` compiled the
  schemas itself, as CLAUDE.md records.

## Self-Check: PASSED

- `usbee@bitcreed.us/metadata.json` — FOUND, reads 15 / 2.10.0
- `CHANGELOG.md` — FOUND, `## [2.10.0] — 2026-09-17` present with its reference link
- `usbee@bitcreed.us.shell-extension.zip` — FOUND at repo root, gitignored
- `~/.local/share/gnome-shell/extensions/usbee@bitcreed.us/metadata.json` — FOUND, reads 15 / 2.10.0
- Commit `f9d03a6` — FOUND in `git log`
