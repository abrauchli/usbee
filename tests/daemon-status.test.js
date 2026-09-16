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
    SETUP_CMD, UPDATE_CMD, isAwaitingFirstSnapshot, isVersionAtLeast}
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

// Slice one function out of a module: from its declaration line to the next
// JSDoc block (or end of file). Generalises the hand-rolled slice the
// TOO_NEW guard below does, because several assertions here are about WHICH
// function renders something — a file-wide substring test would be satisfied
// by any other function in the same file and would not notice a widget
// moving between two of them (quick task 260915-unf).
//
// `decl` is the literal declaration text, e.g. 'function buildStartRow()' or
// 'export function buildEmptyStateItem()'.
function functionBody(src, decl) {
    const start = src.indexOf(decl);
    if (start === -1) return '';
    const rest = src.slice(start);
    const end = rest.indexOf('\n/**');
    return end === -1 ? rest : rest.slice(0, end);
}

// CSS with every /* ... */ block removed. Every negative assertion about the
// stylesheet runs through this: the comment that replaced a deleted rule
// deliberately NAMES the declarations it retired, so that nobody re-adds
// them, and a plain substring test would fail on the very prose that records
// the decision (quick task 260915-unf).
function cssCode(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '');
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

    // Quick task 260910-myu — the state where `usbeehived` is already on
    // PATH but no unit file exists. Telling that user to `cargo install`
    // again was the complaint; SETUP_CMD is INSTALL_CMD minus that step.
    check('SETUP_CMD installs the unit file',
        SETUP_CMD.includes('usbeehived --install-service'));
    check('SETUP_CMD starts the unit',
        SETUP_CMD.includes('systemctl --user enable --now usbeehived'));
    check('SETUP_CMD does NOT re-run cargo install',
        !SETUP_CMD.includes('cargo install'));
    check('SETUP_CMD is the tail of INSTALL_CMD',
        INSTALL_CMD.endsWith(SETUP_CMD));

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

print('# isAwaitingFirstSnapshot — the third, derived state');
{
    // The window this predicate exists for (quick task 260915-ung): the
    // daemon is on the bus but the un-awaited _snapshotImmediate() has not
    // come back, so an empty device list means "not counted yet" rather than
    // "nothing attached".
    check('RUNNING with no snapshot yet is awaiting',
        isAwaitingFirstSnapshot(DaemonState.RUNNING, false) === true);
    check('RUNNING after a snapshot is not awaiting',
        isAwaitingFirstSnapshot(DaemonState.RUNNING, true) === false);
    // The other three states own their own copy; the loading row must never
    // override an empty state that is already saying something truer.
    check('STOPPED is never awaiting',
        isAwaitingFirstSnapshot(DaemonState.STOPPED, false) === false);
    check('STOPPED with a stale flag is still never awaiting',
        isAwaitingFirstSnapshot(DaemonState.STOPPED, true) === false);
    check('OUT_OF_DATE is never awaiting',
        isAwaitingFirstSnapshot(DaemonState.OUT_OF_DATE, false) === false);
    check('TOO_NEW is never awaiting',
        isAwaitingFirstSnapshot(DaemonState.TOO_NEW, false) === false);
    // Fails closed like the rest of this module: an unknown future state
    // cannot strand a surface in "Loading…" forever.
    check('an unknown future state is never awaiting',
        isAwaitingFirstSnapshot('some-future-state', false) === false);
    check('an undefined state is never awaiting',
        isAwaitingFirstSnapshot(undefined, false) === false);
    // A store double predating the field reads as "not yet" rather than
    // reporting loaded — hence `!== true` in the predicate, not `!flag`.
    check('a missing snapshot flag reads as not-yet',
        isAwaitingFirstSnapshot(DaemonState.RUNNING, undefined) === true);
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

    // Quick task 260915-ung — the third, derived state. Every guard matches
    // code-shaped text rather than a bare translated literal, so a mention in
    // a comment cannot satisfy it (the trap 260910-p91 documented).
    check('device-store.js imports the predicate from ./daemon-status.js',
        /import\s*\{[^}]*isAwaitingFirstSnapshot[^}]*\}\s*from\s*'\.\/daemon-status\.js'/.test(src));
    check('device-store.js exposes an awaitingFirstSnapshot getter',
        src.includes('get awaitingFirstSnapshot()'));
    check('device-store.js delegates it to the shared predicate',
        src.includes('isAwaitingFirstSnapshot(this._daemonState, this._snapshotReceived)'));
    check('device-store.js keeps a _snapshotReceived field',
        src.includes('this._snapshotReceived = false;'));
    check('device-store.js has a Loading… tile branch',
        src.includes("_('Loading…')"));
    // setDevices is the one path where real data concludes the wait.
    check('setDevices concludes the awaiting state',
        functionBody(src, 'setDevices(rawEntries)')
            .includes('this._snapshotReceived = true;'));
    // The reset lives inside _setDaemonState, AFTER its no-op guard. That
    // placement is what returns both surfaces to loading on a daemon restart
    // while leaving an idempotent setDaemonRunning(true) alone — so it is
    // pinned explicitly rather than left implicit.
    check('_setDaemonState re-arms the awaiting state',
        functionBody(src, '_setDaemonState(state, version)')
            .includes('this._snapshotReceived = false;'));
    // A failed snapshot must conclude the wait without inventing a device
    // list — the "keep prior store state" contract (D-02).
    check('device-store.js exposes noteSnapshotFailed()',
        src.includes('noteSnapshotFailed()'));
    check('noteSnapshotFailed does not fabricate a device list',
        !functionBody(src, 'noteSnapshotFailed()').includes('this._devices'));
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
    // 1 definition + one use per command-bearing state: stopped,
    // service-not-set-up, not-installed, out-of-date. The too-new state
    // deliberately has none.
    check('every command-bearing empty state uses buildCommandRow',
        (src.match(/buildCommandRow\(/g) || []).length === 5);
    check('empty-state.js copies via the Shell clipboard API',
        src.includes('St.Clipboard.get_default().set_text('));
    // Quick task 260910-myu: the command used to live in an St.Entry, which
    // is single-line and does not reflow — INSTALL_CMD rendered as
    // "cargo install usbeehive --features=dbu…". A wrapping St.Label is the
    // mechanism 260910-ggy already proved works in this file.
    check('empty-state.js no longer renders commands in a non-reflowing St.Entry',
        !src.includes('new St.Entry('));
    check('empty-state.js wraps the command text',
        src.includes('entry.clutter_text.line_wrap = true') &&
        src.includes('Pango.WrapMode.WORD_CHAR'));
    check('empty-state.js removes pending feedback timers on destroy (T-ke2-04)',
        src.includes("connect('destroy'") && src.includes('GLib.Source.remove('));
    check('empty-state.js takes UPDATE_CMD from the shared module',
        !src.includes('const UPDATE_CMD') &&
        /import\s*\{[^}]*UPDATE_CMD[^}]*\}\s*from\s*'\.\/daemon-status\.js'/.test(src));
}

