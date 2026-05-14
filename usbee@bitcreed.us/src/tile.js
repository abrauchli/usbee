// SPDX-License-Identifier: GPL-3.0-or-later
// src/tile.js
//
// USBeeToggle (QuickMenuToggle subclass) + USBeeIndicator (SystemIndicator).
// The toggle binds its two-line title/subtitle to store.tileText via store
// 'changed' (TILE-04 / LIVE-03), and rebuilds the popover lazily on
// 'open-state-changed' (D-11, Pattern 2).
//
// Per D-16: this file does NOT mount the indicator on the panel —
// extension.js owns the addExternal* / destroy lifecycle.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {populateDeviceRows, populateEmptyState, populateOutOfDateState} from './popover.js';

const USBeeToggle = GObject.registerClass(
class USBeeToggle extends QuickSettings.QuickMenuToggle {
    constructor(store, registry, extension, dbusClient) {
        const initial = store.tileText;
        // USB trident logo. Adwaita does not ship a 'usb-symbolic' icon-name,
        // so the SVG is bundled in the extension and loaded by absolute path
        // via Gio.FileIcon. Using gicon (not iconName) bypasses the system
        // icon-theme lookup entirely, so the rendering is independent of the
        // user's GTK icon theme.
        const usbGicon = Gio.icon_new_for_string(
            `${extension.path}/icons/usb-symbolic.svg`);
        super({
            title:    initial.title,
            subtitle: initial.subtitle,
            gicon:    usbGicon,
            toggleMode: false,  // UI-SPEC #interactions — informational tile (no daemon toggle)
        });
        this._store = store;
        this._extension = extension;
        this._dbusClient = dbusClient;
        this._prefsItem = null;
        this._prefsSeparator = null;
        // COMPAT-02 latched flag: once DBusClient declares the daemon too
        // old, _rebuildPopover routes to populateOutOfDateState until the
        // next 'ready' (or the next daemon-vanish/appear cycle through the
        // store's 'changed' signal). Without this latch, _rebuildPopover
        // could fall back to populateEmptyState ("daemon not running") on
        // the next popover open since DBusClient sets daemonRunning=false
        // before emitting 'daemon-too-old'.
        this._daemonTooOld = false;

        // Popover header — matches Wi-Fi / BT pattern (UI-SPEC #component-inventory).
        this.menu.setHeader('drive-removable-media-symbolic', _('USB devices'), '');

        // Lazy-populated device list section (D-11; Pattern 2).
        // Wrapped in a St.ScrollView so a long device list never pushes
        // the Preferences row (and the eventual notification toggle, etc.)
        // off-screen. The wrapper bypasses addMenuItem so keyboard focus
        // tracking is lost on row items — acceptable here because every
        // device row is `reactive: false, can_focus: false` (popover.js).
        this._rowsSection = new PopupMenu.PopupMenuSection();
        this._rowsSection.actor.add_style_class_name('usbee-device-section');

        // PopupSubMenuMenuItem.open()/close() calls this._getTopMenu()
        // ._setOpenedSubMenu(...) to coordinate which submenu is open.
        // _getTopMenu() walks up the actor parent chain and stops at the
        // FIRST PopupMenuBase delegate it finds — which here is the
        // PopupMenuSection above (not the QuickSettings menu further up).
        // Neither PopupMenuSection nor QuickSettings' menu implement
        // _setOpenedSubMenu; without these shims every row open/close
        // throws "TypeError: _setOpenedSubMenu is not a function".
        // Install on both to cover all _getTopMenu() walk outcomes.
        const setOpenedSubMenuShim = function (submenu) {
            if (this._openedSubMenu && this._openedSubMenu !== submenu)
                this._openedSubMenu.close(true);
            this._openedSubMenu = submenu;
        };
        this._rowsSection._setOpenedSubMenu = setOpenedSubMenuShim;
        this.menu._setOpenedSubMenu        = setOpenedSubMenuShim;
        this._rowsScroll = new St.ScrollView({
            style_class: 'usbee-popover-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            enable_mouse_scrolling: true,
        });
        this._rowsScroll.set_child(this._rowsSection.actor);
        this.menu.box.add_child(this._rowsScroll);

        // Bind subtitle + checked state to the store.
        // checked mirrors store.daemonRunning: true = daemon present (blue tile),
        // false = daemon absent (gray tile). toggleMode is false so clicking the
        // tile opens the menu rather than toggling checked — we only set checked
        // programmatically here.
        const changedId = store.connect('changed', () => {
            const txt = store.tileText;
            this.title    = txt.title;
            this.subtitle = txt.subtitle;
            this.checked  = this._store.daemonRunning;
        });
        registry.addSignal(store, changedId);

        // COMPAT-02: route to the "daemon out of date" empty state when
        // DBusClient declares the daemon's Version below
        // MIN_USBEEHIVE_VERSION. The latch is cleared on the next 'ready'
        // (post-restart with a new-enough daemon). STATE-05: tracked via
        // SignalRegistry so disable() correctly disconnects.
        if (dbusClient) {
            const tooOldId = dbusClient.connect('daemon-too-old', () => {
                this._daemonTooOld = true;
                if (this.menu.isOpen)
                    populateOutOfDateState(this._rowsSection);
            });
            registry.addSignal(dbusClient, tooOldId);

            const readyId = dbusClient.connect('ready', () => {
                this._daemonTooOld = false;
            });
            registry.addSignal(dbusClient, readyId);
        }

        // Lazy popover rebuild on open (D-11). Tracked via SignalRegistry.
        const openId = this.menu.connect(
            'open-state-changed', (_menu, open) => {
                if (open) this._rebuildPopover();
            });
        registry.addSignal(this.menu, openId);

        // Initial title/subtitle + checked — defensive in case the store fired
        // 'changed' before we connected (e.g. bus_watch_name appeared
        // synchronously — RESEARCH §Pitfall D).
        const initTxt = store.tileText;
        this.title    = initTxt.title;
        this.subtitle = initTxt.subtitle;
        this.checked  = store.daemonRunning;

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
        // COMPAT-02 takes precedence over the daemon-not-running state:
        // the user is being shown reachable-but-too-old, which is a
        // distinct copy from "daemon not running". The latch clears on
        // the next 'ready' signal from DBusClient.
        if (this._daemonTooOld)
            populateOutOfDateState(this._rowsSection);
        else if (!this._store.daemonRunning)
            populateEmptyState(this._rowsSection);
        else
            populateDeviceRows(this._rowsSection, this._store, this._extension);
    }
});

export const USBeeIndicator = GObject.registerClass(
class USBeeIndicator extends QuickSettings.SystemIndicator {
    constructor(store, registry, extension, dbusClient) {
        super();
        // Stored for symmetry — Plan 02-02 may grow indicator-level
        // prefs hooks without another constructor signature change.
        this._extension = extension;
        this._toggle = new USBeeToggle(store, registry, extension, dbusClient);
        this.quickSettingsItems.push(this._toggle);
        // No this._addIndicator() panel icon — RESEARCH Open Question Q6:
        // Quick Settings tiles already show in the panel; an extra panel
        // icon would be redundant.
    }
});
