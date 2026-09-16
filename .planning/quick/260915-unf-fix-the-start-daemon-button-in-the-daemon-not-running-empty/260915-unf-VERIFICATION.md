---
phase: quick-260915-unf
verified: 2026-09-15T23:20:00Z
status: human_needed
score: 6/6 must-haves verified
covered_files:
  - ".planning/quick/260915-unf-fix-the-start-daemon-button-in-the-daemon-not-running-empty/260915-unf-PLAN.md"
  - ".planning/quick/260915-unf-fix-the-start-daemon-button-in-the-daemon-not-running-empty/260915-unf-SUMMARY.md"
  - "CHANGELOG.md"
  - "po/usbee@bitcreed.us.pot"
  - "tests/daemon-status.test.js"
  - "usbee@bitcreed.us/src/empty-state.js"
  - "usbee@bitcreed.us/src/popover.js"
  - "usbee@bitcreed.us/stylesheet.css"
covered_digest: "v1:sha256:e081020d5c9586e5ef9bfb1cd474c530eb81b0044f5ee3399ebb489afc747e01"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Restart GNOME Shell (Wayland: full re-login), stop usbeehived, open the USBee tile in the LIGHT theme."
    expected: "The 'Start usbeehive daemon' button renders as an accent-filled chip with full-contrast text — not grey, and with a visible button shape."
    why_human: "The popover only re-renders inside gnome-shell after a restart; no in-session surface renders this widget."
  - test: "Repeat the above in the DARK theme."
    expected: "Same accent-filled, full-foreground reading."
    why_human: "Same restart constraint; light/dark is a theme-resolution outcome not observable from source."
  - test: "With the daemon stopped, press the Start button and watch the label."
    expected: "Label becomes 'Starting…' and the chip goes visibly dimmer than its enabled state (theme dims accent-fg to 50%/60% over a darkened/lightened accent ground)."
    why_human: "Requires a live click inside the Shell process; St resolves the :insensitive pseudo-class at runtime."
  - test: "Confirm the default stopped view shows no terminal command, then click the 'Show details' row."
    expected: "Default view is title + body + Start button only; expanding reveals the hint line, the monospace `systemctl --user enable --now usbeehived` chip and its copy button, which still copies the raw command."
    why_human: "Collapsed/expanded submenu state and the clipboard write need the live Shell."
---

# Quick Task 260915-unf: Fix the Start-daemon button in the "daemon not running" empty state — Verification Report

**Goal:** Make the start-daemon button read as an enabled clickable action in both light and dark GNOME themes, and move the inline raw systemctl command behind a collapsible "Show details" disclosure using only the documented PopupMenu/St surface, with every user-visible string through gettext.

