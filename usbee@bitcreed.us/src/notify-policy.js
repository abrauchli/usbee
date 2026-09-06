// SPDX-License-Identifier: GPL-3.0-or-later
// src/notify-policy.js
//
// The "does this event deserve a notification, and is it muted" decisions,
// split out of src/notifier.js so they can be unit-tested under bare gjs
// (notifier.js itself imports gnome-shell's MessageTray and can only run
// inside the Shell).
//
// THIS MODULE MUST HAVE ZERO IMPORTS — same contract as src/daemon-status.js.
//
// Two mute lists, two key types:
//   - `port-mutes`      `as`    — stringified Type-C port numbers, for
//                                 CapabilityDegraded (charging).
//   - `data-rate-mutes` `a(ss)` — (device id, headline) pairs, for
//                                 DataRateDegraded. The headline is stored
//                                 so the preferences row can name the
//                                 device instead of showing `usb:5-2.1.1`.
//
// Keying data-rate mutes on the device `id` is deliberate: the id is
// topological (`usb:<bus_port>`), so "this device on this port" is exactly
// the thing being muted — and moving it to a faster port changes the id
// *and* clears the condition.

/**
 * Normalise a raw `data-rate-mutes` GSettings value into `[id, headline]`
 * pairs. Tolerates poisoned entries written out-of-band with `gsettings`
 * (a malformed list must never break the notifier or the prefs window).
 *
 * @param {*} raw  Result of settings.get_value('data-rate-mutes').deep_unpack().
 * @returns {Array<[string, string]>}
 */
export function dataRateMuteEntries(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
        if (!Array.isArray(entry)) continue;
        const [id, headline] = entry;
        if (typeof id !== 'string' || id === '') continue;
        out.push([id, typeof headline === 'string' ? headline : '']);
    }
    return out;
}

/**
 * @param {Array<[string, string]>} entries  From dataRateMuteEntries().
 * @param {string} id                        Daemon device id.
 * @returns {boolean}
 */
export function isDataRateMuted(entries, id) {
    return entries.some(([mutedId]) => mutedId === id);
}

/**
 * Add a mute, idempotently. Returns a NEW array — the caller writes it
 * back to GSettings, which is what makes the prefs list refresh.
 *
 * @param {Array<[string, string]>} entries
 * @param {string} id
 * @param {string} headline  Display name; falls back to the id.
 * @returns {Array<[string, string]>}
 */
export function withDataRateMute(entries, id, headline) {
    if (isDataRateMuted(entries, id)) return entries.slice();
    return [...entries, [id, headline || id]];
}

/**
 * Remove a mute by id.
 *
 * @param {Array<[string, string]>} entries
 * @param {string} id
 * @returns {Array<[string, string]>}
 */
export function withoutDataRateMute(entries, id) {
    return entries.filter(([mutedId]) => mutedId !== id);
}

/**
 * Should a DeviceAdded / DeviceRemoved signal raise a transient toast?
 *
 * Three gates, in order:
 *
 *  1. `device-change-notify-scope`. 'off' suppresses everything; 'power'
 *     keeps only charging-relevant devices; anything else (including a
 *     value this build does not know) default-allows, matching the schema
 *     <choices> guard and the forward-compat intent of CONTEXT 260526-c6p.
 *  2. `port.connect_type == 'hardwired'` — a soldered-down device the user
 *     cannot unplug. These re-enumerate on suspend/resume and under
 *     RESET_RESUME quirks, producing "Disconnected: … / Connected: …" pairs
 *     nobody can act on. Suppressed under every scope.
 *  3. `kind === undefined` — the store had no entry for this id yet, which
 *     is normal for DeviceAdded (the signal races ahead of ListDevices).
 *     Default-allow rather than silently dropping the toast; the hardwired
 *     filter is therefore reliable for Removed (pre-removal lookup) and
 *     only best-effort for Added, where it still catches re-enumeration of
 *     a device the store already knows.
 *
 * @param {string} scope  Live `device-change-notify-scope` value.
 * @param {?{category: string, deviceClass: string, connectType: string}} kind
 * @returns {boolean}
 */
export function shouldToastDeviceChange(scope, kind) {
    if (scope === 'off') return false;
    if (kind === undefined || kind === null) return true;
    if (kind.connectType === 'hardwired') return false;
    if (scope === 'power') {
        return kind.category === 'TypeCPort'
            || kind.deviceClass === 'Phone'
            || kind.deviceClass === 'Storage';
    }
    return true;
}
