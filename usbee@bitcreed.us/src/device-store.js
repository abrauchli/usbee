// SPDX-License-Identifier: GPL-3.0-or-later
// src/device-store.js
//
// In-memory device snapshot + tile-subtitle derivation. Pure data — no
// D-Bus, no UI here. The DBusClient mutates this store; the USBeeToggle
// binds its subtitle to store.subhead via 'changed'.
//
// As of v2.4 this module consumes the org.usbeehive.Devices5 wire — a
// 21-field structured DeviceEntry tuple whose nested power tuple is
// (uuus): (power_in_mw, power_out_mw, contract_mw, power_role). All PD
// wattages on the wire are negotiated ceilings, never measured flow —
// power_in_mw is what the sink *requested* (RDO operating power),
// contract_mw what the active contract *allows* (0 = unknown). The
// bullet-prose parsing helpers the v1.x device-store maintained (wattage
// scan, direction scan, link-speed scan, diagnostic-phrase scan) are deleted:
// every fact the daemon used to encode in bullet strings is now a named
// field on the DeviceEntry. `formatWatts` is preserved because it is pure
// UI formatting (mW → human display) the daemon does not perform on its
// side; `formatVolts` and `formatAmps` join it for the structured PDO
// renderer (quick task 260526-dmj Task 3).

import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {DaemonState, isAwaitingFirstSnapshot} from './daemon-status.js';
import {deriveCapabilityTile, formatRate, hasLinkIssue,
    verdictTileStyleClass} from './link-verdict.js';

// DeviceEntry tuple from ListDevices on org.usbeehive.Devices5:
//   a(ssssssssssqqsa(ss)ius(uuus)(bsssb)a(usuuuub)i)
// 21 fields in declaration order — see ../usbeehive/src/dbus.rs module
// docs ("ListDevices element shape" table).
//
// The nested (uuus), (bsssb), and per-PDO (usuuuub) tuples are unpacked
// into named inner objects so every consumer reads structured fields
// (WIRE-02 acceptance: no downstream consumer indexes by tuple position).
function unpackDeviceEntry(tuple) {
    const power = tuple[17] || [0, 0, 0, ''];
    const diag  = tuple[18] || [false, '', '', '', false];
    const rawPdos = tuple[19] || [];
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
            contract_mw:  power[2],
            power_role:   power[3],
        },
        charging_diag: {
            present:    diag[0],
            bottleneck: diag[1],
            summary:    diag[2],
            detail:     diag[3],
            is_warning: diag[4],
        },
        pdo_list: rawPdos.map(p => ({
            index:          p[0],
            kind:           p[1],
            voltage_mv:     p[2],
            max_voltage_mv: p[3],
            current_ma:     p[4],
            power_mw:       p[5],
            is_active:      p[6],
        })),
        active_pdo_index: tuple[20] ?? -1,
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
export function formatWatts(w) {
    if (!Number.isFinite(w) || w < 0) return _('—');
    return w >= 10 ? `${Math.round(w)} W` : `${w.toFixed(1)} W`;
}

/**
 * Format a millivolt count for display.
 * Whole-volt values drop the decimal ("5 V"); fractional values keep one
 * decimal ("5.5 V"). Non-finite or negative inputs render as the gettext
 * em-dash placeholder (mirrors formatWatts WR-05 defensive guard).
 * @param {number} mv  Millivolts (e.g. 5000 → "5 V").
 * @returns {string}
 */
export function formatVolts(mv) {
    if (!Number.isFinite(mv) || mv < 0) return _('—');
    return mv % 1000 === 0
        ? `${mv / 1000} V`
        : `${(mv / 1000).toFixed(1)} V`;
}

/**
 * Format a milliamp count for display.
 * Whole-amp values drop the decimal ("3 A"); fractional values keep one
 * decimal ("1.5 A"). Non-finite or negative inputs render as the gettext
 * em-dash placeholder (mirrors formatWatts WR-05 defensive guard).
 * @param {number} ma  Milliamps (e.g. 3000 → "3 A").
 * @returns {string}
 */
export function formatAmps(ma) {
    if (!Number.isFinite(ma) || ma < 0) return _('—');
    return ma % 1000 === 0
        ? `${ma / 1000} A`
        : `${(ma / 1000).toFixed(1)} A`;
}

/**
 * Derive the tile title + subtitle (two-line pill) from the current device list.
 * Implements CONTEXT.md D-09 / UI-SPEC #copywriting Tier 1-4 in the post-04-02
 * polish shape where the top line carries the *kind* of fact ("Charging",
 * "USB 5Gbps", …) and the bottom line carries the *value* ("65 W",
 * "linked at 480 Mb/s", …).
 *
 *   Tier 0 — Something is wrong (quick task 260905-b0s §D-5)
 *   Tier 1 — Active USB-C charging/sourcing port → direction word + wattage
 *   Tier 2 — Best attached link CAPABILITY brand, qualified by whether it is
 *            actually being reached (quick task 260917-hkf)
 *   Tier 3 — Anything attached (count)
 *   Tier 4 — Nothing connected
 *
 * @param {object[]} devices  Unpacked DeviceEntry objects from the store.
 * @returns {{title: string, subtitle: string}}
 */
