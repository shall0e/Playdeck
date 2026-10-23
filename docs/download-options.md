# Optional game downloads

Settings → Downloads has independent controls for optional texture packs, audio
and videos. All are included by default. Preferences are saved per game and
included in profile exports. Changing a control restarts that game; already saved
files remain available and re-enabling a category fetches only missing files.

This is one shared policy for all games, pages, direct workers and blob workers.
It never classifies files by game name, domain, extension or path. Unknown games
keep all their assets. Render resolution controls do not reduce download bytes.

## Loader integration

A compatible JSON manifest explicitly opts in with `playdeckDownloads.version: 1`.
Its loader must tolerate the absence of every file it marks optional. Required
archives must never be marked optional merely because they contain textures or
audio. Supply separate optional packs or safe replacement data first.

```json
{
  "version": "content-version",
  "playdeckDownloads": {"version": 1},
  "totalBytes": 120,
  "files": [
    {"path": "core.pack", "size": 100},
    {"path": "extra.pack", "size": 20, "optional": true, "category": "textures"}
  ]
}
```

Supported categories are `textures`, `audio`, `video`. Only `optional: true` files
in a disabled category are omitted. `fetch(...).json()` and cloned responses apply
the policy in game realms; other JSON and raw bytes are preserved. Custom loaders
can call `PlaydeckDownloads.selectManifest(manifest)` explicitly instead.
The result preserves content version and per-file hashes, recalculates
`totalBytes`, and adds `downloadSelection` with `choices`, `supported`, and
`omittedBytes`. Loaders should iterate the selected files, use their total for
storage/progress, and apply any engine-specific optional-content settings.
They must preserve completed-file journals by content hash so switching options
does not invalidate the required files. The original manifest stays cached; the
selection is applied separately for each launch.

## Current integration and limits

The hosted COD4 manifest declares its optional videos (1,322,197,368 bytes).
Disabling optional videos reduces its selected payload from 6,918,032,683 to
5,595,835,315 bytes, about 19.1%. Its loader records the selected video setting.
Required IWD/FF archives, texture data and audio remain included. Texture-free
COD4 downloads need safe repacked assets; deleting those archives would break the
game. Full 3D gameplay requires testing on a device with working graphics.

## Validation

Unit tests cover defaults, profile persistence, session routes, cache identity,
required-file retention, opt-in validation, byte totals, response clones and
serialization in pages/workers. Browser integration checks that disabled optional
files make zero requests, enabling them downloads the missing file, disabling them
again preserves the cache, and existing player features still work.
