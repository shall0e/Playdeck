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
