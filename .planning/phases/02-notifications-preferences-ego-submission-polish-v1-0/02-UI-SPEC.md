---
phase: 2
slug: notifications-preferences-ego-submission-polish-v1-0
status: draft
shadcn_initialized: false
preset: none
created: 2026-05-12
---

# Phase 2 — UI Design Contract

> Visual and interaction contract for the three new user-visible surfaces Phase 2 introduces on top of Phase 1's tile + popover:
>
> 1. **Degraded-port notification** raised on `CapabilityDegraded` from `org.usbeehive.Devices1` (Shell-process surface — `MessageTray.Source` + `MessageTray.Notification`).
> 2. **Adwaita preferences window** for managing muted ports and the "hide empty ports" toggle (separate process — `prefs.js` using GTK4 + libadwaita 1.5+).
> 3. **STATE-04 lock-screen safety** — hide the tile's "Preferences" menu item when `Main.sessionMode.allowSettings === false` (behavior contract on the existing Phase 1 tile; one new menu row, not a new screen).
>
> **Source of truth for design tokens (Shell surface):** GNOME Shell's stock Adwaita stylesheet at `resource:///org/gnome/shell/theme/gnome-shell.css`. **Source of truth for prefs window:** libadwaita's `Adw.PreferencesPage` / `Adw.PreferencesGroup` / `Adw.ActionRow` / `Adw.SwitchRow` defaults — USBee adds **zero** custom CSS in `prefs.js`. Both surfaces inherit theme switching for free.
>
> **Continuity with Phase 1:** every token declared in Phase 1's UI-SPEC (`01-UI-SPEC.md` §Spacing, §Typography, §Color) is inherited unchanged. Phase 2 declares **only the additions** required by NOTIF-* / PREFS-* / STATE-04 / PACK-01..03 / PACK-06.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (Shell extension — design system is the host) |
| Preset | not applicable |
| Component library (Shell process) | `MessageTray.Source`, `MessageTray.Notification` (`resource:///org/gnome/shell/ui/messageTray.js`) + Phase 1's `PopupMenu` / `QuickSettings` primitives |
| Component library (prefs process) | libadwaita 1.5+ via GObject Introspection: `Adw.PreferencesWindow`, `Adw.PreferencesPage`, `Adw.PreferencesGroup`, `Adw.ActionRow`, `Adw.SwitchRow`, `Adw.ButtonRow`, `Adw.StatusPage`. GTK4 4.14+ for low-level imports only. |
| Icon library | Adwaita symbolic icon set (system-provided). Specific icons used: `network-usb-symbolic` (notification + prefs window), `dialog-warning-symbolic` (notification urgency hint, optional), `user-trash-symbolic` (unmute row trailing icon). **No bundled icons.** |
| Font | Cantarell (system default for both surfaces; do not override). Notification body and prefs rows inherit it. |

**Rationale (locked by CLAUDE.md "Hard constraints" + Phase 1 D-17 + EGO review rule):** the Shell-process code (`extension.js`, `src/*.js`, including the new `src/notifier.js` and the STATE-04 menu-row addition) **must not** import `Gtk` or `Adw`. The Adwaita preferences window lives entirely inside `prefs.js`, which runs in the separate `gnome-shell-extension-prefs` process — that file is the **only** place GTK / libadwaita imports are permitted in this repo.

**No shadcn / no Tailwind / no npm / no cargo / no bundled binaries:** Phase 2, like Phase 1, ships zero external packages. The deliverable is the same flat zip produced by `gnome-extensions pack`, now with `prefs.js`, `COPYING`, `README.md`, and `po/usbee@bitcreed.us.pot` added.

---

## Component Inventory (Phase 2 additions)

Anchor: `<a id="component-inventory"></a>`

Every visible widget Phase 2 adds, with exact class, parent file, and styling source. Phase 1 widgets are inherited unchanged from `01-UI-SPEC.md` §Component Inventory.

### Shell-process additions (`src/notifier.js`, `src/tile.js` patch)

| Widget | Exact class | Defined in | Styling source |
|--------|-------------|------------|----------------|
| Notification source (one per extension lifetime) | `MessageTray.Source` subclass `USBeeNotifier` — created lazily on first `CapabilityDegraded`, added via `Main.messageTray.add(source)` | `src/notifier.js` → `USBeeNotifier` | Stock MessageTray styling (theme-driven; no custom CSS) |
| Degraded-port notification | `MessageTray.Notification({source, title, body, gicon: Gio.ThemedIcon.new('network-usb-symbolic')})` — one per port, re-emitted with same `notification` instance to coalesce | `src/notifier.js` → `emitDegraded(portNumber, summary, detail)` | Stock MessageTray notification styling |
| Notification action "Don't notify for this port again" | `notification.addAction(_('Don't notify for this port again'), () => this._muteByPort(portNumber))` | `src/notifier.js` | Stock notification-action button |
| Notification action "Open Preferences" *(optional secondary)* | `notification.addAction(_('Open Preferences'), () => extension.openPreferences())` | `src/notifier.js` | Stock notification-action button |
| Tile "Preferences" menu row | `PopupMenu.PopupMenuItem(_('Preferences…'))` appended **after** the device-list section, **before** the Phase 1 menu's footer (which doesn't exist yet — append last) | `src/tile.js` `_buildStaticMenu()` patch | Stock `.popup-menu-item` |
| Tile "Preferences" menu separator | `PopupMenu.PopupSeparatorMenuItem()` immediately above the Preferences row | `src/tile.js` | Stock `.popup-separator-menu-item` |

