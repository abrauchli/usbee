// SPDX-License-Identifier: GPL-3.0-or-later
// src/popover.js
//
// Stateless popover render functions called from src/tile.js on the
// menu's 'open-state-changed' signal (D-11 lazy populate, Pattern 2).
//
// v1.1.0 rewrite: replaced the Plan-01/02 stacked-bullets pattern with a
// per-device PopupSubMenuMenuItem accordion layout. Each row carries a
// class/driver-derived symbolic icon, a headline, and a chevron. Clicking
// a row expands its Adwaita-coherent labelled-property detail panel; clicking
// another row collapses the previous one (single-row accordion, UI-02).
//
// SECURITY INVARIANTS (preserved from v1.0):
//   - All daemon strings are rendered verbatim via .text = ... — NEVER via
//     markup APIs (untrusted session D-Bus data, T-01-02 / T-02-01 mitigation).
//   - section.removeAll() is the FIRST call (Pitfall C: never mutate while iterating).

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {buildEmptyStateItem, buildEmptyStateDetailsItem,
    buildDaemonNotInstalledItem, buildDaemonOutOfDateItem,
    buildDaemonTooNewItem, buildServiceNotSetUpItem} from './empty-state.js';
import {hasIssue, formatVolts, formatAmps, formatWatts} from './device-store.js';
import {iconForDevice} from './device-icon.js';
import {formatValueForKey, labelForKey} from './label-table.js';
import {deriveAltMode, deriveHubInfo, deriveLinkInfo, isBuiltInDevice,
    maxPdoIndex, propsOf, resolveHeadline, usbIdRowText,
    verdictStyleClass} from './link-verdict.js';
import {isTechnicalKey, shouldRenderProperty} from './property-policy.js';

/**
 * Empty a section AND forget everything USBee recorded about its contents
 * (quick task 260915-unh, D-7).
 *
 * Every section.removeAll() in this file goes through here, which is the
 * point. removeAll() calls destroy() on every item, so any inventory USBee
 * stashed on the section (_usbeeRows, _usbeeOwnedItems) describes finalised
 * objects the moment it returns. A stale inventory is exactly what would let
 * a later in-place update call isOpen / close() / destroy() on destroyed rows
 * — the "instance is invalid" class of session-level fault. Clearing it at
 * the one chokepoint makes that physically impossible rather than merely
 * unlikely: an inventory cannot outlive its rows when the only way to empty a
 * section also drops the inventory.
 *
 * @param {PopupMenuSection} section
 */
function clearSection(section) {
    section.removeAll();
    section._usbeeRows = [];
    section._usbeeOwnedItems = null;
}

/**
 * Live read of the four filter keys (quick task 260915-unh).
 *
 * Extracted so the full-rebuild path and the in-place update path cannot
 * drift apart on what "the current filters" means. Still a live read on every
 * call — the D-11 lazy-rebuild discipline is unchanged.
 *
 * @param {Gio.Settings} settings
 * @returns {{hideEmpty: boolean, showHubs: boolean, showTech: boolean,
 *   hideBuiltin: boolean}}
 */
function readFilterFlags(settings) {
    return {
        // PREFS-04 consumer — live read on every popover open (D-11 lazy-rebuild).
        // Filter predicate uses daemon-emitted tokens 'TypeCPort' / 'Empty'
        // (same strings src/device-store.js Tier-1 filter consumes).
        hideEmpty:   settings.get_boolean('hide-empty-ports'),
        showHubs:    settings.get_boolean('show-hubs'),
        // Quick task 260526-c6p — live read parallel to the two above. Gates
        // the technical tier of src/property-policy.js inside buildDeviceRow's
        // property-bag loop.
        showTech:    settings.get_boolean('show-technical-details'),
        // Quick task 260915-i4w — same live-read discipline as the three above.
        hideBuiltin: settings.get_boolean('hide-builtin-devices'),
    };
}

/**
 * Compose the three filters and the issue-first sort (quick task 260915-unh).
 *
 * Extracted from populateDeviceRows verbatim so both render paths agree on
 * which devices are visible and in what order.
 *
 * @param {DeviceStore} store
 * @param {object} flags  readFilterFlags() result.
 * @returns {object[]}  Filtered, sorted copy — never the store's own array.
 */
function visibleDevices(store, flags) {
    let devices = store.devices;
    if (flags.hideEmpty)
        devices = devices.filter(d => !(d.category === 'TypeCPort' && d.status === 'Empty'));
    // Quick task 260905-b0s: a hub with an issue is shown even when hubs are
    // hidden. `port.peer_state` — the key that gates the "SuperSpeed did not
    // come up" explanation — exists only on root-hub ports, so the
    // explanation lives on the hub row. Hiding it would leave a
    // default-config user with a warning and no reachable detail. Only
    // Degraded / over-budget hubs surface; a BelowCapability hub (the common,
    // benign case) stays hidden.
    if (!flags.showHubs)
        devices = devices.filter(d => d.category !== 'Hub' || hasIssue(d));
    // Quick task 260915-i4w — hide hardware soldered into the machine. The
    // test is the daemon's own `mount == 'fixed'` (see isBuiltInDevice); an
    // absent mount is never treated as built-in. The `|| hasIssue(d)` escape
    // hatch is the one the hub filter above already carries, for the same
    // reason (260905-b0s): the header subtitle counts issues, so hiding an
    // issue-carrying row would report a fault with no row to open it.
    //
    // The three filters are independent predicates over the same list, so
    // they compose in any order rather than conflicting — and they do not
    // overlap: hide-empty-ports only ever matches TypeCPort rows, which
    // carry no `mount` and so are never built-in.
    if (flags.hideBuiltin)
        devices = devices.filter(d => !isBuiltInDevice(d) || hasIssue(d));

    // UI-03 — Issue-first stable sort. hasIssue(b) - hasIssue(a) floats
    // issue devices to the top; equal keys preserve insertion order.
    return [...devices].sort((a, b) =>
        Number(hasIssue(b)) - Number(hasIssue(a)));
}

/**
 * Wire the single-row accordion constraint on one row (UI-02).
 *
 * The handler iterates `section._usbeeRows` — the LIVE inventory — rather
 * than a captured array (quick task 260915-unh). A captured array would hold
 * references to rows the in-place update has since destroyed, which is the
 * same "instance is invalid" fault CR-02 / T-03-04 guard on the rebuild path.
 *
 * The signal id is stashed on the row so detachAccordionHandler() can
 * disconnect it before the row's menu actor is destroyed (CR-02 mitigation,
 * T-03-04 mitigation).
 *
 * @param {PopupMenuSection} section
 * @param {PopupMenu.PopupSubMenuMenuItem} row
 */
function attachAccordionHandler(section, row) {
    const sigId = row.menu.connect('open-state-changed', (_menu, open) => {
        if (!open) return;
        for (const other of (section._usbeeRows || [])) {
            // Defensive: other.menu may have been destroyed by a
            // concurrent rebuild before this handler ran.
            if (other !== row && other.menu && other.menu.isOpen)
                other.menu.close(/* animate */ true);
        }
    });
    row._usbeeAccordionSigId = sigId;
}

