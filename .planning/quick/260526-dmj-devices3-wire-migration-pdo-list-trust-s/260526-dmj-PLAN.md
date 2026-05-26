---
quick_id: 260526-dmj
type: execute
mode: quick
autonomous: true
files_modified:
  - usbee@bitcreed.us/src/dbus-client.js
  - usbee@bitcreed.us/src/device-store.js
  - usbee@bitcreed.us/src/popover.js
  - usbee@bitcreed.us/stylesheet.css
context_refs:
  - .planning/quick/260526-dmj-devices3-wire-migration-pdo-list-trust-s/260526-dmj-CONTEXT.md
  - ../usbeehive/CHANGELOG.md
  - ../usbeehive/src/dbus.rs

must_haves:
  truths:
    - "Extension talks to usbeehive 0.7.0 over org.usbeehive.Devices3 (Devices2 daemons route to daemon-too-old empty state)."
    - "Each unpacked device carries structured pdo_list[] and active_pdo_index from the new wire fields."
    - "Cable trust signals from the property bag render as exactly one amber-styled detail row when fired (regardless of show-technical-details)."
    - "An interesting-transport pill strip renders at the top of the detail panel when transport.dp_altmode/tb fire, or when transport.usb2 fires on a TypeCPort."
    - "When pdo_list is non-empty, a dedicated Charger PDOs block renders (active PDO marked), and the legacy charger_max property row is suppressed."
    - "cable.trust.* and transport.* keys never render as bare rows in the generic property-bag loop after the dedicated handlers land."
  artifacts:
    - path: usbee@bitcreed.us/src/dbus-client.js
      provides: "INTERFACE_NAME=Devices3, MIN_USBEEHIVE_VERSION=0.7.0, IFACE_XML with two trailing ListDevices fields"
    - path: usbee@bitcreed.us/src/device-store.js
      provides: "unpackDeviceEntry exposes pdo_list (named-key objects) + active_pdo_index; formatVolts + formatAmps helpers"
    - path: usbee@bitcreed.us/src/popover.js
      provides: "Cable trust row, transport pill strip, Charger PDOs block, filtered property-bag loop"
    - path: usbee@bitcreed.us/stylesheet.css
      provides: ".usbee-pill-strip / .usbee-pill / .usbee-pdo-* classes"
  key_links:
    - from: usbee@bitcreed.us/src/dbus-client.js
      to: usbee@bitcreed.us/src/device-store.js
      via: "ListDevicesRemote 21-field tuple → unpackDeviceEntry tuple[19]/tuple[20]"
      pattern: "tuple\\[19\\]|tuple\\[20\\]|pdo_list|active_pdo_index"
    - from: usbee@bitcreed.us/src/device-store.js
      to: usbee@bitcreed.us/src/popover.js
      via: "device.pdo_list / device.active_pdo_index consumed in buildDeviceRow"
      pattern: "device\\.pdo_list|active_pdo_index"
    - from: usbee@bitcreed.us/src/popover.js
      to: usbee@bitcreed.us/stylesheet.css
      via: "style classes usbee-pill-strip, usbee-pill, usbee-pdo-row, usbee-pdo-active"
      pattern: "usbee-pill|usbee-pdo"
---

<objective>
Wire the GNOME extension to usbeehive 0.7.0's `org.usbeehive.Devices3` interface and surface the three new daemon capabilities exposed by that wire: cable-trust signal row, transport pill strip, and structured Charger PDO list.

Purpose: usbeehive 0.7.0 is a hard cut (no Devices2 alias). Until Task 1 lands, the extension cannot read the daemon at all — 0.7.0 users see the "daemon out of date" empty state. Tasks 2 and 3 then translate the new properties + structured fields into the popover detail panel per the locked UX in CONTEXT §B/C/D.

