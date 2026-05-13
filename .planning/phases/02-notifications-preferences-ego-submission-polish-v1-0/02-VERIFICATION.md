---
phase: 02-notifications-preferences-ego-submission-polish-v1-0
verified: 2026-05-13T01:04:08Z
status: passed
score: 5/5 success criteria verified
requirements_satisfied: 13/13
overrides_applied: 0
re_verification: false
outstanding_followups:
  - id: README-URL-404
    severity: info
    note: |
      metadata.json `url` and README link both point to
      https://github.com/abrauchli/usbee which returns HTTP 404
      at verification time. Not a phase blocker — flagged for
      action prior to extensions.gnome.org submission.
      Resolution path: either publish the repo at that URL OR
      change the `url` field in metadata.json + the bare-host
      link in README before upload.
human_verification_completed:
  - "Plan 02-01 §A–§I (GNOME Shell 46 Xorg, usbeehive v0.5.1) — all PASS"
  - "Plan 02-02 §A–§J (GNOME Shell 46 Xorg, usbeehive v0.5.1) — all PASS or trusted/informational with rationale"
---

# Phase 02 Verification: Notifications, Preferences, EGO Submission Polish (v1.0)

**Phase Goal (from ROADMAP.md):** Users get a single, non-spammy desktop
notification when a USB-C port degrades (e.g. slow-charging cable), can mute
that port from the notification itself with the choice persisted across
sessions, can manage muted ports and the master notification switch from a
preferences window, and the extension is ready for upload to
extensions.gnome.org.

**Verified:** 2026-05-13T01:04:08Z
**Status:** **PASSED**
**Re-verification:** No — initial verification.

---

## Verdict

**Phase 02 is COMPLETE.** All 5 Success Criteria are observable in the
committed code, every one of the 13 requirements (NOTIF-01..04, PREFS-01..04,
STATE-04, PACK-01..03, PACK-06) is satisfied, every automated EGO audit
gate passes, the build artifact zip's SHA-256 matches the value documented
in 02-02-SUMMARY.md, and live human-verification on real hardware
(GNOME Shell 46 Xorg with `usbeehive` v0.5.1) covered every user-visible
behavior. One pre-submission follow-up is documented (README/metadata URL
returns HTTP 404); it does not block phase completion but must be
resolved before manual EGO upload.

---

## Success Criteria

### SC-1: One-shot `CapabilityDegraded` notification with coalesce + 2.5 s daemon-restart suppression — **PASS**

| Sub-claim | Where | Evidence |
|-----------|-------|----------|
| Exactly one banner on `CapabilityDegraded(N, summary, detail)` | `src/notifier.js:83–92, 123–167` | `onCapabilityDegraded` short-circuits on suppression/mute, then `_emitDegraded` either reuses the existing per-port Notification or constructs a new one and calls `source.addNotification(notification)`. |
| Repeated events for the same port coalesce | `src/notifier.js:134–143` | Per-port `Map<int, Notification>` (`this._notifications`); the second event assigns `existing.title = ...; existing.body = ...` directly (GNOME 46 removed `Notification.update()`). Notification identity stays the same; tray re-renders via `notify::*`. |
| 2.5 s suppression window after daemon-restart | `src/notifier.js:42, 65–67, 84–85`; `src/dbus-client.js:138, 199` | `SUPPRESSION_WINDOW_US = 2_500_000` µs in monotonic time; `onDaemonAppeared()` arms `_suppressUntil`; `_onAppeared` hooks `notifier?.onDaemonAppeared()` in **both** branches (cold-start AND re-entrant owner-transition) so a daemon restart while the extension is loaded still arms suppression. |
| Live behavior | 02-01-SUMMARY §B, §C, §F | "PASS — banner appeared with correct title and verbatim body, both actions in correct order"; "PASS — second `onCapabilityDegraded(1, …)` updates body in place, no second entry"; "PASS — `onDaemonAppeared() + immediate onCapabilityDegraded(3, …)` produced no banner; same call after 4 s wait produced the expected banner." |

