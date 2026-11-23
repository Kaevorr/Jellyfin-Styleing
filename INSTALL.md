# Install Jellyfin Cinematic

For Jellyfin Web 12.4, add the theme through these two dashboard fields.

## 1. Custom CSS

In **Dashboard → Branding → Custom CSS**, replace any earlier Cinematic import with this line and save.

```css
@import url("https://kaevorr.github.io/Jellyfin-Styleing/theme.css");
```

Keep the import above any other CSS rules. For one profile, use **Settings → Display → Custom CSS**. [Jellyfin CSS documentation](https://jellyfin.org/docs/general/clients/css-customization/)

## 2. JS Injector Script URL

In **JS Injector**, enable **Allow external script URLs**. Open or add the **Jellyfin Cinematic** entry and put this URL into **Script URL**.

```text
https://kaevorr.github.io/Jellyfin-Styleing/js/enhancements.js
```

The URL ends in `.js` without a trailing slash. Leave **JavaScript Code** empty, leave **Load as module** off, and enable the entry. Disable any duplicate Cinematic entry. Save and hard-refresh Jellyfin Web. In **Music → Albums**, the sidebar, red-moon banner, and album and artist shelves should appear even when the library is empty. [JavaScript Injector documentation](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector)

## Update or remove

The links stay the same when an update publishes. Refresh Jellyfin Web to load the update. To switch themes, replace the links. To restore Jellyfin’s original appearance, remove the CSS import, disable the Cinematic script entry, and refresh.
