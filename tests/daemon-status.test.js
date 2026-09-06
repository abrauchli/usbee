// SPDX-License-Identifier: GPL-3.0-or-later
// tests/daemon-status.test.js
//
// Coverage for src/daemon-status.js — the zero-import module shared by the
// gnome-shell process, the gnome-shell-extension-prefs process, and bare
// gjs in CI — plus structural guards over the consumers that must keep
// reading their daemon state FROM it (quick task 260821-ke2).
//
// Two kinds of assertion live here:
//
//   1. Real unit tests of isVersionAtLeast / MIN_USBEEHIVE_VERSION /
//      UPDATE_CMD / DaemonState. These import the module directly — it
//      loads under bare gjs precisely because it imports nothing.
//   2. Source-level structural guards over device-store.js, tile.js,
//      popover.js, empty-state.js and prefs.js. Those files DO import
//      gnome-shell / Gtk resources and therefore cannot be loaded here at
//      all; reading their source (the precedent set by
//      tests/dbus-client.test.js) is how we keep the cross-file wiring
//      under regression coverage in CI.
//
// Runtime — plain GJS, NOT node:test (the node:test shim is absent in some
// gjs builds, e.g. 1.80.2, which would make this silently un-runnable).
//
// Run from the repo root:
//     gjs -m tests/daemon-status.test.js
// Exit status is non-zero if any assertion fails.

import System from 'system';
import GLib from 'gi://GLib';

import {DaemonState, IFACE_GENERATION, INSTALL_CMD, MIN_USBEEHIVE_VERSION,
    UPDATE_CMD, isVersionAtLeast}
    from '../usbee@bitcreed.us/src/daemon-status.js';

let failures = 0;
function check(name, cond) {
    if (cond) {
        print(`  ok   - ${name}`);
    } else {
        failures++;
        print(`  FAIL - ${name}`);
    }
}

// Read a repo-relative source file as text. Returns '' when unreadable, so
// a missing file fails the assertions rather than throwing.
function readSource(relPath) {
    const [ok, raw] = GLib.file_get_contents(
        GLib.build_filenamev([GLib.get_current_dir(), relPath]));
    return ok ? new TextDecoder().decode(raw) : '';
}

