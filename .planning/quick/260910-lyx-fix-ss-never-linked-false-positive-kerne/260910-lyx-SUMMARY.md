---
id: 260910-lyx
type: quick
status: complete
date: 2026-09-10
commits:
  - 18aff96  # fix: stop claiming a cause from the kernel's port peer link
  - 2426820  # docs: record the connector-hint fix under 2.7.1
---

# Quick 260910-lyx — Summary

Withdrew three socket-level claims that shipped in 2.7.0 and rested on the
kernel's USB2↔USB3 root-port `peer` link, which is not a fact.

## What the D-Bus surface actually exposes (checked, not assumed)

Against usbeehive 0.12.0 at `../usbeehive`:

| Fact | Evidence |
|---|---|
| `port.peer_id` / `port.peer_state` are the raw kernel `peer` symlink and that port's `state` | `../usbeehive/src/sysfs/usb.rs:117-122`, `../usbeehive/src/summary.rs:744-749` |
| The daemon never reads the port `location` attribute, so peer provenance is not reconstructible client-side | no `grep` hit for `location` anywhere in `../usbeehive/src/` |
| Root hubs are dropped from summaries, so USBee cannot see root-port state | `../usbeehive/src/sysfs/manager.rs:420-423` |
| No `port.peer_source`, `port.peer_confidence`, `FreeSuperSpeedPorts` or `link.*` key exists on the wire | `../usbeehive/src/dbus.rs:116-127` key table |

**Therefore** the controller-level reformulation the research report proposed
("this SS-capable device came up at 480 and no SS port on the same xHCI became
occupied") was *not* an available fix — it needs root-port state USBee never
receives. With no data able to support a correct positive claim, the claim was
withdrawn rather than invented, per the task's own constraint.

## The fix

`usbee@bitcreed.us/src/link-verdict.js` — `PEER_NEVER_LINKED` / `PEER_UNSTABLE`
/ `PEER_LINKED` collapse into one `PEER_STATES_KNOWN` set;
`deriveConnectorHint()` returns `'ss-cause-unknown'` or `null`. A 30-line module
comment records the kernel mechanism (`find_and_link_peer()`: location-equality
when `location != 0`, index fallback otherwise, method logged at `pr_debug`
only) and the reference-machine counterexample, so the claim cannot be casually
re-introduced.

`usbee@bitcreed.us/src/popover.js` — one hedged string replaces three:

> SuperSpeed did not come up on this link — the cause could be the cable, the
> port, or a hub in between

### No longer claimed

- that the SuperSpeed half of *this* receptacle never linked;
- that it is unstable, and that swapping the cable is therefore the fix;
- that it is up and carrying a different device;
- the specific cause "a USB 2-only cable or port".

### Still claimed, and why it is safe

Only what is read off the device itself: its own BOS capability
(`usb_capable_speed_mbps >= 5000`), its own negotiated rate (`<= 480 Mb/s`) and
the daemon's own verdict. For a SuperSpeed-capable device linking at High Speed,
"cable, port, or a hub in between" is an exhaustive candidate list, and it is a
statement about the device's own link — which USBee can see — not about a
companion port, which it cannot.

## Sibling hints — same defect, same treatment

All three tokens came from the same function and the same `port.peer_state`
read, so `ss-unstable` and `ss-elsewhere` were defective for exactly the same
reason as `ss-never-linked`, not merely adjacent to it. A wrong `peer` makes
"the fast lanes are up, you are not on them" a statement about a different
socket entirely. All three are gone.

Audited and found clean (no peer dependency): `port.peer_id` is in `HIDDEN_KEYS`
and never rendered (`src/property-policy.js:53`); `port.id` is the device's own
port name, a fact not an inference; `isWarning` / `hasLinkIssue` derive from the
daemon's `usb_link_verdict == "Degraded"` only; the `Fix` row is gated on that
same daemon assertion; `deriveAltMode`, the cable-trust row and the transport
pills read unrelated keys.

## Deliberately kept

The `port.peer_state`-present gate. Its presence still restricts the hint to
devices the daemon saw on a port object with a companion, so the change is a
pure *narrowing*: every device that previously got a hint now gets a correct
one, and no device that was silent starts speaking. Its value now selects
nothing — pinned by a new regression test that asserts all seven kernel peer
states yield the identical token.

## Versioning

Folded into the existing `## [2.7.1]` changelog section. `metadata.json`
untouched (still `2.7.1` / `12`). No tag created, nothing pushed — 2.7.1 remains
committed-but-unreleased.

## Verification

- `gjs -m` on all three suites: `daemon-status`, `dbus-client`,
  `forward-compat` — ALL TESTS PASSED (run via `rtk proxy` for raw output).
- `po/usbee@bitcreed.us.pot` regenerated; the three withdrawn strings are gone
  and the new one is present at `popover.js:499`.
- Packed and installed locally: 24 entries / ~200 KB with the `src/` prefix
  present. Pre-flight `ls -ld` confirmed the install target is a real directory
  (`d`, not `l`) before running `install --force`; repo sources verified intact
  afterwards. Shell not restarted — the fix is live at next login.

## What remains for usbeehive

The confident wording needs the daemon to ship, at minimum:

1. `port.peer_source` (`typec` / `hub_container_id` / `hub_vid_timing` /
   `manual` / `firmware` / `index` / `none`) — reconstructible for free from the
   port `location` attribute the daemon does not currently read.
2. `port.peer_confidence` (`confirmed` / `likely` / `prior` / `contradicted` /
   `unknown`) — the key USBee would gate socket-level copy on.
3. Root-port state, or a pre-computed controller-level verdict, so the
   pairing-free statement becomes possible at all.

`deriveConnectorHint()` is the single gate to re-open when those land.
