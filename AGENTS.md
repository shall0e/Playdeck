# Playdeck UI rules

- Use a consistent, compact neutral-gray UI with shared player CSS variables and Lucide action icons.
- Panels and dialogs may have translucent gray glass backgrounds with blur. Toolbar controls, action buttons, and expandable settings headings must have transparent backgrounds, with no visible borders, inset rings, or boxed hover shadows.
- Keep focus accessible: show a single clear outline only for keyboard `:focus-visible`, not for hover or normal pointer interaction. Never stack outlines on nested settings sections and summaries.
- Keep typography, spacing, corner radii, and hover text colors consistent across the player, menus, dialogs, and controller shadow DOM.
- Use subtle fade/blur transitions, respecting reduced motion.
- Keep settings concise. Touch controls, Playback, Diagnostics, controller calibration, and controller presets have been removed. Response curve belongs under controller Advanced settings.
- Saves exposes export/import saves; profile export/import stays collapsed under Settings backup.
- Implement behavior globally without game-specific hardcoding. Preserve concurrent changes.

- Game files belong in Cache Storage, with IndexedDB only for interrupted large downloads; never store large asset blobs in localStorage. Check the canonical local cache before contacting Cloudflare even across launch sessions and browser reload/no-store directives. Do not revalidate local hits over the network.
- Respond to local cache hits with `X-Playdeck-Cache: HIT` to make them identifiable in DevTools. Network fetches are for missing, invalid, explicitly updated, or intentionally non-cacheable resources, not for files already present locally.
