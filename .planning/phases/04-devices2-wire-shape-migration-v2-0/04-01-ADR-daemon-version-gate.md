# ADR: Daemon-version gate placement (Plan 04-01 prep for COMPAT-01/02)

**Status:** Accepted (2026-05-14)
**Phase:** 04 — Devices2 wire-shape migration (v2.0)
**Scope:** Where `MIN_USBEEHIVE_VERSION` lives, when the version check fires,
and what UI signal surfaces a mismatch. Decisions here are mechanically
consumed by Plan 04-02; this ADR is the single source of truth so the
cutover plan can stay laser-focused on the atomic wire bump.

## Context

USBee v2.0 ships the breaking `Devices1 → Devices2` wire-shape cutover with
**no backwards-compatibility path** (CONTEXT D-2.0-05, locked upstream and
downstream during the multi-round Devices2 negotiation). If a user installs
USBee v2.0 but their `usbeehive` daemon is older than the matching release,
USBee MUST detect this and refuse to unpack the device list — instead it
shows a dedicated "Daemon out of date" empty state with copy that points the
user at the daemon-upgrade path.

The daemon publishes a `Version` property on `org.usbeehive.Devices2`
(declared as `<property name="Version" type="s" access="read"/>` in
`../usbeehive/src/dbus.rs:347-350`, value sourced from
`env!("CARGO_PKG_VERSION")`). USBee reads this property on proxy
construction and compares it against a pinned minimum. This ADR locks the
five mechanical decisions that fall out of that flow.

## Decisions

### 1. Constant location

`MIN_USBEEHIVE_VERSION` lives in `usbee@bitcreed.us/src/dbus-client.js`, declared
as a module-level `const` immediately after the existing `BUS_NAME` /
`OBJECT_PATH` / `INTERFACE_NAME` triplet (currently at lines 25–27 of
`dbus-client.js`).

- Placeholder value: `"0.6.0"` (CONFIRMED 2026-05-14 — usbeehive cut release
  0.6.0 in commit `1258de4` "Release 0.6.0 — Devices2 wire (breaking)",
  Cargo.toml `0.6.0`).
- Plan 04-03 re-verifies the upstream tag at release time and may bump if a
  later patch release fixes a wire bug we depend on. The constant is the
  single source of truth — no GSettings override, no env-var fallback,
  no feature-detect (matches D-2.0-05).

Why this file and this location: `dbus-client.js` already owns
`INTERFACE_NAME` (the wire-shape contract). Putting the matching version
pin next to it keeps the entire "what daemon contract do we require" answer
in one block of three constants. Other modules (popover, label-table,
empty-state) MUST NOT import `MIN_USBEEHIVE_VERSION` — the gate is a
DBusClient concern.

### 2. Check timing

