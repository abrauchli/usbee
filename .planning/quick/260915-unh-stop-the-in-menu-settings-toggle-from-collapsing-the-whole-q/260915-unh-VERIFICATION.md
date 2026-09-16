---
phase: 260915-unh-stop-the-in-menu-settings-toggle-from-collapsing-the-whole-q
verified: 2026-09-15T23:55:00Z
status: human_needed
score: 7/10 must-haves verified
covered_files:
  - ".planning/quick/260915-unh-stop-the-in-menu-settings-toggle-from-collapsing-the-whole-q/260915-unh-PLAN.md"
  - ".planning/quick/260915-unh-stop-the-in-menu-settings-toggle-from-collapsing-the-whole-q/260915-unh-SUMMARY.md"
  - "CHANGELOG.md"
  - "tests/daemon-status.test.js"
  - "tests/forward-compat.test.js"
  - "usbee@bitcreed.us/src/popover.js"
  - "usbee@bitcreed.us/src/tile.js"
covered_digest: "v1:sha256:2a8be9129a715579c41c5cd33ea2c34deb20045b894ff073577b56a42e58fe6f"
behavior_unverified: 3
overrides_applied: 0
behavior_unverified_items:
  - truth: "Clicking any of the four Options switches with the mouse leaves the Quick Settings popover OPEN."
    test: "Restart the Shell (Xorg: Alt+F2 -> r; Wayland: re-login). Open the USBee tile, expand Options, click a switch with the mouse."
    expected: "The switch flips, the GSettings key changes, and the Quick Settings panel stays open."
    why_human: "Lives inside gnome-shell; the activation chain cannot be executed outside the Shell process. Structurally verified: USBeeSwitchMenuItem.activate() (popover.js:427-435) toggles and returns without chaining to super.activate(), so 'activate' is never emitted and PopupMenuBase.itemActivated() -> _getTopMenu().close() is never reached."
  - truth: "After a filter toggle, a device row that was expanded is STILL expanded, and the scroll position is unchanged."
    test: "With the popover open, expand a device row, scroll the list, then toggle a filter switch."
    expected: "The expanded panel stays expanded, the scroll offset holds, and only rows the filter affects appear/disappear."
    why_human: "Requires a live Shell. Structurally verified: the filter handler no longer calls _rebuildPopover() while RUNNING+loaded; updateDeviceRowsInPlace() never calls removeAll()/clearSection() and only calls buildDeviceRow() for devices absent from the live row set."
  - truth: "Toggling show-technical-details swaps the technical rows inside an already-open detail panel without collapsing it."
    test: "Expand a device row, then toggle Show technical details."
    expected: "The property rows change while the panel stays open and correctly sized."
    why_human: "Rests on an upstream claim that is not readable on this machine (PopupSubMenu.removeAll() leaves isOpen untouched; submenu natural height after an open animation). Recorded by the executor as reasoned-not-seen; the clipping risk is documented, not mitigated."
human_verification:
  - test: "Shell restart, then: click an Options switch with the mouse."
    expected: "Popover stays open; the key is written exactly once."
    why_human: "Unobservable without a Shell restart."
  - test: "Shell restart, then: expand a row, scroll, toggle a filter."
    expected: "Expansion and scroll offset survive; header counts still match visible rows."
    why_human: "Unobservable without a Shell restart."
  - test: "Shell restart, then: expand a row and toggle Show technical details."
    expected: "Rows swap in place; the open panel is not collapsed or clipped."
    why_human: "Depends on submenu relayout behaviour that cannot be read or executed here."
advisory:
  - finding: "tests/daemon-status.test.js:456 check name still reads 'after removeAll' although the located literal is now clearSection(section)."
    category: other
    reason: "Cosmetic label drift only; the asserted ordering is unchanged. Resolve by rewording the check name."
    evidence_status: "none provided"
  - finding: "tests/forward-compat.test.js:679 regex was loosened to accept either clearSection(section) or section.removeAll() as populateLoadingState's first statement."
    category: other
    reason: "Intent (emptying is the FIRST statement) still enforced, but the alternation now also passes for a future regression that bypasses the chokepoint in that one function. Tightening to clearSection(section) only would restore the stricter pin."
    evidence_status: "none provided"
  - finding: "updateDeviceRowsInPlace re-runs populateDeviceRowMenu on rows it just inserted when show-technical-details changed."
    category: other
    reason: "Newly inserted rows were already built with the new showTech value, so the refill is redundant work on a closed submenu. Harmless; no behavioural defect."
    evidence_status: "none provided"
---

# Quick Task 260915-unh Verification Report

**Goal:** Stop the in-menu settings toggle from collapsing the Quick Settings popover — toggling a setting must leave the menu open and the device list expanded, updating affected rows in place rather than tearing down and rebuilding the sections, preserving submenu open/expanded state, using documented PopupMenu API only.