/**
 * Disconnect a row's accordion handler, if it still has one (CR-02).
 *
 * Safe to call on any menu item, including ones that never carried a handler
 * — the rebuild cleanup loop runs over whatever the section happens to hold.
 *
 * @param {PopupMenu.PopupBaseMenuItem} row
 */
function detachAccordionHandler(row) {
    if (row._usbeeAccordionSigId && row.menu) {
        row.menu.disconnect(row._usbeeAccordionSigId);
        row._usbeeAccordionSigId = 0;
    }
}

/**
 * Render the device list as an accordion of PopupSubMenuMenuItem rows.
 *
 * Called from tile.js every time the popover opens (D-11 lazy-rebuild).
 * Signal connections on each sub-menu's 'open-state-changed' are tracked
 * per-row in `row._usbeeAccordionSigId` and explicitly disconnected before
 * the next section.removeAll() so a stale signal cannot fire on a finalised
 * menu object during a rebuild (CR-02 mitigation).
 *
 * UI-03 issue-first sort is a stable sort: Array.prototype.sort is stable
 * in SpiderMonkey (GJS, ES2019+), so daemon-emit order is preserved within
 * each bucket.
 *
 * @param {PopupMenuSection} section  The section to populate.
 * @param {DeviceStore} store         Current device snapshot.
 * @param {Extension} extension       USBee extension instance (for GSettings).
 * @returns {{count: number, issues: number}}  Rows rendered, and how many of
 *   them carry an issue — the header subtitle reports the latter.
 */
export function populateDeviceRows(section, store, extension) {
    // CR-02: disconnect any per-row accordion handlers from the prior
    // populate() before the teardown destroys the menu actors. Without this,
    // a stale 'open-state-changed' fired mid-rebuild (e.g. user double-clicks
    // the tile while a row is mid-animation) can call .isOpen / .close() on
    // a destroyed PopupSubMenu, triggering a "instance is invalid" gobject
    // finalize error.
    for (const item of section._getMenuItems()) {
        detachAccordionHandler(item);
        // Quick task 260915-unh (D-9). `_openedSubMenu` is created and
        // written ONLY by USBee's own _setOpenedSubMenu shim (tile.js), so
        // USBee is also responsible for forgetting a submenu it is about to
        // destroy. Without this the shim keeps a reference to a finalised
        // PopupSubMenu and the next row the user opens calls close() on it.
        // The rebuild path has always carried that hazard too; one optional
        // call closes it for every populate path at once.
        section._usbeeForgetSubMenu?.(item.menu);
    }
    // Must be first (after handler cleanup) — never mutate while iterating (Pitfall C).
    clearSection(section);

    const flags = readFilterFlags(extension.getSettings());
    const devices = visibleDevices(store, flags);

    if (devices.length === 0) {
        // An empty list after filtering is a different fact from an empty
        // bus. Saying "No USB devices attached" when the user's own filters
        // are what emptied the list is simply false, and the Options
        // switches that caused it are one row below — so name the cause.
        const emptiedByFilters = store.devices.length > 0;
        const placeholder = new PopupMenu.PopupMenuItem(
            emptiedByFilters
                ? _('All devices hidden by the current filters')
                : _('No USB devices attached'),
            {reactive: false, can_focus: false},
        );
        section.addMenuItem(placeholder);
        // Record the placeholder as OURS (D-7). The asymmetry with the rows
        // path below is deliberate and load-bearing: it is what lets
        // updateDeviceRowsInPlace tell "our own placeholder is on screen, so
        // a filter change may legitimately bring rows back" apart from
        // "something that is not ours is on screen — do not touch it", which
        // is quick task 260915-ung's Loading… row and any future single-item
        // state. _usbeeShowTech is recorded on BOTH branches because
        // clearSection() does not reset it.
        section._usbeeShowTech = flags.showTech;
        section._usbeeRows = [];
        section._usbeeOwnedItems = [placeholder];
        return {count: 0, issues: 0};
    }

    // Build one accordion row per device and wire the single-open constraint.
    const rows = [];
    for (const device of devices) {
        const row = buildDeviceRow(device, flags.showTech);
        section.addMenuItem(row);
        rows.push(row);
    }

    // UI-02 — Single-row accordion: when a row opens, close all others.
    for (const row of rows)
        attachAccordionHandler(section, row);

    // USBee-owned bookkeeping on the section — the same `_usbee*` convention
    // row._usbeeAccordionSigId already follows, NOT Shell internals.
    // _usbeeRows and _usbeeOwnedItems are deliberately the SAME array object,
    // so the splices the in-place path performs keep the ownership token
    // accurate with no extra write.
    section._usbeeShowTech = flags.showTech;
    section._usbeeRows = rows;
    section._usbeeOwnedItems = rows;
    return {
        count:  devices.length,
        issues: devices.filter(hasIssue).length,
    };
}

/**
 * Update the device list IN PLACE instead of rebuilding it (quick task
 * 260915-unh).
 *
 * The rebuild path destroys every row, and destroying a PopupSubMenuMenuItem
 * destroys its submenu with it (its _init connects 'destroy' to
 * this.menu.destroy()), so an expanded detail panel collapses and the
 * St.ScrollView loses its offset. A filter change must not collapse what the
 * user is reading.
 *
 * @param {PopupMenuSection} section
 * @param {DeviceStore} store
 * @param {Extension} extension
 * @returns {?{count: number, issues: number}}  Rows now visible and how many
 *   carry an issue — or **null**, meaning "the section is not showing the
 *   device-row branch: nothing was read and nothing was changed". A null
 *   tells the caller to leave the header alone, because the surface the
 *   header describes is not on screen.
 */
