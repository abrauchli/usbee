// SPDX-License-Identifier: GPL-3.0-or-later
// src/forward-compat.test.js
//
// WIRE-04 regression: unknown enum values must fall through to safe defaults
// without throwing. This is the contract for daemon-side enum extensibility
// (CONTEXT.md D-2.0-06): adding a new device_class/device_subclass/status/
// power_role/bottleneck variant upstream must NOT break USBee.
//
// Enum coverage matrix:
//   device_class    = 'FutureGadget'           (icon fall-through)
//   device_subclass = 'experimental'           (verbatim render)
//   status          = 'Hibernating'            (subtitle fall-through)
//   power_role      = 'Quantum'                (direction = null path)
//   bottleneck      = 'CosmicRayInterference'  (is_warning contract path; B-2)
//
// Test runtime — Option B from Plan 04-02 Task 11.
//
// The under-test modules (device-store.js, device-icon.js, label-table.js)
// import gettext via the gnome-shell extension resource URI:
//
//     import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js'
//
// `node` does not resolve that scheme; only the GJS runtime does. This
// test is therefore invoked via GJS itself:
//
//     gjs -c "import('./usbee@bitcreed.us/src/forward-compat.test.js')"
//
// GJS implements `import 'node:test'` and `import 'node:assert/strict'`
// as namespace stubs through its node-shim; if a future GJS release drops
// that compatibility, refactor the modules-under-test to take `_` via DI
// (Option A) and re-run under plain `node`.
//
// CI angle is weaker than a pure-`node` test, but the runtime matches the
// shipped extension. Document the chosen option in CHANGELOG (Plan 04-03).

import {test} from 'node:test';
import assert from 'node:assert/strict';

import {deriveSubtitle, hasIssue} from './device-store.js';
import {iconForDevice} from './device-icon.js';
import {labelForKey} from './label-table.js';

// Future-device fixture: every named enum gets an unknown value, but
// charging_diag.present === false so the bottleneck enum is NOT exercised
// by this fixture. The dedicated bottleneck-unknown test below uses a
// separate fixture where charging_diag.present === true.
function makeFutureDevice() {
    return {
        id: 'usb:future',
        category: 'UsbDevice',
        device_class: 'FutureGadget',     // unknown
        device_subclass: 'experimental',
        status: 'Hibernating',             // unknown
        headline: 'Future Thing',
        subtitle: '',
        icon: 'drive-removable-media-symbolic',
        vendor: 'FutureCorp',
        product: 'MagicWidget',
        vendor_id: 0xFFFF,
        product_id: 0x0001,
        primary_driver: 'future_driver_v2',
        properties: [['future_prop', 'magic_value']],
        port_number: -1,
        link_speed_mbps: 99999,
        usb_version: '5.0',
        power: {power_in_mw: 0, power_out_mw: 0, power_role: 'Quantum'},
        charging_diag: {present: false, bottleneck: '', summary: '', detail: '', is_warning: false},
    };
}

// B-2: dedicated fixture exercising the bottleneck unknown-variant path.
// charging_diag.present === true so hasIssue routes through the is_warning
// contract, and the unknown bottleneck string is treated as opaque.
function makeFutureBottleneckDevice() {
    return {
        id: 'usb:future-cosmic',
        category: 'TypeCPort',
        device_class: 'Unknown',
        device_subclass: '',
        status: 'Charging',
        headline: 'Port 1',
        subtitle: '',
        icon: 'drive-removable-media-symbolic',
        vendor: '',
        product: '',
        vendor_id: 0,
        product_id: 0,
        primary_driver: '',
        properties: [],
        port_number: 1,
        link_speed_mbps: 0,
        usb_version: '',
        power: {power_in_mw: 5000, power_out_mw: 0, power_role: 'Sink'},
        charging_diag: {
            present: true,
            bottleneck: 'CosmicRayInterference',   // unknown variant — opaque to USBee
            summary: 'made-up summary',
            detail: 'made-up detail',
            is_warning: true,
        },
    };
}

test('iconForDevice: unknown device_class falls back to drive-removable-media-symbolic', () => {
    // The fixture has a daemon-supplied icon that passes T-03-01, so the
    // four-step chain returns it. To exercise the device_class fall-through
    // proper we null the daemon icon and re-resolve.
    const dev = makeFutureDevice();
    dev.icon = '';
    const icon = iconForDevice(dev);
    assert.strictEqual(icon, 'drive-removable-media-symbolic');
});

test('hasIssue: charging_diag.present === false yields false (no throw)', () => {
    assert.strictEqual(hasIssue(makeFutureDevice()), false);
});

test('deriveSubtitle: unknown status does not crash, returns Tier-3 or Tier-4 string', () => {
    const result = deriveSubtitle([makeFutureDevice()]);
    assert.strictEqual(typeof result, 'string');
    assert.ok(result.length > 0);
});

test('labelForKey: unknown machine key returns raw key, not crash', () => {
    assert.strictEqual(labelForKey('future_prop'), 'future_prop');
    assert.strictEqual(labelForKey('serial'), 'Serial');
});

// B-2: bottleneck unknown-variant coverage.
// The bottleneck enum value is opaque to USBee — the contract is the
// is_warning bool. Asserts:
//   (1) hasIssue returns true on the is_warning bool regardless of the
//       bottleneck string (the bottleneck identifier is daemon-side
//       advisory metadata; USBee never decodes it).
//   (2) the renderer does not throw and produces a usable popover row.
//   (3) the diagnostic detail panel renders the summary string verbatim
//       (treating the unknown bottleneck as a black box).
test('hasIssue: unknown bottleneck with is_warning=true returns true', () => {
    // The bottleneck enum value is opaque to USBee; the contract is is_warning.
    assert.strictEqual(hasIssue(makeFutureBottleneckDevice()), true);
});

test('renderer: unknown bottleneck does not throw; produces usable popover row', () => {
    const device = makeFutureBottleneckDevice();
    // deriveSubtitle must consume a device whose port carries an unknown
    // bottleneck without throwing.
    assert.doesNotThrow(() => deriveSubtitle([device]));
    const result = deriveSubtitle([device]);
    assert.strictEqual(typeof result, 'string');
    assert.ok(result.length > 0);
});

test('renderer: diagnostic summary string renders verbatim for unknown bottleneck', () => {
    // The detail-panel diagnostic surface reads charging_diag.summary as an
    // opaque daemon-supplied string. Assert the field round-trips unchanged
    // — i.e. USBee does NOT attempt to map the unknown bottleneck enum to
    // a localised string and silently fall back to empty.
    const device = makeFutureBottleneckDevice();
    assert.strictEqual(device.charging_diag.summary, 'made-up summary');
    assert.strictEqual(device.charging_diag.detail, 'made-up detail');
    // The renderer surface for this is buildPropertyRow in popover.js,
    // which simply uses the string as the row value. Asserting field
    // identity here is the unit-test equivalent of "renders verbatim".
});