export function deriveTileText(devices) {
    // --- Tier 0: an issue outranks every healthy fact ---
    // Before this tier existed, a port charging at 30 W through a limiting
    // cable rendered exactly like a healthy 30 W charge: the warning lived
    // only in a dismissable toast and in an amber border nobody sees until
    // they open the popover. The tile is the only always-visible surface.
    //
    // Charging outranks data rate because it is the more common laptop pain
    // and was already Tier 1. Only a Degraded data rate qualifies — never
    // BelowCapability, which is informational (BOS spec §6).
    const chargingIssue = devices.find(d => d.charging_diag?.present === true
        && d.charging_diag?.is_warning === true);
    if (chargingIssue) {
        const watts = Math.max(
            chargingIssue.power?.power_in_mw  || 0,
            chargingIssue.power?.power_out_mw || 0) / 1000;
        return watts > 0
            ? {
                title: _('Charging'),
                // Translators: Tile subtitle when a port is charging but
                // something (cable, charger, port) is capping it. %s is a
                // formatted wattage like "30 W".
                subtitle: _('%s — limited').format(formatWatts(watts)),
            }
            : {title: _('USB'), subtitle: _('Charging issue')};
    }
    const linkIssue = devices.find(hasLinkIssue);
    if (linkIssue) {
        return {
            title: _('Slow USB link'),
            subtitle: linkIssue.headline || linkIssue.id || '',
        };
    }

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
                // role itself is unknown, take whichever leg of the (uuus)
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
                    // Devices5: contract_mw > power_in_mw means the sink is
                    // requesting less than the negotiated contract allows
                    // (e.g. a battery charge limit) — the wattage is then a
                    // self-imposed ceiling worth flagging as "up to".
                    sinkLimited: direction === 'sink'
                        && (p.power?.contract_mw || 0) > inMw,
                };
            })
            .sort((a, b) => b.watts - a.watts
                         || a.port.port_number - b.port.port_number);
        const top = ranked[0];
        if (top.direction === 'sink') {
            return {
                title: _('Charging'),
                subtitle: top.sinkLimited
                    // Translators: Tile subtitle when the sink requests less
                    // than its PD contract allows (e.g. a battery charge
                    // limit); %s is a formatted wattage like "15 W".
                    ? _('up to %s').format(formatWatts(top.watts))
                    : formatWatts(top.watts),
            };
        }
        if (top.direction === 'source')
            return {title: _('Powering'), subtitle: formatWatts(top.watts)};
        // Unknown direction — still Tier 1 (charging port is user's focus)
        return {
            title: _('USB-C'),
            subtitle: top.watts > 0 ? formatWatts(top.watts) : _('charging'),
        };
    }

    // --- Tier 2: Maximum link capability, qualified by what it is reaching ---
    // The ranking, the brand and the subtitle CHOICE all live in
    // link-verdict.js (deriveCapabilityTile) — that module imports nothing,
    // so it loads under bare gjs and is really unit-tested in CI, whereas
    // this one imports gnome-shell's extension resource for gettext and can
    // only be guarded at source level. This tier is therefore a pure gettext
    // mapping over the helper's tokens and must not re-derive any of them.
    //
    // The title used to interpolate the canonicalised bcdUSB descriptor
    // version the daemon publishes. That is neither a capability nor a
    // speed, and its commonest value names no real USB specification, so the
    // popover withdrew it (quick task 260910-n10) and this tier — its last
    // render site anywhere in the UI — now names the capability instead.
    const cap = deriveCapabilityTile(devices);
    if (cap !== null) {
        let subtitle;
        if (cap.subtitleKind === 'full') {
            // Translators: Tile subtitle when the fastest attached device is
            // running at the full speed it is capable of.
            subtitle = _('full capability');
        } else if (cap.subtitleKind === 'unlinked') {
            // Translators: Tile subtitle when a device's capability is known
            // but it has negotiated no link at all.
            subtitle = _('not linked');
        } else {
            // Translators: Tile subtitle when the fastest attached device is
            // running BELOW what it is capable of — it can go faster. %s is a
            // formatted measured rate like "480 Mb/s".
            //
            // Daemon emits raw Mbit/s; formatRate owns the UI side of the
            // unit conversion and is shared with the per-device rows in the
            // popover (quick task 260905-b0s) so the tile and the rows cannot
            // disagree.
            subtitle = _('linked at %s').format(formatRate(cap.negotiatedMbps));
        }
        return {
            // Translators: Tile title naming the best link capability
            // attached. %s is an untranslated technical rate brand in USB-IF
            // form, like "5Gbps" or "480Mbps".
            title: _('USB %s').format(cap.brand),
            subtitle,
            // The subtitle's verdict colour (quick task 260917-i43). Keyed on
            // the WINNER's own usb_link_verdict and on nothing else — NOT on
            // `subtitleKind` right above, which is derived from capable-vs-
            // negotiated and would be the synthesised verdict BOS spec §6
            // forbids. '' whenever the daemon asserted no verdict, which is
            // the common case. This tier stays a pure mapping: the recognised
            // set and the class name both belong to link-verdict.js.
            verdictClass: verdictTileStyleClass(cap.verdict),
        };
    }

    // --- Tier 3: Any attached device (no parseable speed) ---
    const attached = devices.filter(d => d.status !== 'Empty');
    if (attached.length > 0) {
        return {
            title:    _('USB'),
            subtitle: attached.length === 1
                ? _('1 device')
                : _('%d devices').format(attached.length),
        };
    }

    // --- Tier 4: Nothing connected ---
    return {title: _('USB'), subtitle: _('Nothing connected')};
}

