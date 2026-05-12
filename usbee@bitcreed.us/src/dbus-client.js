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

// VERIFIED against ../usbeehive/src/dbus.rs:290-292
// (see RESEARCH.md §Daemon Wire Shape + §Pitfall A)
// The "1" lives ONLY on the interface name — not on the bus name or
// object path. CONTEXT.md described these wrong; RESEARCH.md surfaced
// the correction and the daemon source is the source of truth.
const BUS_NAME       = 'org.usbeehive.Devices';     // no trailing 1
const OBJECT_PATH    = '/org/usbeehive/Devices';    // no trailing 1
const INTERFACE_NAME = 'org.usbeehive.Devices1';    // 1 only on interface

// IFACE_XML — keep in sync with usbee@bitcreed.us/dbus-iface.xml.
// The .xml file on disk is the authoritative diff target; this template
// literal is what the runtime consumes (RESEARCH.md §How the XML is loaded
// Pattern 1 — avoids an async file load at enable() time, which D-15
// forbids in the sync form).
const IFACE_XML = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.usbeehive.Devices1">
    <method name="ListDevices">
      <arg type="a(ssssssasi)" direction="out" name="entries"/>
    </method>
    <method name="ListPorts">
      <arg type="ai" direction="out" name="ports"/>
    </method>
    <method name="Diagnose">
      <arg type="i" direction="in" name="port_number"/>
      <arg type="(ssssb)" direction="out" name="diagnostic"/>
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
</node>`;

const UsbeehiveProxy = Gio.DBusProxy.makeProxyWrapper(IFACE_XML);

export const DBusClient = GObject.registerClass({
    Signals: {
        'ready':           {},
        'lost':            {},
        'devices-changed': {},
    },
}, class DBusClient extends GObject.Object {
    constructor(registry, store) {
        super();
        this._registry = registry;
        this._store = store;
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
            this._store.setDaemonRunning(true);
            this._snapshotImmediate();
            this.emit('ready');
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
                // D-07: notify::g-name-owner handles future owner transitions.
                // This is a GObject property notify, NOT a D-Bus signal —
                // use plain connect/disconnect (RESEARCH.md §Pitfall E).
                const ownerId = this._proxy.connect(
                    'notify::g-name-owner', () => {
                        if (this._proxy.g_name_owner === null)
                            this._onVanished();
                    });
                this._registry.addSignal(this._proxy, ownerId);

                // D-06: subscribe to DeviceAdded / DeviceRemoved for the
                // whole extension lifetime. We deliberately do NOT subscribe
                // to CapabilityDegraded / CapabilityRestored — those are
                // Phase 2 NOTIF-* work (RESEARCH.md §Pitfall F).
                // Use proxy.connectSignal (NOT .connect) — these are D-Bus
                // signals, not GObject property notifies (RESEARCH §Pitfall E).
                const addedId = this._proxy.connectSignal('DeviceAdded',
                    () => this._scheduleRefresh());
                this._registry.addProxySignal(this._proxy, addedId);

                const removedId = this._proxy.connectSignal('DeviceRemoved',
                    () => this._scheduleRefresh());
                this._registry.addProxySignal(this._proxy, removedId);

                this._store.setDaemonRunning(true);
                this._snapshotImmediate();
                this.emit('ready');
            },
        );
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
