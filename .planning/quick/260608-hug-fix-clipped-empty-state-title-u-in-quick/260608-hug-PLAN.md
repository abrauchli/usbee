---
phase: 260608-hug
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - usbee@bitcreed.us/src/empty-state.js
  - usbee@bitcreed.us/stylesheet.css
autonomous: true
requirements: [QUICK-260608-hug]

must_haves:
  truths:
    - "All three empty-state titles render in full, unclipped, without ellipsis"
    - "Title, hint text, and command entry are stacked vertically (not horizontal siblings)"
    - "All three builder functions are fixed identically"
    - "All user-visible strings still pass through gettext _() calls unchanged"
  artifacts:
    - path: "usbee@bitcreed.us/src/empty-state.js"
      provides: "Fixed builder functions — title is first child of vertical box, item.label hidden"
      contains: "usbee-empty-state-title"
    - path: "usbee@bitcreed.us/stylesheet.css"
      provides: "CSS rule for .usbee-empty-state-title"
      contains: "usbee-empty-state-title"
  key_links:
    - from: "buildEmptyStateItem / buildDaemonNotInstalledItem / buildDaemonOutOfDateItem"
      to: "St.BoxLayout (vertical)"
      via: "title St.Label prepended as first box child"
      pattern: "usbee-empty-state-title"
---

<objective>
Fix the clipped empty-state title ("u...") in the USBee Quick Settings popover.

Purpose: `PopupMenu.PopupMenuItem` lays children out horizontally. Each builder sets
`item.label.text` to the title AND appends a vertical `St.BoxLayout` with `x_expand: true`
as a sibling. The box takes all horizontal space; the built-in `item.label` is squeezed and
ellipsized to "u...". Moving the title inside the vertical box as a styled `St.Label`
(first child) eliminates the horizontal competition and produces the intended stacked layout:
title → hint → command entry.

Output: Three repaired builder functions and one new CSS class.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@usbee@bitcreed.us/src/empty-state.js
@usbee@bitcreed.us/stylesheet.css
</context>

<tasks>

<task type="auto">
  <name>Task 1: Move titles into the vertical body box in all three builder functions</name>
  <files>usbee@bitcreed.us/src/empty-state.js</files>
  <action>
    Apply the same three-part change to each of the three builder functions
    (buildEmptyStateItem, buildDaemonNotInstalledItem, buildDaemonOutOfDateItem):

    1. Remove the `item.label.text = _(...)` line entirely and replace it with
       `item.label.hide()` immediately after `item.add_style_class_name(...)`.
       Hiding rather than leaving empty avoids any residual minimum-width
       allocation from the built-in label widget.

    2. Create a title `St.Label` immediately before the `hint` construction:
       ```
       const title = new St.Label({
           text: _('<original title string>'),
           style_class: 'usbee-empty-state-title',
           x_expand: true,
       });
       title.clutter_text.line_wrap = true;
       ```
       The `_()` call must wrap the same string that was previously assigned to
       `item.label.text` — do not alter the wording.

    3. Prepend the title as the first child of the vertical `box` by calling
       `box.add_child(title)` before `box.add_child(hint)`, so the final
       child order inside `box` is: title → hint → entry.

    The three title strings (preserve exactly, including capitalisation):
    - buildEmptyStateItem:          'usbeehive daemon not running'
    - buildDaemonNotInstalledItem:  'usbeehive not installed'
    - buildDaemonOutOfDateItem:     'usbeehive daemon out of date'

    Do not touch SYSTEMCTL_CMD, INSTALL_CMD, UPDATE_CMD, the cache helpers,
    isUsbeehiveServiceInstalled, invalidateInstalledCache, or any other
    logic in the file. Only the three builder functions change.
  </action>
  <verify>
    <automated>grep -c 'usbee-empty-state-title' usbee@bitcreed.us/src/empty-state.js</automated>
    Expected output: 3 (one per builder). Also verify no bare `item.label.text =` remains:
    <automated>grep -c 'item\.label\.text' usbee@bitcreed.us/src/empty-state.js</automated>
    Expected output: 0
  </verify>
  <done>
    All three builder functions prepend a titled St.Label (class usbee-empty-state-title)
    as the first child of the vertical box; item.label is hidden; no item.label.text
    assignments remain; gettext wraps each title string unchanged.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add CSS rule for .usbee-empty-state-title in stylesheet.css</name>
  <files>usbee@bitcreed.us/stylesheet.css</files>
  <action>
    Append a new CSS rule for `.usbee-empty-state-title` at the end of the
    `.usbee-empty-state-body` rule group (after line 9, before the blank line
    preceding `.usbee-empty-state-entry`). Insert it as a logically adjacent
    sibling of the existing empty-state rules so all three live together:

    ```css
    .usbee-empty-state-title {
        font-weight: bold;
        margin-bottom: 2px;
    }
    ```

    `font-weight: bold` makes the title read as a heading without introducing
    a separate font-size change (keeps rhythm consistent with the surrounding
    Adwaita shell theme). `margin-bottom: 2px` adds breathing room between
    the title and the hint text on top of the 8px spacing already on
    `.usbee-empty-state-body`. Do not change any existing rules.
  </action>
  <verify>
    <automated>grep -c 'usbee-empty-state-title' usbee@bitcreed.us/stylesheet.css</automated>
    Expected output: 1
  </verify>
  <done>
    stylesheet.css contains exactly one .usbee-empty-state-title rule with
    font-weight: bold; existing rules are unchanged.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Extension JS → St widget tree | CSS class names and label text are developer-controlled constants; no user input crosses this boundary |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-hug-01 | Tampering | stylesheet.css class name | accept | Class name is a string literal in source; no external input involved |
| T-hug-SC | Tampering | npm/pip/cargo installs | accept | No package manager installs in this task; pure GJS + CSS edit only |
</threat_model>

<verification>
After executing both tasks, reload the extension in a GNOME 46+ session and open the
Quick Settings popover while usbeehived is not running. Confirm:

- The empty-state row shows a bold "usbeehive daemon not running" title at the top,
  followed by the hint text, followed by the command entry — all stacked vertically.
- No "u..." or any ellipsized text appears.
- Repeat for the not-installed and out-of-date states if testable.

Journal check (no regressions):
  journalctl --user -n 50 /usr/bin/gnome-shell | grep -i 'usbee\|error\|exception'
</verification>

<success_criteria>
- Three builder functions each produce a vertical layout: title → hint → entry.
- item.label is hidden in all three; no item.label.text assignment remains.
- .usbee-empty-state-title rule present in stylesheet.css with font-weight: bold.
- No JS errors in gnome-shell journal on extension reload.
- All title strings pass through unchanged gettext _() calls.
</success_criteria>

<output>
Create `.planning/quick/260608-hug-fix-clipped-empty-state-title-u-in-quick/260608-hug-SUMMARY.md` when done.
</output>
