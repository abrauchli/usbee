---
quick_id: 260915-ung
phase: 260915-ung
plan: 01
status: complete
subsystem: gnome-shell-extension-ui
tags: [daemon-lifecycle, empty-state, i18n, device-store, popover, tile]
batch: 260915-une
batch_position: 2 of 3
isolation: none (inline on master, operator-mandated single working tree)

requires:
  - "usbeehive daemon on the session bus (org.usbeehive.Devices5) — unchanged"
provides:
  - "isAwaitingFirstSnapshot(daemonState, snapshotReceived) — pure predicate in the zero-import daemon-status.js"
  - "DeviceStore.awaitingFirstSnapshot getter + _snapshotReceived field"
  - "DeviceStore.noteSnapshotFailed() — concludes the wait without asserting a device list"
  - "popover.js populateLoadingState(section)"
affects:
  - "tile pill subtitle while the daemon is starting"
  - "popover device list while the daemon is starting"

tech-stack:
  added: []
  patterns:
    - "Derived tri-state as an orthogonal boolean on the store, not a fifth enum value"
    - "Failure path concludes a transient UI state rather than stranding it"
    - "One msgid shared by two surfaces so they cannot drift"

key-files:
  created: []
  modified:
    - usbee@bitcreed.us/src/daemon-status.js
    - usbee@bitcreed.us/src/device-store.js
    - usbee@bitcreed.us/src/dbus-client.js
    - usbee@bitcreed.us/src/popover.js
    - usbee@bitcreed.us/src/tile.js
    - tests/daemon-status.test.js
    - tests/dbus-client.test.js
    - tests/forward-compat.test.js
    - po/usbee@bitcreed.us.pot
    - CHANGELOG.md

decisions:
  - "D-01 kept: orthogonal boolean, not a fifth DaemonState — a STARTING value would read as not-running in daemonRunning, which _onProxyOwnerAcquired guards on, re-driving a second snapshot"
  - "D-02 kept: a failed ListDevices concludes the wait rather than stranding it in Loading… forever"
  - "D-03 kept: narrow loading→loaded repaint latch, not a blanket rebuild-on-changed"
  - "D-04 kept: predicate lives in the zero-import daemon-status.js so bare-gjs CI can unit-test it"
  - "D-05 kept: one msgid _('Loading…') (U+2026) shared by tile and popover"
  - "D-06 kept: CHANGELOG under [Unreleased]; no version bump, no tag, no push, no install"

metrics:
  duration: ~18m
  completed: 2026-09-15
  tasks: 3
  commits: 3
  plan_head_before: 292751962ff2f18b76552a8c3786ac000fa0c9a8
  assertions_before: 509
  assertions_after: 542
---

# Quick Task 260915-ung: Loading state instead of a "0 devices" flash — Summary

Replaced the multi-second "Nothing connected" / "No USB devices attached" lie
that followed daemon startup with an explicit **Loading…** state on both
surfaces, driven entirely off the existing name-watch and snapshot plumbing.

## What was wrong

`setDaemonRunning(true)` (dbus-client.js:329) flips the store to RUNNING one
line *before* the deliberately un-awaited `_snapshotImmediate()` has anything
to put in it. `tileText` therefore took the RUNNING branch, `deriveTileText`
fell all the way through to Tier 4, and the pill read "Nothing connected"
while the popover read "No USB devices attached". Both statements asserted an
absence nobody had measured.

The fix is the third, *derived* state the code could not previously express:
absent (`daemonState !== RUNNING`), loading (`RUNNING && !_snapshotReceived`),
loaded (`RUNNING && _snapshotReceived`).

## Tasks

| # | Commit | What |
|---|--------|------|
| 1 | `b50210c` | Predicate → store → both surfaces, end to end (tracer) |
| 2 | `3b5a7fe` | The two liveness edges: failed snapshot, popover open when data lands |
| 3 | `e37ed78` | Regression coverage, `.pot` regeneration, changelog |

**Task 1** — `isAwaitingFirstSnapshot()` added to the zero-import
`daemon-status.js` (still zero imports, still no user-visible string);
`_snapshotReceived` + `awaitingFirstSnapshot` on `DeviceStore`; a `Loading…`
branch in `tileText`; `populateLoadingState()` in `popover.js`; tile routing
in the RUNNING branch, leaving `n` at `-1` so the existing header expression
renders the count-free `_('USB devices')` title — no new header string needed.

The re-arm lives in `_setDaemonState` **after** its no-op guard. That placement
is the whole mechanism: the guard already swallows idempotent
`setDaemonRunning(true)` re-asserts, so those cannot wrongly re-arm the wait,
while a genuine STOPPED→RUNNING on daemon restart always does. The state
survives restarts with no extra bookkeeping and is not a session-lifetime latch.

`deriveTileText` was deliberately left untouched — it is a pure function over a
device array and knows nothing about daemon lifecycle; several forward-compat
tiers depend on that, and a test now pins it.

