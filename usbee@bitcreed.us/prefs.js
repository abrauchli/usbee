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

// src/daemon-status.js and src/service-probe.js are the ONLY src/ modules
// this file may import, and only because neither pulls in a gnome-shell
// resource URI: daemon-status.js imports nothing at all, service-probe.js
// imports gi://Gio and gi://GLib and nothing else. This process cannot
// resolve resource:///org/gnome/shell/extensions/extension.js, so importing
// dbus-client.js or empty-state.js (which pull it in for gettext) would
// fail at load time and leave the preferences window blank.
import {INSTALL_CMD, MIN_USBEEHIVE_VERSION, SETUP_CMD, UPDATE_CMD,
    isVersionAtLeast} from './src/daemon-status.js';
import {InstallState, invalidateInstallCache, probeInstallState,
    refreshInstallStateAsync, startDaemonUnit} from './src/service-probe.js';

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
            description: _('Manage which ports and devices may raise warnings'),
        });
        page.add(notifGroup);

        // §Pitfall J — Adw.PreferencesGroup has no bulk-clear method; track
        // rows manually so we can remove them one-by-one on each rebuild.
        const mutedRows = [];
        const rebuildMutedRows = () => {
            for (const row of mutedRows) notifGroup.remove(row);
            mutedRows.length = 0;

            const mutes = settings.get_strv('port-mutes');
            // Quick task 260905-b0s: data-rate mutes are (id, headline)
            // pairs on a separate key, keyed on the daemon's device id
            // rather than a Type-C port number. Read defensively — a list
            // poisoned out-of-band with `gsettings` must not blank the
            // preferences window.
            let deviceMutes = [];
            const rawDeviceMutes = settings.get_value('data-rate-mutes').deep_unpack();
            if (Array.isArray(rawDeviceMutes)) {
                deviceMutes = rawDeviceMutes.filter(
                    e => Array.isArray(e) && typeof e[0] === 'string' && e[0] !== '');
            }

            if (mutes.length === 0 && deviceMutes.length === 0) {
                const empty = new Adw.ActionRow({
                    title: _('Nothing muted'),
                    subtitle: _('Mute a port or device from a notification to see it here'),
                    sensitive: false,  // disabled — UI-SPEC §Component-Inventory pin
                });
                notifGroup.add(empty);
                mutedRows.push(empty);
                return;
            }

            for (const [id, headline] of deviceMutes) {
                const row = new Adw.ActionRow({
                    // Adwaita subtitles parse Pango markup, and both halves
                    // are bus data (the daemon names the device). Clamp and
                    // escape, exactly as the About group does for Version.
                    title: GLib.markup_escape_text(
                        String(headline || id).slice(0, 64), -1),
                    subtitle: _('Data-rate warnings muted'),
                });
                const button = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: _('Unmute this device'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat', 'destructive-action'],
                });
                button.connect('clicked', () => {
                    const current = settings.get_value('data-rate-mutes').deep_unpack();
                    const kept = (Array.isArray(current) ? current : [])
                        .filter(e => Array.isArray(e) && e[0] !== id);
                    settings.set_value('data-rate-mutes',
                        new GLib.Variant('a(ss)', kept));
                    // 'changed::data-rate-mutes' fires and rebuildMutedRows re-runs
                });
                row.add_suffix(button);
                row.set_activatable_widget(button);
                notifGroup.add(row);
                mutedRows.push(row);
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
        const deviceMutesChangedId = settings.connect(
            'changed::data-rate-mutes', rebuildMutedRows);

        // Disconnect when the window closes (prefs-process lifecycle).
        // The prefs process owns its own teardown via 'close-request' —
        // it does NOT use the Shell-process signal-registry pattern.
        window.connect('close-request', () => {
            settings.disconnect(mutesChangedId);
            settings.disconnect(deviceMutesChangedId);
            return false; // don't prevent close
        });
    }

    // ── Group 2: General (hide-empty-ports, hide-builtin-devices, show-hubs,
    //              show-technical-details, device-change-notify-scope) ─────
    // Every switch here is also reachable from the popover's Options section
    // (src/popover.js buildOptionsSection); both surfaces bind the same keys,
    // so a change on either side shows up live on the other.
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

        // Quick task 260915-i4w — usbeehive already reports which devices are
        // soldered into the machine (`mount == 'fixed'`); this turns that into
        // a filter. Placed next to "Hide empty USB-C ports" because both
        // remove things the user cannot act on, and kept separate from "Show
        // USB Hubs" because a built-in device is a real device, not topology.
        const builtinRow = new Adw.SwitchRow({
            title: _('Hide built-in devices'),
            subtitle: _('Leave out hardware soldered into this machine, like the webcam or fingerprint reader'),
        });
        generalGroup.add(builtinRow);
        settings.bind('hide-builtin-devices', builtinRow, 'active',
                      Gio.SettingsBindFlags.DEFAULT);

        const hubRow = new Adw.SwitchRow({
            title: _('Show USB Hubs'),
            subtitle: _('Include USB hub devices in the device list'),
        });
        generalGroup.add(hubRow);
        settings.bind('show-hubs', hubRow, 'active',
                      Gio.SettingsBindFlags.DEFAULT);

        // Quick task 260526-c6p — gate the advanced property rows in
        // src/popover.js behind a user-facing toggle. Default false keeps
        // the popover glanceable for non-technical users.
        // Quick task 260905-b0s — the subtitle no longer enumerates the
        // gated keys: the list moved to src/property-policy.js and grows
        // with every daemon release, so an enumeration goes stale.
        const techRow = new Adw.SwitchRow({
            title: _('Show technical details'),
            subtitle: _('Include advanced rows and unrecognised daemon fields in the device popover'),
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

        // Start button. Present only when a usbeehived.service unit exists
        // and nothing owns the bus name — with no unit there is nothing to
        // start, and with the daemon running there is nothing to do.
        // Quick task 260910-myu: before this, the entire stopped-daemon
        // story in this window was one subtitle reading "Start usbeehived
        // daemon", which said nothing about how.
        const startButton = new Gtk.Button({
            label: _('Start'),
            valign: Gtk.Align.CENTER,
            visible: false,
            css_classes: ['suggested-action'],
        });
        daemonRow.add_suffix(startButton);
        aboutGroup.add(daemonRow);

        // Pending timeouts owned by this group, removed on window close so
        // no source outlives its widget (T-ke2-04, prefs-process half).
        const pending = new Set();
        const addTimeout = (ms, fn) => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                pending.delete(id);
                fn();
                return GLib.SOURCE_REMOVE;
            });
            pending.add(id);
            return id;
        };

        // The window can close while an async D-Bus reply is still in
        // flight; touching a finalized widget from the callback is how you
        // get GTK criticals in the journal.
        let alive = true;

        /**
         * One copy-pasteable command row. Three of them exist — update,
         * service setup, full install — and exactly one is ever visible,
         * chosen by the daemon's actual state.
         *
         * @param {string} title    Translated row title.
         * @param {string} command  Literal shell command; never translated,
         *   never interpolated from bus or user data.
         * @returns {Adw.ActionRow}
         */
        const buildCommandRow = (title, command) => {
            const row = new Adw.ActionRow({
                title,
                // NOT translated — a literal command. It IS markup-escaped:
                // Adwaita subtitles parse Pango markup, and every command
                // here chains with `&&`, which Pango reads as an unterminated
                // entity and refuses — "Failed to set text ... escape
                // ampersand as &amp;" in the journal, and a row that renders
                // wrong. Pango unescapes it again for display, and the
                // clipboard write below still uses the raw command.
                subtitle: GLib.markup_escape_text(command, -1),
                subtitle_selectable: true,
                visible: false,
            });
            const copyButton = new Gtk.Button({
                icon_name: 'edit-copy-symbolic',
                tooltip_text: _('Copy command'),
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            copyButton.connect('clicked', () => {
                // GTK4 clipboard — a different API from the Shell's
                // St.Clipboard in src/empty-state.js. The two processes
                // cannot share one. Gdk.Clipboard.set_text is not
                // introspectable under GJS; set() is.
                window.get_display().get_clipboard().set(command);
                copyButton.icon_name = 'object-select-symbolic';
                addTimeout(1500, () => {
                    if (alive) copyButton.icon_name = 'edit-copy-symbolic';
                });
            });
            row.add_suffix(copyButton);
            row.set_activatable_widget(copyButton);
            aboutGroup.add(row);
            return row;
        };

        // Shown only when the detected daemon version fails the gate — a
        // user with a healthy daemon has no use for an update command.
        const updateRow = buildCommandRow(_('Update command'), UPDATE_CMD);
        // Binary present, no systemd unit: `cargo install` is already done.
        const setupRow = buildCommandRow(_('Set-up command'), SETUP_CMD);
        // Neither binary nor unit.
        const installRow = buildCommandRow(_('Install command'), INSTALL_CMD);

        const hideCommandRows = () => {
            updateRow.visible = false;
            setupRow.visible = false;
            installRow.visible = false;
        };

        // Live daemon-version probe — async (D-15: no sync D-Bus).
        // We hold a single proxy reference; bus_watch_name re-fires on
        // owner transitions and re-reads the cached Version property.
        let proxy = null;
        // Whether anything currently owns org.usbeehive.Devices. Maintained
        // by the name watch and consulted by the Start watchdog, which must
        // distinguish "systemd took the job and the daemon came up" from
        // "systemd took the job and the daemon died on its face".
        let daemonOnBus = false;

        const setRunning = () => {
            const v = proxy?.Version;
            // T-ke2-01: `v` is bus data — any session process can own
            // org.usbeehive.Devices. Adwaita subtitles parse Pango markup
            // (including <a href>), so clamp AND escape before display.
            const escaped = GLib.markup_escape_text(String(v).slice(0, 32), -1);
            startButton.visible = false;
            if (isVersionAtLeast(v, MIN_USBEEHIVE_VERSION)) {
                // Show "usbeehived 0.11.0" when the version is acceptable.
                daemonRow.subtitle = `usbeehived ${escaped}`;
                hideCommandRows();
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
            hideCommandRows();
            updateRow.visible = true;
        };

        // Nothing owns the bus name. WHY it isn't running decides what to
        // say and what to offer, and the three answers are different enough
        // that collapsing them (as this window used to) is the bug.
        const applyStoppedState = state => {
            if (!alive) return;
            hideCommandRows();
            switch (state) {
            case InstallState.INSTALLED:
                daemonRow.subtitle =
                    _('Installed, but not running — start it to see devices');
                startButton.visible = true;
                startButton.sensitive = true;
                break;
            case InstallState.SERVICE_MISSING:
                daemonRow.subtitle =
                    _('Installed, but its systemd service is not set up yet');
                startButton.visible = false;
                setupRow.visible = true;
                break;
            default:
                daemonRow.subtitle = _('Not installed');
                startButton.visible = false;
                installRow.visible = true;
                break;
            }
        };

        const setStopped = () => {
            daemonOnBus = false;
            // The synchronous probe answers immediately; systemd's own
            // answer lands a moment later and corrects it if the unit lives
            // somewhere the path list does not enumerate. Both go through
            // the same renderer, so the row never shows a half-state.
            applyStoppedState(probeInstallState());
            invalidateInstallCache();
            refreshInstallStateAsync(applyStoppedState);
        };

        startButton.connect('clicked', () => {
            startButton.sensitive = false;
            daemonRow.subtitle = _('Starting…');   // U+2026
            startDaemonUnit(error => {
                if (!alive) return;
                if (error) {
                    startButton.sensitive = true;
                    // The message is systemd's, and Adwaita subtitles parse
                    // markup — escape it like every other foreign string here.
                    daemonRow.subtitle = _('Could not start usbeehived: %s')
                        .format(GLib.markup_escape_text(String(error), -1));
                    return;
                }
                // StartUnit only means the job was accepted. If the daemon
                // had actually come up, the name watch would have fired and
                // setRunning() would already own this row.
                addTimeout(8000, () => {
                    if (!alive || daemonOnBus) return;
                    startButton.sensitive = true;
                    daemonRow.subtitle = _('Started, but usbeehived did not '
                        + 'reach the bus. Check: journalctl --user -u '
                        + 'usbeehived -e');
                });
            });
        });

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
                    if (!alive) return;
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
            () => {
                daemonOnBus = true;
                ensureProxy();
            },
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
            alive = false;
            Gio.bus_unwatch_name(busWatchId);
            for (const id of pending) GLib.Source.remove(id);
            pending.clear();
            proxy = null;
            return false;  // don't prevent close
        });
    }
}
