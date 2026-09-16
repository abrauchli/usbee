---
quick_id: 260915-unh
slug: stop-the-in-menu-settings-toggle-from-collapsing-the-whole-q
date: 2026-09-15
status: planned
batch_mode: quick-batch
# 260915-ung executes FIRST in this batch and touches four of the same files
# (popover.js, tile.js, tests/forward-compat.test.js, CHANGELOG.md); 260915-unf
# also touches popover.js. Task 2's loading-window guard is written against the
# Loading… row ung introduces, so this edge is load-bearing, not cosmetic.
depends_on: [260915-ung]
files_modified:
  - usbee@bitcreed.us/src/popover.js
  - usbee@bitcreed.us/src/tile.js
  - tests/forward-compat.test.js
  - CHANGELOG.md
autonomous: true
estimate:
  tokens: 105000
  raw_tokens: 52500
  tasks: 3
  confidence: low
must_haves:
  truths:
    - "Clicking any of the four Options switches with the mouse leaves the Quick Settings popover OPEN (today it dismisses the whole popover)."
    - "After a filter toggle, a device row that was expanded is STILL expanded, and the device section's scroll position is unchanged."
    - "After a filter toggle the popover header's device count and issue count still match the rows actually visible."
    - "Toggling show-technical-details swaps the technical rows inside an already-open detail panel without collapsing it."
    - "Toggling a switch in the preferences window still moves the popover switch, and vice versa, with no write loop."
    - "A filter toggle while the popover shows 260915-ung's Loading… row changes nothing on screen: the row survives and is never replaced by 'No USB devices attached'."
    - "updateDeviceRowsInPlace never touches a row it did not itself put on screen — it proceeds only when the section's live items are identity-equal, in order, to the inventory it recorded."
    - "Clicking an Options switch writes its GSettings key even if PopupSwitchMenuItem.toggle() does not emit 'toggled' on some Shell in the declared range."
    - "All four gjs suites pass with 0 failures, and forward-compat's assertion count is strictly greater after this task than immediately before it (the absolute baseline moved: siblings 260915-unf and 260915-ung add guards ahead of this item, so 266 is stale)."
    - "No user-visible string is added, removed or reworded: the sorted msgid list of a scratch regeneration is byte-identical before and after this item's edits, and po/usbee@bitcreed.us.pot is untouched."
  artifacts:
    - usbee@bitcreed.us/src/popover.js
    - usbee@bitcreed.us/src/tile.js
    - tests/forward-compat.test.js
    - CHANGELOG.md
  key_links:
    - "USBeeSwitchMenuItem.activate() override <-> the Shell's PopupBaseMenuItem.activate -> 'activate' -> PopupMenuBase.itemActivated() -> _getTopMenu().close() chain that closes the popover."
    - "row._usbeeOnActivate <-> the GSettings write: the row->settings direction must not rest solely on toggle() emitting 'toggled', which cannot be verified on this machine."
    - "tile.js filter-key handler -> popover.js updateDeviceRowsInPlace() (replaces the _rebuildPopover() call that tore the section down)."
    - "store.awaitingFirstSnapshot (260915-ung) <-> the tile.js filter handler's early return — the ONE condition that keeps a filter toggle from touching ung's Loading… row."
    - "section._usbeeOwnedItems <-> section._getMenuItems(): the identity-and-order check that proves the recorded inventory did not outlive its rows before anything is mutated. This is what makes safety independent of what any sibling's populate* function does."
    - "clearSection(section) <-> every section.removeAll() call site in popover.js (all six, plus ung's populateLoadingState) — one chokepoint, so an inventory can never survive the rows it describes."
    - "row._usbeeDeviceId <-> device.id, the daemon's own device identity (the key dbus-client.js already looks devices up by)."
    - "section._usbeeRows <-> the accordion 'open-state-changed' handler, which must read the LIVE row list, not a captured array."
    - "section._usbeeForgetSubMenu (tile.js shim) <-> the shim-owned _openedSubMenu field: USBee writes that field, so USBee clears it before destroying a row rather than betting on upstream close() notifying the top menu."
    - "The i4w `syncing` latch <-> Shell 50's setToggleState(), which emits 'toggled' per upstream source read at plan time (NOT re-checkable here) — the latch is load-bearing, never remove it."
---

# Quick Task 260915-unh — Keep the popover open (and the list expanded) when a setting is toggled

## Problem

Toggling one of the in-popover **Options** switches (landed in quick task
260915-i4w) dismisses the entire Quick Settings popover. If it did not, the
device list underneath would still collapse: every expanded device detail
panel is destroyed and the scroll position resets.

These are **two independent causes**. Both must be fixed for the requested
outcome ("toggling a setting must leave the menu open *and* the device list
expanded").

## Cause 1 — the whole popover closes (the dominant symptom)

Nothing in USBee asks for this; it is the Shell's default for an activated
menu item, and USBee inherits it:

1. `usbee@bitcreed.us/src/popover.js:196` builds each Options row as a stock
   `PopupMenu.PopupSwitchMenuItem`.
2. Shell `js/ui/popupMenu.js` — `PopupSwitchMenuItem.activate(event)`
   (**gnome-46 line 463**, **gnome-50 line 543**, byte-identical bodies):
   toggles the switch, then — for every event **except** a `KEY_PRESS` of
   `Clutter.KEY_space` — chains to `super.activate(event)`. A mouse click is
   never that exception.
3. `PopupBaseMenuItem.activate(event)` (46:194 / 50:195) emits `'activate'`.
4. `PopupMenuBase._connectItemSignals(menuItem)` (46:673 / 50:773) connected
   `'activate'` with `GObject.ConnectFlags.AFTER` (46:700 / 50:800) and calls
   `this.itemActivated(BoxPointer.PopupAnimation.FULL)`.
5. `PopupMenuBase.itemActivated(animate)` (46:659 / 50:749) is
   `this._getTopMenu().close(animate)`. The Options item is added to the
   toggle's own `this.menu` (`tile.js:138`), so `_getTopMenu()` (46:573 /
   50:663) walks to the Quick Settings menu — and closes it.

Upstream's own comment ("we allow pressing space to toggle the switch
*without closing the menu*") states the intent for keyboard use; the fix is
to extend that intent to the pointer.

## Cause 2 — the device list collapses (revealed once cause 1 is fixed)

`usbee@bitcreed.us/src/tile.js:145-151` connects `changed::<key>` for all four
filter keys to `if (this.menu.isOpen) this._rebuildPopover();`
→ `tile.js:187` `_rebuildPopover()` → `tile.js:217`
`populateDeviceRows(this._rowsSection, ...)` → **`popover.js:66`
`section.removeAll()`**, which is `PopupMenuBase.removeAll()` (46:845 /
50:951) calling `item.destroy()` on every row. Each row is a
`PopupSubMenuMenuItem` whose `_init` does
`this.connect('destroy', () => this.menu.destroy())` (46:1253 / 50:1366), so
the expanded detail panel and its submenu die with the row. The
`St.ScrollView` (`tile.js:71-79`) also loses its scroll offset.

A latent hazard rides along: the `_setOpenedSubMenu` shim installed at
`tile.js:64-70` keeps a reference to the currently-open submenu, and
`_setOpenedSubMenu` (46:902 / 50:1008) calls `this._openedSubMenu.close(true)`
on it. A rebuild that destroys an **open** row leaves that reference dangling,
so the next row the user opens calls `close()` on a finalised `PopupSubMenu`.
Fixing cause 2 properly removes that hazard instead of documenting it.