export function updateDeviceRowsInPlace(section, store, extension) {
    const flags = readFilterFlags(extension.getSettings());

    // Ownership gate (D-7) — before anything else, and before any read of
    // _usbeeRows. The section's live items must be identity-equal, IN ORDER,
    // to the inventory populateDeviceRows recorded. Identity is the point: a
    // length check would pass for a same-sized set of DIFFERENT (already
    // finalised) objects, and only identity proves the recorded rows are the
    // live ones.
    //
    // clearSection() nulls the token at every teardown site, so a section
    // holding quick task 260915-ung's Loading… row fails this check and is
    // left strictly alone. That row is why the gate exists: ung renders it
    // from INSIDE case DaemonState.RUNNING, so daemonState alone cannot
    // distinguish it. Any future single-item state is covered with no change
    // here. `_getMenuItems()` is already used for exactly this purpose at the
    // top of populateDeviceRows, so this adds no new private surface.
    const owned = section._usbeeOwnedItems;
    const live = section._getMenuItems();
    if (!Array.isArray(owned) || owned.length !== live.length)
        return null;
    for (let i = 0; i < owned.length; i++) {
        if (owned[i] !== live[i])
            return null;
    }

    const rows = section._usbeeRows || [];
    if (rows.length === 0) {
        // The gate above has proved OUR placeholder is what is on screen, and
        // a filter change must be able to bring rows back. Without that gate
        // this single line is exactly how 260915-ung's Loading… row would get
        // replaced by _('No USB devices attached') — the flash that task
        // exists to remove.
        return populateDeviceRows(section, store, extension);
    }

    const devices = visibleDevices(store, flags);
    if (devices.length === 0) {
        // Delegate so the "hidden by the current filters" placeholder and its
        // wording live in exactly one place.
        return populateDeviceRows(section, store, extension);
    }

    const wanted = new Map(devices.map(d => [d.id, d]));

    // Remove rows whose device is no longer visible. The order is the
    // mitigation (D-9, T-unh-02): detach first so nothing can fire
    // mid-teardown; then forget the shim-owned _openedSubMenu reference,
    // because leaving it pointing at a submenu about to be finalised is what
    // makes the NEXT row the user opens call close() on a dead object — the
    // dangling reference the old teardown left behind; then close; then
    // destroy. close() is called as well, but the mitigation deliberately
    // does NOT depend on upstream close() notifying the top menu, which
    // cannot be verified on this machine.
    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (wanted.has(row._usbeeDeviceId)) continue;
        detachAccordionHandler(row);
        section._usbeeForgetSubMenu?.(row.menu);
        if (row.menu?.isOpen)
            row.menu.close(false);
        rows.splice(i, 1);
        row.destroy();
    }

    // Insert rows for newly visible devices, walking `devices` in ascending
    // index order so each insert lands at its sorted position.
    // _getMenuItems() maps box children to _delegate and keeps only
    // PopupBaseMenuItem / PopupMenuSection — a submenu's delegate is a
    // PopupSubMenu (a PopupMenuBase), so it is filtered out and the array
    // index equals the section position (46:827 / 50:933). addMenuItem
    // inserts the row actor and menuItem.menu.actor below the same
    // beforeItem, preserving row-then-submenu order (46:765 / 50:865).
    const present = new Set(rows.map(r => r._usbeeDeviceId));
    for (let index = 0; index < devices.length; index++) {
        const device = devices[index];
        if (present.has(device.id)) continue;
        const row = buildDeviceRow(device, flags.showTech);
        section.addMenuItem(row, index);
        rows.splice(index, 0, row);
        attachAccordionHandler(section, row);
    }

    // D-5 — only show-technical-details changes what a SURVIVING row says.
    // The other three keys change which rows exist, never what a row
    // contains, so they must not touch the row the user is reading.
    if (section._usbeeShowTech !== flags.showTech) {
        for (const row of rows) {
            const device = wanted.get(row._usbeeDeviceId);
            if (device)
                populateDeviceRowMenu(row, device, flags.showTech);
        }
        section._usbeeShowTech = flags.showTech;
    }

    return {
        count:  devices.length,
        issues: devices.filter(hasIssue).length,
    };
}

/**
 * A PopupSwitchMenuItem that does NOT dismiss the popover when it is clicked
 * (quick task 260915-unh, D-1).
 *
 * Nothing in USBee asked for the dismissal; it is the Shell's default for an
 * activated menu item and USBee merely inherited it. The inherited
 * PopupSwitchMenuItem.activate() toggles the switch and then chains to
 * super.activate() for every event EXCEPT a KEY_PRESS of Clutter.KEY_space.
 * That chain runs: PopupBaseMenuItem.activate() emits 'activate' ->
 * PopupMenuBase._connectItemSignals() connected it with
 * GObject.ConnectFlags.AFTER to itemActivated() -> _getTopMenu().close().
 * The Options rows live in the toggle's own menu, so _getTopMenu() walks up
 * to the Quick Settings menu and closes the entire panel: one click on a
 * filter switch and the surface the user was reading is gone.
 *
 * Upstream already exempts one case, with the comment "we allow pressing
 * space to toggle the switch without closing the menu". The intent is
 * therefore not in dispute — it simply was never extended to the pointer,
 * and a mouse click is never that exception. This override extends the same
 * intent by toggling and stopping; it deliberately does NOT chain to
 * super.activate().
 *
 * Upstream source says the toggle alone is enough to keep the GSettings
 * write working, because toggle() emits 'toggled' on both versions in the
 * declared range (46 emits directly from toggle(); 50 delegates to
 * this._switch.toggle() and wires the switch's notify::state to _onToggled,
 * which emits). This code deliberately does NOT depend on that. The Shell's
 * JavaScript is absent from this machine's disk and from every installed
 * .gresource, so the claim was read from upstream rather than verified here,
 * and the behaviour is unobservable without a Shell restart — resting all
 * four filter switches on it would be an unforced bet. The override
 * therefore also calls USBee's own _usbeeOnActivate hook, which performs the
 * write itself (D-8). Whichever path runs first does the write; the other
 * finds the key already at that value and returns. Exactly one write either
 * way, and the switches keep working whichever is true.
 *
 * D-2: upstream guards its toggle with `if (this._switch.mapped)`. That is
 * not reproduced here. `_switch` is a private field, and the only thing that
 * unmaps it is setStatus(), which USBee never calls — so an unconditional
 * toggle() is correct for this codebase and touches no internal.
 */
const USBeeSwitchMenuItem = GObject.registerClass(
class USBeeSwitchMenuItem extends PopupMenu.PopupSwitchMenuItem {
    activate(_event) {
        this.toggle();
        // `state` is the public read side, and the same one the `changed::`
        // handler below already compares against.
        this._usbeeOnActivate?.(this.state);
    }
});

/**
 * Build the popover's collapsible "Options" submenu — the same filter
 * switches the preferences window carries, one click from the device list
 * instead of a window launch away (quick task 260915-i4w).
 *
 * Each switch is two-way bound to its GSettings key: toggling the row writes
 * the key, and an external write — the preferences window, `gsettings set`,
 * dconf-editor — moves the row. The `syncing` latch below is what keeps the
 * settings->row direction from feeding back into the row->settings one.
 *
 * That latch is LOAD-BEARING on the Shell this machine runs, not a
 * precaution (quick task 260915-unh). The earlier revision of this comment
 * speculated that setToggleState() sets the underlying switch without
 * emitting 'toggled'; that speculation is now settled and it is FALSE on
 * Shell 50, where setToggleState() is `this.set({state})` -> the item's
 * `state` setter -> `this._switch.set({state})` -> notify::state ->
 * _onToggled() -> emits 'toggled'. (On 46 it genuinely does not emit.) So
 * without the latch two bound surfaces would write to each other in a loop —
 * a dconf write storm — on the current Shell, today. Read from upstream
 * source rather than verified here, which is why the write path below does
 * not depend on any single emission (D-8).
 *
 * Every handler is registered with the SignalRegistry, so disable() releases
 * both the per-row 'toggled' connections and the GSettings 'changed::' ones
 * (D-14). `settings` is also kept alive by those closures.
 *
 * @param {Gio.Settings} settings    The extension's GSettings.
 * @param {SignalRegistry} registry  Lifecycle registry for the handlers.
 * @returns {PopupMenu.PopupSubMenuMenuItem}  The collapsed Options submenu.
 */
