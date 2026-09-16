---
quick_id: 260915-unf
phase: quick-260915-unf
plan: 01
status: complete
subsystem: popover / empty-state
tags: [ui, theming, gettext, gnome-shell, quick-task]

requires:
  - src/empty-state.js buildStartRow / buildCommandRow / buildWrappedLabel
  - src/popover.js populateEmptyState
  - GNOME Shell theme classes `.button` / `.button.default`
provides:
  - src/empty-state.js buildEmptyStateDetailsItem() — collapsed "Show details" disclosure
  - a theme-correct Start button that reads as enabled in light and dark
affects:
  - the "daemon not running" popover state only; no daemon, wire-format or settings change

tech-stack:
  added: []
  patterns:
    - Borrow the Shell theme's own style classes instead of hardcoding a colour pair (St's CSS subset has no variables and no prefers-color-scheme, so a literal colour cannot be right in both themes).
    - PopupSubMenuMenuItem as a sibling disclosure in a section, with a non-reactive PopupBaseMenuItem wrapping an St.BoxLayout for content.
    - Per-function source slicing in structural tests, so an assertion about WHICH function renders a widget cannot be satisfied by another function in the same file.

key-files:
  created: []
  modified:
    - usbee@bitcreed.us/src/empty-state.js
    - usbee@bitcreed.us/src/popover.js
    - usbee@bitcreed.us/stylesheet.css
    - tests/daemon-status.test.js
    - po/usbee@bitcreed.us.pot
    - CHANGELOG.md

decisions:
  - Reused the theme classes `button default` rather than naming any colour in USBee's stylesheet (D-A).
  - Implemented the disclosure as a PopupSubMenuMenuItem sibling, not a hand-rolled St.Button expander (D-B).
  - Only the stopped state hides its command; the other three keep theirs (D-C).
  - The hint line travelled into the disclosure with the command (D-D).
  - Committed straight to master with git.allow_default_branch_commits unset (D-E) — inferred, flagged for audit.

metrics:
  commit_span: "3m 46s (22:53:51 -> 22:57:37 -0600, first to last commit)"
  total_duration: "not instrumented — no start timestamp was captured; bounded above by ~42m since the PLAN file was written at 22:15:52"
  completed: 2026-09-15
  tasks: 3
  files: 6
  assertions: "509 (66 / 120 / 266 / 57)"

actuals:
  tokens: 6565          # chars/4 over the realized diff (26,262 chars of changed-line content)
  tokens_scale_note: "Measured chars/4 over the actual diff, per the executor contract. The plan's estimate.tokens of 60000 is NOT on this scale — 60000 tokens would be ~240 KB of diff for what is a 399/-89-line change — so the two numbers are not comparable and the gap should not be read as a 9x overestimate of the change itself."
  tasks: 3
  commits: 3            # MEASURED: git rev-list --count 5e6ad7f..HEAD
  plan_head_before: 5e6ad7f1bbd85fd7fd11be5831665c073f4ef0f8
---

# Quick Task 260915-unf: Fix the Start-daemon button in the "daemon not running" empty state — Summary

The Start button now borrows the Shell theme's own `button default` classes, so it renders at full
theme foreground with an accent fill instead of the 50 % dim that made a working button look
deactivated — and the raw `systemctl` line it used to print in full moved one click away behind a
collapsed "Show details" disclosure, so the panel leads with the action rather than a terminal
command.

## What Changed

### Task 1 — the button reads as an enabled action in both themes
`fix(quick-260915-unf): make the Start-daemon button read as enabled in both themes` — **b993b83**

- `usbee@bitcreed.us/src/empty-state.js:281` — the button's `style_class` became
  `'button default usbee-start-button'`, with an inline comment warning against shortening it.
- `usbee@bitcreed.us/src/empty-state.js:215-260` — a new STYLING section in `buildStartRow()`'s
  docstring records the whole causal chain (non-reactive ancestor → `:insensitive` → inherited
  `color`) and names every theme selector involved, with verified positions.
- `usbee@bitcreed.us/stylesheet.css:43-66` — all three `.usbee-start-button` rules deleted,
  replaced by a comment block that names each retired declaration and the bug it caused.
- `tests/daemon-status.test.js:319-371` — 9 new guards.

The JS behaviour was already correct and is untouched: the button is still `reactive: true`,
`can_focus: true`, still an async `StartUnit` D-Bus call via `startDaemonUnit`, still watchdogged,
and still disables itself by assigning `reactive = false`.

### Task 2 — the systemctl line moved behind "Show details"
`feat(quick-260915-unf): move the systemctl line behind a "Show details" row` — **62e185e**

- `usbee@bitcreed.us/src/empty-state.js:376-437` — new exported `buildEmptyStateDetailsItem()`:
  a `PopupSubMenuMenuItem` labelled `_('Show details')` (built with `wantIcon` false, so `.icon` is
  never touched), holding a non-reactive `PopupBaseMenuItem` wrapper around a vertical
  `St.BoxLayout` with the hint label and `buildCommandRow(SYSTEMCTL_CMD)`.