**Verified:** 2026-09-15T23:55:00Z
**Status:** human_needed (3 Shell-restart-owed behaviour items; 0 gaps)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Clicking an Options switch leaves the popover OPEN | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `popover.js:427-435` — `USBeeSwitchMenuItem extends PopupMenu.PopupSwitchMenuItem`, `activate(_event) { this.toggle(); this._usbeeOnActivate?.(this.state); }`. No `super.activate` anywhere in the class, so `'activate'` is never emitted and the Shell's AFTER handler → `itemActivated()` → `_getTopMenu().close()` chain is cut. Rows constructed as `new USBeeSwitchMenuItem(` at `popover.js:483`. Runtime unobservable without Shell restart. |
| 2 | Expanded row stays expanded; scroll position unchanged after a filter toggle | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `tile.js:186-220` filter loop no longer calls `_rebuildPopover()` on the RUNNING+loaded path; `updateDeviceRowsInPlace` (`popover.js:285-384`) contains no `removeAll()`/`clearSection()` and calls `buildDeviceRow` only inside the insert loop, gated on `present.has(device.id)` — surviving rows are provably never re-created. Runtime unobservable without Shell restart. |
| 3 | Header device/issue counts still match the rows actually visible | ✓ VERIFIED | Single `_setHeader(n, issues)` copy at `tile.js:350-359`, called from both `_rebuildPopover()` (`tile.js:334`) and the filter handler (`tile.js:217`). Counts are derived from the same `visibleDevices()` array that produced the rows (`popover.js:380-383`), and `_setHeader` is skipped when the update returns `null` (`tile.js:216`). |
| 4 | show-technical-details swaps rows inside an open panel without collapsing it | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `popover.js:371-378` refreshes surviving rows via `populateDeviceRowMenu(row, device, flags.showTech)` only when `section._usbeeShowTech !== flags.showTech`; `populateDeviceRowMenu` (`popover.js:728-729`) starts at `row.menu.removeAll()`, which per upstream leaves `isOpen` untouched. That upstream property is not readable on this machine and is recorded as reasoned-not-seen. |
| 5 | Prefs↔popover two-way binding still works, no write loop | ✓ VERIFIED | `popover.js:498-517`: `writeKey` = `if (syncing) return;` → `if (settings.get_boolean(key) === state) return;` → `settings.set_boolean(key, state);`. Settings→row path sets `syncing = true` around `row.setToggleState(value)` and early-returns on `row.state === value`. Both entry points (the `toggled` signal at :504 and `row._usbeeOnActivate` at :508) run behind the same latch, so feedback is structurally impossible. |
| 6 | A filter toggle during 260915-ung's `Loading…` window changes nothing | ✓ VERIFIED | Layer 1: `tile.js:204` `if (this._store.awaitingFirstSnapshot === true) return;` — getter exists at `device-store.js:347`. Layer 2: `populateLoadingState` (`popover.js:556-565`) routes through `clearSection`, which nulls `_usbeeOwnedItems` (`popover.js:54`), so the ownership gate's `!Array.isArray(owned)` test (`popover.js:304`) returns `null` before any read of `_usbeeRows` — the `_('No USB devices attached')` delegation at :318 is unreachable in that state. Both claimed protections exist and hold as pure data checks (no timing dependence). |
| 7 | updateDeviceRowsInPlace never touches a row it did not put on screen | ✓ VERIFIED | Identity-and-order gate at `popover.js:302-309` runs before every mutation and before `_usbeeRows` is read. Chokepoint complete: `section.removeAll()` appears exactly once in executable code (`popover.js:52`, inside `clearSection`); 7 `clearSection(section)` call sites at :208, :538, :560, :576, :589, :604, :621 = all seven `populate*` functions. `_usbeeRows`/`_usbeeOwnedItems` are the same array (`:258-259`), so splices keep the token exact. |
| 8 | The GSettings key is written even if `toggle()` never emits `'toggled'` | ✓ VERIFIED | `row._usbeeOnActivate = writeKey` (`popover.js:508`) invoked unconditionally by the override (`popover.js:433`). Idempotence guard at `:500` makes the two entry points compose to exactly one write on every path. |
| 9 | Four suites pass; forward-compat assertion count strictly greater than before this item | ✓ VERIFIED | Measured: dbus-client 74, daemon-status 138, forward-compat 292, service-probe 57 = **561**, `FAIL`=0 in all four, 4× `ALL TESTS PASSED`. Static `check(` count forward-compat **264 → 283 (+19)** vs `e37ed78` (the pre-unh HEAD); daemon-status 137 → 137 (one-literal change). This task's own guard block carries **17** `check(` sites (gate ≥12). |
| 10 | No user-visible string added/removed/reworded; `po/` untouched | ✓ VERIFIED | `git diff 8e99394^..HEAD -- po/` empty. Diff of `src/*.js` adds and removes **zero** `_('…')` code lines. Scratch regeneration with the canonical CLAUDE.md invocation: sorted msgid list **byte-identical** to `po/usbee@bitcreed.us.pot` (`diff` clean), **164 msgids**. |