export function buildOptionsSection(settings, registry) {
    const item = new PopupMenu.PopupSubMenuMenuItem(_('Options'), true);
    item.icon.icon_name = 'view-list-symbolic';

    // The `hide-*` keys are shown with their own polarity rather than
    // inverted into a "Show ..." phrasing, so each switch reads word for
    // word like its preferences-window twin — two names for one setting is
    // how a user ends up believing there are two settings.
    const toggles = [
        ['hide-empty-ports',       _('Hide empty USB-C ports')],
        ['hide-builtin-devices',   _('Hide built-in devices')],
        ['show-hubs',              _('Show USB hubs')],
        ['show-technical-details', _('Show technical details')],
    ];

    for (const [key, label] of toggles) {
        const row = new USBeeSwitchMenuItem(
            label, settings.get_boolean(key));

        let syncing = false;

        // The row->settings write, reachable from BOTH directions (D-8).
        // The 'toggled' signal below is the normal path, and also carries an
        // external setToggleState() write; the activate() override's
        // _usbeeOnActivate hook is the fallback that keeps the switches
        // working if toggle() does not emit on some Shell in the declared
        // range. The idempotence check is what makes running both harmless —
        // whichever fires first performs the write, and the second sees the
        // key already at `state` and returns. The `syncing` latch guards
        // BOTH entry points, so the settings->row direction can never feed
        // back into this one.
        const writeKey = (state) => {
            if (syncing) return;
            if (settings.get_boolean(key) === state) return;
            settings.set_boolean(key, state);
        };

        const toggledId = row.connect('toggled', (_row, state) => writeKey(state));
        registry.addSignal(row, toggledId);

        // Second entry point, invoked by the USBeeSwitchMenuItem override.
        row._usbeeOnActivate = writeKey;

        const changedId = settings.connect(`changed::${key}`, () => {
            const value = settings.get_boolean(key);
            if (row.state === value) return;
            syncing = true;
            row.setToggleState(value);
            syncing = false;
        });
        registry.addSignal(settings, changedId);

        item.menu.addMenuItem(row);
    }

    return item;
}

/**
 * Render the "installed but stopped" empty state — the one that carries the
 * Start button (quick task 260910-myu).
 *
 * TWO items, not one (quick task 260915-unf): the state item, then the
 * collapsed "Show details" disclosure holding the manual systemctl fallback.
 * The disclosure is a sibling in this section rather than a child of the
 * state item — a PopupSubMenuMenuItem belongs in a section, which is exactly
 * how the device rows already carry theirs.
 *
 * @param {PopupMenuSection} section
 */
export function populateEmptyState(section) {
    clearSection(section);
    section.addMenuItem(buildEmptyStateItem());
    section.addMenuItem(buildEmptyStateDetailsItem());
}

/**
 * Render the transient "daemon is up, first snapshot not back yet" row (quick
 * task 260915-ung). Reached from tile.js while store.awaitingFirstSnapshot is
 * true — otherwise the list would read "No USB devices attached" about devices
 * nobody has counted.
 *
 * Deliberately NOT an empty-state item: this is a passing moment, not one of
 * the daemon-missing states, so it carries no command row and no button.
 * Shares its msgid with the tile pill (src/device-store.js tileText) — two
 * names for one state is how a user comes to believe there are two states.
 *
 * @param {PopupMenuSection} section
 */
export function populateLoadingState(section) {
    // Must be first — never mutate while iterating (Pitfall C). Routed
    // through the chokepoint so this row can never leave a stale row
    // inventory behind it (quick task 260915-unh, D-7).
    clearSection(section);
    section.addMenuItem(new PopupMenu.PopupMenuItem(
        _('Loading…'), // U+2026
        {reactive: false, can_focus: false},
    ));
}

/**
 * Render the "daemon not installed" empty state (quick task 260526-i7q).
 * Wired from tile.js _rebuildPopover() when the daemon is not running and
 * probeInstallState() returns InstallState.NOT_INSTALLED — no unit file
 * anywhere AND no `usbeehived` on PATH.
 *
 * @param {PopupMenuSection} section
 */
export function populateNotInstalledState(section) {
    clearSection(section);
    section.addMenuItem(buildDaemonNotInstalledItem());
}

/**
 * Render the "binary installed, service not set up" empty state (quick task
 * 260910-myu). Wired from tile.js when probeInstallState() returns
 * InstallState.SERVICE_MISSING — `usbeehived` is on PATH but no unit file
 * exists, so the user needs SETUP_CMD rather than another `cargo install`.
 *
 * @param {PopupMenuSection} section
 */
export function populateServiceNotSetUpState(section) {
    clearSection(section);
    section.addMenuItem(buildServiceNotSetUpItem());
}

/**
 * Render the "daemon out of date" empty state (COMPAT-02).
 * Wired from tile.js when store.daemonState is DaemonState.OUT_OF_DATE.
 * Mirrors the populateEmptyState shape but uses the dedicated copy
 * landed in src/empty-state.js by Plan 04-01.
 *
 * @param {PopupMenuSection} section
 * @param {string} detectedVersion  Version the daemon reported; '' when it
 *   could not be read (the item then renders "detected unknown").
 */
export function populateOutOfDateState(section, detectedVersion = '') {
    clearSection(section);
    section.addMenuItem(buildDaemonOutOfDateItem(detectedVersion));
}

/**
 * Render the "daemon is NEWER than this extension" empty state (quick task
 * 260905-b0s §D-7). Wired from tile.js when store.daemonState is
 * DaemonState.TOO_NEW — i.e. the bus name is owned, the Devices5 proxy could
 * not read a Version, and introspection found a higher interface generation.
 *
 * Distinct from populateOutOfDateState because the actionable component is
 * the opposite one: telling this user to `cargo install usbeehive` would
 * change nothing.
 *
 * @param {PopupMenuSection} section
 */
export function populateTooNewState(section) {
    clearSection(section);
    section.addMenuItem(buildDaemonTooNewItem());
}

/**
 * Build one accordion row for a device.
 *
 * Uses PopupSubMenuMenuItem (the gnome-shell widget from bluetooth.js /
 * network.js) so the row carries a built-in icon slot (.icon), a title
 * label (.label), and a sub-menu (.menu) whose content panel is built as
 * a single non-reactive PopupBaseMenuItem containing a vertical St.BoxLayout
 * of labelled property rows (UI-05 Adwaita-coherent detail panel).
 *
 * The icon is set from iconForDevice() — UI-04.
 *
 * Value-column labels use .text = (never .set_markup) — T-01-02 mitigation.
 *
 * @param {object} device   Unpacked DeviceEntry from the store.
 * @param {boolean} showTech  Live read of show-technical-details GSettings.
 *   When false the property loop renders only the glanceable tier — the
 *   curated advanced keys AND any key this build does not recognise are
 *   held back (src/property-policy.js). The dedicated blocks (Summary,
 *   Link, charging_diag, cable trust, PDOs, hub power, driver-not-bound,
 *   Subclass) render unconditionally.
 * @returns {PopupMenu.PopupSubMenuMenuItem}
 */
