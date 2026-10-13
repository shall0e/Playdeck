# Playdeck agent rules

## Universal UI contract

- **One change applies everywhere.** Whenever a user asks to change the style of one menu element, immediately apply the matching rule to ALL Playdeck menus and all instances of the same control type: toolbar, Game menu, Settings, Display, Controller (shadow DOM), keybind editor, Downloads, modal dialogs, and future menus. Never fix only the reported element.
- `website/player/deck.css` owns the common CSS variables (menu size, surface, border, font, spacing, hover and picker). Mirror those exact tokens in the controller's shadow-DOM style and never introduce disconnected alternate themes.
- The Glass / Transparent setting affects the **outer menu surface only**. Glass has a softly blurred gray outer panel; Transparent has an unfilled outer panel with ONE thin white border. No other panel, section, button, toolbar item, dropdown/select, input, keybind, checkbox, heading, or interactive row receives a visible background, outline, focus ring, border or hover box-shadow.
- Controls have permanently transparent backgrounds in default, hover, focus, active, checked, disabled, and open states. Give hover/focus feedback with a slight text/icon color or text-glow transition (roughly 120 ms), NOT a filled rectangle or white line.
- Dropdowns must match the dark UI. Use `appearance: base-select` and `::picker(select)` where supported; keep native semantic select behavior and readable fallbacks.
- Use narrow (~258 px) menus, compact typography (~11-13 px), tight vertical rhythm, and condensed Controller keybind rows (~24 px). Do not sacrifice readability or pointer targets on small screens.
- The only user-requested white stroke is the outer transparent menu border, at 50% white opacity. Do not add an outline to inputs or checkboxes, the toolbar edge activator, or section summaries. Suppress caret-like focus indicators on non-editable controls and hide scrollbars without reserving a layout gutter.
- Settings content belongs in logical collapsible sections: panic shortcut and destination in Misc, game-specific force-controller mapping in Compatibility, cache counts, clearing and management under Downloads. Keep the underlying input references and event handlers intact when moving their DOM nodes.
- Controller Advanced settings uses exactly the same summary typography, spacing, and no-marker / no-outline treatment as Misc, Compatibility, Downloads and Saves.
- Clicking inside the game iframe must dismiss all player menus, including Controller and Settings, release toolbar focus and return input to the game.

## Functionality

- Preserve game behavior and use global fixes without game-specific hardcoding. Use Lucide action icons and respect reduced-motion preferences.
- Touch controls, Playback, Diagnostics, calibration and controller presets remain removed. Response curve belongs in controller Advanced settings.
- Saves supports export/import; profile export/import stays collapsed under Settings backup.
- Game files use Cache Storage, with IndexedDB only for interrupted downloads. Check canonical locally saved game files before the Cloudflare Worker, without network hash checks for hits. Mark served local responses with `X-Playdeck-Cache: HIT`. Only missing, invalid, non-cacheable, or explicitly updated resources use the network.

- Player motion: opening any menu or controller overlay fades, deblurs, expands and slides its panel/controls into place. On dismissal, reverse the panel animation **completely before** retracting the toolbar. Use the central `installToolbar` menu lifecycle for parent and game-iframe outside clicks; do not set `hidden` or `details.open=false` in separate outside-click listeners that bypass its exit sequence. Keep the controller shadow DOM and Settings detail transitions synchronized.
- Preserve reduced-motion preferences: skip animation AND JS waiting time when `prefers-reduced-motion: reduce` is active. Outside-click retraction must clear toolbar focus and avoid immediate re-reveal until the cursor leaves the bottom activation zone.

- Reliability over decorative motion: never animate scale, transform or filter on `#game-menu-bar > *` (toolbar controls anchor floating panels). Use only vertical translate/opacity/soft blur on the outer panel; do not force `::details-content` heights or clip native `details` controls.
- Glass theme restores subtly filled buttons, dropdowns, and text fields using `--playdeck-control-bg` and `--playdeck-field-bg`; Transparent theme makes only those controls unfilled. Every menu and Controller shadow DOM must use the same tokens, with the outer transparent panel maintaining its 50% white border.
- Outside clicks (both inside/outside the game iframe) must finish the panel exit before the toolbar exit, release focus, and preserve button clickability. Test both the sequence and rapid switching/reopening of menus before shipping.

- Open menus MUST be hit-testable above the game iframe. Keep the toolbar stacking context above the iframe (and its child panels pointer-enabled), without CSS filters or transforms on the toolbar wrapper that break popover hit testing. Validate this with normal Playwright clicks, never force-click workarounds.

- While a player menu is open, the game iframe's pointer-events are disabled by the shared open-menu CSS gate. This prevents game content from stealing clicks from popup controls. A click outside goes to the launcher and dismisses the panel; after closing completes, iframe pointer events recover automatically. Controller shadow DOM also toggles the body class for this gate.

- The toolbar is a viewport-sized fixed flex container with `pointer-events:none` on the wrapper and `pointer-events:auto` on the menu controls/panels. This is essential: an absolutely positioned popover outside a 34 px-tall toolbar had a visual bounding box but Chrome sent clicks to the underlying iframe/page. Keep the transparent container full-screen and dock children to the bottom.

- Apply a mode-specific `:root[data-playdeck-appearance='transparent']` override for buttons, summaries, dropdowns and fields across Game, Settings, Display and dialogs. This must outrank legacy `!important` controls, not merely set variables that a stronger rule could ignore. Glass uses filled shared tokens.
