---
phase: 260910-hrj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - usbee@bitcreed.us/metadata.json
  - CHANGELOG.md
autonomous: true
requirements: [QUICK-260910-hrj]
---

# Quick Task 260910-hrj — Prepare release v2.7.1

Prepare (but do not publish) the v2.7.1 patch release, then deploy the
resulting build locally so the fix is live at the user's next login.

**Scope boundary (explicit, from the request):** steps 1–3 of the
CLAUDE.md release process only. Do **not** create the `v2.7.1` git tag
and do **not** push — tagging fires `.github/workflows/release.yml` and
publishes a GitHub Release. Stop at the `chore: release v2.7.1` commit.

## Unreleased inventory (`git log v2.7.0..HEAD`)

| Commit | Kind | User-facing? |
|---|---|---|
| `fc3c574` docs(quick-260822-hkn): document pack + local install | CLAUDE.md only | no |
| `a9acf34` docs(STATE): record commit hash 260822-hkn | `.planning/` only | no |
| `683708f` fix(popover): wrap property-panel values | `src/popover.js` | **yes** |
| `d6806ed` fix(empty-state): pair line_wrap with ellipsize reset | `src/empty-state.js` | **yes** |
| `cedb4e8` test(quick-260910-ggy): guard the pairing | `tests/` | no |
| `16ab1b7` docs(quick-260910-ggy) | `.planning/` only | no |

So two user-facing fixes, both of the same class (`line_wrap` inert
because `St.Label`'s stock `PANGO_ELLIPSIZE_END` wins), across two
distinct surfaces: the device property panel and the four daemon empty
states. Nothing else is unreleased that a user would notice. A
`### Fixed`-only patch section is the right shape — matches `[2.3.1]`
and `[2.2.1]`.

## Tasks

### Task 1 — Version bump + changelog + commit

- **files:** `usbee@bitcreed.us/metadata.json`, `CHANGELOG.md`
- **action:**
  1. `metadata.json`: `version-name` `2.7.0` → `2.7.1`, `version`
     `11` → `12`. No other field changes.
  2. `CHANGELOG.md`: insert `## [2.7.1] — 2026-09-10` between
     `## [Unreleased]` and `## [2.7.0]`, with a `### Fixed` block
     carrying one bullet per user-facing surface, written in
     user-facing terms (what the user saw, what they see now) with the
     root cause as supporting detail — the house style in `[2.3.1]`.
     Add `[2.7.1]: https://github.com/abrauchli/usbee/releases/tag/v2.7.1`
     as the first entry of the reference-link block at the bottom.
- **verify:** `node -e 'require("./usbee@bitcreed.us/metadata.json")'`
  parses; `grep -n '^## \[2.7.1\]' CHANGELOG.md` and
  `grep -n '^\[2.7.1\]:' CHANGELOG.md` both hit.
- **done:** committed as `chore: release v2.7.1` (source files only —
  the orchestrator commits `.planning/` artifacts separately).
- **NOT done:** no `git tag`, no `git push`.

### Task 2 — Pack and install locally

- **files:** none tracked (build artifact is gitignored)
- **action:** run the exact CLAUDE.md pack invocation
  (`--podir=../po --extra-source=src --extra-source=icons --force`),
  then `gnome-extensions install --force`.
- **verify (both mandatory, both reported):**
  - `unzip -l usbee@bitcreed.us.shell-extension.zip` → expect **21
    entries / ~140 KB** uncompressed. **10 entries / ~29 KB is the
    failure signature** (`src/` dropped); a wrong `--extra-source`
    exits 0 silently, so zip contents are the only real signal.
  - `grep '"version' ~/.local/share/gnome-shell/extensions/usbee@bitcreed.us/metadata.json`
    → must read `2.7.1` / `12`.
- **done:** both checks pass and are quoted verbatim in the report.
- **Expected, not a bug:** `gnome-extensions info` still reports the
  previously loaded version until the Shell restarts. Do not "fix" it.
- **NOT done:** do not restart the Shell, do not log the user out.

### Task 3 — Test suite sanity

- **action:** run every suite under `tests/` via `rtk proxy` so output
  is unfiltered (rtk strips `test result:`-style lines, which would
  make a pass/fail grep succeed vacuously).
- **done:** results reported honestly, including any failure.

## Must-haves

- `metadata.json` reads `2.7.1` / `12` and still parses as JSON.
- `CHANGELOG.md` has a `[2.7.1]` section **and** its reference link.
- Exactly one source commit, subject `chore: release v2.7.1`.
- No tag exists; nothing pushed.
- Installed extension on disk is 2.7.1 with `src/` present in the zip.