function buildDeviceRow(device, showTech) {
    // Property-bag lookup map — built once per row build. Daemon values
    // are STRINGS on the wire (a(ss)), so every boolean-flag check below
    // compares to the literal 'true', not a JS boolean.
    const props = propsOf(device);

    // Quick task 260905-b0s §D-6: `product_db` fills in only for a device
    // that publishes no iProduct string at all. It never overrides a real
    // product name — hwdb entries can be wrong for re-badged PIDs.
    const headline = resolveHeadline(device, props);

    const link = deriveLinkInfo(device, props);

    // Second arg `true` enables the built-in .icon slot on the row.
    const row = new PopupMenu.PopupSubMenuMenuItem(headline, true);
    const devIcon = iconForDevice(device);
    if (typeof devIcon === 'string')
        row.icon.icon_name = devIcon;
    else
        row.icon.gicon = devIcon;  // Gio.FileIcon for bundled SVGs
    row.add_style_class_name('usbee-device-row');
    if (hasIssue(device))
        row.add_style_class_name('usbee-row-warning');

    // Trailing rate caption on the collapsed row (quick task 260905-b0s
    // §D-1) — the one number this extension exists to show, and until now
    // visible only on the tile, for the single fastest link.
    //
    // PopupSubMenuMenuItem's children are [icon, label, _triangleBin], and
    // the bin is what expands to push the chevron to the right edge. To put
    // the caption between the headline and the chevron we expand the label
    // instead and insert before the bin. Every step is guarded: on a shell
    // whose child order differs, the caption simply appends and nothing
    // throws.
    if (link.rateText !== '') {
        const rateLabel = new St.Label({
            text:        link.rateText,
            y_align:     Clutter.ActorAlign.CENTER,
            style_class: 'usbee-row-rate',
        });
        // The verdict colour and the amber are ALTERNATIVES, not additions
        // (quick task 260917-i43). One `color` per label means no cascade
        // race between two equally-specific rules, and the fallback is kept
        // because `link.isWarning` is deliberately BROADER than
        // `verdict === 'Degraded'`: it also fires on `usb_link_degraded`
        // with an unrecognised verdict, as a forward-compat safety net
        // (src/link-verdict.js, deriveLinkInfo).
        const verdictClass = verdictStyleClass(link.verdict);
        if (verdictClass !== '')
            rateLabel.add_style_class_name(verdictClass);
        else if (link.isWarning)
            rateLabel.add_style_class_name('usbee-detail-warning');
        const bin = row._triangleBin;
        const idx = bin ? row.get_children().indexOf(bin) : -1;
        if (idx >= 0) {
            row.label.x_expand = true;
            bin.x_expand = false;
            row.insert_child_at_index(rateLabel, idx);
        } else {
            row.add_child(rateLabel);
        }
    }

    // Keyed on the daemon's own device identity (D-3) — the same `id` that
    // src/dbus-client.js already resolves DeviceAdded / DeviceRemoved /
    // DeviceChanged by, so the in-place update invents no new identity.
    row._usbeeDeviceId = device.id;
    populateDeviceRowMenu(row, device, showTech);
    return row;
}

/**
 * Fill (or REfill) one device row's submenu — the pill strip and the whole
 * labelled-property detail panel (quick task 260915-unh).
 *
 * Extracted from buildDeviceRow so the show-technical-details path can swap a
 * surviving row's contents without destroying the row (D-5). removeAll()
 * empties a submenu without touching its `isOpen`, so a panel the user has
 * open stays open across the swap (read from upstream popupMenu.js at plan
 * time, 46:1053ff / 50:1166ff — the Shell's JS is on neither this machine's
 * disk nor in any installed .gresource, so that is provenance for a claim,
 * not a file reference).
 *
 * `row.menu.removeAll()` here is the submenu's OWN content, not the device
 * section, so it deliberately does NOT go through clearSection() — there is
 * no USBee inventory recorded on a row's menu.
 *
 * @param {PopupMenu.PopupSubMenuMenuItem} row
 * @param {object} device     Unpacked DeviceEntry from the store.
 * @param {boolean} showTech  Live read of show-technical-details GSettings.
 */
