# Install Jellyfin Cinematic on Jellyfin 12.4

## Before you start

This guide uses your existing Nginx virtual host to serve the theme on the same origin as Jellyfin. GitHub remains the source for CSS, JavaScript, and artwork. Use the URL you normally open through Nginx, including any Jellyfin base path. The theme asset URLs start at `/jellyfin-cinematic/` even if Jellyfin itself lives under `/jellyfin/`.

### One-time Nginx setup on Debian 13

Run these commands as root. If the packages are already installed, skip the first command. Read the helper before installing it. Future synchronization runs download theme assets only.

```sh
apt install ca-certificates curl git python3
curl --fail --silent --show-error --proto '=https' \
  -o /tmp/jellyfin-cinematic-sync.sh \
  https://raw.githubusercontent.com/Kaevorr/Jellyfin-Styleing/main/scripts/sync-nginx.sh
less /tmp/jellyfin-cinematic-sync.sh
install -d /usr/local/libexec
install -m 0755 /tmp/jellyfin-cinematic-sync.sh /usr/local/libexec/jellyfin-cinematic-sync
/usr/local/libexec/jellyfin-cinematic-sync
```

In the existing Nginx `server { ... }` block that serves Jellyfin to browsers, add this location. If your Nginx runs in a container, expose the release directory to it at the same path.

```nginx
location ^~ /jellyfin-cinematic/ {
    alias /var/www/jellyfin-cinematic/current/;
    autoindex off;
    expires -1;
    etag off;
    if_modified_since off;

    types {
        text/css css;
        application/javascript js;
        image/svg+xml svg;
    }
}
```

Check your Nginx configuration before reloading it.

```sh
nginx -t && systemctl reload nginx
```

Replace `https://jellyfin.example.com` with your actual Nginx origin. Check that CSS returns `200` with `text/css` and JavaScript returns `200` with `application/javascript`.

```sh
curl -fsSI https://jellyfin.example.com/jellyfin-cinematic/theme.css
curl -fsSI https://jellyfin.example.com/jellyfin-cinematic/js/enhancements.js
```

## Part 1 · Install the CSS theme

Open **Dashboard → Branding → Custom CSS**. Save a copy of your old CSS if you want to keep it. Replace any earlier Cinematic import with this line, save, and reload Jellyfin Web.

```css
@import url("/jellyfin-cinematic/theme.css");
```

Keep CSS imports first if you have other custom rules. The CSS alone styles Home, the app bar, library cards, Movies, TV, details, and playback. The Home title uses its default until the enhancement script retrieves the server name. [Jellyfin CSS documentation](https://jellyfin.org/docs/general/clients/css-customization/)

## Part 2 · Configure JavaScript Injector

1. In **Dashboard → Plugins**, install the 12.x build of **JavaScript Injector** from the plugin author's catalog, then restart Jellyfin if you just installed or upgraded the plugin. The catalog lists **4.1.0.0** for the Jellyfin 12 ABI. Leave the plugin's request-time middleware enabled. [Injector documentation](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector) · [Plugin catalog](https://github.com/n00bcodr/jellyfin-plugins)
2. Open **JS Injector** in the dashboard. Disable any earlier Cinematic entry so only one copy loads. Choose **Add Script** and set these fields.

| Setting | Value |
| --- | --- |
| Script Name | Jellyfin Cinematic |
| Script URL | `/jellyfin-cinematic/js/enhancements.js` |
| JavaScript Code | Empty |
| Enabled | On |
| Load as module | Off |
| Allow external script URLs | Off works for this same-origin path |

3. Save and hard refresh the browser. Saving the script entry does not require a Jellyfin restart. The plugin inserts a normal script tag and the browser loads this URL. GitHub Raw serves the source with `text/plain` and `nosniff`, so use the Nginx URL shown here. [Injector script loader source](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector/blob/4.1.0.0/Jellyfin.Plugin.JavaScriptInjector/Controllers/CustomJavaScriptController.cs)

## Part 3 · Optional GitHub synchronization

Run `/usr/local/libexec/jellyfin-cinematic-sync` for a manual update. It fetches one HTTPS Git revision, validates the required files, and switches the symlink for an entire release only after staging succeeds. It saves the preceding release and prints failures without switching to an incomplete download.

To opt in to daily updates, create a service and timer.

```sh
cat > /etc/systemd/system/jellyfin-cinematic-sync.service <<'EOF'
[Unit]
Description=Synchronize Jellyfin Cinematic theme assets from GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/libexec/jellyfin-cinematic-sync
EOF

cat > /etc/systemd/system/jellyfin-cinematic-sync.timer <<'EOF'
[Unit]
Description=Check daily for Jellyfin Cinematic updates

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now jellyfin-cinematic-sync.timer
```

To disable scheduled updates, run `systemctl disable --now jellyfin-cinematic-sync.timer`. View logs with `journalctl -u jellyfin-cinematic-sync.service -n 40`.

## Part 4 · Verify installation

- **Home** shows the crimson banner, **WELCOME TO**, and the name returned by your Jellyfin server. Open **Settings → Home** and enable **My Media**, **Continue Watching**, and **Recently Added Media** to populate the matching sections. Existing item actions and playback remain in Jellyfin.
- **Music** shows a sidebar, a red-moon banner, four shortcuts, and the album and artist shelves on Albums. With an empty library you should see the headphones and microphone empty states. If your profile opens another Music view by default, choose **Albums** in the sidebar.
- **CSS check** in the browser's Network panel, reload and look for `/jellyfin-cinematic/theme.css`, status `200`, MIME type `text/css`. In the Console, `getComputedStyle(document.documentElement).getPropertyValue('--jfc-theme-version').trim()` should return `"3"`.
- **JS check** in the Network panel, look for `/jellyfin-cinematic/js/enhancements.js`, status `200`, MIME type `application/javascript`. Run `window.JellyfinCinematic?.status()` in the Console to see the detected route, initialized enhancements, and anything the script is waiting for. If it returns `undefined`, check the injector settings, browser Console, and older Cinematic entries.
- **Debug logs** append `?debug` to the Script URL and reload. The Console shows detection results and asset or API failures. Remove `?debug` afterward. Failed shelf requests show **Retry**. A screenshot of the Console plus the Network status and MIME type helps distinguish a script-load issue from a frontend or API issue.

## Part 5 · Update or roll back

Changes on GitHub are applied the next time you run the helper or the timer runs. Keep the same CSS and JS URLs. Refresh Jellyfin Web after an update.

To switch back, disable scheduled updates first if enabled, then run:

```sh
/usr/local/libexec/jellyfin-cinematic-sync --rollback
```

Reload Jellyfin Web. The previous release is available after at least one successful update.

## Part 6 · Uninstall

1. Disable the Cinematic script entry in JS Injector.
2. Remove the Cinematic import from **Dashboard → Branding → Custom CSS** or restore the CSS you saved.
3. Reload Jellyfin Web. If you set up the optional timer, disable it. You can remove the Cinematic Nginx location once the clients stop using it. Check with `nginx -t` before reloading Nginx.
