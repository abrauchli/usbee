---
quick_id: 260915-unf
phase: quick-260915-unf
plan: 01
type: execute
wave: 1
depends_on: []
requirements: [QUICK-260915-unf]
autonomous: true
files_modified:
  - usbee@bitcreed.us/src/empty-state.js
  - usbee@bitcreed.us/stylesheet.css
  - usbee@bitcreed.us/src/popover.js
  - tests/daemon-status.test.js
  - po/usbee@bitcreed.us.pot
  - CHANGELOG.md

estimate:
  tokens: 60000
  raw_tokens: 30000
  tasks: 3
  confidence: low        # zero calibration samples for this repo

must_haves:
  truths:
    - The "Start usbeehive daemon" label renders at full theme foreground in both the light and the dark GNOME theme — it no longer inherits the insensitive dim from its non-reactive ancestor.
    - Pressing the button produces a visibly dimmer "Starting…" state that is distinguishable from the enabled state.
    - The button has a visible chip background in the light theme, not only the dark one.
    - The raw `systemctl --user enable --now usbeehived` line is absent from the default "daemon not running" view and reachable in one click behind a collapsible "Show details" disclosure.
    - Every user-visible string still goes through gettext, and `po/usbee@bitcreed.us.pot` is regenerated with the canonical invocation (prefs.js first, no --package-version).
    - All four gjs suites pass with at least the 483-assertion baseline (66 / 94 / 266 / 57).
  artifacts:
    - usbee@bitcreed.us/src/empty-state.js
    - usbee@bitcreed.us/stylesheet.css
    - usbee@bitcreed.us/src/popover.js
    - tests/daemon-status.test.js
    - po/usbee@bitcreed.us.pot
    - CHANGELOG.md
  key_links:
    - "buildStartRow() button style_class -> the shell theme's own `.button` / `.button.default` rules: the explicit `color` declaration these carry is what overrides the inherited `.popup-menu-item:insensitive` foreground. This is the link that cures the greying."
    - "popover.js populateEmptyState() -> BOTH empty-state.js items (the state item and the new disclosure item); the disclosure is a sibling in the section, not a child of the item."
    - "tests/daemon-status.test.js structural guards -> empty-state.js + stylesheet.css source text, with CSS comments stripped before every negative assertion."
---

<objective>
Fix the Start-daemon button in the "daemon not running" empty state so it reads as an
enabled, clickable action in both the light and the dark GNOME theme, and move the raw
systemctl command line out of the default view behind a collapsible "Show details"
disclosure.

Purpose: the button works when clicked but renders at the same 50 % dim the Shell uses
for disabled controls, so a user reasonably reads it as deactivated and never presses it.
The single most actionable affordance in this state is invisible as an affordance.

Output: a theme-correct button, a quieter default view, a regenerated `.pot`, a CHANGELOG
entry, and new structural guards that keep both properties from regressing.
</objective>

<root_cause>
Investigated in the real source and against the installed GNOME Shell 50.1 theme. The
cause is **inherited CSS colour**, not the button's reactive/can_focus state.

1. `usbee@bitcreed.us/src/empty-state.js:297-301` — `buildEmptyStateItem()` builds
   `new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false})`. That actor
   carries the Shell's `popup-menu-item` style class.
2. St maps `reactive === false` onto the `:insensitive` CSS pseudo-class. `insensitive`
   is a literal in `/usr/lib/gnome-shell/libst-18.so`, and **this repo already depends on
   exactly that mapping**: `empty-state.js:247-249` disables the button with
   `button.reactive = false` and nothing else, and `stylesheet.css:53-57` documents
   "insensitive styling is what marks the in-flight state".
3. So the empty-state row matches `.popup-menu-item:insensitive`, which the Shell theme
   defines as a dimmed foreground:
   - dark: `color: st-transparentize(#ffffff, 0.5)` — `gnome-shell-dark.css:968-970`
   - light: `color: st-transparentize(#222226, 0.6)` — `gnome-shell-light.css:968-970`
   (extracted from `/usr/share/gnome-shell/gnome-shell-theme.gresource`).
4. `color` inherits down the actor tree — the project already relies on this at
   `stylesheet.css:113-115` (`.usbee-detail-value { color: inherit }`). And
   `.usbee-start-button` (`stylesheet.css:43-47`) declares **no `color` at all**, so the
   button's label inherits the insensitive dim from its ancestor. The button itself is
   genuinely `reactive: true, can_focus: true` (`empty-state.js:226-227`) — hence the
   exact symptom reported: it works when clicked but renders greyed out.

