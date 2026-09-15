---
quick_id: 260915-mpf
slug: release-v2-9-0-bump-metadata-version-rol
date: 2026-09-15
status: complete
---

# Quick Task 260915-mpf — Summary

Cut **v2.9.0** and deployed it locally. **No tag, no push** — both
deliberately held back at the user's instruction, so the GitHub Release
remains the user's to trigger.

## Bump sizing — read from the content, not assumed

The `## [Unreleased]` body carried:

| Subsection | Content |
|---|---|
| Added | popover **Options** submenu; `hide-builtin-devices` filter; always-on **USB ID** row; `(max)` PDO ceiling marker |
| Changed | "All devices hidden by the current filters" empty state |
| Removed | the client-side `SnapshotJson` interface declaration |

New user-facing features with no user-facing breaking change ⇒
**MINOR**. `version-name` 2.8.0 → **2.9.0**, `version` 13 → **14**.

The `Removed` entry was checked rather than counted as a break: it drops
a client-side interface **declaration** only. usbeehive is untouched and
still serves `SnapshotJson`, so `busctl` and the usbeehive CLI reach it
exactly as before (260915-ib9 proved it dead in USBee before removing
it). Nothing a user could invoke stopped working, so it does not force a
major. The user's proposed sizing and the content agree.

## Changelog roll

`[Unreleased]` body moved **verbatim** into `## [2.9.0] — 2026-09-15`
(today's real date, checked with `date`, not guessed). `## [Unreleased]`
left present and empty above it. A `[2.9.0]:` reference link was
appended in the file's existing `releases/tag/vX.Y.Z` style. The file has
**no `[Unreleased]:` compare link** and one was deliberately not
invented.

**A line-count guard mismatch was chased rather than waved through.** The
plan predicted 726 lines; the file came out at 725. Cause: the plan's
baseline (723) was taken from a file viewer's display numbering, while
`wc -l` at HEAD reports **722**. `722 + 3 = 725` checks out. The stronger
guard was applied instead and holds: `git diff` is exactly **+3 / −0**,
touching only the new heading, its blank line and the link ref, with no
`\ No newline at end of file` marker on either side and no deletion
anywhere — so no section was lost, duplicated or truncated. The plan's
stated guard was corrected to the `wc` baseline so the record is not
wrong.

## Pack and install

Both documented silent-failure modes were actively guarded, not assumed.

- **Guard #1 — the silently broken zip.** A wrong `--extra-source` path
  makes `pack` exit 0 and print nothing, so a broken zip is
  indistinguishable from a good one. Packed with the full CLAUDE.md
  invocation (`--podir=../po --extra-source=src --extra-source=icons
  --force`) and **proved** under `rtk proxy unzip -l`: **25 files /
  258,765 B with 15 `src/` entries** (14 modules plus the directory
  entry). The `src/` prefix appearing at all is the real signal, and it
  does; the failure signature is ~10 entries / ~29 KB.
- **Guard #2 — the repo-wiping symlink.** Per 260910-hrj,
  `install --force` through a symlink into this repo deletes the
  *target's* contents. `rtk proxy ls -ld` (proxied deliberately — the rtk
  hook strips the type/permission field from bare `ls -ld`, which makes
  symlink status undeterminable) reported `drwxrwxr-x`, a **real
  directory**, both at the start of the task and again immediately before
  installing rather than trusting the earlier reading.

`gnome-extensions install --force` exited **0**.

## Verification

- **483 assertions green** across all four suites before packing, under
  `rtk proxy` so no `test result:`-shaped line was filtered away:
  dbus-client **66**, daemon-status **94**, forward-compat **266**,
  service-probe **57**. All four printed `ALL TESTS PASSED`. Matches the
  prior baseline exactly; a failing tree was never packed.
- **On-disk metadata read back under `rtk proxy`**: `"version": 14` /
  `"version-name": "2.9.0"`. Read from the installed path deliberately,
  **not** via `gnome-extensions info`, which reports the previously
  loaded in-process version until the Shell restarts — a stale reading
  there is expected, not a failed install.
- **Repo sources survived the install**: `git status --porcelain` shows
  only two untracked directories (`.gsd/`, left alone as instructed, and
  this task's own planning directory). Nothing under
  `usbee@bitcreed.us/` was deleted — 14 `src/` modules still present
  along with `metadata.json`, `schemas/`, `icons/`, `extension.js`,
  `prefs.js`, `stylesheet.css` and `dbus-iface.xml`.
- **No tag, nothing pushed**: `git tag -l 'v2.9*'` returns empty (the
  newest tag is still `v2.8.0`), and `origin/master..HEAD` is **10
  commits** unpushed.

## Housekeeping — the 260915-ikd backfill

`260915-ikd` never appended its row to the Quick Tasks table; it jumped
`ib9` → `mk0`. `260915-mk0` noticed and deliberately left it as found.
The row is now inserted in its correct chronological position between
them, matching the table's 6-pipe / 5-field shape, with commits
`f5275f1, 29722e1, 3f0c12a`.

**It is explicitly marked in-cell as a reconstruction** from that task's
own PLAN and SUMMARY, not a contemporaneous record. Row and field counts
were verified after the insert — a prior task welded two rows together by
consuming a trailing newline, so this was checked rather than assumed.

## Not verified

- **The running extension.** The tile and popover live in the
  `gnome-shell` process, which cannot reload mid-session. v2.9.0 is on
  disk but the Shell still runs the previously loaded code from memory.
  A **GNOME Shell restart is outstanding** (Xorg: `Alt+F2` → `r`;
  Wayland: full re-login) — this has now accumulated across 260915-i4w,
  260915-ikd and this task.
- The preferences window was not exercised. It *can* be tested without a
  Shell restart, but the installed path is a real directory holding the
  release rather than a symlink to this checkout, so there was nothing
  to gain over what the on-disk read already confirms.

## Inferred decisions (human unavailable)

- **D-1 — MINOR, not major.** The `Removed` entry is a client-side
  declaration with the daemon-side method still served; evidence above.
- **D-2 — Committed directly to `master`** with
  `git.allow_default_branch_commits` unset in `.planning/config.json`.
  An unconfigured bypass, flagged for audit, taken on the strength of
  every prior quick task doing the same and the standing keep-`master`
  preference. `git.branching_strategy` is `"none"` and
  `quick_branch_template` is `null`, so the workflow itself created no
  branch.
- **D-3 — The USB ID row was left ungated** by
  `show-technical-details`, per instruction: that is 260915-ikd's D-3,
  an open taste call the user has not decided.
- **D-4 — The plan's line-count guard was corrected** rather than left
  standing as a failed check, since the discrepancy was in the guard's
  baseline unit and not in the file.
