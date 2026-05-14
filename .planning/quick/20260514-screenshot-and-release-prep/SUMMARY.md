---
slug: screenshot-and-release-prep
status: complete
completed: 2026-05-14
commit: 8ea3c50
---

# Summary: Add screenshot and prepare v2.0.0 release

## What was done

1. Added "Screenshot" section to README.md with `usbee-quick-settings-panel-device-list.png`
2. Fixed status line in README to say v2.0.0 (was still showing v1.2.0)
3. Committed screenshot + README (`8ea3c50`)
4. Deleted local v2.0.0 tag (pointed to older i18n commit) and recreated at HEAD
5. Pushed `master` (64 commits ahead) and `v2.0.0` tag to origin
6. GitHub release workflow will trigger from the tag push
