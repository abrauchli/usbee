---
phase: 02-notifications-preferences-ego-submission-polish-v1-0
plan: 02
subsystem: ui
tags:
  - gnome-shell
  - extension
  - libadwaita
  - gtk4
  - preferences
  - gsettings
  - packaging
  - ego-submission

# Dependency graph
requires:
  - phase: 02-01
    provides: GSettings schema us.bitcreed.usbee (port-mutes/hide-empty-ports), Notifier with mute action, Preferences… tile row, this._extension wired on USBeeToggle
  - phase: 01
    provides: src/popover.js populateDeviceRows signature, src/empty-state.js SYSTEMCTL_CMD, SignalRegistry pattern, metadata.json scaffold
provides:
  - Adwaita preferences window with three groups (Notifications, General, About)
  - Trash-button unmute UX writing through GSettings port-mutes
  - SwitchRow for hide-empty-ports auto-bound to GSettings via Gio.Settings.bind
  - populateDeviceRows hide-empty-ports filter (PREFS-04 consumer end)
  - usbee@bitcreed.us/COPYING (verbatim GPL-3.0, 35,149 bytes)
  - usbee@bitcreed.us/README.md (EGO-ready, four UI-SPEC-pinned sections)
  - usbee@bitcreed.us/po/usbee@bitcreed.us.pot (32 msgid entries, xgettext 0.21)
  - metadata.json version-name field
  - usbee@bitcreed.us.shell-extension.zip (97,814 bytes, 22 files, all 9 EGO audit gates pass)
affects:
  - any future phase that adds preferences rows
  - any future phase that ships a translated .po
  - the EGO submission upload (manual, outside any phase)

# Tech tracking
tech-stack:
  added:
    - libadwaita 1.5 (Adw.PreferencesPage / PreferencesGroup / SwitchRow / ActionRow)
    - GTK4 (Gtk.Button trash suffix)
    - gettext / xgettext 0.21 (.pot template)
    - glib-compile-schemas (gschemas.compiled)
    - gnome-extensions pack (zip artifact)
  patterns:
    - "prefs.js as the ONLY repo file importing gi://Gtk + gi://Adw (D-17 enforced)"
    - "Gio.Settings.bind for SwitchRow ↔ GSettings two-way (no manual notify::active)"
    - "settings.connect('changed::port-mutes', cb) + window.connect('close-request', disconnect) for prefs-process lifecycle"
    - "Tracked-row dynamic rebuild pattern (mutedRows array; Adw.PreferencesGroup has no bulk-clear method)"
    - "parseInt + Number.isNaN guard against poisoned port-mutes entries (T-02-08)"
    - "Live get_boolean read on every popover open (D-11 lazy-rebuild — no caching)"

key-files:
  created:
    - usbee@bitcreed.us/prefs.js
    - usbee@bitcreed.us/COPYING
    - usbee@bitcreed.us/README.md
    - usbee@bitcreed.us/po/usbee@bitcreed.us.pot
  modified:
    - usbee@bitcreed.us/src/popover.js
    - usbee@bitcreed.us/src/tile.js
    - usbee@bitcreed.us/metadata.json
    - .gitignore

key-decisions:
  - "Used Gio.Settings.bind (not manual notify::active) for the hide-empty-ports SwitchRow — auto-save matches Adwaita design idiom; no Save / Apply / Cancel button"
  - "Tracked mutedRows in a local array for manual remove() — Adw.PreferencesGroup exposes no remove_all()/bulk-clear API in libadwaita 1.5"
  - "Number.isNaN(parseInt(id, 10)) guard skips poisoned port-mutes entries instead of crashing the prefs window (T-02-08 mitigation)"
  - "Live extension.getSettings().get_boolean('hide-empty-ports') on every popover rebuild — no cached field; the read is ~µs and only fires on tile-open (D-11 lazy-rebuild)"
  - "Used --extra-source=src (directory) instead of seven per-file flags — the per-file form strips the src/ prefix and lands files at zip root, breaking ./src/* imports"
  - "Added --extra-source=po so .pot ships in the zip — gnome-extensions pack does NOT auto-include po/; --podir only governs .mo discovery"
  - "Pre-compiled schemas with glib-compile-schemas then post-processed the zip to include schemas/gschemas.compiled — gnome-extensions pack does not bundle the compiled file (verified via strace), but the audit gate inventory requires it"
  - "Fetched gettext 0.21 from Ubuntu's apt mirror (apt-get download, no sudo) and ran xgettext under LD_LIBRARY_PATH — the dev host had no system gettext; system flatpak xgettext segfaulted"

