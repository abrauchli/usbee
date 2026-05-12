// src/signal-registry.js
//
// Tracks every signal connection, name-watch, and timeout source created
// during enable() so disable() can release them in reverse order.
//
// Each `add*` call returns a token (the id) for documentation only — the
// caller does not need to retain it; dispose() handles cleanup.
//
// Per CONTEXT.md D-14: this is the single source of truth for lifecycle
// hygiene. Every connect/connectSignal/bus_watch_name/timeout_add site
// MUST register a dispose-fn here.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class SignalRegistry {
    constructor() {
        this._entries = [];
        this._disposed = false;
    }

    /**
     * Register a GObject signal connection (from .connect() — typically
     * 'notify::g-name-owner', 'open-state-changed', store 'changed', etc.).
     * @param {GObject.Object} target  Object the handler was connected on.
     * @param {number} id              Handler id returned by .connect().
     */
    addSignal(target, id) {
        if (this._disposed) throw new Error('SignalRegistry.addSignal after dispose');
        this._entries.push({
            kind: 'signal',
            dispose: () => target.disconnect(id),
        });
        return id;
    }

    /**
     * Register a D-Bus proxy signal connection (from proxy.connectSignal()).
     * @param {Gio.DBusProxy} proxy
     * @param {number} id   Handler id returned by .connectSignal().
     */
    addProxySignal(proxy, id) {
        if (this._disposed) throw new Error('SignalRegistry.addProxySignal after dispose');
        this._entries.push({
            kind: 'proxy-signal',
            dispose: () => proxy.disconnectSignal(id),
        });
        return id;
    }

    /**
     * Register a Gio.bus_watch_name handle.
     * @param {number} watchId  Id returned by Gio.bus_watch_name().
     */
    addBusWatch(watchId) {
        if (this._disposed) throw new Error('SignalRegistry.addBusWatch after dispose');
        this._entries.push({
            kind: 'bus-watch',
            dispose: () => Gio.bus_unwatch_name(watchId),
        });
        return watchId;
    }

    /**
     * Register a GLib.timeout_add / idle_add source.
     * @param {number} sourceId  Id returned by GLib.timeout_add/idle_add.
     */
    addTimeout(sourceId) {
        if (this._disposed) throw new Error('SignalRegistry.addTimeout after dispose');
        this._entries.push({
            kind: 'timeout',
            dispose: () => GLib.Source.remove(sourceId),
        });
        return sourceId;
    }

    /**
     * Release every tracked resource in reverse order of registration.
     * Idempotent — safe to call from disable() multiple times.
     *
     * Best-effort: if one dispose-fn throws, the rest still run; the
     * error is logged via the canonical GJS error-only logger.
     */
    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        for (let i = this._entries.length - 1; i >= 0; i--) {
            const entry = this._entries[i];
            try {
                entry.dispose();
            } catch (e) {
                logError(e, `SignalRegistry: ${entry.kind} dispose failed`);
            }
        }
        this._entries = [];
    }
}
