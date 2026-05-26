// SPDX-License-Identifier: GPL-3.0-or-later
// src/popover.js
//
// Stateless popover render functions called from src/tile.js on the
// menu's 'open-state-changed' signal (D-11 lazy populate, Pattern 2).
//
// v1.1.0 rewrite: replaced the Plan-01/02 stacked-bullets pattern with a
// per-device PopupSubMenuMenuItem accordion layout. Each row carries a
// class/driver-derived symbolic icon, a headline, and a chevron. Clicking
// a row expands its Adwaita-coherent labelled-property detail panel; clicking
// another row collapses the previous one (single-row accordion, UI-02).
//
// SECURITY INVARIANTS (preserved from v1.0):
//   - All daemon strings are rendered verbatim via .text = ... — NEVER via
//     markup APIs (untrusted session D-Bus data, T-01-02 / T-02-01 mitigation).
//   - section.removeAll() is the FIRST call (Pitfall C: never mutate while iterating).

import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {buildEmptyStateItem, buildDaemonNotInstalledItem, buildDaemonOutOfDateItem} from './empty-state.js';
import {hasIssue, formatVolts, formatAmps, formatWatts} from './device-store.js';
import {iconForDevice} from './device-icon.js';
import {formatValueForKey, labelForKey} from './label-table.js';

// Explicit-deny list of property-bag keys gated behind the
// `show-technical-details` GSettings boolean. Anchored in CONTEXT
// 260526-c6p §"Property split — Balanced" (LOCKED). Forward-compat:
// any property key NOT in this set always renders, regardless of the
// toggle — the gate is deny-list, never allow-list (CONTEXT D-2).
const GATED_KEYS = new Set([
    'serial',
    'data_role',
    'power_mode',
    'pd_revision',
    'plug_orientation',
    'cable_current',
    'cable_type',
    'drivers',
]);

// Property-bag keys consumed by dedicated UI surfaces (transport pill strip,
// cable-trust row — quick task 260526-dmj §B/§C). Pulled out of the generic
// property-bag loop UNCONDITIONALLY so they never double-render as bare
// rows alongside their dedicated handler. Forward-compat (CONTEXT §E): the
// generic loop still renders unknown keys — this set is a small explicit
// deny-list, not an allow-list.
const HANDLED_BY_DEDICATED_UI = new Set([
    'cable.trust.zero_vid',
    'cable.trust.vid_unknown',
    'cable.trust.reserved_bits',
    'transport.usb2',
    'transport.usb3',
    'transport.usb4',
    'transport.dp_altmode',
    'transport.tb',
]);

/**
 * Render the device list as an accordion of PopupSubMenuMenuItem rows.
 *
 * Called from tile.js every time the popover opens (D-11 lazy-rebuild).
 * Signal connections on each sub-menu's 'open-state-changed' are tracked
 * per-row in `row._usbeeAccordionSigId` and explicitly disconnected before
 * the next section.removeAll() so a stale signal cannot fire on a finalised
 * menu object during a rebuild (CR-02 mitigation).
 *
 * UI-03 issue-first sort is a stable sort: Array.prototype.sort is stable
 * in SpiderMonkey (GJS, ES2019+), so daemon-emit order is preserved within
 * each bucket.
 *
 * @param {PopupMenuSection} section  The section to populate.
 * @param {DeviceStore} store         Current device snapshot.
 * @param {Extension} extension       USBee extension instance (for GSettings).
 */
