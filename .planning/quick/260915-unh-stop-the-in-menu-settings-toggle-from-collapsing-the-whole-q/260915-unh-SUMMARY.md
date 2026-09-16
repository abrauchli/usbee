---
quick_id: 260915-unh
slug: stop-the-in-menu-settings-toggle-from-collapsing-the-whole-q
date: 2026-09-15
status: complete
batch_mode: quick-batch
batch_id: 260915-une
depends_on: [260915-ung]
tasks_completed: 3
tasks_total: 3
commits: 3
plan_head_before: e37ed7816854d69f6df5cd2f764333683d174e83
isolation: none  # operator-mandated single working tree; all three batch items collide on the same files
branch: master
files_modified:
  - usbee@bitcreed.us/src/popover.js
  - usbee@bitcreed.us/src/tile.js
  - tests/forward-compat.test.js
  - CHANGELOG.md
  - tests/daemon-status.test.js  # DEVIATION — 5th file, see Deviations D-A
metrics:
  assertions_before: 542   # 74 / 138 / 273 / 57
  assertions_after: 561    # 74 / 138 / 292 / 57
  assertions_added: 19
  pot_msgids_before: 164
  pot_msgids_after: 164
  insertions: 595
  deletions: 95
actuals:
  tokens: 9214    # chars/4 over the realized diff (36,859 chars)
  tasks: 3
  commits: 3      # MEASURED: git rev-list --count e37ed78..HEAD
estimate_delta: >
  Plan estimated 105,000 tokens (raw_tokens 52,500) at confidence low; realized
  diff measures 9,214 on the chars/4-over-diff scale — an ~11x overestimate.
  Recorded unflattered. Note the scale ambiguity honestly: chars/4 over the
  FULL changed files is 53,439, which lands within 2% of the plan's raw_tokens
  52,500. If the plan's estimate scale was whole-file rather than diff, the
  estimate was in fact close to exact. Future calibration should fix the scale
  before concluding the estimate was wrong.
---

# Quick Task 260915-unh — Keep the popover open (and the list expanded) when a setting is toggled

Two independent causes, both fixed: an Options switch no longer dismisses the
Quick Settings popover, and a filter change no longer collapses the device list
underneath it. The switch row is a `PopupSwitchMenuItem` subclass whose
`activate()` toggles and stops instead of chaining to the Shell's
menu-closing default; the filter path now reconciles rows in place, keyed on
`device.id`, behind an identity-and-order ownership gate that makes it provably
safe rather than argued-safe.

## Commits

| Task | Commit | Subject | Key change |
|------|--------|---------|------------|
| 1 (tracer) | `8e99394` | `fix(quick-260915-unh): stop an Options switch from dismissing the popover` | `USBeeSwitchMenuItem` at `popover.js:157-205`; rows constructed at `popover.js:281`; signal-independent `writeKey` / `_usbeeOnActivate` at `popover.js:288-305` |
| 2 | `e644acb` | `fix(quick-260915-unh): update the device list in place when a filter changes` | `clearSection` `popover.js:51`; `readFilterFlags`/`visibleDevices` `popover.js:68-135`; `attachAccordionHandler` `popover.js:139-160`; `updateDeviceRowsInPlace` `popover.js:286-380`; `populateDeviceRowMenu` `popover.js:728`; forget shim `tile.js:76-93`; `_setHeader` `tile.js:337`; filter loop `tile.js:196-236` |
| 3 | `511c7d4` | `test(quick-260915-unh): pin the open popover and the in-place list, and log it` | 17 guards under the `260915-unh` header in `tests/forward-compat.test.js`; two `### Fixed` bullets in `CHANGELOG.md` |

## Verification — what was actually measured

All commands run under `rtk proxy` (rtk's filters strip test output, which would
make a pass/fail grep succeed vacuously).

