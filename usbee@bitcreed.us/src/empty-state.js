// SPDX-License-Identifier: GPL-3.0-or-later
// src/empty-state.js
//
// Daemon empty-state widgets — three distinct flavours (quick task 260526-i7q):
//   - buildEmptyStateItem()         — service installed but stopped
//                                     ('systemctl --user enable --now usbeehived')
//   - buildDaemonNotInstalledItem() — service unit file missing on disk
//                                     ('usbeehived --install-service')
//   - buildDaemonOutOfDateItem()    — daemon reachable but Version too old
//                                     ('cargo install usbeehive --features=dbus')
//
// Each one is a PopupMenuItem containing a title label, a hint label, and a
// read-only-but-selectable St.Entry with the relevant copy-pasteable command.
//
// No retry button (UI-SPEC #primary-cta): NameOwnerChanged auto-recovers.
// No subprocess spawning (D-18, EGO PACK-05): user runs the command themselves.
// The not-installed detection uses Gio.File.query_exists() (synchronous local
// stat() on a small known set of paths — explicitly permitted under D-15,
// which prohibits sync D-Bus and network calls, not local file probes).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {MIN_USBEEHIVE_VERSION} from './daemon-status.js';

const SYSTEMCTL_CMD = 'systemctl --user enable --now usbeehived';
const INSTALL_CMD   = 'usbeehived --install-service';
const UPDATE_CMD    = 'cargo install usbeehive --features=dbus';

// Cache for isUsbeehiveServiceInstalled(). The popover is opened on user
// click — we don't need sub-second freshness, but we DO want a user who
// just ran `usbeehived --install-service` in a terminal to see the state
// flip without restarting gnome-shell. 30 s is short enough for that and
// long enough that rapid open/close cycles of the popover don't repeatedly
// hit the filesystem.
const INSTALLED_CACHE_TTL_US = 30 * GLib.USEC_PER_SEC;
let _installedCache = null;
let _cachedAt = 0;

// Standard systemd user-unit search paths, in lookup order:
//   1. XDG user data dir   — installs via `usbeehived --install-service`
//   2. /usr/lib/systemd    — distro-packaged installs (Fedora, Arch)
//   3. /etc/systemd        — sysadmin-managed installs
const UNIT_SEARCH_PATHS = [
    `${GLib.get_user_data_dir()}/systemd/user/usbeehived.service`,
    '/usr/lib/systemd/user/usbeehived.service',
    '/etc/systemd/user/usbeehived.service',
];

/**
 * Return true when the usbeehived.service unit file exists in any of the
 * standard systemd user-unit search paths. Cached for INSTALLED_CACHE_TTL_US
 * microseconds so a rebuild storm doesn't stat() the filesystem repeatedly.
 *
 * @returns {boolean}
 */
export function isUsbeehiveServiceInstalled() {
    const now = GLib.get_monotonic_time();
    if (_installedCache !== null && (now - _cachedAt) < INSTALLED_CACHE_TTL_US)
        return _installedCache;

    let found = false;
    for (const path of UNIT_SEARCH_PATHS) {
        if (Gio.File.new_for_path(path).query_exists(null)) {
            found = true;
            break;
        }
    }
    _installedCache = found;
    _cachedAt = now;
    return found;
}

/**
 * Invalidate the cached unit-file probe result. Exported for future use by
 * a NameOwnerChanged hook that wants to force a re-stat when the daemon
 * appears or vanishes. Not consumed in this commit — kept here so the
 * symmetry is visible from a single-file read.
 */
export function invalidateInstalledCache() {
    _installedCache = null;
    _cachedAt = 0;
}

/**
 * Build the empty-state row. Returns a PopupMenu.PopupMenuItem.
 */
export function buildEmptyStateItem() {
    const item = new PopupMenu.PopupMenuItem('', {
        reactive: false,
        can_focus: false,
    });
    item.add_style_class_name('usbee-empty-state');
    item.label.hide();

    const box = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: 'usbee-empty-state-body',
    });

    const title = new St.Label({
        text: _('usbeehive daemon not running'),
        style_class: 'usbee-empty-state-title',
        x_expand: true,
    });
    title.clutter_text.line_wrap = true;

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

    box.add_child(title);
    box.add_child(hint);
    box.add_child(entry);
    item.add_child(box);

    return item;
}