function populateDeviceRowMenu(row, device, showTech) {
    row.menu.removeAll();

    const props = propsOf(device);
    const link = deriveLinkInfo(device, props);

    // --- Transport pill strip (CONTEXT 260526-dmj §C) ---
    // First child of the expanded menu, ABOVE the detailItem. Renders only
    // when the device exposes an "interesting" non-baseline transport: a
    // displayed alt-mode (DisplayPort), Thunderbolt, or a Type-C port that
    // negotiated USB 2 only (worth flagging as a slow-port surprise).
    const pillStripItem = buildTransportPillStrip(device, props);
    if (pillStripItem)
        row.menu.addMenuItem(pillStripItem);

    // --- Detail panel (UI-05) ---
    // One non-reactive PopupBaseMenuItem wrapping a vertical St.BoxLayout.
    const detailItem = new PopupMenu.PopupBaseMenuItem({
        reactive:    false,
        can_focus:   false,
        style_class: 'usbee-detail-panel',
    });

    const detailBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
    });
    detailItem.add_child(detailBox);

    // Subtitle row (when non-empty) — key: 'Summary'.
    if (device.subtitle) {
        detailBox.add_child(buildPropertyRow(
            _('Summary'), device.subtitle, device.category));
    }

    // Exact vendor:product ID (quick task 260915-ikd). Placed between the
    // Summary and the Link block so the panel reads what it is → its exact
    // ID → how it is connected; identity belongs beside identity.
    //
    // Rendered ALWAYS, not merely as a name fallback: the daemon already
    // substitutes the formatted ID for a missing product name itself, so the
    // gap this closes is the opposite one — a device whose name resolves
    // ("Intel Wireless") leaves the googleable part number nowhere on
    // screen. usbIdRowText() owns every suppression case (headline already
    // carries it, the 0000:0000 port rows, malformed values).
    const usbIdText = usbIdRowText(device, props);
    if (usbIdText !== '') {
        // Translators: label for a device's USB vendor:product identifier,
        // e.g. "1d6b:0003". Matches the wording `lsusb` prints ("ID
        // 1d6b:0003"), which is where a user meets the term elsewhere.
        detailBox.add_child(buildPropertyRow(
            _('USB ID'), usbIdText, device.category));
    }

    // Link speed + BOS verdict (quick task 260905-b0s §D-1/D-3/D-4).
    buildLinkBlock(detailBox, device, link);

    // Charging diagnostic rows — rendered before the properties bag so the
    // most actionable info appears at the top of the detail panel.
    // summary is always shown when present; detail is shown when non-empty.
    // is_warning drives both the row style and the key label copy.
    if (device.charging_diag?.present) {
        const isWarn = device.charging_diag.is_warning;
        const diagKey = isWarn ? _('Charging issue') : _('Charging');
        const diagRow = buildPropertyRow(
            diagKey, device.charging_diag.summary, device.category);
        if (isWarn)
            diagRow.get_children()[0].add_style_class_name('usbee-detail-warning');
        detailBox.add_child(diagRow);
        if (device.charging_diag.detail) {
            const detailRow = buildPropertyRow(
                _('Detail'), device.charging_diag.detail, device.category);
            if (isWarn)
                detailRow.get_children()[0].add_style_class_name('usbee-detail-warning');
            detailBox.add_child(detailRow);
        }
    }

    // Cable trust row (CONTEXT 260526-dmj §B). Always visible when any
    // cable.trust.* flag is set — independent of show-technical-details
    // because cable safety is glance-priority. Reasons are joined in a
    // fixed order (zero VID → unknown VID → reserved bits) so the row's
    // contents are deterministic across renders.
    const trustReasons = [];
    if (props.get('cable.trust.zero_vid') === 'true')
        trustReasons.push(_('vendor ID is zero'));
    if (props.get('cable.trust.vid_unknown') === 'true')
        trustReasons.push(_('vendor ID not in USB-IF list'));
    if (props.get('cable.trust.reserved_bits') === 'true')
        trustReasons.push(_('reserved bits set in Cable VDO'));
    if (trustReasons.length > 0) {
        const trustValue = _('This cable looks unusual: %s')
            .format(trustReasons.join(_(', ')));
        const trustRow = buildPropertyRow(
            _('Cable trust'), trustValue, device.category);
        trustRow.get_children()[0].add_style_class_name('usbee-detail-warning');
        detailBox.add_child(trustRow);
    }

    // Structured Charger PDOs (CONTEXT 260526-dmj §D). Always visible when
    // pdo_list is non-empty (not gated on show-technical-details — charging
    // capability is glance priority). No-op when pdo_list is empty.
    buildPdoListBlock(detailBox, device);

    // Hub occupancy + bus-power budget (quick task 260905-b0s). No-op for
    // non-hubs and for any hub whose daemon omitted the keys.
    buildHubBlock(detailBox, device, props);

    // Billboard alt mode — facts only, with exactly one case stated
    // unprompted.
    buildAltModeBlock(detailBox, device, props);

    // DISP-04 / UX-1: flag devices the daemon could not bind a driver to.
    // Empty Type-C ports already say nothing about drivers — suppress the
    // row in that case (`status !== 'Empty'` gate).
    if (device.primary_driver === '' && device.status !== 'Empty') {
        const driverRow = buildPropertyRow(
            _('Driver'), _('not bound'), device.category);
        driverRow.add_style_class_name('usbee-detail-driver-missing');
        detailBox.add_child(driverRow);
    }

    // DISP-05 / UX-2: detail-panel-only treatment for the daemon's advisory
    // subclass hint. Empty subclass strings (default) render nothing; the
    // row title is intentionally unchanged (UX-2 rejects "append to title").
    if (device.device_subclass) {
        detailBox.add_child(buildPropertyRow(
            _('Subclass'), device.device_subclass, device.category));
    }

    // One property row per machine-key pair from the daemon's properties bag
    // (CONTEXT D-2.0-04). Order is preserved — the daemon emits in a
    // deliberate order and labelForKey() is a pure resolver. Unknown keys
    // still render the raw key string as their label; they are simply no
    // longer visible by default (see below).
    //
    // The four tiers live in src/property-policy.js. Quick task 260905-b0s
    // §D-2 REVERSED the locked 260526-c6p D-2 deny-list: an unrecognised key
    // is now technical, i.e. it renders only under "Show technical details".
    // The daemon's BOS + connector waves add 24 keys at once, several of
    // them opaque UUIDs and kernel object names, so the old policy turned
    // the popover into a property dump the day the daemon updated. Unknown
    // keys still never throw, never log, and stay one toggle away.
    //
    // Quick task 260526-dmj §D: legacy charger_max stringly row is
    // suppressed when the structured pdo_list is non-empty (the Charger
    // PDOs block above already covers that capability). When pdo_list is
    // empty, charger_max still renders — back-compat for daemons that emit
    // the property without the structured list.
    let techSeparatorDone = false;
    for (const [key, value] of (device.properties || [])) {
        if (key === 'charger_max' && device.pdo_list?.length > 0) continue;
        if (!shouldRenderProperty(key, showTech)) continue;
        // A thin separator above the first technical row so the panel reads
        // as two tiers rather than one long list.
        if (!techSeparatorDone && isTechnicalKey(key)) {
            techSeparatorDone = true;
            const sep = buildPropertyRow(_('Technical details'), '', device.category);
            sep.add_style_class_name('usbee-detail-separator');
            detailBox.add_child(sep);
        }
        detailBox.add_child(buildPropertyRow(
            labelForKey(key), formatValueForKey(key, value), device.category));
    }

    row.menu.addMenuItem(detailItem);
}

/**
 * Render the Link block: the negotiated rate, the device's own capability
 * and the connector explanation — one fact per row, and no instruction.
 *
 * All of it is composed HERE from structured tokens rather than read out of
 * the daemon's own `data_rate.summary` / `.detail` prose, because the
 * daemon's strings are English-only while these go through gettext.
 *
 * The verdict rules are not negotiable (BOS spec §6):
 *   AtCapability    — neutral confirmation.
 *   BelowCapability — informational: the bare rate on the Link row and the
 *                     device's own rating on the Capability row, with no
 *                     verdict prose joining them. On the daemon's reference
 *                     machine 2 of 2 BOS-bearing devices land here and both
 *                     are working exactly as intended, so this must never
 *                     look like a fault — and must never suggest a fix.
 *   Degraded        — the only warning. Amber Link row, and the Detail row
 *                     when the SuperSpeed shape applies. No Fix row: USBee
 *                     can see THAT the link fell short, never WHERE, so it
 *                     has no remedy to give (quick task 260910-o99).
 *   absent/unknown  — say nothing beyond the rate itself.
 *
 * @param {St.BoxLayout} detailBox
 * @param {object} device
 * @param {object} link  deriveLinkInfo() result.
 */
function buildLinkBlock(detailBox, device, link) {
    if (link.rateText === '') return;

    // The MEASURED fact, alone. `usb_version` is deliberately NOT appended:
    // it is the daemon's canonicalised `bcdUSB`, and its commonest value here
    // — "2.1", from `bcdUSB 2.10` — names a USB specification that does not
    // exist. All 2.10 declares is that the device carries a BOS descriptor,
    // yet beside a rate it reads like an actionable version number. The rate
    // already says the same thing, more precisely. The field is still on the
    // wire, but as of quick task 260917-hkf it renders NOWHERE in the UI: the
    // tile title was its last render site and now names the best attached
    // link capability instead (src/device-store.js Tier 2).
    const base = link.rateText;

    let valueText = base;
    if (link.verdict === 'AtCapability') {
        // Translators: %s is a link rate ("10 Gb/s"). The device is running
        // as fast as it is able to. The Capability row below is suppressed
        // in this case, so this is where "as fast as it gets" is said.
        valueText = _('%s — full capability').format(base);
    } else if (link.isWarning) {
        const needed = link.floorText || link.capableText;
        valueText = needed
            // Translators: %1$s is the current link, %2$s the rate the
            // device's own descriptor says it needs to work properly.
            ? _('%s — below the %s this device needs').format(base, needed)
            : base;
    }

    const linkRow = buildPropertyRow(_('Link'), valueText, device.category);
    if (link.isWarning)
        linkRow.get_children()[0].add_style_class_name('usbee-detail-warning');
    detailBox.add_child(linkRow);

    // What the DEVICE can do, as its own BOS descriptor declares it — a fact
    // about the silicon, needing no knowledge of ports, cables or hubs.
    //
    // It states the capability and stops. It deliberately does NOT say where
    // that speed could be reached: the reference device is an RTL8153 behind
    // a USB-2.0-only GL850 hub inside a monitor, so the remedy the old copy
    // recommended could not have worked and could not have been checked.
    // Suppressed entirely when it would only repeat the Link row — see
    // deriveShowCapability() in src/link-verdict.js.
    //
    // The label is the same one usb_bos_suppressed uses (src/label-table.js)
    // for the complementary "capability unknown" case; the two never both
    // appear, so the panel keeps one word for one concept.
    if (link.showCapability) {
        detailBox.add_child(buildPropertyRow(
            // Translators: row label for the speed the device's own
            // descriptor says it supports, as opposed to the speed it
            // actually negotiated on the "Link" row above.
            _('Capability'), link.capableText, device.category));
    }

    // The connector explanation. Reuses the existing 'Detail' key so the
    // panel keeps one vocabulary for "here is why".
    const hintText = connectorHintText(link.connectorHint);
    if (hintText !== '') {
        detailBox.add_child(buildPropertyRow(
            _('Detail'), hintText, device.category));
    }

    // No verdict earns an instruction — not even Degraded. The Fix row that
    // used to sit here told the user to change the port or the cable; quick
    // task 260910-n10 left it in place only because that task was scoped to
    // BelowCapability (260910-o99 withdrew it). The evidence is no better
    // for Degraded either: the verdict says the link fell below what the
    // device's own descriptor needs, which is a measurement, and says
    // nothing at all about where the shortfall happened. The reference
    // device is an RTL8153 capped by a USB-2.0-only GL850 hub inside a
    // monitor, where relocating it is exactly the wrong advice — no port on
    // the machine is upstream of that hub. The amber Link row states the
    // shortfall and the Detail row
    // lists the candidates; naming a culprit — and only then a fix — needs
    // the daemon's upstream-chain verdict (link.culprit / link.action).
}

