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
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {buildEmptyStateItem, buildDaemonNotInstalledItem, buildDaemonOutOfDateItem,
    buildDaemonTooNewItem} from './empty-state.js';
import {hasIssue, formatVolts, formatAmps, formatWatts} from './device-store.js';
import {iconForDevice} from './device-icon.js';
import {formatValueForKey, labelForKey} from './label-table.js';
import {deriveAltMode, deriveHubInfo, deriveLinkInfo, propsOf, resolveHeadline}
    from './link-verdict.js';
import {isTechnicalKey, shouldRenderProperty} from './property-policy.js';

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
    // populate() before removeAll() destroys the menu actors. Without this,
    // a stale 'open-state-changed' fired mid-rebuild (e.g. user double-clicks
    // the tile while a row is mid-animation) can call .isOpen / .close() on
    // a destroyed PopupSubMenu, triggering a "instance is invalid" gobject
    // finalize error.
    for (const item of section._getMenuItems()) {
        if (item._usbeeAccordionSigId && item.menu) {
            item.menu.disconnect(item._usbeeAccordionSigId);
            item._usbeeAccordionSigId = 0;
        }
    }
    // Must be first (after handler cleanup) — never mutate while iterating (Pitfall C).
    section.removeAll();

    // PREFS-04 consumer — live read on every popover open (D-11 lazy-rebuild).
    // Filter predicate uses daemon-emitted tokens 'TypeCPort' / 'Empty'
    // (same strings src/device-store.js Tier-1 filter consumes).
    const settings = extension.getSettings();
    const hideEmpty = settings.get_boolean('hide-empty-ports');
    const showHubs  = settings.get_boolean('show-hubs');
    // Quick task 260526-c6p — live read parallel to the two above. Gates
    // the technical tier of src/property-policy.js inside buildDeviceRow's
    // property-bag loop.
    const showTech  = settings.get_boolean('show-technical-details');
    let devices = store.devices;
    if (hideEmpty)
        devices = devices.filter(d => !(d.category === 'TypeCPort' && d.status === 'Empty'));
    // Quick task 260905-b0s: a hub with an issue is shown even when hubs are
    // hidden. `port.peer_state` — the key that explains WHY a SuperSpeed
    // device linked at 480 Mb/s — exists only on root-hub ports, so the
    // explanation lives on the hub row. Hiding it would leave a
    // default-config user with a warning and no reachable cause. Only
    // Degraded / over-budget hubs surface; a BelowCapability hub (the common,
    // benign case) stays hidden.
    if (!showHubs)
        devices = devices.filter(d => d.category !== 'Hub' || hasIssue(d));

    if (devices.length === 0) {
        section.addMenuItem(new PopupMenu.PopupMenuItem(
            _('No USB devices attached'),
            {reactive: false, can_focus: false},
        ));
        return {count: 0, issues: 0};
    }

    // UI-03 — Issue-first stable sort. hasIssue(b) - hasIssue(a) floats
    // issue devices to the top; equal keys preserve insertion order.
    devices = [...devices].sort((a, b) =>
        Number(hasIssue(b)) - Number(hasIssue(a)));

    // Build one accordion row per device and wire the single-open constraint.
    const rows = [];
    for (const device of devices) {
        const row = buildDeviceRow(device, showTech);
        section.addMenuItem(row);
        rows.push(row);
    }

    // UI-02 — Single-row accordion: when a row opens, close all others.
    // Each connection's signal id is stashed on the row so the next
    // populateDeviceRows() invocation can disconnect it before
    // section.removeAll() destroys the menu actors (CR-02 mitigation,
    // T-03-04 mitigation).
    for (const row of rows) {
        const sigId = row.menu.connect('open-state-changed', (_menu, open) => {
            if (!open) return;
            for (const other of rows) {
                // Defensive: other.menu may have been destroyed by a
                // concurrent rebuild before this handler ran.
                if (other !== row && other.menu && other.menu.isOpen)
                    other.menu.close(/* animate */ true);
            }
        });
        row._usbeeAccordionSigId = sigId;
    }
    return {
        count:  devices.length,
        issues: devices.filter(hasIssue).length,
    };
}

/**
 * Render the empty state (daemon not running).
 * Unchanged from v1.0 — delegates to buildEmptyStateItem.
 *
 * @param {PopupMenuSection} section
 */
export function populateEmptyState(section) {
    section.removeAll();
    section.addMenuItem(buildEmptyStateItem());
}

/**
 * Render the "daemon not installed" empty state (quick task 260526-i7q).
 * Wired from tile.js _rebuildPopover() when the daemon is not running AND
 * isUsbeehiveServiceInstalled() returns false. Mirrors the populateEmptyState
 * shape but uses the dedicated copy from src/empty-state.js.
 *
 * @param {PopupMenuSection} section
 */
