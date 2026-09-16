---
quick_id: 260915-ung
phase: 260915-ung
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
files_modified:
  - usbee@bitcreed.us/src/daemon-status.js
  - usbee@bitcreed.us/src/device-store.js
  - usbee@bitcreed.us/src/dbus-client.js
  - usbee@bitcreed.us/src/tile.js
  - usbee@bitcreed.us/src/popover.js
  - tests/daemon-status.test.js
  - tests/dbus-client.test.js
  - tests/forward-compat.test.js
  - po/usbee@bitcreed.us.pot
  - CHANGELOG.md

must_haves:
  truths:
    - "Between the daemon appearing on the bus and its first ListDevices reply landing, the tile pill reads USB / Loading… — never Nothing connected."
    - "A popover opened during that window shows a Loading… row, not No USB devices attached."
    - "Once the first snapshot lands and is genuinely empty, both surfaces say Nothing connected / No USB devices attached exactly as they do today."
    - "A daemon restart (name vanishes, then reappears) returns both surfaces to the loading state — the flag is not a one-shot latch that stays satisfied for the session."
    - "A failed ListDevices does not strand either surface in Loading… forever."
    - "A popover already open when the first snapshot lands repaints itself from Loading… to the device list without the user closing and reopening it."
    - "No new polling timer, no new D-Bus call, and no /sys or udev access is introduced."
  artifacts:
    - "usbee@bitcreed.us/src/daemon-status.js — isAwaitingFirstSnapshot() pure predicate, still zero-import"
    - "usbee@bitcreed.us/src/device-store.js — _snapshotReceived field + awaitingFirstSnapshot getter + Loading… tileText branch"
    - "usbee@bitcreed.us/src/popover.js — populateLoadingState() export"
    - "po/usbee@bitcreed.us.pot — regenerated, 163 msgids"
  key_links:
    - "DeviceStore._setDaemonState (device-store.js:386) resets _snapshotReceived on every real state transition — this is what makes the state survive a daemon restart"
    - "DeviceStore.setDevices (device-store.js:373) is the only place _snapshotReceived becomes true"
    - "tile.js _rebuildPopover RUNNING branch (tile.js:216) routes to populateLoadingState instead of populateDeviceRows while awaiting"
    - "dbus-client.js _snapshotImmediate catch (dbus-client.js:528) must conclude the awaiting state, not leave it pending"
---

<objective>
Replace the multi-second "0 devices" flash that follows daemon startup with an
explicit loading state in both the tile pill and the popover.

Purpose: today the tile asserts a falsehood for several seconds. `setDaemonRunning(true)`
(dbus-client.js:329) flips the store to RUNNING *before* `_snapshotImmediate()`
(dbus-client.js:331, async, deliberately not awaited) has anything to put in it, so
`tileText` (device-store.js:342) takes the RUNNING branch, `deriveTileText` falls all
the way through to Tier 4, and the pill reads "Nothing connected" (device-store.js:270)
while the popover reads "No USB devices attached" (popover.js:115). Both statements are
wrong: nothing has been counted yet.

Output: a third, derived state — *daemon present, first snapshot not yet received* —
rendered as "Loading…" on both surfaces, driven entirely off the existing name-watch and
snapshot plumbing.
</objective>

<context>
@CLAUDE.md
@.planning/STATE.md

@usbee@bitcreed.us/src/daemon-status.js
@usbee@bitcreed.us/src/device-store.js
@usbee@bitcreed.us/src/dbus-client.js
@usbee@bitcreed.us/src/tile.js
@usbee@bitcreed.us/src/popover.js
@tests/daemon-status.test.js
@tests/dbus-client.test.js
</context>

<design_decisions>
The human operator is unavailable. These were inferred from the code and prior quick-task
precedent, and are flagged here for later audit.