**Task 2** — `noteSnapshotFailed()` concludes the wait without touching
`_devices`, preserving `_snapshotImmediate`'s "keep prior store state, let the
next signal retry" contract; it emits only on the false→true edge so a daemon
failing every retry cannot storm the tile. The tile latches what the last
rebuild rendered and repaints only on the loading→loaded transition. The
existing `'ready'` handler could not serve here — it is emitted one line *after*
the un-awaited `_snapshotImmediate()`, while the store is still empty.

## Verification

All four suites green under `rtk proxy`, **509 → 542 assertions**:

| Suite | Before | After |
|-------|--------|-------|
| daemon-status | 120 | **138** |
| dbus-client | 66 | **74** |
| forward-compat | 266 | **273** |
| service-probe | 57 | **57** (untouched, exactly) |

- `.pot` regenerated with the exact recorded invocation (`prefs.js` first, no
  `--package-version`): **163 → 164 msgids**, the single addition being
  `msgid "Loading…"`. Header still reads `Project-Id-Version: USBee` with no
  version number. `msgfmt --check-format` clean. Not hand-edited.
- No new timer, name-watch, or `ListDevicesRemote` call anywhere in the diff —
  gated against both `5e6ad7f` and the batch baseline `2927519`, 0 additions each.
- Exactly the **10 planned files** changed; no deletions anywhere in the range.
- `metadata.json` untouched; no tag, no push, no `gnome-extensions install`.

Each new guard matches **code-shaped text** (an export statement, a getter
signature, a sliced function body) rather than a bare translated literal, so a
mention in a comment cannot satisfy it — the trap quick task 260910-p91
documented. Verified non-vacuous by grepping the new assertion names out of
live suite output rather than trusting the totals.

## Deviations from plan

**1. [Coordinator addendum] `.pot` gate corrected 163 → 164.** The plan
hard-coded `test ... = 163`, written against baseline `5e6ad7f`. Sibling
`260915-unf` had since added `_('Show details')`, putting the file at 163
*before* this task. Measured rather than assumed: 163 → 164. The plan's
matching `<done>` prose is superseded.

**2. [Coordinator addendum] Assertion baseline corrected.** The plan's
`66/94/266/57 = 483` was stale; `unf` added 26 assertions to
`tests/daemon-status.test.js`. Real baseline was `66/120/266/57 = 509`, measured
before touching anything. All gates were applied relative to that.

**3. [Rule 1 — plan self-inconsistency, reconciled]** Task 3's `<done>` said
"exactly 57 in the untouched one" while its gate read `-ge 57`. Service-probe
came out at **exactly 57**, so both readings hold; recorded here as the
stricter "exactly 57".

**4. [Coordinator addendum] `### Fixed` reused, not duplicated.** `unf` had
already opened one under `## [Unreleased]`; the new bullet was appended there.
Verified exactly one `### Fixed` heading in that section.

**5. [Rule 2 — adopted from `unf`'s run] ESM syntax check added.** These
modules are never *loaded* by any suite — every assertion reads their source as
text — so a syntax error would pass every structural gate silently. Each edited
module and test file was parsed with `node --check` via a `.mjs` copy (plain
`node --check` treats `.js` as CommonJS and rejects `import`). All parse.

**6. [Plan anchors treated as hints]** `unf` had shifted `popover.js`; every
anchor was re-located by symbol/text before editing rather than by line number.

## Scope held

Sibling `260915-unh`'s work was **not** pre-empted: no `clearSection()` helper
and no `_usbeeOwnedItems` ownership bookkeeping were introduced.
`populateLoadingState` calls `section.removeAll()` directly, exactly as the
four sibling `populate*State` functions do, leaving `unh` a uniform set of call
sites to refactor.

## Known stubs

None.

## Owed to the human

- **Visual confirmation is pending a GNOME Shell restart.** The popover and
  tile cannot re-render until then, so the result was verified *structurally*
  only — this is explicitly **not** claimed as observed. The installed
  extension at `~/.local/share/gnome-shell/extensions/usbee@bitcreed.us` is a
  real directory holding released v2.9.0, not a symlink to this checkout, so
  nothing here changes the running session. Restart debt now spans
  **i4w, ikd, mpf, unf and ung**.
- **Flagged for audit:** committed directly to `master` with
  `git.allow_default_branch_commits` still unset — operator-mandated for this
  batch (single working tree, all three items collide on the same files) and
  the established pattern of every prior quick task in this project.
- The specific window being fixed is inherently timing-dependent; when the
  Shell is next restarted, the check is that a daemon start shows **Loading…**
  rather than a count of zero, and that an genuinely empty machine still reads
  "Nothing connected" once the first snapshot lands.

## Self-Check: PASSED

All 10 modified files present on disk; all 3 commit hashes
(`b50210c`, `3b5a7fe`, `e37ed78`) resolve in `git log`; commit count measured
from the persisted ledger base `2927519` as **3**.
