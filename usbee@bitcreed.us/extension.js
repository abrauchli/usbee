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
import {Notifier}         from './src/notifier.js';
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
        this._indicator = new USBeeIndicator(this._store, this._registry, this); // pass `this` for STATE-04 Preferences row
        this._notifier  = new Notifier(this.getSettings(), this._registry, this); // NEW — between Store and Client per RESEARCH §Pattern 1
        this._client    = new DBusClient(this._registry, this._store, this._notifier);

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
        // Phase 2: destroy live MessageTray notifications + the Source
        // before tearing down the indicator. The registry has already
        // disconnected the Capability* proxy subscriptions above, so no
        // new events can arrive between here and indicator teardown.
        if (this._notifier) {
            this._notifier.dispose();
            this._notifier = null;
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