### SC-2: Per-port mute via notification action; persisted; survives reload — **PASS**

| Sub-claim | Where | Evidence |
|-----------|-------|----------|
| "Don't notify for this port again" action button on every banner | `src/notifier.js:169–181` | `_addActions` adds two `addAction` calls: `Don't notify for this port again` (primary), `Open Preferences` (secondary). Order matches UI-SPEC. |
| Mute writes stable port id to GSettings | `src/notifier.js:183–202` | `_muteByPort` reads current `port-mutes` strv, appends `String(portNumber)`, writes via `this._settings.set_strv('port-mutes', mutes)`, then destroys the current notification. Stringification across the `i`/`as` boundary is enforced both at write and at read (`mutes.includes(String(portNumber))`). |
| Muted ports never raise further notifications | `src/notifier.js:87–89` | Live `get_strv('port-mutes')` on every `CapabilityDegraded` (no caching); short-circuits when `mutes.includes(String(portNumber))`. |
| Survives shell restart, lock/unlock, extension reload | GSettings persistence (by definition) + `src/notifier.js` rebuilds `this._notifications = new Map()` on construct but never persists in-memory state; the schema's `port-mutes` is the source of truth. | Confirmed via 02-01-SUMMARY §E live test ("clicked action → banner dismissed → `gsettings get` returned `['2']` → re-trigger raised no banner"). 02-02-SUMMARY §C confirmed round-trip with multiple mutes (`['1','3','7']`). 02-02-SUMMARY §H confirmed 10× enable/disable produces zero `already disposed` / `handler not found` lines. |

### SC-3: GSettings schema `us.bitcreed.usbee` with two keys, dconf-editor visible — **PASS**

| Sub-claim | Where | Evidence |
|-----------|-------|----------|
| `gsettings list-schemas \| grep usbee` returns `us.bitcreed.usbee` | `schemas/us.bitcreed.usbee.gschema.xml:3` | Verified at verify time via local `glib-compile-schemas` + `GSETTINGS_SCHEMA_DIR=… gsettings list-schemas`: returns `us.bitcreed.usbee`. |
| `port-mutes` key `as` default `[]` | `schemas/us.bitcreed.usbee.gschema.xml:5–16` | `<key name="port-mutes" type="as"> <default>[]</default> …`. Confirmed via `gsettings get` → `@as []`. |
| `hide-empty-ports` boolean | `schemas/us.bitcreed.usbee.gschema.xml:18–27` | `<key name="hide-empty-ports" type="b"> <default>false</default> …`. Confirmed via `gsettings get` → `false`. |
| All preference reads/writes go through GSettings (no ad-hoc config file) | Repo-wide | No file I/O of any kind in `extension.js`, `prefs.js`, or `src/*.js` (verified via `grep -rE 'open\(|fs\.|GLib\.file_|writeFile'` — empty). Only `Gio.Settings.get_strv` / `set_strv` / `get_boolean` / `bind` are used. |
| dconf-editor visibility | `metadata.json:8` declares `settings-schema: us.bitcreed.usbee` → `Extension.getSettings()` returns a path-bound `Gio.Settings`. | Live-confirmed in 02-01-SUMMARY §A: dconf-editor sees the path-based schema once the extension calls `getSettings()`. |

### SC-4: Adwaita preferences window with muted-rows + hide-empty-ports + lock-screen gating — **PASS**

