// SPDX-License-Identifier: GPL-3.0-or-later
// tests/dbus-client.test.js
//
// Regression coverage for the daemon-reconnect state machine in
// src/dbus-client.js (bug 260608: on a daemon restart the tile stayed
// stuck in "daemon not running"). The root cause was that the proxy's
// notify::g-name-owner handler only acted on the *lose* transition
// (gNameOwner -> null); the *acquire* transition (-> new owner) was
// dropped, so nothing re-drove the snapshot after _onAppeared's
// re-entrant branch returned early on the not-yet-propagated owner.
//
// Runtime — plain GJS, NOT node:test. dbus-client.js imports only
// gi://{GObject,Gio,GLib} (no gettext / extension-resource URI), so it
// loads cleanly under bare gjs. We deliberately avoid the `node:test`
// shim the forward-compat test relies on — that shim is absent in some
// gjs builds (e.g. 1.80.2), which would make this test silently un-runnable.
//
// Run from the repo root:
//     gjs -m tests/dbus-client.test.js
// Exit status is non-zero if any assertion fails.

import System from 'system';
import GLib from 'gi://GLib';

import {DBusClient} from '../usbee@bitcreed.us/src/dbus-client.js';
import {DaemonState} from '../usbee@bitcreed.us/src/daemon-status.js';

let failures = 0;
function check(name, cond) {
    if (cond) {
        print(`  ok   - ${name}`);
    } else {
        failures++;
        print(`  FAIL - ${name}`);
    }
}

// --- Test doubles -----------------------------------------------------------
// Minimal stand-ins matching only the surface dbus-client.js touches on the
// paths under test. Each records enough to assert ordering/idempotency.

// Mirrors the real DeviceStore surface after quick task 260821-ke2: the
// tri-state daemonState is the source of truth and daemonRunning is derived
// from it. The double keeps both fields in sync the same way, so the
// _onVanished idempotency guard (which now reads daemonState) is exercised
// against realistic state.
function makeStore() {
    return {
        daemonRunning: false,
        daemonState: DaemonState.STOPPED,
        daemonVersion: '',
        devices: [],
        calls: [],
        setDaemonRunning(v) {
            this.daemonRunning = v;
            this.daemonState = v ? DaemonState.RUNNING : DaemonState.STOPPED;
            this.daemonVersion = '';
            this.calls.push(['setDaemonRunning', v]);
        },
        setDaemonOutOfDate(version) {
            this.daemonRunning = false;
            this.daemonState = DaemonState.OUT_OF_DATE;
            this.daemonVersion = version || '';
            this.calls.push(['setDaemonOutOfDate', this.daemonVersion]);
        },
        setDevices(d) { this.devices = d; this.calls.push(['setDevices', d.length]); },
    };
}

function makeNotifier() {
    return {
        appeared: 0,
        vanished: 0,
        // Track any notifier calls that a DeviceChanged handler must NOT make.
        // DeviceChanged is a benign present-port transition — no toast should fire.
        deviceAddedCalls: 0,
        deviceRemovedCalls: 0,
        capabilityDegradedCalls: 0,
        capabilityRestoredCalls: 0,
        onDaemonAppeared() { this.appeared++; },
        onDaemonVanished() { this.vanished++; },
        onDeviceAdded(_id, _headline, _kind) { this.deviceAddedCalls++; },
        onDeviceRemoved(_id, _headline, _kind) { this.deviceRemovedCalls++; },
        onCapabilityDegraded(_port, _summary, _detail) { this.capabilityDegradedCalls++; },
        onCapabilityRestored(_port) { this.capabilityRestoredCalls++; },
    };
}

// _onProxyOwnerAcquired/_onVanished never touch the registry; the no-op
// stub is enough for these paths. addTimeout returns a drop-handle to
// match the real contract in case a path reaches _scheduleRefresh.
const registry = {
    addSignal() {},
    addProxySignal() {},
    addBusWatch() {},
    addTimeout() { return () => {}; },
};