**Score:** 7/10 truths verified (3 present, behaviour-unverified — all three Shell-restart-owed by construction, per the operator's standing direction they are recorded as owed, not as gaps)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `usbee@bitcreed.us/src/popover.js` | Switch subclass, chokepoint, in-place update, extractions | ✓ VERIFIED | +~430 lines; `USBeeSwitchMenuItem`, `clearSection`, `readFilterFlags`, `visibleDevices`, `attachAccordionHandler`/`detachAccordionHandler`, `updateDeviceRowsInPlace` (exported), `populateDeviceRowMenu`. Parses: `ImportError`=1 for `resource:///`, `SyntaxError|ReferenceError`=0; `node --check` OK. |
| `usbee@bitcreed.us/src/tile.js` | Forget shim, `_setHeader`, rewired filter loop | ✓ VERIFIED | `forgetSubMenuShim` at :87-93 covering both hosts; `_setHeader` at :350; filter loop at :186-220 with both gates. Parses clean; `node --check` OK. |
| `tests/forward-compat.test.js` | New guard block + two updated pins | ✓ VERIFIED | 17-check block headed exactly `# a settings toggle keeps the popover open and the list expanded (260915-unh)`, positive `includes` only, provenance comment inside the block. Old pins replaced at :694/:696 and :730/:732. |
| `CHANGELOG.md` | Two user-facing bullets under `[Unreleased]` | ✓ VERIFIED | "Changing a setting from inside the popover no longer closes it." and "Changing a filter no longer collapses the device list." in the existing `### Fixed` section; `## [2.9.0]` untouched. |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `USBeeSwitchMenuItem.activate()` | Shell's menu-closing chain | Override toggles + returns; no `super.activate` in file | ✓ WIRED (chain cut) |
| `row._usbeeOnActivate` | GSettings write | `= writeKey` at `popover.js:508`, called at `:433` | ✓ WIRED |
| `tile.js` filter handler | `updateDeviceRowsInPlace()` | `tile.js:211-212`, replacing the old `_rebuildPopover()` one-liner | ✓ WIRED |
| `store.awaitingFirstSnapshot` | tile.js early return | `tile.js:204` `=== true`; getter `device-store.js:347` | ✓ WIRED |
| `section._usbeeOwnedItems` | `section._getMenuItems()` | Identity+order loop `popover.js:302-309`, before any mutation | ✓ WIRED |
| `clearSection(section)` | every `removeAll()` call site | 7/7 `populate*` functions incl. ung's `populateLoadingState`; 1 `removeAll()` in code | ✓ WIRED |
| `row._usbeeDeviceId` | `device.id` | `popover.js:703` in `buildDeviceRow`; consumed at :341, :358, :373 | ✓ WIRED |
| `section._usbeeRows` | accordion handler | `popover.js:145` iterates the live list, not a captured array | ✓ WIRED |
| `section._usbeeForgetSubMenu` | `_openedSubMenu` field | `tile.js:87-93` shim; called `popover.js:205` (rebuild path) and `:343` (in-place removal) | ✓ WIRED |
| `syncing` latch | both write entry points | `popover.js:499` inside `writeKey`, shared by signal and hook | ✓ WIRED (intact, upgraded comment) |

### Private-Surface Audit (documented-API rule)

| Identifier | In code or comment | New since `5e6ad7f`? | Verdict |
|------------|--------------------|----------------------|---------|
| `section._getMenuItems()` (`popover.js:196`, `:303`) | code | No — baseline `popover.js:59` used it identically | ✓ pre-existing |
| `_openedSubMenu` / `_setOpenedSubMenu` (`tile.js:70-75`, `:89-90`) | code | No — baseline `tile.js:65-70`; the new lines write only the field USBee's own shim created | ✓ USBee-owned |
| `_delegate`, `_getTopMenu`, `_switch`, `_onToggled`, `_connectItemSignals`, `_init` | **comments only** in `popover.js` | comment text only | ✓ no code access |
| `_usbeeDeviceId`, `_usbeeRows`, `_usbeeOwnedItems`, `_usbeeShowTech`, `_usbeeOnActivate`, `_usbeeForgetSubMenu` | code | Yes | ✓ USBee-owned `_usbee*` convention |

**No new Shell-private surface was introduced.** The only Shell-private read in executable code is `_getMenuItems()`, which existed at the batch baseline in the same file for the same purpose.

### Scope / Diff Surface

`git diff --name-only 8e99394^..HEAD` → 5 files: `CHANGELOG.md`, `tests/daemon-status.test.js`, `tests/forward-compat.test.js`, `usbee@bitcreed.us/src/popover.js`, `usbee@bitcreed.us/src/tile.js` (+595 / −95).

**Judgement on the declared 5th-file deviation (D-A) — ACCEPTED, intent preserved.** The single changed line is `tests/daemon-status.test.js:453`: `populate.indexOf('section.removeAll()')` → `populate.indexOf('clearSection(section)')`. The assertion it feeds is unchanged:
`check('populateEmptyState adds state item then disclosure, after removeAll', iRemove !== -1 && iState > iRemove && iDisc > iState)`. The original intent — *the section is emptied FIRST, then the state item, then the disclosure (Pitfall C)* — is enforced exactly as before, against the literal that is now the teardown. `populateEmptyState` (`popover.js:537-541`) does begin with `clearSection(section)`. Nothing was deleted, no `check(` was dropped (daemon-status static count 137 → 137; runtime 138 ok / 0 fail). The rejected alternative — exempting `populateEmptyState` from the chokepoint — would have put a hole in the invariant that truth 7 rests on, so letting a test literal dictate the architecture would have been the worse call. Not weakened; correctly flagged for audit.

### Cross-Item Protections (the blocker this plan was revised to close) — BOTH HOLD

1. **tile.js semantic gate:** `tile.js:204` `if (this._store.awaitingFirstSnapshot === true) return;` sits after the `isOpen` check and *before* the `daemonState` branch and the `updateDeviceRowsInPlace` call. The getter exists (`device-store.js:347`), so the `=== true` form is live rather than vacuous.
2. **popover.js structural ownership gate:** because `populateLoadingState` routes through `clearSection` (`popover.js:560`) and `clearSection` sets `_usbeeOwnedItems = null` (`:54`), the gate's `!Array.isArray(owned)` test short-circuits to `return null` at `:305`. The `Loading…` row is therefore never closed, destroyed, or replaced by `_('No USB devices attached')` — and the row inventory can never outlive its rows, since the only way to empty a section also drops the inventory. Independent of the first layer, exactly as D-6 claims.

### Behavioural / Structural Spot-Checks

| Behaviour | Command | Result | Status |
|-----------|---------|--------|--------|
| Four suites green | `gjs -m tests/{dbus-client,daemon-status,forward-compat,service-probe}.test.js` | 74/138/292/57 = 561 ok, 0 FAIL, 4× ALL TESTS PASSED | ✓ PASS |
| Both modules parse | `gjs -m src/popover.js`, `src/tile.js` | ImportError=1, SyntaxError/ReferenceError=0 each | ✓ PASS |
| Syntax (loaded form) | `node --check` on `.mjs` copies | OK both | ✓ PASS |
| Chokepoint complete | grep `removeAll()` / `clearSection(section)` | 1 executable `removeAll()`; 7 call sites | ✓ PASS |
| This item's guard block | `sed` region + `grep -c 'check('` | 17 (gate ≥12) | ✓ PASS |
| String invariance | scratch `xgettext` + sorted msgid `diff` | identical, 164 ≡ 164 | ✓ PASS |
| `po/` untouched by item | `git diff 8e99394^..HEAD -- po/` | empty | ✓ PASS |
| `metadata.json` untouched | `git diff --quiet 5e6ad7f..HEAD -- metadata.json` | clean | ✓ PASS |
| Release hygiene | `git tag -l 'v2.9*'`; `rev-list origin/master..HEAD` | 0 tags; 20 local commits, nothing pushed | ✓ PASS |
| Popover-open / expansion / scroll | (requires Shell restart) | not runnable | ? SKIP → human |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` in any of the 5 modified files | — | none |

### Gaps Summary

**No gaps.** Every mechanically checkable must-have holds against the actual code, not the SUMMARY narrative: the activation chain is cut at the source level, the in-place path never tears the section down, the chokepoint is complete at 7/7 call sites, the ownership gate is total, the double-write is idempotent, no new Shell-private surface was added, `po/` is untouched at 164 msgids, and all four suites are green at 561 assertions with forward-compat strictly up (+19).

The three headline user-visible truths are **owed, not failed** — they are unobservable outside a running Shell, exactly as the plan's own "Not verifiable in this session" section predicted, and the operator's standing direction is to record them as pending-restart. They are the only reason this report is `human_needed` rather than `passed`.

Shell-restart debt now spans i4w, ikd, mpf, unf, ung and unh.

---

_Verified: 2026-09-15T23:55:00Z_
_Verifier: Claude (gsd-verifier)_
