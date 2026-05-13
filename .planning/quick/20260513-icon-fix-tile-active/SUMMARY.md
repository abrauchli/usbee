---
quick_id: 260513-jr8
slug: icon-fix-tile-active
date: 2026-05-13
status: complete
commits:
  - be57294
  - 7d7c178
---

# Summary: Fix missing icons + active tile state

## What was fixed

**BUG 1 — Missing device icons (device-icon.js)**

Root cause: `network-usb-symbolic` does not exist in Adwaita. It was used as
the fallback and as the Hub/TypeCPort category shortcut, causing every affected
device row to show the broken placeholder icon.

Changes:
- `drive-removable-media-symbolic` is now the fallback and Hub/TypeCPort shortcut
- KEYWORD_MAP extended with 5 new Adwaita-verified mappings:
  - `input-gaming-symbolic` ← gamepad/joystick/controller/deck
  - `input-tablet-symbolic` ← tablet/wacom
  - `network-wired-symbolic` ← lan/ethernet/gigabit
  - `video-display-symbolic` ← monitor/display/screen/projector/tv
  - `scanner-symbolic` ← scanner

**BUG 2 — Tile never shows blue/active (tile.js)**

Root cause: `this.checked` was never set, so the tile was always gray even when
usbeehived was running. `toggleMode: false` is correct (clicking opens the menu)
but `checked` needed to mirror `store.daemonRunning` for the visual active state.

Changes:
- `this.checked = store.daemonRunning` set on construction
- Updated in `store.connect('changed', ...)` handler on every state change
- `iconName` and `setHeader` also updated to `drive-removable-media-symbolic`

## Result

- EGO zip repacked at v1.1.0, reinstalled via `gnome-extensions install --force`
- Requires GNOME Shell restart (log out/in or Alt+F2 → r on Xorg) to take effect
