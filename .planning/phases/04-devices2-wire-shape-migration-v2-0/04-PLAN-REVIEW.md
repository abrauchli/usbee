# Phase 04 Plan Review — Devices2 wire-shape migration (v2.0)

**Reviewed:** 2026-05-14
**Reviewer:** gsd-plan-checker
**Plans under review:** 04-01-PLAN.md (5 tasks), 04-02-PLAN.md (14 tasks), 04-03-PLAN.md (8 tasks)

## Verdict

**PASS-WITH-CONCERNS** — Two BLOCKERS surfaced that the planner must resolve before execution; the remaining structure is sound and traces back to the locked decisions cleanly. Blockers are mechanical (one atomic-commit discipline drift against the CONTEXT risk register, one missing enum in the forward-compat test). The hard "no backcompat" rule is honoured throughout; file-scope discipline is clean; security mitigations are explicitly preserved; checkpoint discipline on tag push and EGO upload is correctly human-gated.

### Blockers

1. **B-1 (Atomic-commit discipline, 04-02):** The wire bump (Tasks 1–2) commits separately from the regex deletion (Task 4), violating the CONTEXT risk-register mitigation that calls for the structured-field reads to land "alongside" the deletion "in the same atomic commit as the wire bump". See §"Atomic-commit discipline".
2. **B-2 (WIRE-04 coverage gap, 04-02 Task 11):** The forward-compat test exercises unknown `device_class`, `status`, `power_role`. It does NOT exercise an unknown `bottleneck` enum value. WIRE-04 explicitly enumerates `bottleneck` as one of the five enums whose unknown values must fall through without crashing. See §"WIRE-04 test design".

### Warnings (non-blocking)

- W-1 (04-02 Task 11): `device_subclass` is described by WIRE-04 as one of the extensible enum points, but the test fixture sets `device_subclass: 'experimental'` and no assertion exercises an unknown value through the renderer. Subclass is rendered as a free string in 04-02 Task 8, so the risk is low — but the test could be strengthened by asserting the subclass row renders without throwing for an unknown subclass.
- W-2 (04-02 Task 11): The test file design note proposes Option B (run under `gjs`), which the author admits "needs `gjs` installed" for CI. Acceptable for v2.0, but the WIRE-04 acceptance ("covered by a regression test") needs the test to actually execute somewhere — Task 14's smoke-test step says "Or however the chosen test option (A or B) is invoked", which is loose. Recommend the SUMMARY records which option was chosen and the exact invocation command verified.

---

## Hard Rule (no backcompat) audit

Scanned all three plans for the forbidden substrings `Devices1`, `fallback`, `dual`, `compat`, `shim`, `supports both`, `v1 path`, `old format`, `legacy unpacker`, `feature detect`.