| Gate | Result |
|------|--------|
| Four suites | **74 / 138 / 292 / 57 = 561**, 0 failures, all four `ALL TESTS PASSED` |
| Baseline for comparison | 74 / 138 / 273 / 57 = 542 (coordinator's figures confirmed by re-measurement, not trusted) |
| This task's own guard block | **17** `check(` call sites (gate: ≥12) |
| Both modules parse | `popover.js` / `tile.js`: `ImportError`=1 for `resource:///`, `SyntaxError|ReferenceError`=**0** |
| Syntax (sibling practice) | `node --check` on `.mjs` copies of all four edited files — all OK. These modules are never *loaded* by any suite, so a syntax error would pass every structural gate silently |
| `po/` untouched | `git diff --quiet -- po/` passes; **164 msgids** before and after |
| No string churn | Scratch regeneration's sorted msgid list **byte-identical** to before (`diff` clean, 164 ≡ 164) |
| `metadata.json` | unchanged since batch baseline `5e6ad7f` |
| Chokepoint complete | `section.removeAll()` appears **once** in code (inside `clearSection`); **7** `clearSection(section);` call sites |
| Release hygiene | 0 `v2.9*` tags; nothing pushed; no `gnome-extensions install` run |

### One nuance on the `.pot` gate, recorded rather than smoothed over

The plan predicted the whole-template diff would show `POT-Creation-Date` as its
only difference. It does not: ~50 `#:` **source-line reference** lines shift
(e.g. `popover.js:476` → `popover.js:190`), which is the unavoidable consequence
of inserting ~340 lines of code and comment above those strings. No msgid, no
msgstr, no string added, removed or reworded — the sorted-msgid-list equality is
the authoritative proof and it is exact. Critically, `po/` was **not**
regenerated, so this drift lives only in the scratch file and never reaches the
repo. The plan's stated expectation was simply incomplete; the invariant it
existed to protect holds.

## Deviations from plan

**D-A — [Rule 3, blocking] A fifth file: `tests/daemon-status.test.js`.**
Routing `populateEmptyState` through the `clearSection` chokepoint (D-7, required
by the plan) broke `daemon-status.test.js:450`, which located the teardown by the
literal `indexOf('section.removeAll()')` to assert ordering. The plan's
`files_modified` never enumerated that suite, and its verification step 4 demands
the diff surface be *exactly* four files. I changed the one line to
`indexOf('clearSection(section)')`, preserving the Pitfall-C ordering intent
verbatim. Rejected the alternative — leaving `populateEmptyState` calling
`removeAll()` directly — because it would put a hole in the very invariant that
makes stale inventories impossible, letting a test literal dictate the
architecture. Flagged for audit: the diff surface is 5 files, not 4.

**D-B — [ordering] Two guard updates moved earlier than the plan assigned them.**
The plan put both deliberately-invalidated pins in Task 3, but Task 1 removes the
`new PopupMenu.PopupSwitchMenuItem` literal and Task 2 removes the one-line
`if (this.menu.isOpen) this._rebuildPopover();` literal. Leaving them meant
committing a red tree — twice. Each pin was therefore updated in the task that
invalidates it (Task 1 and Task 2 respectively), so every commit is green in
isolation. Content is exactly what the plan specified; only the commit boundary
moved. Task 1 is `type="tracer"`, which makes a green proven slice the point.

**D-C — [unanticipated] Sibling 260915-ung's `populateLoadingState` regex.**
`forward-compat.test.js:675` pinned `section.removeAll();` as that function's
first statement via regex. The chokepoint changes the literal. Updated to accept
either form, so the Pitfall-C intent (emptying is the FIRST action) still holds.
The plan anticipated two invalidated guards; there were four.

**D-D — [coordinator addendum, applied] Changelog gate strengthened.**
The plan's `n==1` `### Fixed` awk gate was already satisfied by the siblings
before I edited anything, so it could not detect a skipped contribution. Added
distinctive-phrase greps for my own two bullets (`no longer closes it`,
`no longer collapses the device list`) and `git diff --quiet -- po/` as a
mechanical gate. Both bullets went into the **existing** `### Fixed` section, not
a new one — the plan's "existing empty `[Unreleased]`" text was stale.

No auth gates. No architectural (Rule 4) escalation. No package installs.

## Inferred decisions — flagged for audit (human unavailable)

D-1..D-9 were all inferred by the plan and are restated as inferred, not
approved:

- **D-1** Subclass `PopupSwitchMenuItem` and override public `activate(event)`.
- **D-2** Drop upstream's `if (this._switch.mapped)` guard — `_switch` is
  private and only `setStatus()` unmaps it, which USBee never calls.
- **D-3** Reconcile rows keyed on `device.id`, the identity `dbus-client.js`
  already resolves `DeviceAdded`/`Removed`/`Changed` by.
- **D-4** Filter/sort composition stays in `popover.js` (extracted to
  `visibleDevices`) rather than moving to zero-import `link-verdict.js`; it needs
  `hasIssue` from `device-store.js`, which imports GI.
- **D-5** Only `show-technical-details` refreshes a surviving row's contents.
- **D-6** Two-layer gate: semantic `awaitingFirstSnapshot === true` return in
  `tile.js`, plus the structural ownership gate that trusts no caller.
- **D-7** Row liveness proved against `_getMenuItems()` by identity and order,
  never from a stashed array; `clearSection` chokepoint at all 7 teardowns.
- **D-8** The GSettings write does not depend on `toggle()` emitting `toggled`.
- **D-9** USBee clears its own `_openedSubMenu` field via `_usbeeForgetSubMenu`.

Also inferred, per every prior quick task in this project: **committing straight
to `master` with `git.allow_default_branch_commits` unset.** The operator
mandated a single working tree for this batch (all three items collide on the
same files), so isolation was legitimately degraded to `none`.

## Reasoned from source, NOT seen — the three claims that cannot be checked here

The Shell's JavaScript is absent from this machine's disk and from every
installed `.gresource`; `/usr/share/gnome-shell/js/ui/popupMenu.js` does not
exist. Every `46:` / `50:` citation is provenance for a claim, not a file
reference.

1. **`toggle()` emits `'toggled'`** (46:476 direct; 50:556 → `_switch.toggle()`
   → `notify::state` wired 50:505 → `_onToggled` 50:575). **Response: D-8** —
   the write is signal-independent, so the switches work whether or not this
   holds. Exactly one write either way, via an idempotence check.
2. **Upstream `PopupSubMenu.close()` notifying the top menu**
   (`_setOpenedSubMenu(null)`). **Response: D-9** — USBee clears the field it
   itself wrote, so the T-unh-02 mitigation no longer rests on this being true.
   `close(false)` is still called as well.
3. **Refilling an already-open submenu relayouts correctly.**
   `populateDeviceRowMenu` refills a live `row.menu` on the
   `show-technical-details` path. `removeAll()` leaving `isOpen` untouched keeps
   the panel open, but the submenu actor's height is only natural (`-1`) once an
   open animation has completed, so a refill landing mid-animation could in
   principle leave a clipped panel. Judged low risk, deliberately not mitigated
   — recorded so a real clipping report has a starting point.

Additionally: on Shell 50 `setToggleState()` **does** emit `'toggled'`
(50:571 → 564 → 505 → 575), so the `syncing` latch i4w added "in case a future
release ever did" is **load-bearing on the Shell this machine runs**. Its
comment was upgraded from speculation to evidence. Do not remove or weaken it.

## Owed to the human

**The three user-visible truths could not be observed this session** — they live
inside `gnome-shell` and the popover only re-renders after a Shell restart
(Xorg: `Alt+F2` → `r`; Wayland: full re-login):

1. Clicking an Options switch leaves the popover open.
2. An expanded device row stays expanded across a filter toggle.
3. The scroll position holds across a filter toggle.

Verified structurally instead (source-level: the row's `activate()` no longer
reaches `PopupMenuBase.itemActivated()`; no `removeAll()` on the in-place path;
surviving rows are never re-created). The preferences window is not a substitute
— it exercises the other end of the binding, not the menu.

**Shell-restart debt now spans i4w, ikd, mpf, unf, ung and unh.** Per the
operator's standing instruction this was not escalated as a blocking checkpoint.

Nothing else is owed: no package legitimacy question arose, no scope fork was
hit, and every executable check was run rather than handed over.

## Known stubs

None. No placeholder values, no skipped tests, no unrun `<verify>` gates — all
plan verification commands were executed.