export function populateNotInstalledState(section) {
    section.removeAll();
    section.addMenuItem(buildDaemonNotInstalledItem());
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
    section.removeAll();
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
    section.removeAll();
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
        if (link.isWarning)
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

    // Billboard alt mode — facts only, with exactly one actionable case.
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
    return row;
}

/**
 * Render the Link block: negotiated rate, the daemon's capability verdict,
 * the connector explanation, and the one instruction the user can act on.
 *
 * All of it is composed HERE from structured tokens rather than read out of
 * the daemon's own `data_rate.summary` / `.detail` prose, because the
 * daemon's strings are English-only while these go through gettext.
 *
 * The verdict rules are not negotiable (BOS spec §6):
 *   AtCapability    — neutral confirmation.
 *   BelowCapability — informational, phrased as a possibility. On the
 *                     daemon's reference machine 2 of 2 BOS-bearing devices
 *                     land here and both are working exactly as intended,
 *                     so this must never look like a fault.
 *   Degraded        — the only warning. Amber, plus a Fix row.
 *   absent/unknown  — say nothing beyond the rate itself.
 *
 * @param {St.BoxLayout} detailBox
 * @param {object} device
 * @param {object} link  deriveLinkInfo() result.
 */
function buildLinkBlock(detailBox, device, link) {
    if (link.rateText === '') return;

    // "480 Mb/s (USB 2.1)" — the version is a daemon string rendered
    // verbatim, so an unrecognised future value still reads correctly.
    const base = link.usbVersion
        // Translators: %1$s is a link rate ("480 Mb/s"), %2$s a USB version
        // number ("2.1"). Renders as "480 Mb/s (USB 2.1)".
        ? _('%s (USB %s)').format(link.rateText, link.usbVersion)
        : link.rateText;

    let valueText = base;
    if (link.verdict === 'AtCapability') {
        // Translators: %s is "480 Mb/s (USB 2.1)". The device is running as
        // fast as it is able to.
        valueText = _('%s — full capability').format(base);
    } else if (link.verdict === 'BelowCapability' && link.capableText !== '') {
        // Translators: %1$s is the current link ("480 Mb/s (USB 2.1)"),
        // %2$s the speed the device advertises ("SuperSpeed 5 Gbps"). A
        // POSSIBILITY, never a fault — the device's own vendor declares it
        // fully functional at the slower rate.
        valueText = _('%s — could run at %s on a faster port')
            .format(base, link.capableText);
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

    // The connector explanation. Reuses the existing 'Detail' key so the
    // panel keeps one vocabulary for "here is why".
    const hintText = connectorHintText(link.connectorHint);
    if (hintText !== '') {
        detailBox.add_child(buildPropertyRow(
            _('Detail'), hintText, device.category));
    }

    // Only a Degraded verdict earns an instruction. BelowCapability already
    // said "could", which is as far as the evidence goes.
    if (link.isWarning) {
        detailBox.add_child(buildPropertyRow(
            _('Fix'),
            _('Move it to a USB 3 port or use a cable that supports it'),
            device.category));
    }
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
    case 'ss-never-linked':
        return _('The SuperSpeed lines of this connector never linked — a USB 2-only cable or port');
    case 'ss-unstable':
        return _('The SuperSpeed link on this connector is unstable — try another cable');
    case 'ss-elsewhere':
        return _("This connector's high-speed lanes are up, but this device is not on them");
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
 * connected through a Type-C port at all. The single actionable
 * combination is Unsuccessful + `no_usb_pd`, which is a cable or port that
 * cannot do USB Power Delivery; that one gets an always-visible row. Every
 * other state is left to the technical tier via the usb_altmode_state
 * property row.
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
        _('Alt mode failed: no USB-PD on this connection — use a USB-C port and cable that support Power Delivery'),
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

    for (const pdo of pdos) {
        const isActive = pdo.is_active === true
            || pdo.index === device.active_pdo_index;

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

        const keyText = isActive
            ? `${_('◀')} ${pdo.index}`
            : `${pdo.index}`;

        const pdoRow = buildPropertyRow(keyText, valueText, device.category);
        if (isActive)
            pdoRow.add_style_class_name('usbee-pdo-active');
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
        style_class: 'usbee-detail-key',
    });

    const valLbl = new St.Label({
        text:        value,
        x_expand:    true,
        style_class: 'usbee-detail-value',
    });
    // DIAG-02: multi-line diagnostic strings must wrap cleanly.
    valLbl.clutter_text.line_wrap      = true;
    valLbl.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

    row.add_child(keyLbl);
    row.add_child(valLbl);
    return row;
}
