// src/device-store.js
//
// In-memory device snapshot + headline derivation. Pure data — no D-Bus,
// no UI, no parsing here. The DBusClient mutates this store; the
// USBeeToggle binds its subtitle to store.subhead via 'changed'.
//
// Plan 01 hardcodes a minimal subhead getter. Plan 02 Task 1 replaces
// the body with the full 4-tier D-09 algorithm
// (RESEARCH.md §Headline Derivation Algorithm).

import GObject from 'gi://GObject';

// DeviceEntry tuple from ListDevices: a(sssssasi)
// → [id, category, status, headline, subtitle, icon, bullets[], port_number]
// Field shapes verified against ../usbeehive/src/dbus.rs (RESEARCH.md
// §Daemon Wire Shape).
function unpackDeviceEntry(tuple) {
    return {
        id:          tuple[0],
        category:    tuple[1],
        status:      tuple[2],
        headline:    tuple[3],
        subtitle:    tuple[4],
        icon:        tuple[5],
        bullets:     tuple[6],
        port_number: tuple[7],
    };
}

export const DeviceStore = GObject.registerClass({
    Signals: {'changed': {}},
}, class DeviceStore extends GObject.Object {
    constructor() {
        super();
        this._devices = [];
        this._daemonRunning = false;
    }

    get devices()        { return this._devices; }
    get daemonRunning()  { return this._daemonRunning; }

    /**
     * Plan 01 hardcodes subhead. Plan 02 Task 1 replaces the body with the
     * 4-tier headline derivation from CONTEXT.md D-09 / RESEARCH.md §Headline
     * Derivation Algorithm.
     */
    get subhead() {
        if (!this._daemonRunning) return 'Daemon not running';
        if (this._devices.length === 0) return 'Nothing connected';
        return this._devices.length === 1 ? '1 device' : `${this._devices.length} devices`;
    }

    /**
     * Replace the device list wholesale (D-08 full re-snapshot strategy).
     * @param {Array} rawEntries  Unpacked a(sssssasi) tuples from ListDevicesAsync.
     */
    setDevices(rawEntries) {
        this._devices = (rawEntries || []).map(unpackDeviceEntry);
        this.emit('changed');
    }

    setDaemonRunning(running) {
        if (this._daemonRunning === running) return;
        this._daemonRunning = running;
        this.emit('changed');
    }
});
