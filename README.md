# Playdeck catalog

[Playdeck](https://playdeck.landoesp.chatgpt.site/) loads this public repository's `games.json` on each visit. Edit that file to update the game grid; no site deployment is needed.

Each game requires four fields:

```json
{
  "image": "https://example.com/cover.jpg",
  "playUrl": "https://example.com/play/",
  "name": "My game",
  "description": "A short description of the game."
}
```

Add entries to the `games` array and keep `version` set to `1`. Cards appear in catalog order. `image` can be an HTTPS URL or a path relative to `games.json`, such as `images/my-game.png`. `playUrl` must use HTTPS. The schema is in `games.schema.json`.

Optional: set `"openInNewTab": true` on a game to open its `playUrl` in a new tab. Omit it or set it to `false` to use the fullscreen player. Eaglercraft uses `true` because its launcher blocks embedding.

Catalog URL: `https://raw.githubusercontent.com/shall0e/Playdeck/main/games.json`

Playdeck uses its included catalog if GitHub is unavailable. Games run on their original hosts, some of which may prevent embedding. Use `openInNewTab` for those games.

Starter metadata and screenshots came from [Open Arcade](https://github.com/OpenArcade/openarcade.github.io). Games and screenshots belong to their respective creators; this repository contains catalog entries, not game code.