Output: a working extension against usbeehive 0.7.0 with three atomic commits — one per task — landing the wire migration, the UI features that read from the property bag, and the UI feature that reads from the new structured tuple fields.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260526-dmj-devices3-wire-migration-pdo-list-trust-s/260526-dmj-CONTEXT.md
@usbee@bitcreed.us/src/dbus-client.js
@usbee@bitcreed.us/src/device-store.js
@usbee@bitcreed.us/src/popover.js
@usbee@bitcreed.us/src/label-table.js
@usbee@bitcreed.us/stylesheet.css
@../usbeehive/CHANGELOG.md
@../usbeehive/src/dbus.rs
</context>

<tasks>

<task type="auto">
  <name>Task 1: Devices3 wire migration (interface name + IFACE_XML + min daemon version + unpackDeviceEntry)</name>
  <files>usbee@bitcreed.us/src/dbus-client.js, usbee@bitcreed.us/src/device-store.js</files>
  <action>
Cut `org.usbeehive.Devices2` over to `org.usbeehive.Devices3` end-to-end, exactly as locked in CONTEXT §A. Hard cut, no alias, no compat shim — matches the Devices1 → Devices2 pattern the existing comment block at `dbus-client.js:20-27` already documents.

1. `usbee@bitcreed.us/src/dbus-client.js:26`: change `INTERFACE_NAME` from `'org.usbeehive.Devices2'` to `'org.usbeehive.Devices3'`. Update the inline comment at `dbus-client.js:20-23` to point at the Devices3 block in `../usbeehive/src/dbus.rs:336-455` (the `#[interface(name = "org.usbeehive.Devices3")]` impl).

2. `usbee@bitcreed.us/src/dbus-client.js:33`: change `MIN_USBEEHIVE_VERSION` from `'0.6.0'` to `'0.7.0'`. Update the explanatory comment at `dbus-client.js:28-32` to cite usbeehive `../usbeehive/CHANGELOG.md` §[0.7.0] (2026-05-26) as the source pin. The daemon-too-old path at `dbus-client.js:192` is unchanged — bumping the constant automatically routes 0.6.x users into the existing `populateOutOfDateState` empty state per CONTEXT §A bullet 4.

3. `usbee@bitcreed.us/src/dbus-client.js:71`: change `<interface name="org.usbeehive.Devices2">` to `<interface name="org.usbeehive.Devices3">`.

4. `usbee@bitcreed.us/src/dbus-client.js:73`: extend the `ListDevices` inner tuple signature with the two trailing fields per `../usbeehive/src/dbus.rs:25-28` and CONTEXT §A. The current value
       `a(ssssssssssqqsa(ss)ius(uus)(bsssb))`
   becomes
       `a(ssssssssssqqsa(ss)ius(uus)(bsssb)a(usuuuub)i)`
   (additions: `a(usuuuub)` for `pdo_list` and `i` for `active_pdo_index`). NOTE: per CONTEXT specifics, the XML uses an inline element type on a single `<arg>` (verify the literal at line 73 before editing — it is a flat string, not nested `<arg>` siblings).

5. `usbee@bitcreed.us/src/device-store.js:19-23` header comment block: update the wire-shape comment from "19-field structured DeviceEntry tuple" / `a(ssssssssssqqsa(ss)ius(uus)(bsssb))` to "21-field structured DeviceEntry tuple" / the full new signature. Reference Devices3 + CONTEXT 260526-dmj where the old comment cites Devices2 + CONTEXT D-2.0-02.

6. `usbee@bitcreed.us/src/device-store.js:27-61` (`unpackDeviceEntry`): append unpacking for the two new tuple slots. Each `pdo_list` entry is itself a `(usuuuub)` tuple — unpack into named keys so popover.js never indexes by position (matches the existing pattern for `power` and `charging_diag`). Add inside the returned object, after `charging_diag`:

   - Read `tuple[19]` as the raw PDO tuple array (default `[]`); map each `p` to `{index: p[0], kind: p[1], voltage_mv: p[2], max_voltage_mv: p[3], current_ma: p[4], power_mw: p[5], is_active: p[6]}`. Store on returned object as `pdo_list`.
   - Read `tuple[20]` as `active_pdo_index` (default `-1` via `?? -1`).

7. `usbee@bitcreed.us/src/device-store.js:237-244` (`setDevices` JSDoc): update the `@param` line to reference the new 21-field signature and Devices3.

