---
id: 260910-lyx
type: quick
status: planned
date: 2026-09-10
---

# Quick 260910-lyx — Withdraw the peer-derived connector claims

Fix a live false positive in shipped 2.7.0/2.7.1 code: the connector hints in
`src/link-verdict.js` rest on the kernel's USB2↔USB3 root-port `peer` link,
which is not a fact.

## Problem

`deriveConnectorHint()` (`usbee@bitcreed.us/src/link-verdict.js:172-187`) reads
`port.peer_state` and emits one of three socket-level claims, rendered by
`connectorHintText()` (`usbee@bitcreed.us/src/popover.js:492-503`):

| token | copy | claim |
|---|---|---|
| `ss-never-linked` | "The SuperSpeed lines of this connector never linked — a USB 2-only cable or port" | this socket's SS half never came up |
| `ss-unstable` | "The SuperSpeed link on this connector is unstable — try another cable" | this socket's SS half is retraining |
| `ss-elsewhere` | "This connector's high-speed lanes are up, but this device is not on them" | this socket's SS half carries someone else |

All three name *this connector*. All three are only true if the kernel's `peer`
symlink identifies the real other half of the same physical receptacle.

It does not, reliably. Upstream `find_and_link_peer()` matches on the ACPI
`_PLD`-derived `location` when it is non-zero (exact equality, first index match
wins) and otherwise falls back to same-index matching. Which mechanism produced
a given `peer` is logged at `pr_debug` only — **nothing in sysfs records it.**

On the reference machine the one USB-C socket is wired D+/D− → `usb5-port2`,
SS lanes → `usb6-port1`, while `_PLD` reports a confident, internally consistent
and *wrong* 1:1 index map (`usb5-port2 ↔ usb6-port2`). A working USB 3 hub on
that socket therefore puts its SS half on `6-1` while `5-2`'s claimed peer
`usb6-port2` still reads `not attached` — and USBee says "USB 2-only cable"
about a hub running at 5 Gb/s.

## What the D-Bus surface actually exposes today

Checked against usbeehive 0.12.0 (`../usbeehive`):

- `port.peer_id` and `port.peer_state` are the kernel `peer` symlink and that
  peer port's `state`, passed through verbatim
  (`../usbeehive/src/sysfs/usb.rs:117-122`, `src/summary.rs:744-749`).
- The daemon does **not** read the port `location` attribute at all — no
  `grep` hit anywhere in its sources — so no provenance is reconstructible
  client-side.
- Root hubs are excluded from summaries entirely
  (`../usbeehive/src/sysfs/manager.rs:420-423`), so USBee cannot see root-port
  state and **cannot** make the controller-level statement ("no SS port on the
  same xHCI became occupied") that would be sound without pairing.
- There is no `port.peer_source`, no `port.peer_confidence`, no
  `FreeSuperSpeedPorts`, no `link.*` key on the wire.

**Conclusion:** the data needed for a correct positive claim is not available.
Per the task constraint, the fix is to withdraw the claim, not invent it.

## Decision

Keep the derivation gate — it is the single place to re-open when the daemon
ships `port.peer_confidence` — but collapse the three socket-level tokens into
one hedged token, `ss-cause-unknown`, whose copy names no socket and asserts no
cause.

New copy: *"SuperSpeed did not come up on this link — the cause could be the
cable, the port, or a hub in between"*.

That statement rests only on facts USBee genuinely has: the device's own BOS
capability (`usb_capable_speed_mbps >= 5000`), its negotiated rate
(`<= 480 Mb/s`) and the daemon's verdict. For a SuperSpeed-capable device
linking at High Speed, cable / port / intervening hub is an exhaustive list of
candidates — it is a statement about the *device's own link*, which USBee can
see, not about a companion port, which it cannot.

**Deliberately not claimed anymore:** that the SS half of *this* receptacle
never linked; that it is unstable; that it is up and carrying another device;
and, in the `ss-never-linked` case, the specific cause "a USB 2-only cable or
port".

**Deliberately kept:** the `port.peer_state`-present gate. Its presence still
narrows the hint to devices the daemon saw on a port object with a companion,
so the change is a pure *narrowing* of what USBee asserts — no device that was
previously silent starts speaking.

## Tasks

### Task 1 — collapse the three peer-derived hints into one honest token

**Files:** `usbee@bitcreed.us/src/link-verdict.js`,
`usbee@bitcreed.us/src/popover.js`, `tests/forward-compat.test.js`,
`po/usbee@bitcreed.us.pot`

**Action:**
- Replace `PEER_NEVER_LINKED` / `PEER_UNSTABLE` / `PEER_LINKED` with a single
  `PEER_STATES_KNOWN` set (same union), preserving the "unrecognised kernel
  state → say nothing" forward-compat rule.
- `deriveConnectorHint()` returns `'ss-cause-unknown'` or `null`. Document the
  kernel-`peer` unreliability and the exact reference-machine counterexample in
  the module header so the next reader cannot re-introduce the claim.
- `connectorHintText()` renders the single hedged string through `_()`; drop the
  three withdrawn strings. No concatenation.
- Correct the stale `port.peer_state` "explains WHY" comment in `popover.js`.
- Update `tests/forward-compat.test.js`: the three token assertions become
  assertions that every peer state yields the same cause-agnostic token, plus a
  new regression case for the wrong-peer topology (a `not attached` companion
  must not produce a cable claim). Every "say nothing" case stays as-is.
- Regenerate `po/usbee@bitcreed.us.pot` with the documented `xgettext` command.

**Verify:** `gjs -m tests/forward-compat.test.js` and the other two suites pass;
`grep` finds no remaining `ss-never-linked` / `ss-unstable` / `ss-elsewhere`.

**Done:** no user-visible string asserts anything about a companion port.

### Task 2 — changelog

**Files:** `CHANGELOG.md`

**Action:** add a bullet to the existing `## [2.7.1]` "### Fixed" section in
user-facing wording. 2.7.1 is committed but untagged and unpushed, so the fix
folds into it — no version bump, no tag, no push.

**Done:** bullet present under `## [2.7.1]`; `metadata.json` untouched.

## Out of scope

Daemon work. The confident version of this claim needs usbeehive to publish
port-pairing provenance and confidence, plus root-port state (or a
pre-computed controller-level verdict). See the report's §8 key list.