/**
 * Back-compat string form of the tile subtitle. Preserved so the WIRE-04
 * forward-compat regression test (forward-compat.test.js) keeps its
 * unchanged "doesNotThrow" contract.
 *
 * @param {object[]} devices  Unpacked DeviceEntry objects from the store.
 * @returns {string}
 */
export function deriveSubtitle(devices) {
    return deriveTileText(devices).subtitle;
}

/**
 * UI-03 predicate: true iff this device should sort to the top of the popover.
 *
 * Two independent sources, both daemon-asserted:
 *
 *   - the structured `charging_diag` field (Plan 04-02 / CLEAN-02 / UX-3;
 *     see `.planning/phases/04-…/04-01-UX-DECISIONS.md` §UX-3). Sourcing
 *     entries fall through naturally because `charging_diag.present` is
 *     false for a healthy sourcing port (CONTEXT D-2.0-03);
 *   - the data-rate verdict and hub power budget (quick task 260905-b0s),
 *     via hasLinkIssue(). ONLY `usb_link_verdict == "Degraded"` qualifies —
 *     `BelowCapability` is informational and must never sort up or draw a
 *     badge (BOS spec §6).
 *
 * @param {object} device  Unpacked DeviceEntry from the store.
 * @returns {boolean}
 */
export function hasIssue(device) {
    if (device.charging_diag?.present === true
        && device.charging_diag?.is_warning === true)
        return true;
    return hasLinkIssue(device);
}

