// SPDX-License-Identifier: GPL-3.0-or-later
// src/notifier.js
//
// MessageTray-based notifier for CapabilityDegraded / CapabilityRestored
// events forwarded by src/dbus-client.js.
//
// Contract (see 02-01-PLAN.md <interfaces>):
//   constructor(settings, registry, extension)
//   onDaemonAppeared()      — start the 2.5 s suppression window
//   onDaemonVanished()      — destroy every live notification + clear map
//   onCapabilityDegraded(portNumber, summary, detail)
//   onCapabilityRestored(portNumber)
//   dispose()               — destroy source + all notifications
//
// Invariants:
//   - Plain ES class (not GObject) — D-17 / RESEARCH §Code Example #1.
//   - One MessageTray.Source created lazily on first emit; nulled by its
//     own 'destroy' signal handler so the next emit re-creates it
//     (RESEARCH §Pitfall B).
//   - Per-port coalescing: one Notification object per portNumber stored
//     in this._notifications; second event reuses it via .update()
//     (RESEARCH §Pitfall A — the 46 refactor removed the legacy
//     replace-id constructor parameter).
//   - port-mutes is read LIVE every CapabilityDegraded — never cached
//     (RESEARCH §Pitfall G).
//   - Daemon strings (summary, detail) flow ONLY into plain text properties.
//     Never enable Pango markup on the notification body and never run
//     daemon strings through template interpolation (RESEARCH §Security V5).

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// 2.5 s in microseconds (GLib.get_monotonic_time units). Drops the burst
// of CapabilityDegraded events that the daemon may replay immediately
// after NameOwnerChanged null->owner. RESEARCH §Code Example #3.
const SUPPRESSION_WINDOW_US = 2_500_000;

export class Notifier {
    constructor(settings, registry, extension) {
        // Gio.Settings bound to org.gnome.usbee — extension.getSettings().
        this._settings = settings;
        // SignalRegistry — stored for symmetry with DBusClient. The
        // Notifier registers nothing on it today; per-Notification and
        // per-Source 'destroy' handlers are self-cleaning. Future rate-cap
        // timers would land here.
        this._registry = registry;
        // The Extension instance — used by the 'Open Preferences' action
        // to call extension.openPreferences() (RESEARCH §Pitfall K).
        this._extension = extension;

        // portNumber (int) -> MessageTray.Notification
        this._notifications = new Map();
        // Lazily constructed in _ensureSource(), nulled by its 'destroy'.
        this._source = null;
        // Monotonic deadline; events with now < _suppressUntil are dropped.
        this._suppressUntil = 0;
    }

    onDaemonAppeared() {
        this._suppressUntil = GLib.get_monotonic_time() + SUPPRESSION_WINDOW_US;
    }

    onDaemonVanished() {
        // Destroying inside the iteration is fine — the destroy handler
        // mutates the map but we use .values() snapshot semantics via
        // Array.from to be safe against future SpiderMonkey changes.
        for (const n of Array.from(this._notifications.values())) {
            try {
                n.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
            } catch (_e) {
                // Already destroyed — no recovery needed.
            }
        }
        this._notifications.clear();
    }

    onCapabilityDegraded(portNumber, summary, detail) {
        const now = GLib.get_monotonic_time();
        if (now < this._suppressUntil) return;

        // LIVE read — never cache (RESEARCH §Pitfall G / §Pattern 2).
        const mutes = this._settings.get_strv('port-mutes');
        if (mutes.includes(String(portNumber))) return;

        this._emitDegraded(portNumber, summary, detail);
    }

    onCapabilityRestored(portNumber) {
        const existing = this._notifications.get(portNumber);
        if (!existing) return;
        try {
            existing.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
        } catch (_e) {
            // Already destroyed — the destroy handler will null the map entry.
        }
    }

    _ensureSource() {
        if (this._source) return this._source;

        this._source = new MessageTray.Source({
            title: _('USBee'),
            iconName: 'network-usb-symbolic',
        });

        // RESEARCH §Pitfall B — Source destroys itself when the user
        // dismisses the last notification; we MUST null our ref so the
        // next emit recreates it. Otherwise we'd hand out a dead handle.
        this._source.connect('destroy', () => {
            this._source = null;
        });

        Main.messageTray.add(this._source);
        return this._source;
    }

    _emitDegraded(portNumber, summary, detail) {
        const source = this._ensureSource();

        // UI-SPEC §Copywriting — em-dash is U+2014 (single character).
        // The _(...).format(...) shape is mandatory: xgettext silently
        // skips template literals (RESEARCH §Pitfall I).
        const title = _('USB-C Port %d — %s').format(portNumber, summary);
        // Daemon string verbatim — never wrap in _(), never markup
        // (RESEARCH §Security V5, DIAG-02).
        const body = detail;

        const existing = this._notifications.get(portNumber);
        if (existing) {
            // RESEARCH §Code Example #2 — {clear: true} drops prior actions
            // so we re-addAction without duplicating buttons.
            existing.update(title, body, {clear: true});
            this._addActions(existing, portNumber);
            return;
        }

        // RESEARCH §Standard Stack — Urgency.NORMAL: degraded charging is
        // informational, not safety-critical. HIGH would override DND.
        const notification = new MessageTray.Notification({
            source,
            title,
            body,
            iconName: 'network-usb-symbolic',
            urgency: MessageTray.Urgency.NORMAL,
        });

        this._addActions(notification, portNumber);

        // RESEARCH §Pitfall C — identity check prevents a stale destroy
        // callback (fired AFTER a new notification replaced this one in
        // the map) from clobbering the new entry.
        notification.connect('destroy', (_n, _reason) => {
            if (this._notifications.get(portNumber) === notification)
                this._notifications.delete(portNumber);
        });

        this._notifications.set(portNumber, notification);
        source.addNotification(notification);
    }

    _addActions(notification, portNumber) {
        // UI-SPEC §Focal-Point — primary mute first, secondary prefs second.
        notification.addAction(_("Don't notify for this port again"), () => {
            this._muteByPort(portNumber);
        });
        // Note: when the screen is locked, the Shell silently refuses to
        // open the prefs window. STATE-04 already hides the tile-menu
        // Preferences row in that state, but the notification action
        // surface is outside our gating reach (RESEARCH §Pitfall K).
        notification.addAction(_('Open Preferences'), () => {
            this._extension.openPreferences();
        });
    }

    _muteByPort(portNumber) {
        // RESEARCH §Pitfall F — port-mutes is `as`; the daemon's
        // port_number is `i`. Always stringify on write, compare as
        // strings on read.
        const id = String(portNumber);
        const mutes = this._settings.get_strv('port-mutes');
        // Defensive — the user could double-click the action button.
        if (mutes.includes(id)) {
            const n = this._notifications.get(portNumber);
            if (n) n.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
            return;
        }
        mutes.push(id);
        this._settings.set_strv('port-mutes', mutes);

        // UI-SPEC §Interactions — the user's intent is "make this go away
        // now". The map entry is cleared by the destroy handler.
        const n = this._notifications.get(portNumber);
        if (n) n.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    }

    dispose() {
        // Drop live notifications first; then destroy the source. The
        // source's 'destroy' handler will null this._source.
        this.onDaemonVanished();
        if (this._source) {
            try {
                this._source.destroy();
            } catch (_e) {
                // Already destroyed — no recovery needed.
            }
            this._source = null;
        }
    }
}