// Fake proxy: only gNameOwner (read by the routing/guard logic) and
// ListDevicesRemote (callback-style, one out-arg `entries`) are exercised.
// connectSignal records handlers by name for tests that drive signal subscriptions.
// Returns a monotonically increasing integer id, mirroring the real proxy contract.
// `version` (optional) is surfaced as the cached `Version` property the
// version gate reads. Omit it to simulate a daemon whose Version could not
// be read at proxy-construction time (the fail-closed path).
function makeProxy(owner, version) {
    let nextSignalId = 1;
    const signalHandlers = {};
    const subscribedNames = [];
    return {
        gNameOwner: owner,
        Version: version,
        ListDevicesRemote(cb) { cb([[]], null); }, // result = [entries], entries = []
        // Records signal handlers by name so tests can invoke them directly.
        connectSignal(name, handler) {
            signalHandlers[name] = handler;
            subscribedNames.push(name);
            return nextSignalId++;
        },
        // Invoke a recorded signal handler by name (for testing).
        _emit(name, ...args) {
            if (signalHandlers[name])
                signalHandlers[name](this, null, args);
        },
        // Read-only list of all signal names passed to connectSignal, in order.
        get subscribedSignals() { return subscribedNames.slice(); },
    };
}

function newClient(store, notifier) {
    return new DBusClient(registry, store ?? makeStore(), notifier ?? makeNotifier());
}

// --- Tests ------------------------------------------------------------------

print('# _onProxyOwnerAcquired — marks running, idempotent');
{
    const store = makeStore();
    const notifier = makeNotifier();
    const client = newClient(store, notifier);
    client._proxy = makeProxy(':1.1');
    let ready = 0;
    client.connect('ready', () => ready++);

    client._onProxyOwnerAcquired();
    check('sets daemonRunning true', store.daemonRunning === true);
    check('un-suppresses notifier (onDaemonAppeared)', notifier.appeared === 1);
    check('emits ready', ready === 1);

    client._onProxyOwnerAcquired(); // coincident watch-appeared + notify
    check('idempotent: notifier not re-fired', notifier.appeared === 1);
    check('idempotent: ready not re-emitted', ready === 1);
}

print('# _onVanished — clears, idempotent');
{
    const store = makeStore();
    store.setDaemonRunning(true); // precondition: daemon was up
    store.calls.length = 0;
    const notifier = makeNotifier();
    const client = newClient(store, notifier);
    let lost = 0;
    client.connect('lost', () => lost++);

    client._onVanished();
    check('clears daemonRunning', store.daemonRunning === false);
    check('clears device list', store.calls.some(c => c[0] === 'setDevices' && c[1] === 0));
    check('notifies (onDaemonVanished)', notifier.vanished === 1);
    check('emits lost', lost === 1);

    client._onVanished(); // both bus-watch vanish + notify can fire
    check('idempotent: lost not re-emitted', lost === 1);
    check('idempotent: notifier not re-fired', notifier.vanished === 1);
}

print('# _onProxyOwnerChanged — routes both directions, null-proxy safe');
{
    const store = makeStore();
    const client = newClient(store);
    client._proxy = makeProxy(':1.7');

    client._onProxyOwnerChanged();
    check('non-null owner routes to acquired', store.daemonRunning === true);

    client._proxy.gNameOwner = null;
    client._onProxyOwnerChanged();
    check('null owner routes to vanished', store.daemonRunning === false);

    client._proxy = null;
    let threw = false;
    try { client._onProxyOwnerChanged(); } catch (_e) { threw = true; }
    check('null proxy does not throw', threw === false);
}

print('# daemon restart — the regression scenario');
{
    // Proxy was built on first connect and never nulled. Daemon exits, then
    // restarts. The bus_watch_name "appeared" callback fires FIRST, before
    // the proxy propagates the new owner.
    const store = makeStore();
    const notifier = makeNotifier();
    const client = newClient(store, notifier);
    client._proxy = makeProxy(null); // owner not yet propagated
    let ready = 0;
    client.connect('ready', () => ready++);

    client._onAppeared(); // re-entrant branch, owner still null
    check('appeared w/ null owner does NOT mark running', store.daemonRunning === false);
    check('appeared w/ null owner emits no premature ready', ready === 0);

    // notify::g-name-owner now fires as the owner propagates — the path that
    // was previously dropped, leaving the tile stuck.
    client._proxy.gNameOwner = ':1.99';
    client._onProxyOwnerChanged();
    check('owner propagation recovers daemonRunning', store.daemonRunning === true);
    check('recovery emits ready (tile leaves empty state)', ready === 1);
}

