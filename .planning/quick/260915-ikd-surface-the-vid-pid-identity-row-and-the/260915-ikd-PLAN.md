---
quick_id: 260915-ikd
slug: surface-the-vid-pid-identity-row-and-the
date: 2026-09-15
status: complete
---

# Quick Task 260915-ikd — USB ID identity row + PDO ceiling marker

## Problem

Competitive read of `bjuergens/whatcable-gnome` surfaced three candidate
items. Two are real gaps; one is already solved better in-tree.

**Gap 1 — the exact device ID is visible nowhere.** The premise usually
given for this feature ("show VID:PID when no name resolves") is *false*
here: the daemon already does that fallback itself — `display_name()`
returns `format!("{:04x}:{:04x}", …)` when `product` is empty
(usbeehive `src/usb.rs:378-384`), `headline` falls through to it
(`src/summary.rs:620-635`), and the daemon pins it with
`headline_falls_back_to_vidpid_when_nothing_known` (summary.rs:1562). So
the unnamed device *already* reads `1d6b:0003` in the popover. The real
gap is the **opposite** case: when a name *does* resolve ("Intel
Wireless"), the exact ID is nowhere on screen and the user cannot google
the precise part. `vendor_id` / `product_id` are unpacked in
`src/device-store.js:51-52` and used by nothing.

**Gap 2 — the charger's ceiling is unmarked.** `buildPdoListBlock()`
(`src/popover.js:797-831`) lists every advertised PDO and marks the
*active* one with `◀`, but says nothing about which PDO is the highest
the charger+cable pair advertises. That is the direct answer to USBee's
core question, "why is my laptop charging slowly" — what it is using
versus the most it could use.

**Non-gap — the aggregate tile summary.** Evaluated and dropped; see D-9.

## Decisions (inferred — human unavailable)

- **D-1 — The USB ID row renders ALWAYS, not only as a name fallback.**
  The fallback case is already handled by the daemon (evidence above), so
  a fallback-only feature would be a near no-op. The value is precisely
  in the named case.
- **D-2 — Placed immediately after the `Summary` row and before
  `buildLinkBlock()`.** The panel then reads: what it is → its exact ID →
  how it is connected. Identity belongs next to identity, not buried
  beneath the link verdict.
- **D-3 — Ungated by `show-technical-details`.** It joins the dedicated
  always-rendered block tier the `buildDeviceRow` docstring already
  enumerates (`popover.js:308-310`: Summary, Link, charging_diag, cable
  trust, PDOs, hub power, driver-not-bound, Subclass). Gating the single
  most googleable fact about a device behind a technical toggle defeats
  the gap being closed, and it costs one short row. The
  `show-technical-details` tier governs the *property bag*
  (`property-policy.js`), not these blocks — so this is consistent, not
  an exception. **Flagged for audit:** this is the one decision a human
  might reverse on taste.
- **D-4 — Suppressed when `vendor_id === 0 && product_id === 0`.** Type-C
  port entries hardcode both to 0 (usbeehive `src/summary.rs:861-862`),
  so `0000:0000` would otherwise render on every port row and mean
  nothing. Both-zero exactly, per the evidence — a lone zero is not
  treated as a sentinel.
- **D-5 — Suppressed when the row headline already CONTAINS the formatted
  ID (trimmed, case-insensitive substring).** This covers the
  daemon-fallback case the daemon's own test pins (`headline ==
  "dead:beef"`) and also a composed headline that embeds the ID. A
  substring rule cannot lose information: if the ID is inside the
  headline, the ID is already on screen. Case-insensitive so a future
  daemon emitting uppercase still suppresses, even though both sides
  lowercase today.
- **D-6 — Format is lowercase, zero-padded to 4 hex digits, colon
  separated — `1d6b:0003`.** lsusb style, byte-for-byte identical to the
  daemon's `{:04x}:{:04x}`; anything else would make D-5's comparison
  fail on the very case it exists for. Values above `0xffff`, negative,
  non-integer or absent suppress the row: the USB descriptor fields are
  16-bit, so a larger value means a malformed wire, and inventing a
  5-digit ID would be worse than saying nothing (WR-05 discipline).
- **D-7 — Label is `_('USB ID')`.** `lsusb` prints `ID 1d6b:0003`, so the
  term is the one a user meets elsewhere. Rejected: `VID:PID`
  (jargon-first) and `Device ID` (collides with the daemon's own `id`,
  `usb:1-1`, which is a different thing).
- **D-8 — All three helpers live in `src/link-verdict.js`.** Same
  rationale as 260915-i4w §D-4: it is a ZERO-IMPORT module, which is the
  only kind bare-gjs CI can load and unit-test; everything else imports
  the gnome-shell resource URI for gettext and can only be guarded
  structurally. The module header says it produces no user-visible
  strings — `formatRate()` (link-verdict.js:123, returns `"5 Gbps"`)
  already establishes that the real contract is "no *translatable*
  strings". A hex ID is untranslatable by construction, so it fits.
- **D-9 — The aggregate tile summary is DROPPED. No code.** Every
  non-degrading slot it names is already occupied by an equal or better
  fact: (a) `deriveTileText()` Tier 3 (`device-store.js:258-267`) already
  renders `"%d devices"` and already does it exactly as the
  "only-when-nothing-noteworthy" fallback the item asks for, because
  Tiers 0-2 outrank it; (b) the popover header already shows `"%d USB
  devices"` permanently (`tile.js:246-247`) and its second slot holds the
  *issue* count (`tile.js:251-252`, added deliberately by 260905-b0s) —
  replacing a fault count with an inventory count is a straight
  downgrade; (c) net wattage on the tile cannot be added without
  displacing the top-ranked verdict, which the item itself forbids, and
  Tier 1 already shows the top port's wattage. Nothing can be added that
  does not weaken the current ranking design.
- **D-10 — Mark a PDO as the ceiling only when the maximum is UNIQUE and
  `pdo_list.length > 1`, with `power_mw > 0`.** With one PDO the ceiling
  is trivially itself and the marker carries zero information; with a
  tie, marking several rows "max" is noise, not guidance.
- **D-11 — The two markers compose across COLUMNS: active bolds the key,
  max bolds the value.** The ceiling PDO is frequently also the active
  one and must render as one coherent row, not two competing badges.
  Active keeps its existing `◀` + bold key
  (`.usbee-pdo-active .usbee-detail-key`); max appends the translated
  word to the key and bolds the *value* column
  (`.usbee-pdo-max .usbee-detail-value`). So:

  | state | key | value |
  |---|---|---|
  | active only | **`◀ 3`** | `20 V — 5 A — 100 W` |
  | max only | `4 (max)` | **`20 V — 5 A — 100 W`** |
  | both | **`◀ 3 (max)`** | **`20 V — 5 A — 100 W`** |

  Bolding the value is semantically right as well as orthogonal: the
  ceiling's *numbers* are what the user came to read. Rejected: bolding
  the key for max too (it would erase the active row's belt-and-braces
  signal), and a second glyph (two competing badges in one column).
- **D-12 — The marker is composed with a format string, not
  concatenation:** `_('%s (max)').format(keyText)`. Parentheses read as
  an annotation in every locale USBee will plausibly gain, and `%s` lets
  a translator move the marker relative to the index. The existing
  `${_('◀')} ${pdo.index}` line is left untouched — it builds the `%s`.
- **D-13 — `maxPdoIndex()` returns the daemon's `index` value, and the
  popover matches on `pdo.index === maxIdx`.** Consistent with the
  active check one line above it (`pdo.index === device.active_pdo_index`)
  and therefore carries exactly the same exposure to a malformed
  duplicate index — no new failure mode is introduced.
- **D-14 — Translator comments stay source-only; the `xgettext`
  invocation is NOT changed.** The recorded invocation (STATE.md, quick
  task 260910-nge) has no `--add-comments`, and adding it would reshape
  the whole template. The comments still earn their place for the next
  human reading the source, as the existing ones do
  (forward-compat.test.js:797).

## Tasks

1. **Helpers** — add three pure functions to
   `usbee@bitcreed.us/src/link-verdict.js` (keep it zero-import):
   - `formatUsbId(device)` → `'1d6b:0003'`, or `''` when either field is
     absent / non-integer / negative / `> 0xffff`, or when both are `0`
     (D-4, D-6). Lowercase hex, `padStart(4, '0')` each side.
   - `usbIdRowText(device, propsMap)` → `formatUsbId()`'s result, or `''`
     when `resolveHeadline(device, propsMap)` already contains it
     (trimmed, case-insensitive) — D-5. `resolveHeadline` is in this same
     module, so no import is added.
   - `maxPdoIndex(pdoList)` → the `index` of the single greatest
     `power_mw`, or `null` when the list has fewer than two entries, when
     the maximum is not unique, when no entry has a finite `power_mw > 0`,
     or when the argument is absent (D-10, D-13).

   All three must be total functions: `undefined` in, `''`/`null` out,
   never a throw. An exception raised while building the popover happens
   inside `gnome-shell`'s own process.

2. **Popover + stylesheet** — `usbee@bitcreed.us/src/popover.js`:
   - Extend the existing `./link-verdict.js` import (lines 29-30) with
     `maxPdoIndex, usbIdRowText`.
   - In `buildDeviceRow()`, directly after the `if (device.subtitle)`
     Summary block (~line 393) and before `buildLinkBlock(...)`, add the
     row when `usbIdRowText(device, props)` is non-empty, via the existing
     `buildPropertyRow(_('USB ID'), text, device.category)` — reuse it
     rather than new label plumbing, so T-01-02 (`.text`, never markup)
     holds by construction. `props` is already in scope from line 317.
   - In `buildPdoListBlock()`, compute `maxPdoIndex(pdos)` once before the
     loop; inside the loop set `isMax`, wrap the existing `keyText` with
     `_('%s (max)').format(keyText)` when set (D-12), and
     `pdoRow.add_style_class_name('usbee-pdo-max')`. Leave the active
     branch exactly as it is.
   - Give both new strings a `// Translators:` comment (D-14): what `%s`
     stands for, and that "max" means the highest power the charger
     advertises, not the power in use.
   - `usbee@bitcreed.us/stylesheet.css`: add
     `.usbee-pdo-max .usbee-detail-value { font-weight: bold; }` beside
     the existing `.usbee-pdo-active` rule at line 157-161, with a comment
     citing this task and the column-orthogonality reason (D-11).

   Two existing guards in `tests/forward-compat.test.js` scan popover.js's
   translatable literals and will fail on careless wording — no literal
   may match `/\buse a\b/i` (line 805), and `_('%s (USB %s)')` must stay
   absent (line 811). Neither new string trips them; keep it that way.

3. **Tests, template, changelog** —
   - `tests/forward-compat.test.js`: a new section
     `// --- USB ID row + PDO ceiling marker (quick task 260915-ikd) ---`
     placed after the 260915-i4w block. Real unit tests for all three
     helpers, reusing the local `device()` fixture factory (line 66) —
     which already defaults `vendor_id`/`product_id` to `0`, i.e. the
     suppressed case, so the positive cases must override both. Cover at
     minimum: correct formatting, zero-padding of small values,
     `0/0` suppression, out-of-range suppression, `undefined` input, the
     daemon-fallback headline case (`headline: 'dead:beef'` → `''`), the
     resolved-name case (→ rendered), unique max, tie → `null`, single
     PDO → `null`, all-zero power → `null`. Then structural guards over
     `popover.js` (renders `_('USB ID')`; delegates via `usbIdRowText(`
     and `maxPdoIndex(`; the USB ID row is added *before*
     `buildLinkBlock(` — assert on `indexOf` ordering; emits
     `_('%s (max)')` and `usbee-pdo-max`) and over `stylesheet.css`
     (carries `.usbee-pdo-max .usbee-detail-value`).
   - Regenerate `po/usbee@bitcreed.us.pot` with the recorded invocation
     VERBATIM — input order is load-bearing, `prefs.js` first, and keep
     `--package-version=2.7.1`:
     ```sh
     xgettext --from-code=UTF-8 --package-name=USBee --package-version=2.7.1 \
       -o po/usbee@bitcreed.us.pot \
       usbee@bitcreed.us/prefs.js usbee@bitcreed.us/src/*.js
     ```
     Expect exactly two new msgid blocks (`USB ID`, `%s (max)`) plus the
     `POT-Creation-Date` line — any wider diff means the invocation
     drifted; re-run it rather than hand-editing.
   - `CHANGELOG.md`: append to the existing `## [Unreleased]` →
     `### Added`, in the project's plain user-facing prose. Do not touch
     any released section.
   - The SUMMARY must carry the **D-9 drop rationale in full** — the
     evaluation is the deliverable for item 2, and its three evidence
     points (`device-store.js:258-267`, `tile.js:246-247` /
     `tile.js:251-252`, Tier 0/1 ranking) are what stop the idea being
     re-proposed in six months.

   Commits, each ending with
   `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`:
   `feat(quick-260915-ikd): USB ID row + PDO ceiling marker` (tasks 1-2
   plus the `.pot`), `test(quick-260915-ikd): cover the USB ID and PDO
   ceiling helpers`, `docs(quick-260915-ikd): record the USB ID row and
   the dropped tile summary`.

## Verification

Every command that a check depends on runs under `rtk proxy` — the rtk
hook silently drops lines from command output, so an unproxied grep for a
pass marker can succeed vacuously.

1. **All four CI suites green.** Baseline is 426 assertions total
   (dbus-client 66, daemon-status 94, forward-compat 209, service-probe
   57); the count may only grow.
   ```sh
   OUT=$(mktemp -d)
   rtk proxy gjs -m tests/forward-compat.test.js | tee "$OUT/fc.out"
   rtk proxy grep -c 'ok   -' "$OUT/fc.out"        # 209 today; expect >= 230
   rtk proxy grep -c 'ALL TESTS PASSED' "$OUT/fc.out"
   rtk proxy gjs -m tests/dbus-client.test.js
   rtk proxy gjs -m tests/daemon-status.test.js
   rtk proxy gjs -m tests/service-probe.test.js
   ```
   Total across the four must be >= 447 and zero `FAIL` lines.
2. **popover.js still parses.** CI cannot load it (it imports gnome-shell
   resource URIs), so parse it out of process — `node --check` on an
   `.mjs` copy parses as ESM without resolving imports or executing:
   ```sh
   DEST="$(mktemp -d)/popover-check.mjs"
   cp 'usbee@bitcreed.us/src/popover.js' "$DEST"
   rtk proxy node --check "$DEST"   # exit 0 = parses; exit 1 = SyntaxError
   ```
   Both directions were confirmed while planning: exit 0 on the current
   `popover.js`, exit 1 with a `SyntaxError` on a deliberately broken ESM
   file — the gate can genuinely fail, it is not vacuous.
3. **The template picked up both strings.**
   ```sh
   rtk proxy grep -n 'msgid "USB ID"' po/usbee@bitcreed.us.pot
   rtk proxy grep -n 'msgid "%s (max)"' po/usbee@bitcreed.us.pot
   rtk proxy git diff --stat po/usbee@bitcreed.us.pot
   ```
4. **Not verified, and stated plainly:** the rendered popover. The tile
   and its popover live in the `gnome-shell` process and cannot be
   reloaded mid-session, so neither the USB ID row's placement nor the
   `(max)` marker's appearance is observed by this task — only their
   source-level presence and the pure logic behind them. Unlike
   260915-i4w there is no prefs-window surface here, so there is no
   mid-session end-to-end check available at all. `gnome-extensions
   install` is NOT run: `~/.local/share/gnome-shell/extensions/usbee@bitcreed.us`
   is a real directory holding the released v2.8.0 and installing would
   overwrite the user's working install.

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| usbeehive daemon → USBee (session D-Bus) | Every device field consumed here — `vendor_id`, `product_id`, `headline`, `pdo_list[].power_mw`, `pdo_list[].index` — crosses this boundary and is untrusted input. No new wire surface is added. |
| USBee → gnome-shell process | USBee code runs inside the compositor; an unhandled throw or a markup injection degrades the whole session, not just the extension. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ikd-01 | Tampering | `buildDeviceRow` USB ID row, `buildPdoListBlock` key text | medium | mitigate | Reuse `buildPropertyRow()`, which assigns `.text` and never a markup API — the standing T-01-02 invariant. No `set_markup` is introduced. The USB ID value is additionally derived from two integers by USBee, never passed through from a daemon string. |
| T-ikd-02 | Denial of Service | `formatUsbId`, `usbIdRowText`, `maxPdoIndex` | high | mitigate | A throw inside the popover build runs in `gnome-shell`'s process. All three helpers are total functions returning `''`/`null` for absent, non-integer, negative, over-range and malformed input, each pinned by a unit test including the `undefined` case (task 3). No indexing, no unbounded loops; `maxPdoIndex` is a single linear pass over an already-received array. |
| T-ikd-03 | Information disclosure | USB ID row | low | accept | `vendor_id:product_id` is a model identifier, not a device instance identifier — it is printed by `lsusb` for every user and identifies the part, not the unit. Serial numbers stay where they are, in the `show-technical-details`-gated property bag; this change neither reads nor promotes them. |
| T-ikd-04 | Spoofing | daemon-supplied `pdo_list` | low | accept | A hostile session-bus peer that could impersonate `org.usbeehive.Devices1` already controls every rendered fact; a mis-marked ceiling PDO is strictly less than what it already has. Out of scope for this change — the mitigation belongs to session-bus name ownership, not to a display helper. |
| T-ikd-SC | Tampering | npm/pip/cargo installs | n/a | accept | No dependency is added or fetched: USBee has no package manager, no build step and no bundled binaries (GPL-3.0 pure-GJS, EGO no-binary rule). There is no install task in this plan, so no package-legitimacy checkpoint applies. |
</threat_model>

## Constraints

- Do **not** modify `/home/blk/projects/rust/usbeehive` in any way. No
  daemon change, no new wire field. `PowerDeliveryPort.max_source_power_mw`
  exists in the daemon's Rust struct but is not on the `DeviceEntry` wire;
  it is not needed and must not be added — the ceiling is derived
  client-side from `pdo_list[].power_mw`, which is already unpacked
  (`device-store.js:71-79`).
- No `/sys` or udev access. All USB knowledge arrives over D-Bus.
- Every user-visible string through gettext; no string concatenation for
  user-visible text (D-12).
- Documented Quick Settings / PopupMenu / St API only — no private
  `Main.panel._*` internals.
- No version bump (`metadata.json` untouched), no tag, no push. CHANGELOG
  under `## [Unreleased]` only.
- Do not run `gnome-extensions install`.
- Capability gates evaluated and non-applicable: no ORM or database schema
  (the GSettings gschema is not one, and it is untouched here); no external
  API integration (an already-established internal D-Bus interface owned by
  a sibling project, consumed with no new wire surface, is not one — no
  COVERAGE.md); no singular→plural, required→optional or derived→chosen
  identity transition.