- `usbee@bitcreed.us/src/empty-state.js:365-373` — `buildEmptyStateItem()` lost those two children;
  it is now title + body + Start button.
- `usbee@bitcreed.us/src/popover.js:24-26, 222-243` — imports the new builder and adds both items in
  `populateEmptyState`, state item first, `removeAll()` still first of all.
- `tests/daemon-status.test.js:266-339` — 17 new guards, several sliced per-function.

`buildCommandRow(` still occurs **exactly 5 times** in the file — the call moved, it was not added
or removed, so the pre-existing count-of-5 assertion stayed green unmodified.

### Task 3 — template, changelog, full suite
`chore(quick-260915-unf): regenerate the translation template and log the fix` — **2927519**

- `po/usbee@bitcreed.us.pot` — regenerated with the canonical invocation (`prefs.js` first, no
  `--package-version`). **162 → 163 msgids.** Apart from `POT-Creation-Date` and the one new
  `Show details` block, the entire diff is `#:` line references shifting.
  `Project-Id-Version: USBee` with no version number, as mandated. `msgfmt --check-format` clean.
- `CHANGELOG.md:9-22` — a `### Fixed` pair under `## [Unreleased]`, +14/-0.

## Verification

| Check | Result |
|---|---|
| dbus-client.test.js | 66 — ALL TESTS PASSED |
| daemon-status.test.js | **120** — ALL TESTS PASSED (94 baseline + 9 + 17) |
| forward-compat.test.js | 266 — ALL TESTS PASSED |
| service-probe.test.js | 57 — ALL TESTS PASSED |
| **Total** | **509**, against the 483 baseline (+26) |
| `.pot` msgids | 163 |
| `msgfmt --check-format` | clean |
| `Project-Id-Version` | `USBee`, no version |
| `.usbee-start-button` declarations outside comments | 0 |
| `buildCommandRow(` occurrences | 5 |
| `metadata.json` | untouched at 14 / 2.9.0 (last changed by the v2.9.0 release commit) |
| tags / push | no new tag (newest still v2.8.0); nothing pushed; `origin/master..HEAD` = 13 |
| syntax | `node --check` clean on both modified ES modules |

All test commands ran under `rtk proxy`, and the pass signal used was the literal string
`ALL TESTS PASSED` — rtk's filtering strips lines from test output, so a grep-based gate can
otherwise pass vacuously. (One such vacuous case did occur mid-run: a trailing `grep '^ FAIL'`
matching nothing returned exit 1 while all four suites had passed. The `ALL TESTS PASSED` signal is
what settled it.)

**A syntax check was added beyond the plan**, because the suites only read these files as *text* —
`empty-state.js` imports `resource:///` URIs and cannot be loaded under bare gjs — so a syntax
error would have satisfied every structural assertion silently. Both modules were copied to `.mjs`
and passed `node --check`.

## The plan's theme citations were wrong, and were corrected

The plan's root-cause analysis is **correct in substance**, but every line number it cited is off,
so I re-extracted `gnome-shell-{dark,light,high-contrast}.css` from
`/usr/share/gnome-shell/gnome-shell-theme.gresource` (Shell **50.1**) and verified each claim
before writing it into a docstring. Corrected positions, now cited in the code:

| Claim | Plan said | Actually (50.1) | Verified value |
|---|---|---|---|
| `.button` shape | :56-60 | **:43** | `border-radius: 8px; padding: 3px 24px; font-weight: bold` |
| `.button` colour | :63-65 | **:60** | `color: #ffffff` dark / `#222226` light — **the explicit colour the whole fix rests on** |
| `.button.default` | :150-153 / :151-153 | **:148** (both themes) | `color: -st-accent-fg-color; background-color: -st-accent-color` |
| `.button.default:insensitive` | not cited | **:166** | `st-transparentize(-st-accent-fg-color, 0.5)` dark / `0.6` light, over a darkened/lightened accent ground |
| `.popup-menu-item:insensitive` | :968-970 | **:967** | `st-transparentize(#ffffff, 0.5)` dark / `st-transparentize(#222226, 0.6)` light |
| `.button.default` in high-contrast | "8 matches" | **8 matches** ✓ | — |

Two findings beyond the plan:

1. **`.quick-settings .button` (:2061) overrides the padding to `10.5px`.** The plan did not mention
   it. It is more specific than `.button`, and our button lives inside Quick Settings, so it wins.
   Harmless — that is the padding the Shell's own Quick Settings buttons carry — but it means the
   button is chunkier than `.button`'s `3px 24px` alone would suggest. Recorded in the docstring.
2. **No selector collisions, confirmed by parsing rather than grepping.** Every rule whose selector
   list contains a standalone `.button` token was enumerated: only `.unlock-dialog .button` and
   `.quick-settings .button` are descendant-scoped, and there is no `.popup-menu .button` or
   `.popup-menu-item .button` override. `.default` never appears standalone — always compounded
   (`.button.default`, `.icon-button.default`, `.keyboard-key.default-key`).

