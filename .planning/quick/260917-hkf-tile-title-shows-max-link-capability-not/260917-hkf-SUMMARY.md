---
phase: 260917-hkf
plan: 01
subsystem: quick-settings-tile
status: complete
tags: [tile, link-capability, gettext, link-verdict, wire-04]
requires:
  - "link-verdict.js propsOf/intProp/formatRate (existing)"
  - "usbeehive org.usbeehive.Devices5 usb_capable_speed_mbps property"
provides:
  - "formatCapabilityBrand() — USB-IF closed-up rate brand for a capability ceiling"
  - "deriveCapabilityTile() — tile ranking + subtitle-kind tokens, zero-import"
affects:
  - "Quick Settings tile title and subtitle (deriveTileText Tier 2)"
tech-stack:
  added: []
  patterns:
    - "Pure logic in the zero-import module, gettext mapping in the shell-importing one"
    - "Brand typography (5Gbps) kept distinct from measured typography (5 Gb/s)"
key-files:
  created: []
  modified:
    - "usbee@bitcreed.us/src/link-verdict.js"
    - "usbee@bitcreed.us/src/device-store.js"
    - "usbee@bitcreed.us/src/popover.js"
    - "tests/forward-compat.test.js"
    - "po/usbee@bitcreed.us.pot"
decisions:
  - "Ranking lives in link-verdict.js so it is really unit-testable in CI (ID-01)"
  - "formatCapabilityBrand returns '' below 1 Mbps, matching formatRate's convention (ID-02)"
  - "Four msgids added — 'full capability' is new wording reuse, not msgid reuse (ID-03)"
  - "The brand table ships verbatim from the spec, including its two divergences from the daemon (ID-04)"
metrics:
  duration: ~20m
  completed: 2026-09-17
actuals:
  tokens: 34000
  tasks: 3
  commits: 3
plan_head_before: 0104722ce1c47d8d298c6b12b9b457db67534478
---

# Quick Task 260917-hkf: Tile Title Shows Max Link Capability Summary

The Quick Settings tile title now names the best attached link capability as a
USB-IF rate brand (`USB 5Gbps`) with a subtitle saying whether that capability
is actually being reached, replacing the `USB <bcdUSB>` title whose commonest
value named no real USB specification.

## What Was Built

**`usbee@bitcreed.us/src/link-verdict.js:133-176` — `formatCapabilityBrand(mbps)`.**
Descending bucket table returning USB-IF closed-up brand form (`80Gbps` …
`1.5Mbps`), `''` below 1 Mbps and for non-finite input. The docstring records
that the edges mirror the daemon's `link_speed_tier()` (usbeehive
`src/usb.rs:362-375`, read and confirmed during execution), the two deliberate
divergences from it, and why the brand typography is intentionally different
from `formatRate()`'s measured form.

**`usbee@bitcreed.us/src/link-verdict.js:564-634` — `deriveCapabilityTile(devices)`.**
Ranks on the capability ceiling (declared `usb_capable_speed_mbps`, else the
negotiated rate), tie-breaks on the negotiated rate, then on id. Returns
tokens — `{id, ceiling, capableMbps, negotiatedMbps, brand, subtitleKind}` — or
`null`. Admission is a single positive `ceiling > 0` test; there is no
descriptor-version test anywhere in the helper, and Type-C port rows are
excluded by that one test because they carry neither a speed nor a capability.

**`usbee@bitcreed.us/src/device-store.js:243-285` — Tier 2 rewritten.** A pure
gettext mapping over the helper: `_('USB %s')` for the title, and
`_('full capability')` / `_('not linked')` / `_('linked at %s')` for the
subtitle, the last formatted through the same `formatRate()` the popover's Link
row uses. The template-literal title is deleted outright with no fallback; a
`null` result falls through to the untouched Tier 3.

