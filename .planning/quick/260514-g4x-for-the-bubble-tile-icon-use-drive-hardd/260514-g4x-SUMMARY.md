---
quick_id: 260514-g4x
slug: for-the-bubble-tile-icon-use-drive-hardd
description: For the bubble-tile icon use drive-harddisk-usb-symbolic instead of the shipped one
date: 2026-05-14
status: complete
commit: a2bc54c
---

# Quick Task 260514-g4x Summary

## What was done

Replaced the bundled `usb-symbolic.svg` (loaded via `Gio.icon_new_for_string`) with
the system theme icon `drive-harddisk-usb-symbolic` using `iconName` on the
`QuickMenuToggle` super-call in `src/tile.js`.

Also removed the now-unused `import Gio from 'gi://Gio'` import.

## Files changed

- `usbee@bitcreed.us/src/tile.js` — removed `usbGicon` / `Gio.FileIcon` path;
  replaced `gicon: usbGicon` with `iconName: 'drive-harddisk-usb-symbolic'`;
  dropped unused `Gio` import.

## Commit

`a2bc54c` feat(tile): switch bubble-tile icon to drive-harddisk-usb-symbolic
