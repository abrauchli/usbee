---
quick_id: 260915-ikd
slug: surface-the-vid-pid-identity-row-and-the
date: 2026-09-15
status: complete
---

# Quick Task 260915-ikd — Summary

Three candidate items came out of a competitive read of
`bjuergens/whatcable-gnome`. **Two shipped; one was evaluated and dropped**
under the conditional approval ("implement each only if it genuinely
improves UX"). The drop rationale is the deliverable for that item and is
recorded in full below.

## What landed

### Item 1 — the **USB ID** row (shipped)

The detail panel now carries the exact `vendor:product` identifier in the
form `lsusb` prints it — `1d6b:0003` — between the **Summary** row and the
**Link** block, so the panel reads *what it is → its exact ID → how it is
connected*.

The premise usually given for this feature ("show VID:PID when no name
resolves") is **false in this tree**, and the shipped behaviour is the
opposite of it. The daemon already performs that fallback itself:
`display_name()` returns `format!("{:04x}:{:04x}", …)` when `product` is
empty (usbeehive `src/usb.rs:378-384`), `headline` falls through to it
(`src/summary.rs:620-635`), and usbeehive pins it with
`headline_falls_back_to_vidpid_when_nothing_known` (`summary.rs:1562`). An
unnamed device therefore **already** read `1d6b:0003` in the popover. The
real gap is the named case: a device called "Intel Wireless" left the
googleable part number nowhere on screen. So the row renders **always**, and
only its *suppression* is derived.

### Item 2 — the aggregate tile summary (**dropped, no code**)

See D-9 below. Every non-degrading slot it names is already occupied by an
equal or better fact.

### Item 3 — the **PDO ceiling marker** (investigated → derivable → shipped)

**Finding: derivable from data already on the wire. No daemon change, and
usbeehive was not touched.** `PdoEntry` (usbeehive `src/dbus.rs:218-235`)
already carries `power_mw: u32` per PDO, mirroring
`power::PowerDataObject` (`src/power.rs:42-57`), and USBee already unpacks
it at `src/device-store.js:77` (`power_mw: p[5]`). The ceiling is therefore a
one-pass client-side maximum over `pdo_list[].power_mw` — no new field was
needed and none was requested.

`PowerDeliveryPort.max_source_power_mw` does exist in the daemon's Rust
struct (used at `summary.rs:1137`, `1150`; exported in the CLI's JSON at
`output.rs:634`) but is **not** on the `DeviceEntry` wire. It was
deliberately **not** added: the client-side derivation is exact for the
advertised list the user is actually reading, and adding a wire field to
answer a question the wire already answers would be gratuitous.

`buildPdoListBlock()` now marks the ceiling alongside the existing active
marker. The two compose across **columns** rather than competing in one, so
the frequent case of a PDO that is both renders as one coherent row:

| state | key | value |
|---|---|---|
| active only | **`◀ 3`** | `20 V — 5 A — 100 W` |
| max only | `4 (max)` | **`20 V — 5 A — 100 W`** |
| both | **`◀ 3 (max)`** | **`20 V — 5 A — 100 W`** |

### Files changed

| File | Change |
|------|--------|
| `usbee@bitcreed.us/src/link-verdict.js` | Three new zero-import total functions: `formatUsbId()`, `usbIdRowText()`, `maxPdoIndex()` |
| `usbee@bitcreed.us/src/popover.js` | USB ID row in `buildDeviceRow()`; ceiling marker in `buildPdoListBlock()` |
| `usbee@bitcreed.us/stylesheet.css` | `.usbee-pdo-max .usbee-detail-value { font-weight: bold; }` |
| `tests/forward-compat.test.js` | 57 new assertions (209 → 266): unit tests for all three helpers plus structural guards over `popover.js` and `stylesheet.css` |
| `po/usbee@bitcreed.us.pot` | Regenerated |
| `CHANGELOG.md` | `[Unreleased]` → `### Added` |

## Decisions (inferred — human unavailable)

- **D-1 — The USB ID row renders ALWAYS, not only as a name fallback.** The
  fallback case is already the daemon's (evidence above), so a fallback-only
  feature would be a near no-op.
- **D-2 — Placed after `Summary`, before `buildLinkBlock()`.** Identity
  belongs beside identity, not buried under the link verdict. A test asserts
  the `indexOf` **ordering**, not merely the presence, so a later refactor
  cannot silently bury it.
- **D-3 — Ungated by `show-technical-details`. Flagged for audit — this is
  the one decision a human might reverse on taste.** It joins the
  always-rendered block tier the `buildDeviceRow` docstring already
  enumerates (Summary, Link, charging_diag, cable trust, PDOs, hub power,
  driver-not-bound, Subclass); the technical tier governs the *property bag*
  (`property-policy.js`), not these blocks. Gating the single most
  googleable fact about a device behind a technical toggle would defeat the
  gap being closed, and it costs one short row.
- **D-4 — Suppressed when `vendor_id === 0 && product_id === 0`.** Type-C
  port entries hardcode both to zero (usbeehive `src/summary.rs:861-862`), so
  `0000:0000` would otherwise render on every port row and mean nothing.
  Both-zero **exactly** — a lone zero is a legal half of a real ID and is not
  treated as a sentinel (two tests pin that).
- **D-5 — Suppressed when the headline already CONTAINS the ID** (trimmed,
  case-insensitive substring). A substring rule cannot lose information: if
  the ID is inside the headline, the ID is already on screen. The comparison
  runs against `resolveHeadline()`'s answer — what is *displayed* — not the
  raw `headline` field.
- **D-6 — Format is lowercase, zero-padded, colon separated.** Byte-for-byte
  the daemon's `{:04x}:{:04x}`, which is load-bearing: anything else makes
  D-5's comparison fail on the very case it exists for. Values above
  `0xffff`, negative, non-integer or absent suppress the row — the descriptor
  fields are 16-bit, so a wider value means a malformed wire, and inventing a
  five-digit ID would be worse than silence (WR-05 discipline).
- **D-7 — Label is `_('USB ID')`.** `lsusb` prints `ID 1d6b:0003`, so that is
  the term a user meets elsewhere. Rejected: `VID:PID` (jargon-first) and
  `Device ID` (collides with the daemon's own `id`, `usb:1-1`).
- **D-8 — All three helpers live in `link-verdict.js`** (same rationale as
  260915-i4w §D-4): it is the ZERO-IMPORT module, the only kind bare-gjs CI
  can load and **unit-test**. Everything else imports the gnome-shell
  resource URI for gettext and can only be guarded structurally. The module
  header's "no user-visible strings" contract is really "no *translatable*
  strings" — `formatRate()` already returns `"5 Gbps"` — and a hex ID is
  untranslatable by construction.
- **D-9 — The aggregate tile summary is DROPPED. No code.** Upstream shows a
  permanent badge with net wattage + external device count. USBee instead
  shows ONE top-ranked salient fact, chosen deliberately. Every slot the item
  could occupy without degrading that is already taken:
  1. **`deriveTileText()` Tier 3** (`device-store.js:258-267`) already
     renders `"%d devices"` and already does it *exactly* as the
     "only-when-nothing-noteworthy" fallback the item asks for, because
     Tiers 0-2 outrank it. The feature is, in its non-degrading form,
     already shipped.
  2. **The popover header already shows `"%d USB devices"` permanently**
     (`tile.js:246-247`), and its second slot holds the **issue** count
     (`tile.js:251-252`, added deliberately by 260905-b0s). Replacing a fault
     count with an inventory count is a straight downgrade.
  3. **Net wattage on the tile cannot be added without displacing the
     top-ranked verdict** — which the item itself forbids — and Tier 1
     already shows the top port's wattage.
  Nothing can be added that does not weaken the current ranking design. An
  always-on inventory count displacing "this port is degraded" is precisely
  the failure the brief warned about.
- **D-10 — Mark a ceiling only when the maximum is UNIQUE and
  `pdo_list.length > 1`, with `power_mw > 0`.** With one PDO the ceiling is
  trivially itself and the marker carries zero information; with a tie,
  marking several rows "max" is noise, not guidance. A tie *below* the
  maximum (100, 100, 200) is not a tie at the top and still marks 200.
- **D-11 — The two markers compose across COLUMNS** (see table above).
  Bolding the value is semantically right as well as orthogonal: the
  ceiling's *numbers* are what the reader came for. Rejected: bolding the key
  for max too (it would erase the active row's belt-and-braces signal), and a
  second glyph (two badges fighting over one column). A test asserts
  `.usbee-pdo-max .usbee-detail-key` is **absent**.
- **D-12 — The marker is a format string, not concatenation:**
  `_('%s (max)').format(keyText)`, so a translator can move the marker
  relative to the index. The existing `${_('◀')} ${pdo.index}` line is
  untouched — it builds the `%s`.
- **D-13 — `maxPdoIndex()` returns the daemon's `index`**, matched in the
  popover as `pdo.index === maxIdx`, consistent with the active check one
  line above it. A winner whose `index` is not an integer yields **no**
  marker rather than one that would match every indexless row.
- **D-14 — Translator comments stay source-only; the `xgettext` invocation
  is NOT changed.** The recorded invocation (260910-nge) has no
  `--add-comments`, and adding it would reshape the whole template.

## Verification

Every check ran under `rtk proxy`, because the rtk hook silently drops lines
from command output and an unproxied grep for a pass marker can succeed
vacuously.

- **All four CI suites green: 483 assertions, zero `FAIL`, all reporting
  `ALL TESTS PASSED`** — forward-compat **266** (up from 209), dbus-client
  66, daemon-status 94, service-probe 57. The plan's floor was 447.
- **`popover.js` still parses.** CI cannot load it (it imports gnome-shell
  resource URIs), so it was parsed out of process: copied to an `.mjs` and
  run through `node --check`, which parses as ESM without resolving imports
  or executing. Exit 0. The gate was confirmed non-vacuous while planning — a
  deliberately broken ESM file exits 1 with a `SyntaxError`.
- **The `.pot` picked up both strings** — `msgid "USB ID"` (line 560) and
  `msgid "%s (max)"` (line 687, correctly flagged `#, javascript-format`).
  The diff was inspected rather than assumed: **no msgid was removed**, and
  the only non-`#:` changes are the `POT-Creation-Date` and pure additions.
- **`.format()` is an established in-tree idiom**, not a new dependency on
  `String.prototype.format`: `popover.js` already uses it at lines 452, 572,
  578, 673, 682-683.
- **`buildPropertyRow()` assigns `.text`** (`popover.js:913-926`), never a
  markup API, so reusing it is what keeps **T-01-02** holding by
  construction. The USB ID value is additionally computed by USBee from two
  integers, never passed through from a daemon string.
- **`props` is in scope** at the insertion point (`popover.js:317`).

## Not verified

- **The rendered popover.** The tile and its popover live in the
  `gnome-shell` process and cannot be reloaded mid-session, so neither the
  USB ID row's placement nor the `(max)` marker's appearance was observed —
  only their source-level presence and the pure logic behind them. A **GNOME
  Shell restart is outstanding** (Xorg: `Alt+F2` → `r`; Wayland: full
  re-login).
- Unlike 260915-i4w there is **no prefs-window surface** in this change, so
  no mid-session end-to-end check existed at all.
- `gnome-extensions install` was **not** run:
  `~/.local/share/gnome-shell/extensions/usbee@bitcreed.us` is a real
  directory holding the released v2.8.0, and installing would overwrite the
  user's working install.

## Notes for audit

- **The `.pot` regeneration also swept in strings from 260915-i4w** (`Options`,
  `Show USB hubs`, `Hide built-in devices`, `All devices hidden by the current
  filters`), which had left the template stale. Corrected in passing rather
  than left for a later task; the diff was checked to confirm it is purely
  additive.
- The template header still reads `Project-Id-Version: USBee 2.7.1` while
  `metadata.json` is at 2.8.0. That is **pre-existing** and was preserved on
  purpose — D-14 keeps the recorded `xgettext` invocation verbatim, and
  changing `--package-version` here would be out of scope for a quick task
  that is explicitly forbidden to bump the version.
- **No version bump, no tag, no push.** `metadata.json` untouched at 13 /
  2.8.0; `CHANGELOG.md` edited only under `## [Unreleased]`.
- **usbeehive was not modified**, per the explicit scope limit. Verified by
  the absence of any write to that tree.
- Committed straight to `master` with `git.allow_default_branch_commits`
  still unset in `.planning/config.json` — inferred and flagged, on the
  strength of every prior quick task doing the same and the standing
  keep-`master` preference.
- **Resumed, not restarted.** A prior agent was killed mid-flight by an API
  rate limit after writing the code and tests but before committing or
  producing any artifact beyond `PLAN.md`. Its uncommitted draft was reviewed
  as a draft — logic re-derived, `maxPdoIndex()`'s uniqueness latch traced by
  hand against the tie-then-beaten case, the `.pot` diff audited for
  removals, and `.format()` availability confirmed against existing call
  sites — and found correct. Kept in full; nothing was discarded. What was
  missing was the workflow tail: `SUMMARY.md`, the `PLAN.md` status flip,
  `STATE.md`, and all three commits.
