---
quick_id: 260910-nge
slug: integrate-the-link-capability-quick-task
date: 2026-09-10
mode: quick
---

# Quick Task 260910-nge — Integrate the link-capability branch into master

Two quick tasks ran in parallel and must now be integrated:

- **`master`** — `260910-myu` (9 commits, `4f88621`..`9104b2e`): daemon-state
  probe (`src/service-probe.js`), wrapping + selectable command row, prefs
  three-state UI with a Start button, a Pango markup escaping fix, new
  `tests/service-probe.test.js` wired into CI.
- **`worktree-agent-a204e501d63277c81`** — `260910-n10` (5 commits,
  `11907fd`..`af358da`): splits the property panel's `Link` row into `Link` +
  `Capability`, adds `deriveShowCapability()` in `src/link-verdict.js`, drops
  `(USB 2.1)` from the Link row.

Both forked from `ceb643e` (the v2.7.1 release commit).

This is **integration, not review**. Neither task's decisions get re-litigated.
If the two tasks conflict in *intent* rather than in text, stop and report.

## Constraints

- No version bump, no tag, no push. `metadata.json` stays at `2.7.1` / `12`.
- Do NOT restart the Shell.
- `.pot` is never hand-merged — it is regenerated after the code merge.

## Tasks

### Task 1 — Merge the branch

Merge `worktree-agent-a204e501d63277c81` into `master` with an explicit merge
commit (`--no-ff`). `usbee@bitcreed.us/src/popover.js` was touched by both sides
but the branch's edits are confined to `buildLinkBlock()` and its docstring —
verify that it merges cleanly rather than assuming it.

Two conflicts are predicted:

- **`CHANGELOG.md`** — both sides added prose under the same `## [Unreleased]`
  header. Resolve by keeping **both** sets of entries merged into one coherent
  section: master's `### Added` + `### Fixed` (from `260910-myu`) and the
  branch's `### Changed` (from `260910-n10`). Order them
  Added / Changed / Fixed per the file's stated "loosely follows Keep a
  Changelog". Drop nothing.
- **`po/usbee@bitcreed.us.pot`** — both sides regenerated it. Do NOT hand-merge;
  take either side to close the conflict, then regenerate in Task 2.

Verify no source file was silently mangled: the merge must preserve
`deriveShowCapability()`, the `Capability` row, `src/service-probe.js` and the
prefs Start button.

**Verify:** `git diff --name-only --diff-filter=U` is empty after resolution;
`git log --oneline` shows both task lineages.

### Task 2 — Regenerate the `.pot`

Reproduced and confirmed against master's committed template: the invocation is

```sh
xgettext --from-code=UTF-8 --package-name=USBee --package-version=2.7.1 \
  -o po/usbee@bitcreed.us.pot \
  usbee@bitcreed.us/prefs.js usbee@bitcreed.us/src/*.js
```

Input file order is load-bearing — `prefs.js` comes first. Regenerating with
`src/*.js` first reorders every msgid block in the output and produces a
spuriously huge diff.

Note master's committed `.pot` is already stale on line references: it was
generated at `9f09baa`, before `da4ad71` added ~7 lines to `prefs.js`. The
regeneration will correct those refs; that is expected, not a loss.

**Verify:** `msgfmt --check-format` passes; the regenerated msgid set is the
union of both branches' msgid sets with nothing dropped (compare sorted msgid
lists against both parents).

### Task 3 — Verify the integration

Run all four suites through `rtk proxy` so output is unfiltered:

```sh
gjs -m tests/dbus-client.test.js
gjs -m tests/daemon-status.test.js
gjs -m tests/forward-compat.test.js
gjs -m tests/service-probe.test.js
```

Confirm by inspection that both tasks' artifacts survived the merge.

**Verify:** all four suites pass with real, reported numbers.

### Task 4 — Pack and install locally

Per CLAUDE.md. **Run the `ls -ld` pre-flight first** — if
`~/.local/share/gnome-shell/extensions/usbee@bitcreed.us` is a symlink into this
repo, `install --force` deletes through it and wipes the repo's sources.

```sh
gnome-extensions pack usbee@bitcreed.us \
  --podir=../po --extra-source=src --extra-source=icons --force
unzip -l usbee@bitcreed.us.shell-extension.zip
gnome-extensions install --force usbee@bitcreed.us.shell-extension.zip
```

Expect ~25-26 entries now that `service-probe.js` exists. Verify the on-disk
`metadata.json` reads `2.7.1` / `12` — untouched.

**Do NOT restart the Shell.**

**Verify:** zip contains the `src/` prefix and ~25-26 entries; on-disk
`metadata.json` unchanged.