export const DeviceStore = GObject.registerClass({
    Signals: {'changed': {}},
}, class DeviceStore extends GObject.Object {
    constructor() {
        super();
        this._devices = [];
        // Single source of truth for daemon lifecycle. Both the tile pill
        // (tileText below) and the popover routing (tile.js _rebuildPopover)
        // read this one field, so they cannot disagree — the bug quick task
        // 260821-ke2 fixed, where the pill said "Daemon not running" while
        // the expanded popover said "daemon out of date".
        this._daemonState = DaemonState.STOPPED;
        // Version string the daemon reported when it failed the gate.
        // Empty when unknown / not applicable.
        this._daemonVersion = '';
        // Has a device snapshot landed since the last daemon lifecycle
        // transition? Distinguishes "the daemon has not answered yet" from
        // "the daemon answered, and the answer was nothing" — see
        // isAwaitingFirstSnapshot (quick task 260915-ung).
        this._snapshotReceived = false;
    }

    get devices()        { return this._devices; }
    get daemonState()    { return this._daemonState; }
    get daemonVersion()  { return this._daemonVersion; }

    /**
     * Derived boolean kept for the many call sites that only care whether
     * devices can be listed (tile `checked`, DBusClient guards, tests).
     * OUT_OF_DATE reads as not-running here — no device data is available.
     */
    get daemonRunning()  { return this._daemonState === DaemonState.RUNNING; }

    /**
     * The third, derived state: daemon present, first snapshot not yet in.
     * Both surfaces read it from here, so the pill and the popover cannot
     * disagree about whether the list is empty or merely unmeasured.
     */
    get awaitingFirstSnapshot() {
        return isAwaitingFirstSnapshot(this._daemonState, this._snapshotReceived);
    }

    /**
     * Two-line D-09 tile text {title, subtitle}. Returns a state-specific
     * sentinel when the daemon is unusable (UI-SPEC #copywriting Tile/empty
     * state); otherwise delegates to deriveTileText() for the 4-tier algorithm.
     */
    get tileText() {
        switch (this._daemonState) {
        case DaemonState.RUNNING:
            // Nothing has been counted yet: setDaemonRunning(true) lands one
            // line before the un-awaited _snapshotImmediate() call
            // (src/dbus-client.js), so without this branch deriveTileText
            // falls all the way through to its Tier-4 "Nothing connected" and
            // the pill asserts an absence nobody has measured.
            if (this.awaitingFirstSnapshot)
                return {title: _('USB'), subtitle: _('Loading…')}; // U+2026
            return deriveTileText(this._devices);
        case DaemonState.OUT_OF_DATE:
            return {title: _('USB'), subtitle: _('Daemon out of date')};
        case DaemonState.TOO_NEW:
            // The opposite failure: usbeehive moved to an interface
            // generation this build does not speak. The component that
            // needs updating is USBee (quick task 260905-b0s §D-7).
            return {title: _('USB'), subtitle: _('Extension out of date')};
        default:
            // STOPPED — and any state this build does not know about, which
            // fails closed to the safest copy.
            return {title: _('USB'), subtitle: _('Daemon not running')};
        }
    }

    /**
     * Back-compat one-line subtitle. Same content as tileText.subtitle.
     */
    get subhead() {
        return this.tileText.subtitle;
    }

    /**
     * Replace the device list wholesale (D-08 full re-snapshot strategy).
     * @param {Array} rawEntries  21-field DeviceEntry tuples from
     *   ListDevicesRemote on org.usbeehive.Devices5 (signature
     *   a(ssssssssssqqsa(ss)ius(uuus)(bsssb)a(usuuuub)i)).
     */
    setDevices(rawEntries) {
        this._devices = (rawEntries || []).map(unpackDeviceEntry);
        // The only place the awaiting state is concluded by real data. An
        // empty rawEntries here is a measured zero and renders as "Nothing
        // connected"; an empty _devices with this flag still false is an
        // unmeasured zero and renders as "Loading…".
        this._snapshotReceived = true;
        this.emit('changed');
    }

    /**
     * The ListDevices call failed (src/dbus-client.js `_snapshotImmediate`'s
     * catch). Concludes the awaiting state WITHOUT asserting anything about
     * what is attached: `_devices` is deliberately left untouched, preserving
     * that method's "keep prior store state, let the next signal retry"
     * contract.
     *
     * Without this hand-off the store would sit in awaitingFirstSnapshot
     * indefinitely and both surfaces would read "Loading…" forever — a worse
     * lie than the one the loading state was added to fix (quick task
     * 260915-ung D-02). They instead fall back to exactly the previous
     * behaviour, which is at least honest about having nothing to show.
     *
     * Emits only on the false→true edge, so a daemon failing every retry
     * cannot storm the tile with redundant repaints.
     */
    noteSnapshotFailed() {
        if (this._snapshotReceived) return;
        this._snapshotReceived = true;
        this.emit('changed');
    }

    /**
     * Single write path for the daemon tri-state. No-ops (and stays silent)
     * when neither the state nor the reported version changed, preserving
     * the previous setDaemonRunning idempotency contract.
     *
     * @param {string} state    A DaemonState value.
     * @param {string} version  Reported daemon version ('' when unknown).
     */
    _setDaemonState(state, version) {
        if (this._daemonState === state && this._daemonVersion === version)
            return;
        this._daemonState = state;
        this._daemonVersion = version;
        // Re-arm the loading state on every REAL lifecycle transition. The
        // guard above already swallows no-op re-asserts, so an idempotent
        // setDaemonRunning(true) cannot wrongly re-arm it, while a genuine
        // STOPPED→RUNNING on daemon restart always does — which is what makes
        // the loading state survive a restart with no extra bookkeeping.
        this._snapshotReceived = false;
        this.emit('changed');
    }

    setDaemonRunning(running) {
        this._setDaemonState(
            running ? DaemonState.RUNNING : DaemonState.STOPPED, '');
    }

    /**
     * The daemon is reachable on the bus but its Version failed the gate
     * (COMPAT-02). Records the version so the popover and the prefs About
     * group can state what was detected alongside what is required.
     *
     * @param {string} version  Version the daemon reported ('' if unreadable).
     */
    setDaemonOutOfDate(version) {
        this._setDaemonState(DaemonState.OUT_OF_DATE, version || '');
    }

    /**
     * The daemon is reachable but publishes a HIGHER interface generation
     * than this build consumes — usbeehive moved on and USBee has not
     * (quick task 260905-b0s §D-7). Distinct from OUT_OF_DATE because the
     * component the user must update is the opposite one; telling them to
     * `cargo install usbeehive` here would change nothing.
     */
    setDaemonTooNew() {
        this._setDaemonState(DaemonState.TOO_NEW, '');
    }
});
