---
phase: quick-260822-hkn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - CLAUDE.md
autonomous: true
requirements: [QT-260822-hkn]

estimate:
  tokens: 8000
  raw_tokens: 4000
  tasks: 1
  confidence: high

must_haves:
  truths:
    - "CLAUDE.md records the full pack invocation including --podir and both --extra-source flags, and names .github/workflows/release.yml as the source of truth it must stay identical to."
    - "CLAUDE.md warns that a wrong --extra-source path is silently ignored (pack exits 0, prints nothing) and gives the unzip -l check that catches it."
    - "CLAUDE.md documents the local install command, that install compiles the gschema itself, and the on-disk metadata.json verification."
    - "CLAUDE.md states that gnome-extensions info reports the previously loaded version until the Shell restarts, and that this is expected rather than a failed install."
  artifacts:
    - path: "CLAUDE.md"
      provides: "### Packing and local install (development) subsection under ## Release Process"
---

# Quick Task 260822-hkn — Document the pack + local install procedure

## Why

Installing the freshly pulled v2.6.0 locally hit an avoidable failure: a
guessed `--extra-source=lib` produced a 10-entry zip with no `src/` at
all. `gnome-extensions pack` exited 0 and printed nothing, so the broken
zip looked like a success. The correct invocation existed only inside
`.github/workflows/release.yml`, which is not where anyone looks before
running a local install.

## Task 1 — Add the packing/local-install subsection to CLAUDE.md

Insert a `### Packing and local install (development)` subsection under
`## Release Process`, before `### Steps for a new release`.

Content requirements:
- The canonical command, matching `.github/workflows/release.yml` verbatim.
- Why `--extra-source=src` is mandatory (pack's default file set omits it)
  and why `dbus-iface.xml` is deliberately not packed (IFACE_XML is inlined
  in `src/dbus-client.js`; the root file is the byte-equal reference copy).
- The silent-failure warning + `unzip -l` verification, with the observed
  entry counts (21 correct / 10 missing-src).
- `gnome-extensions install --force`, schema auto-compilation, on-disk
  `metadata.json` check.
- The `gnome-extensions info` staleness caveat and the Shell restart step.

## Verification

- `grep -n "extra-source=src" CLAUDE.md` returns a hit.
- The documented command is character-identical to the workflow step at
  `.github/workflows/release.yml:33-38` (modulo indentation).