**D-01 — The third state is an orthogonal boolean on DeviceStore, NOT a fifth
`DaemonState`.** `DaemonState` (daemon-status.js:81) answers "what is the daemon's
liveness/version status"; "have we heard back yet" is a different question that is only
meaningful while RUNNING. A fifth enum value would also ripple somewhere expensive:
`daemonRunning` (device-store.js:335) is derived as `state === RUNNING`, and
`_onProxyOwnerAcquired` guards on it (dbus-client.js:454) to stay idempotent — a
STARTING state would read as not-running there and re-drive a second snapshot. The
frozen four-value enum and its "the four states are distinct" assertion
(daemon-status.test.js:123) therefore stay exactly as they are. The tri-state the task
asks for is the *derived* triple: absent (`daemonState !== RUNNING`), loading
(`RUNNING && !_snapshotReceived`), loaded (`RUNNING && _snapshotReceived`).

**D-02 — A failed `ListDevices` concludes the loading state rather than stranding it.**
`_snapshotImmediate`'s catch (dbus-client.js:528) keeps prior store state by design and
waits for the next signal to retry. Without an explicit hand-off the store would sit in
`awaitingFirstSnapshot` indefinitely and the pill would read "Loading…" forever — a worse
lie than the one being fixed. On failure the extension falls back to exactly today's
behaviour (empty list → "Nothing connected"), which is honest about having nothing to show.

**D-03 — The open-popover repaint is a narrow loading→loaded latch, not a blanket
rebuild-on-changed.** `'ready'` is emitted at dbus-client.js:332, one line *after* the
un-awaited `_snapshotImmediate()` call — so tile.js's existing `'ready'` repaint
(tile.js:108) fires while the store is still empty and cannot be the trigger. A general
"rebuild whenever the store changes" would tear the menu down on every snapshot, which is
both against D-11 lazy-rebuild and the exact behaviour sibling item 260915-unh is being
asked to remove. The latch rebuilds on one transition only.

**D-04 — The predicate lives in the zero-import `daemon-status.js`.** Direct precedent:
quick task 260915-i4w put `isBuiltInDevice` in the zero-import `link-verdict.js`
"so bare-gjs CI can unit-test it rather than only guard it structurally". `device-store.js`
imports the gnome-shell extension resource URI for gettext and therefore cannot be loaded
under bare gjs at all. A pure boolean function carries no user-visible string, so it does
not violate that module's no-strings rule (daemon-status.js:23-25).

**D-05 — One msgid, `_('Loading…')`, shared by the tile and the popover row.** Two names
for one state is how a user comes to believe there are two states. Ellipsis is U+2026, per
the existing `_('Preferences…')` (tile.js:161) and `_('Starting…')` (empty-state.js:249).

**D-06 — CHANGELOG entry under `## [Unreleased]`; no version bump, no tag, no push, no
`gnome-extensions install`.** Per the operator's constraints and the fact that v2.9.0 was
cut locally and is still unreleased.
</design_decisions>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Wire the loading state end-to-end — store predicate through to both surfaces</name>
  <files>usbee@bitcreed.us/src/daemon-status.js, usbee@bitcreed.us/src/device-store.js, usbee@bitcreed.us/src/popover.js, usbee@bitcreed.us/src/tile.js</files>
  <behavior>
    - Fresh store, daemon not on the bus: not awaiting (nothing has been promised yet).
    - Daemon appears, no snapshot yet: awaiting → pill subtitle is the loading string, popover shows the loading row.
    - Snapshot of zero devices arrives: no longer awaiting → pill reads "Nothing connected", popover reads "No USB devices attached".
    - Daemon vanishes then reappears: awaiting again, because the reset is keyed on the state transition and not on a session-lifetime latch.
    - OUT_OF_DATE / TOO_NEW: never awaiting — those branches own their own copy and must be untouched.
  </behavior>
  <action>
Add a pure predicate `isAwaitingFirstSnapshot(daemonState, snapshotReceived)` to
`usbee@bitcreed.us/src/daemon-status.js`, exported, returning true iff
`daemonState === DaemonState.RUNNING && snapshotReceived !== true`. It must import
nothing and contain no user-visible string — that module's cross-process contract
(daemon-status.js:7-25) is asserted directly by tests/daemon-status.test.js:170.

In `usbee@bitcreed.us/src/device-store.js`:
- Import `isAwaitingFirstSnapshot` alongside the existing `DaemonState` import (line 25).
- Add `this._snapshotReceived = false;` to the constructor (beside `_daemonVersion`,
  device-store.js:323).
