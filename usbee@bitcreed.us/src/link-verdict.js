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

// THE OTHER RULE THAT MATTERS: `port.peer_id` is NOT a fact about this
// receptacle, so nothing USBee says may depend on which port it names.
//
// The kernel builds that link in `find_and_link_peer()`. When a root port's
// ACPI `_PLD`-derived `location` is non-zero it matches on exact location
// equality, first index match wins; when it is zero it falls back to plain
// same-index matching. Which of the two produced a given `peer` is logged at
// `pr_debug` level only — sysfs records neither the mechanism nor the
// `location` the daemon would need to reconstruct it, and usbeehive 0.12.0
// does not read `location` at all.
//
// Firmware gets this wrong in the field. On the project's reference machine
// the sole USB-C receptacle is wired D+/D- to `usb5-port2` and its
// SuperSpeed lanes to `usb6-port1`, while `_PLD` reports a confident,
// internally consistent and completely wrong 1:1 index map
// (`usb5-port2 <-> usb6-port2`). A perfectly healthy USB 3 hub on that
// socket lands its SuperSpeed half on `6-1`, leaving the claimed companion
// `usb6-port2` reading `not attached` — which is how 2.7.0 came to call a
// hub running at 5 Gb/s a "USB 2-only cable". Duplicate and zero
// `location` values are live on this board's other controllers too.
//
// So `port.peer_state` is used for one thing only: its PRESENCE says the
// daemon saw a port object with some companion, which keeps the hint off
// devices that have no connector story at all. Its VALUE selects nothing.
// The hint below therefore states only what USBee can actually see — this
// device's own capability and its own negotiated rate — and names no
// socket and no single cause.
//
// Re-opening the specific claims needs the daemon to publish pairing
// provenance and confidence (and root-port state, or a pre-computed
// controller-level verdict); until then this is the one gate to change.
//
// Unlisted values (the kernel may add more) yield no hint at all.
const PEER_STATES_KNOWN = new Set([
    'not attached', 'powered', 'reconnecting',
    'configured', 'suspended', 'addressed', 'default',
]);

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
 * Is this device physically built into the machine — soldered down, or
 * otherwise not removable by the user?
 *
 * The daemon answers this directly and USBee does not infer it. usbeehive
 * emits the `mount` property from the kernel's sysfs `removable` attribute,
 * and only ever as the literal token `fixed` or `removable` — the match arm
 * that builds it drops `unknown` and the empty string rather than
 * forwarding them (usbeehive src/summary.rs, src/usb.rs). So an ABSENT
 * `mount` means "the kernel did not say", which is emphatically not "built
 * in": treating absence as built-in would hide arbitrary hotplugged devices
 * on any machine whose sysfs is quiet. Only a positive `fixed` counts.
 *
 * Type-C port rows carry no `mount` at all — the property is derived from a
 * USB device's sysfs node, not from a port — so this is always false for
 * them, and the `hide-builtin-devices` filter composes cleanly with
 * `hide-empty-ports` (which targets exactly those port rows) instead of
 * overlapping it.
 *
 * @param {object} device  Device record from src/device-store.js.
 * @returns {boolean}  True only when the daemon positively reported `fixed`.
 */
export function isBuiltInDevice(device) {
    return propsOf(device).get('mount') === 'fixed';
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
 *   bosSuppressed: boolean, isWarning: boolean, showCapability: boolean,
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
        // Canonicalised `bcdUSB`. Kept on the token for completeness but no
        // longer rendered beside the rate — "2.1" (from bcdUSB 2.10, which
        // only declares a BOS descriptor) names no real USB specification.
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
        showCapability: false,
        peerState:     props.get('port.peer_state') || '',
        connectorHint: null,
    };
    info.showCapability = deriveShowCapability(info);
    info.connectorHint = deriveConnectorHint(info);
    return info;
}

