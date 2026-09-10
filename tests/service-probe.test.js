// SPDX-License-Identifier: GPL-3.0-or-later
// tests/service-probe.test.js
//
// Coverage for src/service-probe.js — the gi-only module that decides
// whether usbeehive is installed and asks systemd to start it.
//
// Unlike most of this suite, these are real unit tests rather than
// source-level structural guards: the module imports gi://Gio and gi://GLib
// and nothing else, so bare gjs can load and call it directly.
//
// The regression this file exists to pin (quick task 260910-myu): USBee
// probed three unit paths, one of which was $XDG_DATA_HOME/systemd/user.
// usbeehive's own installer writes to $XDG_CONFIG_HOME/systemd/user
// (../usbeehive/src/bin/usbeehived.rs user_unit_dir()), which was missing
// from the list — so every correctly installed but stopped daemon rendered
// as "usbeehive not installed" with a `cargo install` the user had already
// run. If UNIT_SEARCH_PATHS ever loses the config dir again, this file
// fails.
//
// Runtime — plain GJS, NOT node:test (the node:test shim is absent in some
// gjs builds, e.g. 1.80.2, which would make this silently un-runnable).
//
// Run from the repo root:
//     gjs -m tests/service-probe.test.js
// Exit status is non-zero if any assertion fails.
//
// NOTE ON THE D-BUS SURFACE: refreshInstallStateAsync() and
// startDaemonUnit() talk to the live session bus, so they are deliberately
// NOT exercised here — CI has no systemd user manager and a test that
// depends on one is a test that fails for the wrong reason. Their bus
// coordinates and call shapes are guarded structurally below instead, and
// they were verified against a real user manager during 260910-myu.

import System from 'system';
import GLib from 'gi://GLib';

import {InstallState, SYSTEMD_BUS_NAME, SYSTEMD_MANAGER_IFACE,
    SYSTEMD_OBJECT_PATH, UNIT_SEARCH_PATHS, USBEEHIVE_BINARY, USBEEHIVE_UNIT,
    classifyInstall, invalidateInstallCache, probeInstallState}
    from '../usbee@bitcreed.us/src/service-probe.js';

let failures = 0;
function check(name, cond) {
    if (cond) {
        print(`  ok   - ${name}`);
    } else {
        failures++;
        print(`  FAIL - ${name}`);
    }
}

function readSource(relPath) {
    const [ok, raw] = GLib.file_get_contents(
        GLib.build_filenamev([GLib.get_current_dir(), relPath]));
    return ok ? new TextDecoder().decode(raw) : '';
}

// Source with /* */ and // comments removed. Needed for the "this file never
// does X" guards below: the module's own header explains at length why it
// does not spawn `systemctl`, and a naive substring search cannot tell an
// explanation apart from the thing it warns against.
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ');
}

// --- The bug this module was created to fix ---------------------------------

print('# UNIT_SEARCH_PATHS covers where usbeehive actually installs');
{
    const configPath =
        `${GLib.get_user_config_dir()}/systemd/user/usbeehived.service`;

    check('the XDG config dir unit path is in the search list',
        UNIT_SEARCH_PATHS.includes(configPath));
    // systemd resolves $XDG_CONFIG_HOME/systemd/user first, and it is where
    // `usbeehived --install-service` writes. Anything ahead of it in this
    // list would be answering a different question than systemd would.
    check('the XDG config dir unit path is checked FIRST',
        UNIT_SEARCH_PATHS[0] === configPath);

    // The path whose absence caused the misreport must not have simply
    // replaced the old data-dir path — a distro package could still put the
    // unit there.
    check('the XDG data dir unit path is still covered',
        UNIT_SEARCH_PATHS.includes(
            `${GLib.get_user_data_dir()}/systemd/user/usbeehived.service`));
    check('/etc/systemd/user is covered',
        UNIT_SEARCH_PATHS.includes('/etc/systemd/user/usbeehived.service'));
    check('/usr/lib/systemd/user is covered',
        UNIT_SEARCH_PATHS.includes('/usr/lib/systemd/user/usbeehived.service'));
    check('/usr/share/systemd/user is covered',
        UNIT_SEARCH_PATHS.includes('/usr/share/systemd/user/usbeehived.service'));

    check('every search path names the usbeehived unit',
        UNIT_SEARCH_PATHS.every(p => p.endsWith(`/${USBEEHIVE_UNIT}`)));
    check('every search path is absolute',
        UNIT_SEARCH_PATHS.every(p => p.startsWith('/')));
    check('the search paths are distinct',
        new Set(UNIT_SEARCH_PATHS).size === UNIT_SEARCH_PATHS.length);
}

