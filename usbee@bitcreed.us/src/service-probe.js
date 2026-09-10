// SPDX-License-Identifier: GPL-3.0-or-later
// src/service-probe.js
//
// "Is usbeehive installed, and can we start it?" — the one place that
// answers both questions, shared by the Shell process, the preferences
// process and bare-gjs CI.
//
// IMPORT CONTRACT (quick task 260910-myu). This module may import
// `gi://Gio` and `gi://GLib` and NOTHING else. In particular:
//
//   - no `resource:///org/gnome/shell/...` URI, because prefs.js runs in
//     a process where those do not resolve at all, and
//   - no gettext, for the same reason. Every user-visible string about
//     this module's results is composed by the caller, in whichever
//     process it lives.
//
// That makes it one tier below src/daemon-status.js (which imports
// literally nothing) and still loadable in all three environments.
// tests/service-probe.test.js asserts the contract against this source.
//
// WHY THIS MODULE EXISTS — the bug it fixes:
//
// src/empty-state.js used to decide "is usbeehive installed?" by stat()ing
// three paths, one of which was `$XDG_DATA_HOME/systemd/user`. usbeehive's
// own installer does not write there. `user_unit_dir()` in
// ../usbeehive/src/bin/usbeehived.rs returns `$XDG_CONFIG_HOME/systemd/user`
// (falling back to `$HOME/.config/systemd/user`) — systemd's HIGHEST
// priority user-unit search path, and the one path the list omitted. Result:
// a user with a correctly installed, merely stopped daemon was told
// usbeehive was "not installed" and pointed at a `cargo install` they had
// already run.
//
// Two further corrections come with it:
//
//   1. Installed-ness is not a boolean. "binary on PATH but no unit file"
//      is a real, common state — it is what you get after `cargo install`
//      but before `usbeehived --install-service` — and it needs its own
//      advice. Hence InstallState, not a bool.
//   2. A path list is a guess about systemd's configuration. systemd knows
//      the answer for certain, so refreshInstallStateAsync() asks it and
//      corrects the cache. The sync probe stays because popover rebuild is
//      synchronous and D-15 forbids sync D-Bus on the Shell's main loop;
//      the async correction lands in time for the next popover open.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// systemd's user manager. On the SESSION bus — `systemd --user` owns
// org.freedesktop.systemd1 there, exactly as the system manager owns it on
// the system bus. No privilege escalation, no polkit prompt, no subprocess.
export const SYSTEMD_BUS_NAME = 'org.freedesktop.systemd1';
export const SYSTEMD_OBJECT_PATH = '/org/freedesktop/systemd1';
export const SYSTEMD_MANAGER_IFACE = 'org.freedesktop.systemd1.Manager';

// The unit and the binary usbeehive installs. Both names are fixed by
// usbeehive (SERVICE_FILE_NAME / the `usbeehived` bin target); neither is
// user-supplied, so neither is ever interpolated from outside this file.
export const USBEEHIVE_UNIT = 'usbeehived.service';
export const USBEEHIVE_BINARY = 'usbeehived';

/**
 * How far the daemon got towards being runnable.
 *
 *   NOT_INSTALLED   — no unit file anywhere AND no `usbeehived` on PATH.
 *                     The user needs the whole chain (INSTALL_CMD).
 *   SERVICE_MISSING — `usbeehived` is on PATH but no unit file exists.
 *                     `cargo install` happened; `--install-service` did not.
 *                     The user needs SETUP_CMD, not another cargo install.
 *   INSTALLED       — a unit file exists. Starting it is a button press.
 */
export const InstallState = Object.freeze({
    NOT_INSTALLED:   'not-installed',
    SERVICE_MISSING: 'service-missing',
    INSTALLED:       'installed',
});

/**
 * systemd's user-unit search path, in systemd's own lookup order, filtered
 * to the persistent directories a `usbeehived.service` could plausibly live
 * in. `systemd.unit(5)` §"User Unit Search Path" is the reference.
 *
 * The first entry is the one whose absence caused this whole task: it is
 * where `usbeehived --install-service` writes, and it outranks every other
 * entry. tests/service-probe.test.js pins both facts.
 *
 * Transient/generated paths ($XDG_RUNTIME_DIR/systemd/user, /run/systemd/user)
 * are deliberately absent — nothing writes a usbeehived unit there, and
 * refreshInstallStateAsync() covers any exotic location anyway.
 */
