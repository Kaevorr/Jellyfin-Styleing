# Install Jellyfin Cinematic

## Install the CSS from GitHub

The installer works with **Jellyfin Server 10.11.x** and applies the stylesheet server-wide through Jellyfin's Branding API. It downloads the latest CSS from `main`, saves your previous CSS to a local backup, and verifies the update. You need Python 3 and a terminal that can reach Jellyfin and GitHub. [Jellyfin Branding API source](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Api/Controllers/ConfigurationController.cs)

1. In Jellyfin's administrator dashboard, open **API Keys** and create a key named **Jellyfin Cinematic installer**.
2. Download the installer from GitHub and run it from your Debian terminal. Replace the example URL with your Jellyfin base URL, without `/web`. Keep any reverse-proxy prefix such as `/jellyfin`. Use `http://127.0.0.1:8096` if you are running the command on the Jellyfin machine and it listens on that port.

   ```sh
   curl --fail --show-error --silent --proto '=https' \
     --output jellyfin-install-css.py \
     https://raw.githubusercontent.com/Kaevorr/Jellyfin-Styleing/main/scripts/install-css.py
   python3 jellyfin-install-css.py 'https://jellyfin.example.com'
   ```

3. Enter the API key at the hidden prompt. Save the backup path the installer prints and reload Jellyfin Web. You can revoke the key in the dashboard when you finish.

GitHub Raw supplies the CSS as a download. Browsers block a direct `@import` because the response is `text/plain` with `nosniff`. Jellyfin serves the installed CSS through its own Branding endpoint. The two hero images load directly from GitHub Raw with built-in fallbacks. [Jellyfin CSS customization](https://jellyfin.org/docs/general/clients/css-customization/)

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

Run the installer again to apply the latest CSS from GitHub. It skips the write if it finds the same file already installed. For the optional JavaScript, update the existing entry in **JS Injector** with the latest downloaded script.

The optional download helper stages matching CSS and JavaScript from one GitHub revision into a private directory. It needs Git and curl and runs without Jellyfin credentials.

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
2. Restore the CSS backup by running the command below with the path printed by the installer. For the stock appearance, you can also clear the Custom CSS field under **Dashboard → Branding**.

   ```sh
   python3 jellyfin-install-css.py 'https://jellyfin.example.com' --restore '/path/to/previous.css'
   ```

3. Reload open Jellyfin Web tabs. To roll back to an earlier Cinematic version, restore the corresponding optional script before re-enabling it.
