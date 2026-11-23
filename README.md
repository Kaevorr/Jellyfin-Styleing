# Jellyfin Cinematic

A black and crimson theme for the existing Jellyfin Web interface. The theme includes a mountain welcome banner, app-style library tiles, cinematic media shelves, updated movie and series browsing, and a Music dashboard built around Jellyfin's own library and player.

| File | Use |
| --- | --- |
| [theme.css](theme.css) | Complete stylesheet. Add the hosted import from [INSTALL.md](INSTALL.md) to Jellyfin's Custom CSS field. |
| [js/enhancements.js](js/enhancements.js) | Optional enhancement. Adds the dynamic Home welcome title and full Music dashboard through a compatible JavaScript injector. |
| [assets/hero](assets/hero) | Original Home and Music panoramic art. Each SVG wraps a self-contained WebP. |
| [assets/icons](assets/icons) | Editable SVG source files for the three library icons. Copies are embedded in the stylesheet. |

See [the two dashboard links](INSTALL.md) and the [changelog](CHANGELOG.md).

## Compatibility

The source target is **Jellyfin Web 12.4**, with the Modern desktop and mobile layouts. The CSS styles the native client on its own. The Music dashboard and dynamic Home title use the optional script. This repository's GitHub Pages site serves the stylesheet, script, and artwork. The images also have illustrated fallbacks. [Jellyfin Web 12.4 source](https://github.com/jellyfin/jellyfin-web/tree/v12.4)

Music reads up to 24 recently added albums and 24 artists from the selected library through Jellyfin's signed-in client. The redesigned shelves stay visible when the library is empty. With music present, the native album browser remains underneath. All eight sidebar destinations use Jellyfin's native Modern routes. Recently Played opens Suggestions and shows the signed-in listener's playback history. Home fetches the server name through the public System Info endpoint once per load. [Modern Music views](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/apps/modern/features/libraries/constants/views/music.ts)

The legacy layout adapter remains available. Current verification targets 12.4 Modern in a web browser. Browser wrappers and TV layouts can expose different behavior. The optional script tracks route changes and removes its Music UI when leaving the page. Jellyfin Web needs a browser with support for `:has()`.

At widths up to 42em, Modern Music uses compact, swipeable library links and artwork rows. **All Songs** opens Jellyfin's complete Songs view for the selected library, with its own sorting, filters, and playback controls.

## Development verification

The [compatibility check](tests/verify-web-12.4.cjs) runs against the compiled official Web 12.4 frontend and mocked Jellyfin API responses. It covers directly opening Music, empty and populated shelves, native navigation and history, the Home name under a base path, mobile widths, and removing the theme. The plugin's server middleware and live playback still need verification on the target machine.

For local development, build the official `v12.4` checkout with `npm ci` and `npm run build:development`. With Playwright installed and its Chromium browser available, run `node tests/verify-web-12.4.cjs . /path/to/jellyfin-web/dist`.
Set `JFC_THEME_BASE_URL=https://kaevorr.github.io/Jellyfin-Styleing/` to exercise the hosted files in the same browser check.