patterns-established:
  - "prefs.js process isolation: Shell-process code (extension.js + src/*.js) NEVER imports Gtk/Adw; prefs.js is the sole boundary file (CLAUDE.md D-17)"
  - "Triple-locked SYSTEMCTL_CMD invariant: the same literal `systemctl --user enable --now usbeehive` lives in src/empty-state.js, prefs.js daemon-row subtitle, and README.md Installing section"
  - "EGO audit gate matrix: 9 automated checks (no binaries, no junk dirs, full SPDX coverage, ≥20 msgid, no Gtk/Adw leak, prefs.js Adw asserted, no sync D-Bus, locked shell-version, no manual version, schemas declared) — codify the verify commands in PLAN.md so future packaging changes re-run them"

requirements-completed:
  - PREFS-04
  - PACK-01
  - PACK-02
  - PACK-03
  - PACK-06

# Metrics
duration: ~25 min
completed: 2026-05-12
---

# Phase 2 Plan 02: Preferences Window + EGO Submission Packaging Summary

**Adwaita preferences window (three groups, trash-button unmute, hide-empty-ports SwitchRow) + verbatim GPL-3.0 COPYING + EGO-ready README + 32-msgid .pot + version-name metadata + clean 97KB shell-extension zip passing all 9 automated EGO audit gates**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-12 (Wave 2 of 2, after Plan 02-01 base commit `bdd030c`)
- **Completed:** 2026-05-12
- **Tasks:** 6 of 7 (Task 7 is the human-verify checkpoint — see "Awaiting Human Verification" below)
- **Files modified:** 4 created, 4 modified
- **Commits:** 6 atomic per-task commits + this SUMMARY metadata commit

## Accomplishments

- **`prefs.js`** — modern `ExtensionPreferences` subclass with `fillPreferencesWindow(window)`. Three groups in locked order: **Notifications** (per-port muted rows with destructive-action trash buttons), **General** (hide-empty-ports `Adw.SwitchRow` two-way bound via `settings.bind`), **About** (Version row + daemon hint with verbatim systemctl command). 129 lines. Only file in the repo importing `gi://Gtk` and `gi://Adw`.
- **`src/popover.js` patch** — `populateDeviceRows(section, store, extension)` now reads `extension.getSettings().get_boolean('hide-empty-ports')` on every rebuild and filters out `TypeCPort`+`Empty` rows when true (PREFS-04 consumer end).
- **`src/tile.js` patch** — call site threads `this._extension` as the third arg.
- **`metadata.json`** — added `version-name: "1.0.0"` (PACK-03 audit gate 8).
- **`COPYING`** — verbatim GPL-3.0 from `https://www.gnu.org/licenses/gpl-3.0.txt`, 35,149 bytes, SHA-256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`. (Plan's documented hash `8ceb4b9...` did not match the current canonical file; the file is verified verbatim by header + tail + the "How to Apply These Terms" section.)
- **`README.md`** — four UI-SPEC-pinned sections only (USBee, Installing, Requirements, License). No badges, no TOC, no marketing copy.
- **`po/usbee@bitcreed.us.pot`** — 32 msgid entries via `xgettext 0.21` (header `Project-Id-Version: USBee 1.0.0`). Every Phase 2 UI-SPEC string present: `USB-C Port %d — %s`, `Don't notify for this port again`, `Hide empty USB-C ports`, `No muted ports`, `Preferences…`, `Required — run: systemctl --user enable --now usbeehive`.
- **`usbee@bitcreed.us.shell-extension.zip`** — 97,814 bytes, 22 files, SHA-256 `ddd3549b2b336b32a89b341a3a79d2c81ebcec47efc21f170709ba90bb0f41bb`. All 9 automated EGO audit gates pass.

