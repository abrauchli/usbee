---
phase: 260917-hkf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - usbee@bitcreed.us/src/link-verdict.js
  - usbee@bitcreed.us/src/device-store.js
  - usbee@bitcreed.us/src/popover.js
  - tests/forward-compat.test.js
  - po/usbee@bitcreed.us.pot
autonomous: true
requirements: [QUICK-260917-hkf]

estimate:
  tokens: 85000
  raw_tokens: 85000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "The tile title names a USB-IF capability brand (e.g. `USB 5Gbps`), never a bcdUSB version."
    - "The tile subtitle qualifies the brand: `full capability`, `linked at <rate>`, or `not linked`."
    - "A 3-way capability tie resolves to the device with the highest negotiated speed, not to id order."
    - "Type-C port entries (no speed, no capability) never win Tier 2 and never blank the tile."
    - "`usb_version` has no render site anywhere in the UI after this change."
    - "`hasLinkIssue()` is untouched — `BelowCapability` still never looks like a fault."
  artifacts:
    - "usbee@bitcreed.us/src/link-verdict.js — exported `formatCapabilityBrand()` + `deriveCapabilityTile()`"
    - "usbee@bitcreed.us/src/device-store.js — Tier 2 rewritten as a gettext mapping over the helper"
    - "tests/forward-compat.test.js — unit tests for both helpers + updated device-store guards"
    - "po/usbee@bitcreed.us.pot — regenerated, 4 msgids added, 0 removed"
  key_links:
    - "device-store Tier 2 -> deriveCapabilityTile() (the ranking must not be duplicated)"
    - "device-store Tier 2 -> formatRate() (tile subtitle and popover Link row share one formatter)"
    - "formatCapabilityBrand() bucket edges -> usbeehive src/usb.rs link_speed_tier() (tile and daemon cannot disagree)"
---

<objective>
Replace the Quick Settings tile's `USB <bcdUSB>` title with the **maximum link
capability** of the most capable attached device, qualified by a subtitle that
says whether that capability is actually being reached.

Purpose: `usb_version` is the daemon's canonicalised bcdUSB descriptor version.
It is neither a capability nor a speed; its commonest value, `2.1`, names no
real USB specification (bcdUSB 2.10 only declares that a BOS descriptor
exists). Quick task 260910-n10 withdrew this same string from the popover's
Link row and logged the tile title as the one surviving render site. This
closes that follow-up and removes the last one.

Output: two new pure helpers in the zero-import `link-verdict.js`, a rewritten
`deriveTileText()` Tier 2, unit tests for both helpers, and a regenerated
translation template.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@/home/blk/projects/rust/usbee/CLAUDE.md
@/home/blk/projects/rust/usbee/usbee@bitcreed.us/src/link-verdict.js
@/home/blk/projects/rust/usbee/usbee@bitcreed.us/src/device-store.js
</context>

<inferred_decisions>
The human is unavailable. These micro-decisions were settled from the codebase
and are flagged for later audit:

- **ID-01 — The Tier-2 ranking lives in `link-verdict.js`, not in
  `device-store.js`.** The task spec asks for unit tests of "`deriveTileText()`
  Tier 2", but `device-store.js` imports
  `resource:///org/gnome/shell/extensions/extension.js` for gettext and
  therefore **cannot be loaded under bare gjs in CI** — `.github/workflows/ci.yml`
  lines 49-62 say so explicitly, and names `device-store.js` as covered by
  source-level structural guards instead. The established remedy in this repo is
  to put the pure part in a zero-import module: quick task 260915-ikd added
  `formatUsbId`, `usbIdRowText` and `maxPdoIndex` to `link-verdict.js` for
  exactly this reason, and the CI comment states "That is also why the verdict,
  containment and notification logic lives in the zero-import modules." So the
  ranking + brand + subtitle-kind derivation becomes `deriveCapabilityTile()` in
  `link-verdict.js` (really unit-tested), and Tier 2 becomes a thin gettext
  mapping over its result (structurally guarded). **Behaviour is exactly the
  spec's** — this is a placement decision, not a design change.