**Verified:** 2026-09-15
**Status:** human_needed — all six must-haves structurally verified; four visual truths are unobservable without a GNOME Shell restart and are recorded as **owed/pending-restart**, not as gaps (standing operator direction).
**Re-verification:** No — initial verification.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Button label renders at full theme foreground in light and dark; no longer inherits the insensitive dim | ✓ VERIFIED (structural) | `empty-state.js:289` `style_class: 'button default usbee-start-button'`. I extracted the live theme from `/usr/share/gnome-shell/gnome-shell-theme.gresource` myself: `.button` carries an **explicit** `color: #ffffff` (dark `th-dark.css:63-65`) / `color: #222226` (light `th-light.css:63-65`), and `.button.default` adds `color: -st-accent-fg-color` (both themes, `:151-153`). Either declaration defeats the inherited `.popup-menu-item:insensitive` dim (`:968-970`, `st-transparentize(#ffffff,0.5)` dark / `st-transparentize(#222226,0.6)` light). Cure mechanism independently confirmed, not merely claimed. |
| 2 | Pressing it produces a visibly dimmer "Starting…" state, distinguishable from enabled | ✓ VERIFIED (structural) | `empty-state.js:312-313` sets `button.reactive = false` and `label = _('Starting…')`. St maps `reactive:false` → `:insensitive`; theme `.button.default:insensitive` (`:168-170`) = `st-transparentize(-st-accent-fg-color, 0.5)` over `st-darken(-st-accent-color, 3%)` dark, `0.6` over `st-lighten(...)` light — **genuinely distinct** from enabled (`-st-accent-fg-color` over `-st-accent-color`). The old local override, which reused the exact 50% dim the enabled state already inherited (so idle and in-flight looked identical), is gone. Pinned by test `daemon-status.test.js:500-501`. |
| 3 | Visible chip background in the light theme, not only dark | ✓ VERIFIED (structural) | `.button.default` background is `-st-accent-color` — an opaque accent fill, theme-resolved, in light as well as dark (`th-light.css:151-153`). Bare `.button` fallback is `st-mix(#222226, #fafafb, 12%)` in light, also opaque. The two retired white overlays (`rgba(255,255,255,0.12)` base, `0.2` hover), invisible against light's near-`#fafafb` popover, are absent from live CSS — negative-asserted comment-stripped at `daemon-status.test.js:508-510`. |
| 4 | Raw `systemctl --user enable --now usbeehived` absent from default view, reachable in one click behind "Show details" | ✓ VERIFIED | `SYSTEMCTL_CMD` (`empty-state.js:76`) has exactly **one** consumer: `buildCommandRow(SYSTEMCTL_CMD)` at `:442`, inside `buildEmptyStateDetailsItem()`. `buildEmptyStateItem()` (`:364-387`) is now title + body + `buildStartRow()` only — no command row, no hint. Disclosure is a `PopupMenu.PopupSubMenuMenuItem(_('Show details'), false)` (`:420`) holding a non-reactive `PopupBaseMenuItem` wrapper (`:427-445`). Guarded per-function (not file-wide) via the `functionBody` slicer at `daemon-status.test.js:426-431`. |
| 5 | Every user-visible string through gettext; `.pot` regenerated canonically | ✓ VERIFIED | New strings all wrapped: `_('Show details')` `:420`, `_('Starting…')` `:313`, hint `_('Or start it yourself, …')` `:441`. No concatenation of translated output — the two multi-line strings concatenate **literals inside** `_()` (`:331-333`, `:381-382`), which xgettext handles. `.pot` carries `Show details` (line 299) with ref `empty-state.js:420` — matches the real line. `Project-Id-Version: USBee` with no version (line 9). `msgfmt --check-format` clean. |
| 6 | All four gjs suites pass at or above baseline | ✓ VERIFIED | I ran each suite once myself under `rtk proxy`: dbus-client **74**, daemon-status **138**, forward-compat **292**, service-probe **57** = **561**. All four print `ALL TESTS PASSED`; zero `FAIL` / `not ok` matches. Exceeds the plan's 483 baseline (+78; +26 this item, remainder from siblings). |

