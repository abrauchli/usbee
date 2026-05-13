// SPDX-License-Identifier: GPL-3.0-or-later
// src/device-icon.js
//
// Class/driver → symbolic icon mapping helper.
// Keeps the icon switch table out of popover.js (per Phase 3 ROADMAP
// Implementation Scope: "src/device-icon.js (likely new) — class/driver →
// symbolic-icon mapping helper; keeps popover.js free of the icon switch").
//
// Resolution order (UI-04):
//   1. Daemon-supplied device.icon field (defensive regex guard — T-03-01)
//   2. Category + headline/bullet keyword table
//   3. Default fallback: network-usb-symbolic

// T-03-01 mitigation: accept daemon-supplied icon names only if they match
// the GNOME symbolic icon pattern — ASCII lowercase/digit words joined by
// hyphens, ending in -symbolic. Rejects absolute paths, shell metacharacters,
// and non-symbolic names. Even a bypass would only produce a missing-icon
// glyph: St.Icon.icon_name is a theme name lookup, not a filesystem path.
const SYMBOLIC_ICON_RE = /^[a-z0-9][a-z0-9-]*-symbolic$/i;

// Keyword table for driver/headline string matching.
// Each entry: [icon-name, ...lowercased keyword fragments].
// Evaluated in declaration order; first match wins.
const KEYWORD_MAP = [
    ['input-keyboard-symbolic',   'keyboard'],
    ['input-mouse-symbolic',      'mouse', 'pointer', 'trackpad', 'touchpad'],
    ['drive-harddisk-usb-symbolic', 'storage', 'disk', 'flash drive', 'usb drive', 'ssd', 'hdd'],
    ['audio-card-symbolic',       'audio', 'sound', 'headset', 'microphone', 'headphone', 'speaker'],
    ['camera-web-symbolic',       'camera', 'webcam', 'video'],
    ['printer-symbolic',          'printer'],
    ['phone-symbolic',            'phone', 'mobile', 'android', 'iphone'],
];

/**
 * Derive the symbolic icon name for a device row.
 *
 * Resolution order (UI-04):
 *   1. daemon-supplied device.icon (if valid GNOME symbolic name per T-03-01)
 *   2. category shortcut: Hub / TypeCPort → network-usb-symbolic
 *   3. keyword scan on headline + bullets[] strings
 *   4. fallback: network-usb-symbolic
 *
 * @param {object} device  Unpacked DeviceEntry from the store.
 * @param {string} device.icon     Daemon-supplied icon name (may be empty).
 * @param {string} device.category Category string, e.g. 'Hub', 'TypeCPort', 'UsbDevice'.
 * @param {string} device.headline One-line device summary from daemon.
 * @param {string[]} device.bullets Detail strings array from daemon.
 * @returns {string} A GNOME symbolic icon theme name.
 */
export function iconForDevice(device) {
    // 1. Daemon-supplied icon — trust only if it passes the defensive regex.
    if (device.icon && SYMBOLIC_ICON_RE.test(device.icon))
        return device.icon;

    const cat = (device.category || '').toLowerCase();

    // 2. Category shortcut — Hubs and TypeC ports all share the USB icon.
    if (cat === 'hub' || cat === 'typecport')
        return 'network-usb-symbolic';

    // 3. Keyword scan on the headline ONLY (WR-01 mitigation).
    // Bullets are detail prose, not classifiers — a hub bullet that says
    // "Audio passthrough supported" must not classify the device as an
    // audio card. Headline is the daemon's one-line product summary, which
    // is the appropriate field for keyword classification.
    const haystack = (device.headline || '').toLowerCase();

    for (const [iconName, ...keywords] of KEYWORD_MAP) {
        for (const kw of keywords) {
            if (haystack.includes(kw))
                return iconName;
        }
    }

    // 4. Default fallback.
    return 'network-usb-symbolic';
}
