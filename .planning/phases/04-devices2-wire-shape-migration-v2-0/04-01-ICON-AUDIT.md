# Adwaita Symbolic Icon Audit for `device_class` (Plan 04-01)

**Status:** Verified (2026-05-14)
**Phase:** 04 — Devices2 wire-shape migration (v2.0)
**Scope:** The `device_class` → Adwaita symbolic icon mapping that Plan
04-02 wires into `device-icon.js::iconForDevice`. Every icon name below
is verified against `/usr/share/icons/Adwaita/symbolic/devices/` and the
`/usr/share/icons/Adwaita/symbolic/legacy/` fallback during the Plan
04-01 audit pass.

Every icon name matches `SYMBOLIC_ICON_RE` — `/^[a-z0-9][a-z0-9-]*-symbolic$/`
— the defensive guard T-03-01 retains in v2.0 (`device-icon.js:23`). The
audit is deliberately conservative: when no perfect Adwaita match exists
(e.g. `SecurityKey`), the closest semantic match is chosen over inventing
a name that would silently render as the missing-icon glyph.

## device_class → icon table (all 19 daemon variants)

| device_class | icon | location |
|---|---|---|
| Keyboard | input-keyboard-symbolic | devices/ |
| Mouse | input-mouse-symbolic | devices/ |
| Storage | drive-harddisk-usb-symbolic | devices/ |
| Display | video-display-symbolic | devices/ |
| Audio | audio-card-symbolic | devices/ |
| Camera | camera-web-symbolic | devices/ |
| Printer | printer-symbolic | devices/ |
| Phone | phone-symbolic | devices/ |
| Hub | drive-removable-media-symbolic | devices/ — chosen for visual consistency with the v1.1 hub fallback |
| NetworkWired | network-wired-symbolic | devices/ |
| NetworkWireless | network-wireless-symbolic | devices/ |
| InputTablet | input-tablet-symbolic | devices/ |
| Gamepad | input-gaming-symbolic | devices/ |
| SecurityKey | auth-fingerprint-symbolic | devices/ — closest semantic match; no `security-key-symbolic` ships in Adwaita |
| SmartcardReader | auth-smartcard-symbolic | devices/ |
| Bluetooth | bluetooth-symbolic | devices/ |
| Serial | utilities-terminal-symbolic | legacy/ — pragmatic pick for "serial console" semantics |
| VideoCapture | camera-video-symbolic | devices/ — distinct from Camera (`camera-web-symbolic`) |
| Unknown | drive-removable-media-symbolic | devices/ — generic USB icon, matches v1.1 fallback at `device-icon.js:71` |

## Verification protocol

Run the following one-liner on any GNOME 46+ host to re-verify icon
presence after a theme update or distro upgrade. Exit code is always 0 —
missing icons print `MISSING: <name>-symbolic` to stdout (the loop is
informational, not assertive):

```bash
for icon in input-keyboard input-mouse drive-harddisk-usb video-display \
            audio-card camera-web printer phone drive-removable-media \
            network-wired network-wireless input-tablet input-gaming \
            auth-fingerprint auth-smartcard bluetooth utilities-terminal \
            camera-video; do
    test -f /usr/share/icons/Adwaita/symbolic/devices/${icon}-symbolic.svg || \
    test -f /usr/share/icons/Adwaita/symbolic/legacy/${icon}-symbolic.svg || \
    echo "MISSING: ${icon}-symbolic"
done
```

If any icon prints `MISSING`, the corresponding `device_class` variant
will fall through to the default `drive-removable-media-symbolic` per the
fallback chain below. The user-visible impact is "wrong icon", never a
broken render — `SYMBOLIC_ICON_RE` plus the default-fallback guarantees
that `St.Icon.icon_name` always receives a syntactically valid theme name.

## Fallback chain

Plan 04-02 wires `device-icon.js::iconForDevice(device)` to resolve the
icon name in this exact order. Each step is a hard early-return; control
only reaches step N+1 if step N produced no match.

1. **Daemon-supplied `device.icon`** — accept only if it passes
   `SYMBOLIC_ICON_RE` (T-03-01 preserved from v1.1; rejects shell
   metacharacters, absolute paths, and mixed-case names). This is the
   "daemon says exactly what icon to use" path; the daemon's curation
   wins over USBee's enum table when both exist.

2. **Category shortcut** — if `category === 'TypeCPort'`, return
   `drive-removable-media-symbolic` directly. Type-C ports have
   `device_class === 'Unknown'` per CONTEXT D-2.0-02 (the daemon does
   not classify the port itself, only attached devices), so without
   this shortcut every empty Type-C port would render via the Unknown
   row — same visual outcome, but the shortcut keeps the intent
   explicit and matches the v1.1 behaviour the user has already
   internalised.

3. **`device_class` enum lookup** against the table above. Direct
   `Map.get(device.device_class)` — no substring scan, no keyword
   matching. The daemon's enum is the source of truth.

4. **Default fallback** — `drive-removable-media-symbolic`. Covers any
   future enum variant the daemon adds before USBee learns about it
   (WIRE-04 forward-compat). The same icon as Unknown by design — an
   unrecognised future variant is, by definition, unknown to USBee.

This fallback chain is verifiable by a unit-style assertion in Plan 04-02
(WIRE-04 forward-compat test): pass `iconForDevice({device_class: 'NotARealVariant'})`
and assert the result is `drive-removable-media-symbolic` (NOT a thrown
error, NOT an empty string).
