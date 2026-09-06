// SPDX-License-Identifier: GPL-3.0-or-later
// src/label-table.js
//
// Machine-key → gettext-wrapped display-label resolver for the daemon's
// property bag (`properties: a(ss)` of `(machine_key, value)` pairs per
// CONTEXT D-2.0-04). This module is staged by Plan 04-01 and consumed by
// Plan 04-02 Task 9 (popover.js::buildDeviceRow detail-panel rendering).
//
// Why a table rather than the v1 regex-driven label-inference helper:
// the daemon emits stable machine keys (`serial`, `mount`, `drivers`, …)
// that USBee maps 1:1 to translated labels. The v1 regex layer for parsing
// prose bullets is deleted in Plan 04-02 — this table replaces it (DISP-01).
//
// Forward-compat contract (WIRE-04): unknown keys MUST NOT throw and
// MUST NOT log an error — they fall through to the raw key string so a
// future daemon variant Just Works visually until USBee ships a label
// update. Plan 04-02 adds a regression test asserting this fallthrough.

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// LABEL_TABLE is built lazily on first labelForKey() call. Module-load-time
// gettext evaluation throws "gettext can only be called from extensions"
// because GJS's #lookupExtension() walks the call stack and finds no
// Extension scope until enable() has executed. By the time popover.js
// reaches buildDeviceRow(), the Extension instance is live and gettext
// resolves correctly.
//
// Covers every machine key declared in CONTEXT D-2.0-04. Adding or removing
// keys here without a matching daemon-side change is USBee's call to make —
// those changes belong upstream in usbeehive.
let _labelTable = null;

// Key → label thunk. The thunks defer every gettext call to first use (see
// the note above); deriving LABELLED_KEYS from the same array is what keeps
// the label set and src/property-policy.js's KNOWN_KEYS in step — a key
// labelled here but missing there would be tech-gated by accident.
const LABEL_SPECS = [
    ['serial',            () => _('Serial')],
    ['mount',             () => _('Mount')],
    ['drivers',           () => _('Drivers')],
    ['data_role',         () => _('Data role')],
    ['power_mode',        () => _('Power mode')],
    ['pd_revision',       () => _('PD revision')],
    ['plug_orientation',  () => _('Plug orientation')],
    ['pd_contract',       () => _('PD contract')],
    ['cable_speed',       () => _('Cable speed')],
    ['cable_max_current', () => _('Cable max current')],
    ['cable_max_power',   () => _('Cable max power')],
    ['cable_type',        () => _('Cable type')],
    ['cable_vendor',      () => _('Cable vendor')],
    // usbeehive 0.10.0 capability hints (additive Devices5 keys).
    ['cable.no_emarker',  () => _('Cable e-marker')],
    ['cable.data_speed_limit', () => _('Cable data limit')],
    ['usb_device',        () => _('USB device')],
    ['charger_max',       () => _('Charger max')],
    ['usb_max_power_ma',  () => _('Max bus power')],

    // ── BOS wave (quick task 260905-b0s) ─────────────────────────────
    // usb_capable_speed / usb_link_verdict have no labels: they are
    // DEDICATED_KEYS, consumed by the Link row rather than rendered raw.
    // Translators: USB SuperSpeed generation, e.g. "Gen 2x1". The only
    // key that distinguishes Gen 1x2 from Gen 2x1 — both aggregate to
    // 10 Gbps, so it cannot be computed from the link speed.
    ['usb_capable_gen',   () => _('Generation')],
    // Translators: the slowest link rate at which the device's own vendor
    // declares it fully functional.
    ['usb_functional_floor_mbps', () => _('Needs at least')],
    ['usb_bos_suppressed', () => _('Capability')],
    ['usb_altmode_state',  () => _('Alt mode')],
    ['usb_altmode_failure', () => _('Alt mode failure')],

    // ── Connector / power / kernel / hwdb wave ───────────────────────
    ['port.id',           () => _('Port')],
    ['port.connect_type', () => _('Connector')],
    ['power.source',      () => _('Powered by')],
    // Translators: a workaround the Linux kernel applies to this specific
    // device. The values are kernel identifiers and are NOT translated.
    ['kernel.quirks',     () => _('Kernel workaround')],
    // Translators: the model name from the system's USB hardware database,
    // shown when it names the actual silicon (e.g. "RTS5411 Hub") more
    // usefully than the device's own product string.
    ['product_db',        () => _('Identified as')],
];

// Every key this build can label. Compared against property-policy.js's
// KNOWN_KEYS by tests/forward-compat.test.js.
export const LABELLED_KEYS = new Set(LABEL_SPECS.map(([key]) => key));