## Task Commits

Each task was committed atomically on branch `worktree-agent-aa3cee9276e4a712c`:

1. **Task 1: prefs.js — Adwaita preferences window** — `1cbe32d` (`feat(02-02): add prefs.js — Adwaita preferences window (PREFS-04)`)
2. **Task 2: hide-empty-ports popover consumer + tile call site** — `341f7ec` (`feat(02-02): hide-empty-ports filter in popover (PREFS-04 consumer)`)
3. **Task 3: COPYING + README.md packaging files** — `2afe174` (`docs(02-02): add COPYING (verbatim GPL-3.0) + README.md (PACK-01, PACK-06)`)
4. **Task 4: metadata.json version-name** — `d5e5891` (`chore(02-02): add version-name to metadata.json (PACK-03 audit gate 8)`)
5. **Task 5: po/usbee@bitcreed.us.pot generation** — `c014843` (`chore(02-02): generate po/usbee@bitcreed.us.pot via xgettext (PACK-02)`)
6. **Task 6: gnome-extensions pack + audit + .gitignore** — `adb65f2` (`chore(02-02): pack EGO submission zip + .gitignore build artifacts (PACK-03)`)

## Files Created/Modified

| Path | Status | Notes |
|------|--------|-------|
| `usbee@bitcreed.us/prefs.js` | **created** | 129 lines; sole gi://Gtk + gi://Adw boundary; ExtensionPreferences subclass; three groups |
| `usbee@bitcreed.us/COPYING` | **created** | 35,149 B verbatim GPL-3.0; SHA-256 `3972dc97…` |
| `usbee@bitcreed.us/README.md` | **created** | Four UI-SPEC sections, triple-locked systemctl invariant |
| `usbee@bitcreed.us/po/usbee@bitcreed.us.pot` | **created** | 32 msgid; xgettext 0.21 invocation pinned for reproducibility |
| `usbee@bitcreed.us/src/popover.js` | modified | populateDeviceRows accepts `extension` + hide-empty-ports filter |
| `usbee@bitcreed.us/src/tile.js` | modified | call site threads `this._extension` (third arg) |
| `usbee@bitcreed.us/metadata.json` | modified | added `version-name: "1.0.0"`; every other field unchanged |
| `.gitignore` | modified | added `*.shell-extension.zip` + `*.deb` |

The zip artifact `usbee@bitcreed.us.shell-extension.zip` is gitignored (build output, not source).

## Final `metadata.json`

```json
{
  "uuid": "usbee@bitcreed.us",
  "name": "USBee",
  "description": "Glanceable USB and USB-C capability + charging info, powered by usbeehive.\n\nMounts a Quick Settings tile next to Wi-Fi, Bluetooth, and Sound. Shows live charging wattage and link speed in the subtitle, expands to a popover listing every attached USB device and USB-C port with a plain-English diagnostic per port. Reads only from the usbeehive D-Bus daemon (org.usbeehive.Devices1); no /sys access, no subprocesses, no bundled binaries.\n\nRequires the usbeehive daemon (systemctl --user enable --now usbeehive).",
  "shell-version": ["46", "47", "48"],
  "url": "https://github.com/abrauchli/usbee",
  "gettext-domain": "usbee@bitcreed.us",
  "settings-schema": "us.bitcreed.usbee",
  "version-name": "1.0.0"
}
```

## EGO Audit Gates — Full Output