## Upstream contracts this plan relies on — and their provenance

**Read this framing before trusting a line number below.** Every `46:` / `50:`
citation in this plan was read from upstream `js/ui/popupMenu.js` (gnome-46, the
project's `metadata.json` minimum, and gnome-50, `gnome-shell --version` on this
machine = 50.1) **at plan time, from upstream sources — not from this machine.**
The Shell's JavaScript is not on disk here: `/usr/share/gnome-shell/js/ui/popupMenu.js`
does not exist and no installed `.gresource` lists `ui/popupMenu.js`. So the
executor **cannot** re-open these lines locally and must not burn time trying.
Treat them as provenance for a claim, not as a file reference.

One consequence, applied throughout the tasks below: **no mitigation in this
plan is allowed to rest solely on an upstream behaviour that cannot be checked
here.** Where a claim is load-bearing, the code also carries a USBee-owned
fallback that holds whether or not the upstream claim is true (see D-8 for the
GSettings write and D-7 for the `_openedSubMenu` clear). The one local claim in
the original draft that *was* checkable turned out to be false (the
`setSubmenuShown` sentence, corrected below), which is the direct reason for
this posture.

- `PopupMenuBase.addMenuItem(menuItem, position)` (46:765 / 50:865) supports
  positional insert, and for a `PopupSubMenuMenuItem` it inserts **both** the
  row actor and `menuItem.menu.actor` below the same `beforeItem`, preserving
  row-then-submenu order. Inserting a row at an index is therefore safe.
- `PopupMenuBase._getMenuItems()` (46:827 / 50:933) maps `box` children to
  `_delegate` and keeps only `PopupBaseMenuItem` / `PopupMenuSection`. A
  submenu's delegate is a `PopupSubMenu` (a `PopupMenuBase`), so it is
  filtered out: **`_getMenuItems()` indices line up 1:1 with the row array.**
- `PopupSubMenu.open(animate)` (46 / 50) early-returns when `isEmpty()`
  (46:649 / 50:739) but `removeAll()` does **not** touch `isOpen` — so
  emptying and refilling an *open* submenu leaves it open.
- `PopupSubMenu.close(animate)` is the public close entry point and
  `this.menu.isOpen` is the read side. **Both are already used by this file**:
  the accordion handler at `popover.js:145-146` reads `other.menu.isOpen` and
  then calls `other.menu.close(/* animate */ true)`. (Corrected from the
  original draft, which claimed `popover.js:145` called
  `PopupSubMenuMenuItem.setSubmenuShown()`. That was false — `setSubmenuShown`
  appears nowhere in `usbee@bitcreed.us/` or `tests/`, and this plan does not
  introduce it. Task 2 reuses the `close()` / `isOpen` pair the file already
  relies on, so it adds no new API surface at all.)
- **`toggle()` still emits `'toggled'` on both versions.** On 46 `toggle()`
  (46:476) emits directly. On 50 `toggle()` (50:556) delegates to
  `this._switch.toggle()`, and `_init` wires
  `this._switch.connect('notify::state', this._onToggled.bind(this))`
  (**50:505**) → `_onToggled()` (50:575) emits `'toggled'`. So an
  `activate()` override that calls only `this.toggle()` still writes GSettings
  on both.
- **i4w's residual risk now has an answer from upstream source, and it is the
  uncomfortable one** (source-reasoned, not re-checkable here — see the framing
  above). On **46**, `setToggleState(state)` (46:486) sets
  `this._switch.state` and does not emit. On **50**, `setToggleState(state)`
  (50:571) is `this.set({state})` → the item's `state` setter (50:564) →
  `this._switch.set({state})` → `notify::state` → `_onToggled()` → **emits
  `'toggled'`**. The `syncing` latch i4w added "in case a future release ever
  did emit" is therefore **load-bearing on the Shell this machine runs**.
  Do not remove it, and do not weaken it.

## Decisions (inferred — human unavailable, flagged for audit)

