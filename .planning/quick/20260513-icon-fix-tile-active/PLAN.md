---
quick_id: 260513-jr8
slug: icon-fix-tile-active
date: 2026-05-13
description: Fix missing device icons (network-usb-symbolic doesn't exist in Adwaita) and make tile show blue when daemon is running
files_modified:
  - usbee@bitcreed.us/src/device-icon.js
  - usbee@bitcreed.us/src/tile.js
---

# Quick Task: Fix missing icons + active tile state

## Tasks

1. Fix `device-icon.js`: replace `network-usb-symbolic` (not in Adwaita) with `drive-removable-media-symbolic`; extend KEYWORD_MAP with LAN, display, gaming, tablet, scanner mappings
2. Fix `tile.js`: replace `network-usb-symbolic` with `drive-removable-media-symbolic`; add `this.checked = store.daemonRunning` for active state
3. Repack EGO zip + reinstall extension