Two corollaries confirm the diagnosis rather than merely fitting it:

- `stylesheet.css:55-57` sets `.usbee-start-button:insensitive { color: rgba(255,255,255,0.5) }`
  — the *same* 50 % dim as the inherited enabled colour. So the real disabled
  ("Starting…") state is visually indistinguishable from the enabled one, and the
  in-flight marker the comment above it claims does not actually exist.
- `.usbee-start-button` sets `background-color: rgba(255, 255, 255, 0.12)` and a 0.2 white
  hover (`stylesheet.css:43-51`). Those are white overlays: on the light GNOME theme
  (popover background near `#fafafb`) the chip is essentially invisible, so in light mode
  the button loses its button shape entirely. That is the second half of the
  "both light and dark themes" requirement.
</root_cause>

<fix_shape>
Stop hand-rolling the button's colours; adopt the Shell's own button classes, which are
defined per-theme and therefore correct in light, dark **and** high-contrast:

- `.button` (`gnome-shell-dark.css:56-60` shape, `:63-65` colour, `:66-73` focus ring,
  `:74-77` hover, `:78-81` **insensitive**, `:83-86` active) supplies an explicit `color`
  — which is what defeats the inherited dim — plus a real background and a genuinely
  dimmer disabled state.
- `.button.default` (`gnome-shell-dark.css:150-153`, `gnome-shell-light.css:151-153`, and
  8 matches in `gnome-shell-high-contrast.css`) adds
  `color: -st-accent-fg-color; background-color: -st-accent-color;` — the accent-filled
  suggested-action treatment, following the user's chosen GNOME accent colour. Crucially
  that declaration lives in **the theme**, so USBee's own stylesheet never has to name
  `-st-accent-color` and does not depend on St resolving it in an extension stylesheet.

Why this is safe across the declared shell-version range: if an older theme lacks the
`.default` accent rule, `.button` alone still sets an explicit `color` and background, so
the worst case is an ordinary-looking button — never a dim one. The fix does not depend
on `.default` existing.

No collisions: greps over both theme stylesheets found no standalone `.default` selector
and no `.popup-menu .button` / `.popup-menu-item .button` override. Specificity also
favours the fix — `.button.default` (0,2,0) outranks `.usbee-start-button` (0,1,0) — but
the plan removes the conflicting declarations outright so nothing rests on a
specificity race.

Precedent for borrowing a Shell style class: `empty-state.js:126` already styles the copy
icon with the Shell's `popup-menu-icon`.
</fix_shape>

<inferred_decisions>
The human operator is unavailable. These were decided from the code and prior artifacts
and are flagged for later audit:

- **D-A** Reuse the Shell theme classes `button` + `default` instead of hardcoding a
  colour pair. St's CSS subset has no variables and no `prefers-color-scheme`, so a
  literal colour cannot be correct in both themes; borrowing the theme's own rule is the
  only theme-neutral option that stays inside the documented surface.
- **D-B** Implement the disclosure as a sibling `PopupMenu.PopupSubMenuMenuItem` in the
  section rather than a hand-rolled `St.Button` expander inside the item. Proven twice in
  this repo — `buildOptionsSection` (`popover.js:180-220`) and `buildDeviceRow`
  (`popover.js:327`, `:377-387`, `:525`) — and it inherits the standard expander
  triangle, `.popup-sub-menu` theming and keyboard navigation for free.
- **D-C** Only the *stopped* state hides its command. The service-not-set-up,
  not-installed and out-of-date states keep theirs in the default view, because there the
  command is the **only** available action; hiding it would be a regression, not a
  tidy-up.
- **D-D** The hint line "Or start it yourself, and have it start with every session:"
  travels into the disclosure with the command. It is meaningless without the command
  beside it.
- **D-E** Commit straight to `master`; `git.allow_default_branch_commits` is still unset,
  matching every prior quick task in this repo.
- **D-F** `_('Show details')` is a new msgid, so the `.pot` must be regenerated: 162 -> 163
  msgids expected.
</inferred_decisions>

<context>
@/home/blk/projects/rust/usbee/CLAUDE.md
@/home/blk/projects/rust/usbee/usbee@bitcreed.us/src/empty-state.js
@/home/blk/projects/rust/usbee/usbee@bitcreed.us/stylesheet.css
</context>