export const UNIT_SEARCH_PATHS = [
    `${GLib.get_user_config_dir()}/systemd/user/${USBEEHIVE_UNIT}`,
    `/etc/systemd/user/${USBEEHIVE_UNIT}`,
    `${GLib.get_user_data_dir()}/systemd/user/${USBEEHIVE_UNIT}`,
    `/usr/local/share/systemd/user/${USBEEHIVE_UNIT}`,
    `/usr/share/systemd/user/${USBEEHIVE_UNIT}`,
    `/usr/local/lib/systemd/user/${USBEEHIVE_UNIT}`,
    `/usr/lib/systemd/user/${USBEEHIVE_UNIT}`,
];

// The popover is rebuilt on user click, so sub-second freshness is
// pointless — but a user who just ran `usbeehived --install-service` in a
// terminal should see the state flip without restarting gnome-shell. 30 s
// splits that difference, and is inherited unchanged from the boolean probe
// this module replaces.
const PROBE_CACHE_TTL_US = 30 * GLib.USEC_PER_SEC;

let _cachedState = null;
let _cachedAt = 0;

/**
 * Map the two raw facts onto an InstallState. Pure — no I/O, no cache — so
 * the truth table is directly unit-testable under bare gjs.
 *
 * A unit file wins over a missing binary: if the unit exists, `StartUnit`
 * is the right next move and systemd will report the missing ExecStart far
 * more precisely than we could.
 *
 * @param {boolean} hasUnit    A usbeehived.service unit file was found.
 * @param {boolean} hasBinary  `usbeehived` resolves on PATH.
 * @returns {string} one of InstallState.
 */
export function classifyInstall(hasUnit, hasBinary) {
    if (hasUnit) return InstallState.INSTALLED;
    if (hasBinary) return InstallState.SERVICE_MISSING;
    return InstallState.NOT_INSTALLED;
}

/**
 * Does a usbeehived.service unit file exist in any search path?
 *
 * Synchronous local stat() over a small fixed list. Explicitly permitted
 * under D-15, which prohibits synchronous D-Bus and network calls on the
 * Shell's main loop — not local file probes.
 *
 * @returns {boolean}
 */
function unitFileExists() {
    for (const path of UNIT_SEARCH_PATHS) {
        if (Gio.File.new_for_path(path).query_exists(null))
            return true;
    }
    return false;
}

/**
 * The install state, computed synchronously and cached for
 * PROBE_CACHE_TTL_US microseconds.
 *
 * @returns {string} one of InstallState.
 */
export function probeInstallState() {
    const now = GLib.get_monotonic_time();
    if (_cachedState !== null && (now - _cachedAt) < PROBE_CACHE_TTL_US)
        return _cachedState;

    const state = classifyInstall(
        unitFileExists(),
        GLib.find_program_in_path(USBEEHIVE_BINARY) !== null);

    _cachedState = state;
    _cachedAt = now;
    return state;
}

/**
 * Drop the cached probe result. Call after an action that could have
 * changed the answer — notably a successful StartUnit, or the daemon
 * appearing on / vanishing from the bus.
 */
export function invalidateInstallCache() {
    _cachedState = null;
    _cachedAt = 0;
}

/**
 * The remote D-Bus error name carried by a thrown GError, or null when the
 * throw was not a remote D-Bus error at all.
 *
 * `Gio.DBusError` is an enum, not a class, so `e instanceof Gio.DBusError`
 * throws rather than returning false — the guard has to be on GLib.Error.
 * Everything else here is defensive: a non-D-Bus GError makes
 * is_remote_error() return false, and any surprise is swallowed into null
 * so an error-classification helper can never itself raise.
 *
 * @param {*} e  Whatever the failing call threw.
 * @returns {string|null}
 */
function remoteErrorName(e) {
    try {
        if (!(e instanceof GLib.Error)) return null;
        if (!Gio.DBusError.is_remote_error(e)) return null;
        return Gio.DBusError.get_remote_error(e);
    } catch {
        return null;
    }
}

