---
phase: 260917-kf4
plan: 01
subsystem: docs
tags: [readme, screenshot, docs-only]
status: complete
requires: []
provides:
  - "docs/quick-settings-popover-link-speeds.png — the current README screenshot"
affects:
  - README.md
tech-stack:
  added: []
  patterns:
    - "Repo-root `docs/` for README assets — outside `usbee@bitcreed.us/`, so `gnome-extensions pack` provably cannot bundle them"
key-files:
  created:
    - docs/quick-settings-popover-link-speeds.png
  modified:
    - README.md
  deleted:
    - usbee-quick-settings-panel-device-list.png
decisions:
  - "D-1: Published the new screenshot with the Wi-Fi SSID `OrbitalSync` visible — INFERRED, flagged for audit"
  - "D-2: Placed the image under a new repo-root `docs/`, not under the extension directory"
  - "D-3: Left `## Repository layout` un-updated despite the new `docs/` sibling"
  - "D-4: Committed straight to `master` with `git.allow_default_branch_commits` unset — INFERRED, flagged for audit"
metrics:
  duration: ~11m
  completed: 2026-09-17
actuals:
  tokens: 21000
  tasks: 3
  commits: 1
plan_head_before: bfbdfcb
---

# Quick Task 260917-kf4: Add Current Quick Settings Screenshot to README Summary

The README now shows the UI that actually ships: the USBee tile and its
open popover listing seven devices with per-device link speeds, replacing
a capture that predated the speed badges, the Options row and the accent
theme.

## What Was Done

One commit, `9e2b9f2`, containing exactly three paths:

| Change | Path |
|--------|------|
| added | `docs/quick-settings-popover-link-speeds.png` (405x851 RGBA PNG, 70949 B) |
| modified | `README.md` — `## Screenshot` repointed, one line swapped for one line |
| deleted | `usbee-quick-settings-panel-device-list.png` (repo root) |

The new alt text names all three things the plan required — the tile, the
popover, and the per-device link speeds:

> The USBee tile and its open popover in GNOME Quick Settings, listing
> seven attached USB devices with their link speeds

The path is bare and relative (`docs/…`, no leading `/`, no `./`), which
is what GitHub needs to render it, and it resolves against a file present
in the same commit.

## The Privacy Gate: Halted, Then Resolved on Evidence

T-kf4-01 required viewing the PNG before staging it and halting if it
exposed anything that should not be public. I viewed it and **did halt**.

The four items the plan enumerated were all absent — no device serials, no
username, no hostname, no readable window content behind the panel. But
the capture shows the Wi-Fi tile reading **`OrbitalSync`**, directly above
the USBee tile. That is a distinctive SSID, not a `linksys`-class default,
and distinctive SSIDs are geolocatable through public wardriving databases.
It was not on the plan's list because the planner never saw the image —
delegating the look to the executor *is* the mitigation — so the list was
not treated as exhaustive-after-inspection.

**The halt was then resolved by evidence rather than by an operator
signature**, and the evidence was re-verified here rather than taken on
trust:

- `usbee-quick-settings-panel-device-list.png` — the very file this task
  deletes — is tracked and `git cat-file -e origin/master:…` confirms it is
  **already present on `origin/master`**, i.e. already public.
- Viewing that published image directly shows `Wi-Fi / OrbitalSync` in the
  same position, in the same README's `## Screenshot` section.

So the SSID is already in pushed public history and the marginal disclosure
of this swap is **zero**. Deleting the old file does not unpublish it
either. That turns the question from a risk acceptance into a settleable
fact.

**D-1 (INFERRED, flagged for audit):** published the new screenshot with
`OrbitalSync` visible, on the evidence above. If the operator ever wants
that SSID out of the repo, it is a separate and much larger task — a
history rewrite — not this one.

## Decisions

- **D-2 — `docs/` placement.** Chosen precisely because it sits outside
  `usbee@bitcreed.us/`. `gnome-extensions pack` bundles only the extension
  directory plus explicit `--extra-source` paths, so an asset under `docs/`
  provably cannot reach the zip every user installs. A screenshot inside
  the zip is dead weight in every install.
