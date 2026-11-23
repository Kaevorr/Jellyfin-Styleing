# Install Jellyfin Cinematic

## CSS

1. Download [theme.css from GitHub Raw](https://raw.githubusercontent.com/Kaevorr/Jellyfin-Styleing/main/theme.css). Save a copy of your current CSS for rollback.
2. Open Jellyfin Web as an administrator and go to **Dashboard → Branding → Custom CSS**. Paste the entire downloaded CSS, save, and reload the client.
3. For just one profile, use that profile's **Settings → Display → Custom CSS** instead. If a server-wide stylesheet conflicts, enable **Disable server-provided custom CSS code** for that profile.

Direct GitHub Raw CSS imports and JavaScript tags are unsupported for this theme. Raw is the download source. Paste the files into Jellyfin's Custom CSS and the injector respectively. The stylesheet uses Raw only for the two hero image URLs. The small icons and the banner fallbacks are built in. [Jellyfin CSS customization](https://jellyfin.org/docs/general/clients/css-customization/)

In **Settings → Home**, enable **My Media** or **My Media (small)**, **Continue Watching**, and **Recently Added Media**. Arrange them in that order to match the reference. The customized tiles preserve the configured library names and order. The `--jfc-hero-image` and `--jfc-music-image` variables near the top of the CSS point at the two included Raw assets. Set either to `none` to use the offline fallback.

## JavaScript and full Music layout

For the 10.11 server line, the 4.1.0.0 release of the optional **JavaScript Injector** plugin lists a compatible build. Use its default request-time middleware, with `DisableScriptInjectionMiddleware` left false. If that mode is unavailable for your server version, the CSS-only installation remains usable. [Injector setup](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector#installation) · [Middleware source](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector/blob/4.1.0.0/Jellyfin.Plugin.JavaScriptInjector/PluginServiceRegistrator.cs)

1. In **Dashboard → Plugins → Catalog → Repositories**, add the injector author's plugin manifest. This is the optional injector catalog, not a theme hosting location.

   ```text
   https://raw.githubusercontent.com/n00bcodr/jellyfin-plugins/main/manifest.json
   ```

2. Install **JavaScript Injector**, restart Jellyfin, and open **JS Injector** in the dashboard.
3. Choose **Add Script** and name it **Jellyfin Cinematic**. Download [js/enhancements.js from GitHub Raw](https://raw.githubusercontent.com/Kaevorr/Jellyfin-Styleing/main/js/enhancements.js) and paste the entire file into **JavaScript Code**. Leave **Script URL** blank and **Load as module** off. Enable it, save, and reload.
4. Open Music from a real Music library tile. **Albums** shows the two new shelves. If the library normally opens another tab, select **Albums** in the Music sidebar. **Collections** uses the existing Collections entry when available and otherwise opens the native list of accessible collections.

## Updates

Download both Raw files again after a repository update. Save copies of the currently installed CSS and JavaScript before replacing them in their respective settings. Reload the browser after saving. Pin both downloads to the same commit SHA in place of `main` if you need a reproducible version.

The optional helper downloads and stages matching CSS and JavaScript into a new private directory. It needs Git and curl, uses public GitHub files, and requires no Jellyfin credentials. Run it explicitly and paste the staged files into the same two settings. Keep a copy of the CSS and script already installed before applying the staged files.

```sh
sh scripts/optional-sync.sh "$PWD/cinematic-updates"
```

## Verify and troubleshoot

| Check | What to look for |
| --- | --- |
| Home | Movies, Shows, and Music tiles open their original libraries. Search, profile, Favorites and playback still work. |
| Music | Albums and artists show library data or an accurate empty state. Press the arrow buttons on populated shelves and open a real album or artist. Switch to Songs or Playlists and use the existing Jellyfin player and queue. |
| Empty Music shelves | The headphones and microphone messages describe an empty response. A **Retry** button means Jellyfin returned an error. Confirm the signed-in profile can browse that library and check the browser console. |
| Missing Music dashboard | Confirm that the CSS and JS are both enabled and current, that the route opened from a Music library, and that your web version matches the target. |
| Banner fallback | Open the two image URLs directly. A proxy, blocked GitHub access, or a content security policy can prevent image requests. The illustration remains available offline. |
| Layout or controls | Reload the browser after changing either file. Temporarily disable other themes or Home plugins to check whether their styles or scripts conflict. |

## Disable or roll back

1. Disable or delete the Cinematic entry in **JS Injector**.
2. Remove the CSS from **Dashboard → Branding**, or from **Settings → Display** if installed there. Restore your saved CSS and profile preference, or leave the custom CSS field empty for Jellyfin's stock appearance.
3. Reload open client tabs. To roll back to an earlier Cinematic version, restore both earlier files before re-enabling the script.
