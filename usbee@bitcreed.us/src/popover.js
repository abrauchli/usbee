// SPDX-License-Identifier: GPL-3.0-or-later
// src/popover.js
//
// Stateless popover render functions called from src/tile.js on the
// menu's 'open-state-changed' signal (D-11 lazy populate, Pattern 2).
//
// Plan 02 Task 3: replaced the Plan-01 headline-only populateDeviceRows
// with the full LIST-01..06 + DIAG-01..02 version — one St.Label per
// device.bullets[] entry, each with clutter_text.line_wrap = true so
// multi-line diagnostic strings wrap cleanly inside the popover width.
// populateEmptyState is unchanged from Plan 01.

import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {buildEmptyStateItem} from './empty-state.js';

/**
 * Render the device list (LIST-01..06, DIAG-01, DIAG-02).
 *
 * Per RESEARCH §Pitfall C, removeAll() must be the FIRST line so we
 * never iterate a section while mutating it.
 *
 * Per UI-SPEC #copywriting + RESEARCH §Threat T-01-02 / T-02-01, all
 * daemon strings are rendered verbatim via .text = ... — never via
 * markup APIs (untrusted data from session D-Bus).
 *
 * Per CONTEXT.md D-11 and UI-SPEC §interactions, the popover does NOT
 * rebuild while open. The tile subtitle still updates live via the
 * store's 'changed' signal; when the user closes and re-opens the
 * popover, the next 'open-state-changed' fires and this function reads
 * the current store state. Do NOT add a store.connect('changed', ...)
 * listener inside the toggle.
 *
 * @param {PopupMenuSection} section  The section to populate.
 * @param {DeviceStore} store         Current device snapshot.
 */
export function populateDeviceRows(section, store, extension) {
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
    for (const device of devices) {
        section.addMenuItem(buildDeviceRow(device));
    }
}

export function populateEmptyState(section) {
    section.removeAll();
    section.addMenuItem(buildEmptyStateItem());
}

/**
 * Build one PopupMenuItem row for a device.
 *
 * Visual hierarchy per UI-SPEC #hierarchy:
 *   [headline]              ← PopupMenuItem label (600-weight via Shell CSS)
 *   [bullet 1]              ← St.Label, line-wrapped
 *   [bullet 2]              ← St.Label, line-wrapped
 *   ...
 *
 * The body box gets style_class: 'body' so the stylesheet rule
 *   .usbee-device-row .body { spacing: 4px; }
 * applies the 4-px vertical token between bullets (UI-SPEC #spacing).
 * St does not support the adjacent-sibling (+) combinator — use BoxLayout's
 * native `spacing` property instead.
 *
 * Per-row icons are deliberately omitted — Phase 1 deferral per
 * RESEARCH §Daemon Wire Shape note (deferred to v1.x with
 * PopupImageMenuItem).
 *
 * @param {object} device  Unpacked DeviceEntry from the store.
 * @returns {PopupMenu.PopupMenuItem}
 */
function buildDeviceRow(device) {
    // Headline is set via the PopupMenuItem constructor's text arg,
    // which uses .text = internally — safe, no Pango markup parsing.
    // Fall back to device.id only if headline is empty (shouldn't happen
    // — daemon always emits a non-empty headline per RESEARCH §Daemon Wire Shape).
    const headline = device.headline || device.id || '';
    const item = new PopupMenu.PopupMenuItem(headline, {
        reactive:  false,
        can_focus: false,
    });
    item.add_style_class_name('usbee-device-row');

    // Body box — one St.Label per bullet, line-wrapped.
    // x_expand: true so labels stretch to the popover width and wrap
    // correctly (DIAG-02 multi-sentence diagnostic strings).
    const body = new St.BoxLayout({
        vertical:    true,
        x_expand:    true,
        style_class: 'body',
    });
    for (const bullet of (device.bullets || [])) {
        const lbl = new St.Label({text: bullet, x_expand: true});
        // DIAG-02: multi-line diagnostic strings must wrap cleanly.
        lbl.clutter_text.line_wrap = true;
        lbl.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        body.add_child(lbl);
    }
    item.add_child(body);
    return item;
}
