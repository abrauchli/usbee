---
quick_id: 260916-2qs
slug: fold-the-unreleased-changelog-entries-in
date: 2026-09-16
status: complete
commit: c7850c6
tag: v2.9.0
---

# Quick Task 260916-2qs — Summary

Folded the `[Unreleased]` fixes into `## [2.9.0]`, then tagged and pushed
v2.9.0. **No version string changed anywhere** — the bump had already
landed in `2098719`.

## Fold, not bump — and why the instruction to "bump" did not apply

The task arrived worded as a normal release ("bump the version, then tag
and push", next semver sized from the `[Unreleased]` body). The repo said
otherwise, and the repo was right:

- `2098719 chore: release v2.9.0` had **already** bumped
  `metadata.json` 13 → **14** and 2.8.0 → **2.9.0**. The bump this task
  was told to perform existed.
- That release was deliberately left **untagged and unpushed**
  (260915-mpf, "held back at the user's instruction, so the GitHub
  Release stays the user's to trigger"). `git ls-remote --tags` confirmed
  the newest published tag was still `v2.8.0`; `master` was **21 commits**
  ahead of `origin/master`.
- The five `[Unreleased]` bullets are fixes the 2.9.0 build **already
  contains** — they landed on commits after the release commit but before
  any release existed.

Sizing a *new* version off that body would have cut **2.9.1** whose only
difference from 2.9.0 is a changelog edit, and would have stranded the
`[2.9.0]:` reference link already sitting at CHANGELOG.md:741 pointing at
`releases/tag/v2.9.0` — a URL that would then 404 permanently. Folding
makes the already-built 2.9.0 label truthful. Nothing named 2.9.0 had
ever been published, so no released artifact's notes were rewritten.

## What was done

1. **CHANGELOG.md** — the working tree already held the fold (five
   `### Fixed` bullets moved out of `[Unreleased]` into `[2.9.0]` after
   `### Removed`, Keep a Changelog order). Verified as **pure movement**
   before committing: deleted lines sorted are byte-identical to added
   lines sorted, so 0 words of prose changed. `## [Unreleased]` left
   present and empty, byte-for-byte the shape `2098719` left.
2. **Committed `CHANGELOG.md` alone** (`c7850c6`), explicit path — never
   `git add -A`. `.gsd/` and `.planning/quick-batches/` stayed untracked
   as the plan required.
3. **Tagged** `v2.9.0`, annotated, body = the `[2.9.0]` section.
4. **Pushed** `master` (`be622b8..c7850c6`) then the tag.

## Trap caught: git ate the markdown headers

The first tag attempt lost **all four `### Added/Changed/Removed/Fixed`
headers**. Git's default message cleanup strips lines beginning with `#`
as comments, and every Keep a Changelog subsection header is exactly
that. The tag was verified rather than assumed — `git cat-file tag v2.9.0 |
grep -c '^###'` returned **0** — so the tag was deleted and recreated with
**`--cleanup=verbatim`**. It now carries all 4 headers and all 11 bullets.

This matters beyond cosmetics: the same body is what a reader sees on the
tag, and any future release script that reuses a tag message this way
will hit the identical silent truncation.

## Verification before pushing

| Gate | Result |
|---|---|
| Tracked tree clean of unintended changes | CLEAN (only `CHANGELOG.md` was ever staged) |
| `version-name` == tag name | `2.9.0` == `v2.9.0` — the assertion in `release.yml` passes |
| CHANGELOG section header matches version | `## [2.9.0] — 2026-09-15` present |
| Tag points at HEAD | yes (`c7850c6`) |
| `version` integer | `14`, untouched |

The release workflow's own notes extractor was **simulated locally**
(same `awk` as `release.yml`) before committing: it yields a well-formed
72-line section with 4 subsections and 11 bullets. `## [Unreleased]`
sorts above `## [2.9.0]`, so the extractor skips it rather than tripping
on it.

## Date kept at 2026-09-15

The section keeps its original date though today is 2026-09-16. All six
post-release commits are dated 2026-09-15; the date names when the work
landed, not when the tag was cut.

## Isolation

Ran **sequentially on the main working tree**. `worktree.base-check`
reported `shouldDegrade=true` (HEAD `f27529c` vs stale `origin/HEAD`
`be622b8`), and the workflow's own #1941 guard degrades on that. Tagging
and pushing must happen on the real checkout regardless.

## Outstanding / inferred

- **Committed straight to `master`** with `git.allow_default_branch_commits`
  still unset — inferred, consistent with every prior quick task in this
  project, flagged for audit.
- **GNOME Shell restart still outstanding**, now accumulated across i4w,
  ikd, mpf and this task. v2.9.0 is on disk but nothing is verifiable
  through the live tile. Not addressed here: the plan puts
  `gnome-extensions install` out of scope, since `--force` can delete
  through a symlink into this repo (260910-hrj).
- The `[Unreleased]` heading is left empty and with no compare link, as
  the file has never carried an `[Unreleased]:` link.