// --- classifyInstall: the whole truth table ---------------------------------

print('# classifyInstall');
{
    check('unit + binary  → INSTALLED',
        classifyInstall(true, true) === InstallState.INSTALLED);
    // A unit whose ExecStart is missing is still systemd's problem to
    // report, and it reports it far better than we could.
    check('unit, no binary → INSTALLED',
        classifyInstall(true, false) === InstallState.INSTALLED);
    // The state that used to be misreported as "not installed": the user
    // ran `cargo install` and never ran `--install-service`.
    check('binary, no unit → SERVICE_MISSING',
        classifyInstall(false, true) === InstallState.SERVICE_MISSING);
    check('neither         → NOT_INSTALLED',
        classifyInstall(false, false) === InstallState.NOT_INSTALLED);
}

print('# InstallState');
{
    check('the three states are distinct',
        new Set([InstallState.NOT_INSTALLED, InstallState.SERVICE_MISSING,
            InstallState.INSTALLED]).size === 3);
    check('InstallState is frozen', Object.isFrozen(InstallState));
    check("NOT_INSTALLED is 'not-installed'",
        InstallState.NOT_INSTALLED === 'not-installed');
    check("SERVICE_MISSING is 'service-missing'",
        InstallState.SERVICE_MISSING === 'service-missing');
    check("INSTALLED is 'installed'", InstallState.INSTALLED === 'installed');
}

// --- probeInstallState against the real filesystem --------------------------

print('# probeInstallState');
{
    invalidateInstallCache();
    const state = probeInstallState();
    check('returns a valid InstallState',
        Object.values(InstallState).includes(state));
    // Second call must agree; a cache that returned something else would be
    // worse than no cache.
    check('is stable across calls', probeInstallState() === state);
    invalidateInstallCache();
    check('agrees with itself after a cache invalidation',
        probeInstallState() === state);

    // Cross-check the answer against the same facts, computed independently.
    const unitFound = UNIT_SEARCH_PATHS.some(p => GLib.file_test(p, GLib.FileTest.EXISTS));
    const binFound = GLib.find_program_in_path(USBEEHIVE_BINARY) !== null;
    check('matches classifyInstall on the live filesystem',
        state === classifyInstall(unitFound, binFound));
}

// --- systemd coordinates ----------------------------------------------------

print('# systemd bus coordinates');
{
    check('bus name is org.freedesktop.systemd1',
        SYSTEMD_BUS_NAME === 'org.freedesktop.systemd1');
    check('object path is /org/freedesktop/systemd1',
        SYSTEMD_OBJECT_PATH === '/org/freedesktop/systemd1');
    check('manager interface is org.freedesktop.systemd1.Manager',
        SYSTEMD_MANAGER_IFACE === 'org.freedesktop.systemd1.Manager');
    check('the unit is usbeehived.service',
        USBEEHIVE_UNIT === 'usbeehived.service');
    check('the binary is usbeehived', USBEEHIVE_BINARY === 'usbeehived');
}

// --- Structural guards over the D-Bus surface -------------------------------

print('# service-probe.js D-Bus surface');
{
    const src = readSource('usbee@bitcreed.us/src/service-probe.js');
    check('service-probe.js source is readable', src.length > 0);

    // The SESSION bus. `systemd --user` owns org.freedesktop.systemd1 there;
    // the system bus copy would need privileges USBee must never ask for.
    check('starts the unit on the SESSION bus',
        src.includes('Gio.DBus.session.call('));
    check('calls StartUnit', src.includes("'StartUnit'"));
    check("uses systemd's 'replace' job mode, as `systemctl start` does",
        src.includes("[USBEEHIVE_UNIT, 'replace']"));
    check('asks systemd GetUnitFileState for the authoritative answer',
        src.includes("'GetUnitFileState'"));
    check('treats FileNotFound as "no unit", not as an error',
        src.includes("'org.freedesktop.DBus.Error.FileNotFound'"));
    check('strips the GDBus prefix off remote errors before showing them',
        src.includes('Gio.DBusError.strip_remote_error('));

    // EGO PACK-05 / D-18. A start button implemented by forking `systemctl`
    // is the version reviewers reject; a D-Bus method call is not. Checked
    // against comment-stripped source — the module's header discusses both
    // at length precisely because it does neither.
    const code = stripComments(src);
    check('never spawns a subprocess',
        !code.includes('Gio.Subprocess') && !code.includes('spawn_'));
    check('never invokes systemctl as a command',
        !/systemctl/.test(code));
}

