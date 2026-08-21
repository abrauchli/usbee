// SPDX-License-Identifier: GPL-3.0-or-later
//
// prefs.js — runs in the gnome-shell-extension-prefs process. The ONLY
// file in this repo that imports gi://Gtk or gi://Adw (CLAUDE.md C-03 +
// 01-CONTEXT.md D-17). Importing these in any Shell-process file is an
// EGO rejection.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';

import {ExtensionPreferences, gettext as _}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// src/daemon-status.js is the ONLY src/ module this file may import, and
// only because it imports nothing itself. This process cannot resolve
// resource:///org/gnome/shell/extensions/extension.js, so importing
// dbus-client.js or empty-state.js (which pull it in for gettext) would
// fail at load time and leave the preferences window blank.
import {MIN_USBEEHIVE_VERSION, UPDATE_CMD, isVersionAtLeast}
    from './src/daemon-status.js';

// Daemon bus coordinates — must match src/dbus-client.js. The generation
// digit lives only on the interface name, not on bus name or object path.
const USBEEHIVE_BUS_NAME    = 'org.usbeehive.Devices';
const USBEEHIVE_OBJECT_PATH = '/org/usbeehive/Devices';

// Minimal IFACE_XML — only the Version property is consumed here, but
// declaring it lets makeProxyWrapper synthesise the cached-property
// accessor (no separate Get call needed at runtime).
const USBEEHIVE_IFACE_XML = `<node>
  <interface name="org.usbeehive.Devices5">
    <property name="Version" type="s" access="read"/>
  </interface>
</node>`;

const UsbeehiveVersionProxy = Gio.DBusProxy.makeProxyWrapper(USBEEHIVE_IFACE_XML);