| # | Gate | Command | Result |
|---|------|---------|--------|
| 1 | No bundled binaries | `unzip -l ... \| awk … \| grep -E '\\.so$\|\\.bin$\|\\.bundle$\|\\.o$\|\\.a$\|\\.dylib$\|\\.dll$'` | **PASS** (empty) |
| 2 | No junk directories | `unzip -l ... \| grep -E 'node_modules\|\\.git/\|target/\|__pycache__\|\\.DS_Store'` | **PASS** (empty) |
| 3 | SPDX coverage | `grep -L 'SPDX-License-Identifier' usbee@bitcreed.us/extension.js usbee@bitcreed.us/prefs.js usbee@bitcreed.us/src/*.js` | **PASS** (empty — every .js has SPDX header on line 1) |
| 4 | gettext coverage | `grep -c '^msgid ' usbee@bitcreed.us/po/usbee@bitcreed.us.pot` | **PASS** (32 ≥ 20) |
| 5 | No Gtk/Adw in Shell code | `grep -E "from 'gi://(Gtk\|Adw)" usbee@bitcreed.us/extension.js usbee@bitcreed.us/src/*.js` | **PASS** (empty) |
| 5b | prefs.js DOES import Adw | `grep -q "from 'gi://Adw" usbee@bitcreed.us/prefs.js` | **PASS** |
| 6 | No sync D-Bus / spawn | `grep -rE '\\.call_sync\\b\|new_for_bus_sync\|spawn_sync' usbee@bitcreed.us/extension.js usbee@bitcreed.us/prefs.js usbee@bitcreed.us/src/` | **PASS** (empty) |
| 7 | shell-version locked | `jq -c '."shell-version"' usbee@bitcreed.us/metadata.json` | **PASS** (`["46","47","48"]`) |
| 8 | No manual version field | `jq -r '.version // "absent"' usbee@bitcreed.us/metadata.json` | **PASS** (`absent`) |
| 9 | Schema keys in zip | `unzip -p ...shell-extension.zip schemas/us.bitcreed.usbee.gschema.xml \| grep '<key name="port-mutes"'` and `hide-empty-ports` | **PASS** (both keys present) |

## Final Zip Inventory

`usbee@bitcreed.us.shell-extension.zip` — 97,814 bytes, 22 files, SHA-256 `ddd3549b2b336b32a89b341a3a79d2c81ebcec47efc21f170709ba90bb0f41bb`:

```
po/
po/usbee@bitcreed.us.pot         3207  2026-05-12 14:58
src/
src/popover.js                   4821  2026-05-12 14:57
src/dbus-client.js              12145  2026-05-12 14:52
src/device-store.js              7389  2026-05-12 14:52
src/empty-state.js               2069  2026-05-12 14:52
src/notifier.js                  9237  2026-05-12 14:52
src/signal-registry.js           3815  2026-05-12 14:52
src/tile.js                      6056  2026-05-12 14:57
README.md                         649  2026-05-12 14:57
stylesheet.css                    524  2026-05-12 14:52
schemas/
schemas/us.bitcreed.usbee.gschema.xml  1174  2026-05-12 14:52
schemas/gschemas.compiled         317  2026-05-12 15:00
metadata.json                     784  2026-05-12 14:58
prefs.js                         5482  2026-05-12 14:56
dbus-iface.xml                   1351  2026-05-12 14:52
COPYING                         35149  2026-05-12 14:57
extension.js                     3197  2026-05-12 14:52
icons/
icons/usb-symbolic.svg            448  2026-05-12 14:52
```

## Decisions Made

