---
quick_id: 260514-mq0
slug: fix-ego-shexli-lint
status: complete
date: 2026-05-14
commit: 3172694
---

# Summary: Fix EGO shexli Lint Errors

## What was done
Fixed all 3 findings from `shexli` EGO pre-submission linter:

**EGO-P-001 / EGO-P-002** (schema id and path namespace):
- Renamed `schemas/us.bitcreed.usbee.gschema.xml` → `schemas/org.gnome.shell.extensions.usbee.gschema.xml`
- Updated `<schema id=...>` from `us.bitcreed.usbee` → `org.gnome.shell.extensions.usbee`
- Updated `path=...` from `/us/bitcreed/usbee/` → `/org/gnome/shell/extensions/usbee/`
- Updated `metadata.json` `settings-schema` to match
- Updated comment in `src/notifier.js`

**EGO-P-007** (unreachable JS file in zip):
- Moved `usbee@bitcreed.us/src/forward-compat.test.js` → `tests/forward-compat.test.js`
- Test file is now outside the extension directory and will not be included in `gnome-extensions pack` output

## Commit
`3172694` — fix(ego): rename GSettings schema to org.gnome.shell.extensions namespace
