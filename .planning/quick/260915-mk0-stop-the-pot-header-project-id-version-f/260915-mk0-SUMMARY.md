---
id: 260915-mk0
slug: stop-the-pot-header-project-id-version-f
date: 2026-09-15
status: complete
commit: d22f85a
---

# Quick Task 260915-mk0 — Summary

The `.pot` template header no longer carries a version number, and the
invocation that generates it no longer emits one, so the field cannot drift
again.

## What changed

| File | Change |
|------|--------|
| `po/usbee@bitcreed.us.pot` | `Project-Id-Version: USBee 2.7.1` → `Project-Id-Version: USBee`. Regenerated, not hand-edited. |
| `CLAUDE.md` | New **Release Process → Regenerating the translation template** subsection carrying the canonical `xgettext` invocation (no `--package-version`), the load-bearing input order, and the no-version policy. The Development Tools row for `xgettext` now points at it instead of showing a generic command. |

## The evidence that nothing consumes the field

Checked before removing anything, every command under `rtk proxy` (the rtk hook
drops lines from filtered output, so an unproxied grep can pass vacuously):

- **`.github/workflows/release.yml`** — reads `version-name` out of
  `metadata.json` to assert the tag matches. It installs `gettext` for
  `gnome-extensions pack`, but never reads, writes or asserts on the `.pot`.
- **`.github/workflows/ci.yml`** — runs EGO's `shexli` against
  `"$PWD/usbee@bitcreed.us"`. `po/` is **outside** that package directory, so
  the linter never even sees the template. The other job runs the four `gjs`
  suites.
- **`tests/`** — four files, none mentioning `.pot`, `Project-Id-Version` or
  `xgettext`.
- **Build scripts** — there are none. No `Makefile`, no `package.json`, no
  `*.sh` anywhere in the repo.
- **Repo-wide** — `grep -rn "Project-Id-Version|package-version|package-name"`
  (excluding `.git`) hit only the template itself and `.planning/` prose.

`msgfmt` and the gettext runtime ignore the field by design; it is a label for
translation platforms (Weblate, Transifex, Damned Lies). USBee is English-only,
on none of them, and not submitted to EGO. So the removal path was taken, not
the keep-and-bump path.

## Decisions

- **D-01 — Removed the number, kept the field.** Target state
  `Project-Id-Version: USBee`. A field nobody reads but everybody must remember
  to bump is a maintenance trap; it had already drifted one release.
- **D-02 — The fix lands in the generating invocation, not only the artifact.**
  Dropping `--package-version` from the recorded `xgettext` command is what
  makes the change durable — otherwise the next regeneration reintroduces
  `2.7.1`'s successor. `CLAUDE.md` is where the forward-looking invocation now
  lives, and the note explicitly tells a future reader not to add the flag back.
- **D-03 — Regenerated rather than hand-edited.** Running the corrected command
  proves it reproduces the target state byte-for-byte, and the repo's own
  standing rule (Phase 04 plan 04-03) is not to hand-edit the template. The cost
  is a second changed header line, `POT-Creation-Date`.
- **D-04 — Historical `.planning/quick/*` records keep their verbatim
  `--package-version=2.7.1` invocations.** They are dated records of what was
  actually run; rewriting them would falsify the provenance trail. Only
  `CLAUDE.md` is read by a future regeneration.
- **D-05 — No `CHANGELOG.md` entry.** Nothing user-visible changed: no string,
  no behaviour, no difference in the packed zip. `## [Unreleased]` was left
  untouched.

## Verification

All under `rtk proxy`.

- **The `.pot` diff is header-only.** `diff -u` against the pre-change file
  shows exactly two changed lines — `Project-Id-Version` and
  `POT-Creation-Date`. No other hunk exists, so **no msgid was added, removed or
  reordered**; the msgid/msgstr body is byte-identical. `grep -c '^msgid '`
  reads **162** before and after, and `msgfmt --check-format` is clean.
- **The corrected invocation was probed before it was recorded.** Running
  `xgettext --from-code=UTF-8 --package-name=USBee …` into a scratch file
  emitted `"Project-Id-Version: USBee\n"`, confirming the field survives without
  the version and that `--package-name` still supplies the package name to the
  license comment on line 3.
- **No `--package-version` survives** outside `.planning/` history and the
  `CLAUDE.md` prose that explains its deliberate absence.
- **483 assertions green across four suites**, zero `FAIL` — dbus-client 66,
  daemon-status 94, forward-compat 266, service-probe 57. Identical to the
  pre-change baseline captured at the start of the task.

## Not verified / not done

- **No Shell restart, no install.** `gnome-extensions install` was deliberately
  not run: `~/.local/share/gnome-shell/extensions/usbee@bitcreed.us` is a real
  directory holding the released v2.8.0, and installing would overwrite the
  user's working install. Nothing in this change is observable at runtime
  anyway — the `.pot` is a translator artifact, and USBee ships no `.mo` files.
- **`metadata.json` untouched** at `13` / `2.8.0`. No tag, no push.

## Notes for audit

- **`260915-ikd` has no row in STATE.md's Quick Tasks Completed table.** The
  previous task updated `stopped_at`, `last_activity_desc` and the Decisions
  list but never appended its table row, so the table ends at `260915-ib9`. Left
  as found rather than reconstructed — inventing a row for another task's work
  risks misstating it. Flagged here so it can be filled from
  `260915-ikd-SUMMARY.md`.
- **Committed straight to `master`** with `git.allow_default_branch_commits`
  still unset in `.planning/config.json` — an unconfigured bypass, inferred from
  every prior quick task doing the same and the standing keep-`master`
  preference.
- **Run inline rather than via spawned planner/executor subagents.** This agent
  was already the dedicated subagent for the task; the workflow's artifacts
  (PLAN, SUMMARY, STATE row, atomic commits) were produced in full.
- **Casing of the package name was resolved empirically, not chosen.** The
  target was specified as package-name-only; what `--package-name=USBee`
  actually emits is `USBee`, and keeping it matches the `# … same license as the
  USBee package` comment the same flag generates.