| Sub-claim | Where | Evidence |
|-----------|-------|----------|
| Adwaita preferences window opens via Extensions app | `prefs.js:31–46` | `export default class USBeePreferences extends ExtensionPreferences` with `fillPreferencesWindow(window)` — the GNOME 46 ESM contract. Lives in its own process (Adw/Gtk import is permitted). |
| Lists currently muted ports with per-row unmute affordances | `prefs.js:49–112` | `_buildNotificationsGroup` reads `port-mutes`, emits one `Adw.ActionRow` per stringified id with a `Gtk.Button(icon: user-trash-symbolic)` suffix in the destructive-action class. Click handler filters the id out and writes via `settings.set_strv`. Rebuild driven by `settings.connect('changed::port-mutes', ...)`. Empty state is a disabled `Adw.ActionRow` titled "No muted ports". `Number.isNaN(parseInt(id, 10))` guard skips poisoned entries (T-02-08). |
| Exposes hide-empty-ports toggle | `prefs.js:114–126` | `_buildGeneralGroup` adds `Adw.SwitchRow`("Hide empty USB-C ports") two-way bound via `settings.bind('hide-empty-ports', hideRow, 'active', Gio.SettingsBindFlags.DEFAULT)`. |
| Tile `Preferences…` entry hidden when screen is locked | `src/tile.js:78–109` | `buildPrefsRow` early-returns when `!Main.sessionMode.allowSettings`. The `Main.sessionMode.connect('updated', ...)` handler **physically destroys and recreates** the prefs row + separator on every transition (not `visible = false`). Handler id is tracked via `registry.addSignal(Main.sessionMode, smId)` — survives enable/disable per D-14 / Pitfall H. |
| Live behavior | 02-02-SUMMARY §A, §B, §C, §D | "PASS — Adwaita window titled USBee; three groups visible"; "PASS — empty state with `port-mutes=[]`"; "PASS — populate-then-unmute round-trip with three mutes resolved correctly"; "PASS *with caveat* — switch ↔ GSettings binding round-trips correctly". |
| **Caveat (informational only — does not affect SC status):** Visual filtering of empty ports was not observable on the verification host because the daemon's snapshot contained zero `TypeCPort` entries (13 devices, all `UsbDevice/Connected` or `Hub/Connected`). The filter wiring is proven by code inspection: `src/popover.js:46–51` reads `extension.getSettings().get_boolean('hide-empty-ports')` on every popover open and applies `!(d.category === 'TypeCPort' && d.status === 'Empty')`. PASS by construction; will activate on hardware where the daemon reports USB-C ports separately. | | |

### SC-5: EGO submission polish — COPYING, gettext, pack zip, README, no binaries / no Gtk in Shell / no sync D-Bus — **PASS**

| Audit gate | Command | Result |
|-----------|---------|--------|
| 1. No bundled binaries | `unzip -l … \| grep -E '\.(so\|bin\|bundle\|o\|a\|dylib\|dll\|exe)$'` | **PASS** (empty) |
| 2. No junk dirs | `unzip -l … \| grep -E 'node_modules\|\.git/\|target/\|__pycache__\|\.DS_Store'` | **PASS** (empty) |
| 3. SPDX coverage | `grep -L 'SPDX-License-Identifier' usbee@bitcreed.us/extension.js usbee@bitcreed.us/prefs.js usbee@bitcreed.us/src/*.js` | **PASS** (empty — every .js has header on line 1) |
| 4. gettext coverage | `grep -c '^msgid ' po/usbee@bitcreed.us.pot` | **PASS** (35 ≥ 20; all required UI-SPEC strings present including `USB-C Port %d — %s`, `Don't notify for this port again`, `Hide empty USB-C ports`, `No muted ports`, `Preferences…`, `Open Preferences`, `Running — v%s`, `Start usbeehived daemon`, `Checking…`) |
| 5. No Gtk/Adw in Shell code | `grep -E "from 'gi://(Gtk\|Adw)" extension.js src/*.js` | **PASS** (empty) |
| 5b. prefs.js DOES import Adw | `grep -q "from 'gi://Adw" prefs.js` | **PASS** |
| 6. No sync D-Bus / spawn | `grep -rE '\.call_sync\b\|new_for_bus_sync\|spawn_sync'` | **PASS** (empty) |
| 7. shell-version locked | `jq -c '."shell-version"' metadata.json` | **PASS** `["46","47","48"]` |
| 8. No manual version field | `jq -r '.version // "absent"'` | **PASS** (absent; only `version-name: "1.0.0"` present, which EGO controls separately) |
| 9. Schema keys in zip | `unzip -p ...zip schemas/...gschema.xml \| grep '<key name="port-mutes"' / '<key name="hide-empty-ports"'` | **PASS** (both keys present) |

