// SPDX-License-Identifier: GPL-3.0-or-later
// src/empty-state.js
//
// Daemon-not-running empty-state widget (CONTEXT.md D-13, STATE-01).
// One PopupMenuItem containing:
//   - title: 'usbeehive daemon not running'
//   - hint:  'Run this command, then this list will populate automatically:'
//   - entry: read-only, selectable St.Entry with the systemctl command
//
// No retry button (UI-SPEC #primary-cta): NameOwnerChanged auto-recovers.
// No subprocess spawning (D-18, EGO PACK-05): user runs systemctl themselves.

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const SYSTEMCTL_CMD = 'systemctl --user enable --now usbeehive';

/**
 * Build the empty-state row. Returns a PopupMenu.PopupMenuItem.
 */
export function buildEmptyStateItem() {
    const item = new PopupMenu.PopupMenuItem('', {
        reactive: false,
        can_focus: false,
    });
    item.add_style_class_name('usbee-empty-state');
    item.label.text = _('usbeehive daemon not running');

    const box = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        style_class: 'usbee-empty-state-body',
    });

    const hint = new St.Label({
        text: _('Run this command, then this list will populate automatically:'),
        x_expand: true,
    });
    hint.clutter_text.line_wrap = true;

    const entry = new St.Entry({
        can_focus: true,
        reactive: true,
        text: SYSTEMCTL_CMD,
        style_class: 'usbee-empty-state-entry',
    });
    // [ASSUMED A1 — RESEARCH §Pitfall B]: if direct property assignment
    // doesn't take effect at runtime, swap for:
    //   entry.clutter_text.set_editable(false);
    //   entry.clutter_text.set_selectable(true);
    // Verify in Looking Glass during Task 7 manual smoke test.
    entry.clutter_text.editable = false;
    entry.clutter_text.selectable = true;

    box.add_child(hint);
    box.add_child(entry);
    item.add_child(box);

    return item;
}

/**
 * Build the daemon-out-of-date empty-state row. Returns a PopupMenu.PopupMenuItem.
 *
 * Distinct from buildEmptyStateItem() — the daemon is reachable on the bus
 * but its Version property is below MIN_USBEEHIVE_VERSION (COMPAT-02). The
 * user is expected to upgrade the usbeehive binary themselves first (the
 * extension cannot do that — EGO PACK-05 forbids binary installs); the
 * systemctl --user restart hint covers the post-upgrade restart step.
 *
 * Wired by Plan 04-02 Task 11 into a new populateOutOfDateState(section)
 * triggered by the DBusClient 'daemon-too-old' signal (see ADR).
 */
export function buildDaemonOutOfDateItem() {
    const RESTART_CMD = 'systemctl --user restart usbeehive';

    const item = new PopupMenu.PopupMenuItem('', {
        reactive: false,
        can_focus: false,
    });
    item.add_style_class_name('usbee-empty-state');
    item.label.text = _('usbeehive daemon out of date');

    const box = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        style_class: 'usbee-empty-state-body',
    });

    const hint = new St.Label({
        text: _('Update usbeehive, then restart it. This list will populate automatically:'),
        x_expand: true,
    });
    hint.clutter_text.line_wrap = true;

    const entry = new St.Entry({
        can_focus: true,
        reactive: true,
        text: RESTART_CMD,
        style_class: 'usbee-empty-state-entry',
    });
    // Mirror the read-only-but-selectable pattern of buildEmptyStateItem.
    entry.clutter_text.editable = false;
    entry.clutter_text.selectable = true;

    box.add_child(hint);
    box.add_child(entry);
    item.add_child(box);

    return item;
}
