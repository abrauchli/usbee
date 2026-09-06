---
phase: quick-260822-hkn
plan: 01
subsystem: project-docs
status: complete
tags: [docs, packaging, local-install, gnome-extensions]

requires: []
provides:
  - "CLAUDE.md ### Packing and local install (development) — canonical pack command, silent-failure warning, install + verification steps"
affects:
  - "CLAUDE.md"

tech-stack:
  added: []
  patterns:
    - "Document the CI-verified command in CLAUDE.md and name the workflow file as its source of truth, so local and release builds cannot drift"

key-files:
  created: []
  modified:
    - "CLAUDE.md"

decisions:
  - "Placed under ## Release Process rather than the ## Installation / Project Layout section — that section's code fences were stripped when CLAUDE.md was generated, leaving bare headers, so it is not a reliable home for a command that must stay copy-pasteable."
  - "Documented the entry-count signature (21 vs 10) rather than only the byte size, because `unzip -l` shows both and the entry count is the unambiguous tell that src/ is missing."
  - "Recorded why dbus-iface.xml is absent from the zip, since its absence otherwise reads as the same class of bug as the missing src/ and would invite a spurious --extra-source=dbus-iface.xml."
  - "Called out the `gnome-extensions info` staleness explicitly — it reports the previously loaded version until the Shell restarts, which is the most likely thing to be misread as a failed install."

metrics:
  files_changed: 1
  commits: 1
---

# Quick Task 260822-hkn — Summary

## What happened

Installing the freshly pulled v2.6.0 locally failed silently first: a
guessed `--extra-source=lib` produced a 10-entry zip containing no `src/`
modules, and `gnome-extensions pack` reported success (exit 0, no output).
The correct invocation existed only in `.github/workflows/release.yml`.

CLAUDE.md now carries that invocation verbatim, the reason each flag is
required, the `unzip -l` check that catches the silent failure, and the
local install + on-disk verification steps.

## Verification

- `sed`-extracted command block from CLAUDE.md diffs clean against
  `.github/workflows/release.yml:34-38` (whitespace-normalised).
- The stale `usbee@bitcreed.us.shell-extension.zip` was removed from the
  repo root. It was already `.gitignore`d (`.gitignore:3`), so its removal
  is not part of any commit.

## Follow-ups

- None. The extension itself was untouched; v2.6.0 is installed on disk
  and awaits the user's Shell restart.
