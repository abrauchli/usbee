---
quick_id: 260910-mes
description: Tag and push the v2.7.1 release
date: 2026-09-10
mode: quick
source_edits: none
---

# Quick Task 260910-mes — Tag and push the v2.7.1 release

Release mechanics only. No source edits are expected or permitted by this
plan. The release procedure is the one in `CLAUDE.md` § Release Process,
which is authoritative; the version bump and changelog (steps 1–3) were
already landed by quick tasks 260910-hrj and 260910-lyx. This task performs
steps 4–5 (tag, push) plus the post-push verification CLAUDE.md leaves
implicit.

Executed inline by the dispatched agent rather than via a worktree-isolated
executor: `git push` / `git tag` operate on the repository, not the working
tree, so worktree isolation adds no safety and would fork the tag off
`origin/HEAD` — a stale ancestor of the commits being released.

## Pre-flight (all must pass before anything is pushed)

1. `usbee@bitcreed.us/metadata.json` has `version-name` exactly `2.7.1` and
   `version` `12`.
2. Working tree clean apart from untracked `.claude/` and `.gsd/`.
3. The release workflow's own changelog extraction yields a non-empty 2.7.1
   section body — `.github/workflows/release.yml` hard-fails otherwise. Use
   the identical awk from that workflow.
4. `git log --oneline origin/master..HEAD` contains only the expected
   commits; no built `.shell-extension.zip`, scratch or secret material in
   the diff.

Any failure stops the task before a push.

## Tasks

### Task 1 — Push master

`git push origin master`. The branch must land before the tag so the tag is
reachable on the remote's default branch.

Done when: `origin/master` is at the local `HEAD`.

### Task 2 — Create the annotated tag

`git tag -a v2.7.1` with subject line `v2.7.1` and the 2.7.1 CHANGELOG
section body as the message body, per CLAUDE.md step 4. The tag name must
match `version-name` exactly — the release workflow asserts this.

Done when: `git tag -v`/`git show v2.7.1` reports the annotated tag with the
changelog body.

### Task 3 — Push the tag and watch the release workflow

`git push origin v2.7.1`, then watch `release.yml` to completion via
`gh run watch` / `gh run list --workflow=release.yml`. Report the real
outcome; a failure is reported with the failing step and log excerpt, never
papered over.

Done when: the workflow run has concluded and its conclusion is recorded.

### Task 4 — Verify the published release

`gh release view v2.7.1` — confirm the release exists and the attached zip
looks right. Per CLAUDE.md the failure signature of a zip that lost `src/`
is 10 entries / ~29 KB; a correct zip is substantially larger with `src/`
present.

Done when: the artifact's size and entry count are confirmed.

## Out of scope

- Uploading to extensions.gnome.org — a manual human step.
- Any change to source, schema, metadata or changelog content.
