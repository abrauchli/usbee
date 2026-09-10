// SPDX-License-Identifier: GPL-3.0-or-later
// src/empty-state.js
//
// Daemon empty-state widgets — five distinct flavours:
//   - buildEmptyStateItem()          — unit installed but stopped. Carries
//                                      the Start button (quick task
//                                      260910-myu); the command row is the
//                                      manual fallback.
//   - buildServiceNotSetUpItem()     — `usbeehived` is on PATH but no unit
//                                      file exists: `cargo install` ran,
//                                      `--install-service` did not. Needs
//                                      SETUP_CMD, not another cargo install
//                                      (quick task 260910-myu).
//   - buildDaemonNotInstalledItem()  — neither binary nor unit file
//                                      (the full install chain, INSTALL_CMD)
//   - buildDaemonOutOfDateItem()     — daemon reachable but Version too old
//                                      ('cargo install usbeehive --features=dbus
//                                        && systemctl --user restart usbeehived',
//                                       see UPDATE_CMD in src/daemon-status.js)
//   - buildDaemonTooNewItem()        — daemon reachable but speaks a NEWER
//                                      interface generation than this build.
//                                      The only one with no command: the fix
//                                      is to update the extension, which the
//                                      user does in the Extensions app
//                                      (quick task 260905-b0s)
//
// Each one is a PopupMenuItem containing a title label, a hint label, and
// usually a command row (buildCommandRow): a selectable, WRAPPING St.Label
// carrying the command plus a copy-to-clipboard button.
//
// Which of the first three applies is decided by src/service-probe.js
// probeInstallState(), not by this file — see tile.js _rebuildPopover().
//
// No retry button (UI-SPEC #primary-cta): NameOwnerChanged auto-recovers.
// No subprocess spawning (D-18, EGO PACK-05): the Start button is an async
// StartUnit D-Bus call to the user's own systemd, never a Gio.Subprocess
// forking systemctl, and nothing here ever *installs* software.
//
// Every wrapping label here pairs `line_wrap = true` with
// `ellipsize = Pango.EllipsizeMode.NONE`, and the pair is not optional:
// St.Label builds its ClutterText with PANGO_ELLIPSIZE_END, ClutterText
// forwards both the ellipsize mode and the wrap mode to Pango without ever
// setting a layout height, and Pango's default height of -1 means
// "ellipsize at line one". Set only line_wrap and the label still renders a
// single truncated line (quick task 260910-ggy).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// UPDATE_CMD lives in the shared module so prefs.js — a separate process
// that cannot import anything from this file — renders the exact same
// string in its About group.
import {INSTALL_CMD, MIN_USBEEHIVE_VERSION, SETUP_CMD, UPDATE_CMD}
    from './daemon-status.js';
import {startDaemonUnit} from './service-probe.js';

// Shell-only command: the preferences window surfaces its own Start button
// instead, so this manual fallback stays local. (INSTALL_CMD and SETUP_CMD
// live in the shared module beside UPDATE_CMD.)
const SYSTEMCTL_CMD = 'systemctl --user enable --now usbeehived';

// How long the copy button shows its confirmation checkmark before
// reverting to the copy icon.
const COPY_FEEDBACK_MS = 1500;

// How long to wait, after systemd accepts the start job, for the daemon to
// actually own its bus name. StartUnit returns once the job is ENQUEUED, so
// success from D-Bus is not success from the user's point of view: a daemon
// that starts and immediately exits produces exactly the silent no-op a
// start button must never be. When the daemon does arrive, DBusClient emits
// 'ready', tile.js rebuilds the popover, this whole item is destroyed and
// the timer is removed with it — so this timeout only ever fires on the
// failure path.
const START_WATCHDOG_MS = 8000;