Do NOT add any UI in this task — popover.js is not touched. Tasks 2 and 3 consume the new fields. Honour CLAUDE.md: GPL-3.0 header is already present on both files; do not re-add. No new gettext strings in this task.
  </action>
  <verify>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; grep -n "org.usbeehive.Devices3" usbee@bitcreed.us/src/dbus-client.js | grep -v '^#' | wc -l | awk '$1 &gt;= 2 {exit 0} {exit 1}' &amp;&amp; grep -c "MIN_USBEEHIVE_VERSION = '0.7.0'" usbee@bitcreed.us/src/dbus-client.js | awk '$1 == 1 {exit 0} {exit 1}' &amp;&amp; grep -c "a(usuuuub)i)" usbee@bitcreed.us/src/dbus-client.js | awk '$1 == 1 {exit 0} {exit 1}' &amp;&amp; grep -c "pdo_list:" usbee@bitcreed.us/src/device-store.js | awk '$1 &gt;= 1 {exit 0} {exit 1}' &amp;&amp; grep -c "active_pdo_index" usbee@bitcreed.us/src/device-store.js | awk '$1 &gt;= 1 {exit 0} {exit 1}' &amp;&amp; ! grep -n "org.usbeehive.Devices2" usbee@bitcreed.us/src/dbus-client.js</automated>
    <human-check>
      Smoke test (manual — codebase has no JS test framework per CLAUDE.md):
      1. Ensure usbeehive 0.7.0 is running: `busctl --user introspect org.usbeehive.Devices /org/usbeehive/Devices | grep '&lt;interface'` should show `org.usbeehive.Devices3`.
      2. Hot-reload the extension (`gnome-extensions disable usbee@bitcreed.us &amp;&amp; gnome-extensions enable usbee@bitcreed.us` or full Xorg `Alt+F2 r`).
      3. Open the tile → confirm the device list populates (no "daemon out of date" state).
      4. In Looking Glass (`Alt+F2 → lg`), evaluate: `Main.panel.statusArea.quickSettings._indicators` — pick the USBee instance, drill into its `_store._devices[0]` — confirm `pdo_list` and `active_pdo_index` are present (PDO list may be `[]` on devices without a PD partner; that is correct).
      5. Stop usbeehive (or `cargo run` an older 0.6.x build) → extension shows the daemon-out-of-date empty state.
    </human-check>
  </verify>
  <done>
- `INTERFACE_NAME === 'org.usbeehive.Devices3'` and the IFACE_XML `<interface>` element matches.
- `MIN_USBEEHIVE_VERSION === '0.7.0'`.
- `ListDevices` inner-tuple signature ends with `…(bsssb)a(usuuuub)i)`.
- `unpackDeviceEntry` returns objects carrying `pdo_list` (array of named-key objects) and `active_pdo_index` (number, defaults `-1`).
- No references to `Devices2` remain in `dbus-client.js`.
- Extension live-connects to a running usbeehive 0.7.0 daemon and renders devices (verified via Looking Glass / smoke test).
- Atomic commit `feat(dbus): migrate to org.usbeehive.Devices3 + pdo_list/active_pdo_index` (single commit covering both files).
  </done>
</task>

<task type="auto">
  <name>Task 2: Cable trust row + transport pill strip (property-bag UI features)</name>
  <files>usbee@bitcreed.us/src/popover.js, usbee@bitcreed.us/stylesheet.css</files>
  <action>
Add two property-bag-driven UI features to the detail panel per CONTEXT §B and §C (LOCKED — do not revisit the UX questions). Both read from the `device.properties` `a(ss)` bag emitted by the daemon — VALUES ARE STRINGS, so equality checks compare to the literal `'true'`, not the boolean.

Edit `usbee@bitcreed.us/src/popover.js` only inside `buildDeviceRow` (around lines 181-270) and the GATED_KEYS region (lines 28-42). Edit `stylesheet.css` to add the pill styles.

### Step 1 — Property-bag lookup helper (top of buildDeviceRow)

