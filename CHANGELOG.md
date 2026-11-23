# Changelog

## 2.1.0

- Added Jellyfin Web 12.4 Modern support for Music, the app bar, Movies, Shows, and progress indicators.
- Routed the Music sidebar to the eight native views and added authentic recently played results, album and artist shelves, and empty or retry states.
- Replaced the Home welcome title with the name returned by Jellyfin's public System Info endpoint.
- Added same-origin Nginx delivery for the CSS, artwork, and JS Injector script URL, with optional atomic GitHub synchronization and rollback.
- Added diagnostics and a browser check that runs the official Jellyfin Web 12.4 build.

## 2.0.0

- Added the crimson-moon Music banner, responsive sidebar, and four shortcuts to native library views.
- Added horizontally scrollable album and artist shelves with real artwork, item links, empty states, and retry controls.
- Unified the red and black palette across Home, Movies, Shows, detail pages, filter controls, media cards and the native audio player and queue.
- Retained the original Home artwork, library SVG tiles, Continue Watching and Latest shelves. Added active media navigation on supported library pages.
- Moved the optional script to `js/enhancements.js` and added GitHub Raw installation, update staging, and rollback instructions.