- Add a `get awaitingFirstSnapshot()` getter delegating to the predicate with
  `this._daemonState` and `this._snapshotReceived`.
- In `setDevices` (device-store.js:373) set `this._snapshotReceived = true;` before the
  existing `this.emit('changed')`.
- In `_setDaemonState` (device-store.js:386) set `this._snapshotReceived = false;` after
  the early-return guard and alongside the two existing field writes. Placing it after the
  guard is load-bearing: the guard already suppresses no-op re-asserts, so an idempotent
  `setDaemonRunning(true)` cannot wrongly re-arm the loading state, while a real
  STOPPED→RUNNING transition on daemon restart always does. This is the single write path
  for daemon lifecycle, which is why the flag survives restarts without any extra bookkeeping.
- In the `get tileText()` switch (device-store.js:342), inside `case DaemonState.RUNNING`,
  return `{title: _('USB'), subtitle: _('Loading…')}` when `this.awaitingFirstSnapshot` is
  true, before delegating to `deriveTileText`. Mark the ellipsis with a trailing U+2026
  comment, matching tile.js:161. Do NOT touch `deriveTileText` itself — it is a pure
  function over a device array and knows nothing about daemon lifecycle; several
  forward-compat assertions depend on its tiers.

In `usbee@bitcreed.us/src/popover.js` add an exported `populateLoadingState(section)`
directly after `populateEmptyState` (popover.js:231), following that function's exact
shape: `section.removeAll()` first (Pitfall C), then add one
`PopupMenu.PopupMenuItem` carrying `_('Loading…')` with `{reactive: false, can_focus: false}`
— the same options the bus-empty row uses at popover.js:116. Reuse the identical msgid so
the tile and the popover cannot drift (D-05). Do not build an empty-state item: this is a
transient row, not one of the daemon-missing states, and it carries no command and no button.

In `usbee@bitcreed.us/src/tile.js`:
- Import `populateLoadingState` from './popover.js' alongside the existing named imports
  (tile.js:20).
- In `_rebuildPopover`'s `case DaemonState.RUNNING` (tile.js:216), when
  `this._store.awaitingFirstSnapshot` is true call `populateLoadingState(this._rowsSection)`
  and break, leaving `n` at its initialised `-1` and `issues` at 0. That falls through to the
  existing header expression (tile.js:246), which already renders the count-free
  `_('USB devices')` title for `n === -1` — so no new header string is needed.
  </action>
  <verify>
    <automated>rtk proxy gjs -m tests/daemon-status.test.js &amp;&amp; rtk proxy gjs -m tests/dbus-client.test.js &amp;&amp; rtk proxy gjs -m tests/forward-compat.test.js &amp;&amp; rtk proxy gjs -m tests/service-probe.test.js</automated>
    <automated>test "$(grep -vE '^\s*(//|\*|/\*)' usbee@bitcreed.us/src/daemon-status.js | grep -c 'export function isAwaitingFirstSnapshot')" -ge 1 &amp;&amp; test "$(grep -vE '^\s*(//|\*|/\*)' usbee@bitcreed.us/src/device-store.js | grep -c 'get awaitingFirstSnapshot()')" -ge 1 &amp;&amp; test "$(grep -vE '^\s*(//|\*|/\*)' usbee@bitcreed.us/src/popover.js | grep -c 'export function populateLoadingState')" -ge 1 &amp;&amp; test "$(grep -vE '^\s*(//|\*|/\*)' usbee@bitcreed.us/src/tile.js | grep -c 'populateLoadingState(this._rowsSection)')" -ge 1</automated>
    <automated>test "$(grep -cE '^\s*import\s' usbee@bitcreed.us/src/daemon-status.js)" = 0</automated>
  </verify>
  <done>All four suites still pass (no regression below the 66/94/266/57 baseline). The predicate, the store getter, the popover export and the tile routing all exist in code (not merely in comments). daemon-status.js still has zero import statements.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Close the two liveness edges — failed snapshot, and a popover already open when data lands</name>
  <files>usbee@bitcreed.us/src/device-store.js, usbee@bitcreed.us/src/dbus-client.js, usbee@bitcreed.us/src/tile.js</files>
  <behavior>
    - ListDevices rejects: the store stops awaiting, emits 'changed', and the surfaces fall back to today's empty-list copy rather than showing the loading string indefinitely.
    - A ListDevices failure never fabricates a device list — the existing "keep prior store state" contract holds.
    - Popover open and showing the loading row when the first snapshot lands: it repaints to the device list once, by itself.
    - Popover open and already showing devices: a routine re-snapshot does NOT rebuild the menu (the latch has been cleared).
  </behavior>
  <action>
