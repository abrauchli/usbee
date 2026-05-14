// SPDX-License-Identifier: GPL-3.0-or-later
// src/device-store.js
//
// In-memory device snapshot + tile-subtitle derivation. Pure data — no
// D-Bus, no UI here. The DBusClient mutates this store; the USBeeToggle
// binds its subtitle to store.subhead via 'changed'.
//
// As of Plan 04-02 (v2.0) this module consumes the org.usbeehive.Devices2
// wire — a 19-field structured DeviceEntry tuple. The bullet-prose parsing
// helpers the v1.x device-store maintained (wattage scan, direction scan,
// link-speed scan, diagnostic-phrase scan) are deleted: every fact the
// daemon used to encode in bullet strings is now a named field on the
// DeviceEntry. `formatWatts` is preserved because it is pure UI formatting
// (mW → human display) the daemon does not perform on its side.

import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// DeviceEntry tuple from ListDevices on org.usbeehive.Devices2:
//   a(ssssssssssqqsa(ss)ius(uus)(bsssb))
// 19 fields in declaration order — see CONTEXT D-2.0-02 / Plan 04-02
// <interfaces> block / ../usbeehive/src/dbus.rs:108-260.
//
// The nested (uus) and (bsssb) tuples are unpacked into named inner
// objects so every consumer reads structured fields (WIRE-02 acceptance:
// no downstream consumer indexes by tuple position).
function unpackDeviceEntry(tuple) {
    const power = tuple[17] || [0, 0, ''];
    const diag  = tuple[18] || [false, '', '', '', false];
    return {
        id:              tuple[0],
        category:        tuple[1],
        device_class:    tuple[2],
        device_subclass: tuple[3],
        status:          tuple[4],
        headline:        tuple[5],
        subtitle:        tuple[6],
        icon:            tuple[7],
        vendor:          tuple[8],
        product:         tuple[9],
        vendor_id:       tuple[10],
        product_id:      tuple[11],
        primary_driver:  tuple[12],
        properties:      tuple[13] || [],
        port_number:     tuple[14],
        link_speed_mbps: tuple[15],
        usb_version:     tuple[16],
        power: {
            power_in_mw:  power[0],
            power_out_mw: power[1],
            power_role:   power[2],
        },
        charging_diag: {
            present:    diag[0],
            bottleneck: diag[1],
            summary:    diag[2],
            detail:     diag[3],
            is_warning: diag[4],
        },
    };
}

/**
 * Format a wattage for display.
 * >= 10 W → integer ("65 W"); < 10 W → one decimal ("9.5 W").
 * Non-finite or negative inputs render as the gettext em-dash placeholder
 * (WR-05: defends against malformed daemon emissions like "e10 W" which
 * parseFloat returns as NaN, or unit-conversion bugs producing Infinity).
 * @param {number} w
 * @returns {string}
 */
function formatWatts(w) {
    if (!Number.isFinite(w) || w < 0) return _('—');
    return w >= 10 ? `${Math.round(w)} W` : `${w.toFixed(1)} W`;
}

/**
 * Derive the tile subtitle from the current device list.
 * Implements CONTEXT.md D-09 / UI-SPEC #copywriting Tier 1-4:
 *
 *   Tier 1 — Active USB-C charging port → wattage + direction
 *   Tier 2 — Fastest attached link with parseable USB version + speed
 *   Tier 3 — Anything attached (count)
 *   Tier 4 — Nothing connected
 *
 * Exported so plan-level automated gates can verify its presence.
 * @param {object[]} devices  Unpacked DeviceEntry objects from the store.
 * @returns {string}
 */
