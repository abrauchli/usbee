// SPDX-License-Identifier: GPL-3.0-or-later
// tests/forward-compat.test.js
//
// WIRE-04 regression suite: everything usbeehive may add, remove or rename
// on the wire must land somewhere safe. Two halves:
//
//   1. Real unit tests of the three zero-import policy modules —
//      src/link-verdict.js, src/property-policy.js, src/notify-policy.js.
//      They import nothing, so they load under bare gjs in CI, and they are
//      where the verdict composition, the unknown-key containment and the
//      notification discipline actually live.
//   2. Source-level structural guards over the modules that DO import
//      gnome-shell resources (popover.js, device-store.js, notifier.js,
//      dbus-client.js, label-table.js) and therefore cannot be loaded here
//      at all. Precedent: tests/daemon-status.test.js.
//
// Runtime — plain GJS, NOT node:test. The previous revision of this file
// used `import {test} from 'node:test'`, which this gjs build rejects with
// "Unsupported URI scheme for importing: node" — it had not executed a
// single assertion in CI or locally. Its imports were also relative to
// tests/ rather than the extension directory, so it could not have resolved
// its modules-under-test either way.
//
// Run from the repo root:
//     gjs -m tests/forward-compat.test.js
// Exit status is non-zero if any assertion fails.

import System from 'system';
import GLib from 'gi://GLib';

import {
    deriveAltMode, deriveCapabilityTile, deriveHubInfo, deriveLinkInfo,
    formatCapabilityBrand, formatRate, formatUsbId, hasLinkIssue,
    isBuiltInDevice, maxPdoIndex, propsOf, resolveHeadline, usbIdRowText,
} from '../usbee@bitcreed.us/src/link-verdict.js';
import {
    GATED_KEYS, HIDDEN_KEYS, KNOWN_KEYS, isTechnicalKey, propertyTier,
    shouldRenderProperty,
} from '../usbee@bitcreed.us/src/property-policy.js';
import {
    dataRateMuteEntries, isDataRateMuted, shouldToastDeviceChange,
    withDataRateMute, withoutDataRateMute,
} from '../usbee@bitcreed.us/src/notify-policy.js';

let failures = 0;
function check(name, cond) {
    if (cond) {
        print(`  ok   - ${name}`);
    } else {
        failures++;
        print(`  FAIL - ${name}`);
    }
}

function readSource(relPath) {
    const [ok, raw] = GLib.file_get_contents(
        GLib.build_filenamev([GLib.get_current_dir(), relPath]));
    return ok ? new TextDecoder().decode(raw) : '';
}

// --- Fixtures ---------------------------------------------------------------
// Every device shape below is either quoted verbatim from the daemon's
// consumer specs (DBUS-BOS-CONSUMER-SPEC.md §7, DBUS-TRIM-CONSUMER-SPEC.md
// §8 — values captured live from the daemon's reference machine) or is the
// deliberate "future daemon" shape.

function device(overrides) {
    return Object.assign({
        id: 'usb:1-1',
        category: 'UsbDevice',
        device_class: 'Unknown',
        device_subclass: '',
        status: 'Attached',
        headline: 'A Device',
        subtitle: '',
        icon: '',
        vendor: '',
        product: 'A Device',
        vendor_id: 0,
        product_id: 0,
        primary_driver: 'usbcore',
        properties: [],
        port_number: -1,
        link_speed_mbps: 480,
        usb_version: '2.1',
        power: {power_in_mw: 0, power_out_mw: 0, contract_mw: 0, power_role: ''},
        charging_diag: {present: false, bottleneck: '', summary: '', detail: '', is_warning: false},
        pdo_list: [],
        active_pdo_index: -1,
    }, overrides);
}

// BOS spec §7.5 — 7 of 11 entries on the reference machine. No BOS at all.
const noBos = () => device({
    properties: [['serial', 'ABC'], ['usb_max_power_ma', '100'],
        ['transport.usb2', 'true']],
});

// BOS spec §7.1 — RTL8153 NIC: SuperSpeed-capable, linked at High Speed,
// vendor declares full function at 480. Informational, NOT a warning.
const belowCapability = () => device({
    id: 'usb:5-2.1.1',
    headline: 'USB 10/100/1000 LAN',
    properties: [
        ['usb_max_power_ma', '350'],
        ['transport.usb2', 'true'],
        ['usb_capable_speed_mbps', '5000'],
        ['usb_capable_speed', 'SuperSpeed 5 Gbps'],
        ['usb_functional_floor_mbps', '480'],
        ['usb_link_verdict', 'BelowCapability'],
        ['port.id', '5-2.1-port1'],
        ['power.source', 'bus'],
        ['kernel.quirks', 'NO_LPM'],
        ['product_db', 'RTL8153 Gigabit Ethernet Adapter'],
    ],
});

// TRIM spec §8.1 — the RTS5411 hub whose SuperSpeed companion never trained.
const hubWithDeadCompanion = () => device({
    id: 'usb:5-2',
    category: 'Hub',
    headline: '4-Port USB 2.0 Hub',
    product: '4-Port USB 2.0 Hub',
    properties: [
        ['usb_bos_container_id', 'f1adf5ec-1150-0540-91ec-71ca7101b6a2'],
        ['usb_capable_speed_mbps', '5000'],
        ['usb_capable_speed', 'SuperSpeed 5 Gbps'],
        ['usb_functional_floor_mbps', '12'],
        ['usb_link_verdict', 'BelowCapability'],
        ['port.id', 'usb5-port2'],
        ['port.peer_id', 'usb6-port2'],
        ['port.peer_state', 'not attached'],
        ['port.connect_type', 'hotplug'],
        ['hub.ports_total', '4'],
        ['hub.ports_used', '2'],
        ['power.source', 'self'],
        ['hub.power_committed_ma', '100'],
        ['product_db', 'RTS5411 Hub'],
    ],
});

// The genuinely actionable case: linked below the device's own floor.
const degraded = () => device({
    id: 'usb:3-1',
    link_speed_mbps: 480,
    properties: [
        ['usb_capable_speed_mbps', '10000'],
        ['usb_capable_speed', 'SuperSpeed+ 10 Gbps'],
        ['usb_capable_gen', 'Gen 2x1'],
        ['usb_functional_floor_mbps', '5000'],
        ['usb_link_verdict', 'Degraded'],
        ['usb_link_degraded', 'true'],
        ['port.peer_state', 'not attached'],
    ],
});

// --- formatRate -------------------------------------------------------------

print('# formatRate — the shared Mbit/s → human renderer');
{
    check('480 renders as Mb/s', formatRate(480) === '480 Mb/s');
    check('5000 renders without a trailing .0', formatRate(5000) === '5 Gb/s');
    check('1500 keeps one decimal', formatRate(1500) === '1.5 Gb/s');
    check('10000 rounds to whole Gb/s', formatRate(10000) === '10 Gb/s');
    check('40000 rounds to whole Gb/s', formatRate(40000) === '40 Gb/s');
    // A zero link speed on this wire means "not reported", never "stopped",
    // so the caller must render no row rather than "0 Mb/s".
    check('0 renders nothing', formatRate(0) === '');
    check('negative renders nothing', formatRate(-1) === '');
    check('NaN renders nothing', formatRate(Number.NaN) === '');
    check('undefined renders nothing', formatRate(undefined) === '');
}

// --- Verdict composition ----------------------------------------------------

print('# deriveLinkInfo — verdict composition');
{
    const info = deriveLinkInfo(noBos());
    check('no BOS: verdict is null', info.verdict === null);
    check('no BOS: not a warning', info.isWarning === false);
    check('no BOS: no capability text', info.capableText === '');
    check('no BOS: no floor', info.floorMbps === null);
    check('no BOS: rate still renders', info.rateText === '480 Mb/s');
    check('no BOS: no connector hint', info.connectorHint === null);
}
{
    const info = deriveLinkInfo(belowCapability());
    check('BelowCapability: verdict read', info.verdict === 'BelowCapability');
    // THE rule (BOS spec §6): capable > negotiated is NOT a warning.
    check('BelowCapability is NOT a warning', info.isWarning === false);
    check('BelowCapability: capability label available for the copy',
        info.capableText === 'SuperSpeed 5 Gbps');
    check('BelowCapability: floor parsed', info.floorMbps === 480);
    // No companion port on this entry — no evidence, so no cable claim.
    check('BelowCapability without peer state: no connector hint',
        info.connectorHint === null);
}
{
    const info = deriveLinkInfo(degraded());
    check('Degraded: verdict read', info.verdict === 'Degraded');
    check('Degraded IS a warning', info.isWarning === true);
    check('Degraded: floor drives the "needs" copy', info.floorText === '5 Gb/s');
    check('Degraded: generation available for the technical row',
        info.capableGen === 'Gen 2x1');
}
{
    // BOS spec §3.2 — new verdict values may appear without an interface
    // bump. An unrecognised one must render neutrally, never as a warning.
    const info = deriveLinkInfo(device({
        properties: [['usb_link_verdict', 'CosmicallyDegraded'],
            ['usb_capable_speed', 'SuperSpeed 5 Gbps']],
    }));
    check('unknown verdict collapses to null', info.verdict === null);
    check('unknown verdict does not warn', info.isWarning === false);
    check('unknown verdict raises no connector hint', info.connectorHint === null);
}
{
    // BOS spec §5.2 — the kernel refuses to read this device's BOS.
    // Capability is UNKNOWN. This must never become "USB 2 only".
    const info = deriveLinkInfo(device({
        properties: [['usb_bos_suppressed', 'true'],
            ['port.peer_state', 'not attached']],
    }));
    check('bos_suppressed is surfaced as a flag', info.bosSuppressed === true);
    check('bos_suppressed produces NO verdict', info.verdict === null);
    check('bos_suppressed produces NO warning', info.isWarning === false);
    check('bos_suppressed produces NO connector hint', info.connectorHint === null);
}
{
    // BOS spec §5.3 — a BOS with no speed-bearing capability. Render nothing.
    const info = deriveLinkInfo(device({
        properties: [['usb_altmode_svids', 'ff01'],
            ['usb_altmode_state', 'NotAttempted'],
            ['usb_altmode_failure', 'no_battery']],
    }));
    check('billboard-only BOS: no verdict', info.verdict === null);
    check('billboard-only BOS: no warning', info.isWarning === false);
}