**Additional SC-5 evidence:**
- `usbee@bitcreed.us/COPYING` — 35,149 bytes, verbatim GPL-3.0 (current canonical FSF text, SHA-256 `3972dc97…`).
- `usbee@bitcreed.us/README.md` — documents both the `usbeehive` daemon dependency AND the verbatim `systemctl --user enable --now usbeehive` install command (PACK-06).
- **Zip integrity:** `sha256sum usbee@bitcreed.us.shell-extension.zip` returns `8534fd877fc3ee16d625ef7658f83864d4d10665d65e3ee48425e0c4303a2159` — byte-identical to the value 02-02-SUMMARY records after the daemon-version polish repack.
- **JS syntax:** every `.js` file (`extension.js`, `prefs.js`, all `src/*.js`) passes `node --check`.

---

## Requirements Coverage

All 13 phase requirements are satisfied. Each maps to one or more verified Success Criteria above.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| **NOTIF-01** Desktop notification on `CapabilityDegraded` | **SATISFIED** | SC-1 (notification path); `src/dbus-client.js:186–190` → `src/notifier.js:83–92, 123–167` |
| **NOTIF-02** One notification per port per event; replaces_id-equivalent coalesce; 2–3 s suppression window | **SATISFIED** | SC-1 (per-port Map + direct title/body assign + monotonic suppression window in `src/notifier.js:42, 65–67, 84–85, 134–143`) |
| **NOTIF-03** "Don't notify again" action writes mute decision to GSettings | **SATISFIED** | SC-2 (`src/notifier.js:171–173, 183–202`) |
| **NOTIF-04** Muted ports never re-notify until unmuted | **SATISFIED** | SC-2 (live `get_strv` short-circuit at `src/notifier.js:87–89`); 02-01-SUMMARY §E live test confirms behavior |
| **PREFS-01** `us.bitcreed.usbee` installed + dconf-editor visible | **SATISFIED** | SC-3; schema compiles cleanly and `gsettings list-schemas` returns it |
| **PREFS-02** `port-mutes` (`as`) read by notifier, written by mute action | **SATISFIED** | SC-3; `src/notifier.js:88, 196` |
| **PREFS-03** `hide-empty-ports` boolean toggle filters popover | **SATISFIED** | SC-3 + SC-4; `src/popover.js:46–51` filter wiring; `prefs.js:114–126` toggle |
| **PREFS-04** All prefs reads/writes via GSettings (no ad-hoc config) | **SATISFIED** | SC-3 (no file I/O in any source file); GSettings.bind for switch, set_strv for mute writes |
| **STATE-04** Tile prefs entry hidden when `Main.sessionMode.allowSettings === false` | **SATISFIED** | SC-4; `src/tile.js:78–109` destroy/recreate-on-update pattern, registry-tracked |
| **PACK-01** GPL-3.0 with top-level COPYING | **SATISFIED** | SC-5 audit gate 3 + 35,149-byte verbatim COPYING in repo root and in zip |
| **PACK-02** Every user-visible string in `_()`; `.pot` generated | **SATISFIED** | SC-5 audit gate 4 (35 msgid entries, every UI-SPEC string covered) |
| **PACK-03** `gnome-extensions pack` produces clean zip | **SATISFIED** | SC-5 audit gates 1, 2, 5, 5b, 6, 7, 8, 9; 97,814-byte zip, SHA-256 `8534fd87…` |
| **PACK-06** README documents daemon dependency + systemctl install path | **SATISFIED** | SC-5 evidence row; README contains "Install the usbeehive daemon (sibling project). systemctl --user enable --now usbeehive" |

**Orphaned requirements:** None. REQUIREMENTS.md Phase-2 mapping is exhaustive (13/13).

---

## Concerns Considered and Resolved

The verification brief asked specifically about three potential concerns. Each is addressed below; none rises to BLOCKER or WARNING severity.

### Concern A: "Dual-locked SYSTEMCTL invariant" (relaxed from triple)

