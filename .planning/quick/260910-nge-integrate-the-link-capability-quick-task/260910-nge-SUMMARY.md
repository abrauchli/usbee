---
quick_id: 260910-nge
slug: integrate-the-link-capability-quick-task
date: 2026-09-10
status: complete
commits:
  - 6047da5
---

# Quick Task 260910-nge — Summary

Integrated the two quick tasks that ran in parallel off the v2.7.1 release
commit `ceb643e`: `260910-myu` (already on `master`) and `260910-n10` (on
`worktree-agent-a204e501d63277c81`). Integration only — neither task's
decisions were revisited, and no conflict of *intent* was found between them.
They touch adjacent concerns in the same file and nothing more.

## Merge

`git merge --no-ff` produced **three** conflicts, not the two predicted.
`usbee@bitcreed.us/src/popover.js` — the file both tasks edited — merged
cleanly, as expected: n10's edits are confined to `buildLinkBlock()` and its
docstring, myu's are elsewhere in the file. Verified by reading the merged
region rather than trusting the clean exit.

### `CHANGELOG.md` (predicted)

Both sides added prose under the same `## [Unreleased]` header. Resolved by
keeping **both** sets in full — myu's `### Added` and `### Fixed`, n10's
`### Changed` — ordered Added / Changed / Fixed, matching the file's stated
"loosely follows Keep a Changelog". No entry was dropped, shortened or
rewritten. (The repo has no fixed subsection order across releases — 2.7.0 runs
Changed→Added, 2.6.0 Fixed→Added→Changed — so the canonical Keep a Changelog
order was the tie-break.)

### `po/usbee@bitcreed.us.pot` (predicted)

Both regenerated it, so line references diverged throughout. Not hand-merged:
the conflict was closed with `--ours` as a placeholder and the file was
regenerated from the merged sources afterwards.

The invocation was not assumed. It was **derived by reproduction** — the
committed template was regenerated candidate-wise until the output matched
byte-for-byte modulo `POT-Creation-Date` and line refs:

```sh
xgettext --from-code=UTF-8 --package-name=USBee --package-version=2.7.1 \
  -o po/usbee@bitcreed.us.pot \
  usbee@bitcreed.us/prefs.js usbee@bitcreed.us/src/*.js
```

**Input file order is load-bearing and easy to get wrong.** `prefs.js` must be
listed *first*. Passing `usbee@bitcreed.us/src/*.js` first (the ordering
CLAUDE.md's tooling table and the older 04-03 plan both suggest) reorders every
msgid block in the output and yields a diff of hundreds of spurious lines that
looks like real churn.

Result verified as the exact intended union, not merely as "it regenerated":

| Set | Unique msgids |
|-----|---------------|
| merge base `ceb643e` | 138 |
| `260910-myu` added / withdrew | +12 / −2 |
| `260910-n10` added / withdrew | +0 / −2 |
| **merged, expected** | **146** |
| **merged, actual** | **146** |

The two deltas are disjoint — the tasks touched entirely different strings — so
the union is well-defined. Each side's *deliberate* withdrawals were honoured
and nothing else went missing:

- gone because myu withdrew them: `"Run this command, then this list will
  populate automatically:"`, `"Start usbeehived daemon"`
- gone because n10 withdrew them: `"%s (USB %s)"`,
  `"%s — could run at %s on a faster port"`
- all 12 of myu's additions present; `msgid "Capability"` present
- **zero** msgids present in the merged template that appear in neither parent

`msgfmt --check-format` passes.

One pre-existing wrinkle surfaced: the template on `master` was already stale on
line references before this merge. It was generated at `9f09baa`, and `da4ad71`
(the Pango markup escaping fix) later added ~7 lines to `prefs.js` without a
regeneration. Those refs are corrected here as a side effect.

### `.planning/STATE.md` (not predicted)

Both tasks appended a row to the Quick Tasks Completed table *and* rewrote the
Current Position narrative block. Both rows kept; the narrative stack keeps myu
as `Last activity` and demotes n10 to `Previous activity`, with the `Status`
line naming both as unreleased on `master`.

## Verification

All four suites, run through `rtk proxy` so nothing was filtered out of the
output:

| Suite | Assertions | Result |
|-------|-----------:|--------|
| `dbus-client` | 66 | ALL TESTS PASSED |
| `daemon-status` | 94 | ALL TESTS PASSED |
| `forward-compat` | 167 | ALL TESTS PASSED |
| `service-probe` | 57 | ALL TESTS PASSED |
| **total** | **384** | |

Both tasks' work confirmed present in the merge result:

- `deriveShowCapability()` — defined and exported in `src/link-verdict.js`,
  consumed in `src/popover.js`
- the `Capability` row — `_('Capability')` at `popover.js:496`, gated on
  `link.showCapability`
- `(USB 2.1)` gone — no `(USB %s)` or `could run at` remains in `popover.js`
- `src/service-probe.js` — present, 12,873 B
- the prefs Start button — `_('Start')` at `prefs.js:291`, `StartUnit` wired

## Deployment

Packed and installed per CLAUDE.md. The `ls -ld` pre-flight was run first and
the destination is a **real directory**, not a symlink into the repo, so
`install --force` was safe. Confirmed after the install that the repo's
`usbee@bitcreed.us/` sources are untouched.

- zip: **25 entries / 235,168 B** uncompressed, `src/` prefix present with all
  14 modules including `service-probe.js`
- on disk: 22 files, `schemas/gschemas.compiled` compiled by `install`
- `metadata.json` on disk reads `"version": 12` / `"version-name": "2.7.1"` —
  **unchanged**; `git diff ceb643e..HEAD` shows the file untouched since the
  release commit

**The Shell was not restarted**, as instructed. The popover changes go live at
the next login. The prefs window could be checked mid-session
(`pkill -f org.gnome.Shell.Extensions` first) but was not, since this task
changed no prefs behaviour.

## Not done, by instruction

No version bump, no tag, no push. `master` is 10 commits ahead of
`origin/master`.
