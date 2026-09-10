---
quick_id: 260910-mes
description: Tag and push the v2.7.1 release
date: 2026-09-10
status: complete
tag: v2.7.1
release_url: https://github.com/abrauchli/usbee/releases/tag/v2.7.1
workflow_run: 34535975902
source_edits: none
---

# Quick Task 260910-mes — Tag and push the v2.7.1 release

Release mechanics only. No source, schema, metadata or changelog content
changed; the version bump and changelog landed earlier under 260910-hrj and
260910-lyx. This task performed CLAUDE.md § Release Process steps 4–5 plus
post-push verification.

## Pre-flight

All four checks passed before anything was pushed.

1. `usbee@bitcreed.us/metadata.json` — `version-name` `2.7.1`, `version`
   `12`. Correct.
2. Working tree clean apart from untracked `.claude/` and `.gsd/`.
3. The release workflow's own awk extraction returned a non-empty 2.7.1
   section body — 39 lines, `### Fixed` plus three bullets (the connector-hint
   withdrawal, the property-panel wrapping fix, and the nine empty-state
   labels). Section boundaries confirmed correct: the extraction starts after
   `## [2.7.1] — 2026-09-10` (line 11) and stops before `## [2.7.0]` (line 51),
   and `[2.7.1]:` has its reference link at line 570.
4. Ten commits ahead of `origin/master`, all belonging to the 2.7.1 line.
   Fifteen files changed — planning artifacts, CHANGELOG, CLAUDE.md, the
   `.pot`, one test and four extension sources. No `.shell-extension.zip`,
   no secrets, nothing tracked matching zip/env/secret.

## What was done

### Task 1 — Push master

`git push origin master`: `dc6561e..e34e0d8`.

### Task 2 — Create the annotated tag

`git tag -a v2.7.1` with subject `v2.7.1` and the CHANGELOG 2.7.1 body.

**One thing worth recording for the next release.** The first attempt used
`git tag -a -F <file>`, whose default `--cleanup=strip` treats every
`#`-leading line as a comment — it silently ate the `### Fixed` markdown
header out of the tag message. The tag was recreated (unpushed at that
point, so free) with `--cleanup=verbatim`, which preserves it. Also note
`-m` and `-F` cannot be combined: the subject line has to be prepended to
the message file. This is cosmetic for the published notes — the workflow
builds those from `CHANGELOG.md`, not from the tag — but the tag is a
permanent artifact and should read correctly.

### Task 3 — Push the tag, watch the workflow

`git push origin v2.7.1`, then `gh run watch 34535975902 --exit-status`.
Run concluded **success** in 33s; every step green — metadata/tag version
assertion, pack, notes extraction, release creation. The only annotation is
the generic `actions/checkout@v4` Node 20 deprecation notice, unrelated to
this release.

### Task 4 — Verify the published release

<https://github.com/abrauchli/usbee/releases/tag/v2.7.1> exists with
`usbee@bitcreed.us.shell-extension.zip` attached (75,691 bytes compressed).
Downloaded and listed: **24 entries, 204,819 bytes uncompressed**, with
`src/` present and all thirteen modules in it, plus `schemas/`, `icons/`,
`extension.js`, `prefs.js`, `stylesheet.css` and `metadata.json`. This
matches the "24 entries / ~198 KB (13 modules under `src/`)" signature
260910-hrj corrected CLAUDE.md to, and is not the 10-entry / ~29 KB
`src/`-lost failure signature.

`locale/` is present but empty. That is expected, not a packaging fault:
`po/` holds only the `.pot` template with no translated catalogues, so
`--podir` has nothing to compile. It becomes worth checking only once a
real translation lands.

## Verification

- Tag: `v2.7.1`, annotated, on `e34e0d8`, pushed.
- Workflow run 34535975902: success.
- Release artifact: 24 entries / 204,819 B, `src/` intact.

## Out of scope

Uploading to extensions.gnome.org — a manual human step, deliberately not
performed.