// Every module specifier imported by `src`. Matches across newlines so a
// wrapped `import {A, B}\n    from 'x';` is captured as one statement.
function importSpecifiers(src) {
    return [...src.matchAll(/\bimport\b[^;'"]*?from\s*'([^']+)'/gs)]
        .map(m => m[1]);
}

// --- isVersionAtLeast -------------------------------------------------------

print('# isVersionAtLeast — fail-closed semver compare');
{
    check('newer minor passes', isVersionAtLeast('0.11.0', '0.10.0') === true);
    check('equal versions pass', isVersionAtLeast('0.10.0', '0.10.0') === true);
    check('older minor fails', isVersionAtLeast('0.9.9', '0.10.0') === false);
    check('newer patch passes', isVersionAtLeast('0.10.1', '0.10.0') === true);
    check('newer major passes', isVersionAtLeast('1.0.0', '0.10.0') === true);
    // Fail-closed inputs — the whole point of the gate (04-01-ADR step 4).
    check('undefined fails closed', isVersionAtLeast(undefined, '0.10.0') === false);
    check('null fails closed', isVersionAtLeast(null, '0.10.0') === false);
    check('non-string fails closed', isVersionAtLeast(11, '0.10.0') === false);
    check('two-part version fails closed', isVersionAtLeast('0.10', '0.10.0') === false);
    check('non-numeric part fails closed', isVersionAtLeast('0.x.0', '0.10.0') === false);
    check('unparseable minimum fails closed', isVersionAtLeast('0.11.0', 'nope') === false);
}

// --- Module constants -------------------------------------------------------

print('# module constants');
{
    // C1 guard: quick task 260821-ke2 explicitly does NOT bump the minimum.
    // A future bump must be a deliberate edit here, not an accident.
    check("MIN_USBEEHIVE_VERSION is '0.10.0'", MIN_USBEEHIVE_VERSION === '0.10.0');
    check('MIN_USBEEHIVE_VERSION satisfies its own gate',
        isVersionAtLeast(MIN_USBEEHIVE_VERSION, MIN_USBEEHIVE_VERSION) === true);

    check('UPDATE_CMD installs usbeehive with the dbus feature',
        UPDATE_CMD.includes('cargo install usbeehive --features=dbus'));
    check('UPDATE_CMD restarts the user unit',
        UPDATE_CMD.includes('systemctl --user restart usbeehived'));
    check('UPDATE_CMD chains both halves', UPDATE_CMD.includes('&&'));

    // Quick task 260905-b0s §D-7 — the not-installed state is reached when
    // NO unit file exists anywhere, which for most users means the binary is
    // missing too. The command used to show only step two of three.
    check('INSTALL_CMD installs the binary',
        INSTALL_CMD.includes('cargo install usbeehive --features=dbus'));
    check('INSTALL_CMD installs the unit file',
        INSTALL_CMD.includes('usbeehived --install-service'));
    check('INSTALL_CMD starts the unit',
        INSTALL_CMD.includes('systemctl --user enable --now usbeehived'));

    // The interface generation this build's proxy speaks. Bumping it is a
    // deliberate edit paired with a new IFACE_XML, never an accident.
    check('IFACE_GENERATION is 5', IFACE_GENERATION === 5);
}

print('# DaemonState');
{
    check('the four states are distinct',
        new Set([DaemonState.RUNNING, DaemonState.STOPPED,
            DaemonState.OUT_OF_DATE, DaemonState.TOO_NEW]).size === 4);
    check('DaemonState is frozen', Object.isFrozen(DaemonState));
    check("RUNNING is 'running'", DaemonState.RUNNING === 'running');
    check("STOPPED is 'stopped'", DaemonState.STOPPED === 'stopped');
    check("OUT_OF_DATE is 'out-of-date'", DaemonState.OUT_OF_DATE === 'out-of-date');
    check("TOO_NEW is 'too-new'", DaemonState.TOO_NEW === 'too-new');
}

print('# the TOO_NEW state reaches every surface');
{
    const store = readSource('usbee@bitcreed.us/src/device-store.js');
    const tile  = readSource('usbee@bitcreed.us/src/tile.js');
    const pop   = readSource('usbee@bitcreed.us/src/popover.js');
    const empty = readSource('usbee@bitcreed.us/src/empty-state.js');
    check('device-store.js has a TOO_NEW tile branch',
        store.includes('case DaemonState.TOO_NEW:'));
    check('the tile pill blames the extension, not the daemon',
        store.includes("_('Extension out of date')"));
    check('tile.js routes TOO_NEW to its own popover state',
        tile.includes('case DaemonState.TOO_NEW:')
        && tile.includes('populateTooNewState(this._rowsSection)'));
    check('popover.js exports populateTooNewState',
        pop.includes('export function populateTooNewState('));
    check('empty-state.js builds the too-new item',
        empty.includes('export function buildDaemonTooNewItem('));
    check('the too-new state names the extension as what to update',
        empty.includes("_('usbeehive is newer than USBee')"));
    // The one empty state with NO command row: updating a Shell extension
    // is not a shell command.
    const tooNewStart = empty.indexOf('export function buildDaemonTooNewItem(');
    const tooNewBody = empty.slice(tooNewStart);
    check('the too-new state offers no shell command',
        !tooNewBody.includes('buildCommandRow('));
}

// --- Cross-process contract: this module imports NOTHING --------------------

print('# daemon-status.js cross-process contract (C4/C5)');
{
    const src = readSource('usbee@bitcreed.us/src/daemon-status.js');
    check('daemon-status.js source is readable', src.length > 0);
    // Any `import` statement here breaks the prefs process (no gnome-shell
    // resource URIs) and bare-gjs CI (no gi typelib assumptions beyond what
    // the test itself pulls). Matches only statement-position imports so the
    // explanatory prose in the header comment does not trip it.
    check('daemon-status.js has no import statements',
        !/^\s*import\s/m.test(src));
    check('daemon-status.js exports MIN_USBEEHIVE_VERSION',
        src.includes('export const MIN_USBEEHIVE_VERSION'));
    check('daemon-status.js exports UPDATE_CMD',
        src.includes('export const UPDATE_CMD'));
    check('daemon-status.js exports DaemonState',
        src.includes('export const DaemonState'));
    check('daemon-status.js exports isVersionAtLeast',
        src.includes('export function isVersionAtLeast'));
}

print('# dbus-client.js imports only gi:// plus daemon-status.js (C4)');
{
    const src = readSource('usbee@bitcreed.us/src/dbus-client.js');
    check('dbus-client.js source is readable', src.length > 0);
    const specs = importSpecifiers(src);
    check('dbus-client.js imports are all gi:// or ./daemon-status.js',
        specs.length > 0 &&
        specs.every(s => s.startsWith('gi://') || s === './daemon-status.js'));
    check('dbus-client.js no longer declares its own MIN_USBEEHIVE_VERSION',
        !src.includes('const MIN_USBEEHIVE_VERSION'));
    check('dbus-client.js no longer declares its own isVersionAtLeast',
        !src.includes('function isVersionAtLeast'));
    check('dbus-client.js routes the gate through _applyVersionGate()',
        src.includes('_applyVersionGate()'));
    check('dbus-client.js writes the out-of-date state to the store',
        src.includes('setDaemonOutOfDate('));
    check('dbus-client.js _onVanished guards on DaemonState.STOPPED',
        src.includes('this._store.daemonState === DaemonState.STOPPED'));
}

// --- Structural guards: one store field feeds pill AND popover --------------

print('# device-store.js owns the tri-state');
{
    const src = readSource('usbee@bitcreed.us/src/device-store.js');
    check('device-store.js source is readable', src.length > 0);
    check('device-store.js imports DaemonState from ./daemon-status.js',
        /import\s*\{[^}]*DaemonState[^}]*\}\s*from\s*'\.\/daemon-status\.js'/.test(src));
    check('device-store.js exposes a daemonState getter',
        src.includes('get daemonState()'));
    check('device-store.js exposes a daemonVersion getter',
        src.includes('get daemonVersion()'));
    check('device-store.js derives daemonRunning from the tri-state',
        src.includes('this._daemonState === DaemonState.RUNNING'));
    check('device-store.js exposes setDaemonOutOfDate(version)',
        src.includes('setDaemonOutOfDate(version)'));
    check('device-store.js tileText has a "Daemon out of date" branch',
        src.includes("_('Daemon out of date')"));
    check('device-store.js keeps the "Daemon not running" fallback',
        src.includes("_('Daemon not running')"));
    check('device-store.js no longer keeps a private _daemonRunning boolean',
        !src.includes('this._daemonRunning'));
}

print('# tile.js routes the popover from the store');
{
    const src = readSource('usbee@bitcreed.us/src/tile.js');
    check('tile.js source is readable', src.length > 0);
    check('tile.js imports DaemonState from ./daemon-status.js',
        /import\s*\{[^}]*DaemonState[^}]*\}\s*from\s*'\.\/daemon-status\.js'/.test(src));
    check('tile.js reads this._store.daemonState',
        src.includes('this._store.daemonState'));
    check('tile.js forwards the detected version to the out-of-date state',
        src.includes('populateOutOfDateState(this._rowsSection, this._store.daemonVersion)'));
    check('tile.js no longer carries a private _daemonTooOld latch',
        !src.includes('_daemonTooOld'));
}