| Hit (file:line) | Quoted context | Verdict |
|---|---|---|
| 04-01:61 | "None of these changes alter runtime behaviour for a user on the existing Devices1 wire — they are pure additions" | OK — describes pre-cutover baseline state, NOT introducing a shim. |
| 04-01:99 | `const INTERFACE_NAME = 'org.usbeehive.Devices1';` inside an `<interfaces>` block describing the CURRENT module before Plan 04-02 touches it | OK — documents the existing-state interface this plan does NOT modify; the very next note explicitly says "Plan 04-02 will mutate, NOT this plan". |
| 04-01:131 | "it does not parameterise, does not feature-detect individual fields" | OK — explicitly REJECTS feature-detection. |
| 04-01:300 | "Nothing in this plan changes the wire shape; `dbus-iface.xml` and `IFACE_XML` remain `Devices1`." | OK — accurate statement that 04-01 stages prep work only; the cutover is 04-02. |
| 04-01:193, 04-01:203, 04-01:219, 04-01:224, 04-01:231, 04-01:295, 04-01:299 | "fallback" appearing in icon-chain context (`v1.1 hub fallback`, `fallback chain`, `default fallback`) | OK — these refer to ICON resolution fallbacks, not wire fallbacks. The icon fallback chain is required by DISP-02 and WIRE-04. |
| 04-01:245 | "WIRE-04 forward-compat" | OK — wires the forward-compat property (D-2.0-06), not a backcompat shim. |
| 04-02:79 | "Execute the atomic wire-shape cutover from `org.usbeehive.Devices1` to `org.usbeehive.Devices2`." | OK — describes the source/destination of the cutover. |
| 04-02:81 | "CONTEXT D-2.0-05 is the load-bearing constraint: no compatibility shim, no dual-shape unpacker, no Devices1 fallback." | OK — explicitly RE-AFFIRMS the hard rule. |
| 04-02:139, 04-02:172, 04-02:189, 04-02:192, 04-02:357, 04-02:382, 04-02:398 | All "fallback" hits in 04-02 | OK — every hit is in the icon-resolution fallback chain (DISP-02) or the safe-default fallback for unknown enum values (WIRE-04). None re-introduce wire fallback. |
| 04-02:183 | "Daemon `Version` D-Bus property is the gate input for COMPAT-01" | OK — threat-model row, not a shim. |
| 04-02:192 | "WIRE-04 forward-compat — unknown enum values fall through to safe defaults" | OK — D-2.0-06 forward-compat, EXPLICITLY rejects backcompat path. |
| 04-02:206, 04-02:208, 04-02:222, 04-02:224, 04-02:233, 04-02:244, 04-02:246 | All `Devices1` references in 04-02 | OK — every hit is a change description ("from Devices1 to Devices2") or a grep-gate assertion (`! grep -q 'Devices1'`). The grep-gate is the most rigorous form of REJECTING the pattern. |
| 04-02:253 | "the 8-field Devices1 unpacker" | OK — describes the function being REPLACED. |
| 04-02:587-595 | "the gate fired on first proxy construction and is now load-bearing for the rest of the lifecycle" | OK — describes COMPAT-01 gate, not a feature-detect path. |
| 04-02:741 | "extract a shimmable layer" (Option A for the test harness) | OK — refers to a TEST-side shim for gettext stubbing in node, NOT a runtime D-Bus shim. Acceptable per the "REJECTS the pattern" exception (D-2.0-05 is about wire-protocol shims). |
| 04-03:124 | `git show v_LATEST_:src/dbus.rs \| grep -E "Devices1\|Devices2"` | OK — verification command to confirm the daemon tag has Devices2. |
| 04-03:154, 04-03:162, 04-03:178, 04-03:280 | All Devices1 references | OK — each is a "replace X with Y" instruction, a grep-gate assertion of absence, or a CHANGELOG line documenting the breaking change. |
| 04-03:264 | `--schema=schemas/us.bitcreed.usbee.gschema.xml` | False positive on "schema" — not a compat shim. |

**Hard Rule verdict:** PASS. Every hit is either descriptive ("from X to Y"), a grep-gate asserting the pattern is gone, or a re-affirmation of the prohibition. No task plans to write a shim, dual-unpacker, or feature-detect runtime path.

---

## Atomic-commit discipline

The CONTEXT risk register (line 228-231) states:

> Plan 04-02 deletes them in the same atomic commit as the wire bump, not "incrementally" — the diff shows insertion of structured-field reads alongside deletion of regex parsing, a defensible pattern to review.

The plan as drafted splits this into multiple commits:

- 04-02 Task 1: `feat(04-02): bump dbus-iface.xml to org.usbeehive.Devices2 wire shape` — XML file flip only.
- 04-02 Task 2: `feat(04-02): flip INTERFACE_NAME and IFACE_XML to Devices2` — JS interface name + literal flip.
- 04-02 Task 3: `feat(04-02): rewrite unpackDeviceEntry for 19-field Devices2 shape (WIRE-02)` — unpacker rewritten BUT (line 278-279) "Do NOT delete the regex helpers (`WATT_RE`, `parseWatts`, etc.) in this task — they get deleted in Task 4 in the same commit as the consumers stop calling them, so the diff tells the reviewer story. This task only rewires the unpacker."
- 04-02 Task 4: `refactor(04-02): delete bullet-regex layer; consume Devices2 structured fields (CLEAN-01/02, DISP-03)` — pairs deletion with consumer rewrites.

**Problem (BLOCKER B-1):** Task 4's commit pairs deletion with consumer rewrite, which is good — but the wire bump itself (Task 1, Task 2) lands in TWO COMMITS BEFORE Task 4. After Task 2, the codebase is in a non-buildable state: `dbus-client.js` declares `Devices2` and the new tuple signature in `IFACE_XML`, but `unpackDeviceEntry` (Task 3 will rewrite this) still expects the 8-field Devices1 shape — so any execution against a running Devices2 daemon between Task 2 and Task 3 would crash, AND between Task 3 and Task 4 the regex helpers remain dead but the bullet-prose consumers in `deriveSubtitle` / `hasIssue` are still calling them with empty `bullets` arrays from the new unpacker (Task 3 output object has no `bullets` field). The intermediate commits are not individually green.