Add `noteSnapshotFailed()` to DeviceStore in `usbee@bitcreed.us/src/device-store.js`,
placed next to `setDevices`. It sets `this._snapshotReceived = true` and emits `'changed'`
if and only if the flag was previously false; otherwise it returns without emitting, so a
repeated failure cannot storm the tile with redundant repaints. It must NOT touch
`this._devices` — preserving the deliberate "keep prior store state, let the next signal
retry" contract documented at dbus-client.js:529-530. Document at the definition that this
concludes the awaiting state without asserting anything about what is attached (D-02).

In `usbee@bitcreed.us/src/dbus-client.js`, inside `_snapshotImmediate`'s catch block
(dbus-client.js:528), call `this._store.noteSnapshotFailed?.()` before the existing
`logError`. Use optional-call syntax: the unit-test doubles in tests/dbus-client.test.js
implement only the store surface the paths under test touch, and several existing tests
construct stores through `makeStore()` (tests/dbus-client.test.js:55) that this plan
extends but that other call sites may not. Change nothing else in that method — no retry,
no new timer, no second D-Bus call.

In `usbee@bitcreed.us/src/tile.js` add the loading→loaded repaint latch:
- Initialise `this._renderedLoading = false;` in the constructor beside the other
  instance fields (near tile.js:40).
- At the end of `_rebuildPopover` (tile.js:204-254) record what was just rendered:
  set `this._renderedLoading` to true in the branch that called `populateLoadingState`,
  and to false in every other branch. Assigning it from the same condition the routing
  switch used keeps the two from drifting.
- In the existing store `'changed'` handler (tile.js:86), after the title/subtitle/checked
  writes, rebuild only on the transition: when `this.menu.isOpen` and
  `this._renderedLoading` and `!this._store.awaitingFirstSnapshot`, call
  `this._rebuildPopover()`. Because `_rebuildPopover` clears the latch on the way out,
  this fires at most once per loading episode. Do not broaden this into an unconditional
  rebuild-on-changed — D-11 lazy rebuild, and a blanket rebuild would collapse any open
  device submenu on every snapshot (D-03).
  </action>
  <verify>
    <automated>rtk proxy gjs -m tests/dbus-client.test.js &amp;&amp; rtk proxy gjs -m tests/daemon-status.test.js</automated>
    <automated>test "$(grep -vE '^\s*(//|\*|/\*)' usbee@bitcreed.us/src/dbus-client.js | grep -c 'noteSnapshotFailed')" -ge 1 &amp;&amp; test "$(grep -vE '^\s*(//|\*|/\*)' usbee@bitcreed.us/src/tile.js | grep -c '_renderedLoading')" -ge 3</automated>
    <automated>D=$(rtk proxy git diff -U0 5e6ad7f -- usbee@bitcreed.us/src/dbus-client.js usbee@bitcreed.us/src/device-store.js usbee@bitcreed.us/src/tile.js usbee@bitcreed.us/src/popover.js) || exit 1; test "$(printf '%s' "$D" | grep -cE '^\+.*(timeout_add|setInterval|bus_watch_name|ListDevicesRemote)' || true)" = 0</automated>
  </verify>
  <done>Both edges are handled. The diff introduces no new timer, no new name-watch, and no new ListDevices call — the state is driven purely off the existing plumbing. Suites still green.</done>
</task>

<task type="auto">
  <name>Task 3: Regression coverage, translation template, changelog</name>
  <precondition>`xgettext` and `msgfmt` are on PATH (GNU gettext); the repo root is the working directory.</precondition>
  <files>tests/daemon-status.test.js, tests/dbus-client.test.js, tests/forward-compat.test.js, po/usbee@bitcreed.us.pot, CHANGELOG.md</files>
  <action>
