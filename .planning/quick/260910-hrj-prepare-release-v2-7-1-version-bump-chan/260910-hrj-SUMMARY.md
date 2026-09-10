---
phase: 260910-hrj
plan: 01
status: complete
date: 2026-09-10
commits:
  - 116c916  chore: release v2.7.1
  - c6c7d38  docs(quick-260910-hrj): correct the pack/install verification facts
files_modified:
  - usbee@bitcreed.us/metadata.json
  - CHANGELOG.md
  - CLAUDE.md
---

# Quick Task 260910-hrj — Prepare release v2.7.1

Release **prepared, not published**: steps 1–3 of the CLAUDE.md release
process only. No `v2.7.1` tag exists and nothing was pushed
(`master` is 6 ahead of `origin/master`). Tagging is the human's call —
it fires `.github/workflows/release.yml`.

## Task 1 — Version bump + changelog (`116c916`)

`metadata.json`: `version-name` `2.7.0` → `2.7.1`, `version` `11` → `12`.

`git log v2.7.0..HEAD` held six commits, of which **two** touch shipped
code — `683708f` (property panel) and `d6806ed` (empty states). The rest
are `.planning/`, `CLAUDE.md`, and the `cedb4e8` guard test: real work,
but nothing a user sees. So the 2.7.1 section is `### Fixed` with two
bullets, one per user-visible surface, in `[2.3.1]`'s house style
(what the user saw → what they see now → root cause as support).

Both bullets describe the *same* underlying defect — an `St.Label` that
sets `line_wrap` but leaves the stock `PANGO_ELLIPSIZE_END` in place, so
Pango ellipsizes at line one and the wrap never happens. They stayed
separate because the user-visible symptom differs: truncated device
property values vs. truncated daemon setup instructions.

## Task 2 — Local deploy

Packed and installed with the exact CLAUDE.md invocation. Verified on
disk: `"version": 12` / `"version-name": "2.7.1"`, 13 modules under
`src/`. Shell not restarted, user not logged out — 2.7.1 goes live at
their next login, as asked.

**Both documented verification figures turned out to be wrong, and one
of them cost the working tree.** See Task 4.

## Task 3 — Tests

All three suites green, unfiltered via `rtk proxy` (rtk strips
`test result:`-style lines, so a filtered grep would pass vacuously):

| Suite | Assertions | Result |
|---|---|---|
| `dbus-client.test.js` | 66 | ALL TESTS PASSED |
| `daemon-status.test.js` | 87 | ALL TESTS PASSED |
| `forward-compat.test.js` | 152 | ALL TESTS PASSED |

305 assertions, 0 failures.

## Task 4 (unplanned) — Two defects in the documented release procedure (`c6c7d38`)

### 4a. `gnome-extensions install --force` wiped the repo's sources

Immediately after the install, every file under `usbee@bitcreed.us/`
was gone from the working tree and all three test suites died with
`ImportError: Unable to load file`. Recovered in full with
`git checkout -- 'usbee@bitcreed.us/'` — the release commit had landed
minutes earlier, so nothing was uncommitted and nothing was lost. (The
restore is confirmed real, not a sandbox artifact: every restored file
carries mtime `12:49:59`.)

Root cause, **reproduced rather than inferred** — a throwaway
`gsdtest@sandbox.local` extension was symlinked into the extensions
directory, force-installed, and its sentinel file checked:

> `~/.local/share/gnome-shell/extensions/usbee@bitcreed.us` was a
> **symlink into this repo**. `install --force` deletes the *contents of
> the symlink's target* before unpacking, then replaces the symlink with
> a real directory.

Corroborating evidence: the sibling
`paperwm@paperwm.github.com -> /home/blk/projects/gnome/PaperWM` shows
the symlinked-checkout dev setup is this machine's habit, and the
post-install `ls -ld` showed a real directory where a symlink had been.

**Side effect the human must know about:** that symlink is gone. The
installed extension is now a static copy, so editing the repo no longer
changes what the Shell loads. Restore the old workflow with:

```sh
rm -rf ~/.local/share/gnome-shell/extensions/usbee@bitcreed.us
ln -s ~/projects/rust/usbee/usbee@bitcreed.us \
      ~/.local/share/gnome-shell/extensions/usbee@bitcreed.us
```

Left as-is rather than restored unilaterally: the task prescribed the
install command, whose documented outcome *is* a real directory, and
re-creating the symlink would re-arm the same trap for the next release.

### 4b. The zip entry count was stale

CLAUDE.md claimed a correct zip is "21 entries / ~140 KB". The actual
build is **24 entries / 202,869 bytes**. Not a regression — the figure
was recorded at quick task 260822-hkn, and 2.7.0 then added exactly
three modules: `link-verdict.js`, `notify-policy.js` and
`property-policy.js`. The count will keep drifting
with every new module, so the note now says to check that the `src/`
prefix appears at all rather than match a total. The `10 entries /
~29 KB` failure signature is unchanged and still correct.

## For the human

1. **Tag when ready** — `v2.7.1` is deliberately not created.
2. **The dev symlink is gone** (4a). Restore it if you want the old
   edit-and-reload loop back.
3. Nothing else needs a human; every check was executable and was run.