export default class USBeePreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings; // keep alive across the window's lifetime

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'network-usb-symbolic',
        });
        window.add(page);

        this._buildNotificationsGroup(page, settings, window);
        this._buildGeneralGroup(page, settings, window);
        this._buildAboutGroup(page, window);
    }

    // ── Group 1: Notifications (muted ports) ─────────────────────────
    _buildNotificationsGroup(page, settings, window) {
        const notifGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
            description: _('Manage which USB-C ports may raise degradation warnings'),
        });
        page.add(notifGroup);

        // §Pitfall J — Adw.PreferencesGroup has no bulk-clear method; track
        // rows manually so we can remove them one-by-one on each rebuild.
        const mutedRows = [];
        const rebuildMutedRows = () => {
            for (const row of mutedRows) notifGroup.remove(row);
            mutedRows.length = 0;

            const mutes = settings.get_strv('port-mutes');
            if (mutes.length === 0) {
                const empty = new Adw.ActionRow({
                    title: _('No muted ports'),
                    subtitle: _('Mute a port from a notification to see it here'),
                    sensitive: false,  // disabled — UI-SPEC §Component-Inventory pin
                });
                notifGroup.add(empty);
                mutedRows.push(empty);
                return;
            }
            for (const id of mutes) {
                const portNumber = parseInt(id, 10);
                // §T-02-08 — tolerate poisoned (non-stringified-int) entries;
                // skip them rather than crashing the prefs window.
                if (Number.isNaN(portNumber)) continue;

                const row = new Adw.ActionRow({
                    title: _('USB-C Port %d').format(portNumber),
                    subtitle: _('Notifications muted'),
                });
                const button = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: _('Unmute this port'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat', 'destructive-action'],  // UI-SPEC §Color destructive role
                });
                button.connect('clicked', () => {
                    const current = settings.get_strv('port-mutes');
                    settings.set_strv('port-mutes', current.filter(x => x !== id));
                    // 'changed::port-mutes' fires and rebuildMutedRows re-runs
                });
                row.add_suffix(button);
                row.set_activatable_widget(button);
                notifGroup.add(row);
                mutedRows.push(row);
            }
        };

        rebuildMutedRows();
        const mutesChangedId = settings.connect('changed::port-mutes', rebuildMutedRows);

        // Disconnect when the window closes (prefs-process lifecycle).
        // The prefs process owns its own teardown via 'close-request' —
        // it does NOT use the Shell-process signal-registry pattern.
        window.connect('close-request', () => {
            settings.disconnect(mutesChangedId);
            return false; // don't prevent close
        });
    }

    // ── Group 2: General (hide-empty-ports, show-hubs, show-technical-details,
    //              device-change-notify-scope) ──────────────────────────
    _buildGeneralGroup(page, settings, window) {
        const generalGroup = new Adw.PreferencesGroup({title: _('General')});
        page.add(generalGroup);

        const hideRow = new Adw.SwitchRow({
            title: _('Hide empty USB-C ports'),
            subtitle: _("Don't list ports with nothing attached"),
        });
        generalGroup.add(hideRow);
        settings.bind('hide-empty-ports', hideRow, 'active',
                      Gio.SettingsBindFlags.DEFAULT);

        const hubRow = new Adw.SwitchRow({
            title: _('Show USB Hubs'),
            subtitle: _('Include USB hub devices in the device list'),
        });
        generalGroup.add(hubRow);
        settings.bind('show-hubs', hubRow, 'active',
                      Gio.SettingsBindFlags.DEFAULT);

        // Quick task 260526-c6p — gate the explicit-deny GATED_KEYS list
        // in src/popover.js behind a user-facing toggle. Default false keeps
        // the popover glanceable for non-technical users (CONTEXT D-2).
        const techRow = new Adw.SwitchRow({
            title: _('Show technical details'),
            subtitle: _('Include advanced rows (serial, data role, cable details, drivers) in the device popover'),
        });
        generalGroup.add(techRow);
        settings.bind('show-technical-details', techRow, 'active',
                      Gio.SettingsBindFlags.DEFAULT);

        // Notify-scope ComboRow — three-option enum exposed as a GSettings
        // string with <choices>. GSettings cannot auto-bind ComboRow.selected
        // (a uint index) to a string value, so we wire both directions
        // manually and disconnect both handlers on window close-request
        // (mirrors the _buildNotificationsGroup teardown pattern).
        // Quick task 260526-i7q — labels shortened so the ComboRow's
        // collapsed-state selected-value display fits without ellipsis at
        // the default prefs window width (~150-200 px of selected-value
        // real estate fits ~22-26 chars). The row title and subtitle carry
        // the "Notify..." verb context, so the option strings can drop the
        // prefix without losing meaning (mirrors GNOME settings convention
        // for similar enum rows, e.g. Privacy → "File History & Trash").
        // The GSettings value strings ('all', 'power', 'off') are the
        // schema-bound identifiers and remain unchanged.
        const scopeChoices = [
            {value: 'all',   label: _('All device changes')},
            {value: 'power', label: _('Charging-relevant only')},
            {value: 'off',   label: _('Off')},
        ];
        const scopeModel = new Gtk.StringList();
        for (const c of scopeChoices) scopeModel.append(c.label);

        const scopeRow = new Adw.ComboRow({
            title: _('Notify on device changes'),
            subtitle: _('Toasts when a USB device is connected or disconnected'),
            model: scopeModel,
        });
        generalGroup.add(scopeRow);

        // Initial selection from current setting value. An unknown value
        // (e.g. set out-of-band by `gsettings set`) collapses to index 0
        // — matches the Notifier's default-allow on unknown scope.
        const currentScope = settings.get_string('device-change-notify-scope');
        const initialIdx = scopeChoices.findIndex(c => c.value === currentScope);
        scopeRow.selected = initialIdx >= 0 ? initialIdx : 0;

        // Two-way wiring: row → settings, settings → row.
        const rowSelectedId = scopeRow.connect('notify::selected', () => {
            const sel = scopeRow.selected;
            if (sel < 0 || sel >= scopeChoices.length) return;
            settings.set_string('device-change-notify-scope', scopeChoices[sel].value);
        });
        const settingsScopeId = settings.connect(
            'changed::device-change-notify-scope', () => {
                const v = settings.get_string('device-change-notify-scope');
                const idx = scopeChoices.findIndex(c => c.value === v);
                if (idx >= 0 && scopeRow.selected !== idx) scopeRow.selected = idx;
            });

        // Prefs-process lifecycle teardown — disconnect both handler ids
        // so the row and the GSettings object aren't held alive by stale
        // signal references after the window closes (parallel to the
        // mutesChangedId disconnect in _buildNotificationsGroup).
        window.connect('close-request', () => {
            scopeRow.disconnect(rowSelectedId);
            settings.disconnect(settingsScopeId);
            return false; // don't prevent close
        });
    }

    // ── Group 3: About ───────────────────────────────────────────────
    _buildAboutGroup(page, window) {
        const aboutGroup = new Adw.PreferencesGroup({title: _('About')});
        page.add(aboutGroup);

        const versionRow = new Adw.ActionRow({
            title: _('Version'),
            subtitle: this.metadata['version-name'] || '1.0',  // NOT translated — it's a number
        });
        aboutGroup.add(versionRow);

        const daemonRow = new Adw.ActionRow({
            title: _('usbeehive daemon'),
            subtitle: _('Checking…'),
        });
        aboutGroup.add(daemonRow);

        // Shown only when the detected daemon version fails the gate — a
        // user with a healthy daemon has no use for an update command.
        const updateRow = new Adw.ActionRow({
            title: _('Update command'),
            subtitle: UPDATE_CMD,       // NOT translated — a literal command
            subtitle_selectable: true,
            visible: false,
        });
        const copyButton = new Gtk.Button({
            icon_name: 'edit-copy-symbolic',
            tooltip_text: _('Copy command'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        // Pending copy-confirmation timeout, removed on window close so the
        // source cannot outlive the widget (T-ke2-04, prefs-process half).
        let copyFeedbackId = 0;
        copyButton.connect('clicked', () => {
            // GTK4 clipboard — a different API from the Shell's St.Clipboard
            // in src/empty-state.js. The two processes cannot share one.
            // Gdk.Clipboard.set_text is not introspectable under GJS; set()
            // is.
            window.get_display().get_clipboard().set(UPDATE_CMD);
            copyButton.icon_name = 'object-select-symbolic';
            if (copyFeedbackId !== 0) GLib.Source.remove(copyFeedbackId);
            copyFeedbackId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                copyFeedbackId = 0;
                copyButton.icon_name = 'edit-copy-symbolic';
                return GLib.SOURCE_REMOVE;
            });
        });
        updateRow.add_suffix(copyButton);
        updateRow.set_activatable_widget(copyButton);
        aboutGroup.add(updateRow);

        // Live daemon-version probe — async (D-15: no sync D-Bus).
        // We hold a single proxy reference; bus_watch_name re-fires on
        // owner transitions and re-reads the cached Version property.
        let proxy = null;

        const setRunning = () => {
            const v = proxy?.Version;
            // T-ke2-01: `v` is bus data — any session process can own
            // org.usbeehive.Devices. Adwaita subtitles parse Pango markup
            // (including <a href>), so clamp AND escape before display.
            const escaped = GLib.markup_escape_text(String(v).slice(0, 32), -1);
            if (isVersionAtLeast(v, MIN_USBEEHIVE_VERSION)) {
                // Show "usbeehived 0.11.0" when the version is acceptable.
                daemonRow.subtitle = `usbeehived ${escaped}`;
                updateRow.visible = false;
                return;
            }
            // Reachable but rejected. Distinguish "we couldn't read a
            // version at all" from "we read one and it's too old" — the
            // first is the shape of a false positive worth surfacing
            // honestly rather than blaming the user's daemon.
            daemonRow.subtitle = typeof v === 'string' && v
                ? _('usbeehived %s — out of date, requires %s or newer')
                    .format(escaped, MIN_USBEEHIVE_VERSION)
                : _('usbeehived — version unknown, requires %s or newer')
                    .format(MIN_USBEEHIVE_VERSION);
            updateRow.visible = true;
        };
        const setStopped = () => {
            daemonRow.subtitle = _('Start usbeehived daemon');
            // Nothing on the bus — starting the daemon is the right advice,
            // not updating it.
            updateRow.visible = false;
        };

        const ensureProxy = () => {
            if (proxy !== null) {
                setRunning();
                return;
            }
            new UsbeehiveVersionProxy(
                Gio.DBus.session,
                USBEEHIVE_BUS_NAME,
                USBEEHIVE_OBJECT_PATH,
                (p, error) => {
                    if (error) {
                        setStopped();
                        return;
                    }
                    proxy = p;
                    setRunning();
                },
            );
        };

        const busWatchId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            USBEEHIVE_BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            () => ensureProxy(),
            () => {
                // Owner vanished — the cached proxy is now talking to a
                // dead name. Drop it so the next appear constructs fresh.
                proxy = null;
                setStopped();
            },
        );

        // Prefs-process lifecycle teardown — mirror the Notifications
        // group pattern. The Shell-side SignalRegistry doesn't reach here.
        window.connect('close-request', () => {
            Gio.bus_unwatch_name(busWatchId);
            if (copyFeedbackId !== 0) {
                GLib.Source.remove(copyFeedbackId);
                copyFeedbackId = 0;
            }
            proxy = null;
            return false;  // don't prevent close
        });
    }
}