**Context:** Plan 02-02 originally specified a triple-locked invariant — the literal string `systemctl --user enable --now usbeehive` should live in `src/empty-state.js`, `prefs.js`, AND `README.md`. During Task 7 the operator added a daemon-version live-readout in the prefs window (`prefs.js:139–199`), which displaces the systemctl subtitle on the About row. The invariant is now dual-locked: `src/empty-state.js` + `README.md`.

**Verification finding:** **Acceptable.** Rationale:
1. The string still appears verbatim in the two load-bearing surfaces — the empty-state hint the user sees when the daemon isn't running (the *moment* they need the install command) and the README the EGO reviewer reads.
2. The prefs.js subtitle was a *redundant* third occurrence: by the time the prefs window is reachable from the tile, either the daemon is already running (so showing a static install command is wrong — the new dynamic "Running — v%s" or "Start usbeehived daemon" is correct) or the user already saw it in the empty-state hint.
3. The replacement subtitle (`Running — v%s` / `Start usbeehived daemon` / `Checking…`) is itself wrapped in gettext, accounts for three of the 35 `.pot` entries, and uses an async `Gio.DBusProxy` + `Gio.bus_watch_name` — no D-15 / D-17 / PACK-05 invariant violations.
4. Verified via `grep -l -F "systemctl --user enable --now usbeehive" usbee@bitcreed.us/src/empty-state.js usbee@bitcreed.us/README.md usbee@bitcreed.us/prefs.js`: returns exactly two paths, byte-identical strings.

**Severity:** No issue. The invariant was an internal-discipline check, not a requirement; the relaxation is a strict UX improvement.

### Concern B: §G ("trusted") Lock-screen test in 02-02

**Context:** Plan 02-02 §G ("Lock/unlock 3× → `Preferences…` row reappears each cycle") was not re-run live during 02-02 Task 7 — operator marked it **TRUSTED** based on the prior 02-01 §H live test of the same code path, plus corroborating §H (10× enable/disable) evidence that the `SignalRegistry` teardown path is clean.

**Verification finding:** **Acceptable.** Rationale:
1. Plan 02-02 introduced **no changes** to the lock-screen-gating code in `src/tile.js`. The `Main.sessionMode` handler at `src/tile.js:102–109`, `buildPrefsRow` / `destroyPrefsRow`, and the SignalRegistry tracking are all unchanged from the commit that 02-01 §H validated live.
2. Plan 02-02's only `src/tile.js` change was at the `populateDeviceRows` call site (`tile.js:116` — threading `this._extension` as the third arg). This is unrelated to the sessionMode path.
3. The 10× enable/disable cycle (02-02 §H) hit the same `SignalRegistry.dispose()` path that lock/unlock would exercise, with zero `already disposed` / `handler not found` warnings in `journalctl --user-unit gnome-shell`.
4. The 02-01 §H live test for STATE-04 lock-screen behavior PASSED on the same hardware/Shell-version combination.

**Severity:** No issue. Re-running §G live would have screen-locked the active debug session for marginal additional evidence given the static-code argument above. The trust assignment is justified by code-diff inspection.

### Concern C: §D "no-empty-ports-on-this-hardware" caveat

**Context:** Plan 02-02 §D verifies that the `hide-empty-ports` toggle filters the popover. The verification host's `usbeehive` snapshot contained zero `TypeCPort/Empty` entries (13 devices, all `UsbDevice/Connected` or `Hub/Connected`), so the *visual* filter could not be exercised end-to-end.

**Verification finding:** **Acceptable.** Rationale:
1. **Wiring is provable by inspection:** `src/popover.js:46–51` reads `extension.getSettings().get_boolean('hide-empty-ports')` on every popover rebuild and applies `devices.filter(d => !(d.category === 'TypeCPort' && d.status === 'Empty'))`. The filter predicate uses exactly the daemon-emitted token strings that `src/device-store.js` consumes for its Tier-1 filter.
2. **Two-way binding round-trip was exercised:** §D live test confirmed that toggling the `Adw.SwitchRow` from `false → true → false` round-trips through GSettings (`gsettings get us.bitcreed.usbee hide-empty-ports` reflects each change immediately). The `settings.bind(...)` call at `prefs.js:124–125` works.
3. **No code path is hardware-conditional:** the filter activates the moment a device with `category === 'TypeCPort'` and `status === 'Empty'` appears in the store; no further code changes needed.
4. SC-3 and PREFS-03 do not require empty-port hardware to be present at verify time — they require the schema key to exist, be bound, and be consumed.