print('# popover.js forwards the detected version');
{
    const src = readSource('usbee@bitcreed.us/src/popover.js');
    check('popover.js source is readable', src.length > 0);
    check('populateOutOfDateState takes a detectedVersion parameter',
        src.includes('populateOutOfDateState(section, detectedVersion'));
    check('populateOutOfDateState forwards it to buildDaemonOutOfDateItem',
        src.includes('buildDaemonOutOfDateItem(detectedVersion)'));
}

print('# empty-state.js names both versions');
{
    const src = readSource('usbee@bitcreed.us/src/empty-state.js');
    check('empty-state.js source is readable', src.length > 0);
    check('empty-state.js imports MIN_USBEEHIVE_VERSION from ./daemon-status.js',
        /import\s*\{[^}]*MIN_USBEEHIVE_VERSION[^}]*\}\s*from\s*'\.\/daemon-status\.js'/.test(src));
    check('buildDaemonOutOfDateItem takes a detectedVersion parameter',
        src.includes('buildDaemonOutOfDateItem(detectedVersion'));
    check('empty-state.js renders required + detected versions',
        src.includes("_('Requires usbeehive %s or newer — detected %s')"));
    check('empty-state.js falls back to "unknown" for an unreadable version',
        src.includes("_('unknown')"));
    check('empty-state.js clamps the daemon-supplied version (T-ke2-01)',
        src.includes('.slice(0, 32)'));
}

