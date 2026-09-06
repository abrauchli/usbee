// SPDX-License-Identifier: GPL-3.0-or-later
// src/empty-state.js
//
// Daemon empty-state widgets — three distinct flavours (quick task 260526-i7q):
//   - buildEmptyStateItem()         — service installed but stopped
//                                     ('systemctl --user enable --now usbeehived')
//   - buildDaemonNotInstalledItem() — service unit file missing on disk
//                                     (the full install chain, INSTALL_CMD)
//   - buildDaemonOutOfDateItem()    — daemon reachable but Version too old
//                                     ('cargo install usbeehive --features=dbus
//                                       && systemctl --user restart usbeehived',
//                                      see UPDATE_CMD in src/daemon-status.js)
//   - buildDaemonTooNewItem()       — daemon reachable but speaks a NEWER
//                                     interface generation than this build.
//                                     The only one of the four with no
//                                     command: the fix is to update the
//                                     extension, which the user does in the
//                                     Extensions app (quick task 260905-b0s)
//
// Each one is a PopupMenuItem containing a title label, a hint label, and a
// command row (buildCommandRow): a read-only-but-selectable St.Entry with the
// relevant command plus a copy-to-clipboard button.
//
// No retry button (UI-SPEC #primary-cta): NameOwnerChanged auto-recovers.
// No subprocess spawning (D-18, EGO PACK-05): user runs the command themselves.
// The not-installed detection uses Gio.File.query_exists() (synchronous local
// stat() on a small known set of paths — explicitly permitted under D-15,
// which prohibits sync D-Bus and network calls, not local file probes).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// UPDATE_CMD lives in the shared module so prefs.js — a separate process
// that cannot import anything from this file — renders the exact same
// string in its About group.
import {INSTALL_CMD, MIN_USBEEHIVE_VERSION, UPDATE_CMD} from './daemon-status.js';

// Shell-only command: the preferences window never surfaces this one, so it
// stays local. (INSTALL_CMD lives in the shared module beside UPDATE_CMD.)
const SYSTEMCTL_CMD = 'systemctl --user enable --now usbeehived';

// How long the copy button shows its confirmation checkmark before
// reverting to the copy icon.
const COPY_FEEDBACK_MS = 1500;

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
 * Build one command line: a read-only-but-selectable St.Entry carrying the
 * command, plus a copy-to-clipboard button.
 *
 * A reactive child inside a `reactive: false` PopupMenuItem works — the
 * focusable St.Entry these items already carried proves it.
 *
 * The entry stays single-line (St.Entry does not reflow); with the copy
 * button present, a command too long for the popover width is no longer a
 * dead end.
 *
 * @param {string} command  Literal shell command. Always a module constant,
 *   never daemon- or user-supplied — nothing interpolates into the
 *   clipboard write (T-ke2-02).
 * @returns {St.BoxLayout}
 */
function buildCommandRow(command) {
    const row = new St.BoxLayout({
        x_expand: true,
        style_class: 'usbee-empty-state-command',
    });

    const entry = new St.Entry({
        can_focus: true,
        reactive: true,
        x_expand: true,
        text: command,
        style_class: 'usbee-empty-state-entry',
    });
    // [ASSUMED A1 — RESEARCH §Pitfall B]: if direct property assignment
    // doesn't take effect at runtime, swap for:
    //   entry.clutter_text.set_editable(false);
    //   entry.clutter_text.set_selectable(true);
    entry.clutter_text.editable = false;
    entry.clutter_text.selectable = true;

    const icon = new St.Icon({
        icon_name: 'edit-copy-symbolic',
        style_class: 'popup-menu-icon',
    });
    const button = new St.Button({
        style_class: 'usbee-copy-button',
        can_focus: true,
        reactive: true,
        y_align: Clutter.ActorAlign.CENTER,
        accessible_name: _('Copy command'),
        child: icon,
    });

    // T-ke2-04: the popover section is torn down on every rebuild, so a
    // pending feedback timer would outlive its actor and raise
    // GLib-CRITICAL on the lock/unlock cycle (the project's mandatory QA
    // gate). Track every in-flight source and remove them on destroy.
    const pending = new Set();

    button.connect('clicked', () => {
        // St.Clipboard is the Shell-process clipboard API. prefs.js cannot
        // use it (and this file cannot use Gdk) — the two processes each
        // talk to their own toolkit.
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, command);
        icon.icon_name = 'object-select-symbolic';
        const id = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, COPY_FEEDBACK_MS, () => {
                pending.delete(id);
                icon.icon_name = 'edit-copy-symbolic';
                return GLib.SOURCE_REMOVE;
            });
        pending.add(id);
    });

    button.connect('destroy', () => {
        for (const id of pending) GLib.Source.remove(id);
        pending.clear();
    });

    row.add_child(entry);
    row.add_child(button);
    return row;
}

