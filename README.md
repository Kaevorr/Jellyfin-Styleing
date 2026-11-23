# Jellyfin Cinematic

A black and crimson theme for the existing Jellyfin Web interface. The theme includes a mountain welcome banner, app-style library tiles, cinematic media shelves, updated movie and series browsing, and a Music dashboard built around Jellyfin's own library and player.

| File | Use |
| --- | --- |
| [theme.css](theme.css) | Complete stylesheet, applied from GitHub through the CSS installer. |
| [scripts/install-css.py](scripts/install-css.py) | Installs the latest GitHub stylesheet through Jellyfin's Branding API and saves a CSS backup. |
| [js/enhancements.js](js/enhancements.js) | Optional enhancement. Adds the Home shortcuts and full Music dashboard through a compatible JavaScript injector. |
| [assets/hero](assets/hero) | Original Home and Music panoramic art. Each SVG wraps a self-contained WebP. |
| [assets/icons](assets/icons) | Editable SVG source files for the three library icons. Copies are embedded in the stylesheet. |
| [scripts/optional-sync.sh](scripts/optional-sync.sh) | Optional download helper. Stages the latest CSS and JS from one GitHub revision. |

See [installation, updating, and rollback](INSTALL.md) and the [changelog](CHANGELOG.md).

## Compatibility

The source target is **Jellyfin Web 10.11.11**, standard desktop and mobile browser layouts. The CSS styles the native client on its own. The full Music redesign needs the optional script and a concrete Music library. The default assets load from GitHub Raw with illustrated fallbacks. The stylesheet and script are each maintained as a single complete file. [Jellyfin Web source](https://github.com/jellyfin/jellyfin-web/tree/v10.11.11)

Music reads up to 24 recently created albums and 24 artists from the selected library through the active Jellyfin client's existing methods. Shelves load once when Albums is opened during each visit. The native Albums tab remains available beneath them, including its filters, sorting and play controls. Other sidebar destinations are the native Music tabs. Collections opens the current profile's native Collections view or its native list of accessible collections. Recently Played opens Suggestions and scrolls to Jellyfin's history section when it has content. Media permissions and the native player still belong to Jellyfin. [Music controller](https://github.com/jellyfin/jellyfin-web/blob/v10.11.11/src/controllers/music/musicrecommended.js)

Different Jellyfin versions, experimental layouts, native apps, and TV layout may use different markup. The optional script keeps enhancements scoped to recognized pages and the active user, and clears its Music UI on route changes. Jellyfin Web must support modern CSS including `:has()`.

## Development verification

Local tests use fixtures built from the 10.11.11 Home and Music markup and upstream styles, with mocked library data and native-tab callbacks. A functioning Jellyfin server is still needed to verify the injector, server responses, real playback, and per-profile configuration. No live server is required for editing the theme.
