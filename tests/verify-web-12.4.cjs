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
    const otherUser = { ...user, Id: '8'.repeat(32), Name: 'Other listener' };
    const playlistPrefs = new Map();
    const playlistWrites = [];
    const globalPlaylistWrites = [];
    const playbackReports = [];
    let failPlaylistWrite = false;
    let failPlaylistReads = false;
    const missingTrack = '9'.repeat(32);
    const silentAudio = Buffer.alloc(44 + 60 * 8000 * 2);
    silentAudio.write('RIFF', 0); silentAudio.writeUInt32LE(silentAudio.length - 8, 4);
    silentAudio.write('WAVEfmt ', 8); silentAudio.writeUInt32LE(16, 16);
    silentAudio.writeUInt16LE(1, 20); silentAudio.writeUInt16LE(1, 22);
    silentAudio.writeUInt32LE(8000, 24); silentAudio.writeUInt32LE(16000, 28);
    silentAudio.writeUInt16LE(2, 32); silentAudio.writeUInt16LE(16, 34);
    silentAudio.write('data', 36); silentAudio.writeUInt32LE(silentAudio.length - 44, 40);
    const resume = {
        Id: '6'.repeat(32),
        Name: 'Fixture Movie',
        Type: 'Movie',
        MediaType: 'Video',
        ServerId: id,
        UserData: { PlayedPercentage: 42, PlaybackPositionTicks: 420000000 },
    };
    const catalog = [
        { ...resume, Name: 'Featured Fixture Film', ProductionYear: 2025, BackdropImageTags: ['fixture'], DateCreated: '2025-11-01T00:00:00Z' },
        { Id: 'a'.repeat(32), Name: 'Fixture Series', Type: 'Series', ServerId: id, ProductionYear: 2024,
            BackdropImageTags: ['fixture'], ImageTags: { Primary: 'fixture' }, DateCreated: '2025-10-01T00:00:00Z' },
    ];
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
                  Id: (i + ({ Audio: 60, MusicAlbum: 160, MusicArtist: 260 })[kind]).toString(16).padStart(32, '0'),
                  Name: kind + ' ' + (i + 1),
                  AlbumArtist: 'Fixture Artist',
                  Type: kind,
                  IsFolder: kind !== 'Audio',
                  MediaType: 'Audio',
                  ServerId: id,
                  ImageTags: { Primary: 'fixture' },
                  Artists: ['Fixture Artist'],
                  ArtistItems: [{ Id: 'f'.repeat(32), Name: 'Fixture Artist' }],
                  AlbumArtists: [{ Id: 'f'.repeat(32), Name: 'Fixture Artist' }],
                  Album: 'Fixture Album',
                  RunTimeTicks: 600000000,
                  Container: 'wav',
                  UserData: { Played: true },
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
        function readJson(callback) {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => callback(JSON.parse(body)));
        }
        if (/^\/playlists(?:\/|$)/i.test(p) && !['GET', 'HEAD'].includes(req.method)) {
            globalPlaylistWrites.push(p);
        }
        if (low === '/displaypreferences/jfc-music-playlists') {
            const listener = url.searchParams.get('userId');
            if (url.searchParams.get('client') !== 'jellyfin-cinematic' || ![userId, otherUser.Id].includes(listener)) {
                return send('', 'text/plain', 400);
            }
            const fallback = { Id: '116a2', SortBy: 'SortName', CustomPrefs: { unrelated: 'preserved' } };
            if (req.method === 'GET') return failPlaylistReads ? send('', 'text/plain', 503) : json(playlistPrefs.get(listener) || fallback);
            return readJson(payload => {
                playlistWrites.push({ listener, payload, failed: failPlaylistWrite });
                if (failPlaylistWrite) return send('', 'text/plain', 503);
                playlistPrefs.set(listener, payload);
                return send('', 'text/plain', 204);
            });
        }
        if (low === '/sessions/playing' && req.method === 'POST') {
            return readJson(payload => {
                playbackReports.push(payload);
                send('', 'text/plain', 204);
            });
        }
        if (/^\/audio\/[^/]+\/(?:stream|universal)/i.test(p)) {
            res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': silentAudio.length });
            return res.end(silentAudio);
        }
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
        if (low === '/users/' + otherUser.Id) return json(otherUser);
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
                    (url.searchParams.get('mediaTypes') || url.searchParams.get('MediaTypes')) === 'Video'
                        ? [resume]
                        : [],
                ),
            );
        }
        if (low.endsWith('/episodes') || low.endsWith('/nextup') || low.endsWith('/similar') || low.endsWith('/seasons'))
            return json(result());
        if (low === '/livetv/programs') return json(result());
        if (low.endsWith('/items')) {
            const ids = url.searchParams.get('Ids') || url.searchParams.get('ids');
            if (ids) {
                return json(result(entries('Audio').filter(item => ids.split(',').includes(item.Id)).reverse()));
            }
            const parent = url.searchParams.get('ParentId') || url.searchParams.get('parentId');
            if (entries('MusicAlbum').some(item => item.Id === parent)) return json(result(entries('Audio')));
            const kind =
                url.searchParams.get('IncludeItemTypes') ||
                url.searchParams.get('includeItemTypes');
            return json(
                result(
                    ['Movie', 'Series'].includes(kind) ? catalog.filter(item => item.Type === kind) :
                    ['MusicAlbum', 'MusicArtist', 'Audio'].includes(kind)
                        ? entries(kind)
                        : [],
                ),
            );
        }
        if (low.includes('/items/')) {
            const iid = p.split('/').at(-1);
            return json(
                [...items, ...catalog, ...entries('MusicAlbum'), ...entries('Audio')].find((x) => x.Id === iid) || {
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
            9,
        );
        await page.locator('.jfc-music-playlist-shelf').getByText('No music playlists yet.').waitFor();
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
        assert.equal(await page.locator('#homeTab .jfc-hero a').count(), 0);
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
        for (const width of [1920, 390]) {
            await page.setViewportSize({ width, height: 900 });
            const art = await page.locator('#homeTab').evaluate(home => {
                const style = getComputedStyle(home);
                const tiles = home.querySelector('.card[data-jfc-kind]').parentElement;
                return {
                    image: style.backgroundImage,
                    height: parseFloat(style.backgroundSize.split(',')[2]?.trim().split(' ')[1]),
                    tilesBottom: tiles.getBoundingClientRect().bottom - home.getBoundingClientRect().top,
                    viewportWidth: document.documentElement.scrollWidth,
                };
            });
            assert.match(art.image, /home-crimson\.svg/);
            assert(art.height > art.tilesBottom, 'Home artwork should extend below the library tiles');
            assert.equal(art.viewportWidth, width);
            if (process.env.JFC_SCREENSHOTS)
                await page.screenshot({ path: path.join(process.env.JFC_SCREENSHOTS, `home-art-${width}.png`) });
        }
        await page.setViewportSize({ width: 1600, height: 1000 });
        const watchTile = page.locator('#homeTab .jfc-watch-tile');
        await watchTile.waitFor();
        assert.equal(await page.locator('.MuiAppBar-root .jfc-watch-tab').count(), 1);
        assert.equal(await page.locator('#homeTab .card[data-jfc-kind="movies"]').isVisible(), false);
        assert.equal(await page.locator('#homeTab .card[data-jfc-kind="tvshows"]').isVisible(), false);
        await watchTile.click();
        const watch = page.locator('.jfc-watch');
        const watchFilters = watch.getByRole('navigation', { name: 'Movies and shows filters' });
        await watch.getByRole('heading', { name: 'Featured Fixture Film', exact: true }).waitFor();
        await watch.getByRole('heading', { name: 'Recently Added Movies' }).waitFor();
        await watch.getByRole('heading', { name: 'Recently Added Shows' }).waitFor();
        assert.equal(await watch.locator('progress').getAttribute('value'), '42');
        assert.equal(await page.locator('.MuiAppBar-root .jfc-watch-tab').getAttribute('aria-current'), 'page');
        if (process.env.JFC_SCREENSHOTS)
            await page.screenshot({ path: path.join(process.env.JFC_SCREENSHOTS, 'watch-desktop.png') });
        await watchFilters.getByRole('link', { name: 'Shows', exact: true }).click();
        await watch.getByRole('heading', { name: 'Fixture Series', exact: true }).waitFor();
        assert.equal(await watch.getByRole('heading', { name: 'Recently Added Movies' }).count(), 0);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
        await page.getByRole('button', { name: 'Open Menu' }).click();
        const drawerWatch = page.locator('.MuiDrawer-root .jfc-watch-tab');
        await drawerWatch.click();
        await drawerWatch.waitFor({ state: 'hidden' });
        await watch.getByRole('heading', { name: 'Featured Fixture Film', exact: true }).waitFor();
        await watchFilters.getByRole('link', { name: 'Shows', exact: true }).click();
        await watch.getByRole('heading', { name: 'Fixture Series', exact: true }).waitFor();
        if (process.env.JFC_SCREENSHOTS)
            await page.screenshot({ path: path.join(process.env.JFC_SCREENSHOTS, 'watch-mobile.png') });
        await watch.getByRole('link', { name: 'View details' }).click();
        await page.locator('#itemDetailPage').waitFor();
        await watch.waitFor({ state: 'detached' });
        await page.goBack();
        await watch.getByRole('heading', { name: 'Fixture Series', exact: true }).waitFor();
        await watch.getByText('Browse libraries', { exact: true }).click();
        await watch.getByRole('link', { name: 'Shows', exact: true }).last().click();
        await page.locator('#tvshowsPage').waitFor();
        await watch.waitFor({ state: 'detached' });
        await page.evaluate(() => { location.hash = '#/home'; });
        await watchTile.waitFor();
        await page.setViewportSize({ width: 1600, height: 1000 });
        try {
            await page
                .locator('#homeTab .card[data-jfc-kind="music"] .cardText a')
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
        const playlistRoute = music + '&tab=5&jfc=music-playlists';
        const navigate = hash => page.evaluate(value => { location.hash = value; }, hash);
        const playlistPanel = page.locator('.jfc-music-playlist-panel');
        const customDialog = page.locator('.jfc-music-playlist-dialog');
        const trackRows = playlistPanel.locator('.jfc-music-playlist-row');
        const syncStatus = page.locator('.jfc-music-playlist-sync');
        const persisted = (listener = userId) => JSON.parse(playlistPrefs.get(listener)?.CustomPrefs.playlistsJson || '{"playlists":[]}').playlists;
        async function navigatePlaylists() {
            await navigate(playlistRoute);
            await playlistPanel.getByRole('heading', { name: 'Music Playlists' }).waitFor();
        }
        async function createPlaylist(name) {
            await playlistPanel.getByRole('button', { name: 'Create Playlist', exact: true }).click();
            await customDialog.getByRole('textbox', { name: 'Playlist name' }).fill(name);
            await customDialog.getByRole('textbox').press('Enter');
            await playlistPanel.getByRole('heading', { name: name.trim(), exact: true }).waitFor();
        }
        async function addTrack(button, names, newName) {
            await button.click();
            await customDialog.getByRole('heading', { name: 'Add to Music Playlists' }).waitFor();
            for (const name of names) await customDialog.getByRole('checkbox', { name, exact: true }).check();
            if (newName) await customDialog.getByRole('textbox').fill(newName);
            await customDialog.getByRole('button', { name: 'Add track' }).click();
            await customDialog.waitFor({ state: 'detached' });
        }
        await navigatePlaylists();
        await createPlaylist('  Driving  ');
        await playlistPanel.getByText('Add songs from All Songs, an album, or Recently Played.').waitFor();
        await syncStatus.getByText('Synced with Jellyfin').waitFor();
        const [driving] = persisted();
        assert.match(driving.id, /^[a-f\d-]{32,36}$/i);
        assert.equal(driving.name, 'Driving');
        assert(Number.isSafeInteger(driving.createdAt));
        assert.deepEqual(driving.trackIds, []);
        assert.equal(playlistPrefs.get(userId).CustomPrefs.unrelated, 'preserved');
        await playlistPanel.getByRole('button', { name: 'Play Driving', exact: true }).click();
        await page.getByText('Add a track before playing this playlist.').waitFor();
        await navigatePlaylists();
        await createPlaylist('Night');
        await syncStatus.getByText('Synced with Jellyfin').waitFor();

        await navigate(music + '&tab=5');
        const audioOne = entries('Audio')[0], audioTwo = entries('Audio')[1], audioThree = entries('Audio')[2];
        const audioAction = item => page.locator(`#musicPage [data-type="Audio"][data-id="${item.Id}"] > .jfc-music-playlist-add`);
        await addTrack(audioAction(audioOne), ['Driving', 'Night']);
        await page.getByText('Track added to Music Playlists.').waitFor();
        await audioAction(audioOne).click();
        const alreadyAdded = customDialog.getByRole('checkbox', { name: 'Driving · Already added', exact: true });
        await alreadyAdded.waitFor();
        assert(await alreadyAdded.isDisabled());
        await page.keyboard.press('Escape');
        await customDialog.waitFor({ state: 'detached' });

        const album = entries('MusicAlbum')[0];
        await navigate('#/details?id=' + album.Id + '&serverId=' + id);
        const albumAudio = page.locator(`#listChildrenCollapsible [data-type="Audio"][data-id="${audioTwo.Id}"] > .jfc-music-playlist-add`);
        await addTrack(albumAudio, ['Driving']);

        await navigate(music + '&tab=1&jfc=played');
        const recentAudio = page.locator(`#jfc-music-tracks [data-jfc-audio-id="${audioThree.Id}"] > .jfc-music-playlist-add`);
        await addTrack(recentAudio, ['Driving'], 'New from track');
        await navigatePlaylists();
        await syncStatus.getByText('Synced with Jellyfin').waitFor();
        assert.deepEqual(persisted().find(item => item.id === driving.id).trackIds, [audioOne.Id, audioTwo.Id, audioThree.Id]);
        assert.deepEqual(persisted().find(item => item.name === 'Night').trackIds, [audioOne.Id]);
        assert.deepEqual(persisted().find(item => item.name === 'New from track').trackIds, [audioThree.Id]);
        await playlistPanel.getByRole('searchbox').fill('night');
        assert.equal(await playlistPanel.locator('.jfc-music-playlist-card').count(), 1);
        await playlistPanel.getByRole('searchbox').clear();
        await playlistPanel.getByRole('link', { name: /Driving/ }).click();
        await trackRows.first().waitFor();
        assert.deepEqual(await trackRows.locator('.jfc-music-playlist-track-title').allTextContents(), ['Audio 1', 'Audio 2', 'Audio 3']);
        await playlistPanel.getByText('Fixture Artist · Fixture Album').first().waitFor();
        await playlistPanel.getByText('3 tracks · 3:00').waitFor();
        await playlistPanel.getByRole('button', { name: 'Move up Audio 2' }).click();
        await syncStatus.getByText('Synced with Jellyfin').waitFor();
        const order = [audioTwo.Id, audioOne.Id, audioThree.Id];
        assert.deepEqual(persisted().find(item => item.id === driving.id).trackIds, order);

        async function playAndReport(name) {
            const before = playbackReports.length;
            const report = page.waitForRequest(req => {
                if (req.method() !== 'POST' || !req.url().endsWith('/Sessions/Playing')) return false;
                return !!req.postDataJSON().NowPlayingQueue?.length;
            });
            await playlistPanel.getByRole('button', { name, exact: true }).click();
            const payload = (await report.catch(async error => {
                console.log('PLAYBACK DEBUG', errors, requestLog.slice(-16),
                    await page.locator('.jfc-music-playlist-notice').allTextContents(),
                    await page.locator('body').innerText().then(text => text.slice(-1200)));
                throw error;
            })).postDataJSON();
            assert(payload.NowPlayingQueue.every(track => !track.ServerId || track.ServerId === id));
            assert(playbackReports.length >= before);
            return payload;
        }
        const played = await playAndReport('Play Driving');
        assert.deepEqual(played.NowPlayingQueue.map(track => track.Id), order);
        assert.equal(played.ItemId, audioTwo.Id);
        const shuffled = await playAndReport('Shuffle Driving');
        assert.deepEqual(shuffled.NowPlayingQueue.map(track => track.Id).sort(), [...order].sort());
        assert.deepEqual(persisted().find(item => item.id === driving.id).trackIds, order);
        const selected = await playAndReport('Play Audio 1');
        assert.equal(selected.ItemId, audioOne.Id);
        assert.deepEqual(selected.NowPlayingQueue.map(track => track.Id), order);
        const nativeBar = page.locator('.nowPlayingBar:not(.nowPlayingBar-hidden)');
        await nativeBar.getByText('Audio 1', { exact: true }).waitFor();
        const nextReport = page.waitForRequest(req => req.method() === 'POST' &&
            req.url().endsWith('/Sessions/Playing') && req.postDataJSON().ItemId === audioThree.Id);
        await nativeBar.locator('.nextTrackButton').click();
        await nextReport;
        await nativeBar.getByText('Audio 3', { exact: true }).waitFor();

        await playlistPanel.getByRole('button', { name: 'Rename Driving' }).click();
        await customDialog.getByRole('textbox').fill('Road');
        await customDialog.getByRole('button', { name: 'Save name' }).click();
        await playlistPanel.getByRole('heading', { name: 'Road', exact: true }).waitFor();
        await playlistPanel.getByRole('button', { name: 'Remove Audio 3' }).click();
        await syncStatus.getByText('Synced with Jellyfin').waitFor();
        assert.deepEqual(persisted().find(item => item.id === driving.id).trackIds, order.slice(0, 2));
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
        await playlistPanel.getByRole('button', { name: 'Delete Road' }).click();
        await navigate('#/home');
        await customDialog.waitFor({ state: 'detached' });
        await nativeBar.getByText('Audio 3', { exact: true }).waitFor();
        await page.setViewportSize({ width: 1366, height: 768 });
        await Promise.all([
            page.waitForResponse(res => res.url().endsWith('/Sessions/Playing/Stopped')),
            nativeBar.locator('.stopButton').click()
        ]);
        await nativeBar.waitFor({ state: 'hidden' });
        assert.equal(await page.locator('.jfc-music-playlist-shell').count(), 0);
        assert.equal(await page.locator('.jfc-music-playlist-add').count(), 0);
        await navigatePlaylists();
        assert.equal(await page.locator('.jfc-music-playlist-shell').count(), 1);
        assert.equal(await page.locator('.jfc-music-side-links a[data-playlists]').count(), 1);
        await playlistPanel.getByRole('link', { name: /Road/ }).click();
        await playlistPanel.getByRole('button', { name: 'Delete Road' }).click();
        await customDialog.getByRole('button', { name: 'Delete playlist' }).click();
        await playlistPanel.getByRole('heading', { name: 'Music Playlists' }).waitFor();
        await syncStatus.getByText('Synced with Jellyfin').waitFor();
        assert(!persisted().some(item => item.id === driving.id));
        await page.setViewportSize({ width: 1366, height: 768 });

        const preference = playlistPrefs.get(userId);
        const withMissing = persisted().map(item => item.name === 'Night' ? { ...item, trackIds: [...item.trackIds, missingTrack] } : item);
        preference.CustomPrefs.playlistsJson = JSON.stringify({ playlists: withMissing });
        const localKey = `jfc-music-playlists:${id}:${userId}`;
        const storageState = await context.storageState();
        for (const origin of storageState.origins) {
            origin.localStorage = origin.localStorage.filter(item => !item.name.startsWith('jfc-music-playlists:'));
        }
        const secondBrowser = await browser.newContext({ storageState, serviceWorkers: 'block' });
        try {
            const secondPage = await secondBrowser.newPage();
            await secondPage.goto(base + '/jellyfin/web/index.html' + playlistRoute);
            await secondPage.locator('.jfc-music-playlist-panel').getByRole('link', { name: /Night/ }).waitFor();
        } finally {
            await secondBrowser.close();
        }
        await page.reload();
        await playlistPanel.getByRole('link', { name: /Night/ }).click();
        await playlistPanel.getByText('Unavailable track').waitFor();
        assert(persisted().find(item => item.name === 'Night').trackIds.includes(missingTrack));

        await navigatePlaylists();
        failPlaylistWrite = true;
        await createPlaylist('Browser copy');
        await syncStatus.getByText('Saved on this browser only. Jellyfin sync unavailable.').waitFor();
        assert(!persisted().some(item => item.name === 'Browser copy'));
        assert((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), localKey)).playlists.some(item => item.name === 'Browser copy'));
        failPlaylistReads = true;
        await page.reload();
        await playlistPanel.getByRole('heading', { name: 'Browser copy' }).waitFor();
        await syncStatus.getByText('Saved on this browser only. Jellyfin sync unavailable.').waitFor();
        failPlaylistReads = false;
        failPlaylistWrite = false;
        const concurrent = { id: 'new-on-other-device', name: 'From another device', createdAt: Date.now(), trackIds: [] };
        preference.CustomPrefs.playlistsJson = JSON.stringify({ playlists: [...persisted(), concurrent] });
        await syncStatus.getByRole('button', { name: 'Retry sync' }).click();
        await syncStatus.getByText('Synced with Jellyfin').waitFor();
        assert(persisted().some(item => item.name === 'Browser copy'));
        assert(persisted().some(item => item.id === concurrent.id));

        failPlaylistWrite = true;
        await playlistPanel.getByRole('button', { name: 'Rename Browser copy' }).click();
        await customDialog.getByRole('textbox').fill('Local rename');
        await customDialog.getByRole('button', { name: 'Save name' }).click();
        await syncStatus.getByText('Saved on this browser only. Jellyfin sync unavailable.').waitFor();
        failPlaylistWrite = false;
        playlistPrefs.get(userId).CustomPrefs.playlistsJson = JSON.stringify({
            playlists: persisted().map(record => record.name === 'Browser copy' ? { ...record, name: 'Server rename' } : record)
        });
        await syncStatus.getByRole('button', { name: 'Retry sync' }).click();
        await syncStatus.getByText('Playlist changes conflict with Jellyfin. Your local copy has been kept.').waitFor();
        await playlistPanel.getByRole('heading', { name: 'Local rename' }).waitFor();
        assert(persisted().some(item => item.name === 'Server rename'));
        await syncStatus.getByRole('button', { name: 'Use server copy' }).click();
        await customDialog.getByRole('button', { name: 'Use server copy' }).click();
        await playlistPanel.getByRole('heading', { name: 'Server rename' }).waitFor();

        await navigate('#/playlists?collectionType=playlists&tab=0');
        await page.locator('#playlistsPage').waitFor();
        assert.equal(await page.getByText('Server rename', { exact: true }).count(), 0);
        assert.equal(await page.locator('.jfc-music-playlist-shell').count(), 0);

        await page.evaluate(other => window.ApiClient.setAuthenticationInfo('mock-token', other), otherUser.Id);
        await navigatePlaylists();
        await playlistPanel.getByText('No music playlists yet.').waitFor();
        await createPlaylist('Other user only');
        await syncStatus.getByText('Synced with Jellyfin').waitFor();
        assert.equal(persisted(otherUser.Id)[0].name, 'Other user only');
        assert(!persisted().some(item => item.name === 'Other user only'));
        const otherKey = `jfc-music-playlists:${id}:${otherUser.Id}`;
        assert((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), otherKey)).playlists.some(item => item.name === 'Other user only'));
        await page.evaluate(user => window.ApiClient.setAuthenticationInfo('mock-token', user), userId);
        await navigatePlaylists();
        await playlistPanel.getByRole('link', { name: /Server rename/ }).waitFor();
        assert.equal(await playlistPanel.getByRole('link', { name: /Other user only/ }).count(), 0);
        assert.deepEqual(globalPlaylistWrites, []);
        assert(playlistWrites.some(entry => entry.failed));
        assert(playlistWrites.every(entry => entry.payload.CustomPrefs.unrelated === 'preserved'));
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