### Prefs-process additions (`prefs.js`)

| Widget | Exact class | Defined in | Styling source |
|--------|-------------|------------|----------------|
| Preferences window | `Adw.PreferencesWindow` (returned from `fillPreferencesWindow(window)`) | `prefs.js` → `USBeePrefs.fillPreferencesWindow` | libadwaita default (theme-driven) |
| Preferences page (single) | `Adw.PreferencesPage({title: _('General'), icon_name: 'network-usb-symbolic'})` | `prefs.js` | libadwaita default |
| Group 1: General | `Adw.PreferencesGroup({title: _('General')})` | `prefs.js` | libadwaita default |
| "Hide empty USB-C ports" toggle | `Adw.SwitchRow({title: _('Hide empty USB-C ports'), subtitle: _('Don't list ports with nothing attached')})` — bound to GSettings key `hide-empty-ports` via `settings.bind('hide-empty-ports', row, 'active', Gio.SettingsBindFlags.DEFAULT)` | `prefs.js` | libadwaita default |
| Group 2: Notifications | `Adw.PreferencesGroup({title: _('Notifications'), description: _('Manage which USB-C ports may raise degradation warnings')})` | `prefs.js` | libadwaita default |
| Muted ports list — empty state | `Adw.StatusPage({icon_name: 'object-select-symbolic', title: _('No muted ports'), description: _('Ports muted from a notification will appear here'), vexpand: false})` shown when `port-mutes` is empty (embedded inside the group, not a full-window state) — alternative: omit the group's body and show `Adw.ActionRow({title: _('No muted ports'), sensitive: false})` for visual continuity with libadwaita prefs idiom (Bluetooth / Wi-Fi prefs use this pattern). **Decision: use the disabled `Adw.ActionRow`** — it matches GNOME Settings idiom better than a full `Adw.StatusPage` inside a group. |
| Muted port row | `Adw.ActionRow({title: _('USB-C Port %d').format(portNumber), subtitle: _('Notifications muted')})` with a trailing `Gtk.Button({icon_name: 'user-trash-symbolic', tooltip_text: _('Unmute this port'), valign: Gtk.Align.CENTER, css_classes: ['flat', 'destructive-action']})` — one row per stringified-int in `port-mutes` | `prefs.js` → `_rebuildMutedRows()` | libadwaita default + Gtk button `destructive-action` style class |
| Group 3: About | `Adw.PreferencesGroup({title: _('About')})` | `prefs.js` | libadwaita default |
| About: version | `Adw.ActionRow({title: _('Version'), subtitle: extension.metadata.version || '1.0'})` | `prefs.js` | libadwaita default |
| About: daemon dependency | `Adw.ActionRow({title: _('usbeehive daemon'), subtitle: _('Required — run: systemctl --user enable --now usbeehive')})` — subtitle is plain text, no link; matches the popover empty-state copy verbatim | `prefs.js` | libadwaita default |

### STATE-04 conditional visibility

The Preferences menu row in the tile (and its separator) **must** check `Main.sessionMode.allowSettings` at menu-build time and skip both widgets entirely when `false`. The check is performed once at `_buildStaticMenu()` time and re-evaluated on `Main.sessionMode.connect('updated', ...)`; the signal handler removes-or-re-appends the two widgets. Both signal IDs are tracked in `SignalRegistry` per Phase 1 D-14.

**Do NOT** use `item.visible = false` for STATE-04 — completely remove the row from the menu when locked. EGO reviewers flag invisible-but-present items as a side-channel; physical removal is the safer pattern.

---

## Focal Point & Visual Hierarchy

Anchor: `<a id="hierarchy"></a>`

### Notification focal point

When the notification appears in the GNOME notification stack:

1. **Notification title** is the focal element. It carries the *what* — which port degraded and how — in a single line the user reads at a glance. Title is composed from the daemon's `summary` string, prefixed with a stable port label.
2. **Notification body** is secondary. It carries the daemon's `detail` string verbatim (multi-line allowed; MessageTray wraps it).
3. **"Don't notify for this port again" action button** is the primary user affordance. It is the user's escape hatch from notification noise and must be unambiguous. Listed first in `addAction()` call order so it appears leftmost.
4. **"Open Preferences" action button** is the secondary affordance. Listed second.

**Hierarchy within a notification** (`MessageTray.Notification` enforces this layout — USBee does not control sub-widget positioning):

```
┌────────────────────────────────────────────────────┐
│ [icon] USB-C Port 1 — charging slower than expected│  ← title (single line, Shell-truncated)
│        Cable limits this port to 60 W; a full-      │  ← body line 1
│        featured cable would deliver 100 W           │  ← body line 2 (wrapped)
│                                                     │
│   [Don't notify for this port again]  [Open Prefs] │  ← action row
└────────────────────────────────────────────────────┘
```

### Preferences window focal point