export function populateDeviceRows(section, store, extension) {
    // CR-02: disconnect any per-row accordion handlers from the prior
    // populate() before removeAll() destroys the menu actors. Without this,
    // a stale 'open-state-changed' fired mid-rebuild (e.g. user double-clicks
    // the tile while a row is mid-animation) can call .isOpen / .close() on
    // a destroyed PopupSubMenu, triggering a "instance is invalid" gobject
    // finalize error.
    for (const item of section._getMenuItems()) {
        if (item._usbeeAccordionSigId && item.menu) {
            try {
                item.menu.disconnect(item._usbeeAccordionSigId);
            } catch (_e) {
                // Menu already destroyed — disconnect is a no-op anyway.
            }
            item._usbeeAccordionSigId = 0;
        }
    }
    // Must be first (after handler cleanup) — never mutate while iterating (Pitfall C).
    section.removeAll();

    // PREFS-04 consumer — live read on every popover open (D-11 lazy-rebuild).
    // Filter predicate uses daemon-emitted tokens 'TypeCPort' / 'Empty'
    // (same strings src/device-store.js Tier-1 filter consumes).
    const settings = extension.getSettings();
    const hideEmpty = settings.get_boolean('hide-empty-ports');
    const showHubs  = settings.get_boolean('show-hubs');
    // Quick task 260526-c6p — live read parallel to the two above. Gates
    // the GATED_KEYS deny-list inside the property-bag loop of buildDeviceRow.
    const showTech  = settings.get_boolean('show-technical-details');
    let devices = store.devices;
    if (hideEmpty)
        devices = devices.filter(d => !(d.category === 'TypeCPort' && d.status === 'Empty'));
    if (!showHubs)
        devices = devices.filter(d => d.category !== 'Hub');

    if (devices.length === 0) {
        section.addMenuItem(new PopupMenu.PopupMenuItem(
            _('No USB devices attached'),
            {reactive: false, can_focus: false},
        ));
        return 0;
    }

    // UI-03 — Issue-first stable sort. hasIssue(b) - hasIssue(a) floats
    // issue devices to the top; equal keys preserve insertion order.
    devices = [...devices].sort((a, b) =>
        Number(hasIssue(b)) - Number(hasIssue(a)));

    // Build one accordion row per device and wire the single-open constraint.
    const rows = [];
    for (const device of devices) {
        const row = buildDeviceRow(device, showTech);
        section.addMenuItem(row);
        rows.push(row);
    }

    // UI-02 — Single-row accordion: when a row opens, close all others.
    // Each connection's signal id is stashed on the row so the next
    // populateDeviceRows() invocation can disconnect it before
    // section.removeAll() destroys the menu actors (CR-02 mitigation,
    // T-03-04 mitigation).
    for (const row of rows) {
        const sigId = row.menu.connect('open-state-changed', (_menu, open) => {
            if (!open) return;
            for (const other of rows) {
                // Defensive: other.menu may have been destroyed by a
                // concurrent rebuild before this handler ran.
                if (other !== row && other.menu && other.menu.isOpen)
                    other.menu.close(/* animate */ true);
            }
        });
        row._usbeeAccordionSigId = sigId;
    }
    return devices.length;
}

/**
 * Render the empty state (daemon not running).
 * Unchanged from v1.0 — delegates to buildEmptyStateItem.
 *
 * @param {PopupMenuSection} section
 */
export function populateEmptyState(section) {
    section.removeAll();
    section.addMenuItem(buildEmptyStateItem());
}

/**
 * Render the "daemon not installed" empty state (quick task 260526-i7q).
 * Wired from tile.js _rebuildPopover() when the daemon is not running AND
 * isUsbeehiveServiceInstalled() returns false. Mirrors the populateEmptyState
 * shape but uses the dedicated copy from src/empty-state.js.
 *
 * @param {PopupMenuSection} section
 */
export function populateNotInstalledState(section) {
    section.removeAll();
    section.addMenuItem(buildDaemonNotInstalledItem());
}

/**
 * Render the "daemon out of date" empty state (COMPAT-02).
 * Wired from tile.js when DBusClient emits 'daemon-too-old'.
 * Mirrors the populateEmptyState shape but uses the dedicated copy
 * landed in src/empty-state.js by Plan 04-01.
 *
 * @param {PopupMenuSection} section
 */
export function populateOutOfDateState(section) {
    section.removeAll();
    section.addMenuItem(buildDaemonOutOfDateItem());
}

/**
 * Build one accordion row for a device.
 *
 * Uses PopupSubMenuMenuItem (the gnome-shell widget from bluetooth.js /
 * network.js) so the row carries a built-in icon slot (.icon), a title
 * label (.label), and a sub-menu (.menu) whose content panel is built as
 * a single non-reactive PopupBaseMenuItem containing a vertical St.BoxLayout
 * of labelled property rows (UI-05 Adwaita-coherent detail panel).
 *
 * The icon is set from iconForDevice() — UI-04.
 *
 * Value-column labels use .text = (never .set_markup) — T-01-02 mitigation.
 *
 * @param {object} device   Unpacked DeviceEntry from the store.
 * @param {boolean} showTech  Live read of show-technical-details GSettings.
 *   When false, keys in GATED_KEYS are skipped in the property-bag loop;
 *   all other rows (Summary, charging_diag, driver-not-bound, Subclass,
 *   and unknown property keys) render unconditionally.
 * @returns {PopupMenu.PopupSubMenuMenuItem}
 */
