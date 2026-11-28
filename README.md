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

Music reads up to 24 recently added albums and 24 artists from the selected library through Jellyfin's signed-in client. The redesigned shelves stay visible when the library is empty. With music present, the native album browser remains underneath. The sidebar keeps Jellyfin's eight native views and adds Music Playlists. Recently Played opens Suggestions and shows the signed-in listener's playback history. Home fetches the server name through the public System Info endpoint once per load. [Modern Music views](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/apps/modern/features/libraries/constants/views/music.ts)

The legacy layout adapter remains available. Current verification targets 12.4 Modern in a web browser. Browser wrappers and TV layouts can expose different behavior. The optional script tracks route changes and removes its Music UI when leaving the page. Jellyfin Web needs a browser with support for `:has()`.

At widths up to 42em, Modern Music uses compact, swipeable library links and artwork rows. **All Songs** opens Jellyfin's complete Songs view for the selected library, with its own sorting, filters, and playback controls.

**Movies & Shows** appears in the Modern navigation and on Home when the signed-in user has a movie or show library. The combined view opens without a category selected. Select **Movies** or **Shows** to narrow the view, or choose **Clear filter** to return. Select a title to open its native detail page. **Browse libraries** opens the complete Jellyfin library with its usual search, filters, and sorting.

The [Kaevorr JellyNext fork](https://github.com/Kaevorr/jellynext) can mount its Discovery shelves directly inside Movies & Shows. The unfiltered view shows both shelves. **Movies** and **Shows** show the corresponding shelf. The **Discovery** shortcut appears when a shelf is available. JellyNext supplies its own catalogs, recommendations, requests, and playback actions. Its appearance overrides can still be configured in JellyNext. [JellyNext setup and styling](https://github.com/Kaevorr/jellynext/blob/main/STYLING.md)

## Music Playlists

Open **Music → Music Playlists** to create, search, rename, delete, play, or shuffle a playlist. The Music dashboard also shows a shelf. Use **+ Music Playlist** from Songs, album tracks, or Recently Played to add a track to one or more playlists. The detail view supports drag reordering on desktop and move buttons on keyboard and touch. It keeps entries for missing or inaccessible tracks until you choose to remove them.

Playlists belong to the signed-in Jellyfin user. The theme stores an ordered list of audio item IDs in the `jfc-music-playlists` Display Preferences record for client `jellyfin-cinematic`. It preserves the other preferences in that record. Changes saved in the browser can be retried when server access returns. The theme merges compatible edits into a fresh server read and keeps conflicting local changes available until you resolve the conflict. Jellyfin exposes no conditional preference update, so writes made simultaneously on separate devices can still race. [Jellyfin Display Preferences controller](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/DisplayPreferencesController.cs)

These playlists are available in the Cinematic Music dashboard. Jellyfin's global playlists continue to use their own storage. Playback passes the validated, ordered audio items through Jellyfin Web 12.4's `playallfromhere` shortcut to its existing playback manager and queue. [Jellyfin shortcuts](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/components/shortcuts.js) · [Jellyfin playback manager](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/components/playback/playbackmanager.js)

## Development verification

The [compatibility check](tests/verify-web-12.4.cjs) runs against the compiled official Web 12.4 frontend and a local fixture API. It covers Music navigation, Home, mobile widths, theme removal, isolated playlist persistence and reconciliation, and native audio playback and queue reports using a generated audio fixture. The live server and JS Injector middleware are outside this test.

For local development, build the official `v12.4` checkout with `npm ci` and `npm run build:development`. With Playwright installed and its Chromium browser available, run `node tests/verify-web-12.4.cjs . /path/to/jellyfin-web/dist`.
Set `JFC_THEME_BASE_URL` to a compatible hosted theme directory to exercise that copy. The default fixture serves the repository files locally.
Set `JFC_JELLYNEXT_SCRIPT` to the fork's `Jellyfin.Plugin.JellyNext/Resources/discovery.js` to include its actual discovery client in the fixture. The fixture supplies mock catalog, permissions, recommendation, and request responses.