/**
 * Ask systemd whether it knows a usbeehived.service unit file, and correct
 * the cache with the answer.
 *
 * This is the authoritative version of unitFileExists(): systemd resolves
 * its own search path, including drop-ins, `systemctl --user link`ed units
 * and any directory this file does not enumerate. It is async because
 * D-15 forbids blocking the Shell's main loop on D-Bus; the corrected value
 * is picked up by the NEXT probeInstallState() caller, which for the
 * popover means the next time the user opens it.
 *
 * GetUnitFileState raises org.freedesktop.DBus.Error.FileNotFound when no
 * unit file exists — that is the negative answer, not an error to log. Any
 * other failure (no systemd user manager at all, e.g. an exotic session)
 * leaves the cache untouched: the local stat() answer is then the best
 * available and is not worse for having asked.
 *
 * @param {(state: string) => void} [onSettled]  Called with the resulting
 *   InstallState once the answer is in. Omitted callers just want the cache
 *   warmed.
 */
export function refreshInstallStateAsync(onSettled = null) {
    Gio.DBus.session.call(
        SYSTEMD_BUS_NAME,
        SYSTEMD_OBJECT_PATH,
        SYSTEMD_MANAGER_IFACE,
        'GetUnitFileState',
        new GLib.Variant('(s)', [USBEEHIVE_UNIT]),
        new GLib.VariantType('(s)'),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (bus, res) => {
            let hasUnit;
            try {
                bus.call_finish(res);
                hasUnit = true;
            } catch (e) {
                if (remoteErrorName(e) === 'org.freedesktop.DBus.Error.FileNotFound') {
                    hasUnit = false;
                } else {
                    // Could not ask. Keep whatever the local probe decided.
                    if (onSettled) onSettled(probeInstallState());
                    return;
                }
            }

            const state = classifyInstall(
                hasUnit,
                GLib.find_program_in_path(USBEEHIVE_BINARY) !== null);
            _cachedState = state;
            _cachedAt = GLib.get_monotonic_time();
            if (onSettled) onSettled(state);
        });
}

/**
 * Start usbeehived.service through systemd's user manager.
 *
 * A plain async D-Bus method call — deliberately NOT `Gio.Subprocess`
 * running `systemctl --user start`. EGO reviewers treat subprocess spawning
 * from an extension as a red flag; a session-bus method call to a service
 * the user's own session already runs is not one. D-18 / EGO PACK-05
 * forbid USBee *installing* software; they do not forbid asking the user's
 * own service manager to start a unit the user installed and asked for.
 *
 * StartUnit returns as soon as systemd has ENQUEUED the job, so a
 * successful callback means "systemd accepted it", not "the daemon is
 * serving". Callers must confirm the daemon actually reached the bus —
 * src/empty-state.js does that with a watchdog, because "systemd started it
 * and it immediately exited" is precisely the failure a naive button hides.
 *
 * @param {(error: string|null) => void} onDone  Called with null on success
 *   or a human-readable failure message (untranslated — the caller wraps
 *   it, this module has no gettext).
 */
export function startDaemonUnit(onDone) {
    Gio.DBus.session.call(
        SYSTEMD_BUS_NAME,
        SYSTEMD_OBJECT_PATH,
        SYSTEMD_MANAGER_IFACE,
        'StartUnit',
        // 'replace' is systemd's ordinary mode: replace any conflicting
        // queued job rather than failing. Matches `systemctl --user start`.
        new GLib.Variant('(ss)', [USBEEHIVE_UNIT, 'replace']),
        new GLib.VariantType('(o)'),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (bus, res) => {
            try {
                bus.call_finish(res);
            } catch (e) {
                // Two failures dominate and both are worth showing verbatim:
                //   org.freedesktop.systemd1.NoSuchUnit — no unit installed
                //   org.freedesktop.DBus.Error.ServiceUnknown — no user manager
                //
                // strip_remote_error() rewrites the message in place, turning
                // "GDBus.Error:org.freedesktop.systemd1.NoSuchUnit: Unit
                // usbeehived.service not found." into "Unit usbeehived.service
                // not found." — the half a user can act on.
                try {
                    if (e instanceof GLib.Error)
                        Gio.DBusError.strip_remote_error(e);
                } catch {
                    // Leave the message as-is; it is still better than nothing.
                }
                onDone(e?.message ?? String(e));
                return;
            }
            invalidateInstallCache();
            onDone(null);
        });
}