**tests/daemon-status.test.js** — add `isAwaitingFirstSnapshot` to the existing import
from `../usbee@bitcreed.us/src/daemon-status.js` (line 31) and add a new `print('# ...')`
block of real unit assertions after the `# DaemonState` block (ends line 131): true for
RUNNING with the flag false; false for RUNNING with it true; false for STOPPED,
OUT_OF_DATE and TOO_NEW regardless of the flag; and false for an unknown future state
value, so the predicate fails closed the way the rest of this module does. Then extend the
existing `# device-store.js owns the tri-state` structural block (lines 204-224) with
guards that the store exposes `get awaitingFirstSnapshot()`, keeps a `_snapshotReceived`
field, resets it inside `_setDaemonState`, and sets it in `setDevices` — that reset
placement is the property that makes a daemon restart return to loading, so it is worth
pinning explicitly rather than implicitly.

**tests/dbus-client.test.js** — extend the `makeStore()` double (lines 55-84) with a
`snapshotReceived` field plus `noteSnapshotFailed()` recording into `calls`, and keep
`setDevices` (line 82) in step by setting the field true, so the double keeps mirroring
the real store surface the way its header comment (lines 50-54) promises. Add a test
driving a proxy whose `ListDevicesRemote` invokes its callback with an error, asserting
that `noteSnapshotFailed` was recorded and that `setDevices` was NOT called. Add a second
assertion on the appearance path that `setDaemonRunning` is recorded in `calls` before any
`setDevices` — that ordering is the bug's root cause and a future reordering would
silently reintroduce the flash.

**tests/forward-compat.test.js** — extend the existing popover block (lines 649-664) with
guards that `popover.js` exports `populateLoadingState` and that the loading row is
distinct from both existing empty strings; extend the device-store block (lines 1059-1072)
with a guard that `device-store.js` carries a loading branch in `tileText`. Follow the file's
established `readSource` + `src.includes(...)` idiom. Make each guard match a code-shaped
substring (for instance the getter signature, or the export statement) rather than the bare
translated literal alone, so a mention in a comment cannot satisfy it — the trap quick task
260910-p91 documented.

**po/usbee@bitcreed.us.pot** — regenerate with the exact recorded invocation from
CLAUDE.md → Release Process → Regenerating the translation template. `prefs.js` comes
FIRST, then `usbee@bitcreed.us/src/*.js`; `--from-code=UTF-8` and `--package-name=USBee`
are passed and `--package-version` deliberately is not. Do not hand-edit the file.
Inspect the diff: it must carry `POT-Creation-Date`, the new msgid block, and line-reference
churn — nothing else. The header must still read `Project-Id-Version: USBee` with no
version number (260915-mk0).

**CHANGELOG.md** — under the empty `## [Unreleased]` heading (line 9), add a `### Fixed`
section with one user-facing entry, written in the voice of the existing 2.9.0 entries
(what the user sees, not the mechanism): the list no longer claims nothing is connected
in the seconds after the daemon starts, and says it is still loading instead. Do not add a
version heading, do not touch `metadata.json`, do not tag, do not push.
  </action>
  <verify>
    <automated>rtk proxy gjs -m tests/daemon-status.test.js &amp;&amp; rtk proxy gjs -m tests/dbus-client.test.js &amp;&amp; rtk proxy gjs -m tests/forward-compat.test.js &amp;&amp; rtk proxy gjs -m tests/service-probe.test.js</automated>
    <automated>test "$(rtk proxy gjs -m tests/daemon-status.test.js | grep -c '^  ok')" -gt 94 &amp;&amp; test "$(rtk proxy gjs -m tests/dbus-client.test.js | grep -c '^  ok')" -gt 66 &amp;&amp; test "$(rtk proxy gjs -m tests/forward-compat.test.js | grep -c '^  ok')" -gt 266 &amp;&amp; test "$(rtk proxy gjs -m tests/service-probe.test.js | grep -c '^  ok')" -ge 57</automated>
    <automated>test "$(grep '^msgid ' po/usbee@bitcreed.us.pot | wc -l)" = 163 &amp;&amp; grep -q '^"Project-Id-Version: USBee\\n"' po/usbee@bitcreed.us.pot &amp;&amp; msgfmt --check-format -o /dev/null po/usbee@bitcreed.us.pot</automated>
    <automated>rtk proxy git diff --quiet 5e6ad7f -- usbee@bitcreed.us/metadata.json &amp;&amp; echo "version fields untouched since the planning baseline"</automated>
  </verify>
  <done>All four suites pass with strictly more assertions than the 66/94/266/57 baseline in the three extended suites and exactly 57 in the untouched one. The .pot has 163 msgids (162 + the one new string), a version-free Project-Id-Version header, and passes msgfmt --check-format. CHANGELOG.md has an [Unreleased] → Fixed entry. metadata.json is untouched.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| usbeehive daemon → USBee (session D-Bus) | Untrusted-by-default data crosses here. Any process owning `org.usbeehive.Devices` on the session bus can drive this state machine. |
