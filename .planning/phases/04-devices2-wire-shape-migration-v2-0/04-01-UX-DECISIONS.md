# UX Decisions for Phase 04 (Plan 04-01 lock-in)

**Status:** Locked (2026-05-14)
**Phase:** 04 — Devices2 wire-shape migration (v2.0)
**Scope:** Four user-visible UX choices that CONTEXT.md deliberately
deferred *into* planning ("Decisions To Settle During Plan 04-01") so that
Plan 04-02 can land the cutover without re-litigating UI questions
mid-implementation.

Each subsection records ONE locked one-line decision, 2–4 bullets of
rationale (including why the rejected alternatives were rejected), and a
cross-reference to the Plan 04-02 task that implements it. The cutover plan
references back to these UX-IDs in its task action blocks.

## UX-1 — `primary_driver == ""` rendering (resolves DISP-04)

**Lock:** Detail-panel note — render an italic `_('Driver: not bound')` row
at the top of the expanded detail panel whenever
`device.primary_driver === ''` AND `device.status !== 'Empty'`.

- Keeps the collapsed device row visually unchanged (no badge clutter on
  the headline). The accordion silhouette must continue to mirror
  Wi-Fi / Bluetooth visually — pinning a badge onto every "no driver"
  row would break that coherence for power users with several un-bound
  USB-C ports during boot.
- Aligns with the existing `buildPropertyRow(key, value)` helper in
  `popover.js` — no new widget class, no new CSS rule beyond the italic
  styling. The italic comes from `style_class: 'usbee-detail-driver-missing'`
  added to `stylesheet.css` in Plan 04-02 alongside the row insertion.
- Suppression condition (`status !== 'Empty'`) prevents the message
  showing for an empty Type-C port — an unplugged port has no driver
  by definition, surfacing "Driver: not bound" there would be noise.
- Rejected: row-level badge on the collapsed headline (clutters the
  list, hurts at-a-glance scan); ignoring (fails DISP-04 acceptance
  "visibly flagged in the popover, must be observable"); promoting to
  the tile-subtitle Tier-1 (the field is per-device, not per-system —
  wrong granularity for the subtitle).

*Implemented by Plan 04-02 Task 7 (popover detail-panel rendering).*

## UX-2 — `device_subclass` rendering (resolves DISP-05)

**Lock:** Detail-panel only — render `device_subclass` as a `_('Subclass')`
property row in the detail panel iff non-empty. Do NOT append to the
collapsed row title.

- The collapsed row title is already `device.headline`, which the daemon
  curates as a product-summary string (CONTEXT D-2.0-02). Appending
  `device_subclass` to the title would produce strings like
  `"Logitech MX Master 3 · Mouse"` where the headline already implies
  "mouse" — visual noise.
- `device_subclass` is daemon-curated and explicitly non-binding per
  CONTEXT D-2.0-02 — the daemon may leave it empty for many devices.
  Treating it as a property row means an empty value simply skips the
  row (no "Subclass: —" placeholder needed).
- Consistent with the property-row treatment of every other non-display
  field (`serial`, `mount`, `drivers`, etc.) — `device_subclass` is just
  one more entry in the existing label-table flow once it's wired in.
- Rejected: title-suffix (clutters headline, hurts scan); icon-suffix
  badge (subclass-aware icons explicitly OUT-OF-SCOPE per CHANGELOG
  v2.0 notes); ignoring entirely (fails DISP-05 acceptance "renderable
  in the popover"). Reversible: if v2.1 demand data shows users would
  benefit from subclass-in-title, the decision can be promoted then.

*Implemented by Plan 04-02 Task 7 (popover detail-panel rendering).*

## UX-3 — `Status::Sourcing` sort interaction (resolves DISP-03 acceptance)

**Lock:** Sourcing does NOT trigger issue-first sort. `hasIssue()` is keyed
purely on `charging_diag.is_warning`; Sourcing entries have
`charging_diag.present === false` per CONTEXT D-2.0-03, so they naturally
fall through the sort key without a special case.

- Confirms the captured-todo expectation (`.planning/todos/pending/
  2026-05-14-migrate-to-usbeehive-devices2-wire-shape.md` Section 3).
  Sourcing is healthy by definition — the host charging a downstream
  device is not a degradation, it's the intended behaviour for a
  USB-PD source port.
- Matches Phase 1's STATE.md "Sourcing is healthy by definition"
  rationale (recorded when issue-first sort was first introduced for
  v1.1). Re-applying the same logic to Devices2 keeps the sort key
  semantically stable across the wire migration.
- Single point of change: the existing multi-clause `hasIssue()` body
  collapses to one line — `return Boolean(device.charging_diag?.is_warning);`
  — landed in Plan 04-02's CLEAN-02 task. No new branch for Sourcing.
- Rejected: hoisting Sourcing entries to the top (would push the
  user's actually-degraded charging port BELOW a healthy outbound
  charge port — actively misleading); flagging Sourcing as a soft
  warning (Sourcing is the intended state for a host's downstream PD
  port, not a degradation).

*Implemented by Plan 04-02 Task 4 (CLEAN-02 `hasIssue()` collapse).*

## UX-4 — Tile subtitle copy for Sourcing (resolves DISP-03 copy)

**Lock:** `_('Powering: %s out')` (already present at `device-store.js:149`).
No copy change needed; the existing string is reused. The Tier-1 subtitle
filter widens to include `status === 'Sourcing'` (CONTEXT D-2.0-04 +
RESEARCH §"Pattern: Subtitle Tier-1").

- The string already passes through `xgettext` extraction in v1.2 — the
  `.pot` file does NOT churn for this decision. (Plan 04-03 regenerates
  the `.pot` regardless as part of the release flow, but UX-4 itself
  contributes zero new strings.)
- Aligns with the existing `_('Charging: %s in')` treatment for inbound
  charging — same verb/direction shape, same `%s` watt placeholder, same
  `formatWatts()` helper. Inbound and outbound now form a matched pair
  rather than asymmetric copy.
- The widening of the Tier-1 filter to include Sourcing means a USB-C
  host charging a downstream device at 15 W will surface
  `"Powering: 15 W out"` on the tile — the user's at-a-glance answer to
  "is my laptop sourcing power right now?".
- Rejected: new string like `"Outbound: %s"` (would force a fresh
  translator round-trip for a meaning the existing string already
  conveys); merged single string covering both directions (loses the
  direction information at the tile glance).

*Implemented by Plan 04-02 Task 8 (tile-subtitle Tier-1 filter widening).*
