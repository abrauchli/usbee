// SPDX-License-Identifier: GPL-3.0-or-later
// src/dbus-client.js
//
// Single connectivity authority for org.usbeehive.Devices.
//
// Owns the Gio.bus_watch_name registration. Lazily constructs the proxy
// inside the "name-appeared" callback (D-05). On vanish, clears the
// store cache but does NOT recreate the proxy (D-07) — name-appeared
// will fire again when the daemon comes back, and reuses the existing
// proxy.
//
// Plan 01: bus watch + lazy proxy + initial snapshot + name-vanish only.
// Plan 02 Task 2: added DeviceAdded / DeviceRemoved subscriptions and the
// 150 ms trailing-edge debounce via _scheduleRefresh (D-06, D-10).

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// The version gate lives in src/daemon-status.js — a module with zero
// imports, so this file keeps importing ONLY gi:// modules plus that one.
// Pulling in device-store.js (which imports the gnome-shell extension
// resource URI for gettext) would make tests/dbus-client.test.js
// unloadable under bare-gjs CI.
import {DaemonState, IFACE_GENERATION, MIN_USBEEHIVE_VERSION, isVersionAtLeast}
    from './daemon-status.js';

// VERIFIED against ../usbeehive/src/dbus.rs (the
// `#[interface(name = "org.usbeehive.Devices5")]` block shipped in
// usbeehive 0.10.0). The generation digit lives ONLY on the interface
// name — not on the bus name or object path; both are version-agnostic.
const BUS_NAME       = 'org.usbeehive.Devices';     // version-agnostic
const OBJECT_PATH    = '/org/usbeehive/Devices';    // version-agnostic
const INTERFACE_NAME = 'org.usbeehive.Devices5';

// IFACE_XML — keep in sync with usbee@bitcreed.us/dbus-iface.xml.
// The .xml file on disk is the authoritative diff target; this template
// literal is what the runtime consumes (RESEARCH.md §How the XML is loaded
// Pattern 1 — avoids an async file load at enable() time, which D-15
// forbids in the sync form). Plan 04-02 Task 13 enforces byte-equality
// between this literal and dbus-iface.xml on disk (less the doctype).
//
// Refresh and Diagnose are declared and mirror the daemon-side interface
// in dbus-iface.xml. Refresh feeds the NOTIF-driven manual re-snapshot
// path; Diagnose is reserved for the preferences "Diagnose now" per-port
// button. Both remain unused at call sites in v2.0 — do not strip as dead
// code.
const IFACE_XML = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.usbeehive.Devices5">
    <method name="ListDevices">
      <arg type="a(ssssssssssqqsa(ss)ius(uuus)(bsssb)a(usuuuub)i)" direction="out" name="entries"/>
    </method>
    <method name="ListPorts">
      <arg type="ai" direction="out" name="ports"/>
    </method>
    <method name="Diagnose">
      <arg type="i" direction="in" name="port_number"/>
      <arg type="(bsssb)" direction="out" name="diagnostic"/>
    </method>
    <method name="SnapshotJson">
      <arg type="s" direction="out" name="json"/>
    </method>
    <method name="Refresh">
      <arg type="u" direction="out" name="device_count"/>
    </method>
    <property name="Version" type="s" access="read"/>
    <property name="DeviceCount" type="u" access="read"/>
    <signal name="DeviceAdded">
      <arg type="s" name="id"/>
      <arg type="s" name="headline"/>
    </signal>
    <signal name="DeviceRemoved">
      <arg type="s" name="id"/>
    </signal>
    <signal name="DeviceChanged">
      <arg type="s" name="id"/>
    </signal>
    <signal name="CapabilityDegraded">
      <arg type="i" name="port_number"/>
      <arg type="s" name="summary"/>
      <arg type="s" name="detail"/>
    </signal>
    <signal name="CapabilityRestored">
      <arg type="i" name="port_number"/>
    </signal>
    <signal name="DataRateDegraded">
      <arg type="s" name="id"/>
      <arg type="s" name="summary"/>
      <arg type="s" name="detail"/>
    </signal>
    <signal name="DataRateRestored">
      <arg type="s" name="id"/>
    </signal>
  </interface>
