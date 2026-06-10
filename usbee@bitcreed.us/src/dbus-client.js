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

// VERIFIED against ../usbeehive/src/dbus.rs (the
// `#[interface(name = "org.usbeehive.Devices5")]` block shipped in
// usbeehive 0.10.0). The generation digit lives ONLY on the interface
// name — not on the bus name or object path; both are version-agnostic.
const BUS_NAME       = 'org.usbeehive.Devices';     // version-agnostic
const OBJECT_PATH    = '/org/usbeehive/Devices';    // version-agnostic
const INTERFACE_NAME = 'org.usbeehive.Devices5';

// Minimum supported usbeehive daemon version. usbeehive 0.10.0 hard-cuts
// the prior interface generation to Devices5 (no alias) per
// ../usbeehive/CHANGELOG.md §[0.10.0] (2026-06-10): the per-entry power
// tuple grew a `contract_mw` field ((uus) → (uuus)) so the sink's
// *requested* operating power and what the contract *allows* travel
// separately, and the bottleneck enum gained the benign `SinkLimit`
// variant. Older daemons (Devices4, < 0.10.0) route into the existing
// populateOutOfDateState empty state via isVersionAtLeast below.
const MIN_USBEEHIVE_VERSION = '0.10.0';

// Fail-closed lexical-tuple semver compare. Returns true iff `actual >= minimum`.
// Any parse failure returns false — the gate routes to 'daemon-too-old'
// rather than throwing or proceeding optimistically (04-01-ADR step 4).
function isVersionAtLeast(actual, minimum) {
    const parse = v => {
        if (typeof v !== 'string') return null;
        const parts = v.split('.').map(s => Number.parseInt(s, 10));
        if (parts.length !== 3 || parts.some(n => !Number.isInteger(n) || n < 0))
            return null;
        return parts;
    };
    const a = parse(actual);
    const m = parse(minimum);
    if (!a || !m) return false;
    for (let i = 0; i < 3; i++) {
        if (a[i] > m[i]) return true;
        if (a[i] < m[i]) return false;
    }
    return true;
}

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
    <signal name="CapabilityDegraded">
      <arg type="i" name="port_number"/>
      <arg type="s" name="summary"/>
      <arg type="s" name="detail"/>
    </signal>
    <signal name="CapabilityRestored">
      <arg type="i" name="port_number"/>
    </signal>
  </interface>
</node>
`;

const UsbeehiveProxy = Gio.DBusProxy.makeProxyWrapper(IFACE_XML);

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
                // pinned minimum. `Version` is a cached property on the
                // proxy (eagerly populated by makeProxyWrapper). Fail-
                // closed: any parse error → 'daemon-too-old'. See 04-01-
                // ADR-daemon-version-gate.md for the full wiring rules.
                const daemonVersion = this._proxy.Version;
                if (!isVersionAtLeast(daemonVersion, MIN_USBEEHIVE_VERSION)) {
                    this._store.setDaemonRunning(false);
                    this._store.setDevices([]);
                    this.emit('daemon-too-old');
                    return;
                }

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
                        const kind = dev
                            ? {category: dev.category, deviceClass: dev.device_class}
                            : undefined;
                        this._notifier?.onDeviceAdded(id, headline, kind);
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
                        const kind = dev
                            ? {category: dev.category, deviceClass: dev.device_class}
                            : undefined;
                        this._notifier?.onDeviceRemoved(id, headline, kind);
                        this._scheduleRefresh();
                    });
                this._registry.addProxySignal(this._proxy, removedId);

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

                this._store.setDaemonRunning(true);
                this._notifier?.onDaemonAppeared(); // RESEARCH §Code Example #3 — 2.5 s suppression
                this._snapshotImmediate();
                this.emit('ready');
            },
        );
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
        if (!this._store.daemonRunning) return;
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