print('# the stopped state keeps its command behind a "Show details" row');
{
    const src = readSource('usbee@bitcreed.us/src/empty-state.js');
    const pop = readSource('usbee@bitcreed.us/src/popover.js');

    // Quick task 260915-unf. The raw `systemctl --user enable --now
    // usbeehived` line was printed in full in the default view, above a
    // one-click Start button that does the same job — so the panel led with
    // a terminal command instead of the action. It moved into a collapsed
    // disclosure; it was not deleted, because `enable --now` also makes the
    // daemon start with every session, which the button does not.
    check('empty-state.js exports the disclosure builder',
        src.includes('export function buildEmptyStateDetailsItem('));
    check('the disclosure label goes through gettext',
        src.includes("_('Show details')"));

    const disc = functionBody(src, 'export function buildEmptyStateDetailsItem(');
    const stopped = functionBody(src, 'export function buildEmptyStateItem(');
    check('both builders are sliceable', disc.length > 0 && stopped.length > 0);

    // A PopupSubMenuMenuItem, not a hand-rolled St.Button expander: it brings
    // the standard expander triangle, .popup-sub-menu theming and keyboard
    // navigation for free, and this repo already proves the pattern twice
    // (popover.js buildOptionsSection and buildDeviceRow).
    check('the disclosure is a PopupSubMenuMenuItem',
        disc.includes('new PopupMenu.PopupSubMenuMenuItem('));
    // buildCommandRow returns a bare St.BoxLayout, so it needs a menu-item
    // wrapper to live inside a submenu. Same shape as the detail panel in
    // popover.js buildDeviceRow.
    check('the submenu content is a non-reactive PopupBaseMenuItem wrapper',
        disc.includes('new PopupMenu.PopupBaseMenuItem(') &&
        /reactive:\s*false/.test(disc) && /can_focus:\s*false/.test(disc));
    check('the disclosure adds its content to the submenu',
        disc.includes('item.menu.addMenuItem('));

    // The command and its hint travel together — the hint is meaningless
    // without the command beside it.
    check('the disclosure renders the command row',
        disc.includes('buildCommandRow('));
    check('the disclosure carries the hint line',
        disc.includes('Or start it yourself'));

    // ...and are gone from the default view, which now leads with the button.
    check('the default stopped view no longer prints the command',
        !stopped.includes('buildCommandRow('));
    check('the default stopped view no longer carries the hint line',
        !stopped.includes('Or start it yourself'));
    check('the default stopped view still offers the Start button',
        stopped.includes('buildStartRow('));

    // D-C: only the stopped state hides its command. In the other three the
    // command is the ONLY action offered, so hiding it would be a regression
    // rather than a tidy-up. (The count-of-5 assertion above independently
    // pins that the call MOVED rather than being added or removed.)
    for (const name of ['buildServiceNotSetUpItem', 'buildDaemonNotInstalledItem',
        'buildDaemonOutOfDateItem']) {
        check(`${name} still shows its command in the default view`,
            functionBody(src, `export function ${name}(`).includes('buildCommandRow('));
    }

    const populate = functionBody(pop, 'export function populateEmptyState(');
    check('popover.js populateEmptyState is sliceable', populate.length > 0);
    check('popover.js imports the disclosure builder',
        pop.includes('buildEmptyStateDetailsItem'));
    // The disclosure is a SIBLING in the section, not a child of the state
    // item — and it follows the state item. removeAll() stays first
    // (Pitfall C: never mutate while iterating).
    // Quick task 260915-unh routed every teardown in popover.js through the
    // clearSection() chokepoint. The ordering intent is unchanged: the
    // section is emptied FIRST, then the state item, then the disclosure.
    const iRemove = populate.indexOf('clearSection(section)');
    const iState  = populate.indexOf('buildEmptyStateItem(');
    const iDisc   = populate.indexOf('buildEmptyStateDetailsItem(');
    check('populateEmptyState adds state item then disclosure, after removeAll',
        iRemove !== -1 && iState > iRemove && iDisc > iState);
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

print('# the Start button borrows the shell theme button classes');
{
    const src = readSource('usbee@bitcreed.us/src/empty-state.js');
    const css = readSource('usbee@bitcreed.us/stylesheet.css');
    const code = cssCode(css);

    // Quick task 260915-unf. The button worked when clicked but rendered at
    // the Shell's 50% disabled dim, so it read as deactivated. Cause: its
    // ancestor is a `reactive: false` PopupMenuItem, St maps that onto the
    // `:insensitive` pseudo-class, the theme's `.popup-menu-item:insensitive`
    // sets a dimmed `color`, and `color` INHERITS. The cure is a class that
    // carries an explicit `color` of its own — which the theme's own `.button`
    // does, per-theme, and `.button.default` additionally fills with the
    // user's accent colour. Pin the class string: "simplifying" it back to
    // the lone project class reintroduces the bug invisibly.
    check('empty-state.js gives the Start button the theme button classes',
        src.includes("style_class: 'button default usbee-start-button'"));

    const startRow = functionBody(src, 'function buildStartRow()');
    check('buildStartRow is sliceable', startRow.length > 0);
    // The JS was never the problem — the button is genuinely live. Guard that
    // it stays so, or a future reader "fixing" the dim by touching reactive
    // would break the click instead.
    check('the Start button is genuinely focusable and reactive',
        startRow.includes('can_focus: true') && startRow.includes('reactive: true'));
    // ...and that the in-flight state is still expressed by dropping reactive,
    // which is exactly what the theme's `.button.default:insensitive` rule
    // keys off to render the dimmer "Starting…" treatment.
    check('the in-flight state still disables via reactive = false',
        startRow.includes('button.reactive = false'));

    check('stylesheet.css declares no .usbee-start-button rule at all',
        !code.includes('.usbee-start-button'));
    // The retired declarations were white overlays: on the light theme, where
    // the popover background is near #fafafb, a 12%-white chip is invisible,
    // so the button lost its shape entirely in light mode.
    check('stylesheet.css keeps neither retired white overlay',
        !code.includes('rgba(255, 255, 255, 0.12)') &&
        !code.includes('rgba(255, 255, 255, 0.2)'));
    check('stylesheet.css records which theme rule owns the button now',
        css.includes('.button.default'));

    // The two surrounding rules are USBee's own layout and must survive the
    // colour deletion untouched.
    check('stylesheet.css keeps .usbee-empty-state-start',
        code.includes('.usbee-empty-state-start'));
    check('stylesheet.css keeps .usbee-empty-state-status',
        code.includes('.usbee-empty-state-status'));
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
    // not resolve, so it may import a src/ module only when that module
    // pulls in no such URI itself. Two qualify: daemon-status.js (imports
    // nothing at all) and service-probe.js (gi:// only — quick task
    // 260910-myu). Anything else — dbus-client.js, empty-state.js — drags in
    // gettext from a resource URI and blanks the preferences window at load.
    const allowedSrcImports = ['./src/daemon-status.js', './src/service-probe.js'];
    const srcImports = importSpecifiers(src).filter(s => s.startsWith('./'));
    check('prefs.js imports only the two resource-free src/ modules',
        srcImports.length > 0 &&
        srcImports.every(s => allowedSrcImports.includes(s)));
    // The allowlist is only safe while the allowed module stays gi-only.
    // tests/service-probe.test.js pins that from the other direction; this
    // is the belt to its braces.
    check('service-probe.js pulls in no gnome-shell resource URI',
        !readSource('usbee@bitcreed.us/src/service-probe.js')
            .includes("from 'resource:///"));
}

// --- Summary ----------------------------------------------------------------
print('');
if (failures === 0)
    print('ALL TESTS PASSED');
else
    print(`${failures} ASSERTION(S) FAILED`);

System.exit(failures === 0 ? 0 : 1);