/**
 * Build the empty-state row. Returns a PopupMenu.PopupMenuItem.
 * The command line is copy-pasteable and carries a copy button.
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

    box.add_child(title);
    box.add_child(hint);
    box.add_child(buildCommandRow(SYSTEMCTL_CMD));
    item.add_child(box);

    return item;
}

/**
 * Build the daemon-not-installed empty-state row. Returns a PopupMenu.PopupMenuItem.
 *
 * Distinct from buildEmptyStateItem() — the systemd user unit file for
 * usbeehived is absent from every standard search path (see
 * isUsbeehiveServiceInstalled). The user needs to run the install command
 * before `systemctl --user enable --now usbeehived` will work. The command
 * line is copy-pasteable and carries a copy button.
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

    // Quick task 260905-b0s §D-7: the command used to be only
    // `usbeehived --install-service`, i.e. step two of three. This state is
    // reached because no unit file exists anywhere, which for most users
    // means the binary is missing too — so the hint's "Install usbeehive,
    // then start it" now matches what the command line actually does.
    const hint = new St.Label({
        text: _('Install usbeehive, then start it. This list will populate automatically:'),
        x_expand: true,
    });
    hint.clutter_text.line_wrap = true;

    box.add_child(title);
    box.add_child(hint);
    box.add_child(buildCommandRow(INSTALL_CMD));
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
 * demonstrably running has a diagnosable fact instead of a dead end. The
 * command line is copy-pasteable and carries a copy button, and the command
 * itself (UPDATE_CMD) now restarts the user unit after `cargo install` so
 * the upgrade takes effect without a re-login.
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

    box.add_child(title);
    box.add_child(versions);
    box.add_child(hint);
    box.add_child(buildCommandRow(UPDATE_CMD));
    item.add_child(box);

    return item;
}

/**
 * Build the daemon-is-NEWER-than-the-extension empty-state row (quick task
 * 260905-b0s §D-7). Returns a PopupMenu.PopupMenuItem.
 *
 * usbeehive has cut its D-Bus interface generation four times in four
 * months, and every cut keeps the bus name and object path. So a future
 * daemon owns the name USBee watches while exposing nothing USBee's
 * Devices5 proxy can call: the `Version` read fails, the gate fails closed,
 * and — before this state existed — the popover told the user their
 * *daemon* was out of date and offered a `cargo install` that would have
 * changed nothing.
 *
 * Deliberately carries NO command row. Updating a Shell extension is not a
 * shell command; it is the Extensions app or extensions.gnome.org, followed
 * by a session reload.
 */
export function buildDaemonTooNewItem() {
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
        text: _('usbeehive is newer than USBee'),
        style_class: 'usbee-empty-state-title',
        x_expand: true,
    });
    title.clutter_text.line_wrap = true;

    const hint = new St.Label({
        text: _('Update the USBee extension from the Extensions app, then reload the session.'),
        x_expand: true,
    });
    hint.clutter_text.line_wrap = true;

    box.add_child(title);
    box.add_child(hint);
    item.add_child(box);

    return item;
}