export function deriveSubtitle(devices) {
    // --- Tier 1: Active USB-C charging-or-sourcing port ---
    // DISP-03 / UX-3: Sourcing widens the Tier-1 filter but does NOT
    // trigger issue-first sort (hasIssue stays keyed off charging_diag).
    // Field sources (CONTEXT D-2.0-02): power.power_in_mw > 0 iff actively
    // sinking; power.power_out_mw > 0 iff actively sourcing.
    const ports = devices.filter(d =>
        d.category === 'TypeCPort' &&
        (d.status === 'Charging' || d.status === 'Sourcing'));
    if (ports.length > 0) {
        const ranked = ports
            .map(p => {
                const role = p.power?.power_role;
                const inMw  = p.power?.power_in_mw  || 0;
                const outMw = p.power?.power_out_mw || 0;
                // Direction: forward-compat — unknown power_role values
                // (WIRE-04 / D-2.0-06) collapse to null, falling through
                // to the unknown-direction branch below.
                let direction = null;
                if (role === 'Sink')   direction = 'sink';
                if (role === 'Source') direction = 'source';
                // Wattage: prefer the side that matches the role; if the
                // role itself is unknown, take whichever leg of the (uus)
                // tuple is non-zero (the daemon's invariant guarantees at
                // most one of in/out is non-zero at a time).
                const wattsMw = direction === 'source'
                    ? outMw
                    : direction === 'sink'
                        ? inMw
                        : Math.max(inMw, outMw);
                return {
                    port:      p,
                    watts:     wattsMw / 1000,
                    direction,
                };
            })
            .sort((a, b) => b.watts - a.watts
                         || a.port.port_number - b.port.port_number);
        const top = ranked[0];
        if (top.direction === 'sink')
            return _('Charging: %s in').format(formatWatts(top.watts));
        if (top.direction === 'source')
            return _('Powering: %s out').format(formatWatts(top.watts));
        // Unknown direction — still Tier 1 (charging port is user's focus)
        return top.watts > 0
            ? _('USB-C: %s').format(formatWatts(top.watts))
            : _('USB-C: charging');
    }

    // --- Tier 2: Fastest attached link with structured speed + version ---
    // Both link_speed_mbps and usb_version must be present for Tier 2 to
    // activate — partial reads fall through to Tier 3. WIRE-04 forward-
    // compat: a future canonical usb_version string the renderer doesn't
    // know is still rendered verbatim with the 'USB ' prefix.
    const withSpeed = devices.filter(d =>
        d.link_speed_mbps > 0 && d.usb_version);
    if (withSpeed.length > 0) {
        withSpeed.sort((a, b) => b.link_speed_mbps - a.link_speed_mbps
                              || a.id.localeCompare(b.id));
        const top = withSpeed[0];
        const label = `USB ${top.usb_version}`;
        const mbps  = top.link_speed_mbps;
        // Daemon emits raw Mbit/s; render the human form here (USBee owns
        // the UI side of the unit conversion).
        let humanRate;
        if (mbps >= 10000) humanRate = `${Math.round(mbps / 1000)} Gb/s`;
        else if (mbps >= 1000) humanRate = `${(mbps / 1000).toFixed(1)} Gb/s`;
        else humanRate = `${mbps} Mb/s`;
        // U+00B7 middle dot — NOT a hyphen-minus (UI-SPEC #copywriting Tier 2)
        return `${label} · ${humanRate}`;
    }

    // --- Tier 3: Any attached device (no parseable speed) ---
    const attached = devices.filter(d => d.status !== 'Empty');
    if (attached.length > 0) {
        return attached.length === 1
            ? _('1 device')
            : _('%d devices').format(attached.length);
    }

    // --- Tier 4: Nothing connected ---
    return _('Nothing connected');
}

/**
 * UI-03 predicate: true iff this device should sort to the top of the popover.
 *
 * As of Plan 04-02 (CLEAN-02 / UX-3), this collapses to a one-liner on
 * the structured `charging_diag` field. Sourcing entries fall through
 * naturally because `charging_diag.present === false` for a healthy
 * sourcing port (CONTEXT D-2.0-03). See `.planning/phases/04-…/04-01-
 * UX-DECISIONS.md` §UX-3 for the locked decision.
 *
 * @param {object} device  Unpacked DeviceEntry from the store.
 * @returns {boolean}
 */
export function hasIssue(device) {
    return device.charging_diag?.present === true
        && device.charging_diag?.is_warning === true;
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
     * Full D-09 tile subtitle. Returns 'Daemon not running' when the
     * daemon is off the bus (UI-SPEC #copywriting Tile/empty state).
     * Delegates to deriveSubtitle() for the 4-tier algorithm.
     */
    get subhead() {
        if (!this._daemonRunning) return _('Daemon not running');
        return deriveSubtitle(this._devices);
    }

    /**
     * Replace the device list wholesale (D-08 full re-snapshot strategy).
     * @param {Array} rawEntries  19-field DeviceEntry tuples from
     *   ListDevicesRemote (signature a(ssssssssssqqsa(ss)ius(uus)(bsssb))).
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