At the top of `buildDeviceRow` (after `const headline = …` at line 182), build a fast lookup map once per device-row build:

  `const props = new Map(device.properties || []);`

Use `props.get(key) === 'true'` for every trust/transport boolean check below. This is the only place equality semantics live — keep the comparison in one idiom for grep-ability.

### Step 2 — Filter list for the generic property-bag loop

Define a module-private `Set` at the top of `popover.js` (near `GATED_KEYS` at line 33) of keys that the dedicated handlers cover and that MUST NOT also render as bare rows in the loop. Per CONTEXT §E, these keys are pulled OUT of the loop regardless of `show-technical-details`:

```
const HANDLED_BY_DEDICATED_UI = new Set([
    'cable.trust.zero_vid',
    'cable.trust.vid_unknown',
    'cable.trust.reserved_bits',
    'transport.usb2',
    'transport.usb3',
    'transport.dp_altmode',
    'transport.tb',
]);
```

In the property-bag loop at `popover.js:262-266`, add a filter alongside the existing `GATED_KEYS` check:

  `if (HANDLED_BY_DEDICATED_UI.has(key)) continue;`

Place it BEFORE the `GATED_KEYS` check so the new keys are filtered unconditionally. (Task 3 will extend this region further with the `charger_max` filter.)

### Step 3 — Transport pill strip (CONTEXT §C, FIRST element of detailBox)

Insert BEFORE the `if (device.subtitle)` Summary block at `popover.js:210`. Build a pill strip but only when the "interesting" predicate fires:

  - `interesting = props.get('transport.dp_altmode') === 'true' || props.get('transport.tb') === 'true' || (props.get('transport.usb2') === 'true' && device.category === 'TypeCPort')`

When `interesting`, build the pills array in this fixed order — USB → DisplayPort → Thunderbolt, skipping flags that did not fire:
  - if `props.get('transport.usb2') === 'true'` → label `_('USB 2')`
  - if `props.get('transport.usb3') === 'true'` → label `_('USB 3')`
  - if `props.get('transport.dp_altmode') === 'true'` → label `_('DisplayPort')`
  - if `props.get('transport.tb') === 'true'` → label `_('Thunderbolt')`

Render via a horizontal `St.BoxLayout` (vertical: false, x_expand: true, style_class: `'usbee-pill-strip'`) containing one `St.Label` per pill (style_class: `'usbee-pill'`, `.text = …`, never markup — preserves T-01-02 invariant noted at `popover.js:15`). Wrap that BoxLayout in a non-reactive `PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false})` so it slots into the menu hierarchy cleanly (same widget pattern as `detailItem` at `popover.js:197-207`). Add it to `row.menu` BEFORE `row.menu.addMenuItem(detailItem)` — pill strip on top, Summary/diag/etc inside the detail item.

Use `_()` on every label string; do NOT use template literals for translator-visible text (xgettext skips template literals — CLAUDE.md i18n constraint).

### Step 4 — Cable trust row (CONTEXT §B, after charging diag, before driver-not-bound)

Insert BETWEEN the charging-diag block (`popover.js:219-234`) and the driver-not-bound block (`popover.js:239-244`).

Detect fired reasons in this fixed order (each a separate gettext call for translator clarity):
  - `props.get('cable.trust.zero_vid') === 'true'` → `_('vendor ID is zero')`
  - `props.get('cable.trust.vid_unknown') === 'true'` → `_('vendor ID not in USB-IF list')`
  - `props.get('cable.trust.reserved_bits') === 'true'` → `_('reserved bits set in Cable VDO')`

If the reasons array is non-empty:
  - Join with `_(', ')` (i18n-safe separator — some locales differ).
  - Build the final value with `_('This cable looks unusual: %s').format(joined)`.
  - Build the row via `buildPropertyRow(_('Cable trust'), value, device.category)`.
  - Apply the existing warning style to the KEY label (mirrors the charging-issue pattern at `popover.js:225`): `row.get_children()[0].add_style_class_name('usbee-detail-warning');`
  - `detailBox.add_child(row);`