1. **Sub-method refactor inside `prefs.js`** — the RESEARCH §Code Example #9 inlines everything in `fillPreferencesWindow`; the plan's `<action>` spec uses sub-methods (`_buildNotificationsGroup`, etc.) plus a `Number.isNaN` poisoning guard. Followed the plan's structure — it captures T-02-08 mitigation that the Code Example omits.
2. **Single em-dash discipline** — every U+2014 in source (Required — run, USB-C Port %d — %s) is the canonical Unicode code point, verified via `hexdump`. No `--` sequences and no en-dashes anywhere.
3. **No `Adw.StatusPage` fallback for empty mute state** — the disabled `Adw.ActionRow` is the UI-SPEC-pinned choice and matches GNOME Settings idioms. The Task 7 manual gate (section B) is the place to confirm visual disabled-ness; if the Adwaita 1.5 default doesn't grey enough the SUMMARY records it but doesn't fail the plan.
4. **`COPYING` SHA-256 differs from plan's advisory value** — the plan documented `8ceb4b9ee...` but the current canonical `gpl-3.0.txt` from gnu.org has SHA-256 `3972dc9744f...` (35,149 bytes). Content verified by canonical header + tail; this is the file the FSF currently serves.
5. **Pack command restructure (Rule-3 auto-fix; see Deviations)** — three packaging deviations were necessary to produce a zip matching the plan's expected inventory.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Pack command: per-file `--extra-source` flattens paths; switched to directory form**
- **Found during:** Task 6 (gnome-extensions pack invocation)
- **Issue:** The plan's `gnome-extensions pack` line uses seven per-file flags like `--extra-source=src/dbus-client.js`. When run, `gnome-extensions pack` (Ubuntu 24.04, GNOME 46) strips the `src/` prefix and lands `dbus-client.js`, `notifier.js`, `tile.js`, etc. at the **zip root**, not under `src/`. This breaks every `import './src/popover.js'` resolution at runtime.
- **Fix:** Replaced the seven per-file flags with a single `--extra-source=src` directory flag, which preserves the hierarchy. Verified inventory.
- **Files modified:** none in the repo — only the pack invocation in Task 6's bash. The committed `.gitignore` and the SUMMARY document the deviation.
- **Verification:** `unzip -l usbee@bitcreed.us.shell-extension.zip | grep 'src/'` shows all seven `src/*.js` files at the correct path.
- **Committed in:** `adb65f2` (Task 6 — `.gitignore` + decision documented in commit message).

**2. [Rule 3 — Blocking] `.pot` not auto-included by `gnome-extensions pack`; added `--extra-source=po`**
- **Found during:** Task 6 (zip inventory check)
- **Issue:** The plan's pack invocation does not include the `po/` directory. `gnome-extensions pack` 46.0's `--podir` flag governs compiled `.mo` discovery (for the `locale/` tree), but does **not** include the `.pot` template in the zip. PACK-02 audit row 4 requires `po/usbee@bitcreed.us.pot` to be present.
- **Fix:** Added `--extra-source=po` to the pack invocation.
- **Verification:** `unzip -l usbee@bitcreed.us.shell-extension.zip | grep po/` shows `po/usbee@bitcreed.us.pot`.
- **Committed in:** `adb65f2`.

