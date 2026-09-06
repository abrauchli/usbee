---
name: 260905-b0s-summary
description: What shipped for the BOS + trimmed-key consumer UI
status: Complete
completed: 2026-09-05
---

# Quick Task 260905-b0s — Summary

Consumer half of usbeehive's two additive waves on the unchanged
`org.usbeehive.Devices5` interface. `MIN_USBEEHIVE_VERSION` unchanged at
`0.10.0`; `metadata.json` version fields deliberately **not** bumped (the
orchestrator releases both repos centrally). CHANGELOG entries sit under
`## [Unreleased]`.

## New modules — all zero-import, so bare-gjs CI can test them

| File | Owns |
|---|---|
| `src/property-policy.js` | The four rendering tiers for every property key: hidden / dedicated / tech / default. |
| `src/link-verdict.js` | `formatRate`, `deriveLinkInfo` (verdict + connector hint), `deriveHubInfo`, `deriveAltMode`, `resolveHeadline`, `hasLinkIssue`. Tokens only — no user-visible strings. |
| `src/notify-policy.js` | `shouldToastDeviceChange` (scope + hardwired), the `data-rate-mutes` list helpers. |

Placing the logic there — rather than in `popover.js` / `notifier.js`,
which import gnome-shell resources and can only run inside the Shell — is
what made the verdict composition, the containment policy and the
notification discipline directly unit-testable.

## What landed, by UX-WINS item

1. **Link row + verdict.** Trailing rate caption on every collapsed row;
   `Link` row in the detail panel; verdict copy for At/Below/Degraded;
   `Fix` row on Degraded only. No warning is ever synthesised from
   `capable > negotiated`.
2. **Property-dump containment.** Unknown keys are tech-gated,
   `HIDDEN_KEYS` drops six wire-only keys, a "Technical details" divider
   splits the two tiers, and 18 new labels + 3 value maps landed in
   `label-table.js`. **Recorded as an explicit reversal** of the LOCKED
   260526-c6p D-2 decision: §D-2 of this task's CONTEXT, a superseding
   block inserted into the original c6p CONTEXT, the CHANGELOG's
   `### Changed` lead item, the schema key description, and a header
   comment in `property-policy.js`.
3. **Facts → verdict.** `port.peer_state` × BOS verdict, all four rows of
   the daemon spec's §6 table including both "say nothing" cases.
   `usb_bos_suppressed` renders as "capability unknown" and never as a
   verdict. Hub occupancy + bus power. The one actionable Billboard case.
   Hubs with an issue now show even when `show-hubs` is off.
4. **Tile issue tier.** Tier 0 above the existing four: charging warning →
   "Charging / 30 W — limited"; Degraded data rate → "Slow USB link /
   <device>". Header subtitle carries "N issues".
5. **Notification discipline.** Both signals added to `IFACE_XML` **and**
   `dbus-iface.xml` (byte-equality asserted in CI). Degraded is
   persistent and coalesced by string id; Restored is dismiss-only;
   `BelowCapability` is silent; `hardwired` suppresses connect toasts.
   New `data-rate-mutes` `a(ss)` key with a prefs list.
6. **`product_db`** as headline fallback (empty `product` only) plus an
   `Identified as` technical row.
7. **Error states.** New `DaemonState.TOO_NEW` behind an async
   introspection probe; full install chain in the not-installed state;
   clipboard disclosure in the extension description.

## Deferred

- UX-WINS item 8 (a11y / theme) in full: scroll-into-view on keyboard
  focus, `accessible_name` on colour-only warnings, the hard-coded
  white-alpha CSS, the translatable `◀` glyph. None of it is touched.
- UX-WINS item 9 beyond the muted-devices list that item 5 forces.

## Verification

`gjs -m` on all three suites: **294 assertions, 0 failures**
(dbus-client 66, daemon-status 87, forward-compat 141). `dbus-iface.xml`
parses under `Gio.DBusNodeInfo` with the two new signals at `(sss)` /
`(s)`; `glib-compile-schemas --strict` clean; `shexli` reports 0 errors
(2 pre-existing findings: the clipboard manual-review flag, now disclosed
in the description, and the untracked `gschemas.compiled` artifact).
`.pot` regenerated: 97 → 145 msgids (52 new, 4 replaced). The extension
was **not** installed or run — static verification only.