// --- The Capability row (quick task 260910-n10) ----------------------------

print('# deriveLinkInfo — the Capability row states a fact and suppresses noise');
{
    // The live RTL8153: SuperSpeed silicon linked at High Speed. The row
    // exists to carry the device's own rating — and NOTHING about where that
    // rating could be met, because this device is capped by a USB-2.0-only
    // hub inside a monitor and no port on the machine would help.
    check('BelowCapability with a higher capability shows the row',
        deriveLinkInfo(belowCapability()).showCapability === true);
    check('the row value is the daemon capability label, verbatim',
        deriveLinkInfo(belowCapability()).capableText === 'SuperSpeed 5 Gbps');
    check('Degraded also shows the row',
        deriveLinkInfo(degraded()).showCapability === true);
}
{
    // A row reading "Capability: 480 Mb/s" beside "Link: 480 Mb/s" is noise.
    const dev = device({
        link_speed_mbps: 480,
        properties: [['usb_capable_speed_mbps', '480'],
            ['usb_capable_speed', 'High Speed 480 Mbps'],
            ['usb_link_verdict', 'BelowCapability']],
    });
    check('capability equal to the link is suppressed',
        deriveLinkInfo(dev).showCapability === false);
}
{
    // Numbers beat prose: a daemon that says "below" while reporting a
    // capability at or under the link gets no row.
    const dev = device({
        link_speed_mbps: 5000,
        properties: [['usb_capable_speed_mbps', '480'],
            ['usb_capable_speed', 'High Speed 480 Mbps'],
            ['usb_link_verdict', 'BelowCapability']],
    });
    check('a capability below the link is suppressed',
        deriveLinkInfo(dev).showCapability === false);
}
{
    check('AtCapability is suppressed — the Link row already says it',
        deriveLinkInfo(device({
            link_speed_mbps: 10000,
            properties: [['usb_capable_speed_mbps', '10000'],
                ['usb_capable_speed', 'SuperSpeed+ 10 Gbps'],
                ['usb_link_verdict', 'AtCapability']],
        })).showCapability === false);
    check('no BOS at all: no row', deriveLinkInfo(noBos()).showCapability === false);
    check('bos_suppressed: no row (capability is UNKNOWN, not slow)',
        deriveLinkInfo(device({
            properties: [['usb_bos_suppressed', 'true']],
        })).showCapability === false);
}
{
    // BOS spec §3.2 forward-compat. Without the numeric twin the verdict is
    // the only evidence, so an unrecognised verdict must say nothing.
    const withVerdict = v => deriveLinkInfo(device({
        properties: [['usb_capable_speed', 'SuperSpeed 5 Gbps'],
            ['usb_link_verdict', v]],
    })).showCapability;
    check('no numeric twin + BelowCapability still shows the row',
        withVerdict('BelowCapability') === true);
    check('no numeric twin + Degraded still shows the row',
        withVerdict('Degraded') === true);
    check('no numeric twin + AtCapability shows nothing',
        withVerdict('AtCapability') === false);
    check('no numeric twin + an unknown verdict shows nothing',
        withVerdict('CosmicallyDegraded') === false);
    check('a capability number with no label shows nothing',
        deriveLinkInfo(device({
            properties: [['usb_capable_speed_mbps', '5000'],
                ['usb_link_verdict', 'BelowCapability']],
        })).showCapability === false);
}

// --- The connector hint (BOS §6 × TRIM §6) ---------------------------------

print('# deriveLinkInfo — the connector hint names no socket and no cause');
{
    const info = deriveLinkInfo(hubWithDeadCompanion());
    check('BelowCapability + companion port → cause-agnostic hint',
        info.connectorHint === 'ss-cause-unknown');
    check('…and it is still not a warning', info.isWarning === false);
}
{
    // THE REGRESSION THIS FIX EXISTS FOR. The kernel's `peer` symlink comes
    // from ACPI `_PLD` (or a bare index guess) and is wrong on the project's
    // reference machine: the USB-C socket's SuperSpeed lanes live on
    // `usb6-port1`, not on the `usb6-port2` that `_PLD` claims. A healthy
    // USB 3 hub on that socket therefore shows a `not attached` companion
    // while its own SuperSpeed half is up and running at 5 Gb/s. USBee must
    // NOT turn that into a "USB 2-only cable" verdict — the peer state's
    // VALUE must select nothing.
    const states = ['not attached', 'powered', 'reconnecting',
        'configured', 'suspended', 'addressed', 'default'];
    const tokens = new Set(states.map(state => {
        const dev = hubWithDeadCompanion();
        dev.properties = dev.properties.map(
            ([k, v]) => k === 'port.peer_state' ? [k, state] : [k, v]);
        return deriveLinkInfo(dev).connectorHint;
    }));
    check('every kernel peer state yields the same cause-agnostic token',
        tokens.size === 1 && tokens.has('ss-cause-unknown'));
}
{
    // TRIM spec §6 row 4 — the live TP-Link UB500 case: a not-attached
    // companion on a device that publishes no BOS is just a fact about the
    // connector. SAY NOTHING.
    const dev = noBos();
    dev.properties = [...dev.properties, ['port.peer_state', 'not attached']];
    check('no BOS + not attached → say nothing',
        deriveLinkInfo(dev).connectorHint === null);
}
{
    // AtCapability: the link is already as fast as the device gets.
    const dev = device({
        link_speed_mbps: 10000,
        properties: [['usb_capable_speed_mbps', '10000'],
            ['usb_link_verdict', 'AtCapability'],
            ['port.peer_state', 'not attached']],
    });
    check('AtCapability raises no connector hint',
        deriveLinkInfo(dev).connectorHint === null);
}
{
    // Not SuperSpeed-capable → the SuperSpeed lanes are not the story.
    const dev = device({
        properties: [['usb_capable_speed_mbps', '480'],
            ['usb_link_verdict', 'BelowCapability'],
            ['port.peer_state', 'not attached']],
    });
    check('sub-SuperSpeed capability raises no connector hint',
        deriveLinkInfo(dev).connectorHint === null);
}
{
    // TRIM spec §3.5 — new kernel states may appear. Render neutrally.
    const dev = hubWithDeadCompanion();
    dev.properties = dev.properties.map(
        ([k, v]) => k === 'port.peer_state' ? [k, 'quantum-tunnelling'] : [k, v]);
    check('unknown peer state raises no hint',
        deriveLinkInfo(dev).connectorHint === null);
}

// --- hasLinkIssue -----------------------------------------------------------

print('# hasLinkIssue — only Degraded and over-budget');
{
    check('no BOS is not an issue', hasLinkIssue(noBos()) === false);
    check('BelowCapability is not an issue', hasLinkIssue(belowCapability()) === false);
    check('the live hub case is not an issue',
        hasLinkIssue(hubWithDeadCompanion()) === false);
    check('Degraded is an issue', hasLinkIssue(degraded()) === true);
    check('an over-budget hub is an issue', hasLinkIssue(device({
        category: 'Hub',
        properties: [['hub.power_budget_ma', '500'],
            ['hub.power_committed_ma', '620']],
    })) === true);
    check('a within-budget hub is not an issue', hasLinkIssue(device({
        category: 'Hub',
        properties: [['hub.power_budget_ma', '500'],
            ['hub.power_committed_ma', '188']],
    })) === false);
    check('a device with no properties at all is not an issue',
        hasLinkIssue(device({properties: undefined})) === false);
}