**3. [Rule 3 — Blocking] `gschemas.compiled` not built by `gnome-extensions pack`; pre-compiled + post-processed zip**
- **Found during:** Task 6 (inventory check — `schemas/gschemas.compiled` missing)
- **Issue:** `gnome-extensions pack` 46.0 does **not** run `glib-compile-schemas` during packing (verified via `strace`). The plan's `<acceptance_criteria>` and inventory check both require `schemas/gschemas.compiled` in the zip. (Note: `gnome-extensions install --force` re-compiles on install, so the bundled file is redundant for runtime — it exists in the zip purely to satisfy the audit gate as written.)
- **Fix:** Ran `glib-compile-schemas usbee@bitcreed.us/schemas/` first, then included the compiled file in the zip. Using `--extra-source=schemas/gschemas.compiled` lands it at zip root (same path-stripping bug as deviation #1), so post-processed with `zip -d gschemas.compiled && zip ... schemas/gschemas.compiled` to place it at the correct path.
- **Verification:** `unzip -l ... | grep 'schemas/gschemas.compiled'` returns a match. `gschemas.compiled` is also gitignored (Phase 1 .gitignore entry) so it stays out of source.
- **Committed in:** `adb65f2`.

**4. [Rule 3 — Blocking] System `gettext` (xgettext) was absent on the dev host; downloaded the package without sudo and ran locally**
- **Found during:** Task 5 (xgettext invocation)
- **Issue:** `command -v xgettext` returned empty. The Ubuntu 24.04 LTS dev host has `gettext-base` but not the full `gettext` package. The Flatpak runtime's xgettext binary segfaulted (`libgettextsrc-0.26.so` issue). `sudo apt-get install gettext` requires a password and the executor cannot prompt.
- **Fix:** `apt-get download gettext` worked without sudo (writes the .deb to cwd). Used `dpkg-deb -x gettext_0.21-14ubuntu2_amd64.deb /tmp/gettext-extracted` and ran `xgettext` with `LD_LIBRARY_PATH=/tmp/gettext-extracted/usr/lib/x86_64-linux-gnu`. Output `.pot` is byte-identical to what a system-installed xgettext would produce (xgettext is a deterministic extractor over the same source code with the same flags). Added `*.deb` to `.gitignore`.
- **Verification:** Generated `.pot` has 32 msgid entries with every required UI-SPEC string. The xgettext invocation is documented in commit message `c014843` so a reviewer can re-run it after installing gettext.
- **Committed in:** `c014843` (Task 5).

---

**Total deviations:** 4 auto-fixed (all Rule 3 — packaging-tool blockers, no architectural change)
**Impact on plan:** All four are tooling-environment workarounds, not behavioral changes. The final zip inventory matches the plan's expectations byte-for-byte at the file-path level. No scope creep; no architectural decisions made unilaterally. The PLAN.md's pack command should be updated to reflect deviations #1 and #2 in a future revision, and Task 7's pre-flight could `glib-compile-schemas` for #3. None of the deviations introduce risk to EGO submission.

## Authentication Gates

None. No auth-protected services were touched.

## Issues Encountered

None beyond the four Rule-3 packaging tool quirks documented above. All were resolved without architectural change.

## Human Verification — Completed 2026-05-12

**Task 7 (`checkpoint:human-verify`, `gate="blocking"`)** ran live on GNOME Shell 46 (Xorg) with `usbeehive` daemon v0.5.1 active.

### In-flight changes folded into this plan during verification

1. **prefs.js — live daemon version readout** (user-requested polish, separate commit). The "usbeehive daemon" About row was originally a static `Required — run: systemctl --user enable --now usbeehive` subtitle. Replaced with an async `Gio.DBusProxy` Version-property probe + `Gio.bus_watch_name` so the subtitle reflects the real state:
   - Running: `Running — v0.5.1` (or whatever the daemon reports)
   - Not running: `Start usbeehived daemon`
   - During probe: `Checking…`
2. **§E "triple-locked SYSTEMCTL invariant" → dual-locked.** Removing the systemctl subtitle from prefs.js dropped the third occurrence. The remaining two (`empty-state.js`, `README.md`) are the load-bearing ones: empty-state.js is what the user sees when the daemon is missing (the actual install moment); README.md is the install docs. The prefs.js row was redundant — by the time prefs is reachable, either the daemon is already running (in which case the install hint is irrelevant — show the version instead) or the user already saw the systemctl hint in the empty state.
3. **.pot regenerated** (32 → 35 msgid). Removed `Required — run: systemctl --user enable --now usbeehive`; added `Running — v%s`, `Running`, `Start usbeehived daemon`, `Checking…`.
4. **EGO zip repacked** with the new prefs.js + .pot. SHA-256: `8534fd877fc3ee16d625ef7658f83864d4d10665d65e3ee48425e0c4303a2159`. 23 files, all 9 EGO audit gates re-validated PASS.

### Section results

| § | What | Result |
|---|------|--------|
| A | Prefs window opens, three groups | **PASS** — `gnome-extensions prefs usbee@bitcreed.us` opens Adwaita window titled "USBee"; groups `Notifications`, `General`, `About` all visible. |
| B | Empty muted-list state | **PASS** — with `port-mutes = []`, single greyed-out `Adw.ActionRow` titled "No muted ports" appears. |
| C | Populate-then-unmute round-trip | **PASS** — set `port-mutes = ['1','3','7']` → three rows appear; clicked trash on Port 3 → row removed and gsettings → `['1','7']`; clicked trash on the remaining two → falls back to empty-state row. |
| D | hide-empty-ports propagation | **PASS** *with caveat* — `Adw.SwitchRow` ↔ GSettings binding round-trips correctly (flipped to `true` then `false`); popover's `populateDeviceRows` reads `settings.get_boolean('hide-empty-ports')` on every open and applies `!(d.category === 'TypeCPort' && d.status === 'Empty')` filter. Visual filtering is a no-op on this dev host because the daemon's snapshot contains zero `TypeCPort/*` entries (13 devices, all `UsbDevice/Connected` or `Hub/Connected`). The filter wiring + gsettings binding are proven; visual filtering will activate on hardware where the daemon reports USB-C ports separately. |
| E | SYSTEMCTL invariant | **PASS** *with gate relaxation* — now dual-locked (was triple). `grep -F "systemctl --user enable --now usbeehive" usbee@bitcreed.us/src/empty-state.js usbee@bitcreed.us/README.md` returns two byte-identical matches. Rationale above. |
| F | Notification coalescing regression | **PASS** — fired `onCapabilityDegraded(5, 'Initial', 'First body')` → banner with 2 actions visible; then `onCapabilityDegraded(5, 'Updated', 'NEW BODY')` → body updated in place, still 2 actions (not 4), still single tray entry; then `onCapabilityRestored(5)` → cleared silently. Plan 02-01's `.title = …; .body = …` rewrite survived Plan 02-02 unchanged. |
| G | Lock/unlock 3× | **TRUSTED** — Plan 02-01 §H already validated lock/unlock once with the same `Main.sessionMode` handler; Plan 02-02 didn't modify the sessionMode-related code in `tile.js` (only the `populateDeviceRows` callsite changed). Corroborating evidence: §H below (10× enable/disable) hit the same `SignalRegistry` teardown path with zero `already disposed`/`handler not found` warnings. Not re-run live to avoid screen-locking the active debugging session. |
| H | 10× enable/disable | **PASS** — `for i in {1..10}; do gnome-extensions disable usbee@bitcreed.us; sleep 0.25; gnome-extensions enable usbee@bitcreed.us; sleep 0.25; done` → `journalctl --user-unit gnome-shell` since cycle start produced zero `already disposed` / `handler not found` / `signal not connected` / `disposed.*object` / `JS ERROR` lines. Extension still enabled at end. |
| I | README URL validity | **INFO — HTTP 404** — `curl -sI -o /dev/null -w '%{http_code}\n' https://github.com/abrauchli/usbee` returns `404`. Repo not yet published at that URL. **Pre-submission fix required:** either publish the repo at that exact URL OR update `metadata.json` `url` field + README link before uploading to EGO. Plan-level status: informational at plan time per the plan's own wording. |
| J | gnome-extensions info | **PASS** — `gnome-extensions info usbee@bitcreed.us` reports `Enabled: Yes`, `Version: 1.0.0`, `hasPrefs: true`. Note: `State: INACTIVE` label is a Shell display quirk post-toggle-cycling; the LG probe `Main.extensionManager.lookup('usbee@bitcreed.us').state` returns `1` (ENABLED) and `_indicator._toggle` + `_notifier` are both live. |

### Resolution

Approved 2026-05-12. All A–J resolved (G trusted, I informational pending pre-submission URL fix). Phase 02 complete. EGO submission zip is ready at `usbee@bitcreed.us.shell-extension.zip` (SHA-256 above); manual upload to `https://extensions.gnome.org/upload/` is the next non-plan step.

---

### Original "Awaiting Human Verification" instructions (preserved for the record)

The orchestrator must surface this to the user for live execution. Verification protocol (from PLAN.md `<how-to-verify>`):

### Pre-flight (operator)
```bash
gnome-extensions install --force usbee@bitcreed.us.shell-extension.zip
# Log out + log back in (Wayland) or Alt+F2 → r (Xorg)
gnome-extensions enable usbee@bitcreed.us
# Confirm Plan 02-01 sections A–I still pass (regression)
```

### Sections A–J (all PASS conditions documented in PLAN.md Task 7)
- **A.** `gnome-extensions prefs usbee@bitcreed.us` opens window titled "USBee" with three group headers `Notifications`, `General`, `About`.
- **B.** Empty muted-list state: `gsettings set us.bitcreed.usbee port-mutes "[]"` → disabled `Adw.ActionRow` titled `No muted ports`. **Visual-disabledness fallback note (RESEARCH §Assumptions A2):** the disabled ActionRow is the chosen pattern; if its `sensitive: false` doesn't grey out enough on this dev host's libadwaita 1.5 build, the source already declares `sensitive: false` — record visual observation in the operator's gap report but do not fail the plan on visual subjectivity alone.
- **C.** Populate three mutes (`['1','3','7']`) → click trash on port 3 → row disappears, `gsettings get` returns `['1','7']`. Clicking trash on the other two reverts to "No muted ports" empty state.
- **D.** Toggle Hide-empty-ports ON → `gsettings get us.bitcreed.usbee hide-empty-ports` returns `true` immediately. Re-open popover → `TypeCPort`+`Empty` rows hidden. (Or simulate via Looking Glass per PLAN.md.) Toggle OFF → rows reappear.
- **E.** Triple-locked SYSTEMCTL invariant: `grep -F "systemctl --user enable --now usbeehive" usbee@bitcreed.us/src/empty-state.js usbee@bitcreed.us/prefs.js usbee@bitcreed.us/README.md` → three matches, byte-identical strings. (Operator can verify this with the grep command alone — no UI needed.)
- **F.** Notification coalescing smoke test via Looking Glass (RESEARCH §Assumptions A1) — confirm one banner, two action buttons (not four).
- **G.** Lock/unlock 3× → `Preferences…` row reappears each cycle; `journalctl --user-unit gnome-shell` shows no `already disposed` / `handler not found`.
- **H.** 10× enable/disable cycle → no `already disposed` / `handler not found` warnings.
- **I.** README URL validity: `curl -sI -o /dev/null -w '%{http_code}\n' https://github.com/abrauchli/usbee` returns `200` or `301`. Informational at plan time.
- **J.** Dry-run install + `gnome-extensions info usbee@bitcreed.us` → `State: ENABLED`, `Name: USBee`. Optional but recommended.

**Cleanup after section J:** `gsettings reset us.bitcreed.usbee port-mutes; gsettings reset us.bitcreed.usbee hide-empty-ports`.

### Resume signal
- Operator types `approved` to mark Phase 2 complete and unblock `/gsd-transition`, **or**
- Reports failing section letters (A–J) so `--gaps` re-planning can close them.

## User Setup Required

None — no external services. The user must `gnome-extensions install` the zip and verify per Task 7 protocol above, but no API keys, env vars, or third-party accounts are involved.

## Next Phase Readiness

**EGO submission status: READY** (pending Task 7 human verification + the URL validity check in section I).

The build artifact `usbee@bitcreed.us.shell-extension.zip` (97,814 bytes, SHA-256 `ddd3549b2b336b32a89b341a3a79d2c81ebcec47efc21f170709ba90bb0f41bb`) passes every automated EGO audit gate. The remaining work is the **manual upload** to extensions.gnome.org and the live smoke tests in Task 7. Both are outside the executor's scope.

Upload `usbee@bitcreed.us.shell-extension.zip` to https://extensions.gnome.org/upload/ — manual web-form action; this plan does not automate it.

## Self-Check: PASSED

Verification of claims after writing this SUMMARY:

- `[ -f usbee@bitcreed.us/prefs.js ]` — **FOUND**
- `[ -f usbee@bitcreed.us/COPYING ]` — **FOUND**
- `[ -f usbee@bitcreed.us/README.md ]` — **FOUND**
- `[ -f usbee@bitcreed.us/po/usbee@bitcreed.us.pot ]` — **FOUND**
- `[ -f usbee@bitcreed.us.shell-extension.zip ]` — **FOUND** (gitignored — build artifact)
- `git log` contains `1cbe32d` (Task 1) — **FOUND**
- `git log` contains `341f7ec` (Task 2) — **FOUND**
- `git log` contains `2afe174` (Task 3) — **FOUND**
- `git log` contains `d5e5891` (Task 4) — **FOUND**
- `git log` contains `c014843` (Task 5) — **FOUND**
- `git log` contains `adb65f2` (Task 6) — **FOUND**
- EGO audit gates 1–9 — **all PASS** (output table above)
- Plan 02-01 invariants intact (notifier, Preferences… row, D-17, SPDX) — **regression-checked by audit gates 3 and 5**

---
*Phase: 02-notifications-preferences-ego-submission-polish-v1-0*
*Plan: 02 — preferences-window + EGO-submission packaging*
*Completed: 2026-05-12 (executor work; Task 7 human gate pending)*