Per Adwaita conventions, the preferences window's focal point is the **first interactive row of the first group**. For USBee that is the **"Hide empty USB-C ports" `Adw.SwitchRow`**. The user opens prefs most often from the notification action (intent: mute) — so the **Notifications group** must appear *before* the General group only if we expect that to be the dominant entry path.

**Decision: Notifications group first, General group second, About group last.** Rationale: the only way a user reaches `prefs.js` is either (a) from the "Don't notify" notification path expecting to manage mutes, or (b) intentionally from the Extensions app / tile menu wanting to toggle "hide empty ports" — and (a) is the more common funnel because it's a single-tap from a notification they're already reading. Putting Notifications first respects the intent gradient.

```
┌─ USBee Preferences ─────────────────────────────────┐
│                                                      │
│  Notifications                                       │  ← Group title
│  Manage which USB-C ports may raise warnings         │  ← Group description
│  ┌────────────────────────────────────────────────┐ │
│  │ USB-C Port 1                          [trash]  │ │  ← muted-port row
│  │ Notifications muted                            │ │
│  ├────────────────────────────────────────────────┤ │
│  │ USB-C Port 3                          [trash]  │ │
│  │ Notifications muted                            │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  General                                             │  ← Group title
│  ┌────────────────────────────────────────────────┐ │
│  │ Hide empty USB-C ports               [ on/off ]│ │  ← SwitchRow
│  │ Don't list ports with nothing attached         │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  About                                               │  ← Group title
│  ┌────────────────────────────────────────────────┐ │
│  │ Version                                  1.0    │ │
│  │ usbeehive daemon                                │ │
│  │ Required — run: systemctl --user enable --now…  │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Iconography

| Surface | Icon | Purpose |
|---------|------|---------|
| Notification | `network-usb-symbolic` | Brand consistency with Phase 1 tile + popover header |
| Prefs window header | `network-usb-symbolic` (via `Adw.PreferencesPage.icon_name`) | Brand consistency |
| Unmute button trailing icon | `user-trash-symbolic` | Conventional "remove from list" affordance; paired with `destructive-action` CSS class so libadwaita styles it red |
| Optional secondary notification urgency | `dialog-warning-symbolic` | NOT applied to the gicon — left at `network-usb-symbolic`; the **degraded** semantic is carried by `notification.urgency = MessageTray.Urgency.NORMAL` and the title copy, not by icon swap |

**No new icon files** are added to `icons/` in Phase 2. All four icons above are Adwaita symbolic icons provided by the system theme.

---

## Spacing Scale

Anchor: `<a id="spacing"></a>`

Phase 2 declares **zero new spacing tokens**. Phase 1's four-token scale is inherited unchanged:

| Token | Value | Where used (Phase 2 additions only) |
|-------|-------|-------------------------------------|
| xs | 4px | (no Phase 2 use — Phase 1 only) |
| sm | 8px | (no Phase 2 use — Phase 1 only) |
| md | 16px | Reserved (still unused after Phase 2) |
| lg | 24px | Reserved (still unused after Phase 2) |

**Why no new tokens:**

- **`prefs.js` adds zero custom CSS.** libadwaita owns every spacing decision in the preferences window (`Adw.PreferencesPage` defines its own padding, `Adw.PreferencesGroup` defines its row gaps, `Adw.ActionRow` defines its internal title/subtitle spacing). Overriding these would break GNOME Settings consistency and is explicitly listed under PROJECT.md anti-features.
- **The notification surface adds zero custom CSS.** `MessageTray.Notification` rendering is fully Shell-themed; USBee composes title + body + actions and the Shell handles all metrics.
- **The Preferences menu row uses stock `.popup-menu-item` and `.popup-separator-menu-item`** — no overrides.

**Exceptions:** none. **No Phase 2 file adds any rule to `stylesheet.css`.** The Phase 1 stylesheet remains the entire custom-CSS surface area for the whole extension.

---

## Typography

Anchor: `<a id="typography"></a>`

Phase 2 inherits Phase 1's three type roles + one monospace exception unchanged. **No new roles**. Two surfaces use the inherited stack:

| Role | Size | Weight | Line height | Where used (Phase 2 additions only) |
|------|------|--------|-------------|-------------------------------------|
| Tile / popover row (inherited) | 14px | 600 (headline) / 400 (body) | 1.4–1.5 | "Preferences…" menu row label inherits Shell `.popup-menu-item .label` |
| Notification title (Shell-controlled) | 14px (Shell `.notification-banner .title` ≈ 14px) | 600 | 1.4 | Degraded-port notification title — Shell-owned, not specified by USBee |
| Notification body (Shell-controlled) | 13px (Shell `.notification-banner .body` ≈ 13px) | 400 | 1.5 | Degraded-port notification body — Shell-owned, not specified by USBee |
| Notification action button (Shell-controlled) | 13px | 500 | — | "Don't notify for this port again" / "Open Preferences" — Shell-owned |
| Prefs row title (Adwaita-controlled) | 14px (libadwaita `.action-row > .title-1`) | 400 | 1.4 | `Adw.ActionRow.title`, `Adw.SwitchRow.title` — libadwaita-owned |
| Prefs row subtitle (Adwaita-controlled) | 12px (libadwaita `.action-row > .subtitle`) | 400 | 1.4 | `Adw.ActionRow.subtitle`, `Adw.SwitchRow.subtitle` — libadwaita-owned |
| Prefs group title (Adwaita-controlled) | 16px | 700 | 1.3 | `Adw.PreferencesGroup.title` — libadwaita-owned |

**No new monospace exception.** Phase 1's monospace `.usbee-empty-state-entry` rule is the only monospace use in the whole extension. The "systemctl --user enable --now usbeehive" string appears as **plain text** in the prefs About row (not selectable, not monospace) — the popover is still the canonical place to copy it from, and duplicating the copyable affordance in two places would dilute the user's mental model.

**What we explicitly DO NOT do in Phase 2:**

- No custom `font-family`, `font-size`, `font-weight` in `prefs.js`.
- No `Pango.AttrList` font styling on Adw rows.
- No `<span size="..."></span>` markup in row text.
- No CSS injection via `Gtk.CssProvider` from `prefs.js` — libadwaita's defaults are the contract.

---

## Color

Anchor: `<a id="color"></a>`

Phase 2 keeps Phase 1's 60/30/10 split unchanged. The 10% accent is **expanded to exactly one additional element** in Phase 2; a destructive role is introduced for the first time.

| Role | Value | Usage (additions only) |
|------|-------|------------------------|
| Dominant (60%) | Shell `@theme_bg_color` / libadwaita `@window_bg_color` | Notification banner background, prefs window background, prefs row background |
| Secondary (30%) | Shell `@theme_fg_color` / libadwaita `@window_fg_color` | All notification text, all prefs row text |
| Accent (10%) | Shell `@accent_color` / libadwaita `@accent_color` | **Reserved for: (a) Phase 1's empty-state `St.Entry` focus ring [inherited], (b) the `Adw.SwitchRow` "on" state for "Hide empty USB-C ports" [new in Phase 2], (c) keyboard-focus ring on any focused row in prefs [Adwaita-managed].** |
| Destructive | libadwaita `destructive-action` CSS class → `@destructive_color` (red, theme-aware) | **Reserved for: the trailing trash-icon button on each muted-port `Adw.ActionRow` only.** That button removes the port from `port-mutes`; the destructive styling signals "this undoes a prior decision" semantically. |

**Accent reserved for** (full list, both phases combined):

1. Empty-state `St.Entry` focus ring (Phase 1, inherited).
2. `Adw.SwitchRow` "on" track for the "Hide empty USB-C ports" toggle (Phase 2).
3. Adwaita's automatic keyboard-focus ring on any focused prefs row (Adwaita-managed; USBee declares it but does not implement it).

**Destructive reserved for** (introduced in Phase 2):

1. Trailing trash-icon `Gtk.Button` on each muted-port `Adw.ActionRow`, via `css_classes: ['flat', 'destructive-action']`.

**Explicitly NOT applied destructive styling to:**

- The "Don't notify for this port again" notification action button. Rationale: from the user's POV that button **fixes** a problem (notification noise) — it is positive-valence in the moment, even though it suppresses future warnings. Styling it red would invert the affective signal. The Shell's stock action-button color is correct.
- Any future "Reset to defaults" affordance — deferred to a v1.x polish pass (not in Phase 2 scope).

**Theme adaptivity:** every color above resolves at theme-switch time. Light theme → libadwaita light surface, dark theme → libadwaita dark surface. Both surfaces follow the user's system accent color (GNOME 47+ accent customisation works automatically because USBee references named tokens, not hex literals). **USBee defines no hex literals in `stylesheet.css` or anywhere in `prefs.js`.**

**Why no per-row warning color in the popover for degraded ports:** the Phase 1 contract explicitly deferred this (`01-UI-SPEC.md` §Color: "Why no semantic warning colour"). Phase 2 keeps that deferral — the **notification** carries the degraded semantic, not a colored popover row. A future v1.x phase may add amber-subtitle styling on degraded port rows once we have telemetry on whether the notification alone is sufficient.

---

## Copywriting Contract

Anchor: `<a id="copywriting"></a>`

Every user-visible string Phase 2 emits, pinned verbatim. **All strings MUST be wrapped in `_()` gettext markers** (PACK-02) — the planner and executor treat raw literals as bugs. The contract below shows the literal English text; the source code wraps each in `_()`.

### Notification copy (NOTIF-01)

The daemon's `CapabilityDegraded` signal carries `(port_number i, summary s, detail s)`. USBee composes the notification as follows:

| Element | Copy template | Example |
|---------|---------------|---------|
| Notification title | `_('USB-C Port %d — %s').format(port_number, summary)` | `USB-C Port 1 — Charging slower than expected` |
| Notification body | `detail` **verbatim from daemon** (no client-side formatting) | `Cable limits this port to 60 W. A full-featured USB-C cable would deliver 100 W.` |
| Action 1 (primary mute) | `_("Don't notify for this port again")` | (literal) |
| Action 2 (open prefs) | `_('Open Preferences')` | (literal) |

**Title format rationale:** the `%d`-padded port number is the **stable identifier** across daemon restarts, lock/unlock, and extension reload — it is the same port_number value that gets stringified and written to GSettings `port-mutes`. Using it in the title gives the user a visual cue that ties the notification, the prefs row ("USB-C Port 1"), and the mute decision together. Without the explicit port number, the user could not tell which "USB-C port" they are muting.

**Format-string discipline (PACK-02):** every notification string uses `String.prototype.format()` with positional arguments. No string concatenation. No template literals interpolating user-facing text. This is enforced by the gettext-marker check.

### Notification coalescing semantics (NOTIF-02, STATE risk in STATE.md)

These are not user-visible strings — they are user-visible **behaviors**. The notification user experience is:

| Trigger | What user sees |
|---------|----------------|
| First `CapabilityDegraded` for port N | A new notification banner |
| Subsequent `CapabilityDegraded` for port N within active session | The existing notification banner **updates in place** (same `replaces_id` per port). No second banner, no notification-shade duplicate. |
| `CapabilityRestored(N)` | The notification for port N is **closed** via `notification.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED)`. The notification disappears from the shade. |
| Daemon restart (`NameOwnerChanged` null → owner) | A **2–3 second suppression window** runs before the notifier reattaches signal handlers. Any `CapabilityDegraded` events during this window are ignored (the daemon replays its current degraded set at owner-change time; we want only steady-state alerts, not startup floods). |
| Port N is in `port-mutes` GSettings list | **No notification raised, ever** — the signal handler short-circuits before composing the notification object. |

**No coalescing-related copy** is shown to the user (no "3 events suppressed" badge, no toast). The coalescing is invisible by design.

### Preferences window copy (PREFS-01..04, PACK-06)

| Element | Copy |
|---------|------|
| Window title (auto-set by `Adw.PreferencesWindow`) | `USBee` (taken from `metadata.json` `name`) |
| Page title | `_('General')` |
| Group 1 title | `_('Notifications')` |
| Group 1 description | `_('Manage which USB-C ports may raise degradation warnings')` |
| Empty muted-list row title | `_('No muted ports')` |
| Empty muted-list row subtitle | `_('Mute a port from a notification to see it here')` |
| Muted port row title | `_('USB-C Port %d').format(portNumber)` |
| Muted port row subtitle | `_('Notifications muted')` |
| Muted port unmute button tooltip | `_('Unmute this port')` |
| Group 2 title | `_('General')` |
| "Hide empty ports" switch title | `_('Hide empty USB-C ports')` |
| "Hide empty ports" switch subtitle | `_("Don't list ports with nothing attached")` |
| Group 3 title | `_('About')` |
| About: version row title | `_('Version')` |
| About: version row subtitle | `extension.metadata.version || '1.0'` (not translated — a version number) |
| About: daemon row title | `_('usbeehive daemon')` |
| About: daemon row subtitle | `_('Required — run: systemctl --user enable --now usbeehive')` |

### Tile menu addition (STATE-04)

| Element | Copy |
|---------|------|
| Preferences menu row label | `_('Preferences…')` (with U+2026 horizontal ellipsis, **not** three dot characters — matches GNOME HIG for menu items that open a window) |

**Why ellipsis:** GNOME HIG mandates that menu items which open a separate window or dialog use the ellipsis character to signal "this requires further interaction." Wi-Fi's "Wi-Fi Settings…" and Bluetooth's "Bluetooth Settings…" both follow this; USBee mirrors it.

### Primary CTA

Anchor: `<a id="primary-cta"></a>`

Phase 2 introduces **two new CTAs**, one per surface:

| Surface | Primary CTA | Verb + noun |
|---------|-------------|-------------|
| Notification | `_("Don't notify for this port again")` | **Verb:** "notify" (negated) — explicit. **Noun:** "this port" — specific. **Modifier:** "again" — temporal, clarifies that prior notifications are not retroactively suppressed. |
| Preferences window | `_('Hide empty USB-C ports')` | **Verb:** "Hide" — explicit. **Noun:** "USB-C ports" — specific. **Modifier:** "empty" — qualifies which subset. (Note: this is a switch label, not a button; the verb-noun construction is still the test passed.) |

**No generic CTAs anywhere** (no "OK", "Submit", "Save", "Confirm", "Apply"). All preferences changes auto-save via `Gio.Settings.bind()` — there is no Save button. All notification actions describe their specific effect, not a generic acknowledgement.

### Empty / Error states (Dimension 1 explicit)

| State | Where | Heading | Body / solution path |
|-------|-------|---------|----------------------|
| Empty: no ports currently muted | Prefs Notifications group | `_('No muted ports')` | `_('Mute a port from a notification to see it here')` — explains the entry path so users not arriving via a notification know how to populate this list. |
| Error: GSettings write fails (port-mutes update) | (no UI string — silent) | `logError` once; revert the local in-memory copy; next notification path re-attempts. **No flash-of-error in the prefs window** — if the SwitchRow can't persist, the switch snaps back to its prior state (Gio.SettingsBindFlags.DEFAULT handles this) and the journal carries the diagnostic. |
| Error: notification creation fails | (no UI string — silent) | `logError` once; no retry. The next `CapabilityDegraded` event will attempt afresh. Notifications are best-effort; we do not raise a meta-notification about a failed notification. |
| Error: daemon vanishes while prefs window is open | (no UI string — silent) | Prefs are operating on persisted GSettings, not on live daemon state — they remain fully functional with no visible change. The user can still mute, unmute, and toggle "Hide empty ports" without the daemon running. |

### Destructive actions

Phase 2 introduces **exactly one destructive action**: the trailing trash-icon button on a muted-port row that removes the port from `port-mutes`.

| Action | Confirmation copy | Confirmation pattern |
|--------|-------------------|----------------------|
| Unmute a single port (trash icon) | **None** — destructive but immediate, no confirmation dialog | Rationale: the action is **reversible** (the user can mute the same port again from any future notification), and a confirmation dialog for a single-row remove would be friction theater for an operation that has no permanent consequence. GNOME Settings' analogous pattern (e.g. "Remove" buttons in Online Accounts) also confirms-by-default for accounts but **not** for in-list filters. We follow the in-list-filter precedent. |

**No mass-unmute / "Clear all mutes" button** in Phase 2 — keeping the action one-at-a-time prevents foot-gun cases where the user accidentally re-enables a wall of past notifications. A future v1.x may add it after observing how big the muted-port list gets in practice.

**No "Reset to defaults"** in Phase 2 — there is no aggregate state to reset; the only persisted prefs are `port-mutes` (unmute individually) and `hide-empty-ports` (toggle).

### Lock-screen behavior (STATE-04)

| State | What the user sees |
|-------|--------------------|
| Screen locked (`Main.sessionMode.allowSettings === false`) | The tile's `Preferences…` menu row + separator are **physically absent** from the menu. The device list and empty-state behavior are unchanged from Phase 1. |
| Screen unlocked | `Main.sessionMode.connect('updated', ...)` re-runs the menu-build; the `Preferences…` row + separator reappear. |
| User taps a notification's "Open Preferences" action while screen is locked | The Shell itself refuses to open the prefs window (system-wide policy). No USBee-level handling required. We do not even attempt to test "behaves correctly under lock" for this action — the platform owns the answer. |

**No user-visible copy is involved in STATE-04.** It is a structural visibility contract.

### Packaging copy (PACK-01, PACK-06)

These are not in-app UI but are user-visible text shipped in the zip:

| File | Copy / structure |
|------|------------------|
| `COPYING` | The verbatim text of the GNU General Public License version 3 (GPL-3.0-only). Copied from https://www.gnu.org/licenses/gpl-3.0.txt with no modifications. **Filename:** `COPYING` (uppercase), not `LICENSE`, not `LICENCE`, matching GNU project convention and most GNOME extensions. |
| `README.md` heading | `# USBee` |
| `README.md` one-liner | A single sentence echoing the Quick-Settings-tile + daemon-companion framing from `PROJECT.md`. The README does **not** invent new product copy. |
| `README.md` install section heading | `## Installing` |
| `README.md` install step 1 | `Install the usbeehive daemon (sibling project).` |
| `README.md` install step 2 (the code block) | <pre>systemctl --user enable --now usbeehive</pre> |
| `README.md` install step 3 | `Install the USBee extension from extensions.gnome.org or `gnome-extensions install --force usbee@bitcreed.us.shell-extension.zip`.` |
| `README.md` requirements section heading | `## Requirements` |
| `README.md` requirements list | `GNOME Shell 46, 47, or 48; usbeehive running on the session bus as `org.usbeehive.Devices1`.` |
| `README.md` license heading | `## License` |
| `README.md` license body | `GPL-3.0-or-later — see [COPYING](./COPYING).` (note: text says "or-later" while `COPYING` is the verbatim GPL-3.0 text — this matches the SPDX expression convention; the `or-later` clause is in the source-file SPDX headers, not in `COPYING` itself, per GNU recommendation) |

