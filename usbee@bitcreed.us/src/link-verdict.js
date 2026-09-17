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
 * Format a link-capability ceiling as USB-IF's rate brand.
 *
 * The bucket edges mirror `link_speed_tier()` in the daemon (usbeehive
 * src/usb.rs:362-375) so the tile and the daemon can never disagree about
 * which tier a given Mbit/s figure belongs to. Two edges diverge from the
 * daemon as it stands today, deliberately:
 *   - the 80 Gbps tier is AHEAD of the daemon, which tops out at its Usb4
 *     bucket (>= 40000). USB4 v2 hardware will report 80000 and must brand
 *     as itself rather than collapse to 40Gbps (WIRE-04: never blank, never
 *     wrong-by-rounding-down more than a tier).
 *   - the low-speed edge here is >= 1, where the daemon uses >= 2. Nothing
 *     in [1, 2) is a real USB rate under either rule, so both resolve the
 *     same brand and the difference is unobservable on real hardware.
 *
 * The typography is closed-up — `5Gbps`, not `5 Gb/s`. That is USB-IF brand
 * form and it is intentionally DIFFERENT from `formatRate()`'s measured form
 * in the sibling function above: the tile title carries a brand (what the
 * hardware IS), the tile subtitle carries a measurement (what it is DOING).
 * Keeping the two forms visibly distinct is what lets the two lines sit
 * together without reading as a contradiction.
 *
 * This is not the daemon's `usb_capable_speed` prose ("SuperSpeed 5 Gbps"),
 * which is English-only, nor `usb_capable_gen`; neither is consulted here.
 *
 * Anything below 1, and any non-finite input, returns '' — the same "nothing
 * to say" convention `formatRate()` sets, so the caller needs no null-check
 * discipline it does not already have.
 *
 * @param {number} mbps  A capability ceiling in Mbit/s.
 * @returns {string}  '' when there is no brand to name.
 */