The CONTEXT risk register specifically calls out that the diff must show "insertion of structured-field reads alongside deletion of regex parsing" — but with the current sequencing, the XML/IFACE_XML insertion (Task 1+2) is separated from the regex-parsing deletion (Task 4) by Task 3 which is also a separate commit. The reviewer-defensible single-diff pattern is not preserved.

**Fix:** Either (a) collapse Tasks 1–4 into a single atomic commit (the canonical defensible diff), OR (b) make Task 3 and Task 4 a single commit so that the unpacker shape change lands together with the regex deletion (Tasks 1+2 can still be a separate commit since the XML/IFACE_XML pair has no semantic split between them and they are self-consistent). Recommend (a) — fewer commits, exactly the diff the CONTEXT risk register names.

**Pass/fail:** **FAIL** (BLOCKER B-1).

**Sub-checks that DO pass:**
- Task 4 itself does pair deletion with consumer rewrite in one commit (line 295-336). The intra-task atomicity is correct.
- Task 5 (device-icon.js KEYWORD_MAP deletion + DEVICE_CLASS_ICON insertion) is a single commit pairing deletion with insertion. PASS.
- Task 6 (popover.js keyForBullet deletion + label-table iteration) is a single commit pairing deletion with insertion. PASS.

---

## Files out-of-scope

ROADMAP §Phase 4 Implementation Scope, "Explicitly out of scope (do not touch)":
- `src/notifier.js`
- `prefs.js` and the GSettings schema
- Compatibility-shim path for Devices1
- Signal payloads (`CapabilityDegraded` / `CapabilityRestored`)

Scanned every `<files>` element in every task:

| Plan | Task | Files | Verdict |
|---|---|---|---|
| 04-01 | 1 | `04-01-ADR-daemon-version-gate.md` | OK (planning doc) |
| 04-01 | 2 | `04-01-UX-DECISIONS.md` | OK (planning doc) |
| 04-01 | 3 | `04-01-ICON-AUDIT.md` | OK (planning doc) |
| 04-01 | 4 | `src/label-table.js` | OK (new file, in-scope per ROADMAP) |
| 04-01 | 5 | `src/empty-state.js` | OK (in-scope: "Files touched") |
| 04-02 | 1 | `dbus-iface.xml` | OK (in-scope: "Files rewritten") |
| 04-02 | 2 | `src/dbus-client.js` | OK |
| 04-02 | 3 | `src/device-store.js` | OK |
| 04-02 | 4 | `src/device-store.js` | OK |
| 04-02 | 5 | `src/device-icon.js` | OK |
| 04-02 | 6 | `src/popover.js` | OK |
| 04-02 | 7 | `src/popover.js`, `stylesheet.css` | OK (stylesheet.css edited for UX-1 italic class — not on the ROADMAP scope list but also not on the prohibited list; aligns with Phase 3 precedent where stylesheet.css was scope-included for accordion styling) |
| 04-02 | 8 | `src/popover.js` | OK |
| 04-02 | 9 | `src/dbus-client.js` | OK |
| 04-02 | 10 | `src/popover.js`, `src/tile.js` | OK (`src/tile.js` not on the explicit ROADMAP scope list — but the wire cutover by necessity requires the tile to subscribe to the new `daemon-too-old` signal; the alternative would be wiring it in popover.js only, which is architecturally worse. **NOTE:** this should arguably have been called out in ROADMAP §Implementation Scope; flagging as informational, NOT a blocker.) |
| 04-02 | 11 | `src/forward-compat.test.js` (new file) | OK (new test file, in-scope by necessity for WIRE-04) |
| 04-02 | 12 | (none — verification gate) | OK |
| 04-02 | 13 | (none — verification gate) | OK |
| 04-02 | 14 | (none — human checkpoint) | OK |
| 04-03 | 1 | (none — decision checkpoint) | OK |
| 04-03 | 2 | `metadata.json` | OK (in-scope: "Files touched") |
| 04-03 | 3 | `CHANGELOG.md` | OK |
| 04-03 | 4 | `po/usbee@bitcreed.us.pot` | OK |
| 04-03 | 5 | (none — packaging) | OK |
| 04-03 | 6 | (none — git tag) | OK |
| 04-03 | 7 | (none — human checkpoint) | OK |
| 04-03 | 8 | (none — human checkpoint) | OK |