**Decision on SPDX:** every `.js` source file in Phase 2 (and Phase 1 retroactively) carries the SPDX line:

```
// SPDX-License-Identifier: GPL-3.0-or-later
```

…as the first non-shebang line. This is the gettext-toolchain-friendly way to declare licensing without modifying `COPYING`'s GPL-3.0 verbatim text.

---

## Interaction & Live-Update Contracts

Anchor: `<a id="interactions"></a>`

### Degraded-port notification — first appearance

- On `CapabilityDegraded(N, summary, detail)`, the notifier checks `port-mutes` from GSettings. If `String(N)` is in the array, **no notification is composed** — return immediately.
- If not muted, the notifier creates the `MessageTray.Source` lazily (first event of the session creates it; subsequent events reuse the singleton). A `MessageTray.Notification` is constructed with title/body/actions per §Copywriting and pushed to `source.addNotification(notification)`.
- The Shell renders a banner; the user sees it.

### Degraded-port notification — repeat event for same port

- The notifier maintains a `Map<portNumber, MessageTray.Notification>`. On a second `CapabilityDegraded` for the same port:
  - Look up the existing notification; if present and not destroyed, call `notification.update(title, body, {})` to re-emit. The MessageTray treats this as the same notification (coalesces via the underlying notification ID).
  - **No second banner shown.** The shade entry is updated in place.

