(async function () {
    const fs = require('node:fs'),
        path = require('node:path'),
        http = require('node:http'),
        assert = require('node:assert/strict');
    const { chromium, firefox, webkit } = require('playwright');
    const browserType = { chromium, firefox, webkit }[
        process.env.JFC_BROWSER || 'chromium'
    ];
    const [repo, dist] = process.argv.slice(2);
    const fixtureThemeBase = '/_test-theme/';
    const themeBase = process.env.JFC_THEME_BASE_URL || fixtureThemeBase;
    const cssUrl = themeBase + 'theme.css';
    const scriptUrl = themeBase + 'js/enhancements.js?debug';
    assert(
        repo && dist && fs.existsSync(path.join(dist, 'index.html')),
        'Pass the theme repository and the compiled Jellyfin Web 12.4 dist directory.',
    );
    const id = '1'.repeat(32),
        userId = '2'.repeat(32),
        musicId = '3'.repeat(32),
        moviesId = '4'.repeat(32),
        tvId = '5'.repeat(32);
    let serverName = 'House <Cinema>',
        populated = false,
        css = true,
        inject = true,
        failArtists = false;
    const items = [
        ['music', 'Music', musicId],
        ['movies', 'Movies', moviesId],
        ['tvshows', 'Shows', tvId],
        ['playlists', 'Playlists', '7'.repeat(32)],
    ].map(([CollectionType, Name, Id]) => ({
        Id,
        Type: 'CollectionFolder',
        CollectionType,
        Name,
        IsFolder: true,
        ServerId: id,
    }));
    const user = {
        Id: userId,
        Name: 'Fixture',
        ServerId: id,
        Policy: {
            IsAdministrator: true,
            EnableMediaPlayback: true,
            EnabledFolders: [],
            EnableAllFolders: true,
        },
        Configuration: {
            DisplayMissingEpisodes: false,
            LatestItemsExcludes: [],
            MyMediaExcludes: [],
            SubtitleMode: 'Default',
        },
    };
    const resume = {
        Id: '6'.repeat(32),
        Name: 'Fixture Movie',
        Type: 'Movie',
        MediaType: 'Video',
        ServerId: id,
        UserData: { PlayedPercentage: 42, PlaybackPositionTicks: 420000000 },
    };
    const mime = {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.html': 'text/html',
        '.woff2': 'font/woff2',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.webp': 'image/webp',
    };
    function entries(kind) {
        return populated
            ? Array.from({ length: 12 }, (_, i) => ({
                  Id: (i + 60).toString(16).padStart(32, '0'),
                  Name: kind + ' ' + (i + 1),
                  AlbumArtist: 'Fixture Artist',
                  Type: kind,
                  IsFolder: kind !== 'Audio',
                  MediaType: 'Audio',
                  ServerId: id,
                  ImageTags: { Primary: 'fixture' },
              }))
            : [];
    }
    const requestLog = [];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1'),
            route = decodeURIComponent(url.pathname);
        const send = (body, type, status = 200) => {
            res.writeHead(status, {
                'Content-Type': type,
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store',
            });
            res.end(body);
        };
        const json = (value, status = 200) =>
            send(JSON.stringify(value), 'application/json', status);
        const result = (items = []) => ({
            Items: items,
            TotalRecordCount: items.length,
            StartIndex: 0,
        });
        const file = (root, rel) => {
            const p = path.resolve(root, rel);
            if (
                !p.startsWith(path.resolve(root) + path.sep) ||
                !fs.existsSync(p) ||
                !fs.statSync(p).isFile()
            )
                return send('not found', 'text/plain', 404);
            send(
                fs.readFileSync(p),
                mime[path.extname(p)] || 'application/octet-stream',
            );
        };
        if (
            route === '/jellyfin/web/' ||
            route === '/jellyfin/web/index.html'
        ) {
            let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
            if (inject)
                html = html.replace(
                    '</body>',
                    `<script>(function(){var s=document.createElement('script');s.src=${JSON.stringify(scriptUrl)};document.head.appendChild(s);})();</script></body>`,
                );
            return send(html, 'text/html');
        }
        if (route.startsWith('/jellyfin/web/'))
            return file(dist, route.slice('/jellyfin/web/'.length));
        if (route.startsWith(fixtureThemeBase))
            return file(repo, route.slice(fixtureThemeBase.length));
        if (!route.startsWith('/jellyfin/'))
            return send('not found', 'text/plain', 404);
        const p = route.slice('/jellyfin'.length),
            low = p.toLowerCase();
        requestLog.push(p + url.search);
        if (low === '/system/info/public' || low === '/system/info')
            return json({
                Id: id,
                ServerName: serverName,
                Version: '12.4',
                ProductName: 'Jellyfin Server',
                StartupWizardCompleted: true,
                LocalAddress: 'http://' + req.headers.host + '/jellyfin',
            });
        if (low === '/system/ping')
            return send('Jellyfin Server', 'text/plain');
        if (low === '/branding/configuration')
            return json({
                CustomCss: css ? `@import url("${cssUrl}");` : '',
                SplashscreenEnabled: false,
            });
        if (low === '/branding/splashscreen')
            return send('', 'text/plain', 404);
        if (low === '/users/authenticatebyname')
            return json({
                User: user,
                AccessToken: 'mock-token',
                ServerId: id,
                SessionInfo: {},
            });
        if (low === '/users/public') return json([user]);
        if (low.includes('displaypreferences'))
            return json({
                Id: 'usersettings',
                SortBy: 'SortName',
                SortOrder: 'Ascending',
                CustomPrefs: {},
            });
        if (low.includes('/images/'))
            return file(repo, 'assets/hero/music-moon.svg');
        if (low === '/users/me' || low === '/users/' + userId)
            return json(user);
        if (low.endsWith('/views') || low === '/userviews')
            return json(result(items));
        if (low.endsWith('/items/latest')) return json([]);
        if (low.endsWith('/ancestors')) return json([]);
        if (low.includes('/artists')) {
            return failArtists
                ? json({ Message: 'Fixture error' }, 503)
                : json(result(entries('MusicArtist')));
        }
        if (low === '/useritems/resume' || low.endsWith('/items/resume')) {
            return json(
                result(
                    url.searchParams.get('mediaTypes') === 'Video'
                        ? [resume]
                        : [],
                ),
            );
        }
        if (low.endsWith('/episodes') || low.endsWith('/nextup'))
            return json(result());
        if (low.endsWith('/items')) {
            const kind =
                url.searchParams.get('IncludeItemTypes') ||
                url.searchParams.get('includeItemTypes');
            return json(
                result(
                    ['MusicAlbum', 'MusicArtist', 'Audio'].includes(kind)
                        ? entries(kind)
                        : [],
                ),
            );
        }
        if (low.includes('/items/')) {
            const iid = p.split('/').at(-1);
            return json(
                items.find((x) => x.Id === iid) || {
                    Id: iid,
                    Name: 'Fixture Details',
                    Type: 'Movie',
                    MediaType: 'Video',
                    ServerId: id,
                    UserData: { Played: false },
                    MediaSources: [],
                },
            );
        }
        if (low === '/items/filters2' || low === '/items/filters')
            return json({
                Genres: [],
                Tags: [],
                OfficialRatings: [],
                Years: [],
            });
        if (
            low === '/studios' ||
            low.includes('/genres') ||
            low.includes('/search')
        )
            return json(result());
        if (req.method !== 'GET') return send('', 'text/plain', 204);
        return json([]);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await browserType.launch(
        process.env.JFC_CHROME_CHANNEL
            ? { channel: process.env.JFC_CHROME_CHANNEL }
            : {},
    );
    try {
        const context = await browser.newContext({
            viewport: { width: 1600, height: 1000 },
            serviceWorkers: 'block',
        });
        await context.addInitScript(
            ({ base, id, userId }) => {
                localStorage.setItem('layout', 'modern');
                localStorage.setItem(
                    'jellyfin_credentials',
                    JSON.stringify({
                        Servers: [
                            {
                                Id: id,
                                Name: 'Fixture',
                                UserId: userId,
                                AccessToken: 'mock-token',
                                ManualAddress: base + '/jellyfin',
                                LastConnectionMode: 2,
                                DateLastAccessed: Date.now(),
                            },
                        ],
                    }),
                );
            },
            { base, id, userId },
        );
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.stack));
        page.setDefaultTimeout(14000);
        const music =
            '#/music?topParentId=' + musicId + '&collectionType=music';
        async function open(route) {
            await page.goto(base + '/jellyfin/web/index.html' + route);
        }
        await open(music);
        try {
            await page.getByText('No albums found', { exact: true }).waitFor();
        } catch (e) {
            console.log(
                'DEBUG',
                page.url(),
                (await page.locator('body').innerText()).slice(0, 1500),
                await page.evaluate(() => ({
                    jfc: window.JellyfinCinematic?.status(),
                    api: window.ApiClient?.getCurrentUserId?.(),
                })),
                errors,
                requestLog.slice(-30),
            );
            throw e;
        }
        assert.equal(
            await page.locator('#musicPage .jfc-music-hero h1').innerText(),
            'Music',
        );
        assert.equal(await page.locator('.jfc-music-shortcuts > a').count(), 4);
        assert.equal(
            await page.locator('.jfc-music-side-links > a').count(),
            8,
        );
        await page.getByText('No artists found', { exact: true }).waitFor();
        const globalPlaylistEntry = page.locator(
            '.MuiAppBar-root a[href^="#/playlists?"]',
        );
        await globalPlaylistEntry.waitFor({ state: 'attached' });
        assert.equal(await globalPlaylistEntry.isVisible(), false);
        await page
            .locator('.jfc-music-side-links')
            .getByText('Playlists', { exact: true })
            .click();
        await page.waitForURL('**&tab=4');
        await page.getByRole('link', { name: 'All playlists' }).click();
        await page.locator('#playlistsPage').waitFor();
        await page.getByRole('button', { name: 'New Playlist' }).click();
        const playlistName = page.locator('#txtNewPlaylistName');
        await playlistName.waitFor();
        const playlistDialog = page
            .locator('.dialog.formDialog')
            .filter({ has: playlistName });
        assert.match(
            await playlistDialog.evaluate(
                (node) => getComputedStyle(node).backgroundImage,
            ),
            /linear-gradient/,
        );
        const addButton = playlistDialog.getByRole('button', {
            name: 'Add',
            exact: true,
        });
        assert.match(
            await addButton.evaluate(
                (node) => getComputedStyle(node).backgroundImage,
            ),
            /linear-gradient/,
        );
        await playlistName.focus();
        assert.equal(
            await playlistName.evaluate(
                (node) => getComputedStyle(node).borderTopColor,
            ),
            'rgb(255, 104, 119)',
        );
        await playlistDialog.locator('.btnCancel').click();
        await playlistName.waitFor({ state: 'hidden' });
        await page.goBack();
        await page.getByRole('link', { name: 'All playlists' }).waitFor();
        await page.goBack();
        await page.getByText('No albums found', { exact: true }).waitFor();
        assert.equal(
            await page
                .locator('button[aria-controls="library-view-menu"]')
                .isVisible(),
            false,
        );
        if (process.env.JFC_SCREENSHOTS)
            await page.screenshot({
                path: path.join(process.env.JFC_SCREENSHOTS, 'music-v12-4.png'),
            });
        await page
            .locator('.jfc-music-side-links')
            .getByText('Collections', { exact: true })
            .click();
        await page.waitForURL('**&tab=7');
        await page
            .locator('.jfc-music-side-links a[aria-current]')
            .filter({ hasText: 'Collections' })
            .waitFor();
        await page.goBack();
        await page.getByText('No albums found', { exact: true }).waitFor();
        await page
            .locator('.jfc-music-shortcuts')
            .getByText('Recently Played', { exact: true })
            .click();
        await page.getByText('No tracks found', { exact: true }).waitFor();
        assert.equal(await page.locator('.jfc-music-hero').count(), 1);
        await page.evaluate(
            (value) => {
                location.hash = value;
            },
            '#/movies?topParentId=' + moviesId + '&collectionType=movies',
        );
        await page.locator('#moviesPage').waitFor();
        await page.locator('.jfc-music-hero').waitFor({ state: 'detached' });
        await page.evaluate(
            (value) => {
                location.hash = value;
            },
            '#/tv?topParentId=' + tvId + '&collectionType=tvshows',
        );
        await page.locator('#tvshowsPage').waitFor();
        await page.evaluate(() => {
            location.hash = '#/home';
        });
        await page
            .locator('#homeTab .jfc-hero-title')
            .filter({ hasText: 'House <Cinema>' })
            .waitFor();
        assert.equal(await page.locator('.jfc-hero-title *').count(), 0);
        const playlistTile = page.locator(
            '#homeTab .card[data-collectiontype="playlists"]',
        );
        await playlistTile.waitFor({ state: 'attached' });
        assert.equal(await playlistTile.isVisible(), false);
        const progress = page.locator('#homeTab .itemProgressBarForeground');
        await progress.waitFor();
        assert.match(await progress.getAttribute('style'), /42%/);
        assert.match(
            await progress.evaluate(
                (node) => getComputedStyle(node).backgroundImage,
            ),
            /linear-gradient/,
        );
        await page.waitForFunction(
            () =>
                document.querySelectorAll('#homeTab .card[data-jfc-kind]')
                    .length === 3,
        );
        try {
            await page
                .locator('.jfc-hero-links a')
                .filter({ hasText: 'Music' })
                .click({ timeout: 4500 });
        } catch (e) {
            console.log(
                'HOME DEBUG',
                await page.locator('#homeTab').innerHTML(),
                errors,
                requestLog.slice(-40),
            );
            throw e;
        }
        await page.locator('#musicPage .jfc-music-hero').waitFor();
        populated = true;
        // The official client persists the earlier empty library response across reloads.
        await page.evaluate(() => new Promise((resolve, reject) => {
            const request = indexedDB.open('keyval-store');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('keyval', 'readwrite');
                tx.objectStore('keyval').delete('jellyfin-query-cache');
                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };
                tx.onerror = () => reject(tx.error);
            };
        }));
        await page.reload();
        await page
            .locator('#jfc-music-albums .jfc-music-card')
            .first()
            .waitFor();
        await page
            .locator('#jfc-music-artists .jfc-music-card')
            .first()
            .waitFor();
        assert.equal(await page.locator('.jfc-music-card').count(), 24);
        assert.equal(
            await page
                .locator('#jfc-music-albums .jfc-music-card-artist')
                .first()
                .innerText(),
            'Fixture Artist',
        );
        await page.setViewportSize({ width: 390, height: 844 });
        const musicLinks = page.getByRole('navigation', { name: 'Music library' });
        const allSongs = musicLinks.getByRole('link', { name: 'All Songs', exact: true });
        await allSongs.waitFor();
        assert.equal(await musicLinks.getByRole('link').first().innerText(), 'All Songs');
        assert.equal(await musicLinks.getByRole('link', { name: 'Albums', exact: true }).getAttribute('aria-current'), 'page');
        const mobileAlbums = page.locator('#musicPage .padded-bottom-page .card[data-type="MusicAlbum"]');
        await mobileAlbums.first().waitFor();
        assert.equal(
            await mobileAlbums.first().locator('.cardBox').evaluate(box => getComputedStyle(box).gridTemplateColumns.split(' ')[0]),
            '56px',
        );
        assert.equal(
            await mobileAlbums.first().locator('.cardText-secondary').first().evaluate(el => getComputedStyle(el).gridColumnStart),
            '2',
        );
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth),
            390,
        );
        if (process.env.JFC_SCREENSHOTS)
            await page.screenshot({
                path: path.join(
                    process.env.JFC_SCREENSHOTS,
                    'music-v12-4-mobile.png',
                ),
            });
        await allSongs.click();
        await page.waitForURL(/tab=5/);
        await page.locator('#musicPage .padded-bottom-page').getByText('Audio 1', { exact: true }).waitFor();
        assert.equal(await allSongs.getAttribute('aria-current'), 'page');
        await page.goBack();
        await mobileAlbums.first().waitFor();
        await page.setViewportSize({ width: 1366, height: 768 });
        await musicLinks.getByRole('link', { name: 'Songs', exact: true }).waitFor();
        assert.equal(await musicLinks.getByRole('link').first().innerText(), 'Albums');
        failArtists = true;
        await page.reload();
        await page
            .getByText('Could not load artists', { exact: true })
            .waitFor();
        assert(
            (
                await page.evaluate(() => window.JellyfinCinematic.status())
            ).failures.some((message) => message.startsWith('Music artists:')),
        );
        failArtists = false;
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await page
            .locator('#jfc-music-artists .jfc-music-card')
            .first()
            .waitFor();
        serverName = 'Renamed Fixture';
        await open('#/home');
        await page
            .locator('.jfc-hero-title')
            .filter({ hasText: 'Renamed Fixture' })
            .waitFor();
        css = false;
        await page.evaluate((stylesheet) => {
            for (const style of document.querySelectorAll('style')) {
                if (style.textContent.includes(stylesheet)) style.remove();
            }
        }, cssUrl);
        await page.evaluate((value) => {
            location.hash = value;
        }, music);
        await page.locator('#musicPage').waitFor();
        await page.waitForFunction(
            () => window.JellyfinCinematic?.status().css === false,
        );
        assert.equal(await page.locator('.jfc-music-hero').count(), 0);
        assert(
            await page
                .locator('button[aria-controls="library-view-menu"]')
                .isVisible(),
        );
        css = true;
        inject = false;
        await page.reload();
        await page.waitForFunction(
            () =>
                getComputedStyle(document.documentElement)
                    .getPropertyValue('--jfc-theme-version')
                    .trim() === '3',
        );
        await page.locator('button[aria-controls="library-view-menu"]').click();
        const menuItem = page.locator(
            '#library-view-menu .MuiMenuItem-root.Mui-selected',
        );
        await menuItem.waitFor();
        assert.match(
            await menuItem.evaluate(
                (node) => getComputedStyle(node).backgroundImage,
            ),
            /linear-gradient/,
        );
        await page
            .locator('#library-view-menu')
            .getByRole('menuitem', { name: 'Songs' })
            .click();
        await page.waitForURL('**&tab=5');
        assert.deepEqual(errors, []);
        console.log(
            browserType.name() +
                ' passed Jellyfin Web 12.4 with a mock API (' +
                requestLog.length +
                ' requests).',
        );
    } finally {
        await browser.close();
        server.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
