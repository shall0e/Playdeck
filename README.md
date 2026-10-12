# Playdeck

An independent, embeddable browser game player with proxy loading, local file caching, controller mapping and optional canvas display controls. Timebomb is one client of Playdeck. Playdeck has no catalog dependency and works with any launcher.

Hosted instance: https://playdeck-1z1.pages.dev/

The GitHub development repository is private. The hosted instance distributes MIT-licensed source and deployable ZIPs at `/downloads/playdeck-source.zip` and `/downloads/playdeck-deploy.zip`. Neither bundle contains game binaries, account data, credentials or cached downloads.

## Quick start

Open `/` for the product homepage, or `/player/` to enter a public HTTPS game URL. Or launch directly:

```text
https://playdeck-1z1.pages.dev/?url=https%3A%2F%2Fexample.com%2Fgame%2F&name=Example&displayOptions&ratio=16%3A9
```

Root links that include `url` forward their query parameters to `/player/` for compatibility. Use `/player/` directly for embedding. Old sandbox routes redirect to `/player/`.

## URL API

| Parameter | Values | Default |
| --- | --- | --- |
| `url` | Encoded public HTTPS game URL | Launch form |
| `name` | Game title | Game |
| `image` | Encoded HTTPS loading image URL | None |
| `displayOptions` | Bare flag, true/false, 1/0, or JSON display object | Disabled |
| `ratio` | auto, 4:3, 16:9, 16:10, 21:9, 1:1 | Saved choice, then 16:9 |
| `nativeGamepad` | Bare flag, true/false, 1/0 | false |
| `forceController` | Bare flag, true/false, 1/0 | Per-game saved choice |
| `performance` | full, auto, fast, native | Saved profile, then full |
| `toolbar` | auto, visible | auto |
| `hidePageExtras` | Bare flag, true/false, 1/0 | Saved choice, then true |
| `parentOrigin` | Exact embedding origin, without a path | Referrer origin |

URL options override saved preferences for the launch. Native gamepad support takes precedence over forced mapping. A ratio requires enabled display options. `displayOptions` JSON accepts `{ "ratios": ["16:9", "4:3"], "defaultRatio": "16:9" }`. Display uses canvas stretching. Omitting the flag leaves the normal game page unchanged.

Build links with `URL` and `URLSearchParams`, so ampersands and hashes in the game URL are encoded rather than parsed as player options. Parent pages must run on a different origin from Playdeck because games execute on the player's origin.

## JSON integration

Timebomb accepts existing `displayOptions` / `nativeGamepad` fields and the extensible `playerOptions` object:

```json
{
  "name": "Example",
  "description": "Example game",
  "playUrl": "https://example.com/game/",
  "image": "https://example.com/cover.jpg",
  "playerOptions": {
    "displayOptions": true,
    "ratio": "16:9",
    "forceController": true,
    "performance": "auto",
    "toolbar": "auto"
  }
}
```

Top-level displayOptions/nativeGamepad fields take precedence when supplied. Timebomb owns catalog fetching and supplies the game URL/title/image plus its origin; Playdeck owns execution and preferences.

## Embedding and messages

```js
const player = new URL('/player/', 'https://playdeck-1z1.pages.dev');
player.searchParams.set('url', 'https://example.com/game/');
player.searchParams.set('displayOptions', 'true');
player.searchParams.set('parentOrigin', location.origin);
iframe.src = player.href;
iframe.allow = 'fullscreen; autoplay; gamepad; cross-origin-isolated';
iframe.sandbox = 'allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-orientation-lock';
```

Playdeck sends `playdeck:sandbox-ready`, `playdeck:game-ready`, `playdeck:game-failure`, `playdeck:menu-action`, `playdeck:panic`, `playdeck:settings` and `playdeck:health-pong` to the configured parent origin. Parents send `playdeck:health-ping` and `playdeck:state` (paused/muted). Both sides must check the message origin and source window. When embedding threaded WebAssembly games, the launcher needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`.

## Deploy your own instance

Requires Node 22+ and Cloudflare Pages for the included server proxy. A plain static host can serve the UI but cannot execute `_worker.js`.

1. Download the source ZIP and extract it, or clone this repository if you have access.
2. Run `npm test` and `npm run build`. There are no runtime npm dependencies.
3. Run `npx wrangler pages project create YOUR_INSTANCE --production-branch main`.
4. Run `npx wrangler pages deploy dist --project-name YOUR_INSTANCE --branch main`.
5. Point your launcher's `playerUrl` at `https://YOUR_INSTANCE.pages.dev`.

For Cloudflare Git integration: framework None, root `/`, build command `node scripts/build.mjs`, output directory `dist`, production branch `main`. Set `NODE_VERSION=24` if the builder uses an older runtime. The optional GitHub Actions deploy workflow uses repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and variable `CLOUDFLARE_PAGES_PROJECT` (default playdeck-1z1).

The proxy derives its host from each request, so previews and custom domains work without source changes. It rejects proxy loops, private network names/addresses and credential-bearing URLs. Optional `FRAME_ANCESTORS` restricts sandbox embedding. Run Playdeck on its own origin, apart from your launcher and other applications.

## Storage

Each instance has its own browser-origin storage. Existing key names are retained, but a new origin cannot read old Timebomb downloads, cookies or saves. Games download again on the new instance; exports from games must be imported manually where supported. Game support still depends on the browser's graphics, memory and input capabilities.

## Structure

- `website/`: player, sandbox and Pages worker
- `tests/`: standalone regression suite
- `scripts/build.mjs`: build and public downloadable bundles
- `dist/`: generated deployment output, ignored by Git

Toolbar icons use Lucide Icons under the ISC License: https://lucide.dev/
