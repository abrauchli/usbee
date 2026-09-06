// SPDX-License-Identifier: GPL-3.0-or-later
// src/link-verdict.js
//
// Pure derivation of everything the popover needs to say about a device's
// data rate, its physical connector, its hub occupancy and its hardware-
// database name. Structured in, structured out — NO user-visible strings
// are produced here; src/popover.js turns these tokens into translated
// prose.
//
// THIS MODULE MUST HAVE ZERO IMPORTS — same contract as src/daemon-status.js
// and src/property-policy.js. That is what lets bare-gjs CI unit-test the
// verdict composition, including every "say nothing" case
// (tests/forward-compat.test.js).
//
// Wire contract: ../usbeehive/.planning/specs/DBUS-BOS-CONSUMER-SPEC.md and
// DBUS-TRIM-CONSUMER-SPEC.md, both additive on org.usbeehive.Devices5.
//
// THE RULE THAT MATTERS (BOS spec §6): a warning comes from the daemon's
// own `usb_link_verdict == "Degraded"` and from nothing else. USBee never
// derives one from `usb_capable_speed_mbps > link_speed_mbps` — on the
// daemon's reference machine that comparison fires on 2 of 2 BOS-bearing
// devices, both working exactly as their vendors intend. `BelowCapability`
// is informational; `usb_bos_suppressed` means capability is UNKNOWN, never
// "USB 2 only" (§5.2).

// Verdict values this build understands. BOS spec §3.2 permits the daemon
// to add values without an interface bump, so anything else collapses to
// null and renders neutrally.
const KNOWN_VERDICTS = new Set(['AtCapability', 'BelowCapability', 'Degraded']);

// Kernel `port.peer_state` vocabulary (TRIM spec §3.5), grouped by what it
// means for the SuperSpeed half of a physical receptacle. Unlisted values
// (the kernel may add more) yield no hint at all.
const PEER_NEVER_LINKED = new Set(['not attached']);
const PEER_UNSTABLE     = new Set(['powered', 'reconnecting']);
const PEER_LINKED       = new Set(['configured', 'suspended', 'addressed', 'default']);

// The SuperSpeed floor: a device advertising >= 5 Gbps that negotiated
// <= 480 Mbps is the only shape where a connector's SuperSpeed lanes are a
// plausible explanation.
const SUPERSPEED_MBPS = 5000;
const HIGHSPEED_MBPS  = 480;

/**
 * Build a Map view of a DeviceEntry's `properties: a(ss)` pairs.
 *
 * @param {object} device  Unpacked DeviceEntry from the store.
 * @returns {Map<string,string>}
 */
export function propsOf(device) {
    return new Map(device?.properties || []);
}

/**
 * Format a link rate for display. The daemon emits raw Mbit/s; USBee owns
 * the human form (CONTEXT D-2.0-04).
 *
 * Trailing ".0" is trimmed, so 5000 renders "5 Gb/s" rather than
 * "5.0 Gb/s". Zero, negative and non-finite inputs render as '' — the
 * caller then renders no row rather than "0 Mb/s", because a zero link
 * speed on this wire means "not reported", not "stopped".
 *
 * @param {number} mbps
 * @returns {string}  '' when there is nothing to say.
 */
export function formatRate(mbps) {
    if (!Number.isFinite(mbps) || mbps <= 0) return '';
    if (mbps < 1000) return `${mbps} Mb/s`;
    const gbps = mbps / 1000;
    const text = mbps >= 10000
        ? `${Math.round(gbps)}`
        : `${gbps.toFixed(1)}`.replace(/\.0$/, '');
    return `${text} Gb/s`;
}

/**
 * Parse a daemon integer-in-a-string property. Every numeric value on this
 * wire is a decimal string; absence, emptiness and garbage all collapse to
 * null so callers can distinguish "unknown" from a real 0 (TRIM spec §7.3
 * is explicit that `hub.ports_used == "0"` is a real answer).
 *
 * @param {Map<string,string>} props
 * @param {string} key
 * @returns {?number}
 */
function intProp(props, key) {
    const raw = props.get(key);
    if (typeof raw !== 'string' || raw === '') return null;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) ? n : null;
}