**Files NOT edited (correctly):**
- `src/notifier.js` — confirmed no task edits it.
- `prefs.js` — referenced in 04-03 Task 4 as INPUT to xgettext (read-only) and in Task 5 zip-content checks (read-only). Never edited.
- `schemas/us.bitcreed.usbee.gschema.xml` — referenced in 04-03 Task 5 packaging command only. Not edited.
- `CapabilityDegraded` / `CapabilityRestored` signal payloads — 04-02 Task 1 line 211 explicitly says "All four signals … keep their wire shapes unchanged per CONTEXT D-2.0-05 risk text and ROADMAP §'Phase 4 Implementation Scope — Explicitly out of scope'". OK.

**Pass/fail:** **PASS.** One informational note about `src/tile.js` and `stylesheet.css` not being explicitly listed in the ROADMAP scope, but both edits are necessary and defensible. Not a blocker.

---

## Security mitigations preserved

| Mitigation | Where referenced | Preservation verdict |
|---|---|---|
| `SYMBOLIC_ICON_RE` in `src/device-icon.js` (T-03-01) | 04-01:221, 04-01:231, 04-01:299; 04-02:37, 04-02:56, 04-02:172, 04-02:189, 04-02:356, 04-02:387, 04-02:408, 04-02:410, 04-02:782, 04-02:879; 04-03:183, 04-03:199 | **EXPLICITLY PRESERVED.** 04-02 Task 5 line 356 quotes CONTEXT verbatim: "`SYMBOLIC_ICON_RE` and its comment block (lines 14-23) — CONTEXT.md 'Preserved (do NOT delete) … security mitigation T-03-01'". The grep-gate at Task 12 line 782 also asserts SYMBOLIC_ICON_RE is NOT in the deletion list. |
| `formatWatts` in `src/device-store.js` | 04-02:281, 04-02:782; 04-03:200 | **EXPLICITLY PRESERVED.** 04-02 Task 3 line 281: "Reuse of `formatWatts` (line 114): preserved per CONTEXT §'Code USBee Deletes (sanity check)' — it's pure UI formatting (mW → '65 W') and stays." |

Neither symbol appears in any deletion list across the three plans. Both are referenced positively (used in iconForDevice and used by the watt-rendering UI helpers).

**Pass/fail:** **PASS.**

---

## Requirement coverage matrix