// --- deriveHubInfo ----------------------------------------------------------

print('# deriveHubInfo — absent is not zero');
{
    const hub = deriveHubInfo(hubWithDeadCompanion());
    check('ports parsed', hub.portsUsed === 2 && hub.portsTotal === 4);
    // TRIM spec §7.3: a self-powered hub publishes no budget.
    check('absent budget stays null', hub.budgetMa === null);
    check('committed parsed', hub.committedMa === 100);
    check('no budget means never over budget', hub.overBudget === false);
}
{
    // TRIM spec §7.3 — "0" is a real answer ("this hub has ports and none
    // are occupied"), and must not collapse into "unknown".
    const hub = deriveHubInfo(device({
        properties: [['hub.ports_total', '4'], ['hub.ports_used', '0']],
    }));
    check('ports_used "0" is a real 0, not null', hub.portsUsed === 0);
    const missing = deriveHubInfo(device({properties: [['hub.ports_total', '4']]}));
    check('absent ports_used is null, not 0', missing.portsUsed === null);
}
{
    const hub = deriveHubInfo(device({
        properties: [['hub.ports_used', 'lots'], ['hub.power_budget_ma', '']],
    }));
    check('garbage integer values collapse to null',
        hub.portsUsed === null && hub.budgetMa === null);
}

// --- deriveAltMode ----------------------------------------------------------

print('# deriveAltMode — facts, with one actionable case');
{
    // BOS spec §7.4 — the Samsung monitor on a USB-A-to-C cable. A quiet
    // fact, never a fault.
    const alt = deriveAltMode(device({
        properties: [['usb_altmode_svids', 'ff01'],
            ['usb_altmode_state', 'NotAttempted'],
            ['usb_altmode_failure', 'no_battery']],
    }));
    check('NotAttempted is not actionable', alt.actionable === false);
    check('svids parsed', alt.svids.length === 1 && alt.svids[0] === 'ff01');
    check('failure reasons parsed', alt.failures.includes('no_battery'));
}
{
    const alt = deriveAltMode(device({
        properties: [['usb_altmode_svids', 'ff01,8087'],
            ['usb_altmode_state', 'Unsuccessful'],
            ['usb_altmode_failure', 'no_usb_pd,no_battery']],
    }));
    check('Unsuccessful + no_usb_pd IS actionable', alt.actionable === true);
    check('multi-SVID list splits', alt.svids.length === 2);
}
{
    const alt = deriveAltMode(device({
        properties: [['usb_altmode_state', 'Unsuccessful'],
            ['usb_altmode_failure', 'flux_capacitor_offline']],
    }));
    check('unknown failure tokens are ignored, not actionable',
        alt.actionable === false);
    const none = deriveAltMode(noBos());
    check('no billboard: empty, not actionable',
        none.svids.length === 0 && none.state === '' && none.actionable === false);
}

// --- resolveHeadline --------------------------------------------------------

print('# resolveHeadline — product_db fills in, never overrides');
{
    // TRIM spec §8.4 — Intel Bluetooth publishes no iProduct at all.
    check('empty product + product_db + vendor → "Intel AX200 Bluetooth"',
        resolveHeadline(device({
            product: '', vendor: 'Intel', headline: 'Intel Wireless',
            properties: [['product_db', 'AX200 Bluetooth']],
        })) === 'Intel AX200 Bluetooth');
    check('vendor already in the db name is not repeated',
        resolveHeadline(device({
            product: '', vendor: 'Realtek', headline: 'Realtek Hub',
            properties: [['product_db', 'Realtek RTS5411 Hub']],
        })) === 'Realtek RTS5411 Hub');
    // §7.4 — advisory only; a real iProduct always wins.
    check('a real product name is never overridden',
        resolveHeadline(hubWithDeadCompanion()) === '4-Port USB 2.0 Hub');
    check('no product_db falls back to the headline',
        resolveHeadline(device({product: '', headline: 'Fallback'})) === 'Fallback');
    check('no headline either falls back to the id',
        resolveHeadline(device({product: '', headline: '', id: 'usb:9-9'}))
            === 'usb:9-9');
}

// --- Unknown-key containment (the reversal of 260526-c6p D-2) --------------

print('# property-policy — unknown keys are contained, never dropped');
{
    // The regression this whole tier exists to prevent: an unmodified
    // extension printing ~12 raw machine-key rows the day the daemon
    // updates.
    check('an unknown key is technical', propertyTier('some_future_key') === 'tech');
    check('an unknown key is hidden by default',
        shouldRenderProperty('some_future_key', false) === false);
    check('an unknown key IS reachable with the toggle on',
        shouldRenderProperty('some_future_key', true) === true);
    check('a known glanceable key always renders',
        shouldRenderProperty('mount', false) === true);
    check('a curated technical key needs the toggle',
        shouldRenderProperty('serial', false) === false
        && shouldRenderProperty('serial', true) === true);
    // Wire-only keys: never a row at any setting.
    check('usb_bos_container_id is never rendered',
        shouldRenderProperty('usb_bos_container_id', true) === false);
    check('port.peer_id is never rendered',
        shouldRenderProperty('port.peer_id', true) === false);
    check('usb_link_degraded is never rendered (redundant with the verdict)',
        shouldRenderProperty('usb_link_degraded', true) === false);
    // Dedicated-UI keys: never a BARE row, at any setting.
    check('usb_link_verdict never renders as a bare row',
        shouldRenderProperty('usb_link_verdict', true) === false);
    check('port.peer_state never renders as a bare row',
        shouldRenderProperty('port.peer_state', true) === false);
    check('transport.usb3 never renders as a bare row',
        shouldRenderProperty('transport.usb3', true) === false);
    // The separator hook must fire for unknown keys too.
    check('isTechnicalKey covers unknown keys', isTechnicalKey('nope_not_known'));
    check('isTechnicalKey excludes glanceable keys', !isTechnicalKey('mount'));
    // Sanity on the tier sets themselves.
    check('every hidden key is also a known key',
        [...HIDDEN_KEYS].every(k => KNOWN_KEYS.has(k)));
    check('every gated key is also a known key',
        [...GATED_KEYS].every(k => KNOWN_KEYS.has(k)));
    check('the two new daemon waves are all accounted for',
        ['usb_capable_speed', 'usb_capable_speed_mbps', 'usb_capable_gen',
            'usb_capable_rx_lanes', 'usb_capable_tx_lanes',
            'usb_functional_floor_mbps', 'usb_link_verdict',
            'usb_link_degraded', 'usb_bos_suppressed', 'usb_bos_container_id',
            'usb_altmode_svids', 'usb_altmode_state', 'usb_altmode_failure',
            'port.id', 'port.peer_id', 'port.peer_state', 'port.connect_type',
            'hub.ports_total', 'hub.ports_used', 'power.source',
            'hub.power_budget_ma', 'hub.power_committed_ma', 'kernel.quirks',
            'product_db'].every(k => KNOWN_KEYS.has(k)));
}