</node>
`;

const UsbeehiveProxy = Gio.DBusProxy.makeProxyWrapper(IFACE_XML);

/**
 * Classification the Notifier's scope filter and hardwired suppression
 * need, resolved from a store snapshot entry.
 *
 * `port.connect_type == 'hardwired'` marks a device soldered to the board.
 * Those re-enumerate on suspend/resume and under RESET_RESUME quirks,
 * producing "Disconnected: … / Connected: …" pairs the user cannot act on
 * (quick task 260905-b0s §D-5). Undefined when the store has no entry —
 * which the Notifier treats as default-allow, because DeviceAdded routinely
 * races ahead of ListDevices.
 *
 * @param {?object} dev  Unpacked DeviceEntry, or undefined on snapshot miss.
 * @returns {?{category: string, deviceClass: string, connectType: string}}
 */
function kindOf(dev) {
    if (!dev) return undefined;
    const pair = (dev.properties || []).find(([k]) => k === 'port.connect_type');
    return {
        category:    dev.category,
        deviceClass: dev.device_class,
        connectType: pair ? pair[1] : '',
    };
}

export const DBusClient = GObject.registerClass({
    Signals: {
        'ready':           {},
        'lost':            {},
        'devices-changed': {},
        'daemon-too-old':  {},
    },
}, class DBusClient extends GObject.Object {
    constructor(registry, store, notifier) {
        super();
        this._registry = registry;
        this._store = store;
        // May be null in unit-test paths; all call sites use optional
        // chaining (?.) below. Phase 2 NOTIF-01..04 wiring.
        this._notifier = notifier;
        this._proxy = null;
        // D-10: shared debounce timer for DeviceAdded / DeviceRemoved bursts.
        // Initialised to 0 (no pending source). _scheduleRefresh resets this
        // on every incoming signal so N signals in 150 ms -> exactly 1 snapshot.
        this._debounceId = 0;
        // Dispose handle for the registry entry tracking _debounceId.
        // Null when no timer is pending or after the callback has fired.
        this._dropDebounce = null;
    }

    /**
     * Install the bus_watch_name. Per RESEARCH §Pitfall D, if the name is
     * already owned, "appeared" fires on the next main-loop tick.
     */
    start() {
        const watchId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            () => this._onAppeared(),
            () => this._onVanished(),
        );
        this._registry.addBusWatch(watchId);
    }

    stop() {
        // No-op: SignalRegistry.dispose() (called from extension.disable())
        // handles the bus_watch_name, all proxy signal connections, and the
        // notify::g-name-owner handler. This method exists for symmetry.
        this._proxy = null;
    }

    _onAppeared() {
        // Already constructed (re-entrant on owner transition)? Just refresh.
        if (this._proxy !== null) {
            // Owner-transition orderings can deliver this callback before the
            // proxy's g-name-owner has propagated. Snapshotting against a
            // null owner yields NameHasNoOwner; skip — the proxy's
            // notify::g-name-owner handler drives the refresh once the new
            // owner lands (it fires for BOTH the acquire and the lose
            // transition; see _onProxyOwnerAcquired / _onVanished).
            if (this._proxy.gNameOwner !== null) this._onProxyOwnerAcquired();
            return;
        }
        new UsbeehiveProxy(
            Gio.DBus.session,
            BUS_NAME,
            OBJECT_PATH,
            (proxy, error) => {
                if (error) {
                    // Per PITFALLS §6: one logError, then the empty state
                    // remains. name-vanished/appeared will retry naturally.
                    logError(error, 'USBee: proxy construction failed');
                    return;
                }
                this._proxy = proxy;

                // COMPAT-01: refuse to consume a daemon older than the
                // pinned minimum. Applied here, at proxy-construction time,
                // and deliberately NOT in _onProxyOwnerAcquired — the
                // proxy's cached `Version` may not have refreshed when
                // notify::g-name-owner fires, and a fail-closed read there
                // would strand a healthy daemon in the out-of-date state
                // with nothing left to re-drive it.
                if (!this._applyVersionGate()) return;

                // D-07: notify::g-name-owner handles future owner transitions
                // in BOTH directions. A daemon restart drives owner null ->
                // new-owner; the bus_watch_name "appeared" callback often
                // fires before that propagates, so _onAppeared returns early
                // and THIS handler is the path that re-drives the snapshot.
                // Lose (-> null) routes to _onVanished; acquire (-> non-null)
                // routes to _onProxyOwnerAcquired. Both are idempotent so a
                // coincident watch-appeared call does not double-fire.
                // This is a GObject property notify, NOT a D-Bus signal —
                // use plain connect/disconnect (RESEARCH.md §Pitfall E).
                const ownerId = this._proxy.connect(
                    'notify::g-name-owner',
                    () => this._onProxyOwnerChanged());
                this._registry.addSignal(this._proxy, ownerId);

                // D-06: subscribe to DeviceAdded / DeviceRemoved for the
                // whole extension lifetime. We deliberately do NOT subscribe
                // to CapabilityDegraded / CapabilityRestored — those are
                // Phase 2 NOTIF-* work (RESEARCH.md §Pitfall F).
                // Use proxy.connectSignal (NOT .connect) — these are D-Bus
                // signals, not GObject property notifies (RESEARCH §Pitfall E).
                //
                // Quick task 260526-c6p: forward Add/Remove to the Notifier
                // for transient connect/disconnect toasts. Critical ordering:
                // the Notifier call resolves the headline against the CURRENT
                // (pre-mutation) store snapshot BEFORE _scheduleRefresh()
                // queues the snapshot reload. _scheduleRefresh debounces
                // 150 ms anyway, but reading the store synchronously here
                // makes the "pre-removal lookup" contract explicit at the
                // call site rather than relying on the debounce window.
                const addedId = this._proxy.connectSignal('DeviceAdded',
                    (_proxy, _sender, [id, headline]) => {
                        // DeviceStore lookup is racy here — the daemon may
                        // not have appeared in ListDevices yet for this id.
                        // We still need a `kind` for the 'power' scope
                        // filter, so try the store but fall back to undefined
                        // (which the Notifier treats as default-allow).
                        const dev = this._store?.devices?.find(d => d.id === id);
                        this._notifier?.onDeviceAdded(id, headline, kindOf(dev));
                        this._scheduleRefresh();
                    });
                this._registry.addProxySignal(this._proxy, addedId);

                const removedId = this._proxy.connectSignal('DeviceRemoved',
                    (_proxy, _sender, [id]) => {
                        // Resolve id → headline against the pre-removal
                        // snapshot. The DeviceRemoved payload only carries
                        // `id`; on snapshot miss, fall back to the id string
                        // (defensive — keeps the toast self-describing even
                        // when the store never saw this device).
                        const dev = this._store?.devices?.find(d => d.id === id);
                        const headline = dev?.headline || id;
                        this._notifier?.onDeviceRemoved(id, headline, kindOf(dev));
                        this._scheduleRefresh();
                    });
                this._registry.addProxySignal(this._proxy, removedId);

                // Re-snapshot trigger for benign present-port transitions:
                // status/role/transport/link-speed/USB-version/active-PDO/driver
                // changed on a device that stayed present (e.g. AC unplug that
                // leaves the Type-C port attached). None of DeviceAdded/Removed/
                // CapabilityDegraded/Restored fire for this case, so the tile
                // would otherwise keep showing a stale wattage forever.
                // Deliberately does NOT notify — unlike CapabilityDegraded/Restored,
                // a benign state transition requires a tile re-draw, not a toast.
                const changedId = this._proxy.connectSignal('DeviceChanged',
                    (_proxy, _sender, [id]) => { // eslint-disable-line no-unused-vars
                        this._scheduleRefresh();
                    });
                this._registry.addProxySignal(this._proxy, changedId);

                // Phase 2: forward Capability* signals to the Notifier
                // (NOTIF-01..04). Destructured payload matches IFACE_XML
                // (i, s, s) and (i) declared above.
                const degradedId = this._proxy.connectSignal('CapabilityDegraded',
                    (_proxy, _sender, [portNumber, summary, detail]) => {
                        this._notifier?.onCapabilityDegraded(portNumber, summary, detail);
                    });
                this._registry.addProxySignal(this._proxy, degradedId);

                const restoredId = this._proxy.connectSignal('CapabilityRestored',
                    (_proxy, _sender, [portNumber]) => {
                        this._notifier?.onCapabilityRestored(portNumber);
                    });
                this._registry.addProxySignal(this._proxy, restoredId);

                // Quick task 260905-b0s §D-5 — the data-rate pair. Keyed on
                // the STRING device id, not a Type-C port number: a data-rate
                // shortfall almost always lands on a plain USB device several
                // hops behind a hub, which has no port number at all. Both
                // are additive on Devices5; against an older daemon that
                // never emits them these subscriptions are simply inert.
                //
                // The headline is resolved here, against the store, so the
                // Notifier can title the notification with a device name
                // instead of `usb:5-2.1.1`. On a snapshot miss the id is the
                // honest fallback.
                const rateDegradedId = this._proxy.connectSignal('DataRateDegraded',
                    (_proxy, _sender, [id, summary, detail]) => {
                        const dev = this._store?.devices?.find(d => d.id === id);
                        this._notifier?.onDataRateDegraded(
                            id, summary, detail, dev?.headline || id);
                    });
                this._registry.addProxySignal(this._proxy, rateDegradedId);

                const rateRestoredId = this._proxy.connectSignal('DataRateRestored',
                    (_proxy, _sender, [id]) => {
                        this._notifier?.onDataRateRestored(id);
                    });
                this._registry.addProxySignal(this._proxy, rateRestoredId);

                this._store.setDaemonRunning(true);
                this._notifier?.onDaemonAppeared(); // RESEARCH §Code Example #3 — 2.5 s suppression
                this._snapshotImmediate();
                this.emit('ready');
            },
        );
    }

    /**
     * COMPAT-01 version gate. Reads the proxy's cached `Version` property
     * (eagerly populated by makeProxyWrapper) and decides whether this
     * daemon may be consumed.
     *
     * Fail-closed: a missing / non-string / unparseable version routes to
     * the out-of-date state rather than proceeding optimistically (see
     * 04-01-ADR-daemon-version-gate.md). The detected version travels into
     * the store, which is the single source of truth every surface reads —
     * the 'daemon-too-old' signal stays parameterless and is now only a
     * repaint trigger.
     *
     * @returns {boolean} true when the daemon passed the gate.
     */
    _applyVersionGate() {
        const daemonVersion = this._proxy?.Version;
        if (isVersionAtLeast(daemonVersion, MIN_USBEEHIVE_VERSION))
            return true;
        this._store.setDaemonOutOfDate(
            typeof daemonVersion === 'string' ? daemonVersion : '');
        this._store.setDevices([]);
        this.emit('daemon-too-old');
        // A non-string Version has two very different causes: an ancient
        // daemon, or one that has moved past org.usbeehive.Devices5 (the
        // interface has been cut four times in four months) so our proxy is
        // talking to an interface that no longer exists. The gate stays
        // fail-closed and synchronous either way; the probe below can only
        // refine the state afterwards, never loosen it.
        if (typeof daemonVersion !== 'string' || daemonVersion === '')
            this._probeInterfaceGeneration();
        return false;
    }

    /**
     * Ask the object what interfaces it actually implements, and if it
     * publishes an org.usbeehive.Devices<N> newer than this build speaks,
     * flip the store to TOO_NEW (quick task 260905-b0s §D-7).
     *
     * Without this the user is told "usbeehive daemon out of date — requires
     * 0.10.0 or newer — detected unknown" alongside a `cargo install` command
     * that changes nothing, i.e. asked to update the wrong component.
     *
     * Asynchronous and only on the failure path, so D-15 (no sync D-Bus on
     * the Shell's main loop) holds. Regex over the introspection XML is
     * sufficient — we need one interface name, not a parse tree. Any failure
     * leaves the honest "detected unknown" state in place: it now means
     * "something else owns this bus name", which is itself the diagnosis.
     */
    _probeInterfaceGeneration() {
        // makeProxyWrapper proxies expose the underlying connection; the
        // unit-test doubles do not, which is also the guard that keeps this
        // path off the bus in bare-gjs CI.
        const conn = this._proxy?.get_connection?.();
        if (!conn) return;
        conn.call(
            BUS_NAME, OBJECT_PATH,
            'org.freedesktop.DBus.Introspectable', 'Introspect',
            null, new GLib.VariantType('(s)'),
            Gio.DBusCallFlags.NONE, 2000, null,
            (source, res) => {
                let xml = '';
                try {
                    [xml] = source.call_finish(res).deep_unpack();
                } catch (_e) {
                    // Recovery strategy: keep the OUT_OF_DATE state already
                    // written above. Nothing to log — an unreachable
                    // Introspect on a name we just failed to read is not news.
                    return;
                }
                const generations = [...xml.matchAll(/org\.usbeehive\.Devices(\d+)/g)]
                    .map(m => Number.parseInt(m[1], 10))
                    .filter(Number.isInteger);
                if (generations.length === 0) return;
                if (Math.max(...generations) <= IFACE_GENERATION) return;
                this._store.setDaemonTooNew();
                this._store.setDevices([]);
                this.emit('daemon-too-old');   // repaint trigger only
            });
    }

    /**
     * notify::g-name-owner handler for the constructed proxy. The owner
     * changes in BOTH directions over the extension lifetime: a daemon exit
     * drives it to null, a daemon (re)start drives it to a new owner string.
     *
     * The bus_watch_name "appeared" callback frequently fires before the
     * proxy propagates the new owner, so _onAppeared's re-entrant branch
     * returns early — THIS handler is the path that re-drives the snapshot on
     * restart (the bug fixed in 260608: previously only the null transition
     * was handled, so the tile stayed stuck in "daemon not running").
     *
     * Defensive null check: if a future teardown path nulls _proxy before the
     * registry disconnects this handler, the dereference would throw. Both
     * routed methods are idempotent (CR-01 guards), so a coincident
     * watch-appeared call does not double-fire.
     */
    _onProxyOwnerChanged() {
        if (!this._proxy) return;
        if (this._proxy.gNameOwner === null)
            this._onVanished();
        else
            this._onProxyOwnerAcquired();
    }

    /**
     * Owner-acquired path for an already-constructed proxy: the daemon is
     * (back) on the bus with a live g-name-owner. Marks the store running,
     * un-suppresses notifications, takes an immediate snapshot, and signals
     * 'ready' so the tile leaves the "daemon not running" empty state.
     *
     * Idempotent: reached from both the bus_watch_name "appeared" callback
     * and the proxy's notify::g-name-owner handler, which can fire in either
     * order on a restart. The daemonRunning guard collapses a coincident pair
     * to a single snapshot + 'ready'. (First-ever construction takes the
     * inline path in _onAppeared's proxy callback, not this method.)
     */
    _onProxyOwnerAcquired() {
        if (this._store.daemonRunning) return;
        this._store.setDaemonRunning(true);
        this._notifier?.onDaemonAppeared(); // RESEARCH §Code Example #3 — 2.5 s suppression
        this._snapshotImmediate();
        this.emit('ready');
    }

    /**
     * D-10: 150 ms trailing-edge debounce for DeviceAdded / DeviceRemoved
     * signal bursts (e.g. dock attach enumerating 5-15 devices).
     *
     * Every incoming signal resets the timer so N signals within 150 ms
     * collapse to exactly one ListDevices call + one store mutation +
     * one tile repaint (RESEARCH.md §Don't Hand-Roll + §Code Example 3).
     *
     * The first snapshot on daemon appearance bypasses this debounce
     * because _onAppeared calls _snapshotImmediate() directly
     * (RESEARCH.md §Pitfall G — first event must not feel sluggish).
     *
     * Each new timer is tracked via _registry.addTimeout, which returns a
     * dispose handle. We drop the handle both when cancelling an in-flight
     * timer and when the callback runs to completion, so the registry never
     * carries stale entries that would emit GLib-CRITICAL on disable.
     */
    _scheduleRefresh() {
        if (this._debounceId !== 0) {
            GLib.Source.remove(this._debounceId);
            this._dropDebounce?.();
            this._dropDebounce = null;
            this._debounceId = 0;
        }
        this._debounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, 150, () => {
                this._dropDebounce?.();
                this._dropDebounce = null;
                this._debounceId = 0;
                this._snapshotImmediate();
                return GLib.SOURCE_REMOVE;
            });
        // Track the new timer so disable() removes it if still in-flight.
        this._dropDebounce = this._registry.addTimeout(this._debounceId);
    }

    _onVanished() {
        // Idempotency guard — both bus_watch_name and notify::g-name-owner
        // fire on daemon disconnect. Without this guard, setDevices([])
        // and 'lost' would emit twice per vanish event.
        //
        // Keyed on DaemonState.STOPPED, NOT on !daemonRunning: a daemon
        // rejected by the version gate already has daemonRunning === false,
        // so the old guard returned early here and left the store parked in
        // OUT_OF_DATE forever after that daemon exited — the pill kept
        // reading "Daemon out of date" with nothing on the bus.
        if (this._store.daemonState === DaemonState.STOPPED) return;
        this._store.setDaemonRunning(false);
        this._store.setDevices([]);
        this._notifier?.onDaemonVanished(); // drop live notifications — they're stale
        this.emit('lost');
    }

    async _snapshotImmediate() {
        if (!this._proxy) return;
        try {
            // GJS 1.80 (GNOME 46): makeProxyWrapper *Remote() is callback-style,
            // not Promise-style. Wrap it ourselves. (Confirmed against the
            // ubuntu-dock extension's nautilus.EmptyTrashRemote pattern.)
            const [entries] = await new Promise((resolve, reject) => {
                this._proxy.ListDevicesRemote((result, error) => {
                    if (error) reject(error);
                    else resolve(result);
                });
            });
            this._store.setDevices(entries);
            this.emit('devices-changed');
        } catch (e) {
            // Per PITFALLS §7 — catch only because we have a recovery strategy:
            // keep prior store state, log once, let next signal retry.
            logError(e, 'USBee: ListDevices failed');
        }
    }
});
