---
quick_id: 260526-i7q
type: summary
status: complete
completed: 2026-05-26
commits:
  - hash: 4b8c7bb
    type: feat
    scope: empty-state
    subject: three-way daemon-state hints (install/start/update)
  - hash: dec4dbb
    type: fix
    scope: prefs
    subject: shorten notify-changes ComboRow item labels
files_changed:
  - usbee@bitcreed.us/src/empty-state.js
  - usbee@bitcreed.us/src/popover.js
  - usbee@bitcreed.us/src/tile.js
  - usbee@bitcreed.us/prefs.js
---

# Quick Task 260526-i7q: Daemon Status Hints + Shorter Notify-Changes Label

One-liner: split the popover empty-state into three daemon-state flavours (not-installed / not-running / out-of-date) with accurate copy-pasteable commands, and shorten the prefs ComboRow labels so they no longer ellipsize at default window width.

## What landed

### Commit 1 — `4b8c7bb` `feat(empty-state): three-way daemon-state hints (install/start/update)`

Files: `usbee@bitcreed.us/src/empty-state.js`, `usbee@bitcreed.us/src/popover.js`, `usbee@bitcreed.us/src/tile.js`.

- **`empty-state.js`**
  - Added `isUsbeehiveServiceInstalled()` — synchronous `Gio.File.query_exists()` probe against the three standard systemd user-unit search paths (`$XDG_DATA_DIR/systemd/user`, `/usr/lib/systemd/user`, `/etc/systemd/user`), with a 30-second module-level cache so rapid popover open/close cycles don't repeatedly stat the filesystem.
  - Added `invalidateInstalledCache()` — exported but not yet consumed, kept symmetric for a future NameOwnerChanged hook.
  - Added `buildDaemonNotInstalledItem()` — mirrors the existing builder shape with title `'usbeehive not installed'`, hint `'Install usbeehive, then start it. This list will populate automatically:'`, and a read-only-but-selectable `St.Entry` containing the literal `usbeehived --install-service`.
  - Updated `buildDaemonOutOfDateItem()` — entry now contains `cargo install usbeehive --features=dbus` (the actual update command, what the user asked for) rather than `systemctl --user restart usbeehived`. Hint reworded to keep the "restart the daemon" reminder in prose: `'Update usbeehive, then restart the daemon. This list will populate automatically:'`. The old per-function `RESTART_CMD` constant was removed in favour of module-level `INSTALL_CMD` / `UPDATE_CMD` (alongside the existing `SYSTEMCTL_CMD`).
  - File-header comment rewritten to describe the three flavours.

- **`popover.js`**
  - Imported `buildDaemonNotInstalledItem` alongside the existing `buildEmptyStateItem` / `buildDaemonOutOfDateItem`.
  - Added `populateNotInstalledState(section)` — sibling of `populateEmptyState` / `populateOutOfDateState`.

- **`tile.js`**
  - Imported `populateNotInstalledState` from `./popover.js` and `isUsbeehiveServiceInstalled` from `./empty-state.js`.
  - Replaced the two-way routing chain in `_rebuildPopover()` with a three-way chain:
    1. `_daemonTooOld` → `populateOutOfDateState` (unchanged; highest precedence — daemon IS reachable, version known)
    2. `!daemonRunning` →
       - `!isUsbeehiveServiceInstalled()` → `populateNotInstalledState`
       - else → `populateEmptyState` (existing path)
    3. else → `populateDeviceRows`
  - Comment block above the routing now documents the precedence rationale.

### Commit 2 — `dec4dbb` `fix(prefs): shorten notify-changes ComboRow item labels`

Files: `usbee@bitcreed.us/prefs.js`.

- Shortened the three `scopeChoices` display labels in `_buildGeneralGroup()`:
  - `'all'`   → `_('All device changes')`        (was: `_('Notify on all device changes')`)
  - `'power'` → `_('Charging-relevant only')`    (was: `_('Notify only on charging-relevant changes')`)
  - `'off'`   → `_('Off')`                       (was: `_('Do not notify on device changes')`)
- GSettings value strings (`'all'`, `'power'`, `'off'`) unchanged — schema XML is untouched.
- Inline comment explains the rationale (row title + subtitle carry the "Notify..." verb context, so the option strings can drop the prefix).

## Verification

| Check | Result |
|-------|--------|
| `node --check src/empty-state.js` | OK |
| `node --check src/popover.js` | OK |
| `node --check src/tile.js` | OK |
| `node --check prefs.js` | OK |
| `grep -c "All device changes\|Charging-relevant only" prefs.js` | 2 (both new labels present) |
| Two atomic commits, one per task | OK |
| No `.planning/` files in either commit | OK |
| All new user-visible strings wrapped in `gettext as _()` | OK |
| No subprocess spawning, no synchronous D-Bus calls | OK (Gio.File.query_exists is local stat()) |
| GSettings schema XML unchanged | OK |

Human verification (per plan `<human-check>`) is unchanged — stop the daemon and confirm each of the three empty states renders with the correct command; open prefs and confirm the ComboRow no longer ellipsizes. Not executed here (no running GNOME shell in this worktree).

## Deviations

None. The plan called out that Task 1 also touches `popover.js` even though the frontmatter `files_modified` undercounts; that note was correct and the change went in cleanly. Existing symbol names (`RESTART_CMD`, `SYSTEMCTL_CMD`, `_daemonTooOld`, `populateEmptyState`, `populateOutOfDateState`, `buildDaemonOutOfDateItem`) all matched the plan's description. The old per-function `RESTART_CMD` constant was deleted (not just rewritten) because its sole consumer was the line we rewrote — no other call sites referenced it. New module-level `INSTALL_CMD` / `UPDATE_CMD` constants mirror the existing `SYSTEMCTL_CMD` pattern.

## Self-Check: PASSED

- `usbee@bitcreed.us/src/empty-state.js` FOUND, contains `buildDaemonNotInstalledItem` and `isUsbeehiveServiceInstalled`.
- `usbee@bitcreed.us/src/popover.js` FOUND, contains `populateNotInstalledState`.
- `usbee@bitcreed.us/src/tile.js` FOUND, three-way routing in `_rebuildPopover` present.
- `usbee@bitcreed.us/prefs.js` FOUND, contains `All device changes` and `Charging-relevant only`.
- Commit `4b8c7bb` exists on `worktree-agent-ac426fea19d4e8981`.
- Commit `dec4dbb` exists on `worktree-agent-ac426fea19d4e8981`.