The version comparison fires inside the existing `_onAppeared` callback in
`dbus-client.js`, specifically AFTER the `new UsbeehiveProxy(...)` callback
resolves (so the proxy's cached `Version` property is populated), but
BEFORE `this._store.setDaemonRunning(true)` is called on the success path.

Concretely (Plan 04-02 wires this; the ADR pins the location):

```javascript
// Inside the UsbeehiveProxy callback, after `this._proxy = proxy;`
// and BEFORE setDaemonRunning(true):
const daemonVersion = this._proxy.Version; // cached, no D-Bus round-trip
if (!versionMeetsMinimum(daemonVersion, MIN_USBEEHIVE_VERSION)) {
    this.emit('daemon-too-old');
    return; // do NOT subscribe to DeviceAdded/Removed, do NOT snapshot
}
// ... existing subscription + snapshot path continues unchanged ...
```

Why here and not at proxy construction time: reading the cached `Version`
property does NOT issue a fresh D-Bus round-trip — `Gio.DBusProxy` caches
all read-access properties eagerly during construction (per the GJS proxy
contract, also documented at `gjs.guide` D-Bus). So the property is
guaranteed populated by the time the construction callback fires. Doing the
check here keeps the gate co-located with the rest of the proxy lifecycle
(no second async hop, no separate state machine to reason about).

Why before `setDaemonRunning(true)`: if we mark the daemon as "running"
first, the tile renders a healthy state for one frame, then flips to the
out-of-date state — visible jank. Failing the gate before any store mutation
keeps the tile in its initial state until the correct render path takes
over.

### 3. UI signal

The DBusClient gains a fourth signal alongside `ready` / `lost` /
`devices-changed`:

```javascript
Signals: {
    'ready':           {},
    'lost':            {},
    'devices-changed': {},
    'daemon-too-old':  {},   // NEW — emitted instead of 'ready' on version mismatch
},
```

The tile listens for `'daemon-too-old'` and routes to a new render path that
calls `populateOutOfDateState(section)` (added in Plan 04-02 Task 11) instead
of `populateDeviceRows` or `populateEmptyState`.

**Why a distinct signal rather than overloading `'lost'` with a parameter:**

- Keeps Plan 04-02's diff small — one new branch in the existing
  signal-handler switch, no parameter-shape change to existing consumers
  (`'ready'` / `'lost'` / `'devices-changed'` remain zero-arg).
- Keeps the "daemon out of date" state semantically separate from
  "daemon vanished" — they have different user-facing copy
  (`_('usbeehive daemon out of date')` vs `_('usbeehive daemon not running')`)
  and different recovery paths (`systemctl --user restart usbeehive` post-
  upgrade vs `systemctl --user enable --now usbeehive`).
- `NameOwnerChanged` auto-recovery for `'lost'` does NOT apply to
  `'daemon-too-old'`: the daemon is running, just too old. Re-emitting `'lost'`
  would be a lie about the bus state.

### 4. Version-comparison rule

Simple lexical-tuple semver — split the version string on `.`, parse each
segment as a non-negative integer, compare element-wise (major, then minor,
then patch). Reject any `Version` string that fails to parse as
`major.minor.patch` (treat as "out of date" — **fail-closed for safety**).

Concrete behaviour (Plan 04-02 implements; this ADR pins the semantics):

| Daemon `Version` | `MIN_USBEEHIVE_VERSION` | Outcome | Why |
|---|---|---|---|
| `"0.6.0"` | `"0.6.0"` | pass | exact match |
| `"0.6.1"` | `"0.6.0"` | pass | patch above minimum |
| `"0.7.0"` | `"0.6.0"` | pass | minor above minimum |
| `"1.0.0"` | `"0.6.0"` | pass | major above minimum |
| `"0.5.99"` | `"0.6.0"` | fail | minor below |
| `"0.6.0-rc1"` | `"0.6.0"` | **fail** | non-strict semver, fail-closed |
| `""` | `"0.6.0"` | fail | empty string, fail-closed |
| `"abc"` | `"0.6.0"` | fail | unparseable, fail-closed |

Do NOT pull in a semver library: the daemon publishes strict
`major.minor.patch` per `env!("CARGO_PKG_VERSION")` (see
`../usbeehive/Cargo.toml` `version = "0.6.0"` and `src/dbus.rs:347-350`).
A 20-line element-wise comparator in `dbus-client.js` is sufficient and
keeps the EGO submission free of vendored dependencies.

Pre-release tags (`-rc1`, `-beta`, etc.) failing closed is intentional:
USBee v2.0 only supports tagged-release daemons. If a developer wants to
run USBee against an in-development daemon, they can either (a) bump
`MIN_USBEEHIVE_VERSION` locally for the dev session, or (b) tag the
daemon checkout. We will not add a "permissive" mode.

### 5. What the gate does NOT do

Explicit non-goals, recorded so a future refactor doesn't accidentally
broaden the gate's scope:

- **Does not feature-detect individual fields.** USBee assumes every field
  in CONTEXT D-2.0-04 is present on every device emitted by a version-
  passing daemon. If the daemon advertises `Version >= 0.6.0`, the wire
  shape is fixed.
- **Does not parameterise via env vars or GSettings.** The constant is the
  single source of truth; bumping it is a code change and an EGO submission
  (matches D-2.0-05).
- **Does not retry on failure.** A daemon that fails the version check at
  `_onAppeared` time will keep failing until the user upgrades and the
  systemd unit restarts — at which point `NameOwnerChanged` fires a fresh
  `_onAppeared` cycle and the gate is re-evaluated.
- **Does not warn on the upper bound.** A daemon newer than USBee expects
  is fine: extra fields in the wire tuple would be a wire-shape change
  (`Devices3`), which is a hard cutover and a different release. Within
  `Devices2`, daemon-side patches are forward-compatible with USBee.

## Plan 04-02 wiring checklist

Plan 04-02's daemon-version-gate task uses this list verbatim. Each item
maps to a precise grep target so the executor can verify their change with
`grep`:

1. **Add `MIN_USBEEHIVE_VERSION = "0.6.0"`** to `src/dbus-client.js`
   immediately after `INTERFACE_NAME`. Grep target:
   `grep -n "^const MIN_USBEEHIVE_VERSION" src/dbus-client.js`.
2. **Add the `'daemon-too-old'` signal** to the `DBusClient`
   `GObject.registerClass({Signals: ...})` block. Grep target:
   `grep -n "'daemon-too-old'" src/dbus-client.js`.
3. **Add `versionMeetsMinimum(actual, minimum)`** as a module-level helper
   in `src/dbus-client.js`: splits on `.`, integer-parses each segment,
   element-wise compares, fails closed on any parse error or non-three-
   segment input. Pure function — no dependencies, no D-Bus calls.
4. **Insert the gate** inside `_onAppeared`'s `UsbeehiveProxy` callback,
   after `this._proxy = proxy;` and BEFORE
   `this._store.setDaemonRunning(true)`. On gate failure: `this.emit('daemon-too-old'); return;`
   — do NOT subscribe to DeviceAdded/Removed, do NOT snapshot.
5. **Listen for `'daemon-too-old'` in `extension.js`** alongside the
   existing `'ready'` / `'lost'` listeners; route to a new
   `populateOutOfDateState(section)` (Plan 04-02 adds this) which calls
   `buildDaemonOutOfDateItem()` (Plan 04-01 Task 5 stages this builder).
6. **Verify with a Looking Glass smoke test:** set `MIN_USBEEHIVE_VERSION`
   to a value higher than the running daemon's `Version`, log out + back
   in, confirm the tile shows the "daemon out of date" empty state and
   the `systemctl --user restart usbeehive` hint.
7. **Restore the production constant** before commit.