/**
 * Build one command line: a selectable, wrapping St.Label carrying the
 * command, plus a copy-to-clipboard button.
 *
 * A reactive child inside a `reactive: false` PopupMenuItem works — the
 * focusable copy button proves it.
 *
 * This used to be an St.Entry, which is single-line and does not reflow: the
 * longest command (INSTALL_CMD, ~100 characters) rendered as
 * `cargo install usbeehive --features=dbu…` in a Quick Settings popover.
 * A truncated shell command is the one thing on this panel that has to be
 * exact, and the copy button alone does not fix it — a user cannot judge
 * whether to run a command they cannot read. An St.Label with line_wrap and
 * ellipsize NONE is the wrapping mechanism this file already proved works
 * (quick task 260910-ggy); St.Entry's multi-line mode is not, so the label
 * is what ships. Selectability is preserved on the ClutterText, so
 * click-drag + Ctrl+C still works alongside the button.
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

    const entry = new St.Label({
        can_focus: false,
        reactive: true,
        x_expand: true,
        text: command,
        style_class: 'usbee-empty-state-entry',
    });
    entry.clutter_text.selectable = true;
    entry.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    entry.clutter_text.line_wrap = true;
    // WORD_CHAR, not WORD: shell commands contain long unbreakable tokens
    // (`--features=dbus`, an absolute path) that WORD alone would push past
    // the popover edge rather than break.
    entry.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

    const icon = new St.Icon({
        icon_name: 'edit-copy-symbolic',
        style_class: 'popup-menu-icon',
    });
    const button = new St.Button({
        style_class: 'usbee-copy-button',
        can_focus: true,
        reactive: true,
        // START, not CENTER: the command label wraps now, so centring the
        // button against a three-line block would drift it away from the
        // first line it belongs to.
        y_align: Clutter.ActorAlign.START,
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
 * A wrapping body label. Every empty state needs several, and every one of
 * them must clear the inherited ellipsize alongside line_wrap — see the
 * file header. Centralising the pair makes forgetting it impossible.
 *
 * @param {string} text            Already-translated text.
 * @param {string} [styleClass]    Optional extra style class.
 * @returns {St.Label}
 */
function buildWrappedLabel(text, styleClass = '') {
    const props = {text, x_expand: true};
    if (styleClass) props.style_class = styleClass;
    const label = new St.Label(props);
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    label.clutter_text.line_wrap = true;
    return label;
}

/**
 * Build the "Start usbeehive daemon" affordance: a button plus the status
 * line underneath it that reports what happened.
 *
 * The button asks systemd to start the unit over D-Bus (see
 * src/service-probe.js startDaemonUnit). It is not a Gio.Subprocess running
 * `systemctl` — EGO reviewers flag subprocess spawning from an extension,
 * and a session-bus method call to the user's own service manager is the
 * documented alternative.
 *
 * Three failures are made visible, because a start button that silently
 * does nothing is worse than no button at all:
 *
 *   1. systemd refuses the job (no unit, no user manager). The remote error
 *      is shown with its GDBus prefix stripped.
 *   2. systemd accepts the job and the daemon never reaches the bus within
 *      START_WATCHDOG_MS — the "starts, then exits" case. The status line
 *      names the journalctl command that explains why.
 *   3. Nothing at all happens: impossible to reach, because the button
 *      commits to a visible state ("Starting…") the instant it is pressed.
 *
 * The success path needs no handling here. When the daemon owns its name,
 * DBusClient emits 'ready', tile.js rebuilds the popover, and this whole
 * item — button, status line, watchdog and all — is destroyed and replaced
 * by the device list.
 *
 * @returns {St.BoxLayout}
 */
function buildStartRow() {
    const box = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: 'usbee-empty-state-start',
    });

    const button = new St.Button({
        style_class: 'usbee-start-button',
        can_focus: true,
        reactive: true,
        x_align: Clutter.ActorAlign.START,
        label: _('Start usbeehive daemon'),
    });

    // Hidden until there is something to say. An empty label would still
    // claim vertical space in the BoxLayout.
    const status = buildWrappedLabel('', 'usbee-empty-state-status');
    status.visible = false;

    const setStatus = text => {
        status.text = text;
        status.visible = true;
    };

    // Same teardown contract as buildCommandRow (T-ke2-04): the popover
    // section is destroyed on every rebuild, and a surviving timer would
    // raise GLib-CRITICAL on the lock/unlock cycle.
    const pending = new Set();

    button.connect('clicked', () => {
        button.reactive = false;
        button.label = _('Starting…');   // U+2026
        status.visible = false;

        startDaemonUnit(error => {
            if (error) {
                button.reactive = true;
                button.label = _('Start usbeehive daemon');
                setStatus(_('Could not start the daemon: %s').format(error));
                return;
            }

            // systemd took the job. Give the daemon a moment to own its bus
            // name; if this timer ever fires, it didn't.
            const id = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, START_WATCHDOG_MS, () => {
                    pending.delete(id);
                    button.reactive = true;
                    button.label = _('Start usbeehive daemon');
                    setStatus(_('systemd started usbeehived, but it did not '
                        + 'appear on the bus. Check: journalctl --user -u '
                        + 'usbeehived -e'));
                    return GLib.SOURCE_REMOVE;
                });
            pending.add(id);
        });
    });

    button.connect('destroy', () => {
        for (const id of pending) GLib.Source.remove(id);
        pending.clear();
    });

    box.add_child(button);
    box.add_child(status);
    return box;
}