- **ID-02 — `formatCapabilityBrand()` returns `''` below 1 Mbps / for
  non-finite input.** The spec left this to the planner. `''` is the convention
  already set by `formatRate()` in the same module ("'' when there is nothing to
  say"), so the two sibling formatters behave alike and the caller needs no
  null-check discipline it does not already have.

- **ID-03 — Four msgids are added, not three.** The spec counts `USB %s`,
  `linked at %s` and `not linked` as new and treats `full capability` as reuse
  of the popover's vocabulary. The popover's actual msgid is
  `%s — full capability` (`po/usbee@bitcreed.us.pot:620`); a bare
  `full capability` does not exist. The *wording* is reused, the *msgid* is new.
  Expected `.pot` delta is therefore +4 / −0.

- **ID-04 — The brand table is implemented verbatim from the spec, including
  the two edges where it does not match the daemon today.** The daemon's
  `link_speed_tier()` (usbeehive `src/usb.rs:362-375`) has no 80 Gbps tier and
  its low-speed edge is `>= 2`, not `>= 1`. The spec's table is the settled
  decision, so it ships as written and a code comment records both divergences
  (the 80 Gbps tier is ahead of the daemon; anything in [1, 2) is not a real USB
  rate under either rule and resolves to the same low-speed brand).
</inferred_decisions>

<tasks>

<task type="tracer">
  <name>Task 1: formatCapabilityBrand + deriveCapabilityTile + Tier 2 rewrite</name>
  <files>usbee@bitcreed.us/src/link-verdict.js, usbee@bitcreed.us/src/device-store.js, usbee@bitcreed.us/src/popover.js</files>
  <read_first>
    - usbee@bitcreed.us/src/link-verdict.js lines 100-210 (formatRate, the module-private intProp, deriveLinkInfo's capableMbps) and 470-520 (maxPdoIndex, hasLinkIssue — the house style for a pure exported helper and its docstring)
    - usbee@bitcreed.us/src/device-store.js lines 128-268 (deriveTileText docstring + Tier 0 through Tier 3)
    - usbee@bitcreed.us/src/popover.js lines 920-935 (the comment that currently asserts usb_version "still renders in the tile title")
  </read_first>
  <action>
Add two exported pure helpers to `usbee@bitcreed.us/src/link-verdict.js`. The
module imports nothing and must stay that way — no gettext, no gi, no St.

**`formatCapabilityBrand(mbps)`** returns USB-IF's closed-up rate brand for a
capability ceiling, by descending tier: 80000 or more gives `80Gbps`; 40000
gives `40Gbps`; 20000 gives `20Gbps`; 10000 gives `10Gbps`; 5000 gives
`5Gbps`; 480 gives `480Mbps`; 12 gives `12Mbps`; 1 gives `1.5Mbps`. Anything
below 1, plus non-finite input, returns the empty string (per ID-02) — the
caller treats that as "no brand". Docstring must state: (a) these edges mirror
`link_speed_tier()` in the daemon (usbeehive `src/usb.rs:362-375`) so the tile
and the daemon cannot disagree; (b) the two deliberate divergences from the
daemon as it stands today, per ID-04; (c) that the closed-up typography
(`5Gbps`) is USB-IF brand form and is intentionally *different* from
`formatRate()`'s measured form (`5 Gb/s`) — the title carries a brand, the
subtitle carries a measurement. Do NOT emit the daemon's English
`usb_capable_speed` prose, and do NOT touch `usb_capable_gen`.

**`deriveCapabilityTile(devices)`** ranks a device array and returns either
`null` or an object with `{id, ceiling, capableMbps, negotiatedMbps, brand,
subtitleKind}`. Algorithm:
  - For each device: `capableMbps` is `intProp(propsOf(d), 'usb_capable_speed_mbps')`
    (reuse the existing module-private `intProp` and the exported `propsOf`);
    `negotiatedMbps` is `d.link_speed_mbps` coerced to 0 when not a finite
    number; `ceiling` is `capableMbps` when it is non-null, else
    `negotiatedMbps`.
  - Keep only entries whose `ceiling` is a finite number greater than 0.
    **There is no `usb_version` test** — that test is what used to exclude
    Type-C port entries, and `ceiling > 0` excludes them anyway because they
    carry neither a negotiated speed nor a capability. Say so in a comment
    (see the discipline note below for the wording constraint).
  - Sort by `ceiling` descending, then `negotiatedMbps` descending, then
    `id.localeCompare`. The negotiated tie-break is load-bearing and the
    comment must say why: on the reporting machine three devices all declare
    `usb_capable_speed_mbps = 5000`, and without it `id.localeCompare` would
    arbitrarily crown a 480 Mb/s `BelowCapability` hub over the disk actually
    linked at 5000.
  - Take the top entry. Compute `brand = formatCapabilityBrand(ceiling)`; if
    `brand` is empty, return `null` (a ceiling in the open interval (0, 1) is
    unrenderable, and because the sort is descending nothing else is
    renderable either — falling through to Tier 3 is correct and the tile can
    never read `USB ` with a blank brand).
  - `subtitleKind` is `'full'` when `capableMbps` is non-null and equals
    `negotiatedMbps`; else `'unlinked'` when `negotiatedMbps` is 0 or less
    (capability known, nothing linked); else `'linked'`.
  - Returning tokens rather than strings is what makes this CI-testable (ID-01);
    the docstring must say that the caller owns every translated string.

Then rewrite Tier 2 of `deriveTileText()` in
`usbee@bitcreed.us/src/device-store.js` (currently lines 241-256) as a gettext
mapping over the helper. Import `deriveCapabilityTile` and
`formatCapabilityBrand`'s consumer side as needed; keep the existing
`formatRate` import — Tier 2 still calls `formatRate(cap.negotiatedMbps)`
itself, so the tile subtitle and the popover's Link row keep sharing one
formatter (the existing structural guard exists to protect exactly that).
  - Title: `_('USB %s').format(cap.brand)`.
  - Subtitle: `_('full capability')` for kind `full`; `_('not linked')` for
    kind `unlinked`; `_('linked at %s').format(formatRate(cap.negotiatedMbps))`
    for kind `linked`.
  - A `null` result falls through to the existing Tier 3 (`USB` / `%d devices`,
    lines 258-267) unchanged. There is no fallback to the old string: the
    template-literal title is deleted outright.
  - Every new string gets a `// Translators:` comment in the house style —
    look at the `_('%s — limited')` and `_('up to %s')` comments already in
    this function. For `USB %s`, state that `%s` is an untranslated technical
    rate brand like `5Gbps`. For `linked at %s`, state that `%s` is a
    formatted measured rate like `480 Mb/s` and that the device can go faster.
  - Update the `deriveTileText` docstring: its tier list currently reads
    "Tier 2 — Fastest attached link with parseable USB version + speed" and
    its prose example is `"USB 2.0"`. Both must now describe the capability
    brand.

Also correct two now-false comments — the same comment-hygiene discipline
applied in quick tasks 260910-o99 and 260910-p91:
  - `popover.js` around line 930 states the field "is still on the wire and
    still renders in the tile title (src/device-store.js)". After this change
    it renders nowhere; restate it as still on the wire, rendered nowhere.
  - `link-verdict.js` around line 189 says the field is "Kept on the token for
    completeness but no longer rendered beside the rate" — widen to "rendered
    nowhere in the UI; kept on the token because it is on the wire".

Do NOT widen Tier 0: `hasLinkIssue()` (`link-verdict.js:513`) stays exactly as
it is, firing only on `Degraded` or hub over-budget. `BelowCapability` must
never look like a fault (260910-n10, and the `buildLinkBlock` docstring at
`popover.js:906-910`); the qualified subtitle is what communicates the gap.

**Comment-text discipline.** Task 2 adds a negative guard asserting that
`deriveTileText()` contains no template-literal `title:`. Do not write a
comment anywhere inside `deriveTileText()` that quotes the withdrawn
expression, and do not reproduce a backtick-and-dollar title form in prose.
Describe it in words ("the canonicalised bcdUSB descriptor version the title
used to interpolate") instead.
  </action>
  <verify>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; cp 'usbee@bitcreed.us/src/device-store.js' /tmp/ds-check.mjs &amp;&amp; node --check /tmp/ds-check.mjs &amp;&amp; cp 'usbee@bitcreed.us/src/popover.js' /tmp/pv-check.mjs &amp;&amp; node --check /tmp/pv-check.mjs &amp;&amp; rtk proxy gjs -m -c "import('./usbee@bitcreed.us/src/link-verdict.js').then(m => { const dev = (id, cap, neg) => ({id, link_speed_mbps: neg, usb_version: '', properties: cap === null ? [] : [['usb_capable_speed_mbps', String(cap)]]}); const live = [dev('a', 5000, 5000), dev('b', 5000, 480), dev('c', 5000, 480)]; const asIs = m.deriveCapabilityTile(live); const unplugged = m.deriveCapabilityTile(live.slice(1)); const ok = asIs.id === 'a' &amp;&amp; asIs.brand === '5Gbps' &amp;&amp; asIs.subtitleKind === 'full' &amp;&amp; unplugged.brand === '5Gbps' &amp;&amp; unplugged.subtitleKind === 'linked' &amp;&amp; m.formatRate(unplugged.negotiatedMbps) === '480 Mb/s' &amp;&amp; m.deriveCapabilityTile([]) === null; print(ok ? 'TRACER OK' : 'TRACER FAIL'); if (!ok) imports.system.exit(1); })"</automated>
  </verify>
  <done>
`node --check` passes on both gnome-shell-only modules. The tracer script
reproduces both expected live results from the task spec: the 3-way capability
tie resolves to the device negotiated at 5000 (title brand `5Gbps`, kind
`full`), and with that device removed the winner is still `5Gbps` but kind
`linked` at a `formatRate` of `480 Mb/s`. An empty array returns `null`.
`grep -n 'usb_version' usbee@bitcreed.us/src/device-store.js` shows only the
`unpackDeviceEntry` assignment from `tuple[16]` — no render site.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: unit tests for both helpers + updated device-store guards</name>
  <files>tests/forward-compat.test.js</files>
  <read_first>
    - tests/forward-compat.test.js lines 1-95 (module docstring on the two-halves structure, the `check`/`readSource` harness, the `device()` fixture)
    - tests/forward-compat.test.js lines 810-940 (the formatUsbId and maxPdoIndex unit-test blocks — the house style to copy)
    - tests/forward-compat.test.js lines 1157-1186 (the existing device-store.js structural guard block)
  </read_first>
  <behavior>
    formatCapabilityBrand bucket edges — each tier at its edge and one below:
    - 80000 -> '80Gbps'; 79999 -> '40Gbps'
    - 40000 -> '40Gbps'; 39999 -> '20Gbps'
    - 20000 -> '20Gbps'; 19999 -> '10Gbps'
    - 10000 -> '10Gbps'; 9999 -> '5Gbps'
    - 5000 -> '5Gbps'; 4999 -> '480Mbps'
    - 480 -> '480Mbps'; 479 -> '12Mbps'
    - 12 -> '12Mbps'; 11 -> '1.5Mbps'
    - 1 -> '1.5Mbps'; 0 -> ''; -1 -> ''; NaN -> ''; undefined -> ''; '5000' -> ''
    - a far-future 200000 still brands as '80Gbps' (WIRE-04: never blank)

    deriveCapabilityTile — the six cases the task spec requires:
    1. Three devices all declaring usb_capable_speed_mbps 5000, negotiated
       5000 / 480 / 480, ids ordered so localeCompare alone would pick a 480:
       the 5000-negotiated device wins, brand '5Gbps', subtitleKind 'full'.
    2. Capability 5000, negotiated 480: brand '5Gbps', subtitleKind 'linked',
       formatRate(negotiatedMbps) === '480 Mb/s'.
    3. Capability 5000, negotiated 5000: subtitleKind 'full'.
    4. No capability property, negotiated 10000, against a capability-5000
       device: the 10000 device wins on negotiated speed alone, brand
       '10Gbps', subtitleKind 'full' is NOT claimed (capableMbps is null, so
       the kind is 'linked').
    5. Type-C port entries only (link_speed_mbps 0, no capability property,
       empty usb_version): returns null.
    6. Empty array returns null; an array of only zero-ceiling devices
       returns null.
    7. Capability 5000, negotiated 0: subtitleKind 'unlinked'.
    8. A ceiling that brands empty (capability absent, negotiated 0.5)
       returns null rather than a blank brand.
  </behavior>
  <action>
Extend `tests/forward-compat.test.js` — this is the project's existing suite
for the zero-import policy modules and it is already the home of the
`link-verdict.js` unit tests. Do not create a new test file or a new
framework: the harness is plain gjs with a local `check(name, cond)` and
`print('# …')` section headers, run as `gjs -m tests/<file>.test.js` from the
repo root.

1. Add `deriveCapabilityTile` and `formatCapabilityBrand` to the existing
   `link-verdict.js` import list at the top of the file (keep it alphabetical,
   as it is now).
2. Add a `print('# formatCapabilityBrand buckets on the daemon's own edges')`
   block asserting every case in `<behavior>`. Mirror the `formatUsbId` block's
   one-assertion-per-`check` style with descriptive names.
3. Add a `print('# deriveCapabilityTile ranks by ceiling, tie-breaks on the
   negotiated link')` block covering behaviour cases 1-8. Build fixtures with
   the existing `device()` helper plus overrides — note its default
   `link_speed_mbps` is 480 and its default `usb_version` is `'2.1'`, so
   Type-C port fixtures must override both (`link_speed_mbps: 0`,
   `usb_version: ''`, `category: 'TypeCPort'`, `properties: []`). Capability
   is a `properties` pair: `[['usb_capable_speed_mbps', '5000']]` — a decimal
   string, because that is what the wire carries.
4. Update the `# device-store.js has a Tier-0 issue tier` guard block:
   - The guard `check('device-store.js shares formatRate with the popover',
     src.includes('formatRate(top.link_speed_mbps)'))` **will now fail** — that
     literal is gone. Repoint it at the new call site
     (`formatRate(cap.negotiatedMbps)` or whatever Task 1 actually named the
     local) so it keeps protecting the same invariant.
   - Add positive guards that Tier 2 goes through gettext: the source contains
     `_('USB %s')`, `_('linked at %s')`, `_('not linked')` and
     `_('full capability')`, and calls `deriveCapabilityTile(`.
   - Add a negative guard on the sliced `deriveTileText` body (reuse the
     existing hand-sliced `deriveBody` — do not write a lazy regex over the
     whole file) asserting it contains no template-literal title, i.e. no
     match for `/title:\s*`/`. Before committing, confirm the guard is
     non-vacuous the way 260915-ikd did: check that `deriveBody` is non-empty
     and that the same regex matches the pre-change source.
   - Leave the `deriveTileText stays unaware of the daemon lifecycle` guard
     and every other existing assertion untouched.
5. Run all four suites, not just the one you edited — CI runs all four, and
   `tests/dbus-client.test.js` line-85-style fixtures elsewhere may reference
   tile text.

Run test commands under `rtk proxy`: the rtk hook filters build/test output
and would strip the pass/fail lines you need to read (STATE.md 260910-nge
records a run where this mattered).
  </action>
  <verify>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; rtk proxy gjs -m tests/forward-compat.test.js &amp;&amp; rtk proxy gjs -m tests/dbus-client.test.js &amp;&amp; rtk proxy gjs -m tests/daemon-status.test.js &amp;&amp; rtk proxy gjs -m tests/service-probe.test.js</automated>
  </verify>
  <done>
All four suites exit 0 with zero `FAIL -` lines. The assertion total is higher
than the pre-change baseline by at least the count of new checks, and the
SUMMARY records the per-suite numbers (the repo's convention — e.g. "483
assertions green (forward-compat 266, dbus-client 66, daemon-status 94,
service-probe 57)"). The new negative guard was demonstrated non-vacuous
against the pre-change source.
  </done>
</task>

<task type="auto">
  <name>Task 3: regenerate the translation template</name>
  <files>po/usbee@bitcreed.us.pot</files>
  <read_first>
    - /home/blk/projects/rust/usbee/CLAUDE.md, section "Regenerating the translation template" (the invocation is exact and its constraints are load-bearing)
  </read_first>
  <action>
Regenerate `po/usbee@bitcreed.us.pot` with the exact invocation CLAUDE.md
specifies — `prefs.js` listed before `src/*.js` (input order is load-bearing;
reversing it reorders every msgid block and fabricates a several-hundred-line
diff, per quick task 260910-nge), `--from-code=UTF-8`,
`--package-name=USBee`, and **no `--package-version`** (CLAUDE.md is explicit
that the version-free `Project-Id-Version: USBee` header is the intended state
and must not be "fixed" — it already drifted once and was corrected in
260915-mk0).

Do not hand-edit the template. Regenerate it and inspect the diff. The
expected delta is exactly +4 msgids and −0 (per ID-03): `USB %s`,
`linked at %s`, `not linked`, `full capability`. The `USB %s` and
`linked at %s` entries must carry xgettext's `javascript-format` flag; the
pre-existing `%s — full capability` popover msgid must still be present and
unchanged. Everything else in the diff must be confined to
`POT-Creation-Date` and `#:` line references.

Do NOT pack or install the extension. CLAUDE.md documents that
`gnome-extensions install --force` deletes through a symlinked dev checkout and
destroys the repo's extension sources; this task's verification is unit tests
and syntax checks only. The popover and tile need a Shell restart and cannot be
verified in-session — say so in the SUMMARY as an outstanding item rather than
claiming visual confirmation.

Do not bump `metadata.json`, do not tag, do not push.
  </action>
  <verify>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; xgettext --from-code=UTF-8 --package-name=USBee -o po/'usbee@bitcreed.us.pot' 'usbee@bitcreed.us/prefs.js' usbee@bitcreed.us/src/*.js &amp;&amp; msgfmt --check-format -o /dev/null po/'usbee@bitcreed.us.pot' &amp;&amp; git diff -U0 -- po/ > /tmp/hkf-pot.diff &amp;&amp; test "$(grep -c '^-msgid ' /tmp/hkf-pot.diff)" = 0 &amp;&amp; grep -q '^+msgid "USB %s"' /tmp/hkf-pot.diff &amp;&amp; grep -q '^+msgid "linked at %s"' /tmp/hkf-pot.diff &amp;&amp; grep -q '^+msgid "not linked"' /tmp/hkf-pot.diff &amp;&amp; grep -q '^+msgid "full capability"' /tmp/hkf-pot.diff &amp;&amp; grep -q 'Project-Id-Version: USBee.$' po/'usbee@bitcreed.us.pot' &amp;&amp; grep -q '^msgid "%s — full capability"' po/'usbee@bitcreed.us.pot' &amp;&amp; echo POT OK</automated>
  </verify>
  <done>
`msgfmt --check-format` is clean. The diff adds exactly 4 msgid lines and
removes none. `Project-Id-Version` still reads `USBee` with no version number.
The popover's `%s — full capability` msgid survives. No pack, no install, no
version bump.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| usbeehive D-Bus -> extension | Every `DeviceEntry` field and `properties: a(ss)` pair is attacker-shaped input from the extension's point of view: a compromised or buggy daemon, or a future wire revision, can send absent, empty, non-numeric or absurd values. |
| extension -> gnome-shell process | Anything this code throws or renders runs inside the compositor; an exception in `deriveTileText()` breaks the whole Quick Settings panel. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-hkf-01 | Tampering | `usb_capable_speed_mbps` property value | low | mitigate | Read only through the existing module-private `intProp`, which is total: absence, empty string and garbage all collapse to `null`, keeping "unknown" distinguishable from a real 0. No new parsing path is introduced. |
| T-hkf-02 | Denial of Service | `deriveCapabilityTile()` / `formatCapabilityBrand()` | low | mitigate | Both helpers are total functions with no throw path: non-finite and out-of-range ceilings return `''` / `null`, and the empty-brand case falls through to Tier 3 rather than rendering a blank title. Unit-tested at the edges in Task 2 (NaN, undefined, string, negative, 0.5, 200000). |
| T-hkf-03 | Information Disclosure | tile title text | low | accept | The tile shows a link-capability brand derived from data already rendered per-device in the popover. No new information leaves the machine or reaches the lock screen that was not already on the panel. |
| T-hkf-04 | Tampering | supply chain | n/a | accept | No package-manager installs in this plan — no npm, pip or cargo step exists in this repo's toolchain for the extension (pure GJS, no bundled binaries). No legitimacy gate applies. |
</threat_model>

<verification>
1. `rtk proxy gjs -m tests/forward-compat.test.js` plus the other three suites — all green, zero `FAIL -`.
2. `node --check` on `.mjs` copies of `device-store.js` and `popover.js` (they import gnome-shell resources and cannot be loaded under bare gjs).
3. `grep -n 'usb_version' usbee@bitcreed.us/src/device-store.js` shows only the `tuple[16]` unpack assignment plus prose — no render site.
4. `grep -rn "usb_version" usbee@bitcreed.us/src/ usbee@bitcreed.us/prefs.js` shows no remaining render site anywhere in the UI.
5. `msgfmt --check-format` clean, `.pot` diff exactly +4 / −0 msgids.
6. `hasLinkIssue` is byte-unchanged: `git diff -- usbee@bitcreed.us/src/link-verdict.js` touches only the two new helpers and the one widened `usbVersion` comment.
7. NOT verifiable in-session and must be recorded as outstanding: the rendered tile. The Shell must be restarted to load new extension code, and the extension must NOT be packed/installed over the symlinked dev checkout.
</verification>

<success_criteria>
- The tile title is `USB <brand>` where `<brand>` is a USB-IF closed-up rate form, for the most capable attached device.
- The subtitle is `full capability`, `linked at <measured rate>`, or `not linked` as the spec dictates.
- A capability tie resolves to the highest-negotiated device; Type-C port rows are excluded without any `usb_version` test.
- Nothing renders `usb_version` anywhere in the UI.
- `hasLinkIssue()` / Tier 0 unchanged — `BelowCapability` is still never a fault.
- The `5Gbps` (brand) vs `5 Gb/s` (measured) typography split is preserved and documented.
- Four msgids added under gettext with Translators comments; `.pot` regenerated by the exact documented invocation.
- All four gjs suites green; no pack, no install, no version bump, no push.
</success_criteria>

<output>
Create `.planning/quick/260917-hkf-tile-title-shows-max-link-capability-not/260917-hkf-SUMMARY.md` when done.
Record as outstanding: the tile is not visually verified (needs a Shell restart).
</output>