**Score:** 6/6 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `usbee@bitcreed.us/src/empty-state.js` | Theme classes on button; new disclosure builder | ✓ VERIFIED | Class string `:289`; `buildEmptyStateDetailsItem()` exported `:416-448`; 34-line STYLING docstring `:227-274`. |
| `usbee@bitcreed.us/stylesheet.css` | All three `.usbee-start-button` rules removed | ✓ VERIFIED | Zero `.usbee-start-button` declarations; a comment block `:43-64` stands in their place naming each retired declaration and the bug it caused. `.usbee-empty-state-start` `:37-41` and `-status` `:70-73` intact. |
| `usbee@bitcreed.us/src/popover.js` | Imports and mounts both items | ✓ VERIFIED | Import `:25-27`; `populateEmptyState` `:537-541`. |
| `tests/daemon-status.test.js` | Structural guards, CSS comments stripped | ✓ VERIFIED | New sections `:383-458` and `:472-519`; `cssCode()` comment-stripper `:82-84`; `functionBody()` slicer `:69-75`. |
| `po/usbee@bitcreed.us.pot` | Regenerated, new msgid | ✓ VERIFIED | 164 msgids live (163 at item time + 1 from sibling `ung`, per batch context — not a gap). |
| `CHANGELOG.md` | `### Fixed` under `## [Unreleased]` | ✓ VERIFIED | Two user-facing entries `:11-23`, prose register consistent with 2.9.0. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `buildStartRow()` button | Shell theme `.button` / `.button.default` | `style_class` string | ✓ WIRED | Both classes confirmed present in the installed theme with explicit `color` — the link that cures the dim. |
| `populateEmptyState()` | both empty-state items | `section.addMenuItem` ×2 | ✓ WIRED | Sibling order enforced: `clearSection` → state item → disclosure (`popover.js:538-540`), asserted by index ordering at `daemon-status.test.js:453-457`. |
| `tile.js` | `populateEmptyState` | default branch of install-state switch | ✓ WIRED | `tile.js:316` — the stopped state genuinely reaches the new code; the disclosure is not orphaned. |
| tests | `empty-state.js` + `stylesheet.css` source text | `readSource` + `cssCode` | ✓ WIRED | Negative assertions run on comment-stripped CSS, so the explanatory prose naming old values cannot vacuously satisfy them. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| disclosure command chip | `SYSTEMCTL_CMD` | module constant `:76` | Yes — real command string, copy button copies it raw | ✓ FLOWING |
| Start button action | `startDaemonUnit` | async D-Bus `StartUnit` | Yes — no subprocess, unchanged by this task | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Four suites green | `gjs -m tests/*.test.js` ×4 | 74 / 138 / 292 / 57, all `ALL TESTS PASSED` | ✓ PASS |
| `.pot` well-formed | `msgfmt --check-format` | clean | ✓ PASS |
| `buildCommandRow(` count unchanged | `grep -c` | 5 (call moved, not added/removed) | ✓ PASS |
| `metadata.json` untouched | `git diff 5e6ad7f..2927519` | empty | ✓ PASS |
| Theme mechanism exists | `gresource extract` + grep | `.button` colour, `.button.default` accent, distinct `:insensitive` — all present in dark, light and high-contrast (8 matches) | ✓ PASS |
| Button renders as enabled on screen | — | needs Shell restart | ? SKIP → human |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TODO/FIXME/XXX/TBD/HACK/PLACEHOLDER in any modified file | — | None |
| `empty-state.js` | 229-269 | Theme line citations drift ~2-3 lines from measurement (`:60`→`:63-65`, `:148`→`:151-153`, `:166`→`:168-170`, `:967`→`:968-970`; `.quick-settings .button` `:2061`→`:2064`) | ℹ️ Info | Substance of every cited rule confirmed correct. Only the positions are slightly off — they appear to cite the `color:` line under a different extraction offset. Cosmetic; the docstring exists so a maintainer can re-find these rules, and a ±3-line drift does not impede that. Not worth a fix commit on its own. |

Documented-API check: no `Main.panel._*` and no private `St._*` in either modified module. The single `_delegate` grep hit (`popover.js:352`) is a pre-existing explanatory comment about Shell's own `_getMenuItems()`, untouched by this item.

### Gaps Summary

**None.** Every mechanically checkable must-have holds in the committed tree. Notably, the two claims most likely to have been narrative rather than real — that the theme carries an explicit `color` defeating the inherited dim, and that `.button.default:insensitive` makes the in-flight state genuinely dimmer — I confirmed independently by extracting the installed gresource rather than trusting the SUMMARY, which had itself corrected the plan's citations. Both hold in dark, light and high-contrast.

The `.pot` msgid count reads 164 rather than the plan's asserted 163 because sibling item `260915-ung` legitimately added one msgid after this item ran; this item's own `Show details` msgid is present and correctly referenced. Per batch context, not a gap.

---

_Verified: 2026-09-15_
_Verifier: Claude (gsd-verifier)_