/**
 * Build the daemon-installed-but-stopped empty state. Returns a
 * PopupMenu.PopupMenuItem.
 *
 * Reached when a usbeehived.service unit file exists but nothing owns
 * org.usbeehive.Devices. Since the unit is there, starting it is a button
 * press rather than a trip to a terminal (quick task 260910-myu) — the
 * copy-pasteable command stays as the fallback for anyone who would rather
 * enable it permanently, which is what `enable --now` does and the button
 * does not.
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

    box.add_child(buildWrappedLabel(
        _('usbeehive daemon not running'), 'usbee-empty-state-title'));
    box.add_child(buildWrappedLabel(
        _('usbeehive is installed. Start it and this list will populate '
          + 'automatically.')));
    box.add_child(buildStartRow());
    box.add_child(buildWrappedLabel(
        _('Or start it yourself, and have it start with every session:')));
    box.add_child(buildCommandRow(SYSTEMCTL_CMD));
    item.add_child(box);

    return item;
}

/**
 * Build the binary-installed-but-service-not-set-up empty state. Returns a
 * PopupMenu.PopupMenuItem.
 *
 * Reached when `usbeehived` resolves on PATH but no unit file exists
 * anywhere — i.e. `cargo install usbeehive` has been run and
 * `usbeehived --install-service` has not (quick task 260910-myu). Before
 * this state existed, these users were shown "usbeehive not installed" and
 * a `cargo install` they had already completed.
 *
 * There is nothing to Start: with no unit, StartUnit can only fail. The one
 * useful action is SETUP_CMD.
 */
export function buildServiceNotSetUpItem() {
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

    box.add_child(buildWrappedLabel(
        _('usbeehive service not set up'), 'usbee-empty-state-title'));
    box.add_child(buildWrappedLabel(
        _('usbeehive is installed but has no systemd service yet. Run this '
          + 'once, and this list will populate automatically:')));
    box.add_child(buildCommandRow(SETUP_CMD));
    item.add_child(box);

    return item;
}

/**
 * Build the daemon-not-installed empty-state row. Returns a PopupMenu.PopupMenuItem.
 *
 * Distinct from buildEmptyStateItem() and buildServiceNotSetUpItem(): NO
 * usbeehived.service unit file exists in any systemd user-unit search path
 * AND `usbeehived` does not resolve on PATH (see src/service-probe.js
 * probeInstallState). This is the only one of the three states where
 * `cargo install` is genuinely the user's next move.
 *
 * Quick task 260910-myu narrowed exactly that. The unit-file probe used to
 * miss $XDG_CONFIG_HOME/systemd/user — where usbeehive's own installer
 * writes — so this state also swallowed every merely-stopped daemon and
 * told well-installed users to install what they already had.
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

    box.add_child(buildWrappedLabel(
        _('usbeehive not installed'), 'usbee-empty-state-title'));
    // Quick task 260905-b0s §D-7: the command used to be only
    // `usbeehived --install-service`, i.e. step two of three.
    box.add_child(buildWrappedLabel(
        _('Install usbeehive, then start it. This list will populate '
          + 'automatically:')));
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

    // T-ke2-01: `detectedVersion` is bus data — any session process can own
    // org.usbeehive.Devices and report an arbitrary Version string. Clamp it
    // before rendering. St.Label does not enable Pango markup, so the clamp
    // is the whole mitigation here (prefs.js additionally markup-escapes,
    // because Adwaita subtitles DO parse markup).
    const detected = typeof detectedVersion === 'string' && detectedVersion
        ? detectedVersion.slice(0, 32)
        : _('unknown');

    box.add_child(buildWrappedLabel(
        _('usbeehive daemon out of date'), 'usbee-empty-state-title'));
    box.add_child(buildWrappedLabel(
        _('Requires usbeehive %s or newer — detected %s')
            .format(MIN_USBEEHIVE_VERSION, detected)));
    box.add_child(buildWrappedLabel(
        _('Update usbeehive, then restart the daemon. This list will populate '
          + 'automatically:')));
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

    box.add_child(buildWrappedLabel(
        _('usbeehive is newer than USBee'), 'usbee-empty-state-title'));
    box.add_child(buildWrappedLabel(
        _('Update the USBee extension from the Extensions app, then reload '
          + 'the session.')));
    item.add_child(box);

    return item;
}