print('# property-policy and label-table stay in step');
{
    // Every key that can reach a row must have a label, or it renders its
    // raw machine key as the row title.
    const src = readSource('usbee@bitcreed.us/src/label-table.js');
    check('label-table.js source is readable', src.length > 0);
    const labelled = new Set(
        [...src.matchAll(/\['([a-z0-9_.]+)',\s*\(\)\s*=>/g)].map(m => m[1]));
    check('label-table.js exports LABELLED_KEYS',
        src.includes('export const LABELLED_KEYS'));
    const renderable = [...KNOWN_KEYS].filter(
        k => propertyTier(k) === 'tech' || propertyTier(k) === 'default');
    const unlabelled = renderable.filter(k => !labelled.has(k));
    check(`every renderable known key has a label (missing: ${unlabelled.join(', ') || 'none'})`,
        unlabelled.length === 0);
    const stray = [...labelled].filter(k => !KNOWN_KEYS.has(k));
    check(`every labelled key is known to property-policy (stray: ${stray.join(', ') || 'none'})`,
        stray.length === 0);
}

// --- Notification discipline ------------------------------------------------

print('# notify-policy — data-rate mute list');
{
    const entries = dataRateMuteEntries([['usb:5-2.1.1', 'USB LAN']]);
    check('entries parse', entries.length === 1);
    check('muted id is recognised', isDataRateMuted(entries, 'usb:5-2.1.1'));
    check('another id is not muted', !isDataRateMuted(entries, 'usb:1-4'));

    const added = withDataRateMute(entries, 'usb:1-4', 'Intel AX200 Bluetooth');
    check('adding a mute grows the list', added.length === 2);
    check('adding does not mutate the input', entries.length === 1);
    check('adding twice is idempotent',
        withDataRateMute(added, 'usb:1-4', 'x').length === 2);
    check('an empty headline falls back to the id',
        withDataRateMute([], 'usb:9-9', '')[0][1] === 'usb:9-9');
    check('removing works', withoutDataRateMute(added, 'usb:1-4').length === 1);

    // Poisoned lists (written out-of-band with `gsettings`) must not throw
    // and must not blank the preferences window.
    check('a non-array collapses to empty', dataRateMuteEntries('nope').length === 0);
    check('null collapses to empty', dataRateMuteEntries(null).length === 0);
    check('malformed rows are dropped',
        dataRateMuteEntries([['ok', 'Name'], 'junk', [], [''], [42, 'x']]).length === 1);
    check('a missing headline normalises to an empty string',
        dataRateMuteEntries([['id-only']])[0][1] === '');
}

print('# notify-policy — connect/disconnect toast discipline');
{
    const usb = {category: 'UsbDevice', deviceClass: 'Storage', connectType: 'hotplug'};
    const builtin = {category: 'UsbDevice', deviceClass: 'Bluetooth', connectType: 'hardwired'};
    check("scope 'off' suppresses everything",
        shouldToastDeviceChange('off', usb) === false);
    check("scope 'all' allows a hot-pluggable device",
        shouldToastDeviceChange('all', usb) === true);
    // The hardwired filter: a soldered-down device the user cannot unplug,
    // re-enumerating on suspend/resume, is pure noise.
    check('hardwired devices never toast, even under scope all',
        shouldToastDeviceChange('all', builtin) === false);
    check('hardwired devices never toast under scope power',
        shouldToastDeviceChange('power', builtin) === false);
    check("scope 'power' keeps Type-C ports",
        shouldToastDeviceChange('power',
            {category: 'TypeCPort', deviceClass: '', connectType: ''}) === true);
    check("scope 'power' drops a plain HID",
        shouldToastDeviceChange('power',
            {category: 'UsbDevice', deviceClass: 'Input', connectType: 'hotplug'}) === false);
    // DeviceAdded routinely races ahead of ListDevices — default-allow.
    check('unknown kind default-allows', shouldToastDeviceChange('all', undefined) === true);
    check('unknown kind still respects off',
        shouldToastDeviceChange('off', undefined) === false);
    // Forward-compat: an unrecognised scope value default-allows, matching
    // the GSettings <choices> guard.
    check('unknown scope default-allows', shouldToastDeviceChange('someday', usb) === true);
}

// --- Built-in device filter (quick task 260915-i4w) -------------------------

print('# isBuiltInDevice — only a positive "fixed" counts');
{
    check('mount=fixed is built in',
        isBuiltInDevice(device({properties: [['mount', 'fixed']]})) === true);
    check('mount=removable is not built in',
        isBuiltInDevice(device({properties: [['mount', 'removable']]})) === false);
    // usbeehive drops "unknown" and "" rather than forwarding them, so an
    // absent mount is the ordinary case on a quiet sysfs. It must never read
    // as built-in — that would hide arbitrary hotplugged hardware.
    check('an absent mount is NOT built in',
        isBuiltInDevice(device({properties: []})) === false);
    check('a device with no properties at all is NOT built in',
        isBuiltInDevice(device({})) === false);
    check('undefined is NOT built in', isBuiltInDevice(undefined) === false);
    // Match the token exactly: a future daemon emitting "Fixed" must not
    // silently start hiding hardware on a case-insensitive compare.
    check('the token is matched exactly, not case-insensitively',
        isBuiltInDevice(device({properties: [['mount', 'Fixed']]})) === false);
    // Type-C port rows carry no mount at all — which is what lets
    // hide-builtin-devices and hide-empty-ports compose instead of overlap.
    check('a Type-C port row is never built in',
        isBuiltInDevice(device({category: 'TypeCPort', properties: []})) === false);
}

print('# popover.js composes the built-in filter with the existing ones');
{
    const src = readSource('usbee@bitcreed.us/src/popover.js');
    check('popover.js reads hide-builtin-devices',
        src.includes("get_boolean('hide-builtin-devices')"));
    check('popover.js delegates the test to link-verdict.js',
        src.includes('isBuiltInDevice(d)'));
    // The escape hatch that keeps the header's issue count honest — the same
    // one the hub filter carries (260905-b0s).
    check('a built-in device with an issue is still shown',
        src.includes('!isBuiltInDevice(d) || hasIssue(d)'));
    check('popover.js distinguishes filtered-empty from bus-empty',
        src.includes("_('All devices hidden by the current filters')"));
    check('popover.js keeps the bus-empty string for a genuinely empty bus',
        src.includes("_('No USB devices attached')"));

    // Quick task 260915-ung — the loading row is a THIRD thing, distinct from
    // both empty-list strings above. Matched on the export statement rather
    // than the bare literal so a mention in a comment cannot satisfy it.
    check('popover.js exports populateLoadingState',
        src.includes('export function populateLoadingState(section)'));
    check('the loading row is distinct from both empty-list strings',
        src.includes("_('Loading…')")
        && src.includes("_('No USB devices attached')")
        && src.includes("_('All devices hidden by the current filters')"));
    // Quick task 260915-unh routed every teardown in this file through the
    // clearSection() chokepoint, so the accepted first statement is either
    // form. The Pitfall-C intent is unchanged and still pinned: emptying the
    // section is the FIRST thing the function does.
    check('populateLoadingState clears the section first (Pitfall C)',
        /export function populateLoadingState\(section\) \{\s*(\/\/[^\n]*\n\s*)*(clearSection\(section\)|section\.removeAll\(\));/.test(src));
    check('the loading row is non-interactive',
        /populateLoadingState[\s\S]*?reactive: false, can_focus: false/.test(src));
}

print('# the popover Options section is wired in both directions');
{
    const src = readSource('usbee@bitcreed.us/src/popover.js');
    check('popover.js exports buildOptionsSection',
        src.includes('export function buildOptionsSection'));
    // Quick task 260915-unh: the rows are now a USBee subclass whose
    // activate() override keeps the popover open on a pointer click. The
    // stock widget is still the BASE — the Shell's own switch behaviour and
    // a11y role are inherited, not reimplemented — so both halves are pinned.
    check('the Options rows keep the stock switch widget as their base',
        src.includes('extends PopupMenu.PopupSwitchMenuItem'));
    check('the Options rows are the non-dismissing USBee subclass',
        src.includes('new USBeeSwitchMenuItem('));
    check('row -> settings direction writes the key',
        src.includes('settings.set_boolean(key, state)'));
    check('settings -> row direction moves the switch',
        src.includes('row.setToggleState(value)'));
    // The latch that keeps the two bound surfaces from writing to each other
    // in a loop if setToggleState() ever starts emitting 'toggled'.
    check('the two-way binding cannot storm between the surfaces',
        src.includes('let syncing = false')
        && src.includes('if (syncing) return;'));
    check('every Options handler is tracked for disable()',
        src.includes('registry.addSignal(row, toggledId)')
        && src.includes('registry.addSignal(settings, changedId)'));

    // Every key the Options section offers must be a real schema key. A typo
    // is silent until runtime, where GSettings aborts the process on get/set
    // of an unknown key — inside gnome-shell that is the whole session.
    const schema = readSource(
        'usbee@bitcreed.us/schemas/org.gnome.shell.extensions.usbee.gschema.xml');
    for (const key of ['hide-empty-ports', 'hide-builtin-devices',
        'show-hubs', 'show-technical-details']) {
        check(`the Options section offers ${key}`, src.includes(`'${key}'`));
        check(`${key} is declared in the schema`,
            schema.includes(`<key name="${key}" type="b">`));
    }

    const tile = readSource('usbee@bitcreed.us/src/tile.js');
    check('tile.js mounts the Options section',
        tile.includes('buildOptionsSection('));
    // Quick task 260915-unh replaced the one-line rebuild with an in-place
    // update, so a filter change no longer collapses the list. The repaint
    // itself is still pinned — via the call that performs it and the header
    // it has to keep in step.
    check('tile.js repaints the list when a filter changes',
        tile.includes('updateDeviceRowsInPlace('));
    check('tile.js keeps the header in step with the rows now visible',
        tile.includes('this._setHeader('));
}

print('# a settings toggle keeps the popover open and the list expanded (260915-unh)');
{
    // Provenance for the neighbouring syncing-latch guards: upstream source
    // says setToggleState() EMITS 'toggled' on Shell 50 (popupMenu.js 50:571
    // -> the state setter 50:564 -> the switch's notify::state wired at
    // 50:505 -> _onToggled 50:575), while on 46 it does not (46:486). So
    // those latch guards are load-bearing on the Shell this machine runs,
    // not precautionary. That was read from upstream and is NOT verifiable
    // here — the Shell's JS is absent from this machine's disk and from every
    // installed .gresource — which is exactly why _usbeeOnActivate exists
    // (D-8): the GSettings write does not rest on any single emission.
    //
    // Positive `includes` assertions ONLY in this block. A negative grep
    // asserting the absence of a chained-activation call or of the old
    // rebuild line would be invalidated by the very doc comments that keep
    // these decisions from being forgotten — the failure mode quick task
    // 260910-p91 hit and solved by inspecting extracted literals.
    const src = readSource('usbee@bitcreed.us/src/popover.js');
    const tile = readSource('usbee@bitcreed.us/src/tile.js');

    // Cause 1 — the switch toggles without dismissing the popover.
    check('the switch subclass overrides activation',
        src.includes('activate(_event)'));
    check('the override toggles the switch itself',
        src.includes('this.toggle();'));
    check('the GSettings write does not depend on the toggled signal',
        src.includes('_usbeeOnActivate'));

    // Cause 2 — the list is updated in place rather than torn down.
    check('popover.js exports the in-place update',
        src.includes('export function updateDeviceRowsInPlace'));
    check('popover.js can refill one row submenu on its own',
        src.includes('function populateDeviceRowMenu'));
    check('rows are keyed on the daemon own device identity',
        src.includes('_usbeeDeviceId') && src.includes('device.id'));
    check('the section keeps a live row inventory',
        src.includes('section._usbeeRows'));
    check('the accordion handler iterates the live inventory',
        src.includes('for (const other of (section._usbeeRows || []))'));
    check('a newly visible row is inserted at its sorted index',
        src.includes('addMenuItem(row, index)'));

    // D-7 — the section contents are proved live before any mutation.
    check('the in-place path proves ownership before mutating',
        src.includes('_usbeeOwnedItems'));
    check('every teardown routes through the one chokepoint',
        src.includes('clearSection(section)'));

    // T-unh-02 / D-9 — a removed row cannot leave a dangling reference.
    check('a removed row is closed before it is destroyed',
        src.includes('row.menu.close(false)'));
    check('popover.js forgets the shim-owned submenu field',
        src.includes('_usbeeForgetSubMenu'));
    check('tile.js installs the companion forget shim',
        tile.includes('_usbeeForgetSubMenu'));

    // D-6 — a filter toggle cannot disturb 260915-ung's loading row.
    check('a filter toggle returns during the awaiting-snapshot window',
        tile.includes('awaitingFirstSnapshot === true'));
    check('tile.js still routes every other daemon state through the rebuild',
        tile.includes('DaemonState.RUNNING'));

    // The filter composition survived the extraction into visibleDevices()
    // character for character.
    check('the built-in filter keeps its issue escape hatch verbatim',
        src.includes('!isBuiltInDevice(d) || hasIssue(d)'));
}

print('# prefs.js carries the built-in filter too');
{
    const src = readSource('usbee@bitcreed.us/prefs.js');
    check('prefs.js binds hide-builtin-devices',
        src.includes("settings.bind('hide-builtin-devices'"));
    check('prefs.js and the popover use the same words for it',
        src.includes("_('Hide built-in devices')"));
}

// --- USB ID row + PDO ceiling marker (quick task 260915-ikd) ----------------

print('# formatUsbId prints the lsusb form, or nothing at all');
{
    check('a resolved pair formats lowercase and colon separated',
        formatUsbId(device({vendor_id: 0x1d6b, product_id: 0x0003})) === '1d6b:0003');
    check('both sides zero-pad to four hex digits',
        formatUsbId(device({vendor_id: 0x5, product_id: 0x29})) === '0005:0029');
    check('0xffff on both sides is still in range',
        formatUsbId(device({vendor_id: 0xffff, product_id: 0xffff})) === 'ffff:ffff');
    // Lowercase is not cosmetic: the daemon formats its own fallback as
    // {:04x}:{:04x}, and usbIdRowText() compares against that.
    check('hex digits are lowercase',
        formatUsbId(device({vendor_id: 0x8087, product_id: 0xABCD})) === '8087:abcd');
    // Type-C port entries hardcode the pair to zero, so 0000:0000 would
    // otherwise render on every port row and say nothing.
    check('0/0 says nothing (the Type-C port row case)',
        formatUsbId(device({vendor_id: 0, product_id: 0})) === '');
    // ...but a lone zero is a legal half of a real ID, not a sentinel.
    check('a zero vendor beside a real product still renders',
        formatUsbId(device({vendor_id: 0, product_id: 0x1234})) === '0000:1234');
    check('a real vendor beside a zero product still renders',
        formatUsbId(device({vendor_id: 0x1234, product_id: 0})) === '1234:0000');
    // The descriptor fields are 16-bit, so anything wider is a malformed
    // wire — and inventing a five-digit ID would be worse than silence.
    check('a vendor above 0xffff says nothing',
        formatUsbId(device({vendor_id: 0x10000, product_id: 1})) === '');
    check('a product above 0xffff says nothing',
        formatUsbId(device({vendor_id: 1, product_id: 0x10000})) === '');
    check('a negative value says nothing',
        formatUsbId(device({vendor_id: -1, product_id: 1})) === '');
    check('a non-integer says nothing',
        formatUsbId(device({vendor_id: 1.5, product_id: 1})) === '');
    check('a numeric string says nothing',
        formatUsbId(device({vendor_id: '1d6b', product_id: '0003'})) === '');
    check('an absent field says nothing',
        formatUsbId(device({vendor_id: undefined, product_id: 3})) === '');
    check('NaN says nothing',
        formatUsbId(device({vendor_id: NaN, product_id: 3})) === '');
    // Total function: an exception here would be thrown inside gnome-shell's
    // own process, not inside a sandbox.
    check('undefined in, empty string out — never a throw',
        formatUsbId(undefined) === '');
    check('an empty object says nothing', formatUsbId({}) === '');
}

print('# usbIdRowText suppresses only when the ID is already on screen');
{
    // The case the daemon already covers by itself: it substitutes the
    // formatted ID for a missing product name, and pins that with its own
    // test (headline == "dead:beef"). Repeating it as a row says the same
    // thing twice.
    check('a daemon-fallback headline suppresses the row',
        usbIdRowText(device({
            headline: 'dead:beef', product: '',
            vendor_id: 0xdead, product_id: 0xbeef,
        })) === '');
    // The gap this actually closes: the name resolved, so the exact part
    // number is nowhere on screen.
    check('a resolved name renders the row',
        usbIdRowText(device({
            headline: 'Intel Wireless', product: 'Intel Wireless',
            vendor_id: 0x8087, product_id: 0x0029,
        })) === '8087:0029');
    check('a headline that merely embeds the ID also suppresses it',
        usbIdRowText(device({
            headline: 'Linux Foundation 3.0 root hub (1d6b:0003)',
            product: 'root hub', vendor_id: 0x1d6b, product_id: 0x0003,
        })) === '');
    // Case-insensitive, so a future daemon emitting uppercase still
    // suppresses even though both sides lowercase today.
    check('an uppercase headline ID still suppresses',
        usbIdRowText(device({
            headline: 'DEAD:BEEF', product: '',
            vendor_id: 0xdead, product_id: 0xbeef,
        })) === '');
    check('surrounding whitespace does not defeat the match',
        usbIdRowText(device({
            headline: '  dead:beef  ', product: '',
            vendor_id: 0xdead, product_id: 0xbeef,
        })) === '');
    // A near miss is not a match — 1d6b:0003 is not inside 1d6b:0002.
    check('a DIFFERENT ID in the headline does not suppress',
        usbIdRowText(device({
            headline: '1d6b:0002', product: '',
            vendor_id: 0x1d6b, product_id: 0x0003,
        })) === '1d6b:0003');
    // The comparison must run against what is DISPLAYED, which is
    // resolveHeadline()'s answer — here the id field, not the empty headline.
    check('the comparison runs against the displayed headline',
        usbIdRowText(device({
            headline: '', id: '0bda:8153', product: '',
            vendor_id: 0x0bda, product_id: 0x8153,
        })) === '');
    check('the 0/0 port row stays suppressed here too',
        usbIdRowText(device({headline: 'USB-C port'})) === '');
    check('undefined in, empty string out', usbIdRowText(undefined) === '');
}

print('# maxPdoIndex marks a ceiling only when it is unambiguous');
{
    const pdo = (index, powerMw) => ({
        index, kind: 'Fixed', voltage_mv: 5000, max_voltage_mv: 5000,
        current_ma: 3000, power_mw: powerMw, is_active: false,
    });

    check('the unique highest power wins',
        maxPdoIndex([pdo(0, 15000), pdo(1, 27000), pdo(2, 100000)]) === 2);
    check('the ceiling need not be last in the list',
        maxPdoIndex([pdo(0, 100000), pdo(1, 27000), pdo(2, 15000)]) === 0);
    check('the daemon index is returned, not the array position',
        maxPdoIndex([pdo(7, 15000), pdo(9, 60000)]) === 9);
    // Marking several rows "max" is noise, not guidance.
    check('a tied maximum says nothing',
        maxPdoIndex([pdo(0, 15000), pdo(1, 60000), pdo(2, 60000)]) === null);
    // ...but a tie that is later beaten is not a tie at the top.
    check('a tie BELOW the maximum does not suppress it',
        maxPdoIndex([pdo(0, 15000), pdo(1, 15000), pdo(2, 60000)]) === 2);
    // With one PDO the ceiling is trivially itself: zero information.
    check('a single PDO says nothing', maxPdoIndex([pdo(0, 15000)]) === null);
    check('an empty list says nothing', maxPdoIndex([]) === null);
    check('a list that advertises no power says nothing',
        maxPdoIndex([pdo(0, 0), pdo(1, 0)]) === null);
    check('negative power is not a ceiling',
        maxPdoIndex([pdo(0, -1), pdo(1, -2)]) === null);
    check('a zero-power entry cannot outrank a real one',
        maxPdoIndex([pdo(0, 0), pdo(1, 15000)]) === 1);
    check('a non-finite power is ignored',
        maxPdoIndex([pdo(0, NaN), pdo(1, 15000)]) === 1);
    check('a missing power_mw is ignored',
        maxPdoIndex([{index: 0}, pdo(1, 15000)]) === 1);
    // A malformed index on the WINNER yields no marker at all, rather than a
    // marker that would match every indexless row back in the popover loop.
    check('a winner with no usable index says nothing',
        maxPdoIndex([pdo(0, 15000), {power_mw: 60000}]) === null);
    check('undefined in, null out', maxPdoIndex(undefined) === null);
    check('a non-array says nothing', maxPdoIndex('not a list') === null);
    check('a list of holes never throws',
        maxPdoIndex([null, undefined]) === null);
}

// --- Tile capability brand + ranking (quick task 260917-hkf) ----------------

print('# formatCapabilityBrand buckets on the edges the daemon itself uses');
{
    // Each tier at its edge, and one below it, so a mis-typed comparison
    // cannot pass by accident. The edges mirror link_speed_tier() in
    // usbeehive src/usb.rs:362-375.
    check('80000 is the USB4 v2 brand', formatCapabilityBrand(80000) === '80Gbps');
    check('one below 80000 falls to the tier under it',
        formatCapabilityBrand(79999) === '40Gbps');
    check('40000 is the USB4 brand', formatCapabilityBrand(40000) === '40Gbps');
    check('one below 40000 falls to the tier under it',
        formatCapabilityBrand(39999) === '20Gbps');
    check('20000 brands as 20Gbps', formatCapabilityBrand(20000) === '20Gbps');
    check('one below 20000 falls to the tier under it',
        formatCapabilityBrand(19999) === '10Gbps');
    check('10000 brands as 10Gbps', formatCapabilityBrand(10000) === '10Gbps');
    check('one below 10000 falls to the tier under it',
        formatCapabilityBrand(9999) === '5Gbps');
    check('5000 brands as 5Gbps', formatCapabilityBrand(5000) === '5Gbps');
    check('one below 5000 falls to the tier under it',
        formatCapabilityBrand(4999) === '480Mbps');
    check('480 brands as 480Mbps', formatCapabilityBrand(480) === '480Mbps');
    check('one below 480 falls to the tier under it',
        formatCapabilityBrand(479) === '12Mbps');
    check('12 brands as 12Mbps', formatCapabilityBrand(12) === '12Mbps');
    check('one below 12 falls to low speed',
        formatCapabilityBrand(11) === '1.5Mbps');
    check('1 is still a low-speed brand', formatCapabilityBrand(1) === '1.5Mbps');
    // Below 1 there is no brand to name. '' is formatRate()'s own "nothing to
    // say" convention, so the two sibling formatters behave alike.
    check('zero says nothing', formatCapabilityBrand(0) === '');
    check('a negative ceiling says nothing', formatCapabilityBrand(-1) === '');
    check('NaN says nothing', formatCapabilityBrand(NaN) === '');
    check('an absent ceiling says nothing',
        formatCapabilityBrand(undefined) === '');
    // The wire carries decimal STRINGS; intProp is what converts them. A
    // string arriving here means a caller skipped that step.
    check('a numeric string says nothing', formatCapabilityBrand('5000') === '');
    check('Infinity says nothing', formatCapabilityBrand(Infinity) === '');
    // WIRE-04 — a future rate above every tier we know must still brand as
    // the top tier rather than blank the tile.
    check('a far-future rate never blanks the brand',
        formatCapabilityBrand(200000) === '80Gbps');
}

print('# deriveCapabilityTile ranks by ceiling, tie-breaks on the negotiated link');
{
    // Capability is a properties pair carrying a decimal string, because
    // that is exactly what the wire carries.
    const capable = (mbps) => [['usb_capable_speed_mbps', String(mbps)]];
    // A Type-C port row: no negotiated speed, no BOS capability, no
    // descriptor version. device()'s defaults are 480 and '2.1', so all
    // three must be overridden explicitly.
    const port = (id) => device({
        id, category: 'TypeCPort', status: 'Empty',
        link_speed_mbps: 0, usb_version: '', properties: [],
    });

    // Case 1 — the reporting machine: three devices all declaring 5000,
    // negotiated 5000 / 480 / 480, with ids ordered so that localeCompare
    // ALONE would crown one of the 480s. The negotiated tie-break is what
    // stops a BelowCapability hub outranking the disk doing the work.
    {
        const tie = deriveCapabilityTile([
            device({id: 'usb:1-1', link_speed_mbps: 480, properties: capable(5000)}),
            device({id: 'usb:1-2', link_speed_mbps: 480, properties: capable(5000)}),
            device({id: 'usb:1-3', link_speed_mbps: 5000, properties: capable(5000)}),
        ]);
        check('a 3-way capability tie resolves to the fastest negotiated link',
            tie.id === 'usb:1-3');
        check('the tied winner brands at the shared ceiling',
            tie.brand === '5Gbps');
        check('the tied winner is reaching its ceiling',
            tie.subtitleKind === 'full');
    }

    // Case 2 — capability known, running below it. The subtitle measures the
    // negotiated rate through the SAME formatter the popover Link row uses.
    {
        const below = deriveCapabilityTile([
            device({id: 'usb:2-1', link_speed_mbps: 480, properties: capable(5000)}),
        ]);
        check('a below-capability device still brands at its ceiling',
            below.brand === '5Gbps');
        check('a below-capability device reports the linked kind',
            below.subtitleKind === 'linked');
        check('the negotiated rate is what formatRate will measure',
            formatRate(below.negotiatedMbps) === '480 Mb/s');
    }

    // Case 3 — capability reached exactly.
    check('capability equal to the negotiated rate is full capability',
        deriveCapabilityTile([
            device({id: 'usb:3-1', link_speed_mbps: 5000, properties: capable(5000)}),
        ]).subtitleKind === 'full');

    // Case 4 — no BOS at all, but a faster negotiated link. It wins on the
    // negotiated rate alone, and must NOT claim full capability: with no
    // declared ceiling there is nothing to say it has reached one.
    {
        const noBosWins = deriveCapabilityTile([
            device({id: 'usb:4-1', link_speed_mbps: 480, properties: capable(5000)}),
            device({id: 'usb:4-2', link_speed_mbps: 10000, properties: []}),
        ]);
        check('a device with no declared capability ranks on its link rate',
            noBosWins.id === 'usb:4-2');
        check('its ceiling brands from the negotiated rate',
            noBosWins.brand === '10Gbps');
        check('full capability is never CLAIMED without a declared ceiling',
            noBosWins.capableMbps === null && noBosWins.subtitleKind === 'linked');
    }

    // Case 5 — Type-C port rows only. They are excluded by the positive
    // ceiling test, with no descriptor-version test anywhere in the helper.
    check('port rows alone never win the tile',
        deriveCapabilityTile([port('port:0'), port('port:1')]) === null);
    // ...and they never outrank a real device either.
    check('a port row cannot displace a real device',
        deriveCapabilityTile([
            port('port:0'),
            device({id: 'usb:5-1', link_speed_mbps: 5000, properties: capable(5000)}),
        ]).id === 'usb:5-1');

    // Case 6 — nothing to rank.
    check('an empty list says nothing', deriveCapabilityTile([]) === null);
    check('a list of zero-ceiling devices says nothing',
        deriveCapabilityTile([
            device({id: 'usb:6-1', link_speed_mbps: 0, properties: []}),
            device({id: 'usb:6-2', link_speed_mbps: 0, properties: []}),
        ]) === null);

    // Case 7 — capability declared, nothing linked. Distinct from case 2:
    // there is no measured rate to print, so the subtitle must not try.
    {
        const idle = deriveCapabilityTile([
            device({id: 'usb:7-1', link_speed_mbps: 0, properties: capable(5000)}),
        ]);
        check('a known capability with no link is unlinked, not linked-at-zero',
            idle.subtitleKind === 'unlinked');
        check('the unlinked winner still brands at its ceiling',
            idle.brand === '5Gbps');
    }

    // Case 8 — a ceiling that brands empty. Returning null here is what
    // keeps the title from ever reading "USB " with nothing after it; the
    // caller falls through to its device-count tier instead.
    check('an unbrandable ceiling yields no tile rather than a blank brand',
        deriveCapabilityTile([
            device({id: 'usb:8-1', link_speed_mbps: 0.5, properties: []}),
        ]) === null);

    // Total function: this runs inside gnome-shell's own process.
    check('undefined in, null out', deriveCapabilityTile(undefined) === null);
    check('a non-array says nothing', deriveCapabilityTile('not a list') === null);
    check('a list of holes never throws',
        deriveCapabilityTile([null, undefined]) === null);
    // Garbage in the capability property must collapse to "unknown" through
    // intProp, not become a ceiling of its own.
    check('a garbage capability property falls back to the negotiated rate',
        deriveCapabilityTile([device({
            id: 'usb:9-1', link_speed_mbps: 480,
            properties: [['usb_capable_speed_mbps', 'very fast']],
        })]).brand === '480Mbps');
}

print('# popover.js renders the USB ID row above the link block');
{
    const src = readSource('usbee@bitcreed.us/src/popover.js');
    check('popover.js renders a USB ID row', src.includes("_('USB ID')"));
    check('popover.js delegates every suppression rule to link-verdict.js',
        src.includes('usbIdRowText(device, props)'));
    check('popover.js imports both new helpers',
        src.includes('maxPdoIndex') && src.includes('usbIdRowText'));
    // D-2 ordering — what it is → its exact ID → how it is connected. Assert
    // the ORDER, not merely the presence, or a later refactor can bury
    // identity below the link verdict without failing anything here.
    const idAt = src.indexOf("_('USB ID')");
    const linkAt = src.indexOf('buildLinkBlock(detailBox');
    check('the USB ID row is built before the link block',
        idAt > 0 && linkAt > 0 && idAt < linkAt);
    // T-01-02 holds by construction: buildPropertyRow assigns .text, so
    // reusing it is what keeps a markup API out of this path.
    check('the USB ID row reuses buildPropertyRow',
        /buildPropertyRow\(\s*\n?\s*_\('USB ID'\)/.test(src));
}

print('# popover.js marks the ceiling PDO without disturbing the active one');
{
    const src = readSource('usbee@bitcreed.us/src/popover.js');
    check('popover.js delegates the ceiling to link-verdict.js',
        src.includes('maxPdoIndex(pdos)'));
    // D-12 — a format string, never concatenation, so a translator can move
    // the marker relative to the index.
    check('the marker is composed with a format string, not concatenated',
        src.includes("_('%s (max)').format(keyText)"));
    check('popover.js tags the ceiling row for the stylesheet',
        src.includes("pdoRow.add_style_class_name('usbee-pdo-max')"));
    check('the active marker is left exactly as it was',
        src.includes("`${_('◀')} ${pdo.index}`")
        && src.includes("pdoRow.add_style_class_name('usbee-pdo-active')"));
    // A null ceiling must never match a PDO whose index is absent.
    check('no marker is rendered when there is no unambiguous ceiling',
        src.includes('maxIdx !== null && pdo.index === maxIdx'));
    const literals = [...src.matchAll(/_\('((?:[^'\\]|\\.)*)'\)/g)]
        .map(m => m[1]);
    check('both new strings are translatable',
        literals.includes('USB ID') && literals.includes('%s (max)'));
    // The two standing wording guards further down this file reject a
    // careless rewording; neither new string may drift into tripping them.
    check('neither new string tells the user to go get hardware',
        !['USB ID', '%s (max)'].some(s => /\buse a\b/i.test(s)));
}

print('# the stylesheet bolds the ceiling VALUE, not its key');
{
    const css = readSource('usbee@bitcreed.us/stylesheet.css');
    check('stylesheet.css is readable', css.length > 0);
    check('the ceiling marker bolds the value column',
        css.includes('.usbee-pdo-max .usbee-detail-value'));
    // D-11 orthogonality: bolding the key for max as well would erase the
    // active row's belt-and-braces signal, so the columns stay separate.
    check('the ceiling marker leaves the key column to the active marker',
        !css.includes('.usbee-pdo-max .usbee-detail-key'));
    check('the active PDO rule survives',
        css.includes('.usbee-pdo-active .usbee-detail-key'));
}

// --- Structural guards over the Shell-only modules --------------------------

print('# dbus-client.js carries both new signals');
{
    const src = readSource('usbee@bitcreed.us/src/dbus-client.js');
    const xml = readSource('usbee@bitcreed.us/dbus-iface.xml');
    check('dbus-client.js source is readable', src.length > 0);
    check('IFACE_XML declares DataRateDegraded',
        src.includes('<signal name="DataRateDegraded">'));
    check('IFACE_XML declares DataRateRestored',
        src.includes('<signal name="DataRateRestored">'));
    check('dbus-iface.xml declares DataRateDegraded',
        xml.includes('<signal name="DataRateDegraded">'));
    check('dbus-iface.xml declares DataRateRestored',
        xml.includes('<signal name="DataRateRestored">'));
    check("dbus-client.js subscribes connectSignal('DataRateDegraded')",
        src.includes("connectSignal('DataRateDegraded'"));
    check("dbus-client.js subscribes connectSignal('DataRateRestored')",
        src.includes("connectSignal('DataRateRestored'"));
    check('dbus-client.js registers both via addProxySignal',
        src.includes('addProxySignal(this._proxy, rateDegradedId)')
        && src.includes('addProxySignal(this._proxy, rateRestoredId)'));
    check('dbus-client.js passes port.connect_type to the notifier',
        src.includes("'port.connect_type'"));
    check('the interface name is still Devices5',
        src.includes("INTERFACE_NAME = 'org.usbeehive.Devices5'"));

    // Quick task 260915-ib9 — SnapshotJson had no call site in USBee and no
    // feature behind it, so the client-side declaration went. The daemon
    // still exports it; this asserts only that USBee stopped declaring it.
    // Both sides must drop it together, or the byte-equality check below
    // fails — which is exactly the guard that makes this safe.
    check('IFACE_XML no longer declares SnapshotJson',
        !src.includes('<method name="SnapshotJson">'));
    check('dbus-iface.xml no longer declares SnapshotJson',
        !xml.includes('<method name="SnapshotJson">'));
    check('no SnapshotJson call site survives in dbus-client.js',
        !/SnapshotJson\w*\s*\(/.test(src));
    // The two methods that ARE declared against a planned call site stay —
    // this removal must not be read as licence to strip them as well.
    check('Refresh is still declared', src.includes('<method name="Refresh">'));
    check('Diagnose is still declared', src.includes('<method name="Diagnose">'));

    // Byte-equality invariant between the literal and the on-disk XML,
    // less the doctype (Plan 04-02 Task 13).
    const literal = src.split('const IFACE_XML = `')[1]?.split('`;')[0] ?? '';
    const strip = s => s.replace(/<!DOCTYPE[\s\S]*?>\s*/, '').trim();
    check('IFACE_XML literal is byte-equal to dbus-iface.xml',
        strip(literal) === strip(xml));
}

print('# popover.js contains the property dump');
{
    const src = readSource('usbee@bitcreed.us/src/popover.js');
    check('popover.js source is readable', src.length > 0);
    check('popover.js routes the property loop through property-policy.js',
        src.includes('shouldRenderProperty(key, showTech)'));
    check('popover.js no longer keeps its own GATED_KEYS set',
        !src.includes('const GATED_KEYS'));
    check('popover.js no longer keeps its own HANDLED_BY_DEDICATED_UI set',
        !src.includes('const HANDLED_BY_DEDICATED_UI'));
    check('popover.js renders a Link row', src.includes("_('Link')"));
    check('popover.js never derives its own capable-vs-negotiated warning',
        !/capable\w*\s*>\s*(negotiated|link_speed)/i.test(src));
    // Quick task 260910-n10 — the run-on Link row is split in two, and the
    // half that promised a remedy is gone for good. USBee cannot see WHERE a
    // device's capability is lost (the live case is a USB-2.0-only hub inside
    // a monitor), so the Capability row states the rating and stops.
    check('popover.js renders a separate Capability row',
        src.includes("_('Capability')") && src.includes('link.showCapability'));
    check('popover.js no longer promises a faster port',
        !src.includes('could run at') && !/on a faster port/.test(src));
    // Quick task 260910-o99 — the Fix row went the same way. Degraded says
    // the link fell below what the device needs; it says nothing about
    // WHERE, and the live case is a USB-2.0-only hub inside a monitor, so
    // "move it" is the wrong instruction. Guard the row, not just the
    // sentence, or the next rewording sneaks a remedy back in.
    check('popover.js renders no Fix row', !src.includes("_('Fix')"));
    check('popover.js no longer tells the user to change ports or cables',
        !/USB 3 port/.test(src) && !/Move it to/.test(src));
    // Quick task 260910-p91 — the alt-mode `no_usb_pd` row was the last
    // remedy-shaped string. Unlike the two above, its cause IS named by the
    // daemon, so the row survives; only the mood changed. Guard the
    // TRANSLATED LITERALS, not the file text: both the docstring and the
    // Translators comment quote the withdrawn imperative on purpose, and a
    // plain substring test would fail on the very comments that keep the
    // decision from being forgotten.
    {
        const literals = [...src.matchAll(/_\('((?:[^'\\]|\\.)*)'\)/g)]
            .map(m => m[1]);
        check('popover.js has translatable strings to inspect',
            literals.length > 0);
        check('no popover.js string tells the user to go get hardware',
            !literals.some(s => /\buse a\b/i.test(s)));
        check('the alt-mode PD row states a condition, not an instruction',
            literals.some(s => s.startsWith('Alt mode did not start —')
                && /does not provide USB Power Delivery/.test(s)));
    }
    check('popover.js no longer prints the bcdUSB version beside the rate',
        !src.includes("_('%s (USB %s)')"));
    check('popover.js shows hubs that have an issue',
        src.includes("d.category !== 'Hub' || hasIssue(d)"));
    check('popover.js returns the issue count for the header',
        src.includes('issues: devices.filter(hasIssue).length'));
}

// --- Wrapping labels must clear St.Label's default ellipsize ----------------
// St.Label builds its ClutterText with PANGO_ELLIPSIZE_END. ClutterText hands
// Pango both the ellipsize mode and the wrap mode but never sets a layout
// height, and Pango's default height of -1 means "ellipsize at line one" — so
// a label that sets only line_wrap still renders one truncated line. That was
// quick task 260910-ggy's bug: every value in the device property panel read
// as "Realtek · Vendor Spec…". Guard the pairing, not the individual call
// sites, so a new wrapping label cannot reintroduce it.
print('# every wrapping label also clears the inherited ellipsize');
for (const relPath of ['usbee@bitcreed.us/src/popover.js',
    'usbee@bitcreed.us/src/empty-state.js']) {
    const src = readSource(relPath);
    check(`${relPath} is readable`, src.length > 0);
    const wraps = (src.match(/\.clutter_text\.line_wrap\s*=\s*true/g) || []).length;
    const clears = (src.match(
        /\.clutter_text\.ellipsize\s*=\s*Pango\.EllipsizeMode\.NONE/g) || []).length;
    check(`${relPath} sets line_wrap somewhere`, wraps > 0);
    check(`${relPath} clears ellipsize at least once per wrapping label`,
        clears >= wraps);
    check(`${relPath} imports Pango`, src.includes("from 'gi://Pango'"));
}

print('# property rows never truncate the key column');
{
    const src = readSource('usbee@bitcreed.us/src/popover.js');
    // With an ellipsize mode set, ClutterText reports a minimum width of 0 and
    // a squeezed row can cut the key too; ellipsize NONE without wrap pins the
    // minimum to the natural width instead.
    check('popover.js clears ellipsize on the key label',
        src.includes('keyLbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE'));
    check('popover.js clears ellipsize on the value label',
        /valLbl\.clutter_text\.ellipsize\s*=\s*Pango\.EllipsizeMode\.NONE/.test(src));
    check('popover.js top-aligns the key beside a wrapped value',
        /y_align:\s*Clutter\.ActorAlign\.START/.test(src));
}

print('# device-store.js has a Tier-0 issue tier');
{
    const src = readSource('usbee@bitcreed.us/src/device-store.js');
    check('device-store.js source is readable', src.length > 0);
    check('device-store.js widens hasIssue with hasLinkIssue',
        src.includes('return hasLinkIssue(device)'));
    check('device-store.js has a limited-charging tile subtitle',
        src.includes("_('%s — limited')"));
    check('device-store.js has a slow-link tile title',
        src.includes("_('Slow USB link')"));
    check('device-store.js shares formatRate with the popover',
        src.includes('formatRate(cap.negotiatedMbps)'));
    check('device-store.js exposes setDaemonTooNew', src.includes('setDaemonTooNew()'));

    // Quick task 260917-hkf — Tier 2 names a link CAPABILITY brand and
    // qualifies it, and the ranking is not duplicated here: it comes from
    // the zero-import module where it can really be unit-tested above.
    check('device-store.js delegates the tile ranking to link-verdict.js',
        src.includes('deriveCapabilityTile('));
    check('the capability brand title goes through gettext',
        src.includes("_('USB %s')"));
    check('the below-capability subtitle goes through gettext',
        src.includes("_('linked at %s')"));
    check('the unlinked subtitle goes through gettext',
        src.includes("_('not linked')"));
    check('the full-capability subtitle goes through gettext',
        src.includes("_('full capability')"));

    // Quick task 260915-ung — the pill must not report a measured zero while
    // the very first snapshot is still in flight.
    check('device-store.js has a loading branch in tileText',
        /case DaemonState\.RUNNING:[\s\S]*?if \(this\.awaitingFirstSnapshot\)[\s\S]*?_\('Loading…'\)/.test(src));
    check('the loading branch is guarded by the store getter',
        src.includes('if (this.awaitingFirstSnapshot)'));
    // deriveTileText is a pure function over a device array and must stay
    // ignorant of daemon lifecycle — several tiers above depend on that.
    // Slice the body out by hand: a lazy regex would run past the function
    // and match the getter further down the file.
    const deriveStart = src.indexOf('export function deriveTileText');
    const deriveBody = deriveStart < 0 ? ''
        : src.slice(deriveStart, src.indexOf('\n/**', deriveStart));
    check('deriveTileText stays unaware of the daemon lifecycle',
        deriveBody !== '' && !deriveBody.includes('awaitingFirstSnapshot'));
    // Quick task 260917-hkf — every tile title is now a gettext call, so no
    // tier may build one by template literal. The pre-change source DID
    // match this regex (verified before the change landed), so the guard is
    // not vacuous; the deriveBody !== '' conjunct keeps it that way if the
    // hand-slice above ever stops finding the function.
    check('no tier builds a tile title by string interpolation',
        deriveBody !== '' && !/title:\s*`/.test(deriveBody));
}

print('# notifier.js tiers the new signals correctly');
{
    const src = readSource('usbee@bitcreed.us/src/notifier.js');
    check('notifier.js source is readable', src.length > 0);
    check('notifier.js handles DataRateDegraded',
        src.includes('onDataRateDegraded(id, summary, _detail, headline)'));
    check('notifier.js handles DataRateRestored', src.includes('onDataRateRestored(id)'));
    check('DataRateDegraded honours the suppression window',
        src.includes('onDataRateDegraded') && src.includes('this._suppressUntil'));
    check('DataRateDegraded coalesces in the shared map',
        src.includes('this._notifications.set(id, notification)'));
    // Dismiss-only: the handler destroys a coalesced notification and never
    // constructs one. Slice the method body out by hand — a lazy regex
    // would run past the closing brace and match a later constructor.
    const restoredStart = src.indexOf('onDataRateRestored(id) {');
    const restoredBody = restoredStart < 0 ? ''
        : src.slice(restoredStart, src.indexOf('\n    }', restoredStart));
    check('DataRateRestored is dismiss-only (no new Notification)',
        restoredBody !== ''
        && restoredBody.includes('.destroy(')
        && !restoredBody.includes('new MessageTray.Notification'));
    // Quick task 260910-o99 — usbeehive composes the DataRateDegraded detail
    // as "…; move it to a faster port or use a cable that supports it"
    // (usbeehive src/bos.rs:824). It is daemon-asserted, so USBee neither
    // renders it nor splits it: the body is composed here under gettext.
    // Slice out _emitDataRateDegraded so a later _emitDegraded (charging,
    // where the daemon's detail IS rendered and is remedy-free) cannot
    // satisfy the guard by accident.
    const drStart = src.indexOf('\n    _emitDataRateDegraded(');
    const drBody = drStart < 0 ? ''
        : src.slice(drStart, src.indexOf('\n    }', drStart));
    check('DataRateDegraded body is composed by USBee, not the daemon',
        drBody !== ''
        && !/body\s*=\s*detail/.test(drBody)
        && drBody.includes("_('The cause could be the cable, the port, or a hub in between')"));
    check('the daemon detail never reaches a DataRateDegraded notification',
        src.includes('onDataRateDegraded(id, summary, _detail, headline)')
        && !/_emitDataRateDegraded\([^)]*detail/.test(src));
    check('notifier.js reads data-rate-mutes live',
        src.includes("this._settings.get_value('data-rate-mutes')"));
    check('notifier.js delegates the toast decision to notify-policy.js',
        src.includes('shouldToastDeviceChange(scope, kind)'));
}

// --- Summary ----------------------------------------------------------------
print('');
if (failures === 0)
    print('ALL TESTS PASSED');
else
    print(`${failures} ASSERTION(S) FAILED`);

System.exit(failures === 0 ? 0 : 1);