| GSettings → popover | Local user config; unchanged by this plan. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ung-01 | Denial of Service | `DeviceStore._snapshotReceived` / `dbus-client.js _snapshotImmediate` | low | mitigate | A process that grabs the bus name and never answers `ListDevices` would pin the UI in "Loading…". Task 2 (D-02) concludes the awaiting state on failure, so the surface degrades to today's copy instead of a permanent spinner. |
| T-ung-02 | Spoofing | session bus name ownership | low | accept | Any session process can own the name — true before this change and unchanged by it. The session bus is already inside the user's trust boundary; USBee does not authenticate the daemon beyond the existing Version gate (dbus-client.js:351). |
| T-ung-03 | Information Disclosure | new UI string | low | accept | The loading row renders one static, translated literal. No daemon-supplied text reaches it, so the verbatim-`.text` invariant (popover.js:13-16) is not newly exercised. |
| T-ung-04 | Tampering | supply chain | low | accept | No package-manager install (npm/pip/cargo) is in scope — this plan edits existing repo files only, adds no dependency, and runs no installer. No legitimacy checkpoint is required. |
</threat_model>

<verification>
**Baseline commit: `5e6ad7f`** — the repo HEAD when this plan was written, verified clean
apart from untracked `.gsd/` and `.planning/quick-batches/`. Diff gates below pin that SHA
and compare it against the *working tree*, so they report the same answer whether or not the
executor has already committed a task (a bare `git diff` would pass vacuously post-commit).

- All four gjs suites pass: `rtk proxy gjs -m tests/{dbus-client,daemon-status,forward-compat,service-probe}.test.js`.
- Assertion count rises in the three extended suites; service-probe stays at its 57.
- `.pot` regenerated with the recorded invocation; 163 msgids; version-free header; `msgfmt --check-format` clean.
- `rtk proxy git diff --name-only 5e6ad7f` lists only the ten files in `files_modified`.
- No new timer / name-watch / D-Bus call in the diff (gated in Task 2).
- Version fields untouched; no tag; nothing pushed; no `gnome-extensions install`.
</verification>

<success_criteria>
The three states are distinguishable in code and on screen: daemon absent (existing empty
states, unchanged), daemon present with no snapshot yet ("Loading…" on both surfaces), and
snapshot received with genuinely zero devices (existing copy, unchanged). The distinction is
derived from the existing name-watch and snapshot plumbing with no new polling. Every new
user-visible string goes through gettext and appears in the regenerated template.
</success_criteria>

<manual_verification_note>
The popover and tile cannot be exercised without a GNOME Shell restart, and a Shell restart
is already outstanding across quick tasks 260915-i4w, 260915-ikd and 260915-mpf (STATE.md).
The installed extension at `~/.local/share/gnome-shell/extensions/usbee@bitcreed.us` is a
real directory holding released v2.9.0, not a symlink to this checkout, so nothing in this
plan changes what is loaded in the running session. Do not run
`gnome-extensions install --force` (operator constraint, and the 260910-hrj hazard).
Automated coverage is therefore the gate; visual confirmation is deferred to the next
Shell restart.
</manual_verification_note>

<output>
Create `.planning/quick/260915-ung-replace-the-multi-second-0-devices-flash-after-the-daemon-st/260915-ung-SUMMARY.md` when done.
</output>
