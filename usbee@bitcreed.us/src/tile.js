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

import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {buildOptionsSection, populateDeviceRows, populateEmptyState,
    populateLoadingState, populateNotInstalledState, populateOutOfDateState,
    populateServiceNotSetUpState, populateTooNewState,
    updateDeviceRowsInPlace} from './popover.js';
import {InstallState, probeInstallState, refreshInstallStateAsync}
    from './service-probe.js';
import {DaemonState} from './daemon-status.js';
import {verdictTileStyleClasses} from './link-verdict.js';

const USBeeToggle = GObject.registerClass(
class USBeeToggle extends QuickSettings.QuickMenuToggle {
    constructor(store, registry, extension, dbusClient) {
        const initial = store.tileText;
        super({
            title:    initial.title,
            subtitle: initial.subtitle,
            iconName: 'drive-harddisk-usb-symbolic',
            toggleMode: false,  // UI-SPEC #interactions — informational tile (no daemon toggle)
        });
        this._store = store;
        this._extension = extension;
        this._dbusClient = dbusClient;
        this._prefsItem = null;
        this._prefsSeparator = null;
        // Whether the last _rebuildPopover() rendered the loading row. Drives
        // the one-shot loading→loaded repaint in the store 'changed' handler
        // below (quick task 260915-ung).
        this._renderedLoading = false;

        // Popover header — matches Wi-Fi / BT pattern (UI-SPEC #component-inventory).
        this.menu.setHeader('drive-harddisk-usb-symbolic', _('USB devices'), '');

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

        // Companion to the shim above (quick task 260915-unh, D-9).
        // `_openedSubMenu` is created and written ONLY by that shim — it is
        // USBee's data, not the Shell's — so USBee is also responsible for
        // forgetting a submenu it is about to destroy, rather than betting on
        // upstream PopupSubMenu.close() calling _setOpenedSubMenu(null), an
        // implementation detail that cannot be read on this machine. Without
        // it, destroying an OPEN row leaves the field dangling and the next
        // row the user opens calls close() on a finalised PopupSubMenu.
        // Installed for both hosts for the same reason the shim above is:
        // _getTopMenu() can stop at either.
        const forgetSubMenuShim = (submenu) => {
            for (const host of [this._rowsSection, this.menu]) {
                if (host && host._openedSubMenu === submenu)
                    host._openedSubMenu = null;
            }
        };
        this._rowsSection._usbeeForgetSubMenu = forgetSubMenuShim;
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
            this._applyVerdictClass(txt);
            // Loading→loaded repaint (quick task 260915-ung D-03). A popover
            // left open across the first snapshot would otherwise keep showing
            // the Loading… row until the user closed and reopened it — the
            // 'ready' handler below cannot serve here, because it is emitted
            // one line AFTER the un-awaited _snapshotImmediate() call, while
            // the store is still empty.
            //
            // Narrow by design: _rebuildPopover clears the latch on its way
            // out, so this fires at most once per loading episode. A blanket
            // rebuild-on-changed would tear the menu down on every snapshot,
            // collapsing any open device submenu (D-11 lazy rebuild).
            if (this.menu.isOpen && this._renderedLoading
                && !this._store.awaitingFirstSnapshot)
                this._rebuildPopover();
        });
        registry.addSignal(store, changedId);

        // COMPAT-02: 'daemon-too-old' and 'ready' are pure REPAINT triggers.
        // The daemon state itself lives in the store (store.daemonState),
        // written by DBusClient before either signal is emitted — so these
        // handlers only need to re-run the routing when the user happens to
        // be staring at the popover as the daemon changes underneath them.
        // A closed popover rebuilds on its next open anyway (D-11).
        // STATE-05: tracked via SignalRegistry so disable() disconnects.
        if (dbusClient) {
            const tooOldId = dbusClient.connect('daemon-too-old', () => {
                if (this.menu.isOpen)
                    this._rebuildPopover();
            });
            registry.addSignal(dbusClient, tooOldId);

            const readyId = dbusClient.connect('ready', () => {
                if (this.menu.isOpen)
                    this._rebuildPopover();
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
        this._applyVerdictClass(initTxt);

        // Quick task 260915-i4w — the filter switches, reachable from the
        // popover instead of only from the preferences window. Added before
        // buildPrefsRow() so the menu reads: devices → Options → separator →
        // Preferences…. One Gio.Settings instance is shared with the Options
        // rows; getSettings() mints a fresh object per call, and two of them
        // watching the same keys would be pure waste.
        this._settings = extension.getSettings();
        this._optionsItem = buildOptionsSection(this._settings, registry);
        this.menu.addMenuItem(this._optionsItem);

        // A filter change has to repaint the list that filter governs — but
        // it must NOT collapse what the user is reading (quick task
        // 260915-unh). The list is updated IN PLACE: a device whose details
        // are open keeps them open and the scroll position holds, where the
        // old _rebuildPopover() destroyed every row and its submenu with it.
        // The header must still agree with the rows now visible, so it is
        // rewritten from the same counts the update returns. Acting only
        // while the popover is open follows D-11 — a closed popover
        // repopulates on its next open anyway.
        for (const key of ['hide-empty-ports', 'hide-builtin-devices',
            'show-hubs', 'show-technical-details']) {
            const filterId = this._settings.connect(`changed::${key}`, () => {
                if (!this.menu.isOpen) return;
                // Loading-window guard (D-6). While quick task 260915-ung's
                // Loading… row is on screen there is nothing to filter and
                // nothing a filter could change, and ung's loading→loaded
                // latch repaints with the live filter values when the
                // snapshot lands — so doing nothing is both the safest and
                // the sufficient action, strictly better than churning
                // actors for no visible gain. Tested `=== true` so a build
                // without that getter reads as "not awaiting" and behaves
                // exactly as before.
                //
                // daemonState cannot carry this: ung renders its row from
                // INSIDE case DaemonState.RUNNING, so the daemon state IS
                // RUNNING while the Loading… row is visible and a
                // daemonState-only gate would never fire.
                if (this._store.awaitingFirstSnapshot === true) return;
                // Every other daemon state renders one non-expandable item,
                // so a full rebuild there costs the user nothing.
                if (this._store.daemonState !== DaemonState.RUNNING) {
                    this._rebuildPopover();
                    return;
                }
                const result = updateDeviceRowsInPlace(
                    this._rowsSection, this._store, this._extension);
                // null means nothing was repainted — the section is not
                // showing the device-row branch — so the header describes a
                // surface that is not on screen and must be left alone.
                if (result)
                    this._setHeader(result.count, result.issues);
            });
            registry.addSignal(this._settings, filterId);
        }

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

    /**
     * Colour the tile's second line by the daemon's link verdict, so the
     * tile and the popover row agree for the same device (quick task
     * 260917-i43).
     *
     * STRIP BEFORE ADDING. This toggle is a long-lived actor rebound on every
     * snapshot, so without the removal the verdict classes ACCUMULATE: a
     * device going below-capability → at-capability would carry both, and the
     * cascade would silently settle it by stylesheet source order, leaving
     * the tile showing a verdict the device no longer has. The list to strip
     * comes from link-verdict.js rather than being restated here, so it
     * cannot drift from the table that produces it.
     *
     * Only public St.Widget API is used, and only on the toggle — an object
     * this extension owns and subclasses. The colour is narrowed to the
     * second line by a descendant selector in stylesheet.css naming the
     * Shell theme's own class for it; nothing here reaches inside a
     * Shell-owned widget. Should a future Shell rename that class the
     * selector simply matches nothing and the line renders in its normal
     * colour — never a crash, never a wrong colour.
     *
     * Every daemon-state branch of `store.tileText` (Loading…, out of date,
     * too new, not running) returns no class field at all, so absent is
     * treated as "no verdict" and any leftover class is stripped — a stale
     * colour must not survive the daemon going away.
     *
     * @param {{verdictClass?: string}} txt  A store.tileText result.
     */
    _applyVerdictClass(txt) {
        for (const cls of verdictTileStyleClasses())
            this.remove_style_class_name(cls);
        const cls = txt?.verdictClass;
        if (typeof cls === 'string' && cls !== '')
            this.add_style_class_name(cls);
    }

    _rebuildPopover() {
        // Routing is driven entirely by the store-owned tri-state
        // (src/daemon-status.js DaemonState), which is also what the tile
        // pill renders — so the two surfaces cannot disagree. Precedence is
        // unchanged from quick task 260526-i7q:
        //   OUT_OF_DATE — daemon IS reachable, version rejected by the gate.
        //                 Distinct copy from "not running"; names the required
        //                 and the detected version.
        //   RUNNING     — render device rows.
        //   default     — STOPPED (and any unknown state) → not on the bus,
        //                 split three ways by src/service-probe.js
        //                 probeInstallState() (quick task 260910-myu):
        //                   a. NOT_INSTALLED   → the full install chain
        //                   b. SERVICE_MISSING → binary present, no unit:
        //                      `usbeehived --install-service`, NOT another
        //                      `cargo install`
        //                   c. INSTALLED       → a Start button
        let n = -1;
        let issues = 0;
        // What this pass actually rendered, for the repaint latch in the store
        // 'changed' handler. Assigned from the same condition the routing
        // switch uses, so the two cannot drift apart.
        let renderedLoading = false;
        switch (this._store.daemonState) {
        case DaemonState.OUT_OF_DATE:
            populateOutOfDateState(this._rowsSection, this._store.daemonVersion);
            break;
        case DaemonState.TOO_NEW:
            // usbeehive moved past the interface generation this build
            // speaks — the user must update USBee, not the daemon
            // (quick task 260905-b0s §D-7).
            populateTooNewState(this._rowsSection);
            break;
        case DaemonState.RUNNING: {
            // Daemon on the bus, first snapshot not back yet (quick task
            // 260915-ung). The device list is empty because nothing has been
            // counted, not because nothing is attached. `n` stays at its
            // initialised -1 and `issues` at 0, so the header expression below
            // renders the count-free _('USB devices') title rather than
            // claiming a measured zero — no new header string is needed.
            if (this._store.awaitingFirstSnapshot) {
                populateLoadingState(this._rowsSection);
                renderedLoading = true;
                break;
            }
            const result = populateDeviceRows(
                this._rowsSection, this._store, this._extension);
            n = result.count;
            issues = result.issues;
            break;
        }
        default:
            switch (probeInstallState()) {
            case InstallState.NOT_INSTALLED:
                populateNotInstalledState(this._rowsSection);
                break;
            case InstallState.SERVICE_MISSING:
                populateServiceNotSetUpState(this._rowsSection);
                break;
            default:
                populateEmptyState(this._rowsSection);
                break;
            }
            // The render above used a synchronous stat() over a fixed path
            // list, because the popover rebuild cannot block on D-Bus
            // (D-15). Ask systemd for the authoritative answer in the
            // background so a unit in a directory this build does not
            // enumerate — a `systemctl --user link`ed one, say — is right
            // by the next time the user opens the popover. Rebuilding the
            // popover from under the user's cursor would be worse than
            // being one open behind.
            refreshInstallStateAsync();
            break;
        }
        // Clear (or re-arm) the latch on the way out — every branch other than
        // the loading one leaves it false, so a loaded popover never rebuilds
        // itself on a routine re-snapshot.
        this._renderedLoading = renderedLoading;
        this._setHeader(n, issues);
    }

    /**
     * Write the popover header from a device count and an issue count.
     *
     * Extracted to one copy (quick task 260915-unh) because the in-place
     * filter update below also has to keep the header agreeing with the rows
     * actually visible — and two copies of this derivation is exactly how it
     * would stop agreeing.
     *
     * @param {number} n  Devices rendered, or -1 for "not counted" (the
     *   loading row and every daemon-missing state), which renders the
     *   count-free title rather than claiming a measured zero.
     * @param {number} issues  How many of them carry an issue.
     */
    _setHeader(n, issues) {
        const hdrTitle = n === 1 ? _('1 USB device')
            : n >= 0 ? _('%d USB devices').format(n) : _('USB devices');
        // The header's subtitle slot was always set to ''. It is the free
        // place to say how much is wrong without competing with the device
        // count (quick task 260905-b0s).
        const hdrSubtitle = issues === 0 ? ''
            : issues === 1 ? _('1 issue') : _('%d issues').format(issues);
        this.menu.setHeader('drive-harddisk-usb-symbolic', hdrTitle, hdrSubtitle);
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