export function formatCapabilityBrand(mbps) {
    if (!Number.isFinite(mbps)) return '';
    if (mbps >= 80000) return '80Gbps';
    if (mbps >= 40000) return '40Gbps';
    if (mbps >= 20000) return '20Gbps';
    if (mbps >= 10000) return '10Gbps';
    if (mbps >= 5000)  return '5Gbps';
    if (mbps >= 480)   return '480Mbps';
    if (mbps >= 12)    return '12Mbps';
    if (mbps >= 1)     return '1.5Mbps';
    return '';
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
        // Canonicalised `bcdUSB`. Rendered NOWHERE in the UI; kept on the
        // token because it is on the wire. "2.1" (from bcdUSB 2.10, which
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
 * Format a device's USB vendor:product identifier the way `lsusb` prints
 * it — lowercase, zero-padded to four hex digits, colon separated
 * (`1d6b:0003`). Byte-for-byte the daemon's own `{:04x}:{:04x}`, which
 * matters: usbIdRowText() below compares this against the headline, and the
 * daemon substitutes exactly this form when a device publishes no product
 * name (usbeehive display_name()/headline).
 *
 * Says nothing — '' — in four cases, because a wrong ID is worse than no ID
 * (WR-05 discipline):
 *   - either field absent, non-integer or negative;
 *   - either field above 0xffff: the USB descriptor fields are 16-bit, so a
 *     larger value means a malformed wire, and a 5-digit ID would be an
 *     invention;
 *   - BOTH fields exactly 0 — Type-C port entries hardcode the pair to zero
 *     (usbeehive summary.rs), and `0000:0000` on every port row means
 *     nothing. A lone zero is a legal half of a real ID and is not a
 *     sentinel.
 *
 * Total by construction: `undefined` in, '' out, never a throw. This runs
 * inside gnome-shell's own process (quick task 260915-ikd).
 *
 * @param {object} device  Unpacked DeviceEntry from the store.
 * @returns {string}  'vvvv:pppp', or '' when there is nothing to say.
 */
export function formatUsbId(device) {
    const vid = device?.vendor_id;
    const pid = device?.product_id;
    if (!Number.isInteger(vid) || !Number.isInteger(pid)) return '';
    if (vid < 0 || pid < 0 || vid > 0xffff || pid > 0xffff) return '';
    if (vid === 0 && pid === 0) return '';
    const hex = n => n.toString(16).padStart(4, '0');
    return `${hex(vid)}:${hex(pid)}`;
}

/**
 * The USB ID as the detail panel should render it — '' when the row would
 * be redundant.
 *
 * The row exists for the case a "show the ID when the name is unknown"
 * feature would MISS: the daemon already falls back to the formatted ID
 * itself when `product` is empty, so the unnamed device reads `1d6b:0003`
 * in the popover today. What is nowhere on screen is the ID of a device
 * whose name DOES resolve ("Intel Wireless"), which is precisely the one a
 * user needs to look the exact part up. So the row renders always, and only
 * suppression is derived here.
 *
 * Suppressed when the headline already CONTAINS the ID (trimmed,
 * case-insensitive substring). That covers the daemon's own fallback and
 * any composed headline that embeds the ID; a substring rule cannot lose
 * information, because if the ID is inside the headline the ID is already on
 * screen. Case-insensitive so a future daemon emitting uppercase still
 * suppresses, even though both sides lowercase today.
 *
 * @param {object} device  Unpacked DeviceEntry from the store.
 * @param {Map<string,string>} [propsMap]  Pre-built props Map (optional).
 * @returns {string}  '' when the row should not render.
 */
export function usbIdRowText(device, propsMap) {
    const id = formatUsbId(device);
    if (id === '') return '';
    const headline = resolveHeadline(device, propsMap).trim().toLowerCase();
    return headline.includes(id) ? '' : id;
}

/**
 * The index of the single highest-power PDO a charger+cable pair
 * advertises — the ceiling, against which the active PDO is read. That
 * comparison ("what it is using versus the most it could use") is the direct
 * answer to USBee's core charging question, and it is derived entirely from
 * `pdo_list[].power_mw`, which is already on the wire. No daemon change.
 *
 * Returns null — say nothing — when:
 *   - the argument is absent or not an array;
 *   - fewer than two PDOs: with one, the ceiling is trivially itself and the
 *     marker carries zero information;
 *   - no entry has a finite `power_mw > 0`;
 *   - the maximum is not UNIQUE: marking several rows "max" is noise, not
 *     guidance;
 *   - the winning entry's `index` is not an integer. The popover matches on
 *     `pdo.index === maxIdx` exactly as the active check one line above it
 *     does, so a well-formed wire gets the daemon's own index back; a
 *     malformed one gets no marker rather than a marker on every indexless
 *     row.
 *
 * @param {Array<object>} pdoList  device.pdo_list from src/device-store.js.
 * @returns {?number}  The daemon's `index` for the ceiling PDO.
 */
export function maxPdoIndex(pdoList) {
    if (!Array.isArray(pdoList) || pdoList.length < 2) return null;

    // `bestPower` starts at 0 and only powers > 0 are considered, so the
    // first valid entry always clears the `>` test — no separate "is this
    // the first one" branch is needed. `unique` is re-armed on every strict
    // new maximum and cleared by any tie with the current one, so a tie that
    // is later beaten (100, 100, 200) still yields 200.
    let bestPower = 0;
    let bestIndex = null;
    let unique = false;
    for (const pdo of pdoList) {
        const power = pdo?.power_mw;
        if (!Number.isFinite(power) || power <= 0) continue;
        if (power > bestPower) {
            bestPower = power;
            bestIndex = pdo.index;
            unique = true;
        } else if (power === bestPower) {
            unique = false;
        }
    }

    if (!unique || !Number.isInteger(bestIndex)) return null;
    return bestIndex;
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

/**
 * Rank the device list for the Quick Settings tile and return the winner's
 * capability tokens, or null when no device has a renderable ceiling.
 *
 * "Ceiling" is what the winning device COULD do: its declared
 * `usb_capable_speed_mbps` when the BOS descriptor gave one, else the rate
 * it actually negotiated. Ranking on the ceiling rather than on the
 * negotiated rate is the whole point — the tile answers "what is the best
 * this machine can do right now", and a SuperSpeed disk sitting behind a
 * USB-2.0 hub is still a 5Gbps device.
 *
 * Returns TOKENS, never translated strings: this module imports nothing (not
 * even gettext), which is what lets it load under bare gjs in CI and be
 * really unit-tested. The caller owns every user-visible string, including
 * the brand prefix and the subtitle wording chosen from `subtitleKind`.
 *
 * @param {object[]} devices  Unpacked DeviceEntry objects from the store.
 * @returns {?{id: string, ceiling: number, capableMbps: ?number,
 *   negotiatedMbps: number, brand: string, subtitleKind: string}}
 *   `subtitleKind` is 'full' (reaching the ceiling), 'linked' (below it) or
 *   'unlinked' (capability known, nothing negotiated).
 */
export function deriveCapabilityTile(devices) {
    const ranked = (Array.isArray(devices) ? devices : [])
        .map(d => {
            const capableMbps = intProp(propsOf(d), 'usb_capable_speed_mbps');
            const negotiatedMbps = Number.isFinite(d?.link_speed_mbps)
                ? d.link_speed_mbps : 0;
            return {
                id: typeof d?.id === 'string' ? d.id : '',
                capableMbps,
                negotiatedMbps,
                ceiling: capableMbps === null ? negotiatedMbps : capableMbps,
            };
        })
        // A positive ceiling is the ONLY admission test. There is deliberately
        // no descriptor-version test here: that is what used to exclude
        // Type-C port rows, and `ceiling > 0` excludes them anyway because a
        // port row carries neither a negotiated speed nor a declared
        // capability. One test, one reason.
        .filter(e => Number.isFinite(e.ceiling) && e.ceiling > 0)
        .sort((a, b) => b.ceiling - a.ceiling
                     || b.negotiatedMbps - a.negotiatedMbps
                     || a.id.localeCompare(b.id));

    // The negotiated tie-break is load-bearing, not cosmetic. On the
    // reporting machine three devices all declare usb_capable_speed_mbps
    // 5000; with ceiling alone the id comparison decides, which arbitrarily
    // crowns a 480 Mb/s BelowCapability hub over the disk that is genuinely
    // linked at 5000 — and the subtitle then reads "linked at 480 Mb/s"
    // while the faster device sits right there in the popover.
    const top = ranked[0];
    if (!top) return null;

    const brand = formatCapabilityBrand(top.ceiling);
    // An unbrandable ceiling lies in the open interval (0, 1), and because
    // the sort is descending nothing further down is brandable either. Fall
    // through to the caller's device-count tier rather than ever rendering a
    // brand-less title.
    if (brand === '') return null;

    let subtitleKind;
    if (top.capableMbps !== null && top.capableMbps === top.negotiatedMbps)
        subtitleKind = 'full';
    else if (top.negotiatedMbps <= 0)
        subtitleKind = 'unlinked';
    else
        subtitleKind = 'linked';

    return {...top, brand, subtitleKind};
}