This row is ALWAYS visible when fired, regardless of `show-technical-details` (cable safety is glance-priority — CONTEXT §B).

### Step 5 — Stylesheet additions

Append to `usbee@bitcreed.us/stylesheet.css` (after the existing `.usbee-detail-warning` block at lines 76-79):

  - `.usbee-pill-strip { spacing: 6px; padding: 6px 12px 0 32px; }` (left padding matches `.usbee-detail-panel` so pills align under the row icon — see line 37).
  - `.usbee-pill { border-radius: 999px; padding: 2px 10px; background-color: rgba(255, 255, 255, 0.10); }` (theme-neutral muted background per CONTEXT §C).

Do not introduce any new font-size rule; let pills inherit shell defaults.

### Forward-compat invariants to preserve (CONTEXT §E)

- Unknown property keys keep rendering through the generic loop (the `HANDLED_BY_DEDICATED_UI` filter is a small explicit deny-list, not allow-list).
- `GATED_KEYS` (`show-technical-details` deny-list) is untouched and still applies to the keys it already names.
  </action>
  <verify>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; grep -c "usbee-pill-strip" usbee@bitcreed.us/src/popover.js | awk '$1 &gt;= 1 {exit 0} {exit 1}' &amp;&amp; grep -c "usbee-pill-strip" usbee@bitcreed.us/stylesheet.css | awk '$1 &gt;= 1 {exit 0} {exit 1}' &amp;&amp; grep -c "Cable trust" usbee@bitcreed.us/src/popover.js | awk '$1 &gt;= 1 {exit 0} {exit 1}' &amp;&amp; grep -c "HANDLED_BY_DEDICATED_UI" usbee@bitcreed.us/src/popover.js | awk '$1 &gt;= 2 {exit 0} {exit 1}' &amp;&amp; grep -c "cable.trust.zero_vid" usbee@bitcreed.us/src/popover.js | awk '$1 &gt;= 1 {exit 0} {exit 1}' &amp;&amp; grep -c "transport.dp_altmode" usbee@bitcreed.us/src/popover.js | awk '$1 &gt;= 1 {exit 0} {exit 1}' &amp;&amp; ! grep -n "set_markup" usbee@bitcreed.us/src/popover.js</automated>
    <human-check>
      Smoke test (manual — no JS test framework per CLAUDE.md). Requires usbeehive 0.7.0 running with at least one PD-connected device.
      1. Hot-reload the extension.
      2. With a Type-C device attached on a port whose negotiated speed is USB2 (or use a TB/DP-altmode device if available), open the tile and expand the device row. Verify:
         - A horizontal pill strip is the FIRST element in the expanded panel, sitting above the Summary row.
         - Pills appear in the order USB → DisplayPort → Thunderbolt (skipping unfired).
         - Pills have pill-shape (rounded ends) and a muted background that reads under both light and dark Adwaita themes.
      3. If the daemon emits a cable trust flag (induced via a known-bad cable or by hand-editing `usbeehive`'s test fixture), expand the row and verify:
         - A single amber-coloured "Cable trust" row appears AFTER "Charging issue"/"Detail" and BEFORE "Driver" (when present).
         - Value reads "This cable looks unusual: …" with all fired reasons joined by ", ".
         - The row's KEY label is amber (#e5a50a), mirroring "Charging issue" copy treatment.
      4. Verify the `cable.trust.*` and `transport.*` keys do NOT also appear as bare rows in the property-bag loop (no `cable.trust.zero_vid: true` row at the bottom of the panel).
      5. Toggle `Show technical details` off — verify the trust row STILL renders when fired (it is always visible, regardless of the toggle).
    </human-check>
  </verify>
  <done>
- `HANDLED_BY_DEDICATED_UI` set declared near `GATED_KEYS` and consulted in the property-bag loop.
- Pill strip renders as the first child of `row.menu` (above the detail item) iff the interesting predicate fires; pills appear in USB → DisplayPort → Thunderbolt order; never renders for plain USB-A devices.
- Cable trust row renders exactly once when any `cable.trust.*` fires; key styled `usbee-detail-warning`; visible regardless of `show-technical-details`.
- No `cable.trust.*` or `transport.*` keys leak through the generic property-bag loop.
- All user-visible strings wrapped in `_()` (no template literals, no `.set_markup`).
- New CSS classes `.usbee-pill-strip` and `.usbee-pill` added with rounded ends + muted background.
- Atomic commit `feat(popover): cable-trust row + transport pill strip (Devices3)`.
  </done>
</task>

<task type="auto">
  <name>Task 3: Structured PDO list render (Charger PDOs block; suppress charger_max)</name>
  <files>usbee@bitcreed.us/src/popover.js, usbee@bitcreed.us/src/device-store.js, usbee@bitcreed.us/stylesheet.css</files>
  <action>
Render the new structured `pdo_list` from Task 1 as a dedicated Charger PDOs block per CONTEXT §D (LOCKED). Replaces the legacy `charger_max` stringly row when `pdo_list` is non-empty.

### Step 1 — Voltage / current formatters (device-store.js)

Add two small helpers in `usbee@bitcreed.us/src/device-store.js` next to the existing `formatWatts` at line 72. Export them so popover.js can import (matches the export style used for `deriveTileText`, `deriveSubtitle`, `hasIssue`).

  - `export function formatVolts(mv)`: `mv % 1000 === 0 ? \`${mv / 1000} V\` : \`${(mv / 1000).toFixed(1)} V\`` — non-finite or negative → `_('—')`.
  - `export function formatAmps(ma)`: `ma % 1000 === 0 ? \`${ma / 1000} A\` : \`${(ma / 1000).toFixed(1)} A\`` — non-finite or negative → `_('—')`.

Mirror the defensive guard in `formatWatts` at lines 72-75 (the WR-05 pattern). Reuse the existing `formatWatts` for PDO power (`formatWatts(pdo.power_mw / 1000)`).

Inline location is preferred per CONTEXT discretion bullet ("preference: inline if total LOC <30, extract if more") — these helpers fit alongside `formatWatts` rather than warranting a new `src/pdo.js`.

### Step 2 — PDO render helper (popover.js)

Import `formatVolts`, `formatAmps`, `formatWatts` from `./device-store.js` (extend the existing `import {hasIssue} from './device-store.js'` at line 24).

Add a module-private `buildPdoListBlock(detailBox, device)` helper near `buildPropertyRow` (around `popover.js:284-312`). It receives the parent `detailBox` and the device, and is a no-op when `device.pdo_list.length === 0`.

When non-empty:
  - Add a header row via `buildPropertyRow(_('Charger PDOs'), '', device.category)` — empty value, so the value column is blank and the row reads as a section title. (Alternatively render a single-label header row; pick whichever lines up better visually with the existing detail panel rhythm.)
  - For each `pdo` in `device.pdo_list`:
    - Compute `isActive = pdo.is_active === true || pdo.index === device.active_pdo_index` (belt-and-braces, per CONTEXT §D).
    - Build the value text: voltage + " — " + current + " — " + power (em-dash separators per CONTEXT §D row layout).
      - Voltage: PPS PDOs (`pdo.kind === 'PPS'`) and PDOs with `max_voltage_mv > voltage_mv` render as `"5–11 V"` (en-dash, using `pdo.voltage_mv` for min and `pdo.max_voltage_mv` for max — emit `${formatVolts(pdo.voltage_mv).replace(' V','')}–${formatVolts(pdo.max_voltage_mv)}`). Otherwise `formatVolts(pdo.voltage_mv)`.
      - Current: `formatAmps(pdo.current_ma)`.
      - Power: `formatWatts(pdo.power_mw / 1000)`.
      - When `pdo.kind && pdo.kind !== 'Fixed'`, append `" (${pdo.kind})"` — Fixed is noise; everything else is a meaningful annotation. Translate the kind label only if it appears in a known-set — pass through raw daemon string otherwise (forward-compat).
    - Key text: `isActive ? `${_('◀')} ${index}` : `${index}`` — keep it short; the arrow marker is the active indicator. (Alternatively place the arrow at the END of the value; pick whichever sits cleanest against `usbee-detail-key`'s min-width: 7em from `stylesheet.css:46`.)
    - Build the row via `buildPropertyRow(keyText, valueText, device.category)`.
    - When `isActive`, add the `'usbee-pdo-active'` style class to the row (or to its key label — pick the same site Task 2 used for the trust row, for consistency).
    - Append to `detailBox`.

Use the established `.text = …` invariant — never `.set_markup` — and wrap every user-visible string (including `_('Charger PDOs')`, `_('◀')`, and the future kind labels if translated) in `_()`.

### Step 3 — Wire the call site and filter charger_max

In `buildDeviceRow` in `popover.js`, INSERT the `buildPdoListBlock(detailBox, device)` call AFTER the cable-trust row added in Task 2 and BEFORE the property-bag loop at `popover.js:262`. Final detail-panel ordering top-to-bottom must match CONTEXT constraints:
  1. Transport pill strip (in `row.menu`, above detailItem — Task 2)
  2. Summary row (existing, line 210)
  3. Charging / Charging issue / Detail rows (existing, lines 219-234)
  4. Cable trust row (Task 2)
  5. Charger PDOs block (THIS task)
  6. Driver-not-bound row (existing, lines 239-244)
  7. Subclass row (existing, lines 249-252)
  8. Property-bag loop (existing, lines 262-266 — filtered)

In the property-bag loop's filter (the `if (HANDLED_BY_DEDICATED_UI.has(key)) continue;` introduced in Task 2), extend to also suppress `charger_max` WHEN `device.pdo_list.length > 0`. Inline:

  `if (key === 'charger_max' && device.pdo_list?.length > 0) continue;`

Place this BEFORE the `HANDLED_BY_DEDICATED_UI` check. When `pdo_list` is empty, the legacy `charger_max` row still renders as before (back-compat for daemons that emit `charger_max` without the structured list — though per the CHANGELOG, 0.7.0 emits both).

### Step 4 — Stylesheet additions

Append to `usbee@bitcreed.us/stylesheet.css` (after the pill styles from Task 2):

  - `.usbee-pdo-active .usbee-detail-key { font-weight: bold; }` (active PDO gets bolder key label — the arrow marker is the belt, this is the braces per CONTEXT §D).

PDO list is ALWAYS visible when non-empty (NOT gated behind `show-technical-details` — CONTEXT §D) — no settings reads needed in `buildPdoListBlock`.
  </action>
  <verify>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; grep -c "export function formatVolts" usbee@bitcreed.us/src/device-store.js | awk '$1 == 1 {exit 0} {exit 1}' &amp;&amp; grep -c "export function formatAmps" usbee@bitcreed.us/src/device-store.js | awk '$1 == 1 {exit 0} {exit 1}' &amp;&amp; grep -c "buildPdoListBlock" usbee@bitcreed.us/src/popover.js | awk '$1 &gt;= 2 {exit 0} {exit 1}' &amp;&amp; grep -c "Charger PDOs" usbee@bitcreed.us/src/popover.js | awk '$1 &gt;= 1 {exit 0} {exit 1}' &amp;&amp; grep -c "charger_max" usbee@bitcreed.us/src/popover.js | awk '$1 &gt;= 1 {exit 0} {exit 1}' &amp;&amp; grep -c "usbee-pdo-active" usbee@bitcreed.us/stylesheet.css | awk '$1 &gt;= 1 {exit 0} {exit 1}' &amp;&amp; grep -c "active_pdo_index" usbee@bitcreed.us/src/popover.js | awk '$1 &gt;= 1 {exit 0} {exit 1}' &amp;&amp; ! grep -n "set_markup" usbee@bitcreed.us/src/popover.js</automated>
    <human-check>
      Smoke test (manual — no JS test framework per CLAUDE.md). Requires usbeehive 0.7.0 running with at least one PD-source-connected USB-C port (e.g. a laptop charger or a PD-capable hub).
      1. Hot-reload the extension.
      2. Expand the Type-C port row attached to a known charger. Verify:
         - A "Charger PDOs" header row appears AFTER any cable-trust row but BEFORE any "Driver: not bound" row.
         - One row per PDO advertised by the source, each showing voltage — current — power (e.g. `5 V — 3 A — 15 W`, `9 V — 3 A — 27 W`, `15 V — 3 A — 45 W`, `20 V — 5 A — 100 W`).
         - The active PDO has a `◀` marker and a bolder key label.
         - PPS PDOs render as a voltage range (`5–11 V`) with `(PPS)` annotation; Fixed PDOs have no kind annotation.
         - The legacy `Charger max` row does NOT appear (suppressed by the filter).
      3. Detach the charger; reattach a USB-A peripheral with no PD partner; verify the Charger PDOs block does NOT render (pdo_list is empty for that entry), and that — if the daemon still emits `charger_max` for non-PD reasons — the legacy row appears as before (back-compat path).
      4. Toggle `Show technical details` off — verify the Charger PDOs block STILL renders (always visible when fired, per CONTEXT §D).
    </human-check>
  </verify>
  <done>
- `formatVolts(mv)` and `formatAmps(ma)` are exported from `device-store.js` with `formatWatts`-style defensive guards.
- `popover.js` imports both, plus `formatWatts`, and uses them in `buildPdoListBlock`.
- `buildPdoListBlock(detailBox, device)` renders nothing when `pdo_list.length === 0`; renders a header + one row per PDO otherwise.
- Active PDO (`is_active === true || index === active_pdo_index`) gets the `◀` marker AND the `usbee-pdo-active` style class (belt-and-braces).
- PPS / non-Fixed kinds annotated; Fixed kinds clean.
- `charger_max` property row is suppressed from the generic loop when `pdo_list` is non-empty; still renders when empty.
- PDO block ALWAYS visible (no `show-technical-details` gate).
- Detail-panel rendering order matches the 8-step contract in CONTEXT (Transport pills → Summary → Charging → Trust → PDOs → Driver → Subclass → Properties loop).
- Atomic commit `feat(popover): Charger PDOs block (structured pdo_list)`.
  </done>
</task>

</tasks>

<verification>
1. Run the static gate from each task's `<automated>` block — all three must pass.
2. Run `cd /home/blk/projects/rust/usbee && grep -rn "Devices2" usbee@bitcreed.us/src/ --include='*.js'` — should return no matches (the Devices1→Devices2 history-comment in the previous version of dbus-client.js gets updated in Task 1, not preserved).
3. With usbeehive 0.7.0 live: open the tile, expand at least one Type-C port row carrying a PD partner, verify visual order matches the 8-step contract.
4. Stop usbeehive, restart at 0.6.x → extension shows the "daemon out of date" empty state on the next watch-name appear (no crash, no broken UI).
5. `gnome-extensions pack usbee@bitcreed.us` from the repo root completes without error (no schema or syntax regressions).
</verification>

<success_criteria>
- Extension consumes `org.usbeehive.Devices3` end-to-end; the daemon-too-old gate activates on 0.6.x.
- The popover detail panel renders, in this top-to-bottom order: transport pill strip (when interesting), Summary, charging diag rows, cable trust row, Charger PDOs block, driver-not-bound, Subclass, filtered property-bag loop.
- `cable.trust.*` and `transport.*` keys never leak through the generic property loop; `charger_max` is suppressed iff `pdo_list` is non-empty.
- All user-visible strings flow through gettext (`_(…).format(…)` shape, no template literals); all daemon strings render via `.text = …` (no `.set_markup`).
- Three atomic commits land in this order: wire migration → trust+pills → PDO list.
</success_criteria>

<output>
On completion, create `.planning/quick/260526-dmj-devices3-wire-migration-pdo-list-trust-s/260526-dmj-SUMMARY.md` recording: the three commits (hashes), the verified Devices3 introspection capture (output of `busctl --user introspect`), and any deviations from the locked CONTEXT decisions (expected: none — every UX call is locked).
</output>
