// src/device-store.js
//
// In-memory device snapshot + headline derivation. Pure data — no D-Bus,
// no UI, no parsing here. The DBusClient mutates this store; the
// USBeeToggle binds its subtitle to store.subhead via 'changed'.
//
// Plan 02 Task 1: replaced the Plan-01 stub subhead getter with the full
// 4-tier D-09 headline algorithm (RESEARCH.md §Headline Derivation Algorithm).
// Four pure-function helpers added: parseWatts, parseDirection,
// parseLinkSpeed, formatWatts. Public surface is unchanged from Plan 01.

import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// DeviceEntry tuple from ListDevices: a(ssssssasi)
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

// Regex helpers for parsing daemon-supplied bullet strings.
// Anchored token matchers — no nested quantifiers, no ReDoS risk
// (RESEARCH.md §Threat T-02-02 / STRIDE threat register).
const WATT_RE        = /(\d+(?:\.\d+)?)\s*W\b/i;
const DIRECTION_RE   = /\b(sink|source)\b/i;
const USB_VERSION_RE = /\b(USB\s+\d+(?:\.\d+)?(?:\s+Gen\s+\d+(?:x\d+)?)?)/i;
const SPEED_RE       = /(\d+(?:\.\d+)?)\s*(Gb|Mb|Kb)\/s/i;

/**
 * Scan bullets for a wattage value (e.g. "65 W", "9.5W").
 * Returns the numeric value, or 0 if not found.
 * @param {string[]} bullets
 * @returns {number}
 */
function parseWatts(bullets) {
    for (const b of bullets || []) {
        const m = WATT_RE.exec(b);
        if (m) return parseFloat(m[1]);
    }
    return 0;
}

/**
 * Scan bullets for a power direction ("sink" = laptop charging,
 * "source" = laptop powering device). Case-insensitive.
 * Returns 'sink', 'source', or null if not found.
 * @param {string[]} bullets
 * @returns {'sink'|'source'|null}
 */
function parseDirection(bullets) {
    for (const b of bullets || []) {
        const m = DIRECTION_RE.exec(b);
        if (m) return m[1].toLowerCase();
    }
    return null;
}

/**
 * Scan bullets for USB version label and numeric link speed.
 * Both fields must be present for Tier 2 to activate — partial matches
 * fall through to Tier 3 (RESEARCH.md §Headline Derivation edge cases).
 * @param {string[]} bullets
 * @returns {{bps: number, usbVersionLabel: string, humanRate: string}}
 */
function parseLinkSpeed(bullets) {
    let usbVersionLabel = '';
    let humanRate = '';
    let bps = 0;
    for (const b of bullets || []) {
        if (!usbVersionLabel) {
            const v = USB_VERSION_RE.exec(b);
            if (v) usbVersionLabel = v[1].replace(/\s+/g, ' ');
        }
        if (!humanRate) {
            const s = SPEED_RE.exec(b);
            if (s) {
                const n = parseFloat(s[1]);
                const unit = s[2].toLowerCase();
                humanRate = `${s[1]} ${s[2]}/s`;
                bps = unit === 'gb' ? n * 1e9 : unit === 'mb' ? n * 1e6 : n * 1e3;
            }
        }
        if (usbVersionLabel && humanRate) break;
    }
    return {bps, usbVersionLabel, humanRate};
}

/**
 * Format a wattage for display.
 * >= 10 W → integer ("65 W"); < 10 W → one decimal ("9.5 W").
 * @param {number} w
 * @returns {string}
 */
function formatWatts(w) {
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
    // --- Tier 1: Active USB-C charging port ---
    const ports = devices.filter(d =>
        d.category === 'TypeCPort' && d.status === 'Charging');
    if (ports.length > 0) {
        const ranked = ports
            .map(p => ({
                port:      p,
                watts:     parseWatts(p.bullets),
                direction: parseDirection(p.bullets),
            }))
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

    // --- Tier 2: Fastest attached link with parseable version + speed ---
    const withSpeed = devices
        .map(d => ({device: d, speed: parseLinkSpeed(d.bullets)}))
        .filter(x => x.speed.bps > 0 && x.speed.usbVersionLabel && x.speed.humanRate);
    if (withSpeed.length > 0) {
        withSpeed.sort((a, b) => b.speed.bps - a.speed.bps
                              || a.device.id.localeCompare(b.device.id));
        const top = withSpeed[0];
        // U+00B7 middle dot — NOT a hyphen-minus (UI-SPEC #copywriting Tier 2)
        return `${top.speed.usbVersionLabel} · ${top.speed.humanRate}`;
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
     * @param {Array} rawEntries  Unpacked a(ssssssasi) tuples from ListDevicesAsync.
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
