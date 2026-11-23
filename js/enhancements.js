(() => {
    'use strict';

    // Optional: map a library ID from its native link to movies, tvshows, or music.
    const libraryTypesById = {};
    const labels = { home: 'Home', media: 'My Media', your: 'Your' };
    const libraryTypes = new Map([
        ['movies', { icon: 'movie', path: '/movies' }],
        ['tvshows', { icon: 'tv', path: '/tv' }],
        ['music', { icon: 'music_note', path: '/music' }]
    ]);

    const installKey = Symbol.for('jellyfin-cinematic.enhancements');
    if (window[installKey] || !window.MutationObserver) return;
    window[installKey] = true;

    const diagnostics = { version: '2.1.0', route: '', layout: '', css: false, modules: [], waiting: [], failures: [] };
    let debug = new URLSearchParams(document.currentScript?.src.split('?')[1]).has('debug');
    try { debug ||= localStorage.getItem('jfcDebug') === '1'; } catch { /* Storage can be disabled. */ }
    window.JellyfinCinematic = {
        status: () => structuredClone(diagnostics)
    };
    function reportFailure(name, error) {
        const message = name + ': ' + (error?.message || error);
        if (!diagnostics.failures.includes(message) && diagnostics.failures.length < 24) diagnostics.failures.push(message);
        if (debug) console.warn('[Jellyfin Cinematic]', message);
    }

    const stylesheet = '--jfc-theme-version';
    const tileSelector = [
        '.homeLibraryButton[href]',
        '.itemsContainer > .card:is([data-type="CollectionFolder"], [data-collectiontype]) .cardImageContainer[href]',
        '.itemsContainer > .card .cardImageContainer:is([href^="#/movies?"], [href^="#/tv?"], [href^="#/music?"])'
    ].join(',');
    const homeSelector = '#indexPage.homePage:not(.hide) #homeTab';
    const textDefaults = {
        welcome: 'WELCOME TO',
        title: 'Jellyfin',
        subtitle: 'Your personal media server'
    };

    let headerNav;
    let pendingFrame = 0;
    let serverNameRequest;

    function serverName() {
        if (!serverNameRequest) {
            serverNameRequest = (async () => {
                try {
                    const path = location.pathname.match(/^(.*)\/web(?:\/.*)?$/i)?.[1] ?? location.pathname;
                    const webBase = path.replace(/\/$/, '');
                    const url = new URL(location.origin + webBase + '/System/Info/Public');
                    const response = await fetch(url, {
                        credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000)
                    });
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    const info = await response.json();
                    return typeof info.ServerName === 'string' ? info.ServerName.trim() : '';
                } catch (error) {
                    reportFailure('Public server name', error);
                    return '';
                }
            })();
        }
        return serverNameRequest;
    }

    function make(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function themeText(style, name) {
        const value = style.getPropertyValue('--jfc-' + name).trim();
        const first = value[0];
        return (first === '"' || first === "'") && value.at(-1) === first
            ? value.slice(1, -1)
            : textDefaults[name];
    }

    function makeAction(tag, text, icon) {
        const action = make(tag);
        const decoration = make('span', 'material-icons ' + icon);
        decoration.setAttribute('aria-hidden', 'true');
        action.append(decoration, make('span', '', text));
        return action;
    }

    function readLibrary(link) {
        const card = link.closest('.card');
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash.startsWith('#/')) return;

        const [path, query = ''] = url.hash.slice(1).split('?');
        const params = new URLSearchParams(query);
        const id = card?.dataset.id || params.get('topParentId') || params.get('id');
        const configured = Object.hasOwn(libraryTypesById, id) ? libraryTypesById[id] : undefined;
        const typeFromPath = [...libraryTypes].find(([, type]) => type.path === path)?.[0];
        const kind = configured || card?.dataset.collectiontype || params.get('collectionType') || typeFromPath;
        const type = libraryTypes.get(kind);
        const tile = card || link;

        // Only inspect the native My Media cards/buttons and confirmed library routes.
        if (card && !card.dataset.collectiontype && card.dataset.type !== 'CollectionFolder' && !type) return;
        if (type && (card || link.matches('.homeLibraryButton')) && tile.dataset.jfcKind !== kind) tile.dataset.jfcKind = kind;
        const name = (
            link.querySelector('.homeLibraryText')?.textContent ||
            link.getAttribute('aria-label') ||
            card?.querySelector('.cardText a')?.textContent ||
            (link.closest('.libraryMenuOptions') && (link.querySelector('.navMenuOptionText') || link).textContent) ||
            ''
        ).trim();
        return { kind, type, name, href: url.hash, link };
    }

    function getLibraries(sections) {
        return [...sections.querySelectorAll(tileSelector)]
            .filter(link => !link.closest('.hide, [hidden]'))
            .map(readLibrary)
            .filter(Boolean);
    }

    function getPrimaryShortcuts(libraries) {
        return [...libraryTypes.keys()].flatMap(kind => {
            const library = libraries.find(entry => entry.kind === kind && entry.name);
            return library ? [library] : [];
        });
    }

    function setHero(tab, sections, shortcuts) {
        let hero = tab.querySelector(':scope > .jfc-hero');
        if (!hero) {
            hero = make('section', 'jfc-hero');
            const style = getComputedStyle(tab);
            const title = make('h1', 'jfc-hero-title', themeText(style, 'title'));
            hero.append(
                make('p', 'jfc-hero-kicker', themeText(style, 'welcome')),
                title,
                make('p', 'jfc-hero-subtitle', themeText(style, 'subtitle')),
                make('div', 'jfc-hero-links')
            );
            sections.before(hero);
            serverName().then(name => {
                if (name && title.isConnected) title.textContent = name;
            });
        }

        const list = hero.querySelector('.jfc-hero-links');
        const key = JSON.stringify(shortcuts.map(({ name, href }) => [name, href]));
        if (list.dataset.jfcKey === key) return;
        list.dataset.jfcKey = key;
        list.replaceChildren(...shortcuts.map(library => {
            const link = makeAction('a', [labels.your, library.name].filter(Boolean).join(' '), library.type.icon);
            link.href = library.href;
            return link;
        }));
    }

    function focusLibrary() {
        const sections = document.querySelector(homeSelector + ' > .sections');
        const link = sections && getLibraries(sections)[0]?.link;
        if (!link) return;
        link.focus({ preventScroll: true });
        link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function setHeader(header, shortcuts, hasLibraries, active) {
        const left = header?.querySelector('.headerLeft');
        if (!left) {
            headerNav?.remove();
            return;
        }
        if (!headerNav) {
            headerNav = make('nav', 'jfc-nav');
            headerNav.setAttribute('aria-label', 'Library shortcuts');
        }
        if (headerNav.parentNode !== left) left.append(headerNav);

        headerNav.classList.toggle('jfc-home-nav', active === 'home');
        const key = JSON.stringify([active, hasLibraries, shortcuts.map(({ name, href }) => [name, href])]);
        if (headerNav.dataset.jfcKey === key) return;
        headerNav.dataset.jfcKey = key;

        const home = makeAction('a', labels.home, 'home');
        home.href = '#/home';
        if (active === 'home') home.setAttribute('aria-current', 'page');
        headerNav.replaceChildren(home);
        for (const library of shortcuts) {
            const link = makeAction('a', library.name, library.type.icon);
            link.href = library.href;
            if (library.kind === active) link.setAttribute('aria-current', 'page');
            headerNav.append(link);
        }
        if (hasLibraries && active === 'home') {
            const media = makeAction('button', labels.media, 'layers');
            media.type = 'button';
            media.addEventListener('click', focusLibrary);
            headerNav.append(media);
        } else if (hasLibraries) {
            const media = makeAction('a', labels.media, 'layers');
            media.href = '#/home';
            headerNav.append(media);
        }
    }

    const musicTabs = [
        ['albumsTab', 'album'], ['suggestionsTab', 'auto_awesome'], ['albumArtistsTab', 'star_outline'],
        ['artistsTab', 'person_outline'], ['playlistsTab', 'queue_music'], ['songsTab', 'music_note'],
        ['genresTab', 'local_offer'], ['collectionsTab', 'layers']
    ];
    const modernMusicLabels = ['Albums', 'Suggestions', 'Album Artists', 'Artists', 'Playlists', 'Songs', 'Genres', 'Collections'];
    const phoneMusicOrder = [5, 4, 0, 3, 2, 1, 6, 7];
    const phoneMusicLayout = window.matchMedia('(max-width: 42em)');
    const musicSelector = ':is(#musicPage, #musicRecommendedPage).libraryPage:not(.hide)';
    const shelfDefinitions = [
        { title: 'Recently Added Albums', icon: 'album', emptyIcon: 'headphones', noun: 'albums', query: 'getItems' },
        { title: 'Your Artists', icon: 'person_outline', emptyIcon: 'mic_none', noun: 'artists', query: 'getArtists' }
    ];
    let music;
    let observedNodes = [];
    let recentlyPlayedRequested = false;
    const playedDefinition = { title: 'Recently Played', icon: 'play_arrow', emptyIcon: 'headphones', noun: 'tracks', query: 'getItems' };
    const svgPaths = {
        album: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
        auto_awesome: 'm12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z',
        star_outline: 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z',
        person_outline: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a8 5 0 0 1 16 0v2',
        queue_music: 'M3 6h11M3 11h11M3 16h7m9-8v11m0-11 4 1m-4 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
        music_note: 'M9 18V6l11-3v12M9 18a3 2 0 1 1-6 0 3 2 0 0 1 6 0Zm11-3a3 2 0 1 1-6 0 3 2 0 0 1 6 0Z',
        local_offer: 'm3 4 8 0 10 10-7 7L3 10V4Zm4 4h.01',
        layers: 'm12 3 10 6-10 6L2 9l10-6ZM2 13l10 6 10-6M2 17l10 6 10-6',
        play_arrow: 'M5 3v18l15-9L5 3Z',
        headphones: 'M3 14v-2a9 9 0 0 1 18 0v2M3 14h4v7H5a2 2 0 0 1-2-2v-5Zm18 0h-4v7h2a2 2 0 0 0 2-2v-5Z',
        mic_none: 'M9 10v-5a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0Zm-3 0a6 6 0 0 0 12 0m-6 6v5m-4 0h8',
        chevron_left: 'm15 5-7 7 7 7',
        chevron_right: 'm9 5 7 7-7 7'
    };

    function icon(name) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        node.setAttribute('class', 'jfc-icon');
        node.setAttribute('viewBox', '0 0 24 24');
        node.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(node.namespaceURI, 'path');
        path.setAttribute('d', svgPaths[name]);
        node.append(path);
        return node;
    }

    function musicButton(tag, text, decoration) {
        const node = make(tag);
        node.append(icon(decoration), make('span', '', text));
        return node;
    }

    function musicRoute(index, target) {
        const params = new URLSearchParams(location.hash.split('?')[1]);
        params.set('tab', index);
        if (target) params.set('jfc', target);
        else params.delete('jfc');
        return '#/music?' + params.toString();
    }

    function currentMusicTab() {
        const explicit = new URLSearchParams(location.hash.split('?')[1]).get('tab');
        if (explicit !== null) return Number(explicit);
        const choices = [...document.querySelectorAll('#library-view-menu [role="menuitem"]')];
        return Math.max(0, choices.findIndex(choice => choice.classList.contains('Mui-selected')));
    }

    function musicTabButton(page, id) {
        const index = page.querySelector('#' + id)?.dataset.index;
        if (index === undefined) return null;
        return document.querySelector('.skinHeader .headerTabs .emby-tab-button[data-index="' + index + '"]:not(.hide)');
    }

    function scrollToContent(node) {
        if (!node?.isConnected) return;
        node.focus({ preventScroll: true });
        node.scrollIntoView({ block: 'start', behavior: 'auto' });
    }

    function selectMusicTab(page, id, sectionId) {
        const panel = page.querySelector('#' + id);
        if (!panel) return;
        recentlyPlayedRequested = sectionId === 'recentlyPlayed';
        if (!panel.classList.contains('is-active')) musicTabButton(page, id)?.click();
        if (sectionId && !recentlyPlayedRequested) scrollToContent(document.getElementById(sectionId));
        schedule();
    }

    function drawerLibrary(iconName) {
        return document.querySelector('.libraryMenuOptions a[href^="#/"]:has(.navMenuOptionIcon.' + iconName + ')');
    }

    function makeShelf(definition) {
        const section = make('section', 'jfc-music-shelf');
        section.tabIndex = -1;
        section.id = 'jfc-music-' + definition.noun;
        const heading = make('h2', 'jfc-music-shelf-title');
        heading.id = section.id + '-heading';
        heading.append(icon(definition.icon), make('span', '', definition.title));
        section.setAttribute('aria-labelledby', heading.id);
        const track = make('div', 'jfc-music-track');
        track.tabIndex = 0;
        track.setAttribute('role', 'group');
        track.setAttribute('aria-labelledby', heading.id);
        const previous = musicButton('button', '', 'chevron_left');
        const next = musicButton('button', '', 'chevron_right');
        const controls = make('div', 'jfc-music-scroll');
        controls.append(previous, next);
        for (const [button, direction, label] of [[previous, -1, 'Previous'], [next, 1, 'Next']]) {
            button.type = 'button';
            button.setAttribute('aria-label', label + ' ' + definition.noun);
            button.disabled = true;
            button.addEventListener('click', () => {
                const sign = getComputedStyle(track).direction === 'rtl' ? -1 : 1;
                track.scrollBy({
                    left: Math.round(track.clientWidth * 0.78) * direction * sign,
                    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
                });
            });
        }
        function updateArrows() {
            const limit = Math.max(0, track.scrollWidth - track.clientWidth);
            const offset = Math.abs(track.scrollLeft);
            previous.disabled = limit < 2 || offset < 2;
            next.disabled = limit < 2 || offset >= limit - 2;
        }
        track.addEventListener('scroll', updateArrows, { passive: true });
        const header = make('div', 'jfc-music-shelf-header');
        header.append(heading, controls);
        const body = make('div', 'jfc-music-shelf-body');
        section.append(header, body);
        return { definition, section, track, body, updateArrows };
    }

    function makeMusicCard(item, client, definition) {
        const href = window.Emby?.Page?.getRouteUrl({ ...item, ServerId: item.ServerId || client.serverId() });
        if (typeof href !== 'string' || !href.startsWith('#/details?')) return null;
        const name = item.Name || (definition.noun === 'albums' ? 'Untitled album' : 'Unknown artist');
        const card = make('a', 'jfc-music-card');
        card.href = href;
        const art = make('span', 'jfc-music-art');
        art.append(icon(definition.icon));
        const tag = item.ImageTags?.Primary;
        if (tag) {
            const img = make('img');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.addEventListener('error', () => {
                if (debug) reportFailure('Artwork', 'image could not be loaded for ' + name);
                img.remove();
            }, { once: true });
            img.src = client.getScaledImageUrl(item.Id, { type: 'Primary', tag, fillWidth: 420, fillHeight: 420, quality: 88 });
            art.append(img);
        }
        const title = make('span', 'jfc-music-card-name', name);
        title.title = name;
        card.append(art, title);
        const artist = item.AlbumArtist || item.AlbumArtists?.map(entry => entry.Name).filter(Boolean).join(', ');
        if (definition.noun === 'albums' && artist) card.append(make('span', 'jfc-music-card-artist', artist));
        return card;
    }

    function showShelfStatus(shelf, title, subtitle, iconName) {
        const status = make('div', 'jfc-music-empty');
        status.setAttribute('role', 'status');
        status.append(icon(iconName), make('p', 'jfc-music-empty-title', title));
        if (subtitle) status.append(make('p', '', subtitle));
        shelf.body.replaceChildren(status);
        shelf.updateArrows();
        return status;
    }

    async function loadShelf(state, shelf) {
        const { client, userId, parentId } = state;
        const { definition } = shelf;
        showShelfStatus(shelf, 'Loading ' + definition.noun + '…', '', definition.icon);
        try {
            const options = {
                ParentId: parentId, Recursive: true, Limit: 24, ImageTypeLimit: 1,
                EnableImageTypes: 'Primary', EnableTotalRecordCount: false
            };
            if (!parentId) delete options.ParentId;
            if (definition.noun === 'albums') {
                Object.assign(options, { IncludeItemTypes: 'MusicAlbum', SortBy: 'DateCreated', SortOrder: 'Descending' });
            } else if (definition.noun === 'tracks') {
                Object.assign(options, { IncludeItemTypes: 'Audio', SortBy: 'DatePlayed', SortOrder: 'Descending', Filters: 'IsPlayed' });
            } else {
                Object.assign(options, { SortBy: 'SortName', SortOrder: 'Ascending' });
            }
            const result = definition.query === 'getItems' && state.modern
                ? await client.getJSON(client.getUrl('Items', { ...options, UserId: userId }))
                : await client[definition.query](userId, options);
            if (state !== music || !state.page.isConnected || state.page.classList.contains('hide') ||
                client !== window.ApiClient || userId !== client.getCurrentUserId()) return;
            if (!Array.isArray(result?.Items)) throw new Error('Missing Items');
            if (!result.Items.length) {
                if (definition.noun === 'albums' && state.modern) state.page.classList.add('jfc-music-empty-library');
                showShelfStatus(shelf, 'No ' + definition.noun + ' found',
                    definition.noun === 'tracks' ? 'Tracks you listen to will appear here.' :
                        'Add music to your library to see ' + definition.noun + ' here.', definition.emptyIcon);
                return;
            }
            const cards = result.Items.map(item => makeMusicCard(item, client, definition)).filter(Boolean);
            if (!cards.length) throw new Error('Missing item links');
            shelf.track.replaceChildren(...cards);
            shelf.body.replaceChildren(shelf.track);
            shelf.updateArrows();
        } catch (error) {
            if (state !== music || !state.page.isConnected || state.page.classList.contains('hide') ||
                client !== window.ApiClient || userId !== client.getCurrentUserId()) return;
            reportFailure('Music ' + definition.noun, error);
            const status = showShelfStatus(shelf, 'Could not load ' + definition.noun, '', definition.emptyIcon);
            const retry = make('button', 'jfc-music-retry', 'Retry');
            retry.type = 'button';
            retry.addEventListener('click', () => loadShelf(state, shelf), { once: true });
            status.append(retry);
        }
    }

    function mountMusic(page, client, userId, parentId, modern) {
        const sidebar = make('nav', 'jfc-music-sidebar');
        sidebar.setAttribute('aria-label', 'Music library');
        const list = make('div', 'jfc-music-side-links');
        sidebar.append(make('h2', '', 'Music'), list);

        const hero = make('section', 'jfc-music-hero');
        const badge = make('span', 'jfc-music-badge');
        badge.setAttribute('aria-hidden', 'true');
        const copy = make('div');
        copy.append(make('h1', '', 'Music'), make('p', '', 'Your personal music collection'));
        hero.append(badge, copy);

        const shortcuts = make('div', 'jfc-music-shortcuts');
        for (const [title, decoration, tab, section, index, target] of [
            ['Recently Played', 'play_arrow', 'suggestionsTab', 'recentlyPlayed', 1, 'played'],
            ['Recently Added', 'layers', 'albumsTab', 'jfc-music-albums', 0, 'albums'],
            ['Artists', 'person_outline', 'artistsTab', null, 3],
            ['Playlists', 'queue_music', 'playlistsTab', null, 4]
        ]) {
            const button = musicButton(modern ? 'a' : 'button', title, decoration);
            if (modern && target) button.classList.add('jfc-music-recent-link');
            if (modern) {
                button.href = musicRoute(index, target);
                if (target) button.addEventListener('click', () => {
                    if (location.hash === button.getAttribute('href')) {
                        scrollToContent(document.getElementById(target === 'played' ? 'jfc-music-tracks' : 'jfc-music-albums'));
                    }
                });
            } else {
                button.type = 'button';
                button.addEventListener('click', () => selectMusicTab(page, tab, section));
            }
            button.append(icon('chevron_right'));
            shortcuts.append(button);
        }

        const shelves = shelfDefinitions.map(makeShelf);
        const content = make('div', 'jfc-music-content');
        content.append(...shelves.map(shelf => shelf.section));
        const nativeHeading = make('h2', 'jfc-music-native-heading', 'All Albums');
        const albumsPanel = page.querySelector('#albumsTab');
        if (albumsPanel) albumsPanel.prepend(nativeHeading);
        else content.append(nativeHeading);
        const played = modern ? makeShelf(playedDefinition) : null;
        if (played) played.section.hidden = true;
        const allPlaylists = modern ? make('div', 'jfc-all-playlists') : null;
        if (allPlaylists) {
            const link = musicButton('a', 'All playlists', 'queue_music');
            link.href = '#/playlists?collectionType=playlists&tab=0';
            allPlaylists.append(link);
            allPlaylists.hidden = true;
        }
        const nodes = [sidebar, hero, shortcuts, content];
        if (played) nodes.push(played.section, allPlaylists);
        page.prepend(...nodes);
        nodes.push(nativeHeading);
        page.classList.add('jfc-music-page');
        return { page, client, userId, parentId, list, content, shelves, nodes, modern, played, allPlaylists,
            tabKey: '', started: false, target: '', playedStarted: false };
    }

    function clearMusic() {
        if (!music) return;
        music.page.classList.remove('jfc-music-page', 'jfc-music-empty-library', 'jfc-music-albums-active', 'jfc-music-recent-albums');
        music.nodes.forEach(node => node.remove());
        music = null;
        recentlyPlayedRequested = false;
    }

    function updateModernMusic(state) {
        const activeTab = currentMusicTab();
        const phone = phoneMusicLayout.matches;
        const layout = phone ? 'phone' : 'modern';
        if (state.tabKey !== layout) {
            state.tabKey = layout;
            const order = phone ? phoneMusicOrder : modernMusicLabels.keys();
            state.list.replaceChildren(...Array.from(order, index => {
                const label = phone && index === 5 ? 'All Songs' : modernMusicLabels[index];
                const link = musicButton('a', label, musicTabs[index][1]);
                link.href = musicRoute(index);
                link.dataset.tab = index;
                return link;
            }));
        }
        for (const link of state.list.children) {
            if (activeTab === Number(link.dataset.tab)) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        }
        const target = new URLSearchParams(location.hash.split('?')[1]).get('jfc');
        state.content.hidden = activeTab !== 0;
        state.allPlaylists.hidden = activeTab !== 4;
        state.page.classList.toggle('jfc-music-albums-active', activeTab === 0);
        state.page.classList.toggle('jfc-music-recent-albums', activeTab === 0 && target === 'albums');
        state.played.section.hidden = activeTab !== 1 || target !== 'played';
        if (!state.played.section.hidden && state.userId && !state.playedStarted) {
            state.playedStarted = true;
            loadShelf(state, state.played);
        }
        if (!state.content.hidden && state.userId && !state.started) {
            state.started = true;
            state.shelves.forEach(shelf => loadShelf(state, shelf));
        }
        if (!state.content.hidden) state.shelves.forEach(shelf => shelf.updateArrows());
        if (!state.played.section.hidden) state.played.updateArrows();
        if (target !== state.target) {
            state.target = target;
            if (target === 'played' && !state.played.section.hidden) scrollToContent(state.played.section);
            if (target === 'albums' && activeTab === 0) scrollToContent(state.shelves[0].section);
        }
    }

    function updateMusic(page, header, cssReady) {
        const client = window.ApiClient;
        const userId = client?.getCurrentUserId?.();
        const parentId = new URLSearchParams(location.hash.split('?')[1]).get('topParentId');
        const modern = page?.id === 'musicPage';
        const albums = page?.querySelector('#albumsTab');
        const ready = cssReady && (modern || Boolean(albums && musicTabButton(page, 'albumsTab') && userId));
        if (music && (!ready || music.page !== page || music.client !== client || music.userId !== userId ||
            music.parentId !== parentId || !music.content.isConnected)) clearMusic();
        header?.classList.toggle('jfc-music-header', ready && !modern);
        document.documentElement.classList.toggle('jfc-modern-music', ready && modern);
        if (!ready) return;
        if (!music) {
            music = mountMusic(page, client, userId, parentId, modern);
            if (modern && !userId) {
                for (const shelf of [...music.shelves, music.played]) {
                    showShelfStatus(shelf, 'Waiting for Jellyfin…', '', shelf.definition.icon);
                }
            }
        }
        if (modern) {
            updateModernMusic(music);
            return;
        }

        const tabs = musicTabs.flatMap(([id, decoration]) => {
            const button = musicTabButton(page, id);
            return button ? [{ id, decoration, label: button.textContent.trim() }] : [];
        });
        const collections = drawerLibrary('video_library')?.getAttribute('href') ||
            window.Emby?.Page?.getRouteUrl('list', { itemTypes: 'BoxSet', serverId: client.serverId() });
        const key = JSON.stringify([tabs, collections]);
        if (music.tabKey !== key) {
            music.tabKey = key;
            music.list.replaceChildren(...tabs.map(({ id, decoration, label }) => {
                const button = musicButton('button', label, decoration);
                button.type = 'button';
                button.dataset.jfcTab = id;
                button.addEventListener('click', () => selectMusicTab(page, id));
                return button;
            }));
            if (collections?.startsWith('#/list?')) {
                const link = musicButton('a', 'Collections', 'layers');
                link.href = collections;
                music.list.append(link);
            }
        }

        for (const button of music.list.querySelectorAll('[data-jfc-tab]')) {
            const active = page.querySelector('#' + button.dataset.jfcTab)?.classList.contains('is-active');
            if (active) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        }

        music.content.hidden = !albums.classList.contains('is-active');
        if (!music.content.hidden && !music.started) {
            music.started = true;
            music.shelves.forEach(shelf => loadShelf(music, shelf));
        }
        if (!music.content.hidden) music.shelves.forEach(shelf => shelf.updateArrows());
        const played = page.querySelector('#suggestionsTab.is-active #recentlyPlayed:not(.hide)');
        if (recentlyPlayedRequested && played) {
            recentlyPlayedRequested = false;
            played.scrollIntoView({ block: 'start', behavior: 'auto' });
        }
    }

    function refresh() {
        pendingFrame = 0;
        const root = document.documentElement;
        const desktopOrMobile = root.matches('.layout-desktop, .layout-mobile');
        const cssReady = getComputedStyle(root).getPropertyValue(stylesheet).trim() === '3';
        root.classList.toggle('jfc-enhanced', cssReady && desktopOrMobile);
        const tab = desktopOrMobile ? document.querySelector(homeSelector) : null;
        const page = tab?.closest('#indexPage');
        const sections = tab?.querySelector(':scope > .sections');
        const modernHeader = document.querySelector('.MuiAppBar-root');
        const header = modernHeader ? null : document.querySelector('.skinHeader');
        const tabs = header?.querySelector('.headerTabs');
        const drawer = document.querySelector('.libraryMenuOptions');
        const route = location.hash.split('?')[0];
        const musicPage = desktopOrMobile && route === '#/music' ? document.querySelector(musicSelector) : null;
        const musicPanels = [...(musicPage?.querySelectorAll(':scope > .pageTabContent, #recentlyPlayed') || [])];
        const nodes = [page, tab, sections, header, tabs, drawer, musicPage, ...musicPanels];

        if (nodes.length !== observedNodes.length || nodes.some((node, index) => node !== observedNodes[index])) {
            observer.disconnect();
            observedNodes = nodes;
            const classChanges = { attributes: true, attributeFilter: ['class'] };
            if (page) observer.observe(page, classChanges);
            if (tab) observer.observe(tab, { ...classChanges, childList: true });
            if (sections) observer.observe(sections, { childList: true, subtree: true });
            if (header) observer.observe(header, { childList: true });
            if (tabs) observer.observe(tabs, { childList: true, subtree: true });
            if (drawer) observer.observe(drawer, { childList: true });
            if (musicPage) observer.observe(musicPage, { ...classChanges, childList: true });
            musicPanels.forEach(panel => observer.observe(panel, classChanges));
        }

        updateMusic(musicPage, header, cssReady);
        const homeActive = cssReady && sections && tab.classList.contains('is-active') &&
            getComputedStyle(tab).getPropertyValue('--jfc-hero-height').trim();
        if (homeActive) {
            const libraries = getLibraries(sections);
            const shortcuts = getPrimaryShortcuts(libraries);
            setHero(tab, sections, shortcuts);
            setHeader(header, shortcuts, libraries.length > 0, 'home');
        } else {
            tab?.querySelector(':scope > .jfc-hero')?.remove();
            const kind = [...libraryTypes].find(([, type]) => '#' + type.path === route)?.[0];
            if (header && desktopOrMobile && kind && cssReady) {
                const libraries = [...(drawer?.querySelectorAll('a[href]') || [])].map(readLibrary).filter(Boolean);
                const links = getPrimaryShortcuts(libraries);
                const type = libraryTypes.get(kind);
                const active = { kind, type, name: { movies: 'Movies', tvshows: 'Shows', music: 'Music' }[kind], href: location.hash };
                const current = links.findIndex(link => link.kind === kind);
                if (current === -1) links.push(active);
                else links[current] = active;
                setHeader(header, links, true, kind);
            } else {
                headerNav?.remove();
            }
        }

        const pageSelectors = { '#/movies': '#moviesPage', '#/tv': '#tvshowsPage, #tvRecommendedPage',
            '#/details': '#itemDetailPage', '#/queue': '#nowPlayingPage', '#/video': '.videoOsdBottom' };
        const viewSelector = pageSelectors[route];
        const view = viewSelector && document.querySelector(viewSelector);
        const modules = [];
        const waiting = [];
        if (!cssReady && desktopOrMobile) waiting.push('Theme stylesheet v3 custom property');
        if (route === '#/home' && !sections) waiting.push('#homeTab > .sections');
        if (route === '#/music' && !musicPage) waiting.push(musicSelector);
        if (musicPage?.id === 'musicRecommendedPage' && !musicTabButton(musicPage, 'albumsTab')) {
            waiting.push('Legacy Albums tab button');
        }
        if (viewSelector && !view) waiting.push(viewSelector);
        if (music?.modern && !music.userId) waiting.push('Signed-in Jellyfin API client');
        if (cssReady && modernHeader) modules.push('Modern navigation CSS');
        if (homeActive) modules.push('Home hero and library tiles');
        if (music) modules.push(music.modern ? 'Modern Music dashboard' : 'Legacy Music dashboard');
        if (cssReady && view) modules.push(view.id || route.slice(2));
        if (debug) {
            for (const hero of document.querySelectorAll('.jfc-hero, .jfc-music-hero')) {
                const imageUrl = getComputedStyle(hero).backgroundImage.match(/url\(["']?([^"'()]*\/(?:home-crimson|music-moon)\.svg)["']?\)/)?.[1];
                if (!imageUrl || probedImages.has(imageUrl)) continue;
                probedImages.add(imageUrl);
                const image = new Image();
                image.onerror = () => reportFailure('Hero asset', new URL(imageUrl).pathname);
                image.src = imageUrl;
            }
        }
        const next = { route, layout: modernHeader ? 'Modern' : 'Legacy', css: cssReady, modules, waiting };
        const key = JSON.stringify(next);
        if (key !== lastStatus) {
            lastStatus = key;
            Object.assign(diagnostics, next);
            if (debug) console.info('[Jellyfin Cinematic]', window.JellyfinCinematic.status());
        }
        if (route !== retryRoute) {
            retryRoute = route;
            retryCount = 0;
            clearTimeout(retryTimer);
            retryTimer = 0;
        }
        if (waiting.length && desktopOrMobile && !retryTimer && retryCount < retryDelays.length) {
            retryTimer = setTimeout(() => {
                retryTimer = 0;
                schedule();
            }, retryDelays[retryCount++]);
        }
    }

    function schedule() {
        if (!pendingFrame) pendingFrame = requestAnimationFrame(refresh);
    }

    const observer = new MutationObserver(schedule);
    const probedImages = new Set();
    const retryDelays = [250, 750, 2000, 4500];
    let retryTimer = 0;
    let retryRoute = '';
    let retryCount = 0;
    let lastStatus = '';
    function watchReactRoot() {
        const app = document.getElementById('reactRoot');
        if (!app) return;
        const selector = '[data-role="page"], .MuiAppBar-root, .skinHeader, style, #library-view-menu';
        new MutationObserver(records => {
            if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
                node instanceof Element && (node.matches(selector) || node.querySelector(selector))
            ))) schedule();
        }).observe(app, { childList: true, subtree: true });
    }
    document.addEventListener('viewshow', schedule, true);
    document.addEventListener('viewhide', schedule, true);
    document.addEventListener('tabchange', schedule, true);
    window.addEventListener('resize', schedule, { passive: true });
    phoneMusicLayout.addEventListener('change', schedule);
    document.addEventListener('load', event => {
        if (event.target.matches?.('link[rel="stylesheet"], style')) schedule();
    }, true);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { watchReactRoot(); schedule(); }, { once: true });
    } else {
        watchReactRoot();
    }
    window.addEventListener('load', schedule, { once: true });
    window.addEventListener('hashchange', schedule);
    window.addEventListener('popstate', schedule);
    schedule();
})();