function buildLabelTable() {
    return new Map(LABEL_SPECS.map(([key, label]) => [key, label()]));
}

/**
 * Resolve a property-bag machine-key to a translated display label.
 *
 * Unknown keys fall through to the raw key string — this is intentional
 * forward-compat behaviour (CONTEXT D-2.0-04 acceptance: "unknown keys
 * render the raw key as the row label without crashing"). The daemon
 * may add new machine keys in patch releases; USBee will render them
 * legibly (if a little technically) until a string-table update lands.
 *
 * @param {string} key  The machine key from `properties: a(ss)`.
 * @returns {string}    The translated label, or `key` verbatim on miss.
 */
export function labelForKey(key) {
    if (_labelTable === null)
        _labelTable = buildLabelTable();
    return _labelTable.get(key) ?? key;
}

// Some daemon-emitted machine keys carry numeric values whose unit is
// implicit in the key name (e.g. usb_max_power_ma → milliamps). USBee owns
// user-facing presentation (CONTEXT D-2.0-04) — append the unit at the
// renderer so the daemon does not encode it in the value string. Keys
// absent from this table render verbatim (forward-compat fallthrough).
const UNIT_BY_KEY = new Map([
    ['usb_max_power_ma', 'mA'],
    // Mbit/s — the daemon's raw unit for the BOS functional floor. Left as
    // a bare unit suffix rather than run through formatRate() so the
    // technical row shows exactly the number the daemon emitted; the
    // human-rounded form appears in the Link row instead.
    ['usb_functional_floor_mbps', 'Mb/s'],
]);

// Enum-valued keys whose wire vocabulary is a machine token that reads
// badly in a UI. Unknown values fall through verbatim — the interface's
// standing enum-extensibility convention (BOS spec §3.2, TRIM spec §3.5)
// means new tokens may appear without an interface bump.
//
// Deliberately NOT mapped: `port.peer_state` and `kernel.quirks`. Those are
// kernel vocabulary — TRIM spec §9.3 says translate the label, never the
// value.
let _valueTable = null;

function valueTable() {
    if (_valueTable === null) {
        _valueTable = new Map([
            ['port.connect_type', new Map([
                // Translators: a user-pluggable USB receptacle.
                ['hotplug',   _('hot-pluggable')],
                // Translators: a device soldered to the board — there is no
                // connector for the user to unplug.
                ['hardwired', _('built-in')],
                ['not used',  _('not in use')],
            ])],
            ['power.source', new Map([
                ['bus',  _('USB bus')],
                ['self', _('own supply')],
            ])],
            ['usb_altmode_state', new Map([
                ['NotAttempted',     _('not attempted')],
                ['Successful',       _('active')],
                ['Unsuccessful',     _('failed')],
                ['UnspecifiedError', _('error')],
            ])],
        ]);
    }
    return _valueTable;
}

// Flag keys whose wire value is the literal string "true" but whose row
// should read as prose, not a bare boolean. Lazy for the same gettext
// reason as LABEL_TABLE. Wording matches the daemon's CLI: "not visible",
// never "missing" — some UCSI firmwares simply don't populate cable nodes.
let _flagValueTable = null;

function flagValueTable() {
    if (_flagValueTable === null) {
        _flagValueTable = new Map([
            // Translators: Row value for cable.no_emarker=true — the charger
            // offers >3A but no cable e-marker is visible (non-e-marked
            // cables are limited to 3A).
            ['cable.no_emarker', _('not visible (3 A limit may apply)')],
            // Translators: Row value for usb_bos_suppressed=true. The kernel
            // deliberately never reads this device's capability descriptor,
            // so what it can do is UNKNOWN — this must never be read as
            // "the device is slow" (BOS spec §5.2).
            ['usb_bos_suppressed',
                _('unknown — the kernel skips this device\'s capability descriptor')],
        ]);
    }
    return _flagValueTable;
}

/**
 * Format a property value with its key-implied unit, if any. Empty
 * values pass through unchanged so the row renders nothing rather than
 * a dangling unit (e.g. "mA" alone).
 *
 * @param {string} key    The machine key from `properties: a(ss)`.
 * @param {string} value  The raw value string from the daemon.
 * @returns {string}      Value with unit suffix where applicable.
 */
export function formatValueForKey(key, value) {
    if (value === 'true') {
        const prose = flagValueTable().get(key);
        if (prose !== undefined)
            return prose;
    }
    const mapped = valueTable().get(key)?.get(value);
    if (mapped !== undefined)
        return mapped;
    const unit = UNIT_BY_KEY.get(key);
    if (!unit || value === '' || value === null || value === undefined)
        return value;
    return `${value} ${unit}`;
}
