# Playdeck catalog

Playdeck is a simple grid of browser games. Click a thumbnail to play; hover or focus a card to see its description and controls.

## Structure

- `games.json`: names, descriptions, covers, playable URLs, categories, creator credits, and sources.
- `games.schema.json`: JSON schema for catalog entries.
- `README.md`: this guide.
- `images/`: optional covers you add yourself.

The site loads the public `games.json` file automatically on every visit. Editing game entries does not require redeploying the site. If GitHub is unavailable or the catalog is invalid, the site uses an included copy.

## Add or edit games

Keep `version` set to `1`. Add objects to the `games` array. Each game needs a unique lowercase `id`, `name`, `description`, `category`, secure `playUrl`, `image`, `sourceUrl`, `creator`, and `controls`. Optional fields include `tags`, `mobile`, `multiplayer`, `featured`, `enabled`, and `license`. `featured` is reserved for future catalog consumers and does not change this grid.

Images can use absolute HTTPS URLs or paths relative to `games.json`, such as `images/my-game.png`. Set `enabled` to `false` to hide an entry. Cards appear in catalog order.

## Hosting

Use the developer's secure HTTPS playable or embed URL. Games load in sandboxed iframes with scripts, same-origin functionality, pointer lock, forms, orientation lock, fullscreen, autoplay, and gamepad access. Some hosts prohibit iframe embedding through their own security headers; the player includes a link to open the original site. A cross-origin iframe load event does not guarantee the game started successfully. Host assets and multiplayer services can change independently.

The default catalog URL is configured in the Site's `dist/data/config.json`. No user-facing settings or account are needed to play.

## Credits

Starter metadata, creator details, sources, and screenshots were imported from [Open Arcade](https://github.com/OpenArcade/openarcade.github.io). Descriptions were rewritten and unavailable hosts excluded. Games and screenshots belong to their respective creators. Each entry retains its source and creator attribution. The launcher embeds externally hosted games rather than redistributing their code.
