# Playdeck UI rules

- Reuse the toolbar's neutral gray glass style for all menus, dialogs, buttons, fields, cards, and summaries.
- Use shared player CSS variables, translucent gray backgrounds, and backdrop blur. Do not add visible borders or outlines.
- Keep focus visible through a lighter background or subtle inset shadow.
- Match toolbar typography, rounded corners, compact spacing, and hover states. Apply the same rules inside controller shadow DOM.
- Use Lucide icons for toolbar actions. Use fades and blur transitions, respecting reduced motion.
- Keep settings concise. Touch controls, Playback, Diagnostics, controller calibration, and controller presets have been removed. Response curve belongs under controller Advanced settings.
- Saves exposes export/import saves; profile export/import stays collapsed under Settings backup.
- Implement behavior globally, without game-specific hardcoding. Preserve concurrent changes.
