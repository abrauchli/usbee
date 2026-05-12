// src/popover.js
//
// Stateless popover render functions called from src/tile.js on the
// menu's 'open-state-changed' signal (D-11 lazy populate, Pattern 2).
//
// Plan 01: minimal — populateDeviceRows renders one PopupMenuItem per
// device using only the headline. Plan 02 Task 3 replaces
// populateDeviceRows with the full LIST-01..06 + DIAG-01..02 version
// (bullets rendered as St.Label with line_wrap = true).

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {buildEmptyStateItem} from './empty-state.js';

/**
 * Plan 01: headline-only rows. No bullets, no diagnostics yet.
 *
 * Per RESEARCH §Pitfall C: removeAll() must be the FIRST call — do not
 * iterate then remove.
 */
export function populateDeviceRows(section, store) {
    section.removeAll();
    if (store.devices.length === 0) {
        section.addMenuItem(new PopupMenu.PopupMenuItem(
            'No USB devices attached',
            {reactive: false, can_focus: false},
        ));
        return;
    }
    for (const device of store.devices) {
        section.addMenuItem(new PopupMenu.PopupMenuItem(
            device.headline || device.id,
            {reactive: false, can_focus: false, style_class: 'usbee-device-row'},
        ));
    }
}

export function populateEmptyState(section) {
    section.removeAll();
    section.addMenuItem(buildEmptyStateItem());
}