| Requirement | Plan | Task(s) | Notes |
|---|---|---|---|
| WIRE-01 (proxy targets Devices2; xml/IFACE_XML match) | 04-02 | T1, T2, T13 | T1 bumps XML; T2 flips INTERFACE_NAME and IFACE_XML literal; T13 is the byte-equality acceptance gate. |
| WIRE-02 (unpackDeviceEntry exposes every field by name) | 04-02 | T3 | 19-field object shape spelled out in T3 action; verify regex covers `device_class`, `primary_driver`, `power_in_mw`, `charging_diag`, `is_warning`. |
| WIRE-03 (Diagnose returns (bsssb); use `present` as sentinel) | 04-02 | T1, T2 | XML and IFACE_XML declare `(bsssb)` Diagnose return. NO consumer in v2.0 currently calls Diagnose (per 04-02 success-criteria item 3, "reserved for prefs Diagnose-now button"). The interface declaration alone satisfies WIRE-03 since no consumer exists to violate the sentinel rule. **Minor concern:** WIRE-03 acceptance is technically met by interface declaration, but there is no test asserting consumer behaviour. Acceptable since no consumer exists. |
| WIRE-04 (unknown enum values fall through; regression test) | 04-02 | T11 | **BLOCKER B-2:** test exercises unknown `device_class` (`FutureGadget`), unknown `status` (`Hibernating`), unknown `power_role` (`Quantum`). Does NOT exercise an unknown `bottleneck` value (the fixture uses `bottleneck: ''` which is the absence sentinel, not an unknown enum). See §"WIRE-04 test design". |
| CLEAN-01 (delete WATT_RE/DIRECTION_RE/USB_VERSION_RE/SPEED_RE/parseWatts/parseDirection/parseLinkSpeed) | 04-02 | T4, T12 (gate) | T4 explicitly deletes all 7 symbols; T12 grep-gate asserts absence. |
| CLEAN-02 (hasIssue one-liner; DIAG_PHRASES gone) | 04-02 | T4, T12 (gate) | T4 lines 324-331 spell out the one-liner; line 308 deletes DIAG_PHRASES. |
| CLEAN-03 (keyForBullet + KEYWORD_MAP + headline scan gone; SYMBOLIC_ICON_RE retained) | 04-02 | T5, T6, T12 (gate) | T5 deletes KEYWORD_MAP + headline scan; T6 deletes keyForBullet. |
| DISP-01 (label-table.js machine-key → label; unknown key renders raw) | 04-01 (staging) + 04-02 (integration) | 04-01 T4 + 04-02 T6 | T4 creates label-table.js; T6 wires labelForKey into popover. |
| DISP-02 (device_class icon lookup table; daemon icon preferred if SYMBOLIC_ICON_RE passes) | 04-01 (design) + 04-02 (integration) | 04-01 T3 + 04-02 T5 | T3 audits all 19 icons; T5 implements the lookup map. |
| DISP-03 (Sourcing → "Powering: %s out"; not in issue-first sort) | 04-01 (UX-3, UX-4 decisions) + 04-02 (integration) | 04-01 T2 + 04-02 T4 | T4 widens Tier-1 filter; hasIssue one-liner naturally excludes Sourcing because `charging_diag.present === false`. |
| DISP-04 (primary_driver=='' visibly flagged) | 04-01 (UX-1 decision) + 04-02 (integration) | 04-01 T2 + 04-02 T7 | T7 implements the italic detail-panel row. |
| DISP-05 (device_subclass policy decided + implemented) | 04-01 (UX-2 decision) + 04-02 (integration) | 04-01 T2 + 04-02 T8 | T8 implements the detail-panel "Subclass" row when non-empty. |
| COMPAT-01 (version gate; refuses old daemons) | 04-01 (ADR) + 04-02 (wiring) | 04-01 T1 + 04-02 T9 | T1 ADR locks placement; T9 wires the gate with `isVersionAtLeast` and emits `daemon-too-old`. |
| COMPAT-02 (distinct "Daemon out of date" empty state) | 04-01 (builder) + 04-02 (wiring) | 04-01 T5 + 04-02 T10 | T5 ships builder; T10 wires it through tile.js. |
| REL-01 (metadata.json version-name 2.0.0; version bump) | 04-03 | T2 | Spelled out in action. |
| REL-02 (CHANGELOG ## [2.0.0] entry naming min daemon version + regex deletions) | 04-03 | T3 | Action enumerates required sub-sections, naming MIN_USBEEHIVE_VERSION and listing every deleted symbol. |
| REL-03 (zip built; release tag pushed for GitHub release) | 04-03 | T5, T6, T7 | T5 packs zip; T6 creates annotated tag locally; T7 user-gated push. |

**Coverage verdict:** All 17 requirements have an explicit owner task. No orphans. WIRE-04 coverage is functionally incomplete (B-2) but the task EXISTS and just needs strengthening — not a coverage gap, a depth gap.

---

## WIRE-04 test design

WIRE-04 (REQUIREMENTS.md line 20):

> Unknown enum values for `device_class`, `device_subclass`, `status`, `power_role`, `bottleneck` fall back to `Unknown` (or sensible per-enum default) without raising; covered by a regression test asserting forward-compatibility with future daemon variants

The test fixture in 04-02 Task 11 (`makeFutureDevice()`, lines 694-716):

```javascript
device_class: 'FutureGadget',     // unknown ✓
device_subclass: 'experimental',  // not exercised as "unknown" — subclass is a free string, no enum validation
status: 'Hibernating',            // unknown ✓
power: {power_in_mw: 0, power_out_mw: 0, power_role: 'Quantum'},  // unknown power_role ✓
charging_diag: {present: false, bottleneck: '', summary: '', detail: '', is_warning: false},  // bottleneck is '' (absence sentinel), NOT an unknown enum value
```

**Acceptance criteria quoted from Task 11 done block (line 752):**

> forward-compat.test.js exists with at least four `test()` cases covering iconForDevice / hasIssue / deriveSubtitle / labelForKey against a fully-synthetic future device.

**Gaps:**

1. **(BLOCKER B-2)** `bottleneck` unknown-value path is not exercised. WIRE-04 names `bottleneck` explicitly. Set `charging_diag: {present: true, bottleneck: 'CosmicRayInterference', summary: 'unknown bottleneck', detail: '', is_warning: true}` and assert (a) `hasIssue` returns `true` (because `is_warning` is true) without throwing on the unknown bottleneck, and (b) any consumer that later reads `bottleneck` (none in v2.0, but a forward-compat seatbelt) handles the unknown value.
2. **(W-1, warning)** `device_subclass` is a "non-binding daemon string" per CONTEXT D-2.0-02, not strictly an enum. But WIRE-04 lists it. Recommend adding an assertion that `buildDeviceRow(makeFutureDevice())` renders without throwing when subclass is set to an unrecognised value — this is what the RESEARCH section (lines 153-165) actually proposes.
3. **(W-2, warning)** The test currently doesn't assert "renderer doesn't crash" for the device-row level. The Task 11 file fixture only exercises the pure-function layer (`iconForDevice` / `hasIssue` / `deriveSubtitle` / `labelForKey`). `buildDeviceRow` itself is not invoked because it needs St/PopupMenu. Per Task 11's own design note, this is acceptable — but the test cases should at minimum cover all four enum classes WIRE-04 enumerates.

**Fix for B-2:** Add a fifth `test()` case asserting `hasIssue(deviceWithUnknownBottleneck)` returns the right value without throwing. Suggested addition:

```javascript
test('hasIssue: unknown bottleneck value does not crash; is_warning still determines outcome', () => {
    const device = makeFutureDevice();
    device.charging_diag = {
        present: true,
        bottleneck: 'CosmicRayInterference',
        summary: 'Future degradation',
        detail: '',
        is_warning: true,
    };
    assert.strictEqual(hasIssue(device), true);
});
```

**Pass/fail:** **FAIL** (BLOCKER B-2). The test exists but does not satisfy WIRE-04's full enumeration.

---

## Checkpoint gates

| Gate | Task | Type | Human-gated? | Verdict |
|---|---|---|---|---|
| MIN_USBEEHIVE_VERSION value confirmation | 04-03 T1 | `checkpoint:decision` | YES (`resume-signal: Select: option-a, option-b, or option-c`) | PASS — explicitly checkpointed BEFORE tag creation. |
| Tag creation (local only) | 04-03 T6 | `auto` | N/A (autonomous local action) | PASS — task body says "**CRITICAL: Do NOT push the tag.** That is Task 7's human checkpoint." Tag is local-only at this stage. |
| Tag push to origin | 04-03 T7 | `checkpoint:human-verify` | YES (`resume-signal: Type "pushed" once tag is up`) | PASS — push is user-executed: "When ready, the user runs: `git push origin master` `git push origin v2.0.0`". Plan does NOT autonomously push. |
| EGO upload | 04-03 T8 | `checkpoint:human-action` | YES (`resume-signal: Type "uploaded"`) | PASS — explicitly user-executed: "Manual upload steps … Open https://extensions.gnome.org/upload/ in a browser. Sign in … Upload the zip." Plan does NOT autonomously upload. |
| Live smoke test (post-cutover) | 04-02 T14 | `checkpoint:human-verify` | YES | PASS — gates the transition from 04-02 to 04-03. |

**Pass/fail:** **PASS.** Every dangerous side-effecting action (version confirmation, tag push, EGO upload) is correctly gated as a human checkpoint. No autonomous `git push origin v2.0.0`. No autonomous EGO upload. The MIN_USBEEHIVE_VERSION confirmation correctly precedes tag creation (T1 before T6) so the constant cannot drift after the tag is built.

---

## Code-deletion completeness

CONTEXT.md "Code USBee Deletes (sanity check)" enumerates 10 symbols that must end up grep-empty after cutover. Cross-checking against 04-02 Task 4/5/6 deletion lists and Task 12 grep-gate:

| Symbol | Deleted in task | In Task 12 grep-gate? | Verdict |
|---|---|---|---|
| `WATT_RE` | T4 (line 301) | YES (line 762) | PASS |
| `DIRECTION_RE` | T4 (line 302) | YES (line 762) | PASS |
| `USB_VERSION_RE` | T4 (line 303) | YES (line 762) | PASS |
| `SPEED_RE` | T4 (line 304) | YES (line 762) | PASS |
| `parseWatts` | T4 (line 305) | YES (line 762) | PASS |
| `parseDirection` | T4 (line 306) | YES (line 762) | PASS |
| `parseLinkSpeed` | T4 (line 307) | YES (line 762) | PASS |
| `DIAG_PHRASES` | T4 (line 308) | YES (line 762) | PASS |
| `keyForBullet` | T6 (lines 419-422) | YES (line 762) | PASS |
| `KEYWORD_MAP` | T5 (line 351) | YES (line 762) | PASS |

Task 12 grep-gate text (line 762):
```
grep -RnE "WATT_RE|DIRECTION_RE|USB_VERSION_RE|SPEED_RE|parseWatts|parseDirection|parseLinkSpeed|DIAG_PHRASES|keyForBullet|KEYWORD_MAP" usbee@bitcreed.us/src/
```

All 10 enumerated CONTEXT symbols are in the grep pattern. Additionally, Task 12 line 770 asserts `\.bullets\b` is also gone (catches any leftover consumer of the old `device.bullets` field — defensive belt-and-suspenders).

Preservation list also asserted (line 782 done-criteria): "SYMBOLIC_ICON_RE (preserved security mitigation) and formatWatts (preserved UI formatter) are NOT in the deletion list and remain present."

**Pass/fail:** **PASS.** 10/10 deletion symbols accounted for in both the deletion tasks and the grep-gate; both preserved symbols are positively asserted.

---

## Plan dependency declarations

| Plan | `depends_on` | Expected | Verdict |
|---|---|---|---|
| 04-01 | `[]` | `[]` (Wave 1, no upstream plan) | PASS |
| 04-02 | `[04-01]` (line 6-7) | `[04-01]` | PASS |
| 04-03 | `[04-02]` (line 6-7) | `[04-02]` | PASS |

Wave assignment matches dependency declarations: 04-01 is wave 1, 04-02 is wave 2 (depends on 04-01), 04-03 is wave 3 (depends on 04-02). No cycles, no forward references, no missing.

**Pass/fail:** **PASS.**

---

## Concerns / notes

These are non-blocking observations the planner may want to consider:

1. **`src/tile.js` not in ROADMAP §Implementation Scope.** 04-02 Task 10 edits `src/tile.js` to subscribe to the new `daemon-too-old` signal. The ROADMAP scope list for Phase 4 names every other touched file but omits `tile.js`. This is a documentation gap in the ROADMAP, not a plan defect — the edit is necessary and minimal (a `_registry.addSignal` binding). Suggest noting in the SUMMARY that `tile.js` got a one-binding addition.

2. **`stylesheet.css` not in ROADMAP §Implementation Scope.** 04-02 Task 7 adds a `.usbee-detail-driver-missing` CSS rule for the DISP-04 italic flag. Phase 3 already established the precedent of stylesheet.css edits accompanying popover changes; same documentation-gap nature as note 1.

3. **04-02 Task 9 re-entrant gate logic** (line 597): "in the `daemon-too-old` early-return, also leave `this._proxy = proxy` set — the next proxy-ready re-evaluation reads `proxy.Version` again after the owner cycle." This logic is subtle — if a user upgrades the daemon mid-session, `NameOwnerChanged` fires twice (vanish + appear), the proxy is reconstructed, and the new `Version` is read. The plan should make this explicit in the smoke-test (Task 14) — currently the smoke-test only covers the static `MIN_USBEEHIVE_VERSION = '99.99.99'` simulation. A "live upgrade mid-session" scenario would add confidence but is not strictly required by COMPAT-01.

4. **04-02 Task 11 test invocation is loose.** The test author proposes Option A (Node loader hooks) or Option B (run under gjs). The plan says "Recommend Option B for v2.0; revisit when an EGO-acceptable test harness materialises." Acceptable for v2.0 since the test is internal-only and not shipped in the EGO zip — BUT the WIRE-04 acceptance ("covered by a regression test") needs proof of execution. Recommend the SUMMARY captures the exact invocation command verified, e.g. `gjs -m usbee@bitcreed.us/src/forward-compat.test.js` with exit code 0 evidence.

5. **04-02 deriveSubtitle direction logic (Task 4, line 316-317):** The new direction mapping is `'Sink' → 'sink'`, `'Source' → 'source'`, anything else → `null`. This is correct for the existing two-direction UX but won't surface a `DualRole` or `Unknown` power_role at all (Tier-1 would skip the device). For v2.0 this is acceptable per UX-3 / UX-4 (no copy change planned); just noting that future variants requiring DualRole subtitles will need a follow-up.

6. **04-03 Task 4 xgettext command does NOT include `usbee@bitcreed.us/src/forward-compat.test.js`.** This is correct — the test file should not contribute translation strings to the .pot — but the command pattern `usbee@bitcreed.us/src/*.js` will glob it in. Suggest excluding via `--exclude-file` or moving the test out of `src/`. Currently the test fixture uses translated strings like `'Serial'` in an assertion which xgettext might accidentally extract from the assertion comparison string. Verify post-extraction that the .pot has no `msgid "Hibernating"` or similar fixture-only strings.

7. **04-02 Task 10 references `populateEmptyState` lines 121-124** but does not verify that line range is still accurate (Phase 3 may have shifted it). This is an execution-time concern not a planning concern; the executor will resolve the actual line numbers.


---

## Re-verification (post-fix, 2026-05-14)

**Verdict: PASS.**

Both blockers from the original review were addressed in commit `60effc0`, verified by direct read of `04-02-PLAN.md`.

### B-1 — Atomic-commit discipline (FIXED)

New `<atomic_commit_discipline>` block at lines 198–210 documents the merged-commit policy. Per-task verification:

- **Tasks 1, 2, 3:** Each ends with explicit "stage … but DO NOT commit" language in its `<action>` body and matching `<done>` clause. Examples:
  - Task 1 line 233: *"STAGE this change with `git add usbee@bitcreed.us/dbus-iface.xml` after editing — but DO NOT commit; the atomic commit lands at the end of Task 4."*
  - Task 2 line 255: same stage-not-commit pattern.
  - Task 3 line 299: same pattern.
- **Task 4 (line 308):** Renamed `Atomic regex-layer deletion + structured-field rewrites in device-store.js — CLOSES the merged Tasks 1–4 commit`. Body at lines 349–360 directs the single commit message:

  `feat(04-02): wire-shape cutover to org.usbeehive.Devices2 + delete bullet-regex layer (WIRE-01/02, CLEAN-01/02, DISP-03)`

  with a multi-line HEREDOC body enumerating the four bundled changes.
- **Verify gate (line 362):** carries `git log -1 --pretty=%s | grep -q "wire-shape cutover to org.usbeehive.Devices2"` — executor cannot accidentally split the commit without failing this assertion.

The reviewer-facing single-diff pattern is restored.

### B-2 — WIRE-04 bottleneck coverage (FIXED)

Task 11 (renumbered from Task 13) at lines 644–870 now covers all five WIRE-04 enums:

- **Fixture** `makeFutureBottleneckDevice()` at lines 768–796 sets `charging_diag.present = true`, `bottleneck: 'CosmicRayInterference'`, `is_warning: true`, with non-empty `summary`/`detail` strings.
- **Three new test cases at lines 827–853:**
  - `hasIssue: unknown bottleneck with is_warning=true returns true` — asserts the is_warning bool is the contract, the bottleneck identifier is opaque.
  - `renderer: unknown bottleneck does not throw; produces usable popover row` — wraps `deriveSubtitle` in `assert.doesNotThrow`.
  - `renderer: diagnostic summary string renders verbatim for unknown bottleneck` — asserts the summary/detail round-trip unchanged.
- **Acceptance criteria (lines 864–867)** explicitly enumerate the three cases as "DO NOT DROP (B-2 explicit)".
- Task header enum-coverage matrix (line 703) lists all five WIRE-04 enums with their unknown-variant values.

WIRE-04's "all five enums" requirement is fully satisfied.

### Renumbering sanity sweep

Downstream tasks shifted: 11→9 (daemon-version gate), 12→10 (tile signal wiring), 13→11 (forward-compat test). Spot-checked cross-references in 04-02 — internal references use the new numbers. 04-01 and 04-03 grep clean for `04-02 Task` references that would have rotted.

### Remaining concerns (non-blocking, carry-forward from original review)

The seven non-blocking concerns from the original review (e.g. JSDoc parameter mismatch, planning-doc count drift, .pot extraction glob) remain unchanged — they were marked non-blocking on first pass and stay non-blocking. None of the fixes touched their loci.

**Plans cleared for execution.** Next action: `/gsd-execute-phase 4`.