- **D-3 — `## Repository layout` left alone** though it gained a new
  sibling. The section is already a partial enumeration (it omits `LICENSE`,
  `CHANGELOG.md`, `.github/`), so omitting `docs/` is consistent with how it
  already behaves; expanding it is scope this task was not given.
- **D-4 (INFERRED, flagged for audit)** — committed straight to `master`
  with `git.allow_default_branch_commits` still unset, matching every prior
  quick task in this repo.
- **Ordering held.** README repointed *before* the old image was removed, so
  no intermediate state had a reference to a missing file.

## Verification

Every check ran under `rtk proxy` and printed its sentinel:

| Check | Result |
|-------|--------|
| `cmp` against the source capture | `BYTES-IDENTICAL` |
| `file` dimensions | `DIMS-405x851-OK` (8-bit RGBA, non-interlaced) |
| README path resolves to a file on disk | `README-LINK-RESOLVES` |
| README diff size | `README-DIFF-IS-ONE-LINE` (1 insertion, 1 deletion) |
| old image gone from worktree | `OLD-IMAGE-GONE-FROM-WORKTREE` |
| README mentions of old filename | `0` |
| deletion staged | `DELETION-STAGED` |
| 20260514 records modified | `0` — unmodified |
| staged paths | exactly 3: one `A`, one `M`, one `D` |
| commit subject | `COMMIT-SUBJECT-OK` |
| tag `v2.10.0` | `RELEASE-TAG-STILL-AT-8ab685d` |
| commit parent | `NEW-COMMIT-ON-TOP-PARENT-bfbdfcb` |
| paths in HEAD | `3`, `ALL-THREE-EXPECTED-PATHS-PRESENT` |
| `usbee@bitcreed.us` / `CHANGELOG.md` / `po` status | `0` — untouched |

The last two together prove the commit touches nothing under the extension
directory without a negative grep: three paths, all three expected, so no
fourth path of any kind is in it. Both are positive checks, so neither can
false-pass if `git` itself errors.

**Plan assertion corrected.** The plan claimed the new commit's parent would
be `8ab685d`. That was written before the plan's own pre-dispatch commit
landed; HEAD was `bfbdfcb` by execution time, so the parent assertion was
re-pointed at `bfbdfcb` and the tag assertion (`v2.10.0` → `8ab685d`) kept
separately. Both verified. Same class of stale-guard-corrected-rather-than-
waved-through as 260915-mpf's line count and 260917-j6u's changelog regex.

**Constraints honoured:** no push, no fetch, no tag, no reset, no rebase, no
`--amend`. `origin/master` is still at `8ab685d`, exactly where it started.
`git tag -l 'v2.10*'` shows the pre-existing `v2.10.0` and nothing new. No
pack, no install, no Shell restart — no extension code changed, so there is
nothing to rebuild. `.gsd/` and `.planning/quick-batches/` remain untracked;
staging was by explicit path only.

## Deviations from Plan

None to the plan's actions. The one procedural deviation is the privacy
halt described above, which ended in the plan's own option 1 (proceed
unchanged) after the evidence came in — no plan step was altered, skipped,
or added.

## Deferred Observations (Out of Scope — Not Acted On)

Found while reading `README.md`; recorded so they are not lost:

- **`## Status` claims "Current release: v2.0.0"** (README.md:21). The repo
  is at v2.10.0. A separate correction.
- **`## Preferences` names the GSettings schema `us.bitcreed.usbee`**
  (README.md:82). Renamed to `org.gnome.shell.extensions.usbee` in quick
  task 260514-mq0; the README still documents the pre-rename name.
- **`## Repository layout` nests `po/` under `usbee@bitcreed.us/`**
  (README.md:90), but `po/` sits at the repo root.

## Known Stubs

None. This is a docs-only change with no code path, no stub, no skipped
test, and no unrun verification.

## Self-Check: PASSED

- `docs/quick-settings-popover-link-speeds.png` — FOUND (70949 B)
- `README.md` — FOUND, references the new path
- `usbee-quick-settings-panel-device-list.png` — correctly ABSENT
- commit `9e2b9f2` — FOUND in `git log`, parent `bfbdfcb`
- `commits: 1` — MEASURED via `git rev-list --count bfbdfcb..HEAD`, not narrated