<constraints>
- Documented GJS / PopupMenu / St surface only. No private `St.*` internals, no
  `Main.panel._*`. Borrowing a Shell **style class** is styling, not private API.
- No `/sys`, no udev, no `Gio.Subprocess`. The Start button stays an async `StartUnit`
  D-Bus call via `startDaemonUnit` (`empty-state.js:59`, `:252`).
- Every user-visible string through `_()`. No concatenation for user-visible text; use
  `_('… %s').format(x)`.
- Do NOT bump `metadata.json`, do NOT tag, do NOT push, do NOT run
  `gnome-extensions install --force`, do NOT `gnome-extensions pack`.
- Keep the four gjs suites green. Baseline is 66 / 94 / 266 / 57 = 483 assertions.
- Run test and grep commands under `rtk proxy` — rtk's filtering strips lines from
  build/test output, so a check that reads raw output must bypass it.
</constraints>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Make the Start button read as an enabled action in both themes</name>
  <files>usbee@bitcreed.us/src/empty-state.js, usbee@bitcreed.us/stylesheet.css, tests/daemon-status.test.js</files>

  <read_first>
    - `usbee@bitcreed.us/src/empty-state.js:217-284` (buildStartRow) and `:297-323`
      (buildEmptyStateItem — the `reactive: false` ancestor that causes the dim).
    - `usbee@bitcreed.us/stylesheet.css:36-64` (the three `.usbee-start-button*` rules to
      retire, and `.usbee-empty-state-start` / `.usbee-empty-state-status` which stay).
    - `tests/daemon-status.test.js:294-303` — the existing
      `# stylesheet.css styles the copy affordance` section; new CSS assertions belong
      beside it, in the same `readSource` + `check` idiom.
  </read_first>

  <behavior>
    New assertions in tests/daemon-status.test.js (source-level guards — empty-state.js
    imports a gnome-shell resource URI and cannot be loaded under bare gjs):
    - empty-state.js gives the Start button the Shell's `button` and `default` classes
      alongside the project hook, as one literal style_class string.
    - empty-state.js still builds the button with `can_focus: true` and `reactive: true`,
      and still disables it by assigning `reactive = false` on click (the mechanism the
      theme's `:insensitive` rule keys off).
    - With CSS comments stripped, stylesheet.css declares no `.usbee-start-button` rule
      at all — no colour, no background, no hover, no insensitive override.
    - With CSS comments stripped, stylesheet.css contains neither of the retired white
      overlay values (the 0.12 and 0.2 white backgrounds).
    - `.usbee-empty-state-start` and `.usbee-empty-state-status` survive untouched.
  </behavior>

  <action>
    Per the root_cause and fix_shape sections above.

    In `buildStartRow()` (empty-state.js:217-284), change the button's `style_class` from
    the lone project class to the three-class string `button default usbee-start-button`.
    Keep `can_focus: true`, `reactive: true`, `x_align: Clutter.ActorAlign.START`, the
    `_('Start usbeehive daemon')` label, the click handler, the watchdog and the destroy
    handler exactly as they are — the JS behaviour is correct already; only the styling
    was wrong. Retain `usbee-start-button` as a named project hook even though it will
    carry no declarations.

    Update the docstring above `buildStartRow()` to record, in prose, why the button
    borrows the Shell's button classes: a non-reactive `PopupMenuItem` ancestor matches
    the theme's insensitive rule, `color` inherits, and a class carrying an explicit
    `color` is what stops the inheritance. Name the theme selectors involved so the next
    maintainer does not "simplify" the class list back.

    In `stylesheet.css`, delete all three `.usbee-start-button` rules (the base rule, the
    `:hover` rule and the `:insensitive` rule, currently lines 43-57) and replace them
    with a comment block in the same position explaining that the button is deliberately
    colour-free: the Shell theme owns its colour, background, hover, focus ring and
    disabled state, and re-adding a local colour here would reintroduce both the
    reads-as-disabled bug and the light-theme-invisible chip. Leave
    `.usbee-empty-state-start` (lines 37-41) and `.usbee-empty-state-status` (lines 61-64)
    untouched.

    NOTE for that comment block, and for the docstring: the new test assertions
    negative-grep the retired CSS values, but they strip `/* … */` comment blocks from the
    stylesheet text first, so prose that mentions the old values is safe. Write the
    comment freely; do not contort it.

    Then add the assertions described in `<behavior>` to `tests/daemon-status.test.js` as
    a new `print('# …')` section placed immediately after the existing
    `# stylesheet.css styles the copy affordance` block. Use the file's established
    idiom: `readSource(...)` plus `check(name, cond)`. Strip CSS comments with a
    non-greedy block-comment replace before every negative assertion, and say in a
    comment why the strip exists.
  </action>

  <verify>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; rtk proxy gjs -m tests/daemon-status.test.js</automated>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; rtk proxy gjs -m tests/forward-compat.test.js</automated>
  </verify>

  <done>
    daemon-status.test.js prints ALL TESTS PASSED with more than its 94-assertion
    baseline, forward-compat.test.js still prints ALL TESTS PASSED at 266, stylesheet.css
    has no `.usbee-start-button` declarations outside comments, and empty-state.js builds
    the button with the `button default usbee-start-button` class string.
  </done>

  <reversibility rating="reversible">Styling and one class string; revert is a two-file diff.</reversibility>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Move the systemctl line behind a collapsible "Show details" disclosure</name>
  <files>usbee@bitcreed.us/src/empty-state.js, usbee@bitcreed.us/src/popover.js, tests/daemon-status.test.js</files>

  <read_first>
    - `usbee@bitcreed.us/src/empty-state.js:103-169` (buildCommandRow — returns an
      St.BoxLayout, so it needs a menu-item wrapper to live in a submenu), `:180-187`
      (buildWrappedLabel), `:297-323` (buildEmptyStateItem, the two children to move).
    - `usbee@bitcreed.us/src/popover.js:180-220` (buildOptionsSection — the
      PopupSubMenuMenuItem construction idiom) and `:377-387` plus `:525` (the
      non-reactive PopupBaseMenuItem wrapping an St.BoxLayout inside a submenu).
    - `usbee@bitcreed.us/src/popover.js:228-231` (populateEmptyState).
    - `tests/daemon-status.test.js:266-292` — **the constraint that matters**: line
      274-275 asserts `buildCommandRow(` appears exactly 5 times in empty-state.js
      (1 definition + one use per command-bearing state). Moving the call must keep that
      count at 5; deleting it would break the suite.
    - `tests/daemon-status.test.js:152-157` — the "slice the function body out by hand"
      precedent for asserting something is absent from one specific function.
  </read_first>

  <behavior>
    New assertions in tests/daemon-status.test.js:
    - empty-state.js exports a builder for the disclosure item and it returns a
      `PopupMenu.PopupSubMenuMenuItem`.
    - The disclosure label goes through gettext as `_('Show details')`.
    - Slicing out `buildEmptyStateItem`'s body: it no longer calls `buildCommandRow(`
      and no longer renders the "Or start it yourself…" hint, while still calling
      `buildStartRow(`.
    - The disclosure builder's body does call `buildCommandRow(` and renders the hint.
    - `buildCommandRow(` still appears exactly 5 times in the file (the existing
      assertion at line 274-275 stays green, unmodified).
    - The submenu content is a non-reactive, non-focusable `PopupBaseMenuItem` wrapper.
    - popover.js `populateEmptyState` adds the state item and the disclosure item to the
      section, in that order, after its `section.removeAll()`.
    - The other three command-bearing states still call `buildCommandRow(` in their own
      bodies (D-C: their command is the only action they offer).
  </behavior>

  <action>
    Per D-B and D-D.

    In `empty-state.js`, add an exported builder that returns a
    `PopupMenu.PopupSubMenuMenuItem` labelled `_('Show details')`, constructed with the
    wantIcon argument false so no icon slot is requested (and therefore never touch
    `.icon` on it). Inside it, build a non-reactive, non-focusable
    `PopupMenu.PopupBaseMenuItem`, give it a vertical `St.BoxLayout` child, and add to
    that box: the existing hint label built with `buildWrappedLabel` carrying
    `_('Or start it yourself, and have it start with every session:')`, then
    `buildCommandRow(SYSTEMCTL_CMD)`. Add the wrapper to the submenu with
    `item.menu.addMenuItem(...)`. Mirror `popover.js:377-387` for the wrapper and
    `popover.js:181` for the submenu item.

    Put a `// Translators:` comment above the new `_('Show details')` string, matching the
    convention at `popover.js:407`. It is a disclosure control label, not a remedy
    instruction — the 260910-p91 imperative sweep at `forward-compat.test.js:1005-1012`
    is scoped to popover.js and matches only `use a`, so it does not apply here.

    Remove those same two children from `buildEmptyStateItem()` (currently the
    `buildWrappedLabel` hint at lines 317-318 and the `buildCommandRow` call at line 319).
    The title, the "usbeehive is installed…" body line and `buildStartRow()` stay. The net
    `buildCommandRow(` count in the file is unchanged at 5 — the call moved, it was not
    added or deleted.

    Update the file header comment (the five-flavour inventory at lines 4-29) and
    `buildEmptyStateItem()`'s docstring so both describe the new two-item shape and state
    why only this state hides its command (D-C).

    In `popover.js`, import the new builder alongside the existing empty-state imports
    (lines 25-26) and make `populateEmptyState(section)` add both items after
    `section.removeAll()`: the state item first, the disclosure second. A
    `PopupSubMenuMenuItem` in this section is already proven — device rows are exactly
    that (`popover.js:327` added at `:130`).

    If any new wrapping label is introduced, pair `line_wrap = true` with
    `ellipsize = Pango.EllipsizeMode.NONE` or use `buildWrappedLabel`, which already does
    — `forward-compat.test.js:1031-1043` counts the pairing across this file.

    Then add the assertions described in `<behavior>` to `tests/daemon-status.test.js`,
    in a new section after the `# empty-state.js command rows are copyable` block. Do not
    edit the existing count-of-5 assertion.
  </action>

  <verify>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; rtk proxy gjs -m tests/daemon-status.test.js</automated>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; rtk proxy gjs -m tests/forward-compat.test.js</automated>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; rtk proxy gjs -m tests/service-probe.test.js</automated>
  </verify>

  <done>
    All three suites print ALL TESTS PASSED; the default "daemon not running" view is
    title + body + Start button only; the hint and the systemctl line live inside a
    collapsed "Show details" submenu; `buildCommandRow(` still occurs exactly 5 times in
    empty-state.js.
  </done>

  <reversibility rating="reversible">Widget composition change inside one state; no data or wire format involved.</reversibility>
</task>

<task type="auto">
  <name>Task 3: Regenerate the translation template, log the change, and run the full suite</name>
  <files>po/usbee@bitcreed.us.pot, CHANGELOG.md</files>

  <read_first>
    - `CLAUDE.md` → Release Process → **Regenerating the translation template** (the
      invocation is exact and the input order is load-bearing).
    - `CHANGELOG.md:1-12` — the empty `## [Unreleased]` section that this entry goes into,
      and the prose register of the `## [2.9.0]` entries below it.
  </read_first>

  <action>
    Regenerate the template with the canonical invocation and nothing else — `prefs.js`
    first, `src/*.js` second, and deliberately no `--package-version`:
    `xgettext --from-code=UTF-8 --package-name=USBee -o po/usbee@bitcreed.us.pot usbee@bitcreed.us/prefs.js usbee@bitcreed.us/src/*.js`
    (run it from the repo root, under `rtk proxy`). Do not hand-edit the template. Listing
    `src/*.js` first reorders every msgid block and fabricates a several-hundred-line diff
    (260910-nge); adding a package version reintroduces the drift 260915-mk0 removed.

    Inspect the resulting diff rather than trusting it: the only expected changes are
    `POT-Creation-Date`, the `#:` line references for `empty-state.js` and `popover.js`,
    and one new `Show details` msgid. 162 msgids become 163. `Project-Id-Version` must
    still read `USBee` with no number.

    Add a `## [Unreleased]` entry to `CHANGELOG.md` under a `### Fixed` heading, in the
    user-facing prose register the 2.9.0 entries use — say that the button to start the
    daemon looked disabled and now looks like the action it is, in both light and dark
    themes, and that the terminal command it used to print in full now sits behind a
    "Show details" row so the panel leads with the one-click action. Do not touch
    `metadata.json`, do not tag, do not push.

    Finally run all four suites and confirm no regression against the 483-assertion
    baseline.
  </action>

  <verify>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; rtk proxy gjs -m tests/dbus-client.test.js &amp;&amp; rtk proxy gjs -m tests/daemon-status.test.js &amp;&amp; rtk proxy gjs -m tests/forward-compat.test.js &amp;&amp; rtk proxy gjs -m tests/service-probe.test.js</automated>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; rtk proxy grep -c '^msgid ' po/usbee@bitcreed.us.pot</automated>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; rtk proxy msgfmt --check-format -o /dev/null po/usbee@bitcreed.us.pot</automated>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; rtk proxy grep -n 'Project-Id-Version' po/usbee@bitcreed.us.pot</automated>
    <automated>cd /home/blk/projects/rust/usbee &amp;&amp; rtk proxy git diff --stat po/usbee@bitcreed.us.pot CHANGELOG.md</automated>
  </verify>

  <done>
    Four suites green at or above 66 / 94 / 266 / 57; the msgid count reads 163;
    `msgfmt --check-format` is clean; `Project-Id-Version` reads `USBee` with no version;
    the `.pot` diff is confined to the creation date, line references and the one new
    msgid; `CHANGELOG.md` carries the entry under `## [Unreleased]`; `metadata.json` is
    untouched.
  </done>

  <reversibility rating="reversible">Generated artifact plus a docs entry.</reversibility>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| session D-Bus -> USBee | usbeehive (or any session process owning the name) supplies device and version data. Not reached by this change. |
| USBee -> systemd user manager | the Start button's `StartUnit` call. Unchanged by this plan. |
| USBee -> clipboard | `buildCommandRow` writes a command string to the Shell clipboard. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-unf-01 | Tampering | `buildCommandRow` clipboard write, now reached from inside a submenu | low | mitigate | The command stays the module constant `SYSTEMCTL_CMD` (`empty-state.js:64`). Nothing daemon- or user-supplied interpolates into it; the existing T-ke2-02 property is preserved verbatim by moving the call site, not its argument. |
| T-unf-02 | Denial of Service | pending `GLib.timeout` sources in the moved command row | low | mitigate | `buildCommandRow`'s `destroy` handler already removes every in-flight source (`empty-state.js:161-164`), and a submenu child is destroyed with the section on rebuild, so the T-ke2-04 contract holds unchanged. Task 2 must not drop that handler. |
| T-unf-03 | Information disclosure | the new `_('Show details')` label and the disclosure content | low | accept | Both are static module text; no daemon data is rendered in the disclosure. |
| T-unf-04 | Elevation of privilege | Start button action | low | accept | Unchanged: an async `StartUnit` call to the user's own systemd via `startDaemonUnit`. No subprocess, no new privilege. |
| T-unf-SC | Tampering | package-manager installs | n/a | accept | No npm/pip/cargo install is introduced. Pure GJS, no dependency change, so the package-legitimacy gate does not apply. |
</threat_model>

<verification>
- Four gjs suites green, at or above the 66 / 94 / 266 / 57 baseline, run under `rtk proxy`.
- `stylesheet.css` carries no `.usbee-start-button` declarations outside comments, and
  neither retired white-overlay value survives outside a comment.
- `empty-state.js` builds the Start button with `button default usbee-start-button`.
- The default "daemon not running" view holds title, body and Start button only.
- `.pot` regenerated with the canonical invocation; 163 msgids; header version-free.
- `metadata.json` untouched; no tag; no push; no `gnome-extensions install`/`pack`.

**Outstanding manual confirmation (not blocking, operator unavailable):** the popover
cannot be exercised without a GNOME Shell restart, and one is already outstanding across
260915-i4w, 260915-ikd and 260915-mpf. The visual reading of the button in light and dark,
and the collapsed/expanded disclosure, therefore remain unconfirmed on screen. The change
is verified structurally instead: the theme rules that cause and cure the dim were read
from the installed `gnome-shell-theme.gresource` and cited by file:line, and the class
string is pinned by test. Flagged for audit at the next Shell restart.
</verification>

<success_criteria>
- A user opening the tile with the daemon stopped sees a button that reads as an enabled,
  clickable action, in both the light and the dark GNOME theme.
- Pressing it yields a "Starting…" state that is visibly dimmer than the enabled state.
- The raw systemctl line is one click away under "Show details", not printed in the
  default view, and still copy-pasteable with its copy button.
- Every user-visible string goes through gettext and the template is regenerated
  canonically.
- No regression in the 483-assertion baseline.
</success_criteria>

<output>
Create `.planning/quick/260915-unf-fix-the-start-daemon-button-in-the-daemon-not-running-empty/260915-unf-SUMMARY.md` when done.
</output>