## Deviations from Plan

**No behavioural deviations.** The three tasks were executed as written. Two additions, both
documentation- or verification-only:

1. **[Rule 1 — Bug] The plan's theme line numbers were wrong and would have become wrong comments.**
   Found during Task 1, before writing the docstring. The plan's cited `.button` colour position
   (`:63-65`) actually holds `.button:focus`, and `.button` at the plan's implied location is
   `min-height: 1.5em` only — a reader following the citation would have concluded the fix could not
   work. Corrected against the installed theme as tabled above. Files: `src/empty-state.js`.
   Commit: b993b83.
2. **[Rule 2 — Missing verification] Added a syntax check of the two modified modules.** The plan's
   verification is entirely source-text assertions, which cannot detect a syntax error in files that
   no suite loads. Verification-only; no source change.

## Threat Model Outcomes

| Threat ID | Disposition | Outcome |
|---|---|---|
| T-unf-01 | mitigate | Preserved verbatim. The clipboard write still takes the module constant `SYSTEMCTL_CMD`; only the call site moved. Nothing daemon- or user-supplied interpolates into it. |
| T-unf-02 | mitigate | Preserved. `buildCommandRow` was not edited at all, so its `destroy` handler still removes every in-flight `GLib.timeout`. The submenu child is destroyed with the section on rebuild, so the T-ke2-04 contract holds. |
| T-unf-03 | accept | `_('Show details')` and the disclosure content are static module text; no daemon data is rendered there. |
| T-unf-04 | accept | Unchanged — async `StartUnit` to the user's own systemd. No subprocess, no new privilege. |
| T-unf-SC | accept | No package install introduced. Pure GJS, no dependency change. |

No new security-relevant surface: no new network endpoint, auth path, file access or schema change.

## Known Stubs

None. No placeholder values, no TODO/FIXME, no skipped tests introduced.

## Notes for Audit (inferred — the operator was unavailable)

Beyond the plan's own D-A…D-F, which were all honoured:

- **I-1 — Builder name.** The plan specified "an exported builder" without naming it; chose
  `buildEmptyStateDetailsItem()`, mirroring the existing `buildEmptyStateItem()`.
- **I-2 — Disclosure box style class.** Gave the inner `St.BoxLayout` the existing
  `usbee-empty-state-body` class, so the hint and command inherit the same 8 px rhythm they had in
  the default view. No new CSS was added.
- **I-3 — Commit type for Task 3.** `chore`, not `docs`: the change is a regenerated artifact plus a
  changelog entry.
- **I-4 — Committed straight to `master`** with `git.allow_default_branch_commits` still unset,
  matching every prior quick task in this repo and the coordinator's instruction. Flagged, as every
  prior task has flagged it.
- **I-5 — No `.planning/WINDOWS.md` entry** was created. The batch coordinator scoped my writes to
  source/test/po/CHANGELOG plus this SUMMARY, and creating a new cross-phase planning artifact sits
  outside that remit. The one owed item is recorded below instead.

## Owed to the Human

- **Visual confirmation is pending a GNOME Shell restart, and is genuinely not obtainable this
  session.** The popover only re-renders after a Shell restart (Xorg `Alt+F2` → `r`; Wayland a full
  re-login), so the three user-visible claims — the button reading as enabled in light *and* dark,
  the visibly dimmer "Starting…" state, and the collapsed/expanded disclosure — were verified
  **structurally**, not on screen: the theme rules that cause and cure the dim were read from the
  installed gresource and cited by position, and the class string plus the colour-free stylesheet
  are pinned by test. This restart debt is now accumulated across 260915-i4w, -ikd, -mpf and -unf.
- **Cross-version caveat worth one honest sentence.** The classes were verified against Shell
  **50.1** only, which is what this machine runs. `metadata.json` declares `46`/`47`/`48`, and the
  fallback argument for those — that bare `.button` carries an explicit `color`, so the worst case
  on a theme lacking the `.default` accent rule is an ordinary-looking button rather than a dim one
  — was **not** verified against a 46/47/48 theme, because none is installed here. The argument is
  sound (nothing depends on `.default` existing) but it rests on `.button` carrying a colour in
  those themes too.
- Non-regression noted while checking: the disclosure's content matches
  `.popup-sub-menu .popup-menu-item:insensitive` (:1015), i.e. the command text is dimmed inside the
  submenu — exactly as it already was inside the non-reactive `PopupMenuItem` (:967) before the
  move. The monospace chip keeps its own dark background either way, so this is unchanged in kind.

## Self-Check: PASSED

- Commits exist: b993b83, 62e185e, 2927519 — all FOUND in `git log --all`.
- Files exist: all six modified files FOUND.
- Claims re-verified in the committed tree: class string present (1), `.usbee-start-button`
  declarations outside comments (0), `.pot` msgids (163).
- Working tree clean of tracked modifications after the final commit.