function buildDeviceRow(device, showTech) {
    const headline = device.headline || device.id || '';

    // Property-bag lookup map — built once per row build. Daemon values
    // are STRINGS on the wire (a(ss)), so every boolean-flag check below
    // compares to the literal 'true', not a JS boolean.
    const props = new Map(device.properties || []);

    // Second arg `true` enables the built-in .icon slot on the row.
    const row = new PopupMenu.PopupSubMenuMenuItem(headline, true);
    const devIcon = iconForDevice(device);
    if (typeof devIcon === 'string')
        row.icon.icon_name = devIcon;
    else
        row.icon.gicon = devIcon;  // Gio.FileIcon for bundled SVGs
    row.add_style_class_name('usbee-device-row');
    if (device.charging_diag?.is_warning)
        row.add_style_class_name('usbee-row-warning');

    // --- Transport pill strip (CONTEXT 260526-dmj §C) ---
    // First child of the expanded menu, ABOVE the detailItem. Renders only
    // when the device exposes an "interesting" non-baseline transport: a
    // displayed alt-mode (DisplayPort), Thunderbolt, or a Type-C port that
    // negotiated USB 2 only (worth flagging as a slow-port surprise).
    const pillStripItem = buildTransportPillStrip(device, props);
    if (pillStripItem)
        row.menu.addMenuItem(pillStripItem);

    // --- Detail panel (UI-05) ---
    // One non-reactive PopupBaseMenuItem wrapping a vertical St.BoxLayout.
    const detailItem = new PopupMenu.PopupBaseMenuItem({
        reactive:    false,
        can_focus:   false,
        style_class: 'usbee-detail-panel',
    });

    const detailBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
    });
    detailItem.add_child(detailBox);

    // Subtitle row (when non-empty) — key: 'Summary'.
    if (device.subtitle) {
        detailBox.add_child(buildPropertyRow(
            _('Summary'), device.subtitle, device.category));
    }

    // Charging diagnostic rows — rendered before the properties bag so the
    // most actionable info appears at the top of the detail panel.
    // summary is always shown when present; detail is shown when non-empty.
    // is_warning drives both the row style and the key label copy.
    if (device.charging_diag?.present) {
        const isWarn = device.charging_diag.is_warning;
        const diagKey = isWarn ? _('Charging issue') : _('Charging');
        const diagRow = buildPropertyRow(
            diagKey, device.charging_diag.summary, device.category);
        if (isWarn)
            diagRow.get_children()[0].add_style_class_name('usbee-detail-warning');
        detailBox.add_child(diagRow);
        if (device.charging_diag.detail) {
            const detailRow = buildPropertyRow(
                _('Detail'), device.charging_diag.detail, device.category);
            if (isWarn)
                detailRow.get_children()[0].add_style_class_name('usbee-detail-warning');
            detailBox.add_child(detailRow);
        }
    }

    // Cable trust row (CONTEXT 260526-dmj §B). Always visible when any
    // cable.trust.* flag is set — independent of show-technical-details
    // because cable safety is glance-priority. Reasons are joined in a
    // fixed order (zero VID → unknown VID → reserved bits) so the row's
    // contents are deterministic across renders.
    const trustReasons = [];
    if (props.get('cable.trust.zero_vid') === 'true')
        trustReasons.push(_('vendor ID is zero'));
    if (props.get('cable.trust.vid_unknown') === 'true')
        trustReasons.push(_('vendor ID not in USB-IF list'));
    if (props.get('cable.trust.reserved_bits') === 'true')
        trustReasons.push(_('reserved bits set in Cable VDO'));
    if (trustReasons.length > 0) {
        const trustValue = _('This cable looks unusual: %s')
            .format(trustReasons.join(_(', ')));
        const trustRow = buildPropertyRow(
            _('Cable trust'), trustValue, device.category);
        trustRow.get_children()[0].add_style_class_name('usbee-detail-warning');
        detailBox.add_child(trustRow);
    }

    // Structured Charger PDOs (CONTEXT 260526-dmj §D). Always visible when
    // pdo_list is non-empty (not gated on show-technical-details — charging
    // capability is glance priority). No-op when pdo_list is empty.
    buildPdoListBlock(detailBox, device);

    // DISP-04 / UX-1: flag devices the daemon could not bind a driver to.
    // Empty Type-C ports already say nothing about drivers — suppress the
    // row in that case (`status !== 'Empty'` gate).
    if (device.primary_driver === '' && device.status !== 'Empty') {
        const driverRow = buildPropertyRow(
            _('Driver'), _('not bound'), device.category);
        driverRow.add_style_class_name('usbee-detail-driver-missing');
        detailBox.add_child(driverRow);
    }

    // DISP-05 / UX-2: detail-panel-only treatment for the daemon's advisory
    // subclass hint. Empty subclass strings (default) render nothing; the
    // row title is intentionally unchanged (UX-2 rejects "append to title").
    if (device.device_subclass) {
        detailBox.add_child(buildPropertyRow(
            _('Subclass'), device.device_subclass, device.category));
    }

    // One property row per machine-key pair from the daemon's properties bag
    // (CONTEXT D-2.0-04). Order is preserved — the daemon emits in a
    // deliberate order and labelForKey() is a pure resolver. Unknown keys
    // render the raw key string (WIRE-04 forward-compat, label-table.js).
    //
    // Quick task 260526-c6p: when showTech is false, skip the explicit-deny
    // GATED_KEYS set (CONTEXT 260526-c6p D-2). Unknown keys are NEVER gated
    // — forward-compat by design (deny-list, not allow-list).
    //
    // Quick task 260526-dmj: HANDLED_BY_DEDICATED_UI keys never render as
    // bare rows — they are owned by the trust row and the pill strip above.
    // Filtered unconditionally, regardless of show-technical-details.
    //
    // Quick task 260526-dmj §D: legacy charger_max stringly row is
    // suppressed when the structured pdo_list is non-empty (the Charger
    // PDOs block above already covers that capability). When pdo_list is
    // empty, charger_max still renders — back-compat for daemons that emit
    // the property without the structured list.
    for (const [key, value] of (device.properties || [])) {
        if (key === 'charger_max' && device.pdo_list?.length > 0) continue;
        if (HANDLED_BY_DEDICATED_UI.has(key)) continue;
        if (!showTech && GATED_KEYS.has(key)) continue;
        detailBox.add_child(buildPropertyRow(
            labelForKey(key), formatValueForKey(key, value), device.category));
    }

    row.menu.addMenuItem(detailItem);
    return row;
}

