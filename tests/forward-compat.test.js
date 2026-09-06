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
    deriveAltMode, deriveHubInfo, deriveLinkInfo, formatRate, hasLinkIssue,
    propsOf, resolveHeadline,
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

// --- The connector hint (BOS §6 × TRIM §6) ---------------------------------

print('# deriveLinkInfo — port.peer_state explains, never warns');
{
    const info = deriveLinkInfo(hubWithDeadCompanion());
    check('BelowCapability + not attached → SS-never-linked hint',
        info.connectorHint === 'ss-never-linked');
    check('…and it is still not a warning', info.isWarning === false);
}
{
    const dev = hubWithDeadCompanion();
    dev.properties = dev.properties.map(
        ([k, v]) => k === 'port.peer_state' ? [k, 'reconnecting'] : [k, v]);
    check('BelowCapability + reconnecting → unstable hint',
        deriveLinkInfo(dev).connectorHint === 'ss-unstable');
}
{
    const dev = hubWithDeadCompanion();
    dev.properties = dev.properties.map(
        ([k, v]) => k === 'port.peer_state' ? [k, 'configured'] : [k, v]);
    check('BelowCapability + configured → "lanes are up elsewhere"',
        deriveLinkInfo(dev).connectorHint === 'ss-elsewhere');
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
    check('popover.js shows hubs that have an issue',
        src.includes("d.category !== 'Hub' || hasIssue(d)"));
    check('popover.js returns the issue count for the header',
        src.includes('issues: devices.filter(hasIssue).length'));
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
        src.includes('formatRate(top.link_speed_mbps)'));
    check('device-store.js exposes setDaemonTooNew', src.includes('setDaemonTooNew()'));
}

print('# notifier.js tiers the new signals correctly');
{
    const src = readSource('usbee@bitcreed.us/src/notifier.js');
    check('notifier.js source is readable', src.length > 0);
    check('notifier.js handles DataRateDegraded',
        src.includes('onDataRateDegraded(id, summary, detail, headline)'));
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
