// SPDX-License-Identifier: GPL-3.0-or-later
// src/property-policy.js
//
// The rendering tier of every `properties: a(ss)` machine key the daemon
// may emit. One table, four tiers, consulted by src/popover.js's property
// loop and mirrored in the `show-technical-details` schema description.
//
// THIS MODULE MUST HAVE ZERO IMPORTS — same contract as src/daemon-status.js.
// It carries no user-visible strings (labels live in src/label-table.js), so
// it needs no gettext, and staying import-free is what lets bare-gjs CI
// unit-test the containment policy directly (tests/forward-compat.test.js).
//
// ── The tiers ────────────────────────────────────────────────────────────
//   hidden     — never a row at any setting. Wire-only keys with no user
//                meaning; still reachable through the daemon's SnapshotJson.
//   dedicated  — never a *bare* row: a purpose-built widget owns the key
//                (transport pills, cable-trust row, Link row, hub rows,
//                alt-mode row).
//   tech       — rendered only when `show-technical-details` is on. Both
//                the curated advanced keys AND every key this build does
//                not know (see the reversal note below).
//   default    — always rendered.
//
// ── Decision reversal (quick task 260905-b0s §D-2) ───────────────────────
// Quick task 260526-c6p §"Property split — Balanced" LOCKED an
// explicit-deny policy: unknown keys always render. That was right while
// usbeehive added a key or two per release. The BOS + connector waves add
// 24 keys at once, several opaque to any user (`usb_bos_container_id` is a
// bare UUID), so an unmodified extension would print ~12 raw
// `machine_key: value` rows per device the day the daemon updates.
// The reversal — authorised by the user on 2026-09-05 — narrows the
// forward-compat guarantee from "unknown keys are visible by default" to
// "unknown keys never throw, never log, and stay one toggle away".
// Rationale in .planning/quick/260905-b0s-bos-trim-consumer-ui/.

/**
 * Keys with no user meaning at any tier. Never rendered; reachable only
 * through the daemon's SnapshotJson for bug reports.
 *
 *   usb_link_degraded      — redundant with usb_link_verdict (BOS spec §3.1)
 *   usb_bos_container_id   — a bare UUID; identifies nothing to a human
 *   usb_capable_speed_mbps — numeric twin of the usb_capable_speed label
 *   usb_capable_rx_lanes   — the Gen label already encodes x1 / x2
 *   usb_capable_tx_lanes   — ditto
 *   port.peer_id           — an opaque kernel object name
 */
export const HIDDEN_KEYS = new Set([
    'usb_link_degraded',
    'usb_bos_container_id',
    'usb_capable_speed_mbps',
    'usb_capable_rx_lanes',
    'usb_capable_tx_lanes',
    'port.peer_id',
]);

/**
 * Keys consumed by a dedicated UI surface, filtered out of the generic
 * property loop unconditionally so they never double-render beside their
 * own widget.
 */
export const DEDICATED_KEYS = new Set([
    // Cable-trust row (quick task 260526-dmj §B).
    'cable.trust.zero_vid',
    'cable.trust.vid_unknown',
    'cable.trust.reserved_bits',
    // Transport pill strip (quick task 260526-dmj §C).
    'transport.usb2',
    'transport.usb3',
    'transport.usb4',
    'transport.dp_altmode',
    'transport.tb',
    // Link row + verdict copy (quick task 260905-b0s §D-1/D-3).
    'usb_link_verdict',
    'usb_capable_speed',
    // Connector hint under the Link row (§D-4).
    'port.peer_state',
    // Hub occupancy + bus-power rows.
    'hub.ports_total',
    'hub.ports_used',
    'hub.power_budget_ma',
    'hub.power_committed_ma',
    // Alt-mode row — the SVID list is the row's label, not a row of its own.
    'usb_altmode_svids',
]);

/**
 * Curated advanced keys: known, labelled, but too technical for the
 * default panel. Rendered when `show-technical-details` is on.
 */
export const GATED_KEYS = new Set([
    // Quick task 260526-c6p §"Property split — Balanced".
    'serial',
    'data_role',
    'power_mode',
    'pd_revision',
    'plug_orientation',
    'cable_max_current',
    'cable_type',
    'drivers',
    // BOS wave (quick task 260905-b0s).
    'usb_capable_gen',
    'usb_functional_floor_mbps',
    'usb_bos_suppressed',
    'usb_altmode_state',
    'usb_altmode_failure',
    // Connector / power / kernel / hwdb wave.
    'port.id',
    'port.connect_type',
    'power.source',
    'kernel.quirks',
    'product_db',
]);

/**
 * Every key this build knows how to label. A key here that is neither
 * DEDICATED nor GATED renders in the default panel.
 *
 * tests/forward-compat.test.js asserts this set and the label table in
 * src/label-table.js stay in step — a labelled key missing here would be
 * tech-gated by accident, and a key here without a label would render its
 * raw machine key as the row title.
 */
export const KNOWN_KEYS = new Set([
    // Default tier — glanceable facts.
    'mount',
    'pd_contract',
    'cable_speed',
    'cable_max_power',
    'cable_vendor',
    'cable.no_emarker',
    'cable.data_speed_limit',
    'usb_device',
    'charger_max',
    'usb_max_power_ma',
    ...GATED_KEYS,
    ...DEDICATED_KEYS,
    ...HIDDEN_KEYS,
]);

/**
 * Which tier a machine key belongs to.
 *
 * @param {string} key  Machine key from the daemon's `properties` bag.
 * @returns {'hidden'|'dedicated'|'tech'|'default'}
 */
export function propertyTier(key) {
    if (HIDDEN_KEYS.has(key)) return 'hidden';
    if (DEDICATED_KEYS.has(key)) return 'dedicated';
    if (GATED_KEYS.has(key)) return 'tech';
    // The reversal: an unrecognised key is technical by default.
    if (!KNOWN_KEYS.has(key)) return 'tech';
    return 'default';
}

/**
 * Should the generic property loop render a bare row for this key?
 *
 * @param {string} key        Machine key from the daemon's `properties` bag.
 * @param {boolean} showTech  Live read of the show-technical-details setting.
 * @returns {boolean}
 */
export function shouldRenderProperty(key, showTech) {
    const tier = propertyTier(key);
    if (tier === 'hidden' || tier === 'dedicated') return false;
    if (tier === 'tech') return showTech === true;
    return true;
}

/**
 * True when the key only ever appears under "Show technical details" —
 * used to place the one-off "Technical details" separator above the first
 * such row so the panel reads as two tiers rather than one long list.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isTechnicalKey(key) {
    return propertyTier(key) === 'tech';
}