### `CapabilityRestored` — clear the notification

- The notifier looks up the port's notification in the map; calls `notification.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED)`; deletes the map entry.
- The notification disappears from the shade silently. **No "Issue resolved" success toast** — that would be noise on what should be a no-op for the user.

### "Don't notify for this port again" action

- User taps the action. The handler:
  1. Reads `port-mutes` (`as`) from `Gio.Settings`.
  2. Appends `String(portNumber)` if not already present.
  3. Writes back via `settings.set_strv('port-mutes', mutes)`.
  4. Destroys the current notification (the user's intent is "make this go away now").
  5. Does **not** show any "Muted!" confirmation toast — the disappearance of the banner is the confirmation.
- The future notifier code path reads the updated `port-mutes` from GSettings on every `CapabilityDegraded`, so mute takes effect on the very next event for any port — no extension restart required.

### "Open Preferences" action

- Calls `extension.openPreferences()`. The Shell opens `prefs.js` in `gnome-shell-extension-prefs`. **No additional copy or animation is owned by USBee** — the platform handles the window-open transition.

### Daemon restart suppression window (NOTIF-02 risk in STATE.md)

- When `Gio.bus_watch_name` fires "name-appeared" after a previous "name-vanished" within the session, the notifier sets `this._suppressUntil = GLib.get_monotonic_time() + 2_500_000` (2.5 seconds in microseconds).
- For 2.5 s, any `CapabilityDegraded` signal is **silently dropped** (logged once at debug level, not displayed).
- After 2.5 s, normal handling resumes.
- **No user-visible signal** that suppression is active — it should be invisible by design.

### `Adw.SwitchRow` "Hide empty USB-C ports" toggle

- User flips the switch; `Gio.Settings.bind('hide-empty-ports', ...)` writes to GSettings immediately.
- **No "Save" button**, no "Apply" button. Auto-save is the libadwaita convention.
- The popover in the running Shell process reads this key on every `populateDeviceRows()` rebuild (next time the popover opens). **The user does not see the popover change while prefs are open** — they will see the change the next time they open the popover. This is fine and matches Phase 1's lazy-populate decision (D-11).

### Unmute button (trash icon on a muted port row)

- User taps the trash button.
- Handler reads `port-mutes`, filters out the port's stringified ID, writes back, removes the `Adw.ActionRow` from the group with no animation.
- If the muted-port list is now empty, the "No muted ports" disabled `Adw.ActionRow` replaces the group's content.
- **No undo affordance.** If the user changes their mind, they unplug-and-replug the relevant cable or wait for the next degradation event; the notification will reappear (since the port is no longer muted) and they can re-mute from there.

### Tile "Preferences…" row tap

- Calls `extension.openPreferences()` (same as the notification's "Open Preferences" action).
- The popover closes automatically as is standard for menu-item activation.

### Lock-screen transitions (STATE-04)

- On `Main.sessionMode.updated` with `allowSettings === false`: the menu-build function destroys (`item.destroy()`) the `Preferences…` row and the separator.
- On `Main.sessionMode.updated` with `allowSettings === true`: the menu-build function re-creates and re-appends them in their canonical position (after the device-list section).
- **The user does not see the menu rebuild** unless they have the popover open at the exact moment of session-mode change; if they do, the menu re-renders in place silently.

### Visual stability requirement (Phase 1 D-10 carried forward)

- The 150 ms trailing-edge debounce on `DeviceAdded` / `DeviceRemoved` is **also** applied to the `CapabilityDegraded` → notify pipeline. A burst of degraded events (e.g. a flaky cable connector bouncing) coalesces to at most one notification update every 150 ms, then merges further updates via `replaces_id`. The user never sees notification-spam from a flaky physical connection.

---

## Registry Safety

Anchor: `<a id="registry-safety"></a>`

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — USBee is a GNOME Shell extension + libadwaita preferences window, not a React/Next.js/Vite project. shadcn does not apply. |
| Third-party JS / npm | none | not applicable — Phase 2 ships **zero** external packages. No `package.json`, no `node_modules`. EGO rule: bundled code is auto-rejection. |
| Third-party Gtk / Adw templates / Blueprints | none | not applicable — Phase 2's `prefs.js` constructs every widget in pure JavaScript via `new Adw.PreferencesPage({...})` etc. No `.ui` files, no Blueprint files, no third-party Adwaita component library. |
| GNOME Shell resource modules | `resource:///org/gnome/shell/ui/messageTray.js`, `resource:///org/gnome/shell/ui/main.js`, `resource:///org/gnome/shell/extensions/extension.js` (+ Phase 1's imports) | not applicable — host-process resource URIs vetted by the GNOME release process. |
| GObject Introspection modules (prefs process) | `gi://Gtk?version=4.0`, `gi://Adw?version=1`, `gi://Gio`, `gi://GLib`, `gi://GObject` | not applicable — GNOME platform libraries provided by the host system. **`Gtk` and `Adw` imports appear ONLY in `prefs.js`**; the Shell-process code path importing them is forbidden by D-17 and EGO review guidelines. |

**Vetting timestamp:** 2026-05-12 — verified by source review (no `package.json`, no `Cargo.toml`, no Blueprint or `.ui` files, no bundled binaries) — registry vetting gate result: **N/A — passed**.

**EGO submission checklist** (Dimension 6 surface area for the auditor at end of Phase 2):

- [ ] `gnome-extensions pack` produces a zip with no non-source files (no `.git/`, no `node_modules/`, no `.gschema.compiled` outside the schemas dir — wait, `gnome-extensions pack` includes the compiled schema automatically; clarify in the executor's task).
- [ ] Zip contains: `extension.js`, `metadata.json`, `prefs.js`, `dbus-iface.xml`, `src/*.js`, `schemas/*.gschema.xml` + compiled, `stylesheet.css`, `icons/*.svg`, `po/*.pot` + any `.po` (none in v1), `COPYING`, `README.md`.
- [ ] Zip contains: **zero binaries** (no `.so`, no `.bin`, no `.bundle`, no compiled C/Rust).
- [ ] Zip contains: **zero AI-generated boilerplate** (December 2025 EGO AI-code rule). Source is human-readable, structured, single-author-voice.
- [ ] All user-visible strings in `.js` source are wrapped in `_()`; `xgettext --from-code=UTF-8 -o po/usbee@bitcreed.us.pot extension.js prefs.js src/*.js` produces a non-trivial `.pot`.
- [ ] `metadata.json` declares `shell-version: ["46", "47", "48"]`, `gettext-domain: "usbee@bitcreed.us"`, `settings-schema: "org.gnome.usbee"`, and a stable `uuid`.

---

## Phase 2 Plan / Executor Anchors

Anchor: `<a id="anchors"></a>`

The planner uses these in `must_haves` and the executor uses them as source-of-truth pointers:

- [#component-inventory](#component-inventory) — exact widget classes and files for notification + prefs surfaces
- [#hierarchy](#hierarchy) — focal-point order for notification and prefs; group ordering rationale
- [#spacing](#spacing) — **zero new tokens**; libadwaita / MessageTray own everything
- [#typography](#typography) — Shell + libadwaita own everything; no overrides
- [#color](#color) — 60/30/10 inherited; destructive role introduced for the unmute button only
- [#copywriting](#copywriting) — every user-visible string verbatim, all `_()` wrapped
- [#primary-cta](#primary-cta) — two primary CTAs (notification mute + prefs hide-empty switch)
- [#interactions](#interactions) — notification coalescing, suppression window, lazy-popover-respecting prefs writes
- [#registry-safety](#registry-safety) — N/A justification + full EGO submission checklist

---

## Out-of-Scope Restatement (so the checker / auditor doesn't false-flag)

The following are **deliberately not specified** in Phase 2, by `PROJECT.md` Out of Scope + `REQUIREMENTS.md` v2:

- Bundled translations of strings beyond the `.pot` template (PACK-02 ships only the template; actual translations are I18N-V2-01).
- Master "Notifications enabled" switch in prefs — not in v1 (granular per-port mute is the v1 contract; master kill-switch is a candidate for v2 if telemetry shows the per-port model is insufficient).
- "Copy diagnostic to clipboard" notification action (DIAG-V2-01).
- Coalescing successive degraded/restored events within a configurable window (NOTIF-V2-01 — the 2.5 s daemon-restart suppression window is the only coalescing in v1).
- Per-row degraded-state amber colouring in the popover (deferred — the notification is the degraded signal).
- Adwaita `Adw.ButtonRow` "Open daemon README" link to the upstream usbeehive repo (out — the About row's plain text is sufficient; a clickable link adds an Internet-permission ask we don't want at EGO review time).
- A `prefs.js`-driven "Test notification" button (out — would be a debug affordance, not a user feature; defer to a v1.x dev-only build).
- Custom GtkCssProvider styling in `prefs.js` (out — libadwaita defaults are the contract).

---

## Continuity with Phase 1

Phase 2 adds three surfaces to the running extension without modifying any Phase 1 widget:

| Phase 1 widget | Phase 2 status |
|----------------|----------------|
| `USBeeIndicator` (`SystemIndicator`) | Unchanged. |
| `USBeeToggle` (`QuickMenuToggle`) | **Patched** to append the Preferences row + separator at the end of `_buildStaticMenu()`, gated by `Main.sessionMode.allowSettings`. |
| `_rowsSection` (device list) | Unchanged. **Future**: the executor may add a `hide-empty-ports`-aware filter inside `populateDeviceRows`, reading `extension.getSettings().get_boolean('hide-empty-ports')` once per rebuild. |
| `populateDeviceRows()` | **Patched** to consult `hide-empty-ports` from GSettings (PREFS-03). When `true`, skip rows whose `bullets` array is empty or whose headline matches the daemon's empty-port pattern (executor to consult `dbus-iface.xml` for the exact predicate). |
| Empty-state popover (`buildEmptyStateItem`) | Unchanged. The same `systemctl --user enable --now usbeehive` copy that lives in the popover empty state is now **echoed verbatim** in the prefs About row — both must update in lock-step if the daemon's install command changes upstream. |
| `stylesheet.css` | Unchanged. **Phase 2 adds zero CSS rules** (per §Spacing rationale). |
| `dbus-iface.xml` | Unchanged. Phase 2 consumes signals (`CapabilityDegraded`, `CapabilityRestored`) that were already in the captured XML. |
| `schemas/org.gnome.usbee.gschema.xml` | **Populated** with the two keys: `<key name="port-mutes" type="as">` with default `[]`, and `<key name="hide-empty-ports" type="b">` with default `false`. Both keys declared in the existing empty schema file from Phase 1. |
| Phase 1 typography / color / spacing tokens | All inherited unchanged. |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending

---

*UI design contract for: USBee Phase 2 — Notifications, Preferences, EGO Submission Polish (v1.0)*
*Researched: 2026-05-12*