print('# empty-state.js command rows are copyable');
{
    const src = readSource('usbee@bitcreed.us/src/empty-state.js');
    check('empty-state.js defines the shared buildCommandRow helper',
        src.includes('function buildCommandRow('));
    check('all three empty states use buildCommandRow',
        (src.match(/buildCommandRow\(/g) || []).length === 4); // 1 definition + 3 uses
    check('empty-state.js copies via the Shell clipboard API',
        src.includes('St.Clipboard.get_default().set_text('));
    check('empty-state.js removes pending feedback timers on destroy (T-ke2-04)',
        src.includes("connect('destroy'") && src.includes('GLib.Source.remove('));
    check('empty-state.js takes UPDATE_CMD from the shared module',
        !src.includes('const UPDATE_CMD') &&
        /import\s*\{[^}]*UPDATE_CMD[^}]*\}\s*from\s*'\.\/daemon-status\.js'/.test(src));
}

print('# stylesheet.css styles the copy affordance');
{
    const src = readSource('usbee@bitcreed.us/stylesheet.css');
    check('stylesheet.css source is readable', src.length > 0);
    check('stylesheet.css styles .usbee-empty-state-command',
        src.includes('.usbee-empty-state-command'));
    check('stylesheet.css styles .usbee-copy-button',
        src.includes('.usbee-copy-button'));
    check('stylesheet.css gives the copy button a hover state',
        src.includes('.usbee-copy-button:hover'));
}

print('# prefs.js gates the detected version (separate process, C5)');
{
    const src = readSource('usbee@bitcreed.us/prefs.js');
    check('prefs.js source is readable', src.length > 0);
    check('prefs.js imports the shared module by relative path',
        src.includes("from './src/daemon-status.js'"));
    check('prefs.js applies the version gate', src.includes('isVersionAtLeast('));
    check('prefs.js names the required version',
        src.includes('MIN_USBEEHIVE_VERSION'));
    check('prefs.js renders the shared UPDATE_CMD', src.includes('UPDATE_CMD'));
    check('prefs.js copies via the GTK4 clipboard', src.includes('get_clipboard()'));
    check('prefs.js markup-escapes the daemon version (T-ke2-01)',
        src.includes('GLib.markup_escape_text('));
    check('prefs.js clamps the daemon version (T-ke2-01)',
        src.includes('.slice(0, 32)'));
    // C5: prefs.js runs where the gnome-shell extension resource URI does
    // not resolve, so daemon-status.js must be its ONLY src/ import.
    const srcImports = importSpecifiers(src).filter(s => s.startsWith('./'));
    check('prefs.js imports no other src/ module',
        srcImports.length === 1 && srcImports[0] === './src/daemon-status.js');
}

// --- Summary ----------------------------------------------------------------
print('');
if (failures === 0)
    print('ALL TESTS PASSED');
else
    print(`${failures} ASSERTION(S) FAILED`);

System.exit(failures === 0 ? 0 : 1);