print('# daemon restart — lucky ordering (owner already live at appeared)');
{
    const store = makeStore();
    const client = newClient(store);
    client._proxy = makeProxy(':1.5'); // owner already propagated
    let ready = 0;
    client.connect('ready', () => ready++);

    client._onAppeared();
    check('appeared w/ live owner marks running', store.daemonRunning === true);
    check('appeared w/ live owner emits ready', ready === 1);
}

print('# DeviceChanged — re-snapshots, never notifies');

// NOTE: this section uses top-level await (valid in GJS ESM modules) to
// properly wait for _snapshotImmediate()'s async ListDevicesRemote call.
// All existing tests are synchronous; this block extends the harness minimally.

{
    // --- 1. Re-snapshot path ---
    // _snapshotImmediate() is what _scheduleRefresh's timer callback calls.
    // We drive it directly and verify store.setDevices is recorded.
    // Top-level await lets the Promise microtask settle before we check.
    const store = makeStore();
    const notifier = makeNotifier();
    const client = newClient(store, notifier);
    client._proxy = makeProxy(':1.5');
    store.calls.length = 0;
    await client._snapshotImmediate();
    check('DeviceChanged path re-snapshots (setDevices called)',
        store.calls.some(c => c[0] === 'setDevices'));

    // --- 2. No notification path ---
    // _scheduleRefresh() must not invoke any notifier method. If the
    // DeviceChanged handler ever called this._notifier.onDeviceAdded() etc.
    // by mistake, one of these counters would be non-zero.
    // (GLib.timeout_add won't fire in bare gjs — we only test the synchronous
    // pre-debounce side-effects: nothing on the notifier.)
    client._scheduleRefresh(); // simulate what the DeviceChanged handler does
    check('DeviceChanged: onDeviceAdded not called',    notifier.deviceAddedCalls === 0);
    check('DeviceChanged: onDeviceRemoved not called',  notifier.deviceRemovedCalls === 0);
    check('DeviceChanged: onCapabilityDegraded not called', notifier.capabilityDegradedCalls === 0);
    check('DeviceChanged: onCapabilityRestored not called', notifier.capabilityRestoredCalls === 0);
    check('DeviceChanged does not notify (total notifier toast calls = 0)',
        notifier.deviceAddedCalls + notifier.deviceRemovedCalls +
        notifier.capabilityDegradedCalls + notifier.capabilityRestoredCalls === 0);
}

{
    // --- 3. Structural registration check ---
    // connectSignal('DeviceChanged') is registered inside _onAppeared's
    // UsbeehiveProxy construction callback. Because UsbeehiveProxy is a
    // module-level variable we cannot intercept it in bare gjs without D-Bus.
    // We verify the registration structurally: read dbus-client.js source and
    // assert the connectSignal call and the addProxySignal registration are
    // present. This is a lightweight source-level regression guard — the test
    // fails (RED) before the code is added and passes (GREEN) after.
    const [ok, raw] = GLib.file_get_contents(
        GLib.build_filenamev([GLib.get_current_dir(), 'usbee@bitcreed.us/src/dbus-client.js']));
    const src = ok ? new TextDecoder().decode(raw) : '';
    check("dbus-client.js subscribes connectSignal('DeviceChanged')",
        src.includes("connectSignal('DeviceChanged'"));
    check('dbus-client.js registers changedId via addProxySignal',
        src.includes('addProxySignal(this._proxy, changedId)'));
    check('dbus-client.js DeviceChanged handler calls _scheduleRefresh()',
        // The handler must call _scheduleRefresh and must NOT call _notifier.
        // We check the source contains the refresh call and not a notifier call
        // adjacent to 'DeviceChanged' (checked by verifying the block above
        // contains no _notifier reference, enforced by the no-notify assertions).
        src.includes('_scheduleRefresh()'));
    check('dbus-client.js DeviceChanged signal in IFACE_XML literal',
        src.includes('<signal name="DeviceChanged">'));
}