/**
 * Build the daemon-not-installed empty-state row. Returns a PopupMenu.PopupMenuItem.
 *
 * Distinct from buildEmptyStateItem() — the systemd user unit file for
 * usbeehived is absent from every standard search path (see
 * isUsbeehiveServiceInstalled). The user needs to run the install command
 * before `systemctl --user enable --now usbeehived` will work.
 *
 * Wired from src/tile.js _rebuildPopover() via populateNotInstalledState
 * in src/popover.js (quick task 260526-i7q).
 */
export function buildDaemonNotInstalledItem() {
    const item = new PopupMenu.PopupMenuItem('', {
        reactive: false,
        can_focus: false,
    });
    item.add_style_class_name('usbee-empty-state');
    item.label.hide();

    const box = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: 'usbee-empty-state-body',
    });

    const title = new St.Label({
        text: _('usbeehive not installed'),
        style_class: 'usbee-empty-state-title',
        x_expand: true,
    });
    title.clutter_text.line_wrap = true;

    const hint = new St.Label({
        text: _('Install usbeehive, then start it. This list will populate automatically:'),
        x_expand: true,
    });
    hint.clutter_text.line_wrap = true;

    const entry = new St.Entry({
        can_focus: true,
        reactive: true,
        text: INSTALL_CMD,
        style_class: 'usbee-empty-state-entry',
    });
    // Mirror the read-only-but-selectable pattern of buildEmptyStateItem.
    entry.clutter_text.editable = false;
    entry.clutter_text.selectable = true;

    box.add_child(title);
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
 * extension cannot do that — EGO PACK-05 forbids binary installs); the hint
 * copy reminds them to restart the unit after the cargo install completes.
 *
 * Quick task 260526-i7q: the copy-pasteable entry is now the actual update
 * command rather than the post-upgrade restart command, which was the wrong
 * actionable bit.
 *
 * Quick task 260821-ke2: the item now states BOTH the version USBee
 * requires and the version it actually detected, so a user whose daemon is
 * demonstrably running has a diagnosable fact instead of a dead end.
 *
 * Wired from tile.js via populateOutOfDateState(section, detectedVersion)
 * when store.daemonState is DaemonState.OUT_OF_DATE (see ADR).
 *
 * @param {string} detectedVersion  Version the daemon reported. Empty when
 *   the Version property was missing or unreadable, in which case the label
 *   says "unknown" — which is itself the useful diagnosis.
 */
export function buildDaemonOutOfDateItem(detectedVersion = '') {
    const item = new PopupMenu.PopupMenuItem('', {
        reactive: false,
        can_focus: false,
    });
    item.add_style_class_name('usbee-empty-state');
    item.label.hide();

    const box = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: 'usbee-empty-state-body',
    });

    const title = new St.Label({
        text: _('usbeehive daemon out of date'),
        style_class: 'usbee-empty-state-title',
        x_expand: true,
    });
    title.clutter_text.line_wrap = true;

    // T-ke2-01: `detectedVersion` is bus data — any session process can own
    // org.usbeehive.Devices and report an arbitrary Version string. Clamp it
    // before rendering. St.Label does not enable Pango markup, so the clamp
    // is the whole mitigation here (prefs.js additionally markup-escapes,
    // because Adwaita subtitles DO parse markup).
    const detected = typeof detectedVersion === 'string' && detectedVersion
        ? detectedVersion.slice(0, 32)
        : _('unknown');
    const versions = new St.Label({
        text: _('Requires usbeehive %s or newer — detected %s')
            .format(MIN_USBEEHIVE_VERSION, detected),
        x_expand: true,
    });
    versions.clutter_text.line_wrap = true;

    const hint = new St.Label({
        text: _('Update usbeehive, then restart the daemon. This list will populate automatically:'),
        x_expand: true,
    });
    hint.clutter_text.line_wrap = true;

    const entry = new St.Entry({
        can_focus: true,
        reactive: true,
        text: UPDATE_CMD,
        style_class: 'usbee-empty-state-entry',
    });
    // Mirror the read-only-but-selectable pattern of buildEmptyStateItem.
    entry.clutter_text.editable = false;
    entry.clutter_text.selectable = true;

    box.add_child(title);
    box.add_child(versions);
    box.add_child(hint);
    box.add_child(entry);
    item.add_child(box);

    return item;
}