/**
 * Build the transport pill strip menu item (CONTEXT 260526-dmj §C).
 *
 * "Interesting" predicate: a DisplayPort alt-mode, Thunderbolt, or USB4
 * flag fires unconditionally; the USB 2 flag only fires for Type-C ports
 * (a Type-C port that only negotiated USB 2 is the surprise; USB 2 on a
 * USB-A device is the expected baseline and would be noise).
 *
 * Pills render in a fixed order — USB → DisplayPort → Thunderbolt — so
 * grouping reads predictably across devices. USB4 joins the USB group
 * after USB 3 (added in v2.2.0 alongside usbeehive 0.8.0).
 *
 * @param {object} device  Unpacked DeviceEntry.
 * @param {Map<string,string>} props  device.properties as a Map.
 * @returns {PopupMenu.PopupBaseMenuItem|null}  null when no pill should render.
 */
function buildTransportPillStrip(device, props) {
    const usb2 = props.get('transport.usb2') === 'true';
    const usb3 = props.get('transport.usb3') === 'true';
    const usb4 = props.get('transport.usb4') === 'true';
    const dp   = props.get('transport.dp_altmode') === 'true';
    const tb   = props.get('transport.tb') === 'true';

    const interesting = dp || tb || usb4
        || (usb2 && device.category === 'TypeCPort');
    if (!interesting) return null;

    const pills = [];
    if (usb2) pills.push(_('USB 2'));
    if (usb3) pills.push(_('USB 3'));
    if (usb4) pills.push(_('USB 4'));
    if (dp)   pills.push(_('DisplayPort'));
    if (tb)   pills.push(_('Thunderbolt'));
    if (pills.length === 0) return null;

    const item = new PopupMenu.PopupBaseMenuItem({
        reactive:  false,
        can_focus: false,
    });
    const strip = new St.BoxLayout({
        vertical:    false,
        x_expand:    true,
        style_class: 'usbee-pill-strip',
    });
    for (const label of pills) {
        strip.add_child(new St.Label({
            text:        label,
            style_class: 'usbee-pill',
        }));
    }
    item.add_child(strip);
    return item;
}