// --- Cross-process import contract ------------------------------------------

print('# service-probe.js cross-process contract');
{
    const src = readSource('usbee@bitcreed.us/src/service-probe.js');
    const specs = [...src.matchAll(/\bimport\b[^;'"]*?from\s*'([^']+)'/gs)]
        .map(m => m[1]);

    // prefs.js runs in a process where resource:///org/gnome/shell/... does
    // not resolve, and bare-gjs CI has no gnome-shell resources mapped at
    // all. gi:// is the only specifier that works in every one of the three
    // environments this module loads in.
    check('imports at least one module', specs.length > 0);
    check('imports only gi:// modules',
        specs.every(s => s.startsWith('gi://')));
    check('does not import gnome-shell resources',
        !stripComments(src).includes('resource:///'));
    // No gettext here — it needs one of the two process-specific import
    // paths. Every user-visible string about these results is composed by
    // the caller, in whichever process it lives.
    check('composes no translated strings', !/\b_\(/.test(stripComments(src)));
}

print('# the three install states reach every surface');
{
    const tile  = readSource('usbee@bitcreed.us/src/tile.js');
    const pop   = readSource('usbee@bitcreed.us/src/popover.js');
    const empty = readSource('usbee@bitcreed.us/src/empty-state.js');
    const prefs = readSource('usbee@bitcreed.us/prefs.js');

    check('tile.js routes the stopped daemon through probeInstallState',
        tile.includes('probeInstallState()'));
    check('tile.js branches on NOT_INSTALLED',
        tile.includes('case InstallState.NOT_INSTALLED:'));
    check('tile.js branches on SERVICE_MISSING',
        tile.includes('case InstallState.SERVICE_MISSING:'));
    check('tile.js no longer uses the old boolean probe',
        !tile.includes('isUsbeehiveServiceInstalled'));
    check('tile.js corrects the sync probe from systemd in the background',
        tile.includes('refreshInstallStateAsync()'));

    check('popover.js exports populateServiceNotSetUpState',
        pop.includes('export function populateServiceNotSetUpState('));
    check('empty-state.js builds the service-not-set-up item',
        empty.includes('export function buildServiceNotSetUpItem('));
    check('the service-not-set-up state does not re-suggest cargo install',
        empty.includes('buildCommandRow(SETUP_CMD)'));
    check('the installed-but-stopped state offers a Start button',
        empty.includes("_('Start usbeehive daemon')"));
    check('the Start button reports D-Bus failures',
        empty.includes("_('Could not start the daemon: %s')"));
    check('the Start button watches for a daemon that starts then exits',
        empty.includes('START_WATCHDOG_MS'));

    check('prefs.js offers its own Start button',
        prefs.includes('startDaemonUnit('));
    check('prefs.js distinguishes all three install states',
        prefs.includes('case InstallState.INSTALLED:') &&
        prefs.includes('case InstallState.SERVICE_MISSING:'));
    check('prefs.js no longer says only "Start usbeehived daemon"',
        !prefs.includes("_('Start usbeehived daemon')"));
    check('prefs.js escapes systemd error text before an Adwaita subtitle',
        prefs.includes("_('Could not start usbeehived: %s')") &&
        prefs.includes('GLib.markup_escape_text(String(error), -1)'));
}

// --- Summary ----------------------------------------------------------------
print('');
if (failures === 0)
    print('ALL TESTS PASSED');
else
    print(`${failures} ASSERTION(S) FAILED`);

System.exit(failures === 0 ? 0 : 1);
