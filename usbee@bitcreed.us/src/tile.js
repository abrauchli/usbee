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

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {populateDeviceRows, populateEmptyState} from './popover.js';

const USBeeToggle = GObject.registerClass(
class USBeeToggle extends QuickSettings.QuickMenuToggle {
    constructor(store, registry) {
        super({
            title: _('USBee'),
            subtitle: store.subhead,
            iconName: 'network-usb-symbolic',   // RESEARCH A2 fallback in icons/usb-symbolic.svg
            toggleMode: false,                  // UI-SPEC #interactions — informational tile
        });
        this._store = store;

        // Popover header — matches Wi-Fi / BT pattern (UI-SPEC #component-inventory).
        this.menu.setHeader('network-usb-symbolic', _('USB devices'), '');

        // Lazy-populated device list section (D-11; Pattern 2).
        this._rowsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._rowsSection);

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

        // Phase 2 seam: a "Preferences" / "Open Settings" menu item belongs
        // BELOW this._rowsSection here, gated by STATE-04. Phase 1 leaves
        // the seam empty by design (UI-SPEC #component-inventory note).
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
    constructor(store, registry) {
        super();
        this._toggle = new USBeeToggle(store, registry);
        this.quickSettingsItems.push(this._toggle);
        // No this._addIndicator() panel icon — RESEARCH Open Question Q6:
        // Quick Settings tiles already show in the panel; an extra panel
        // icon would be redundant.
    }
});