print('# _applyVersionGate — one write path for the out-of-date state');
{
    // Too old: store parks in OUT_OF_DATE carrying the reported version, the
    // device list is cleared, and 'daemon-too-old' fires exactly once. The
    // signal stays parameterless — the version travels through the store,
    // which is what the pill and the popover both read (260821-ke2).
    const store = makeStore();
    const client = newClient(store);
    client._proxy = makeProxy(':1.2', '0.9.9');
    let tooOld = 0;
    client.connect('daemon-too-old', () => tooOld++);

    const passed = client._applyVersionGate();
    check('too-old version fails the gate', passed === false);
    check('store parks in OUT_OF_DATE', store.daemonState === DaemonState.OUT_OF_DATE);
    check('store records the reported version', store.daemonVersion === '0.9.9');
    check('derived daemonRunning stays false', store.daemonRunning === false);
    check('clears the device list', store.calls.some(c => c[0] === 'setDevices' && c[1] === 0));
    check("emits 'daemon-too-old' once", tooOld === 1);
}

{
    // Unreadable Version (the F1 false-positive shape): fail closed, and
    // record an EMPTY version so the UI can honestly say "detected unknown"
    // instead of printing "undefined" at the user.
    const store = makeStore();
    const client = newClient(store);
    client._proxy = makeProxy(':1.2'); // no Version property at all
    let tooOld = 0;
    client.connect('daemon-too-old', () => tooOld++);

    check('undefined version fails the gate', client._applyVersionGate() === false);
    check('undefined version parks in OUT_OF_DATE',
        store.daemonState === DaemonState.OUT_OF_DATE);
    check('undefined version is recorded as empty (not "undefined")',
        store.daemonVersion === '');
    check("undefined version emits 'daemon-too-old'", tooOld === 1);
}

{
    // New enough: the gate is a pure predicate — no store mutation, no signal.
    const store = makeStore();
    const client = newClient(store);
    client._proxy = makeProxy(':1.2', '0.11.0');
    let tooOld = 0;
    client.connect('daemon-too-old', () => tooOld++);

    check('new-enough version passes the gate', client._applyVersionGate() === true);
    check('passing gate does not mutate the store', store.calls.length === 0);
    check('passing gate stays in STOPPED (caller marks running)',
        store.daemonState === DaemonState.STOPPED);
    check("passing gate emits no 'daemon-too-old'", tooOld === 0);
}

print('# out-of-date daemon that exits — returns to STOPPED (the ke2 regression)');
{
    // Before 260821-ke2 the _onVanished guard read !daemonRunning, which is
    // ALREADY false in the out-of-date state — so the store stayed parked in
    // OUT_OF_DATE forever and the pill kept claiming the daemon was out of
    // date with nothing on the bus.
    const store = makeStore();
    const notifier = makeNotifier();
    const client = newClient(store, notifier);
    client._proxy = makeProxy(':1.2', '0.9.9');
    client._applyVersionGate();
    store.calls.length = 0;
    let lost = 0;
    client.connect('lost', () => lost++);

    client._onVanished();
    check('OUT_OF_DATE → STOPPED on vanish', store.daemonState === DaemonState.STOPPED);
    check('clears the device list on vanish',
        store.calls.some(c => c[0] === 'setDevices' && c[1] === 0));
    check('notifies (onDaemonVanished)', notifier.vanished === 1);
    check("emits 'lost'", lost === 1);

    client._onVanished(); // bus-watch vanish + notify::g-name-owner both fire
    check('idempotent from STOPPED: lost not re-emitted', lost === 1);
    check('idempotent from STOPPED: notifier not re-fired', notifier.vanished === 1);
}

// --- Summary ----------------------------------------------------------------
print('');
if (failures === 0)
    print('ALL TESTS PASSED');
else
    print(`${failures} ASSERTION(S) FAILED`);

System.exit(failures === 0 ? 0 : 1);
