// SPDX-License-Identifier: GPL-3.0-or-later
// src/daemon-status.js
//
// Daemon version gate + daemon lifecycle vocabulary, shared by BOTH
// processes and by bare-gjs CI.
//
// THIS MODULE MUST HAVE ZERO IMPORTS — no gi:// modules, no gettext, no
// relative imports. That is the only shape which loads in all three of:
//
//   1. the gnome-shell process (src/dbus-client.js, src/device-store.js,
//      src/tile.js, src/empty-state.js),
//   2. the gnome-shell-extension-prefs process (prefs.js), where the
//      `resource:///org/gnome/shell/extensions/extension.js` URI does not
//      resolve at all, and
//   3. bare `gjs -m tests/*.test.js` in CI, which has no gnome-shell
//      resources mapped.
//
// Adding any import here silently breaks tests/dbus-client.test.js and
// tests/daemon-status.test.js in CI, and breaks the preferences window at
// load time. tests/daemon-status.test.js asserts the no-import property
// directly against this file's source.
//
// Consequently: no user-visible string lives here. `_()` needs gettext,
// which needs one of the two process-specific import paths. UPDATE_CMD is
// a literal shell command, not prose, so it is not translated.

// Minimum supported usbeehive daemon version. usbeehive 0.10.0 hard-cuts
// the prior interface generation to Devices5 (no alias) per
// ../usbeehive/CHANGELOG.md §[0.10.0] (2026-06-10): the per-entry power
// tuple grew a `contract_mw` field ((uus) → (uuus)) so the sink's
// *requested* operating power and what the contract *allows* travel
// separately, and the bottleneck enum gained the benign `SinkLimit`
// variant. Older daemons (Devices4, < 0.10.0) route into the
// populateOutOfDateState empty state via isVersionAtLeast below.
export const MIN_USBEEHIVE_VERSION = '0.10.0';

// The command a user must run to get a new-enough daemon. `cargo install`
// replaces the binary on disk, but the already-running user unit keeps
// serving the old code until it is restarted — hence the second half.
// Displayed and copied only; never executed (D-18 / EGO PACK-05).
export const UPDATE_CMD =
    'cargo install usbeehive --features=dbus && systemctl --user restart usbeehived';

// The full install chain, for the state where no systemd user unit exists
// on disk at all. Reaching that state usually means the *binary* is missing
// too, so showing only `usbeehived --install-service` was step two of three
// (quick task 260905-b0s §D-7). Displayed and copied only; never executed.
export const INSTALL_CMD =
    'cargo install usbeehive --features=dbus && usbeehived --install-service '
    + '&& systemctl --user enable --now usbeehived';

// The interface generation this build's proxy speaks:
// org.usbeehive.Devices<N>. usbeehive has cut the interface four times in
// four months, and each cut renames the interface while KEEPING the bus
// name and object path — so a future daemon owns the name USBee watches
// while exposing nothing USBee can call, and the Version read fails.
// Distinguishing that from "the daemon is ancient" is what
// DaemonState.TOO_NEW exists for; see DBusClient._probeInterfaceGeneration.
export const IFACE_GENERATION = 5;

/**
 * The daemon's lifecycle state as seen by USBee. Owned by DeviceStore;
 * every surface (tile pill, popover routing) reads it from there so the
 * pill and the popover cannot disagree.
 *
 *   RUNNING     — on the bus, version accepted by the gate.
 *   STOPPED     — not on the bus (never started, or exited).
 *   OUT_OF_DATE — on the bus, but Version failed isVersionAtLeast.
 *   TOO_NEW     — on the bus, Version unreadable, and introspection found a
 *                 HIGHER org.usbeehive.Devices<N> generation than this build
 *                 speaks. The user must update USBee, not usbeehive.
 */
export const DaemonState = Object.freeze({
    RUNNING:     'running',
    STOPPED:     'stopped',
    OUT_OF_DATE: 'out-of-date',
    TOO_NEW:     'too-new',
});

/**
 * Fail-closed lexical-tuple semver compare. Returns true iff
 * `actual >= minimum`.
 *
 * Any parse failure returns false — the gate routes to 'daemon-too-old'
 * rather than throwing or proceeding optimistically
 * (04-01-ADR-daemon-version-gate step 4). Moved here verbatim from
 * src/dbus-client.js so the Shell process, the prefs process and the
 * tests all share one implementation; the logic is unchanged.
 *
 * @param {*} actual   Version string reported by the daemon.
 * @param {*} minimum  Version string USBee requires.
 * @returns {boolean}
 */
export function isVersionAtLeast(actual, minimum) {
    const parse = v => {
        if (typeof v !== 'string') return null;
        const parts = v.split('.').map(s => Number.parseInt(s, 10));
        if (parts.length !== 3 || parts.some(n => !Number.isInteger(n) || n < 0))
            return null;
        return parts;
    };
    const a = parse(actual);
    const m = parse(minimum);
    if (!a || !m) return false;
    for (let i = 0; i < 3; i++) {
        if (a[i] > m[i]) return true;
        if (a[i] < m[i]) return false;
    }
    return true;
}