/**
 * Should the popover render a separate Capability row beside the Link row?
 *
 * The row states ONE thing: the speed this device's own BOS descriptor says
 * it can do. That is a fact about the silicon, defensible with no topology
 * knowledge whatsoever — which is exactly why it is the only half of the old
 * run-on Link copy that survives. The other half ("could run at X on a
 * faster port") was a REMEDY, and USBee cannot back one: the reference
 * device is an RTL8153 capped by a USB-2.0-only GL850 hub inside a monitor,
 * where no port on the machine would help. Same discipline as the withdrawn
 * `ss-never-linked` / `ss-unstable` / `ss-elsewhere` hints — see the
 * `PEER_STATES_KNOWN` commentary above. Naming a culprit needs the daemon to
 * publish an upstream-chain verdict; until then the row stops at the fact.
 *
 * Suppression: a Capability row that repeats the Link row is noise, so it
 * renders only when capability EXCEEDS the negotiated rate.
 *   - no capability label → nothing to print;
 *   - numeric twin present → it decides, and it must be strictly greater;
 *   - numeric twin absent → fall back to the daemon's own verdict, both of
 *     whose "below" values mean capable > negotiated (BOS spec §6). An
 *     `AtCapability` or unrecognised verdict says nothing.
 *
 * @param {object} info  Partially-built deriveLinkInfo result.
 * @returns {boolean}
 */
function deriveShowCapability(info) {
    if (info.capableText === '') return false;
    if (info.capableMbps !== null)
        return info.capableMbps > info.negotiatedMbps;
    return info.verdict === 'BelowCapability' || info.verdict === 'Degraded';
}

/**
 * The connector explanation, per BOS spec §6 × TRIM spec §6 — reduced to
 * what the wire can actually support.
 *
 * Returns one of:
 *   'ss-cause-unknown' — this device advertises SuperSpeed and linked at
 *                        High Speed or below. SuperSpeed did not come up
 *                        on ITS link. The cause is somewhere on the path
 *                        (cable, port, or an intervening hub) and USBee
 *                        cannot tell which.
 *   null               — say nothing.
 *
 * Everything this token asserts is read off the device itself: its own BOS
 * capability, its own negotiated rate, and the daemon's own verdict. It
 * deliberately makes NO claim about the companion port — see the
 * `PEER_STATES_KNOWN` commentary above for why the kernel's `peer` cannot
 * carry one.
 *
 * Guard rails, all of which mean "say nothing":
 *   - no BOS verdict at all → capability is unknown, so a slow link is
 *     just a fact, not evidence of anything (spec §6 row 4);
 *   - `AtCapability` → the link is already as fast as the device gets;
 *   - no companion port (the key is absent) → the daemon saw no connector
 *     object worth talking about (§6 row 3);
 *   - an unrecognised kernel peer state → a state this build does not
 *     understand is not a foundation to speak from (TRIM spec §3.5);
 *   - the device is not SuperSpeed-capable, or did not land at High Speed
 *     or below → the SuperSpeed lanes are not the story.
 *
 * @param {object} info  Partially-built deriveLinkInfo result.
 * @returns {?string}
 */
function deriveConnectorHint(info) {
    if (info.verdict !== 'BelowCapability' && info.verdict !== 'Degraded')
        return null;
    if (!PEER_STATES_KNOWN.has(info.peerState)) return null;
    if (info.capableMbps === null || info.capableMbps < SUPERSPEED_MBPS)
        return null;
    if (info.negotiatedMbps <= 0 || info.negotiatedMbps > HIGHSPEED_MBPS)
        return null;

    return 'ss-cause-unknown';
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
 * combination worth stating unprompted is `Unsuccessful` together with a
 * `no_usb_pd` failure reason — the daemon has NAMED the cause, so this is
 * the rare case where USBee can say why without inferring topology.
 * `NotAttempted` is very often just a device on a USB-A-to-C cable and must
 * read as a quiet fact, never a fault.
 *
 * `actionable` is a row selector, not a promise that the reader has a fix
 * available: it means "this one earns an always-visible row". The row it
 * selects states the condition and stops (quick task 260910-p91) — a
 * machine with no PD controller cannot act on a PD instruction at all. The
 * name is kept because tests/forward-compat.test.js pins it.
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