/**
 * Everything the Link row needs, as tokens.
 *
 * All BOS keys are optional; absence is the common case (7 of 11 entries on
 * the daemon's reference machine carry no BOS at all) and is never a
 * problem to report.
 *
 * @param {object} device  Unpacked DeviceEntry from the store.
 * @param {Map<string,string>} [propsMap]  Pre-built props Map (optional).
 * @returns {{
 *   negotiatedMbps: number, rateText: string, usbVersion: string,
 *   verdict: ?string, capableText: string, capableMbps: ?number,
 *   capableGen: string, floorMbps: ?number, floorText: string,
 *   bosSuppressed: boolean, isWarning: boolean,
 *   peerState: string, connectorHint: ?string
 * }}
 */
export function deriveLinkInfo(device, propsMap) {
    const props = propsMap || propsOf(device);

    const negotiatedMbps = Number.isFinite(device?.link_speed_mbps)
        ? device.link_speed_mbps : 0;

    const rawVerdict = props.get('usb_link_verdict');
    const verdict = KNOWN_VERDICTS.has(rawVerdict) ? rawVerdict : null;

    // Belt and braces: the daemon guarantees the flag key is present
    // exactly when the verdict is Degraded (BOS spec §3.1). Honouring
    // either means a future verdict rename still surfaces the warning,
    // while an absent flag with an unknown verdict stays silent.
    const isWarning = verdict === 'Degraded'
        || props.get('usb_link_degraded') === 'true';

    const capableMbps = intProp(props, 'usb_capable_speed_mbps');
    const floorMbps   = intProp(props, 'usb_functional_floor_mbps');

    const info = {
        negotiatedMbps,
        rateText:      formatRate(negotiatedMbps),
        usbVersion:    device?.usb_version || '',
        verdict,
        capableText:   props.get('usb_capable_speed') || '',
        capableMbps,
        capableGen:    props.get('usb_capable_gen') || '',
        floorMbps,
        floorText:     floorMbps === null ? '' : formatRate(floorMbps),
        // §5.2 — the kernel refuses to read this device's BOS. Capability
        // is UNKNOWN. Never a verdict, never a warning.
        bosSuppressed: props.get('usb_bos_suppressed') === 'true',
        isWarning,
        peerState:     props.get('port.peer_state') || '',
        connectorHint: null,
    };
    info.connectorHint = deriveConnectorHint(info);
    return info;
}

/**
 * The `port.peer_state` explanation, per BOS spec §6 × TRIM spec §6.
 *
 * Returns one of:
 *   'ss-never-linked' — the SuperSpeed half of this connector never came
 *                       up: a USB 2-only cable, or a USB-A 2.0 receptacle.
 *   'ss-unstable'     — it is powered / retraining but not configured.
 *   'ss-elsewhere'    — the fast lanes ARE up; this device is not on them.
 *                       Describe, do not instruct (spec's own wording).
 *   null              — say nothing.
 *
 * Guard rails, all of which mean "say nothing":
 *   - no BOS verdict at all → a `not attached` companion is just a fact
 *     about the connector, not evidence of anything (spec §6 row 4);
 *   - `AtCapability` → the link is already as fast as the device gets;
 *   - no companion port (the key is absent) → no evidence (§6 row 3);
 *   - the device is not SuperSpeed-capable, or did not land at High Speed
 *     or below → the SuperSpeed lanes are not the story.
 *
 * @param {object} info  Partially-built deriveLinkInfo result.
 * @returns {?string}
 */
function deriveConnectorHint(info) {
    if (info.verdict !== 'BelowCapability' && info.verdict !== 'Degraded')
        return null;
    if (info.peerState === '') return null;
    if (info.capableMbps === null || info.capableMbps < SUPERSPEED_MBPS)
        return null;
    if (info.negotiatedMbps <= 0 || info.negotiatedMbps > HIGHSPEED_MBPS)
        return null;

    if (PEER_NEVER_LINKED.has(info.peerState)) return 'ss-never-linked';
    if (PEER_UNSTABLE.has(info.peerState))     return 'ss-unstable';
    if (PEER_LINKED.has(info.peerState))       return 'ss-elsewhere';
    // Unrecognised kernel state — new values may appear without an
    // interface bump (TRIM spec §3.5). Render neutrally: say nothing.
    return null;
}

