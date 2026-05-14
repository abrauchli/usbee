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

import {buildEmptyStateItem, buildDaemonOutOfDateItem} from './empty-state.js';
import {hasIssue} from './device-store.js';
import {iconForDevice} from './device-icon.js';
import {formatValueForKey, labelForKey} from './label-table.js';

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
        return;
    }

    // UI-03 — Issue-first stable sort. hasIssue(b) - hasIssue(a) floats
    // issue devices to the top; equal keys preserve insertion order.
    devices = [...devices].sort((a, b) =>
        Number(hasIssue(b)) - Number(hasIssue(a)));

    // Build one accordion row per device and wire the single-open constraint.
    const rows = [];
    for (const device of devices) {
        const row = buildDeviceRow(device);
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
 * @param {object} device  Unpacked DeviceEntry from the store.
 * @returns {PopupMenu.PopupSubMenuMenuItem}
 */
function buildDeviceRow(device) {
    const headline = device.headline || device.id || '';

    // Second arg `true` enables the built-in .icon slot on the row.
    const row = new PopupMenu.PopupSubMenuMenuItem(headline, true);
    const devIcon = iconForDevice(device);
    if (typeof devIcon === 'string')
        row.icon.icon_name = devIcon;
    else
        row.icon.gicon = devIcon;  // Gio.FileIcon for bundled SVGs
    row.add_style_class_name('usbee-device-row');

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

    // One property row per machine-key pair from the Devices2 properties bag
    // (CONTEXT D-2.0-04). Order is preserved — the daemon emits in a
    // deliberate order and labelForKey() is a pure resolver. Unknown keys
    // render the raw key string (WIRE-04 forward-compat, label-table.js).
    for (const [key, value] of (device.properties || [])) {
        detailBox.add_child(buildPropertyRow(
            labelForKey(key), formatValueForKey(key, value), device.category));
    }

    row.menu.addMenuItem(detailItem);
    return row;
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
