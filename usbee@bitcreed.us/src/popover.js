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

import {buildEmptyStateItem} from './empty-state.js';
import {hasIssue} from './device-store.js';
import {iconForDevice} from './device-icon.js';

/**
 * Render the device list as an accordion of PopupSubMenuMenuItem rows.
 *
 * Called from tile.js every time the popover opens (D-11 lazy-rebuild).
 * Signal connections on each sub-menu's 'open-state-changed' are NOT tracked
 * by SignalRegistry — they live only as long as the PopupSubMenuMenuItem
 * instances, which are destroyed wholesale by section.removeAll() on the next
 * popover open (D-11 invariant; same pattern as Shell's bluetooth.js).
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
    // Must be first — never mutate while iterating (Pitfall C).
    section.removeAll();

    // PREFS-04 consumer — live read on every popover open (D-11 lazy-rebuild).
    // Filter predicate uses daemon-emitted tokens 'TypeCPort' / 'Empty'
    // (same strings src/device-store.js Tier-1 filter consumes).
    const hideEmpty = extension.getSettings().get_boolean('hide-empty-ports');
    let devices = store.devices;
    if (hideEmpty) {
        devices = devices.filter(d =>
            !(d.category === 'TypeCPort' && d.status === 'Empty'));
    }

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
    // Connections on row.menu live only until the next section.removeAll()
    // destroys the PopupSubMenuMenuItem tree — no leak path (T-03-04 mitigation).
    for (const row of rows) {
        row.menu.connect('open-state-changed', (_menu, open) => {
            if (!open) return;
            for (const other of rows) {
                if (other !== row && other.menu.isOpen)
                    other.menu.close(/* animate */ true);
            }
        });
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

// ---------------------------------------------------------------------------
// Key-derivation heuristic for the Adwaita detail panel left-column labels.
// Cheap substring + regex scan; no parsing guarantees. If no keyword matches,
// falls through to the generic 'Detail' label.
// ---------------------------------------------------------------------------

/**
 * Derive a translated left-column property label for a daemon bullet string.
 * @param {string} bullet  A single bullets[] entry from the device.
 * @param {string} category  Device category (e.g. 'TypeCPort').
 * @returns {string}  Gettext-marked label string.
 */
function keyForBullet(bullet, category) {
    if (/\d+\s*W\b/i.test(bullet))                         return _('Power');
    if (/Gb\/s|Mb\/s|Kb\/s/i.test(bullet))                 return _('Speed');
    if (/USB\s+\d/i.test(bullet))                          return _('Version');
    if (/sink|source/i.test(bullet))                       return _('Direction');
    if (/host|device/i.test(bullet) && category === 'TypeCPort')
                                                            return _('Role');
    if (/cable|limited|degraded|slower|swap|expected|unable|cannot|mismatch/i.test(bullet))
                                                            return _('Diagnostic');
    return _('Detail');
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
    row.icon.icon_name = iconForDevice(device);
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

    // One property row per bullet string.
    for (const bullet of (device.bullets || [])) {
        detailBox.add_child(buildPropertyRow(
            keyForBullet(bullet, device.category), bullet, device.category));
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
    const row = new St.BoxLayout({
        x_expand: true,
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