**Comment hygiene.** `popover.js:925-932` and `link-verdict.js:234-236` both
claimed `usb_version` still rendered in the tile title; restated as on the wire
and rendered nowhere.

`hasLinkIssue()` and Tier 0 are byte-unchanged — verified by inspecting the
removed lines of the `link-verdict.js` diff, which are only the two lines of the
widened `usbVersion` comment. `BelowCapability` still never looks like a fault.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Both helpers + Tier 2 rewrite (tracer) | `2acd7c1` | link-verdict.js, device-store.js, popover.js |
| 2 | Unit tests + repaired device-store guards | `c2aa8ba` | tests/forward-compat.test.js |
| 3 | Regenerated translation template | `e4a8ca0` | po/usbee@bitcreed.us.pot |

## Verification Results

**All four gjs suites green, zero `FAIL -` lines, all exit 0:**

| Suite | Before | After |
|-------|--------|-------|
| forward-compat | 292 | 341 |
| dbus-client | 74 | 74 |
| daemon-status | 138 | 138 |
| service-probe | 57 | 57 |
| **total** | **561** | **610** |

49 new assertions: 22 for `formatCapabilityBrand`'s bucket edges and total-
function edges, 21 for `deriveCapabilityTile`'s eight behaviour cases plus
garbage-input cases, 6 new structural guards on `device-store.js`.

**Tracer (Task 1) reproduced both live results from the task spec.** The
reporting machine's 3-way capability tie resolves to the device negotiated at
5000 (`5Gbps` / `full`); with that device removed the winner is still `5Gbps`
but `linked` at a `formatRate` of `480 Mb/s`. An empty array returns `null`.

**`node --check`** passes on `.mjs` copies of `device-store.js`, `popover.js`
and `link-verdict.js`.

**No `usb_version` render site remains anywhere in the UI.**
`grep -rn 'usb_version\|usbVersion' usbee@bitcreed.us/src/ usbee@bitcreed.us/prefs.js`
returns four hits, all non-rendering: the `deriveLinkInfo` token field and its
jsdoc (`link-verdict.js:205,237`), the `tuple[16]` wire unpack
(`device-store.js:57`), and one prose comment (`popover.js:925`).

**Negative guard shown non-vacuous.** Before the change, the hand-sliced
`deriveTileText` body was 6171 chars and `/title:\s*`/` matched it; after, the
same slice does not match.

**`.pot`:** `msgfmt --check-format` clean. Diff is exactly +4 / −0 msgids
(`USB %s`, `linked at %s`, `not linked`, `full capability`); `USB %s` and
`linked at %s` both carry `javascript-format`; the popover's
`%s — full capability` is present and unchanged; `Project-Id-Version: USBee`
remains version-free. Every other diff line is `POT-Creation-Date`, a `#:`
reference, or one of the two new `javascript-format` flag lines.

No pack, no install, no version bump, no push. No files deleted across the
three commits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1's `<verify>` used `gjs -m -c`, which this gjs build rejects**
- **Found during:** Task 1 verification
- **Issue:** `gjs -m -c "<script>"` fails with
  `Failed to parse module 'file://…/<command line>'` — on this build `-m`
  requires a file path and cannot be combined with `-c`. The same malformed
  form appears in the plan's Task 1 automated verify.
- **Fix:** Wrote the byte-identical tracer script to the session scratchpad and
  ran it as `gjs -m <file>`, importing `link-verdict.js` by `file://` URI (gjs
  rejects a bare absolute path in an ESM specifier). Same assertions, same
  exit-code contract.
- **Files modified:** none in the repo — scratchpad only.
- **Commit:** n/a (verification tooling)