/**
 * Render the structured Charger PDOs block (CONTEXT 260526-dmj §D).
 *
 * No-op when the device has no PDO list (the daemon emits an empty array
 * for entries without a companion PowerDeliveryPort). When non-empty,
 * renders a header row followed by one row per advertised PDO. The active
 * PDO is marked with a leading ◀ and a bolder key label (belt-and-braces:
 * either `is_active` true or `index === active_pdo_index` flips it).
 *
 * Voltage rendering:
 *   - PPS PDOs (kind === 'PPS') and PDOs that advertise a max_voltage
 *     greater than voltage render as a range "5–11 V".
 *   - Fixed PDOs (and anything with a flat voltage) render as "5 V".
 *
 * Kind annotation: anything other than 'Fixed' is appended as " (Kind)".
 * The kind string is passed through raw — forward-compat with new PD
 * revisions adding kinds USBee doesn't yet recognise.
 *
 * @param {St.BoxLayout} detailBox  Parent vertical box from buildDeviceRow.
 * @param {object} device           Unpacked DeviceEntry from the store.
 */
function buildPdoListBlock(detailBox, device) {
    const pdos = device.pdo_list || [];
    if (pdos.length === 0) return;

    detailBox.add_child(buildPropertyRow(
        _('Charger PDOs'), '', device.category));

    for (const pdo of pdos) {
        const isActive = pdo.is_active === true
            || pdo.index === device.active_pdo_index;

        const isRange = pdo.kind === 'PPS'
            || (pdo.max_voltage_mv > pdo.voltage_mv);
        const voltsText = isRange
            // Strip the trailing " V" from the min side so the unit only
            // appears once after the en-dash (e.g. "5–11 V", not "5 V–11 V").
            ? `${formatVolts(pdo.voltage_mv).replace(' V', '')}–${formatVolts(pdo.max_voltage_mv)}`
            : formatVolts(pdo.voltage_mv);
        const ampsText = formatAmps(pdo.current_ma);
        const wattsText = formatWatts(pdo.power_mw / 1000);

        let valueText = `${voltsText} — ${ampsText} — ${wattsText}`;
        if (pdo.kind && pdo.kind !== 'Fixed')
            valueText += ` (${pdo.kind})`;

        const keyText = isActive
            ? `${_('◀')} ${pdo.index}`
            : `${pdo.index}`;

        const pdoRow = buildPropertyRow(keyText, valueText, device.category);
        if (isActive)
            pdoRow.add_style_class_name('usbee-pdo-active');
        detailBox.add_child(pdoRow);
    }
}

/**
 * Build a single horizontal property row (key + value labels).
 *
 * The key label uses .usbee-detail-key (dim secondary colour).
 * The value label uses .usbee-detail-value (regular weight).
 * DIAG-02: value wraps cleanly via clutter_text.line_wrap.
 *
 * @param {string} key    Translated left-column label (e.g. 'Speed').
 * @param {string} value  Raw daemon string — rendered via .text, never markup.
 * @param {string} _category  Device category (unused here; passed for forward use).
 * @returns {St.BoxLayout}
 */
function buildPropertyRow(key, value, _category) {
    // WR-06: St.BoxLayout defaults to horizontal (vertical: false). The
    // .usbee-detail-row style_class gives the inter-column spacing instead of
    // a generic descendant selector on StBoxLayout.
    const row = new St.BoxLayout({
        vertical:    false,
        x_expand:    true,
        style_class: 'usbee-detail-row',
    });

    const keyLbl = new St.Label({
        text:        key,
        x_expand:    false,
        style_class: 'usbee-detail-key',
    });

    const valLbl = new St.Label({
        text:        value,
        x_expand:    true,
        style_class: 'usbee-detail-value',
    });
    // DIAG-02: multi-line diagnostic strings must wrap cleanly.
    valLbl.clutter_text.line_wrap      = true;
    valLbl.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

    row.add_child(keyLbl);
    row.add_child(valLbl);
    return row;
}
