// SPDX-License-Identifier: GPL-3.0-or-later
// src/label-table.js
//
// Machine-key → gettext-wrapped display-label resolver for the Devices2
// property bag (`properties: a(ss)` of `(machine_key, value)` pairs per
// CONTEXT D-2.0-04). This module is staged by Plan 04-01 and consumed by
// Plan 04-02 Task 9 (popover.js::buildDeviceRow detail-panel rendering).
//
// Why a table rather than `keyForBullet()`-style regex: Devices2 emits
// stable machine keys (`serial`, `mount`, `drivers`, …) that USBee maps
// 1:1 to translated labels. The v1 regex layer for parsing prose bullets
// is deleted in Plan 04-02 — this table replaces it (DISP-01).
//
// Forward-compat contract (WIRE-04): unknown keys MUST NOT throw and
// MUST NOT log an error — they fall through to the raw key string so a
// future daemon variant Just Works visually until USBee ships a label
// update. Plan 04-02 adds a regression test asserting this fallthrough.

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// LABEL_TABLE covers every machine key declared in CONTEXT D-2.0-04.
// Adding or removing keys here without a matching daemon-side change is
// USBee's call to make — those changes belong upstream in usbeehive.
const LABEL_TABLE = new Map([
    ['serial',           _('Serial')],
    ['mount',            _('Mount')],
    ['drivers',          _('Drivers')],
    ['data_role',        _('Data role')],
    ['power_mode',       _('Power mode')],
    ['pd_revision',      _('PD revision')],
    ['plug_orientation', _('Plug orientation')],
    ['pd_contract',      _('PD contract')],
    ['cable_speed',      _('Cable speed')],
    ['cable_current',    _('Cable current')],
    ['cable_max_power',  _('Cable max power')],
    ['cable_type',       _('Cable type')],
    ['cable_vendor',     _('Cable vendor')],
    ['charger_max',      _('Charger max')],
    ['usb_power_ma',     _('USB bus power')],
]);

/**
 * Resolve a Devices2 property machine-key to a translated display label.
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
    return LABEL_TABLE.get(key) ?? key;
}