**2. [Rule 3 - Blocking] Task 3's `<verify>` had a malformed `Project-Id-Version` pattern**
- **Found during:** Task 3 verification
- **Issue:** `grep -q 'Project-Id-Version: USBee.$'` can never match, because
  the header line is `"Project-Id-Version: USBee\n"` — three literal characters
  (`\`, `n`, `"`) follow `USBee`, not one. The one-liner therefore exited 1
  against a fully correct `.pot`.
- **Fix:** Asserted the exact line instead
  (`grep -q '^"Project-Id-Version: USBee\\n"$'`) and checked every other
  condition of the verify individually. All passed. The artifact was never
  wrong; only the assertion was.
- **Files modified:** none in the repo.
- **Commit:** n/a (verification tooling)

**3. [Rule 2 - Robustness] `deriveCapabilityTile` hardens its own inputs**
- **Found during:** Task 1
- **Issue:** The plan's algorithm did not specify behaviour for a non-array
  argument or for array holes. This function runs inside `gnome-shell`'s
  process, where a throw takes out the whole Quick Settings panel (threat
  T-hkf-02 disposition: mitigate).
- **Fix:** `Array.isArray()` guard on entry, optional chaining on every field
  read, and a string guard on `id` before `localeCompare`. Three extra
  assertions in Task 2 pin it.
- **Files modified:** `usbee@bitcreed.us/src/link-verdict.js`
- **Commit:** `2acd7c1`

### Guard Repaired As Directed

`tests/forward-compat.test.js:1167` asserted
`src.includes('formatRate(top.link_speed_mbps)')`, a literal the Tier 2 rewrite
deletes. Repointed at the new call site `formatRate(cap.negotiatedMbps)` so it
keeps protecting the same invariant (the tile and the popover's Link row share
one formatter) rather than being worked around or dropped.

## Inferred Decisions (for later audit)

The human was unavailable. The plan's four inferred decisions (ID-01 placement
in the zero-import module, ID-02 `''` for sub-1 Mbps, ID-03 four msgids not
three, ID-04 brand table verbatim including its two daemon divergences) were
all carried out as written; none needed revisiting. Two further micro-decisions
were settled during execution:

- **ID-05 — `deriveCapabilityTile` returns `{...top, brand, subtitleKind}`,
  so `ceiling` is on the returned object.** The plan's return shape lists
  `ceiling`, and spreading the ranked entry is the cheapest way to keep it
  exactly consistent with what the sort actually compared. No caller reads
  `ceiling` today; it is there for the next one and for test diagnostics.
- **ID-06 — Test section header reworded to avoid an apostrophe.** The plan
  suggested `print('# formatCapabilityBrand buckets on the daemon's own
  edges')`, which does not parse inside a single-quoted JS string. Written as
  `'# formatCapabilityBrand buckets on the edges the daemon itself uses'`
  rather than escaping, to stay in the file's single-quote house style. Cosmetic.

## Outstanding

**The rendered tile is NOT visually verified.** The Shell must be restarted to
load new extension code, and per CLAUDE.md the extension must not be packed or
installed over the symlinked dev checkout (`install --force` deletes through the
symlink and destroys the repo's extension sources). Verification here is unit
tests plus syntax checks only. Confirming the real tile — that it reads
`USB 5Gbps` over `full capability` on the reporting machine, and that the
subtitle tracks unplugging the 5000-negotiated device — requires a log-out and
log-in, then a look at the Quick Settings panel.

`prefs.js` needs no verification pass: this change touches no preferences
surface.

## Self-Check: PASSED

- `usbee@bitcreed.us/src/link-verdict.js` — FOUND, exports both helpers
- `usbee@bitcreed.us/src/device-store.js` — FOUND, Tier 2 rewritten
- `usbee@bitcreed.us/src/popover.js` — FOUND, comment corrected
- `tests/forward-compat.test.js` — FOUND, 341 assertions
- `po/usbee@bitcreed.us.pot` — FOUND, +4 msgids
- Commits `2acd7c1`, `c2aa8ba`, `e4a8ca0` — all FOUND in `git log`
- `git rev-list --count 0104722..HEAD` = 3, matching the three task commits