- **D-1 — Fix cause 1 by subclassing `PopupSwitchMenuItem` and overriding the
  public `activate(event)`.** Documented surface only: `activate()` is a
  public method of `PopupBaseMenuItem`, `toggle()` is public on
  `PopupSwitchMenuItem`. Rejected alternatives: `GObject.signal_stop_emission_by_name`
  during the `'activate'` emission (works, but obscure and relies on ordering
  against the Shell's AFTER handler); `activate: false` in the ctor params
  (kills `vfunc_button_release_event` → the switch would stop toggling at all);
  re-opening the menu after it closes (visible flash, and it would reset the
  list anyway).
- **D-2 — The override drops upstream's `if (this._switch.mapped)` guard.**
  `_switch` is a private field, and the only thing that unmaps it is
  `setStatus(text)`, which USBee never calls. Unconditional `this.toggle()` is
  correct for this codebase and touches no internal.
- **D-3 — Reconcile rows in place, keyed on `device.id`.** `device.id`
  (`device-store.js:41`, daemon `../usbeehive/src/dbus.rs:293/355`) is already
  this project's device identity: `dbus-client.js:250/263/312` resolve
  `DeviceAdded` / `DeviceRemoved` / `DeviceChanged` by `d.id === id`. Reusing
  it invents nothing.
- **D-4 — The filter/sort composition stays in `popover.js`** (extracted to a
  local helper so the two paths cannot drift) rather than moving to the
  zero-import `link-verdict.js` for real unit tests. It needs `hasIssue` from
  `device-store.js`, which imports GI and cannot load under bare gjs; moving
  it would mean injecting the predicate — scope creep on a bugfix. Guarded
  structurally, the same way i4w guarded the filters (i4w D-4).
- **D-5 — Only `show-technical-details` refreshes a surviving row's contents.**
  The other three keys change *which rows exist*, never what a row says, so
  they must not touch the row the user is reading. Tracked by comparing
  `section._usbeeShowTech` against the live read.
- **D-6 — The in-place path is entered only when the device-row branch is
  provably the one on screen, and `daemonState` alone does not prove it.**
  The original draft gated solely on `daemonState !== RUNNING` and claimed that
  made it robust to sibling **260915-ung**. That claim was **wrong**, and the
  correction is the substance of this revision. ung does *not* add a fifth
  `DaemonState` (its D-01 explicitly keeps the frozen four-value enum); it adds
  an orthogonal boolean, and its `Loading…` row is rendered **inside**
  `case DaemonState.RUNNING` of `_rebuildPopover`, keyed on
  `store.awaitingFirstSnapshot` (ung plan lines 170-171). So `daemonState`
  **is** `RUNNING` while a `Loading…` row is on screen, a `daemonState`-only
  gate does not fire, and the in-place path would run against rows that no
  longer exist. Two concrete failure modes, both silent under static tests:
  ung's `populateLoadingState` calls `section.removeAll()` without resetting
  the row inventory, so the removal step would call `close()` / `destroy()` on
  already-finalised rows — the exact "instance is invalid" class T-unh-02
  claims to close; and on an empty inventory the fallback to
  `populateDeviceRows` would replace the `Loading…` row with
  `_('No USB devices attached')`, reintroducing precisely the flash ung exists
  to remove.

  The gate is therefore **two independent layers**, and the second does not
  trust the first:

  1. **Semantic (tile.js).** A filter change while
     `store.awaitingFirstSnapshot === true` **returns without touching
     anything**. Nothing needs repainting: a `Loading…` row says nothing a
     filter could change, and ung's own loading→loaded latch rebuilds with the
     live filter values when the snapshot lands. Doing nothing is both the
     safest and the sufficient action — strictly better than re-rendering the
     row, which would churn actors for no visible gain. Non-`RUNNING` states
     keep routing through `_rebuildPopover()` exactly as before (each renders
     one non-expandable item, so a rebuild there costs the user nothing).
  2. **Structural (popover.js).** `updateDeviceRowsInPlace` refuses to act
     unless the section's live items are identity-equal, in order, to the
     inventory `populateDeviceRows` recorded (D-7). This holds **regardless of
     what any caller or any sibling's `populate*` function did**, which is what
     makes the property provable rather than argued.

  The condition is written `awaitingFirstSnapshot === true`, so an absent
  getter (a world where ung has not landed) reads as "not awaiting" and
  behaves exactly as this plan's pre-ung reasoning intended.

- **D-7 — Row liveness is proved against the section, not trusted from a
  stashed array.** `populateDeviceRows` records `section._usbeeOwnedItems` —
  the items it actually put on screen (the row array itself on the rows path,
  a one-element `[placeholder]` array on the empty path) — and
  `updateDeviceRowsInPlace` compares that against `section._getMenuItems()`
  by identity and order before mutating anything. Three outcomes, which is
  what lets the two "nothing on screen" cases be told apart instead of
  conflated:
  the items are ours and are rows → reconcile in place; ours and are the
  placeholder → delegate to `populateDeviceRows` (a filter change must be able
  to bring rows back); **not ours → return `null` and touch nothing**, which
  is the `Loading…`-row case and any future single-item state.
  Belt and braces, every `section.removeAll()` call site in `popover.js` is
  routed through one `clearSection(section)` helper that clears the inventory
  as it empties the section, so an inventory physically cannot outlive its
  rows. `_getMenuItems()` is a Shell-private name, but it is **not new private
  surface**: this file already calls it at `popover.js:59`, for the same
  purpose (inspecting the section's live contents before mutating them). No
  other internal is added, so CLAUDE.md's documented-surface rule is not
  loosened by this task.

- **D-8 — The GSettings write does not depend on `toggle()` emitting
  `'toggled'`.** Upstream source says it does emit on both 46 and 50, but that
  source is not readable here, no static test can cover it, and the behaviour
  is unobservable without a Shell restart — so resting the entire fix on it is
  an unforced bet. The override therefore calls a USBee-owned hook,
  `row._usbeeOnActivate(state)`, in addition to toggling; the hook performs the
  write behind the existing `syncing` latch and an idempotence check
  (`settings.get_boolean(key) === state` → return). If `'toggled'` fires, the
  signal handler writes and the hook then no-ops; if it never fires, the hook
  writes. Exactly one write either way, and the switches keep working on every
  Shell in the declared range whichever is true.

- **D-9 — USBee clears its own `_openedSubMenu` field.** That field is created
  and written **only** by USBee's `_setOpenedSubMenu` shim (`tile.js:64-70`) —
  it is USBee's data, not the Shell's. Clearing it by calling
  `row.menu.close(false)` and hoping upstream `PopupSubMenu.close()` calls
  `_getTopMenu()._setOpenedSubMenu(null)` would make a high-severity
  mitigation depend on an unreadable implementation detail. Instead tile.js
  installs a companion `_usbeeForgetSubMenu(submenu)` shim that nulls the field
  on both hosts the existing shim covers, and popover.js calls it before
  destroying a row. `close(false)` is still called as well, so the mitigation
  holds whether or not upstream also notifies.

## Tasks

<tasks>

<task type="tracer">
  <name>Task 1: A switch row that toggles without dismissing the popover</name>
  <files>usbee@bitcreed.us/src/popover.js</files>
  <read_first>usbee@bitcreed.us/src/popover.js — the `gi://` import block at the top of the file (~:18-31), and `buildOptionsSection` together with its doc comment (~:157-220). Line numbers are HINTS ONLY: siblings 260915-unf and 260915-ung both edit popover.js before this item runs, so locate by symbol name, never by line.</read_first>
  <action>
Per D-1/D-2. Add `import GObject from 'gi://GObject';` to the import block in
`popover.js` (it is not currently imported; keep the existing `gi://` grouping
and alphabetical order — Clutter, GObject, Pango, St).

Define a module-level `const USBeeSwitchMenuItem = GObject.registerClass(class USBeeSwitchMenuItem extends PopupMenu.PopupSwitchMenuItem { ... })`
immediately above `buildOptionsSection`, whose only member is an override of
`activate(_event)`. The override does exactly two things and must NOT chain to
`super.activate`:

1. `this.toggle();` — flip the switch.
2. Call the USBee-owned hook `this._usbeeOnActivate?.(this.state);` — per D-8,
   so the GSettings write does not rest on `toggle()` emitting `'toggled'`, a
   claim that cannot be verified on this machine. Read the post-toggle value
   through the public `state` property, which this file already relies on (the
   `changed::` handler compares `row.state === value`).

`_usbeeOnActivate` is USBee's own field, following the same `_usbee*`
convention as `row._usbeeAccordionSigId`; it is not a Shell internal and the
optional call makes the subclass safe to construct without one.

In `buildOptionsSection`, change the row construction from
`new PopupMenu.PopupSwitchMenuItem(label, settings.get_boolean(key))` to
`new USBeeSwitchMenuItem(label, settings.get_boolean(key))`.

Then make the row->settings write reachable from both directions (D-8) by
lifting the existing handler body into a named local, WITHOUT changing what it
does. Inside the same `for (const [key, label] of toggles)` loop, after
`let syncing = false;`:

- Define `const writeKey = (state) => { ... }` whose body is the current
  handler body — `if (syncing) return;` first, then
  `settings.set_boolean(key, state);` — with ONE guard added between them:
  `if (settings.get_boolean(key) === state) return;`. That guard is what makes
  the two entry points idempotent: whichever runs first performs the write, and
  the second sees the key already at `state` and returns without writing. Keep
  both `if (syncing) return;` and `settings.set_boolean(key, state)` as those
  exact substrings — `tests/forward-compat.test.js` pins both verbatim.
- `const toggledId = row.connect('toggled', (_row, state) => writeKey(state));`
  and keep `registry.addSignal(row, toggledId);` exactly as it is.
- `row._usbeeOnActivate = writeKey;` — the second entry point, invoked by the
  subclass override.

Everything else in that function stays exactly as it is: the `syncing` latch,
the `changed::${key}` handler, `row.setToggleState(value)`, and both
`registry.addSignal` calls.

Comment the pair briefly: the signal path is the normal one and still carries
an external `setToggleState()` write; the hook is the fallback that keeps the
switches working if `toggle()` does not emit on some Shell in the declared
range. Note that the `syncing` latch still guards BOTH, so the
settings->row direction can never feed back.

Write a doc comment on the subclass recording WHY, in the style of this file:
name the inherited chain (activate -> 'activate' -> PopupMenuBase's AFTER
handler -> itemActivated -> _getTopMenu().close), cite that the inherited
implementation already exempts the space key with the comment "we allow
pressing space to toggle the switch without closing the menu", and state that
this override extends that same intent to the pointer. Record that upstream
source says `toggle()` emits `toggled` on both 46 and 50 (46 emits directly; 50
wires the switch's `notify::state` to `_onToggled`) — and that this code
deliberately does NOT depend on it: state plainly that the `_usbeeOnActivate`
hook exists because that source is not readable on this machine and the
behaviour is unobservable without a Shell restart, so the write is made
signal-independent instead (D-8). Record D-2 (why the `_switch.mapped` guard is
not reproduced).

Also extend the existing `buildOptionsSection` doc comment where it currently
speculates that `setToggleState()` does not emit `toggled`: that speculation is
now settled and is FALSE on Shell 50, where `setToggleState` routes through the
`state` setter to `_onToggled` and does emit. State that the `syncing` latch is
therefore load-bearing on the Shell this machine runs, not a precaution.

Do not add, remove or reword any `_()` string anywhere in this task.
  </action>
  <verify>
    <automated>rtk proxy gjs -m usbee@bitcreed.us/src/popover.js 2>&amp;1 | grep -cE 'SyntaxError|ReferenceError' | grep -qx 0 &amp;&amp; rtk proxy gjs -m usbee@bitcreed.us/src/popover.js 2>&amp;1 | grep -q 'ImportError' &amp;&amp; echo PARSE_OK</automated>
    <automated>rtk proxy gjs -m tests/forward-compat.test.js 2>&amp;1 | grep -c 'FAIL' | grep -qx 0</automated>
  </verify>
  <done>`popover.js` parses (it reaches `resource:///` import resolution, which is the expected and only failure outside the Shell — exit status is 0 either way, so the grep is the gate). The Options rows are `USBeeSwitchMenuItem` instances; the subclass overrides `activate`, calls `this._usbeeOnActivate?.(this.state)`, and never chains to `super.activate`. The GSettings write is reachable from both the `toggled` signal and the hook, and writes exactly once either way. The `syncing` latch and both `registry.addSignal` calls are intact, and `if (syncing) return;` / `settings.set_boolean(key, state)` survive as verbatim substrings.</done>
  <reversibility rating="reversible">A 12-line subclass plus one constructor swap; revert is a one-line change back to the stock class.</reversibility>
</task>

<task type="auto">
  <name>Task 2: Update the affected rows in place instead of rebuilding the section</name>
  <files>usbee@bitcreed.us/src/popover.js, usbee@bitcreed.us/src/tile.js</files>
  <read_first>Locate every anchor BY SYMBOL NAME — siblings 260915-ung (adds `populateLoadingState`, edits the `DaemonState.RUNNING` branch) and 260915-unf (wires a disclosure into `populateEmptyState`) both edit popover.js and tile.js before this item runs, so the line hints below are stale by construction. In usbee@bitcreed.us/src/popover.js: `populateDeviceRows` and its doc comment (~:33-155), `buildDeviceRow` (~:313-527), and every `section.removeAll()` call site (`populateDeviceRows`, `populateEmptyState`, `populateNotInstalledState`, `populateServiceNotSetUpState`, `populateOutOfDateState`, `populateTooNewState`, plus `populateLoadingState` if ung has added it). In usbee@bitcreed.us/src/tile.js: the `_rowsSection` creation + `St.ScrollView` + `setOpenedSubMenuShim` block (~:52-79), the `buildOptionsSection` mount and the `for (const key of [...])` filter-handler loop (~:130-151), and `_rebuildPopover` (~:187-254).</read_first>
  <action>
Per D-3/D-4/D-5/D-6/D-7/D-9. One chokepoint plus four extractions in
`popover.js`, then the rewiring in `tile.js`. Keep every change additive around
the existing code so this rebases cleanly over siblings 260915-ung and
260915-unf, both of which have already edited this file.

(0) **The chokepoint that makes the rest safe (D-7).** Add a module-private
`function clearSection(section)` that does `section.removeAll();` followed by
`section._usbeeRows = [];` and `section._usbeeOwnedItems = null;`, then route
**every** `section.removeAll()` call site in this file through it:
`populateDeviceRows`, `populateEmptyState`, `populateNotInstalledState`,
`populateServiceNotSetUpState`, `populateOutOfDateState`, `populateTooNewState`,
and — if sibling 260915-ung has landed it — `populateLoadingState`. Do not add a
seventh copy of the reset logic; if ung's function is present, change its
`section.removeAll()` line to `clearSection(section)` like the others. Keep the
Pitfall C ordering intact: `clearSection` is still the FIRST call in each
function, and in `populateDeviceRows` it still follows the CR-02 handler-cleanup
loop. Document on `clearSection` that emptying a section must also forget what
USBee recorded about its contents, because a stale inventory is what lets a
later in-place update operate on destroyed rows.

(a) Extract the live GSettings read and the filter/sort composition out of
`populateDeviceRows` into two module-private helpers: `readFilterFlags(settings)`
returning an object with `hideEmpty`, `showHubs`, `showTech`, `hideBuiltin`, and
`visibleDevices(store, flags)` returning the filtered-then-sorted array. Move
the existing predicates VERBATIM — `get_boolean('hide-builtin-devices')`,
`isBuiltInDevice(d)`, the exact expression `!isBuiltInDevice(d) || hasIssue(d)`,
the hub and empty-port filters, and the `Number(hasIssue(b)) - Number(hasIssue(a))`
stable sort — along with the comment blocks that explain them. Those exact
substrings are pinned by `tests/forward-compat.test.js` and by the project's
composition rules; preserve them character for character.

(b) Extract the submenu construction out of `buildDeviceRow` into
`populateDeviceRowMenu(row, device, showTech)`. It starts with
`row.menu.removeAll();` and then contains everything `buildDeviceRow`
currently does from the `buildTransportPillStrip(device, props)` call through
`row.menu.addMenuItem(detailItem)` — the pill strip, the detail item, the box,
and every block call. `buildDeviceRow` keeps only the row header work (props,
headline, link, the row + icon + style classes, the trailing rate caption) and
then calls `populateDeviceRowMenu(row, device, showTech)` before returning. Set
`row._usbeeDeviceId = device.id;` in `buildDeviceRow`. Note in a comment that
`removeAll()` leaves `PopupSubMenu.isOpen` untouched, so refilling an open
submenu leaves it open (read from upstream `popupMenu.js` at plan time,
46:1053ff / 50:1166ff — see the provenance note above; not re-checkable here).
`row.menu.removeAll()` here is the submenu's own content, NOT the device
section, so it does not go through `clearSection`.

(c) Extract the accordion wiring into `attachAccordionHandler(section, row)`
and `detachAccordionHandler(row)`, preserving the `row._usbeeAccordionSigId`
bookkeeping and the CR-02 / T-03-04 comments. The handler body must iterate
`section._usbeeRows || []` instead of a captured `rows` array, so it stays
correct after rows are added or removed under it — keep the existing
`other.menu && other.menu.isOpen` defensive guard.

Rework `populateDeviceRows` to use (0) and (a)-(c) with NO behaviour change:
same handler-cleanup loop before the (now `clearSection`) teardown, same two
empty-list strings and `{count: 0, issues: 0}` return, same rows-then-wiring
order. Two additions:

- In the CR-02 handler-cleanup loop, alongside the existing disconnect, call
  `section._usbeeForgetSubMenu?.(item.menu);` (D-9). The rebuild path carries
  the same dangling-`_openedSubMenu` hazard the in-place path does — this is
  the latent bug described under Cause 2 — and one optional call closes it for
  every populate path at once.
- At the end it records the USBee-owned bookkeeping: `section._usbeeShowTech =
  flags.showTech;`, `section._usbeeRows = rows;`, and
  `section._usbeeOwnedItems = rows;` — **the same array object**, so the splices
  the in-place path performs keep both views in step with no extra bookkeeping.
  On the empty-list path it instead records `section._usbeeRows = []` and
  `section._usbeeOwnedItems = [<the placeholder item just added>]`. That
  asymmetry is the whole point: it is what lets the in-place path tell "our
  placeholder is on screen, a filter change may bring rows back" apart from
  "something that is not ours is on screen, do not touch it".

Document all three as USBee-owned properties on the section (not Shell
internals), the same convention `row._usbeeAccordionSigId` already follows.

(d) Add an exported `updateDeviceRowsInPlace(section, store, extension)`
returning `{count, issues}` — **or `null`, meaning "the section is not showing
the device-row branch; nothing was read, nothing was changed"**. Document that
two-valued contract on the function: a `null` return tells the caller to leave
the header alone, because the surface it describes is not on screen.

  1. `const flags = readFilterFlags(extension.getSettings());`
  2. **Ownership gate (D-7) — before anything else, and before any read of
     `_usbeeRows`.** Take `const owned = section._usbeeOwnedItems;` and
     `const live = section._getMenuItems();`, and require that `owned` is an
     array, `owned.length === live.length`, and every `owned[i] === live[i]`.
     If that fails, `return null` immediately without touching the section.
     This is the guard that makes the function safe no matter what any caller
     or any sibling's `populate*` did: `clearSection` nulls the token, so a
     section holding 260915-ung's `Loading…` row — or any future single-item
     state — fails the check and is left strictly alone. Comment it exactly
     that way, naming the `Loading…` row as the case in hand, and state that
     an identity-and-order comparison is used rather than a length check
     because only identity proves the recorded rows are the live ones.
     (`_getMenuItems()` is already used for this purpose at the top of
     `populateDeviceRows`, so this adds no new private surface — D-7.)
  3. `const rows = section._usbeeRows || [];` If `rows.length === 0`, return
     `populateDeviceRows(section, store, extension)` — the gate above has
     already proved the section is showing OUR placeholder, and a filter change
     must be able to bring rows back. Note in a comment that the gate is what
     makes this delegation safe, and that without it this line is exactly how
     the `Loading…` row would get replaced by `_('No USB devices attached')`.
  4. `const devices = visibleDevices(store, flags);` If it is empty, likewise
     delegate to `populateDeviceRows` so the "hidden by the current filters"
     placeholder and its wording stay in one place.
  5. Remove rows whose `_usbeeDeviceId` is no longer in the wanted set, in this
     order (D-9): `detachAccordionHandler(row)` so nothing can fire mid-teardown;
     then `section._usbeeForgetSubMenu?.(row.menu);` to clear the shim-owned
     `_openedSubMenu` field if it points at this submenu; then, if
     `row.menu?.isOpen`, `row.menu.close(false)`; then splice the row out of
     `rows` and `row.destroy()`. Comment that this is the dangling-reference
     hazard the old teardown left behind, and that the explicit forget call is
     what closes it — `close()` is called as well, but the mitigation must not
     depend on upstream `close()` notifying the top menu, which cannot be
     verified on this machine.
  6. Insert rows for newly visible devices, walking `devices` in ascending
     index order: `buildDeviceRow(device, flags.showTech)`,
     `section.addMenuItem(row, index)`, splice into `rows` at the same index,
     then `attachAccordionHandler(section, row)`. Comment that
     `_getMenuItems()` filters submenu delegates out, so the array index and
     the section position are the same number (46:827 / 50:933), and that
     `addMenuItem` inserts the row and its submenu actor together (46:765 /
     50:865).
  7. Only when `section._usbeeShowTech !== flags.showTech`, refresh surviving
     rows' contents with `populateDeviceRowMenu(row, device, flags.showTech)`,
     matching each row to its device by `_usbeeDeviceId` (D-5). Then store
     `section._usbeeShowTech = flags.showTech;`.
  8. Return `{count: devices.length, issues: devices.filter(hasIssue).length}`.
Never call `section.removeAll()` or `clearSection()` on this path, and never
re-create a surviving row. Because `_usbeeOwnedItems` and `_usbeeRows` are the
same array, the splices in steps 5 and 6 keep the ownership token accurate with
no extra write.

In `tile.js`: import `updateDeviceRowsInPlace` alongside the existing
`popover.js` imports. Extract the header assignment at the tail of
`_rebuildPopover()` (the `hdrTitle` / `hdrSubtitle` derivation and the
`this.menu.setHeader(...)` call) into a `_setHeader(n, issues)` method and call
it from `_rebuildPopover()` so there is exactly one copy. If item 260915-ung
has already introduced an equivalent helper, extend that one instead of adding
a second.

Also install the companion forget shim (D-9) beside the existing
`setOpenedSubMenuShim`, in the same constructor block: an arrow function
`forgetSubMenuShim = (submenu) => { ... }` that, for each of
`this._rowsSection` and `this.menu`, sets `_openedSubMenu` to `null` when it
`=== submenu`; assign it to `this._rowsSection._usbeeForgetSubMenu`. It must
cover both hosts for the same reason the existing shim is installed on both —
`_getTopMenu()` can stop at either. Comment that `_openedSubMenu` is written
only by USBee's own shim, so USBee is also responsible for forgetting a submenu
it is about to destroy, rather than betting on upstream `close()` doing it.

Then rewrite the filter-key loop body (currently the one-line
`this._rebuildPopover()` guard inside the `for (const key of [...])` loop) to,
in this order:

1. `if (!this.menu.isOpen) return;` — unchanged intent (D-11 lazy rebuild).
2. `if (this._store.awaitingFirstSnapshot === true) return;` — **the
   loading-window guard (D-6).** While sibling 260915-ung's `Loading…` row is
   on screen there is nothing to filter and nothing a filter could change, and
   ung's loading→loaded latch will repaint with the live filter values when the
   snapshot lands. Comment it exactly so, naming 260915-ung, and note that the
   test is `=== true` so a build without that getter behaves as before.
   Note also WHY `daemonState` cannot carry this: ung renders its row inside
   `case DaemonState.RUNNING`, so the daemon state is `RUNNING` while the
   `Loading…` row is visible and a `daemonState`-only gate would not fire.
3. `if (this._store.daemonState !== DaemonState.RUNNING) { this._rebuildPopover(); return; }`
   (D-6 — every other branch renders one non-expandable item, so a rebuild
   there costs the user nothing).
4. Otherwise call
   `updateDeviceRowsInPlace(this._rowsSection, this._store, this._extension)`
   and feed its `count` / `issues` to `this._setHeader(...)` **only when it
   returned non-`null`** — a `null` means nothing was repainted, so the header
   must be left as it is.

Replace the existing comment with one that says a filter change must not
collapse what the user is reading, and that the header must still agree with
the rows now visible.

Add no `_()` string and reword none.
  </action>
  <verify>
    <automated>rtk proxy gjs -m usbee@bitcreed.us/src/popover.js 2>&amp;1 | grep -cE 'SyntaxError|ReferenceError' | grep -qx 0 &amp;&amp; rtk proxy gjs -m usbee@bitcreed.us/src/tile.js 2>&amp;1 | grep -cE 'SyntaxError|ReferenceError' | grep -qx 0 &amp;&amp; echo PARSE_OK</automated>
    <automated>for t in dbus-client daemon-status forward-compat service-probe; do rtk proxy gjs -m tests/$t.test.js 2>&amp;1 | grep -c 'FAIL' | grep -qx 0 || exit 1; done; echo SUITES_OK</automated>
    <automated>grep -q 'export function updateDeviceRowsInPlace' usbee@bitcreed.us/src/popover.js &amp;&amp; grep -q 'function populateDeviceRowMenu' usbee@bitcreed.us/src/popover.js &amp;&amp; grep -q '_usbeeDeviceId' usbee@bitcreed.us/src/popover.js &amp;&amp; grep -q 'section._usbeeRows' usbee@bitcreed.us/src/popover.js &amp;&amp; grep -q 'updateDeviceRowsInPlace(' usbee@bitcreed.us/src/tile.js &amp;&amp; grep -q 'this._setHeader(' usbee@bitcreed.us/src/tile.js &amp;&amp; echo WIRED</automated>
  </verify>
  <done>All four suites pass with 0 failures. `popover.js` exports `updateDeviceRowsInPlace` and keeps `populateDeviceRows` behaviourally unchanged for every other caller. Every `section.removeAll()` call site in `popover.js` goes through `clearSection`, so no recorded inventory can outlive its rows. `updateDeviceRowsInPlace` returns `null` without touching the section whenever `_usbeeOwnedItems` is not identity-and-order-equal to `_getMenuItems()` — so a filter toggle during 260915-ung's awaiting-first-snapshot window leaves the `Loading…` row intact, and the `tile.js` guard returns before even calling it. Rows carry `_usbeeDeviceId`; the section carries `_usbeeRows`, `_usbeeOwnedItems` and `_usbeeShowTech`; the accordion handler reads the live list. A removed row is detached, forgotten via `_usbeeForgetSubMenu`, closed and only then destroyed. `tile.js`'s filter handler calls `updateDeviceRowsInPlace` + `_setHeader` and no longer routes a filter change through `_rebuildPopover()` while the daemon is RUNNING and loaded. The four pinned filter substrings (`get_boolean('hide-builtin-devices')`, `isBuiltInDevice(d)`, `!isBuiltInDevice(d) || hasIssue(d)`, and both empty-list strings) are still present verbatim.</done>
  <reversibility rating="reversible">Pure refactor plus one new exported function; the old rebuild path stays intact and reachable, so reverting is restoring one call site.</reversibility>
</task>

<task type="auto">
  <name>Task 3: Pin the new behaviour in the suite, and record it for users</name>
  <files>tests/forward-compat.test.js, CHANGELOG.md</files>
  <read_first>tests/forward-compat.test.js — the `check` / `readSource` harness near the top (~:44-56) and the guard block headed `# the popover Options section is wired in both directions` (~:667-704; locate it by that header text, since 260915-ung appends guards to this file first). CHANGELOG.md — the header plus the empty `## [Unreleased]` heading (:1-12, and note `## [2.9.0]` follows it immediately at HEAD, though sibling items add their own `### Fixed` entries under `[Unreleased]` before this one runs), and any existing `### Fixed` section for voice (~:129-141).</read_first>
  <action>
Two existing guards in the `# the popover Options section is wired in both
directions` block are invalidated BY DESIGN by Task 1 and Task 2 and must be
updated deliberately, not worked around:

  1. `check('the Options rows are PopupSwitchMenuItems', src.includes('new PopupMenu.PopupSwitchMenuItem'))`
     — the constructor call is now the subclass. Replace it with two checks:
     that `popover.js` contains `extends PopupMenu.PopupSwitchMenuItem` (the
     stock widget is still the base, so the Shell's own switch behaviour and
     a11y role are inherited, not reimplemented), and that it constructs
     `new USBeeSwitchMenuItem(`.
  2. `check('tile.js repaints the list when a filter changes', ...)` — the pin
     on the old one-line rebuild call. Replace it with a check that `tile.js`
     contains `updateDeviceRowsInPlace(` and one that it contains
     `this._setHeader(`.

Then add a new guard block headed
`# a settings toggle keeps the popover open and the list expanded (260915-unh)`
asserting, over `readSource('usbee@bitcreed.us/src/popover.js')` and
`readSource('usbee@bitcreed.us/src/tile.js')`:

  - the switch subclass overrides activation without dismissing the menu:
    `popover.js` contains `activate(_event)` and `this.toggle();`
  - the GSettings write does not depend on the `toggled` signal (D-8):
    `popover.js` contains `_usbeeOnActivate`
  - the section's contents are proved live before any in-place mutation (D-7):
    `popover.js` contains `_usbeeOwnedItems` and `clearSection(section)`
  - a filter toggle cannot disturb 260915-ung's loading row (D-6): `tile.js`
    contains `awaitingFirstSnapshot === true`
  - USBee clears the field USBee owns before destroying a row (D-9):
    `popover.js` contains `_usbeeForgetSubMenu` and `tile.js` contains
    `_usbeeForgetSubMenu`
  - `popover.js` exports `updateDeviceRowsInPlace` and defines
    `populateDeviceRowMenu`
  - rows are keyed on the daemon's own device identity: `popover.js` contains
    `_usbeeDeviceId` and `device.id`
  - the in-place path keeps a live row inventory: `popover.js` contains
    `section._usbeeRows`, and the accordion handler iterates it rather than a
    captured array
  - a removed row is closed before it is destroyed, so the shim's
    `_openedSubMenu` reference cannot dangle: `popover.js` contains
    `row.menu.close(false)`
  - a newly visible row is inserted at its sorted index rather than appended:
    `popover.js` contains `addMenuItem(row, index)`
  - `tile.js` still routes every non-running daemon state through the full
    rebuild: it contains `DaemonState.RUNNING`
  - the three filter keys still compose exactly as before — re-assert the
    verbatim `!isBuiltInDevice(d) || hasIssue(d)` expression survived the
    extraction into `visibleDevices`

Use ONLY positive `includes` assertions in this block. Do not add a negative
grep asserting the absence of a chained-activation call or of the old rebuild
line: Task 1 deliberately requires the doc comment to describe that inherited
chain, and Task 2's comment explains what the old path did, so an
absence-assertion would be invalidated by the very comments that keep the
decision from being forgotten — the failure mode quick task 260910-p91 hit and
solved by inspecting extracted literals instead of file text.

Head the block with exactly this `print(...)` line and nothing before it —
`# a settings toggle keeps the popover open and the list expanded (260915-unh)` —
because a verify gate counts `check(` call sites in the region that starts at
that phrase and ends at the next `print(`. Anything placed ABOVE the header (a
comment, say) would make the region end at the header itself and the gate would
read zero.

Put the provenance comment INSIDE the block, immediately after the opening
brace: record that upstream source says `setToggleState()` emits `toggled` on
Shell 50 (`popupMenu.js` 50:571 -> 50:564 -> 50:505 -> 50:575) while it does not
on 46 (46:486), so the neighbouring `syncing`-latch guards are load-bearing
rather than precautionary — and that this is read from upstream, not verifiable
on this machine, which is why `_usbeeOnActivate` exists (D-8).

In `CHANGELOG.md`, add a `### Fixed` section under the existing empty
`## [Unreleased]` heading with two bullets in the file's established
user-facing voice (describe what the user sees; name no Shell class):

  - Changing a setting from inside the popover no longer closes it. The
    switches under **Options** used to dismiss the whole Quick Settings panel
    the moment one was clicked, so every change meant reopening the panel to
    see its effect.
  - Changing a filter no longer collapses the device list. The list now
    updates in place: a device whose details were open stays open, the list
    stays where it was scrolled to, and only the rows the filter actually
    affects appear or disappear.

Do not touch the released `## [2.9.0]` section, do not bump any version field
in `metadata.json`, do not invent an `[Unreleased]:` compare link (this file
deliberately has none), do not tag and do not push.
  </action>
  <verify>
    <automated>for t in dbus-client daemon-status forward-compat service-probe; do rtk proxy gjs -m tests/$t.test.js 2>&amp;1 | grep -c 'FAIL' | grep -qx 0 || exit 1; done; echo SUITES_OK</automated>
    <automated>test "$(rtk proxy sed -n "/a settings toggle keeps the popover open/,/^print(/p" tests/forward-compat.test.js | grep -c "check(")" -ge 12 &amp;&amp; echo THIS_TASKS_GUARDS_ADDED</automated>
    <automated>for p in 'new USBeeSwitchMenuItem(' 'updateDeviceRowsInPlace(' '_usbeeOnActivate' '_usbeeOwnedItems' 'awaitingFirstSnapshot === true' '_usbeeForgetSubMenu'; do rtk proxy grep -q "$p" tests/forward-compat.test.js || exit 1; done; echo NEW_PINS_PRESENT</automated>
    <automated>awk '/^## \[Unreleased\]/{f=1;next} /^## \[2\.9\.0\]/{f=0} f&amp;&amp;/^### Fixed/{n++} END{exit !(n==1)}' CHANGELOG.md || exit 1</automated>
    <automated>rtk proxy git diff --quiet 5e6ad7f -- usbee@bitcreed.us/metadata.json &amp;&amp; echo METADATA_UNTOUCHED</automated>
  </verify>
  <done>All four suites pass with 0 failures. That single fact is also what proves the two deliberately-invalidated pins were updated rather than left behind: had either survived, `check()` would print a `FAIL -` line for it (the harness increments `failures` and prints that prefix), so no separate negative grep is needed — and none is used, which keeps the gates free of any literal that a doc comment could satisfy or invalidate. This task's own guard block carries at least 12 `check(` call sites, the new block is positive-assertions-only, the four new pins (`_usbeeOnActivate`, `_usbeeOwnedItems`, `awaitingFirstSnapshot === true`, `_usbeeForgetSubMenu`) are present, `CHANGELOG.md` has exactly one `### Fixed` section under `[Unreleased]` (gated independently of the metadata check, so an `awk` failure can no longer be swallowed), and `metadata.json` is unchanged since the batch baseline.</done>
  <reversibility rating="reversible">Test assertions and a changelog entry.</reversibility>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| usbeehive -> popover (session D-Bus) | Untrusted device strings cross here and are re-rendered by the refactored submenu builder |
| dconf/GSettings -> popover | User-writable filter values drive which rows exist |
| USBee -> gnome-shell process | An unhandled exception in a menu handler degrades the whole session UI, not just this extension |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-unh-01 | Tampering | `popover.js` `populateDeviceRowMenu` / `buildPropertyRow` | high | mitigate | The extraction moves daemon-string rendering but must not change it: every value still reaches the UI through `buildPropertyRow`'s `.text =` assignment, never a markup API (T-01-02 / T-02-01 invariant, stated at `popover.js:13-16`). `buildPropertyRow` itself is not edited. |
| T-unh-02 | Denial of Service | `popover.js` `updateDeviceRowsInPlace` row removal | high | mitigate | A destroyed row still referenced by the `_setOpenedSubMenu` shim (`tile.js:64-70`) makes the next row-open call `close()` on a finalised `PopupSubMenu` ("instance is invalid"). Mitigated **without depending on unreadable upstream behaviour** (D-9): `detachAccordionHandler(row)`, then an explicit `section._usbeeForgetSubMenu?.(row.menu)` that nulls the shim-owned field USBee itself wrote, then `row.menu.close(false)`, then `row.destroy()`. The original draft rested this entirely on `close()` calling `_getTopMenu()._setOpenedSubMenu(null)`, which cannot be verified on this machine — if false, the mitigation was a no-op. The same forget call is added to `populateDeviceRows`'s CR-02 cleanup loop, closing the hazard on the pre-existing rebuild path too. Reinforced by the accordion handler reading the live `section._usbeeRows` instead of a captured array. |
| T-unh-05 | Denial of Service | `popover.js` `updateDeviceRowsInPlace` inventory reuse | high | mitigate | Operating on a recorded row inventory that outlived its rows — the case sibling 260915-ung creates, since its `Loading…` row calls `section.removeAll()` from inside `case DaemonState.RUNNING` — would call `isOpen` / `close()` / `destroy()` on finalised rows, the same "instance is invalid" session-level fault. Mitigated in two independent layers: `clearSection` clears the inventory at every teardown site so it cannot go stale, and the ownership gate refuses to act unless `_usbeeOwnedItems` is identity-and-order-equal to `_getMenuItems()`. The `tile.js` `awaitingFirstSnapshot` guard returns earlier still, so the dangerous call is not even reached. |
| T-unh-03 | Denial of Service | `popover.js` `buildOptionsSection` two-way binding | medium | mitigate | On Shell 50 `setToggleState()` emits `toggled` (50:571 -> 564 -> 505 -> 575), so dropping the `syncing` latch would let the popover and prefs surfaces write the same key in a loop (dconf write storm). The latch is retained verbatim and pinned by existing tests; Task 1 upgrades its comment from speculation to evidence. |
| T-unh-04 | Tampering | GSettings filter keys | low | accept | All four keys are read with `get_boolean`, so a hostile dconf value cannot escape the boolean type or reach a string sink. No mitigation needed. |

**Supply chain:** no `npm` / `pip` / `cargo` install is in scope — this task edits
four in-tree files and adds no dependency — so no package-legitimacy gate and no
`T-unh-SC` row applies.
</threat_model>

<verification>
Run from the repo root. Use `rtk proxy` throughout: rtk's filters strip lines
from test output, which would make a pass/fail grep succeed vacuously.

1. **All four suites green, and this task's own guards present.** The
   `66 / 94 / 266 / 57 = 483` figures measured at this plan's baseline
   (`5e6ad7f`) are **stale by the time this item runs** — siblings 260915-unf
   and 260915-ung both add assertions to these suites first — so do NOT gate on
   an absolute total. Gate on: 0 failures in all four suites, and a count of
   `check(` call sites **inside this task's own new guard block** (delimited by
   its `260915-unh` header) that meets the expected minimum. That measures this
   task's contribution and cannot go stale no matter what the siblings did.
2. **Both edited modules parse.** `rtk proxy gjs -m usbee@bitcreed.us/src/popover.js`
   and the same for `src/tile.js`. Note the trap: gjs **exits 0 either way**, so
   the status proves nothing. The gate is that stderr contains `ImportError`
   for a `resource:///` path (proof the file parsed and reached import
   resolution, which cannot succeed outside the Shell) and contains no
   `SyntaxError` / `ReferenceError`.
3. **No string churn — `po/` must not move.** `git diff --quiet -- po/` must
   pass. Independently confirm by regenerating to a scratch path with the
   canonical invocation from CLAUDE.md (input order is load-bearing:
   `usbee@bitcreed.us/prefs.js` FIRST, then `usbee@bitcreed.us/src/*.js`, and
   deliberately NO `--package-version`), then comparing msgid sets.

   **Measure, do not hardcode a count.** This item adds no string, so the
   invariant is *equality across this item's edits*, not any particular number.
   Before touching a file, record the sorted msgid list:
   `grep '^msgid ' po/usbee@bitcreed.us.pot | sort > $SCRATCH/pot-msgids-before`.
   After the edits, regenerate to a scratch `.pot` and assert its sorted msgid
   list is byte-identical to that file (`diff` clean), with `POT-Creation-Date`
   the only difference in the template as a whole. Write the scratch copy
   outside the repo; never overwrite `po/usbee@bitcreed.us.pot`.

   For orientation only — **do not gate on these numbers**: the template held
   **162** msgids at the batch baseline `5e6ad7f`; 260915-unf adds
   `Show details` and 260915-ung adds `Loading…`, both of which run before this
   item, so expect **164** when this item starts. `Starting…` already exists and
   is not new. If the measured before-count is not 164, that is information
   about the siblings, not a failure of this item — the gate is the
   before/after equality.
4. **Diff surface is exactly the four planned files.** `git diff --name-only`
   lists only `usbee@bitcreed.us/src/popover.js`,
   `usbee@bitcreed.us/src/tile.js`, `tests/forward-compat.test.js`,
   `CHANGELOG.md`. In particular `usbee@bitcreed.us/metadata.json` must be
   untouched.
5. **Nothing is released.** No version bump, no annotated tag, nothing pushed
   (`git tag -l 'v2.9*'` unchanged, `origin/master..HEAD` grows only by this
   task's commits).
6. **Do NOT run `gnome-extensions install --force`.** Explicit operator
   constraint, and CLAUDE.md records (quick task 260910-hrj) that it deletes
   through a symlinked dev install into this repo.

## Not verifiable in this session — carry into the SUMMARY as such

The three user-visible truths — the popover staying open on a switch click, the
expanded row staying expanded, and the scroll position holding — live inside
`gnome-shell` and **cannot be observed without a Shell restart** (Xorg:
`Alt+F2` -> `r`; Wayland: full re-login). Restarts are already outstanding
across 260915-i4w, 260915-ikd and 260915-mpf. The preferences window is not a
substitute: it exercises the other end of the binding, not the menu.

The human operator is unavailable, so do not open a blocking checkpoint for
this. Verify everything statically checkable, then state plainly in the SUMMARY
which behaviours were reasoned from the Shell source (cited by version and line)
rather than seen on screen. That is the same posture i4w took, and the reason
this plan cites `popupMenu.js` on both gnome-46 and gnome-50 instead of
assuming.

**Three specific claims must be named in the SUMMARY as reasoned-not-seen, with
their provenance, because they cannot be checked here:**

1. **`toggle()` emits `'toggled'`** (46:476 direct; 50:556 -> `_switch.toggle()`
   -> `notify::state` wired at 50:505 -> `_onToggled` 50:575). Read from
   upstream `js/ui/popupMenu.js` at plan time; **not** re-checkable on this
   machine, where the Shell's JS is absent from disk and from every installed
   `.gresource`. D-8 is the response: the GSettings write is signal-independent,
   so the switches keep working whether or not this holds. Record both the claim
   and the fallback.
2. **Upstream `PopupSubMenu.close()` notifying the top menu** (the
   `_setOpenedSubMenu(null)` path). Same unreadability. D-9 is the response —
   USBee clears its own field — so record that the mitigation no longer depends
   on this claim being true.
3. **Refilling an already-open submenu relayouts correctly.**
   `populateDeviceRowMenu` refills a live `row.menu` via `removeAll()` on the
   `show-technical-details` path (D-5). `removeAll()` leaving `isOpen` untouched
   keeps the panel open, but the submenu actor's height is only natural (`-1`)
   once an open animation has completed, so a refill landing mid-animation could
   in principle leave a clipped panel. Judged low risk and not mitigated; state
   it in the SUMMARY as reasoned, not seen, so a real clipping report has a
   recorded starting point.
</verification>

<success_criteria>
- [ ] Clicking an Options switch with the mouse leaves the Quick Settings popover open (source-level: the row's `activate()` no longer reaches `PopupMenuBase.itemActivated()`).
- [ ] A filter toggle updates the device list in place: no `section.removeAll()` on that path, surviving rows are never re-created, and an expanded row keeps `menu.isOpen` true.
- [ ] A newly visible device is inserted at its sorted index; a newly hidden one is closed, detached and destroyed without leaving a dangling `_openedSubMenu` reference.
- [ ] `show-technical-details` swaps a surviving row's contents; the other three keys do not touch a surviving row at all.
- [ ] The popover header's device/issue counts still agree with the visible rows after a filter toggle, and are left untouched when `updateDeviceRowsInPlace` returns `null`.
- [ ] A filter toggle while 260915-ung's `Loading…` row is on screen changes nothing: `tile.js` returns on `awaitingFirstSnapshot === true`, and even if it did not, the ownership gate would return `null` rather than destroy that row or replace it with `_('No USB devices attached')`.
- [ ] No recorded row inventory can outlive its rows: every `section.removeAll()` in `popover.js` goes through `clearSection`, and the in-place path acts only on an identity-and-order match against `_getMenuItems()`.
- [ ] Clicking an Options switch writes its key even if `toggle()` never emits `'toggled'` (the `_usbeeOnActivate` hook), and writes exactly once when it does.
- [ ] The `syncing` latch survives, documented as load-bearing on Shell 50 with the emitting path cited as source-reasoned rather than locally verified.
- [ ] Four suites, 0 failures; this task's own guard block carries its expected minimum number of `check(` call sites. No gate depends on the stale 266 total.
- [ ] Only documented PopupMenu / St API is used; no new private-internal access beyond `_getMenuItems()`, which this file already used at `popover.js:59` before this task. Every new field (`_usbeeOwnedItems`, `_usbeeOnActivate`, `_usbeeForgetSubMenu`, `_usbeeRows`, `_usbeeShowTech`, `_usbeeDeviceId`) is USBee-owned, not a Shell internal.
- [ ] No new or reworded `_()` string; the sorted msgid list is byte-identical before and after this item's edits; `po/` unchanged; `metadata.json` unchanged; no tag; no push; no extension install.
- [ ] Each inferred decision D-1..D-9 is restated in the SUMMARY as inferred and flagged for audit, and the three unverifiable upstream claims are recorded as reasoned-not-seen.
</success_criteria>

<output>
Create `.planning/quick/260915-unh-stop-the-in-menu-settings-toggle-from-collapsing-the-whole-q/260915-unh-SUMMARY.md` when done.

Commit style follows the batch's quick-task convention, e.g.
`fix(quick-260915-unh): keep the popover open and the device list expanded when a setting is toggled`.
Note for audit, as every prior quick task in this project has:
committing straight to `master` with `git.allow_default_branch_commits` unset
is an inferred decision, not an approved one.
</output>