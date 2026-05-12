// SPDX-License-Identifier: GPL-3.0-or-later
// src/tile.js
//
// USBeeToggle (QuickMenuToggle subclass) + USBeeIndicator (SystemIndicator).
// The toggle binds its subtitle to store.subhead via store 'changed'
// (TILE-04 / LIVE-03), and rebuilds the popover lazily on
// 'open-state-changed' (D-11, Pattern 2).
//
// Per D-16: this file does NOT mount the indicator on the panel —
// extension.js owns the addExternal* / destroy lifecycle.

import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {populateDeviceRows, populateEmptyState} from './popover.js';

const USBeeToggle = GObject.registerClass(
class USBeeToggle extends QuickSettings.QuickMenuToggle {
    constructor(store, registry, extension) {
        super({
            title: _('USBee'),
            subtitle: store.subhead,
            iconName: 'network-usb-symbolic',   // RESEARCH A2 fallback in icons/usb-symbolic.svg
            toggleMode: false,                  // UI-SPEC #interactions — informational tile
        });
        this._store = store;
        this._extension = extension;
        this._prefsItem = null;
        this._prefsSeparator = null;

        // Popover header — matches Wi-Fi / BT pattern (UI-SPEC #component-inventory).
        this.menu.setHeader('network-usb-symbolic', _('USB devices'), '');

        // Lazy-populated device list section (D-11; Pattern 2).
        // Wrapped in a St.ScrollView so a long device list never pushes
        // the Preferences row (and the eventual notification toggle, etc.)
        // off-screen. The wrapper bypasses addMenuItem so keyboard focus
        // tracking is lost on row items — acceptable here because every
        // device row is `reactive: false, can_focus: false` (popover.js).
        this._rowsSection = new PopupMenu.PopupMenuSection();
        this._rowsScroll = new St.ScrollView({
            style_class: 'usbee-popover-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            enable_mouse_scrolling: true,
        });
        this._rowsScroll.set_child(this._rowsSection.actor);
        this.menu.box.add_child(this._rowsScroll);

        // Bind subtitle to the store. This is how TILE-04 / LIVE-03 get
        // their live updates: DBusClient mutates store → 'changed' fires
        // → subtitle re-reads store.subhead. Plan 01 ships hardcoded
        // subhead; Plan 02 Task 1 swaps the store's subhead getter for
        // full D-09 derivation without touching this file.
        const changedId = store.connect('changed', () => {
            this.subtitle = store.subhead;
        });
        registry.addSignal(store, changedId);

        // Lazy popover rebuild on open (D-11). Tracked via SignalRegistry.
        const openId = this.menu.connect(
            'open-state-changed', (_menu, open) => {
                if (open) this._rebuildPopover();
            });
        registry.addSignal(this.menu, openId);

        // Initial subtitle — defensive in case the store fired 'changed'
        // before we connected (e.g. if bus_watch_name appeared synchronously
        // — RESEARCH §Pitfall D).
        this.subtitle = store.subhead;

        // STATE-04 — Preferences… menu row with lock-screen gating.
        // We physically destroy/recreate the row on sessionMode 'updated'
        // (UI-SPEC pin: do NOT use item.visible = false; EGO reviewers
        // flag invisible-but-present items as a side-channel — see
        // UI-SPEC §Component-Inventory note).
        const buildPrefsRow = () => {
            if (!Main.sessionMode.allowSettings) return;
            this._prefsSeparator = new PopupMenu.PopupSeparatorMenuItem();
            this._prefsItem = new PopupMenu.PopupMenuItem(_('Preferences…')); // U+2026
            this._prefsItem.connect('activate', () => this._extension.openPreferences());
            this.menu.addMenuItem(this._prefsSeparator);
            this.menu.addMenuItem(this._prefsItem);
        };

        const destroyPrefsRow = () => {
            if (this._prefsItem)      { this._prefsItem.destroy();      this._prefsItem = null; }
            if (this._prefsSeparator) { this._prefsSeparator.destroy(); this._prefsSeparator = null; }
        };

        buildPrefsRow();

        // §Pitfall H — Main.sessionMode is a Shell singleton that survives
        // extension enable/disable; the handler MUST be tracked by
        // SignalRegistry or it leaks across cycles (D-14).
        const smId = Main.sessionMode.connect('updated', () => {
            if (Main.sessionMode.allowSettings) {
                if (!this._prefsItem) buildPrefsRow();
            } else {
                destroyPrefsRow();
            }
        });
        registry.addSignal(Main.sessionMode, smId);
    }

    _rebuildPopover() {
        if (!this._store.daemonRunning)
            populateEmptyState(this._rowsSection);
        else
            populateDeviceRows(this._rowsSection, this._store);
    }
});

export const USBeeIndicator = GObject.registerClass(
class USBeeIndicator extends QuickSettings.SystemIndicator {
    constructor(store, registry, extension) {
        super();
        // Stored for symmetry — Plan 02-02 may grow indicator-level
        // prefs hooks without another constructor signature change.
        this._extension = extension;
        this._toggle = new USBeeToggle(store, registry, extension);
        this.quickSettingsItems.push(this._toggle);
        // No this._addIndicator() panel icon — RESEARCH Open Question Q6:
        // Quick Settings tiles already show in the panel; an extra panel
        // icon would be redundant.
    }
});
