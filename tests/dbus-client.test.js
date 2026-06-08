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

import {DBusClient} from '../usbee@bitcreed.us/src/dbus-client.js';

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

function makeStore() {
    return {
        daemonRunning: false,
        devices: [],
        calls: [],
        setDaemonRunning(v) { this.daemonRunning = v; this.calls.push(['setDaemonRunning', v]); },
        setDevices(d) { this.devices = d; this.calls.push(['setDevices', d.length]); },
    };
}

function makeNotifier() {
    return {
        appeared: 0,
        vanished: 0,
        onDaemonAppeared() { this.appeared++; },
        onDaemonVanished() { this.vanished++; },
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
function makeProxy(owner) {
    return {
        gNameOwner: owner,
        ListDevicesRemote(cb) { cb([[]], null); }, // result = [entries], entries = []
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
    store.daemonRunning = true; // precondition: daemon was up
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

// --- Summary ----------------------------------------------------------------
print('');
if (failures === 0)
    print('ALL TESTS PASSED');
else
    print(`${failures} ASSERTION(S) FAILED`);

System.exit(failures === 0 ? 0 : 1);
