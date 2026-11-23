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
            hero.append(
                make('p', 'jfc-hero-kicker', themeText(style, 'welcome')),
                make('h1', 'jfc-hero-title', themeText(style, 'title')),
                make('p', 'jfc-hero-subtitle', themeText(style, 'subtitle')),
                make('div', 'jfc-hero-links')
            );
            sections.before(hero);
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
        ['genresTab', 'local_offer']
    ];
    const musicSelector = '#musicRecommendedPage.libraryPage:not(.hide)';
    const shelfDefinitions = [
        { title: 'Recently Added Albums', icon: 'album', emptyIcon: 'headphones', noun: 'albums', query: 'getItems' },
        { title: 'Your Artists', icon: 'person_outline', emptyIcon: 'mic_none', noun: 'artists', query: 'getArtists' }
    ];
    let music;
    let observedNodes = [];
    let recentlyPlayedRequested = false;

    function icon(name) {
        const node = make('span', 'material-icons ' + name);
        node.setAttribute('aria-hidden', 'true');
        return node;
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
        const previous = makeAction('button', '', 'chevron_left');
        const next = makeAction('button', '', 'chevron_right');
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
            img.addEventListener('error', () => img.remove(), { once: true });
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
            Object.assign(options, definition.noun === 'albums'
                ? { IncludeItemTypes: 'MusicAlbum', SortBy: 'DateCreated', SortOrder: 'Descending' }
                : { SortBy: 'SortName', SortOrder: 'Ascending' });
            const result = await client[definition.query](userId, options);
            if (state !== music || !state.page.isConnected || state.page.classList.contains('hide') ||
                client !== window.ApiClient || userId !== client.getCurrentUserId()) return;
            if (!Array.isArray(result?.Items)) throw new Error('Missing Items');
            if (!result.Items.length) {
                showShelfStatus(shelf, 'No ' + definition.noun + ' found',
                    'Add music to your library to see ' + definition.noun + ' here.', definition.emptyIcon);
                return;
            }
            const cards = result.Items.map(item => makeMusicCard(item, client, definition)).filter(Boolean);
            if (!cards.length) throw new Error('Missing item links');
            shelf.track.replaceChildren(...cards);
            shelf.body.replaceChildren(shelf.track);
            shelf.updateArrows();
        } catch {
            if (state !== music || !state.page.isConnected || state.page.classList.contains('hide') ||
                client !== window.ApiClient || userId !== client.getCurrentUserId()) return;
            const status = showShelfStatus(shelf, 'Could not load ' + definition.noun, '', definition.emptyIcon);
            const retry = make('button', 'jfc-music-retry', 'Retry');
            retry.type = 'button';
            retry.addEventListener('click', () => loadShelf(state, shelf), { once: true });
            status.append(retry);
        }
    }

    function mountMusic(page, client, userId, parentId) {
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
        for (const [title, decoration, tab, section] of [
            ['Recently Played', 'play_arrow', 'suggestionsTab', 'recentlyPlayed'],
            ['Recently Added', 'layers', 'albumsTab', 'jfc-music-albums'],
            ['Artists', 'person_outline', 'artistsTab'],
            ['Playlists', 'queue_music', 'playlistsTab']
        ]) {
            const button = makeAction('button', title, decoration);
            button.type = 'button';
            button.append(icon('chevron_right'));
            button.addEventListener('click', () => selectMusicTab(page, tab, section));
            shortcuts.append(button);
        }

        const shelves = shelfDefinitions.map(makeShelf);
        const content = make('div', 'jfc-music-content');
        content.append(...shelves.map(shelf => shelf.section));
        const nativeHeading = make('h2', 'jfc-music-native-heading', 'All Albums');
        page.querySelector('#albumsTab').prepend(nativeHeading);
        const nodes = [sidebar, hero, shortcuts, content, nativeHeading];
        page.prepend(sidebar, hero, shortcuts, content);
        page.classList.add('jfc-music-page');
        return { page, client, userId, parentId, list, content, shelves, nodes, tabKey: '', started: false };
    }

    function updateMusic(page, header) {
        const client = window.ApiClient;
        const userId = client?.getCurrentUserId?.();
        const parentId = new URLSearchParams(location.hash.split('?')[1]).get('topParentId');
        const albums = page?.querySelector('#albumsTab');
        const nativeTabs = page && musicTabButton(page, 'albumsTab');
        const ready = albums && nativeTabs && userId && parentId && getComputedStyle(page).getPropertyValue('--jfc-theme-version').trim();
        if (music && (!ready || music.page !== page || music.client !== client || music.userId !== userId || music.parentId !== parentId)) {
            music.page.classList.remove('jfc-music-page');
            music.nodes.forEach(node => node.remove());
            music = null;
            recentlyPlayedRequested = false;
        }
        header?.classList.toggle('jfc-music-header', Boolean(ready));
        if (!ready) return;
        if (!music) music = mountMusic(page, client, userId, parentId);

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
                const button = makeAction('button', label, decoration);
                button.type = 'button';
                button.dataset.jfcTab = id;
                button.addEventListener('click', () => selectMusicTab(page, id));
                return button;
            }));
            if (collections?.startsWith('#/list?')) {
                const link = makeAction('a', 'Collections', 'layers');
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
        const desktopOrMobile = document.documentElement.matches('.layout-desktop, .layout-mobile');
        const tab = desktopOrMobile ? document.querySelector(homeSelector) : null;
        const page = tab?.closest('#indexPage');
        const sections = tab?.querySelector(':scope > .sections');
        const header = document.querySelector('.skinHeader');
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
            if (musicPage) observer.observe(musicPage, classChanges);
            musicPanels.forEach(panel => observer.observe(panel, classChanges));
        }

        updateMusic(musicPage, header);
        const homeActive = sections && tab.classList.contains('is-active') &&
            getComputedStyle(tab).getPropertyValue('--jfc-hero-height').trim();
        if (homeActive) {
            const libraries = getLibraries(sections);
            const shortcuts = getPrimaryShortcuts(libraries);
            setHero(tab, sections, shortcuts);
            setHeader(header, shortcuts, libraries.length > 0, 'home');
        } else {
            tab?.querySelector(':scope > .jfc-hero')?.remove();
            const kind = [...libraryTypes].find(([, type]) => '#' + type.path === route)?.[0];
            if (desktopOrMobile && kind && getComputedStyle(document.documentElement).getPropertyValue('--jfc-theme-version').trim()) {
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
    }

    function schedule() {
        if (!pendingFrame) pendingFrame = requestAnimationFrame(refresh);
    }

    const observer = new MutationObserver(schedule);
    document.addEventListener('viewshow', schedule, true);
    document.addEventListener('viewhide', schedule, true);
    document.addEventListener('tabchange', schedule, true);
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('DOMContentLoaded', schedule, { once: true });
    window.addEventListener('load', schedule, { once: true });
    window.addEventListener('hashchange', schedule);
    window.addEventListener('popstate', schedule);
    schedule();
})();