/**
 * Translate a connector-hint token into prose. Unknown tokens (and null)
 * render nothing — "say nothing" is a first-class outcome here.
 *
 * @param {?string} hint  deriveLinkInfo().connectorHint
 * @returns {string}
 */
function connectorHintText(hint) {
    switch (hint) {
    case 'ss-cause-unknown':
        // Translators: shown for a device that advertises SuperSpeed but
        // linked at USB 2 speed. USBee can see THAT SuperSpeed did not come
        // up, never WHERE it was lost, so this must stay a list of
        // candidates — never "this cable is the problem".
        return _('SuperSpeed did not come up on this link — the cause could be the cable, the port, or a hub in between');
    default:
        return '';
    }
}

/**
 * Hub occupancy and bus-power budget rows (TRIM spec §3.1/§3.2).
 *
 * Wording matters: `bMaxPower` is a *declared* maximum, not a measured
 * draw (TRIM spec §8.2). Never say "draws" or "using".
 *
 * A self-powered hub publishes no budget — there is no bus-derived ceiling
 * worth quoting — so the committed figure renders alone in that case.
 *
 * @param {St.BoxLayout} detailBox
 * @param {object} device
 * @param {Map<string,string>} props
 */
function buildHubBlock(detailBox, device, props) {
    const hub = deriveHubInfo(device, props);

    // `0` is a real answer ("this hub has ports and none are occupied"),
    // which is why deriveHubInfo distinguishes it from null.
    if (hub.portsUsed !== null && hub.portsTotal !== null) {
        detailBox.add_child(buildPropertyRow(
            _('Ports'),
            // Translators: %1$d hub ports occupied, %2$d ports in total.
            _('%d of %d in use').format(hub.portsUsed, hub.portsTotal),
            device.category));
    }

    if (hub.committedMa !== null) {
        const valueText = hub.budgetMa !== null
            // Translators: %1$d mA committed to this hub's children, %2$d mA
            // the hub's bus-power budget. "Committed", never "drawn" — the
            // figure is the sum of the children's DECLARED maxima.
            ? _('%d of %d mA committed').format(hub.committedMa, hub.budgetMa)
            : _('%d mA committed').format(hub.committedMa);
        const powerRow = buildPropertyRow(
            _('Bus power'), valueText, device.category);
        if (hub.overBudget)
            powerRow.get_children()[0].add_style_class_name('usbee-detail-warning');
        detailBox.add_child(powerRow);
    }
}

/**
 * Billboard alt-mode row (BOS spec §7.4).
 *
 * Facts only — there is no warning flag and no signal for alt mode, and a
 * Billboard device reporting NotAttempted is very often simply not
 * connected through a Type-C port at all. The single combination worth an
 * always-visible row is Unsuccessful + `no_usb_pd`: the daemon has NAMED
 * the cause, so USBee can state it without inferring anything. Every other
 * state is left to the technical tier via the usb_altmode_state property
 * row.
 *
 * The row states a condition and stops — it does not tell the user to go
 * get a PD-capable port and cable. Quick task 260910-p91: the information
 * is sound (unlike the claims 260910-n10 and 260910-o99 withdrew — there
 * `no_usb_pd` has no counterpart, the cause was never named), but the
 * imperative is not. This machine has no PD controller at all
 * (`/sys/class/typec` is absent), so "use a port and cable that support
 * Power Delivery" resolves to "buy a different motherboard": an
 * instruction to do something the reader may have no path to, phrased as
 * though they do. Saying PD is absent, and what PD needs, carries the same
 * information without the promise that a fix is within reach.
 *
 * @param {St.BoxLayout} detailBox
 * @param {object} device
 * @param {Map<string,string>} props
 */
function buildAltModeBlock(detailBox, device, props) {
    const alt = deriveAltMode(device, props);
    if (!alt.actionable) return;

    // Name the SVID through the strings the transport pills already use;
    // anything else stays bare hex (BOS spec §3.3).
    let keyText = _('Alt mode');
    if (alt.svids.includes('ff01')) keyText = _('DisplayPort');
    else if (alt.svids.includes('8087')) keyText = _('Thunderbolt');

    const altRow = buildPropertyRow(
        keyText,
        // Translators: shown when a Billboard device reports that alt mode
        // did not come up because USB Power Delivery is missing. State the
        // condition only — PD needs a capable port AND a capable cable, and
        // on a machine with no PD controller there is nothing the reader can
        // swap. Must not become "use a USB-C port and cable that support…".
        _('Alt mode did not start — this connection does not provide USB Power Delivery, which needs both a port and a cable that support it'),
        device.category);
    altRow.get_children()[0].add_style_class_name('usbee-detail-warning');
    detailBox.add_child(altRow);
}

/**
 * Build the transport pill strip menu item (CONTEXT 260526-dmj §C).
 *
 * "Interesting" predicate: a DisplayPort alt-mode, Thunderbolt, or USB4
 * flag fires unconditionally; the USB 2 flag only fires for Type-C ports
 * (a Type-C port that only negotiated USB 2 is the surprise; USB 2 on a
 * USB-A device is the expected baseline and would be noise).
 *
 * Pills render in a fixed order — USB → DisplayPort → Thunderbolt — so
 * grouping reads predictably across devices. USB4 joins the USB group
 * after USB 3 (added in v2.2.0 alongside usbeehive 0.8.0).
 *
 * @param {object} device  Unpacked DeviceEntry.
 * @param {Map<string,string>} props  device.properties as a Map.
 * @returns {PopupMenu.PopupBaseMenuItem|null}  null when no pill should render.
 */