/**
 * Hub occupancy and bus-power budget (TRIM spec §3.1/§3.2).
 *
 * Every field is null when the corresponding key is absent — and absent is
 * NOT the same as zero: `hub.ports_used == "0"` means "this hub has ports
 * and none are occupied", while an absent key means no port object was
 * readable (§7.3).
 *
 * `hub.power_budget_ma` is absent for self-powered hubs (they have no
 * bus-derived ceiling worth quoting), so `overBudget` can only be true when
 * both figures are present.
 *
 * @param {object} device
 * @param {Map<string,string>} [propsMap]
 * @returns {{portsUsed: ?number, portsTotal: ?number, budgetMa: ?number,
 *            committedMa: ?number, overBudget: boolean}}
 */
export function deriveHubInfo(device, propsMap) {
    const props = propsMap || propsOf(device);
    const portsUsed   = intProp(props, 'hub.ports_used');
    const portsTotal  = intProp(props, 'hub.ports_total');
    const budgetMa    = intProp(props, 'hub.power_budget_ma');
    const committedMa = intProp(props, 'hub.power_committed_ma');
    return {
        portsUsed,
        portsTotal,
        budgetMa,
        committedMa,
        overBudget: budgetMa !== null && committedMa !== null
            && committedMa > budgetMa,
    };
}

/**
 * Billboard alt-mode facts (BOS spec §3.3/§7.4).
 *
 * Facts only: there is no warning flag and no signal for alt mode. The one
 * genuinely actionable combination is `Unsuccessful` together with a
 * `no_usb_pd` failure reason — a cable or port that cannot do USB-PD.
 * `NotAttempted` is very often just a device on a USB-A-to-C cable and must
 * read as a quiet fact, never a fault.
 *
 * @param {object} device
 * @param {Map<string,string>} [propsMap]
 * @returns {{svids: string[], state: string, failures: string[],
 *            actionable: boolean}}
 */
export function deriveAltMode(device, propsMap) {
    const props = propsMap || propsOf(device);
    const split = key => (props.get(key) || '')
        .split(',')
        .map(s => s.trim())
        .filter(s => s !== '');
    const state = props.get('usb_altmode_state') || '';
    const failures = split('usb_altmode_failure');
    return {
        svids: split('usb_altmode_svids'),
        state,
        failures,
        actionable: state === 'Unsuccessful' && failures.includes('no_usb_pd'),
    };
}

/**
 * Resolve the row headline, letting the hardware database fill in for a
 * device that publishes no `iProduct` string at all.
 *
 * `product_db` NEVER overrides a real product name (TRIM spec §7.4: it is
 * advisory and can be wrong for re-badged PIDs). It is used only when the
 * positional `product` field is empty — the "8087:0029 / AX200 Bluetooth"
 * case — and is prefixed with the vendor when the database name does not
 * already carry it.
 *
 * @param {object} device
 * @param {Map<string,string>} [propsMap]
 * @returns {string}
 */
export function resolveHeadline(device, propsMap) {
    const fallback = device?.headline || device?.id || '';
    if (device?.product) return fallback;

    const props = propsMap || propsOf(device);
    const dbName = (props.get('product_db') || '').trim();
    if (dbName === '') return fallback;

    const vendor = (device?.vendor || '').trim();
    if (vendor !== '' && !dbName.toLowerCase().startsWith(vendor.toLowerCase()))
        return `${vendor} ${dbName}`;
    return dbName;
}

/**
 * True when a device's *data* story (as opposed to its charging story)
 * warrants the issue treatment: amber border, issue-first sort, tile tier.
 *
 * Only two conditions qualify, both daemon-asserted:
 *   - `usb_link_verdict == "Degraded"` — the actionable wrong-port /
 *     wrong-cable case. `BelowCapability` deliberately does NOT qualify.
 *   - a bus-powered hub whose children's declared draw exceeds its budget.
 *
 * @param {object} device
 * @returns {boolean}
 */
export function hasLinkIssue(device) {
    const props = propsOf(device);
    return deriveLinkInfo(device, props).isWarning
        || deriveHubInfo(device, props).overBudget;
}