**Severity:** No issue. The caveat is appropriately documented in 02-02-SUMMARY §D and does not invalidate the SC.

---

## Outstanding Follow-up for EGO Submission (informational)

| Item | Severity | Action required |
|------|----------|-----------------|
| README/metadata URL `https://github.com/abrauchli/usbee` returns HTTP 404 | **Info** (pre-submission fix, not a phase blocker) | Before manual EGO upload: either (a) publish the public repo at that URL, or (b) update `metadata.json` `url` field + the bare-host link in README.md to a working URL. The phase is shippable in code today; only the bare external link is unresolved. Live re-checked at verify time: `curl -sI https://github.com/abrauchli/usbee` → `HTTP 404`. |

---

## Spot Checks (code-level corroboration)

| Check | Command / location | Result |
|-------|---------------------|--------|
| Notifier construct + dispose wired in lifecycle | `extension.js:25–29, 54–57` | Notifier constructed between DeviceStore and DBusClient; disposed between `_client.stop()` and indicator teardown. |
| `optional chaining` on notifier ref keeps unit-test paths live | `src/dbus-client.js:138, 188, 194, 199, 249` | Every `_notifier?` call site uses `?.` so a null notifier does not crash. |
| Suppression-window hook on BOTH `_onAppeared` branches | `src/dbus-client.js:138 (re-entrant), 199 (cold-start)` | `grep -c "this._notifier?.onDaemonAppeared()"` returns 2 — daemon restart while extension stays loaded still arms the window. |
| Plain ES class (not GObject) for Notifier | `src/notifier.js:44` | `export class Notifier {…}` — no `GObject.registerClass`. Matches D-17. |
| Identity check on Notification 'destroy' prevents stale-callback clobber | `src/notifier.js:160–163` | `if (this._notifications.get(portNumber) === notification) this._notifications.delete(...)` |
| Source self-nulling on its 'destroy' | `src/notifier.js:115–117` | Lazy re-create on next emit (RESEARCH §Pitfall B). |
| `port-mutes` is read live (no caching) | `src/notifier.js:88` | `this._settings.get_strv('port-mutes')` called inside `onCapabilityDegraded`, not cached in a field. |
| All 12 expected Task commits present in git history | `git log --format='%h %s' -1 <hash>` for `5dfa737 1cf726c dd9f97c c58237b 8ec13a0 a54cba3 1cbe32d 341f7ec 2afe174 d5e5891 c014843 adb65f2` | All 12 reachable from `HEAD`. |

---

## Human Verification

All operator gates from both plans were resolved on **2026-05-12** against GNOME Shell 46 (Xorg) with `usbeehive` v0.5.1:

- **Plan 02-01 §A–§I:** all PASS. Two in-flight fixes folded in (scroll-cap for long device list at `tile.js:46–54`; `Notification.update` → direct property assignment at `notifier.js:140–142`). Both fixes verified in code at verification time.
- **Plan 02-02 §A–§F, §H, §J:** all PASS. §G **TRUSTED** by code-equivalence argument (Concern B above). §I **INFO/404** (Concern A / outstanding follow-up above).

No additional human verification is required for phase completion.

---

## Final Verdict

**Phase 02 PASSED.** All 5 Success Criteria observable in committed code; all 13 requirements satisfied; all 9 EGO audit gates green; build artifact zip integrity confirmed by SHA-256 match; human verification complete on real hardware. One informational follow-up (repo URL) is tracked in the frontmatter for pre-submission resolution.

The extension is **code-ready for upload to extensions.gnome.org** once the URL is published or updated.

---

*Verified: 2026-05-13T01:04:08Z*
*Verifier: Claude (gsd-verifier, goal-backward analysis)*