function buildTransportPillStrip(device, props) {
    const usb2 = props.get('transport.usb2') === 'true';
    const usb3 = props.get('transport.usb3') === 'true';
    const usb4 = props.get('transport.usb4') === 'true';
    const dp   = props.get('transport.dp_altmode') === 'true';
    const tb   = props.get('transport.tb') === 'true';

    const interesting = dp || tb || usb4
        || (usb2 && device.category === 'TypeCPort');
    if (!interesting) return null;

    const pills = [];
    if (usb2) pills.push(_('USB 2'));
    if (usb3) pills.push(_('USB 3'));
    if (usb4) pills.push(_('USB 4'));
    if (dp)   pills.push(_('DisplayPort'));
    if (tb)   pills.push(_('Thunderbolt'));
    if (pills.length === 0) return null;

    const item = new PopupMenu.PopupBaseMenuItem({
        reactive:  false,
        can_focus: false,
    });
    const strip = new St.BoxLayout({
        vertical:    false,
        x_expand:    true,
        style_class: 'usbee-pill-strip',
    });
    for (const label of pills) {
        strip.add_child(new St.Label({
            text:        label,
            style_class: 'usbee-pill',
        }));
    }
    item.add_child(strip);
    return item;
}

/**
 * Render the structured Charger PDOs block (CONTEXT 260526-dmj §D).
 *
 * No-op when the device has no PDO list (the daemon emits an empty array
 * for entries without a companion PowerDeliveryPort). When non-empty,
 * renders a header row followed by one row per advertised PDO. The active
 * PDO is marked with a leading ◀ and a bolder key label (belt-and-braces:
 * either `is_active` true or `index === active_pdo_index` flips it).
 *
 * The CEILING PDO — the highest power this charger and cable advertise — is
 * marked too (quick task 260915-ikd), because "what it is using versus the
 * most it could use" is the direct answer to why a laptop charges slowly.
 * The two markers compose across COLUMNS rather than competing in one: the
 * active marker owns the key (◀ plus bold), the ceiling appends "(max)" to
 * the key and bolds the VALUE, whose numbers are what the reader came for.
 * A PDO that is both therefore renders as one coherent row.
 *
 * Voltage rendering:
 *   - PPS PDOs (kind === 'PPS') and PDOs that advertise a max_voltage
 *     greater than voltage render as a range "5–11 V".
 *   - Fixed PDOs (and anything with a flat voltage) render as "5 V".
 *
 * Kind annotation: anything other than 'Fixed' is appended as " (Kind)".
 * The kind string is passed through raw — forward-compat with new PD
 * revisions adding kinds USBee doesn't yet recognise.
 *
 * @param {St.BoxLayout} detailBox  Parent vertical box from buildDeviceRow.
 * @param {object} device           Unpacked DeviceEntry from the store.
 */
function buildPdoListBlock(detailBox, device) {
    const pdos = device.pdo_list || [];
    if (pdos.length === 0) return;

    detailBox.add_child(buildPropertyRow(
        _('Charger PDOs'), '', device.category));

    // Derived client-side from `pdo_list[].power_mw`, which is already on the
    // wire — no daemon change. null when the list has one entry (the ceiling
    // would be itself), when the maximum is tied, or when nothing advertises
    // real power; the marker is then simply not rendered.
    const maxIdx = maxPdoIndex(pdos);

    for (const pdo of pdos) {
        const isActive = pdo.is_active === true
            || pdo.index === device.active_pdo_index;
        const isMax = maxIdx !== null && pdo.index === maxIdx;

        const isRange = pdo.kind === 'PPS'
            || (pdo.max_voltage_mv > pdo.voltage_mv);
        const voltsText = isRange
            // Strip the trailing " V" from the min side so the unit only
            // appears once after the en-dash (e.g. "5–11 V", not "5 V–11 V").
            ? `${formatVolts(pdo.voltage_mv).replace(' V', '')}–${formatVolts(pdo.max_voltage_mv)}`
            : formatVolts(pdo.voltage_mv);
        const ampsText = formatAmps(pdo.current_ma);
        const wattsText = formatWatts(pdo.power_mw / 1000);

        let valueText = `${voltsText} — ${ampsText} — ${wattsText}`;
        if (pdo.kind && pdo.kind !== 'Fixed')
            valueText += ` (${pdo.kind})`;

        let keyText = isActive
            ? `${_('◀')} ${pdo.index}`
            : `${pdo.index}`;
        if (isMax) {
            // Translators: %s is the PDO's number, already carrying the ◀
            // active marker when this is also the one in use. "max" means
            // the highest power this charger and cable ADVERTISE — not the
            // power being drawn. Keep it an annotation; the parentheses are
            // what let it sit beside a number in any locale.
            keyText = _('%s (max)').format(keyText);
        }

        const pdoRow = buildPropertyRow(keyText, valueText, device.category);
        if (isActive)
            pdoRow.add_style_class_name('usbee-pdo-active');
        if (isMax)
            pdoRow.add_style_class_name('usbee-pdo-max');
        detailBox.add_child(pdoRow);
    }
}

/**
 * Build a single horizontal property row (key + value labels).
 *
 * The key label uses .usbee-detail-key (dim secondary colour).
 * The value label uses .usbee-detail-value (regular weight).
 * DIAG-02: value wraps cleanly via clutter_text.line_wrap.
 *
 * Both labels MUST clear the ellipsize mode St.Label ships with
 * (PANGO_ELLIPSIZE_END). ClutterText hands Pango both the ellipsize mode
 * and the wrap mode but never sets a layout height, and Pango's default
 * height of -1 means "ellipsize at line one" — so an St.Label with
 * line_wrap = true and the stock ellipsize still renders exactly one
 * truncated line. Setting ellipsize = NONE is what makes the wrap above
 * take effect (quick task 260910-ggy).
 *
 * Clearing it on the KEY label matters for a second reason: with an
 * ellipsize mode set, ClutterText reports a minimum width of 0, so a
 * squeezed row could truncate the key too. With ellipsize = NONE and no
 * wrap, its minimum width is its natural width — the key is always shown
 * in full and the value column absorbs the squeeze.
 *
 * @param {string} key    Translated left-column label (e.g. 'Speed').
 * @param {string} value  Raw daemon string — rendered via .text, never markup.
 * @param {string} _category  Device category (unused here; passed for forward use).
 * @returns {St.BoxLayout}
 */
function buildPropertyRow(key, value, _category) {
    // WR-06: St.BoxLayout defaults to horizontal (vertical: false). The
    // .usbee-detail-row style_class gives the inter-column spacing instead of
    // a generic descendant selector on StBoxLayout.
    const row = new St.BoxLayout({
        vertical:    false,
        x_expand:    true,
        style_class: 'usbee-detail-row',
    });

    const keyLbl = new St.Label({
        text:        key,
        x_expand:    false,
        // Sit on the first line of a value that wrapped to several.
        y_align:     Clutter.ActorAlign.START,
        style_class: 'usbee-detail-key',
    });
    keyLbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

    const valLbl = new St.Label({
        text:        value,
        x_expand:    true,
        style_class: 'usbee-detail-value',
    });
    // DIAG-02: multi-line diagnostic strings must wrap cleanly.
    valLbl.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;
    valLbl.clutter_text.line_wrap      = true;
    valLbl.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

    row.add_child(keyLbl);
    row.add_child(valLbl);
    return row;
}
