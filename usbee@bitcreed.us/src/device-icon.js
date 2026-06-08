// SPDX-License-Identifier: GPL-3.0-or-later
// src/device-icon.js
//
// device_class → symbolic icon mapping helper.
// Keeps the icon switch table out of popover.js (per ROADMAP Phase 3
// Implementation Scope: "src/device-icon.js — class → symbolic-icon
// mapping helper; keeps popover.js free of the icon switch").
//
// As of Plan 04-02 (v2.0) this module consumes the `device_class` field
// from the org.usbeehive.Devices4 wire (CONTEXT D-2.0-02; field carried
// across the Devices4 cut). The v1.x
// keyword/headline-scan heuristic is deleted; daemon-side classification
// is the source of truth and forward-compat is owned by Map.get() ?? null
// (WIRE-04: unknown variants fall through to the generic USB icon).
//
// Resolution chain (04-01-ICON-AUDIT.md):
//   1. Daemon-supplied device.icon — trusted only if it passes T-03-01.
//   2. TypeCPort shortcut — device_class is 'Unknown' for ports.
//   3. device_class enum lookup (DEVICE_CLASS_ICON).
//   4. Default fallback: drive-removable-media-symbolic.

import Gio from 'gi://Gio';

// Set by initIcons() from extension.js enable() so bundled SVGs resolve to
// an absolute path. Null until the extension enables (unit-test contexts only).
let _iconsPath = null;

/** Register the extension icon directory once on enable(). */
export function initIcons(extensionPath) {
    _iconsPath = `${extensionPath}/icons`;
}

// Icons shipped in icons/ that are not present in the system Adwaita theme.
// iconForDevice() returns a Gio.FileIcon for these so St.Icon renders them
// without a theme lookup; popover.js uses .gicon instead of .icon_name.
const BUNDLED_ICONS = new Set(['network-proxy-symbolic']);

// T-03-01 mitigation: accept daemon-supplied icon names only if they match
// the GNOME symbolic icon pattern — ASCII lowercase/digit words joined by
// hyphens, ending in -symbolic. Rejects absolute paths, shell metacharacters,
// non-symbolic names, AND mixed-case names (WR-02): the GNOME icon naming
// spec requires lowercase ASCII; mixed-case names like "Audio-Card-Symbolic"
// would silently render as the missing-icon glyph if accepted. The regex is
// strictly case-sensitive — no /i flag — so it enforces what the character
// class already documents. Even a bypass would only produce a missing-icon
// glyph: St.Icon.icon_name is a theme name lookup, not a filesystem path.
const SYMBOLIC_ICON_RE = /^[a-z0-9][a-z0-9-]*-symbolic$/;

// DEVICE_CLASS_ICON covers all 19 daemon-side device_class variants
// (CONTEXT D-2.0-02). Icon names verified against
// /usr/share/icons/Adwaita/symbolic/ in 04-01-ICON-AUDIT.md.
//
// Order roughly follows CONTEXT D-2.0-02 — input devices first, storage/
// display next, then specialty categories. Unknown is last; it's the
// daemon's explicit 'cannot classify' sentinel as well as the value the
// daemon emits for every TypeCPort entry (TypeC ports are handled by the
// category shortcut path in iconForDevice, not by this table).
const DEVICE_CLASS_ICON = new Map([
    ['Keyboard',         'input-keyboard-symbolic'],
    ['Mouse',            'input-mouse-symbolic'],
    ['Storage',          'media-removable-symbolic'],
    ['Display',          'video-display-symbolic'],
    ['Audio',            'audio-card-symbolic'],
    ['Camera',           'camera-web-symbolic'],
    ['Printer',          'printer-symbolic'],
    ['Phone',            'phone-symbolic'],
    ['Hub',              'network-proxy-symbolic'],
    ['NetworkWired',     'network-wired-symbolic'],
    ['NetworkWireless',  'network-wireless-symbolic'],
    ['InputTablet',      'input-tablet-symbolic'],
    ['Gamepad',          'input-gaming-symbolic'],
    ['SecurityKey',      'auth-fingerprint-symbolic'],
    ['SmartcardReader',  'auth-smartcard-symbolic'],
    ['Bluetooth',        'bluetooth-symbolic'],
    ['Serial',           'utilities-terminal-symbolic'],
    ['VideoCapture',     'camera-video-symbolic'],
    ['Unknown',          'drive-removable-media-symbolic'],
]);

/**
 * Derive the symbolic icon name for a device row (UI-04 / DISP-02).
 *
 * Resolution chain (04-01-ICON-AUDIT.md):
 *   1. Daemon-supplied device.icon — trusted only if it passes T-03-01.
 *   2. TypeCPort shortcut — device_class is 'Unknown' for ports.
 *   3. device_class enum lookup (WIRE-04: unknown values fall through).
 *   4. Default fallback: drive-removable-media-symbolic.
 *
 * @param {object} device              Unpacked DeviceEntry from the store.
 * @param {string} device.icon         Daemon-supplied icon name (may be empty).
 * @param {string} device.category     'Hub' | 'TypeCPort' | 'UsbDevice'.
 * @param {string} device.device_class One of the 19 CONTEXT D-2.0-02 variants.
 * @returns {string}                   A GNOME symbolic icon theme name.
 */
export function iconForDevice(device) {
    // 1. Daemon-supplied icon — trust only if it passes T-03-01.
    if (device.icon && SYMBOLIC_ICON_RE.test(device.icon))
        return device.icon;

    // 2. TypeC port shortcut — device_class is 'Unknown' for ports.
    if (device.category === 'TypeCPort')
        return 'drive-removable-media-symbolic';

    // 3. device_class enum lookup (WIRE-04: unknown values fall through).
    const fromClass = DEVICE_CLASS_ICON.get(device.device_class);
    if (fromClass) {
        // Bundled icons ship as SVGs in icons/; return Gio.FileIcon so
        // St.Icon renders them via .gicon without a system theme lookup.
        if (_iconsPath && BUNDLED_ICONS.has(fromClass))
            return Gio.icon_new_for_string(`${_iconsPath}/${fromClass}.svg`);
        return fromClass;
    }

    // 4. Default fallback — generic USB icon.
    return 'drive-removable-media-symbolic';
}
