// extension.js
//
// Lifecycle owner. The ONLY file that mounts / destroys the indicator
// (D-16). enable() constructs SignalRegistry → DeviceStore → Indicator →
// DBusClient in that order, mounts the indicator, then starts the bus
// watch. disable() calls SignalRegistry.dispose() (single-call teardown,
// D-14) and destroys the indicator.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DBusClient}       from './src/dbus-client.js';
import {DeviceStore}      from './src/device-store.js';
import {USBeeIndicator}   from './src/tile.js';
import {SignalRegistry}   from './src/signal-registry.js';

export default class USBeeExtension extends Extension {
    enable() {
        // Construction order matters — RESEARCH §Pitfall D.
        // bus_watch_name "appeared" may fire before client.start() returns
        // if the daemon is already on the bus; the store and indicator must
        // exist by then so the resulting 'changed' signal has a listener.
        this._registry  = new SignalRegistry();
        this._store     = new DeviceStore();
        this._indicator = new USBeeIndicator(this._store, this._registry);
        this._client    = new DBusClient(this._registry, this._store);

        // Mount the indicator BEFORE starting the watch. D-16: only here.
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        this._client.start();
    }

    disable() {
        // Single-call teardown — D-14.
        // SignalRegistry releases every bus-watch, proxy signal, GObject
        // signal, and timeout source in reverse registration order.
        if (this._registry) {
            this._registry.dispose();
            this._registry = null;
        }
        // No-op for now, but keeps the symmetry honest.
        if (this._client) {
            this._client.stop();
            this._client = null;
        }
        // D-16: only here we destroy the indicator.
        // quickSettingsItems are destroyed explicitly — destroying the
        // indicator alone does NOT cascade-destroy items on all Shell
        // versions (documented pattern from gjs.guide Quick Settings).
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(item => item.destroy());
            this._indicator.destroy();
            this._indicator = null;
        }
        this._store = null;
    }
}
