---
phase: 01-tile-popover-hotplug-daemon-missing-state-v0-1
fixed_at: 2026-05-12T00:00:00Z
review_path: .planning/phases/01-tile-popover-hotplug-daemon-missing-state-v0-1/01-REVIEW.md
iteration: 2
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-05-12
**Source review:** `.planning/phases/01-tile-popover-hotplug-daemon-missing-state-v0-1/01-REVIEW.md`
**Iteration:** 2

**Summary (this iteration):**
- Findings in scope this iteration: 3 (IN-01, IN-03, IN-04 — the only
  Info findings not already resolved by iteration 1)
- Fixed this iteration: 3
- Skipped: 0

**Cumulative status across iterations 1 + 2:** all 11 findings from
`01-REVIEW.md` are now resolved (1 Critical + 5 Warning fixed in
iteration 1, 3 Info fixed in iteration 2, IN-02 and IN-05 fixed
incidentally during iteration 1's Warning work).

## Fixed Issues (Iteration 2)

### IN-01: `Pango.WrapMode.WORD_CHAR` written as the literal `2`

**Files modified:** `usbee@bitcreed.us/src/popover.js`
**Commit:** 6c1d3f1
**Applied fix:** Imported `Pango` from `gi://Pango` and replaced
`lbl.clutter_text.line_wrap_mode = 2; // Pango.WrapMode.WORD_CHAR`
with `lbl.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR`.
Removes the magic-number / dangling-comment pattern; future Pango ABI
shifts (unlikely but possible) now bind by name, not by ordinal.

### IN-03: Tuple signature comment said `a(sssssasi)` but actual is `a(ssssssasi)`

**Files modified:** `usbee@bitcreed.us/src/device-store.js`
**Commit:** 0c54f2b
**Applied fix:** Corrected both comments (line 15 and line ~194 jsdoc)
from `a(sssssasi)` (5 strings) to `a(ssssssasi)` (6 strings). The
unpacker code already read 6 strings + array + int correctly — only
the comments were wrong. Now the XML, the daemon-side Rust, the
unpacker, and the comments all agree.

### IN-04: `Refresh` and `Diagnose` D-Bus methods declared but never invoked

**Files modified:** `usbee@bitcreed.us/src/dbus-client.js`
**Commit:** cf3c03e
**Applied fix:** Added a comment block immediately above the
`IFACE_XML` template literal explaining that `Refresh` and `Diagnose`
are intentionally unused in Phase 01: they mirror the daemon-side
interface (the XML must match the daemon) and are reserved for Phase 2
(NOTIF-driven re-snapshot and preferences "Diagnose now" per-port
button). Prevents a future cleanup pass from stripping them as dead
code. Comment lives in `dbus-client.js` because the `IFACE_XML` block
there is the runtime-consumed copy and the most likely diff target;
`dbus-iface.xml` remains the on-disk source-of-truth mirror.

## Skipped Issues

None this iteration.

## Out-of-Scope / Previously-Fixed Notes

Already fixed in iteration 1 (see prior iteration entries below the
fold or in git log):

- **CR-01** (commit 9ac363e) — idempotency guard in `_onVanished`
- **WR-01** (commit 4a69006) — registry dispose handle for timeouts
- **WR-02** (commit 92441b7) — `gettext`-wrap all user-visible strings
- **WR-03** (commit 041e41f) — `gNameOwner` null check in re-entrant `_onAppeared`
- **WR-04** (commit 16b68c4) — `add_style_class_name` post-construction
- **WR-05** (commit 7707e0f) — `this._proxy &&` guard + `gNameOwner` camelCase

Incidentally fixed during iteration 1 (rolled into the Warning fixes):

- **IN-02** — dead `'Starting…'` literal removed in commit 92441b7
  (WR-02 i18n pass) when `tile.js` was already being touched.
- **IN-05** — `g_name_owner` → `gNameOwner` camelCase access applied
  in both call sites in commits 041e41f (WR-03) and 7707e0f (WR-05).

All 11 findings from `01-REVIEW.md` are now resolved across the two
iterations.

---

_Fixed: 2026-05-12_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
