(() => {
    'use strict';

    // Optional: map a library ID from its native link to movies, tvshows, or music.
    const libraryTypesById = {};
    const labels = { home: 'Home', media: 'My Media' };
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
        '.homeLibraryButton[href]:not([data-jfc-watch-entry])',
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

    function setHero(tab, sections) {
        if (tab.querySelector(':scope > .jfc-hero')) return;

        const hero = make('section', 'jfc-hero');
        const style = getComputedStyle(tab);
        const title = make('h1', 'jfc-hero-title', themeText(style, 'title'));
        hero.append(
            make('p', 'jfc-hero-kicker', themeText(style, 'welcome')),
            title,
            make('p', 'jfc-hero-subtitle', themeText(style, 'subtitle'))
        );
        sections.before(hero);
        serverName().then(name => {
            if (name && title.isConnected) title.textContent = name;
        });
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
        params.delete('playlist');
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

    function makeShelfArrows(track, trackLabel) {
        const previous = musicButton('button', '', 'chevron_left');
        const next = musicButton('button', '', 'chevron_right');
        const controls = make('div', 'jfc-music-scroll');
        controls.append(previous, next);
        for (const [button, direction, label] of [[previous, -1, 'Previous'], [next, 1, 'Next']]) {
            button.type = 'button';
            button.setAttribute('aria-label', label + ' ' + trackLabel);
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
        return { controls, updateArrows, dispose: () => track.removeEventListener('scroll', updateArrows) };
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
        const { controls, updateArrows } = makeShelfArrows(track, definition.noun);
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

    const MUSIC_PLAYLIST_PREF_ID = 'jfc-music-playlists';
    const MUSIC_PLAYLIST_CLIENT = 'jellyfin-cinematic';
    const MUSIC_PLAYLIST_PREF_KEY = 'playlistsJson';
    const playlistNameLimit = 100;
    const playlistIdPattern = /^[\w-]{1,100}$/;
    const trackIdPattern = /^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i;
    const sameData = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const isTrack = item => item?.Type === 'Audio' && !item.IsFolder && trackIdPattern.test(item.Id);
    let playlistStore;
    let playlistView;
    let playlistDialog;

    function playlistId() {
        return crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)),
            byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function readPlaylists(raw) {
        if (raw === undefined) return [];
        const data = JSON.parse(raw);
        if (!Array.isArray(data?.playlists)) throw new Error('Invalid playlist data');
        const ids = new Set();
        return data.playlists.map(({ id, name, createdAt, trackIds }) => {
            if (typeof id !== 'string' || !playlistIdPattern.test(id) || ids.has(id) ||
                typeof name !== 'string' || !name.trim() || name.trim().length > playlistNameLimit ||
                !Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > 8.64e15 ||
                !Array.isArray(trackIds) || trackIds.some(track => typeof track !== 'string' || !trackIdPattern.test(track))) {
                throw new Error('Invalid playlist record');
            }
            ids.add(id);
            return { id, name: name.trim(), createdAt, trackIds: [...new Set(trackIds)] };
        });
    }

    function validatePlaylistChanges(changes) {
        if (!Array.isArray(changes)) throw new Error('Invalid playlist journal');
        const validName = name => typeof name === 'string' && !!name.trim() && name.length <= playlistNameLimit;
        const validTracks = ids => Array.isArray(ids) && ids.every(id => typeof id === 'string' && trackIdPattern.test(id));
        return changes.map(change => {
            const { type, id, before, value } = change;
            if (typeof id !== 'string' || !playlistIdPattern.test(id)) throw new Error('Invalid playlist ID');
            if (type === 'create' || type === 'delete') {
                const snapshot = readPlaylists(JSON.stringify({ playlists: [type === 'create' ? value : before] }))[0];
                if (snapshot.id === id) return type === 'create' ? { type, id, value: snapshot } : { type, id, before: snapshot };
            }
            if (type === 'name' && validName(before) && validName(value)) return { type, id, before, value };
            if (type === 'order' && validTracks(before) && validTracks(value) &&
                before.length === value.length && new Set(value).size === value.length) {
                const original = new Set(before);
                if (value.every(track => original.has(track))) return { type, id, before, value };
            }
            if ((type === 'add' || type === 'remove') && typeof value === 'string' && trackIdPattern.test(value)) return { type, id, value };
            throw new Error('Invalid playlist change');
        });
    }

    function applyPlaylistChange(playlists, { type, id, before, value }) {
        const current = playlists.find(item => item.id === id);
        if (type === 'create') {
            if (!current) return [...playlists, value];
            if (sameData(current, value)) return playlists;
        } else if (type === 'delete') {
            if (!current || sameData(current, before)) return playlists.filter(item => item.id !== id);
        } else if (current) {
            let next;
            if (type === 'add') next = { ...current, trackIds: [...new Set([...current.trackIds, value])] };
            if (type === 'remove') next = { ...current, trackIds: current.trackIds.filter(track => track !== value) };
            if (type === 'name' && (current.name === before || current.name === value)) next = { ...current, name: value };
            if (type === 'order' && (sameData(current.trackIds, before) || sameData(current.trackIds, value))) {
                next = { ...current, trackIds: value };
            }
            if (next) return playlists.map(item => item === current ? next : item);
        }
        throw new Error('Playlist changed on another device');
    }

    function withRequestTimeout(request) {
        let timeout;
        return Promise.race([
            Promise.resolve().then(request),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Request timed out')), 10000); })
        ]).finally(() => clearTimeout(timeout));
    }

    function openPlaylistStore(client, userId, serverId) {
        const key = ['jfc-music-playlists', serverId, userId].map(encodeURIComponent).join(':');
        const journal = key + ':pending';
        const enabled = () => window.ApiClient === client && client.getCurrentUserId() === userId && client.serverId() === serverId;
        let pending = [];
        let attempt = null;
        let running = null;
        let browserWritable = true;
        let lastServer;
        const store = {
            client, userId, serverId, enabled, playlists: [], ready: false, status: '', metadata: new Map(),
            refresh() { return running || start(); },
            mutate(changes) {
                if (!store.ready || !enabled()) return false;
                const next = changes.reduce(applyPlaylistChange, store.playlists);
                if (sameData(next, store.playlists)) return false;
                store.playlists = next;
                pending.push(...changes);
                saveLocal();
                store.status = browserWritable ? 'Saved on this browser. Syncing…' : 'Syncing…';
                updatePlaylistUI(store);
                store.refresh();
                return true;
            },
            useServerCopy() {
                if (!lastServer || running || !enabled()) return;
                pending = [];
                attempt = null;
                store.playlists = lastServer;
                saveLocal();
                store.status = 'Synced with Jellyfin';
                store.conflict = false;
                updatePlaylistUI(store);
            }
        };

        try {
            const raw = localStorage.getItem(key);
            store.playlists = readPlaylists(raw ?? undefined);
            const saved = JSON.parse(localStorage.getItem(journal) || 'null');
            if (saved) {
                const changes = validatePlaylistChanges(saved.pending);
                const records = readPlaylists(JSON.stringify(saved.snapshot));
                if (saved.attempt) {
                    const { count, playlists } = saved.attempt;
                    if (!Number.isSafeInteger(count) || count < 1 || count > changes.length) throw new Error('Invalid playlist journal');
                    attempt = { count, playlists: readPlaylists(JSON.stringify({ playlists })) };
                }
                pending = changes;
                if (saved.snapshot) store.playlists = records;
            }
        } catch {
            // Leave unreadable browser data intact.
            browserWritable = false;
        }

        function saveLocal() {
            if (!browserWritable) return;
            try {
                const snapshot = { playlists: store.playlists };
                if (pending.length) localStorage.setItem(journal, JSON.stringify({ pending, attempt, snapshot }));
                localStorage.setItem(key, JSON.stringify(snapshot));
                if (!pending.length) localStorage.removeItem(journal);
            } catch {
                browserWritable = false;
            }
        }

        async function sync() {
            while (enabled()) {
                let preferences;
                let remote;
                try {
                    preferences = await withRequestTimeout(() => client.getDisplayPreferences(MUSIC_PLAYLIST_PREF_ID, userId, MUSIC_PLAYLIST_CLIENT));
                    if (!preferences || typeof preferences !== 'object') throw new Error('Missing preferences');
                    remote = readPlaylists(preferences.CustomPrefs?.[MUSIC_PLAYLIST_PREF_KEY]);
                } catch {
                    store.status = browserWritable ? 'Saved on this browser only. Jellyfin sync unavailable.' :
                        'Jellyfin sync and browser storage unavailable. Changes are kept for this session.';
                    return;
                }
                if (!enabled()) return;
                lastServer = remote;
                if (attempt && sameData(attempt.playlists, remote)) pending.splice(0, attempt.count);
                attempt = null;
                const changes = pending.slice();
                let next;
                try {
                    next = changes.reduce(applyPlaylistChange, remote);
                } catch {
                    store.conflict = true;
                    store.status = 'Playlist changes conflict with Jellyfin. Your local copy has been kept.';
                    return;
                }
                store.conflict = false;
                if (sameData(remote, next)) {
                    pending.splice(0, changes.length);
                    if (!sameData(store.playlists, remote)) store.playlists = remote;
                    saveLocal();
                    store.status = 'Synced with Jellyfin';
                    return;
                }

                attempt = { count: changes.length, playlists: next };
                saveLocal();
                const waitNotice = setTimeout(() => {
                    if (!enabled()) return;
                    store.status = browserWritable ? 'Saved on this browser. Jellyfin sync is taking longer than expected.' :
                        'Jellyfin sync is taking longer than expected.';
                    updatePlaylistUI(store);
                }, 10000);
                try {
                    await client.updateDisplayPreferences(MUSIC_PLAYLIST_PREF_ID, {
                        ...preferences,
                        CustomPrefs: { ...preferences.CustomPrefs, [MUSIC_PLAYLIST_PREF_KEY]: JSON.stringify({ playlists: next }) }
                    }, userId, MUSIC_PLAYLIST_CLIENT);
                } catch {
                    store.status = browserWritable ? 'Saved on this browser only. Jellyfin sync unavailable.' :
                        'Changes are kept for this session. Jellyfin sync and browser storage unavailable.';
                    return;
                } finally {
                    clearTimeout(waitNotice);
                }
                pending.splice(0, changes.length);
                attempt = null;
                lastServer = next;
                try {
                    const merged = pending.reduce(applyPlaylistChange, next);
                    if (!sameData(store.playlists, merged)) store.playlists = merged;
                } catch {
                    store.conflict = true;
                    store.status = 'Playlist changes conflict with Jellyfin. Your local copy has been kept.';
                    saveLocal();
                    return;
                }
                saveLocal();
                if (!pending.length) {
                    store.status = 'Synced with Jellyfin';
                    return;
                }
            }
        }

        function start() {
            running = sync().catch(() => {
                store.status = 'Music playlists could not be synchronized.';
            }).finally(() => {
                running = null;
                store.ready = true;
                updatePlaylistUI(store);
                if (pending.length && enabled() && (!playlistView || playlistView.shell.hidden)) playlistFeedback(store.status);
            });
            return running;
        }

        store.refresh();
        return store;
    }

    function currentPlaylistStore() {
        const client = window.ApiClient;
        const userId = client?.getCurrentUserId?.();
        const serverId = client?.serverId?.();
        if (playlistStore && !playlistStore.enabled()) playlistStore = undefined;
        if (!userId || !serverId) return null;
        if (!playlistStore) playlistStore = openPlaylistStore(client, userId, serverId);
        return playlistStore;
    }

    async function playlistTracks(store, ids) {
        const cache = store.metadata;
        const now = Date.now();
        const missing = [...new Set(ids)].filter(id => !(cache.get(id)?.expires > now));
        for (let i = 0; i < missing.length; i += 100) {
            const batch = missing.slice(i, i + 100);
            const result = withRequestTimeout(() => store.client.getItems(store.userId, {
                Ids: batch.join(','), IncludeItemTypes: 'Audio', Fields: 'PrimaryImageAspectRatio',
                EnableTotalRecordCount: false
            })).then(response => {
                if (!Array.isArray(response?.Items)) throw new Error('Missing Items');
                return new Map(response.Items.filter(isTrack).map(item => [item.Id, item]));
            });
            for (const id of batch) {
                const entry = { expires: now + 120000, item: result.then(items => items.get(id) || null) };
                cache.set(id, entry);
                entry.item.catch(() => { if (cache.get(id) === entry) cache.delete(id); });
            }
        }
        const items = await Promise.all(ids.map(id => cache.get(id)?.item || null));
        return new Map(ids.map((id, index) => [id, items[index]]));
    }

    function playlistHref(id) {
        const hash = musicRoute(5, 'music-playlists');
        return id ? hash + '&playlist=' + encodeURIComponent(id) : hash;
    }

    function playlistControl(label, action, key) {
        const button = make('button', 'jfc-music-playlist-button', label);
        button.type = 'button';
        if (key) button.dataset.focus = key;
        button.addEventListener('click', action);
        return button;
    }

    function playlistLink(label, id) {
        const link = make('a', 'jfc-music-playlist-link', label);
        link.href = playlistHref(id);
        return link;
    }

    function playlistImage(client, item, size) {
        const art = make('span', 'jfc-music-playlist-art');
        art.append(icon('music_note'));
        const tag = item?.ImageTags?.Primary;
        const albumTag = item?.AlbumPrimaryImageTag;
        const id = tag ? item.Id : albumTag && item.AlbumId;
        if (id) {
            const img = make('img');
            img.alt = '';
            img.loading = 'lazy';
            img.addEventListener('error', () => img.remove(), { once: true });
            img.src = client.getScaledImageUrl(id, { type: 'Primary', tag: tag || albumTag, fillWidth: size, fillHeight: size });
            art.append(img);
        }
        return art;
    }

    function playlistCover(store, ids) {
        const cover = playlistImage(store.client);
        if (ids.length) playlistTracks(store, ids.slice(0, 4)).then(items => {
            const images = [...items.values()].map(item => playlistImage(store.client, item, 224).querySelector('img')).filter(Boolean);
            if (images.length && cover.isConnected && store.enabled()) cover.append(images[0]);
        }).catch(() => {});
        return cover;
    }

    function duration(ticks) {
        const seconds = Math.floor(Math.max(0, ticks || 0) / 10000000);
        const time = [Math.floor(seconds / 60) % 60, seconds % 60];
        if (seconds >= 3600) time.unshift(Math.floor(seconds / 3600));
        return time.map((part, index) => index ? String(part).padStart(2, '0') : part).join(':');
    }

    const trackCount = count => count + (count === 1 ? ' track' : ' tracks');

    function playlistSummary(record, items) {
        const ticks = [...items.values()].reduce((sum, item) => sum + (item?.RunTimeTicks || 0), 0);
        return trackCount(record.trackIds.length) + (ticks ? ' · ' + duration(ticks) : '');
    }

    function closePlaylistDialog() {
        if (!playlistDialog) return;
        playlistDialog.close();
        playlistDialog.remove();
        playlistDialog = null;
    }

    function playlistForm(store, title, confirmLabel, build, submit) {
        if (!store?.enabled() || !store.ready || playlistDialog) return;
        const opener = document.activeElement;
        const dialog = make('dialog', 'jfc-music-playlist-dialog');
        const form = make('form');
        const heading = make('h2', '', title);
        heading.id = 'jfc-music-playlist-dialog-title';
        dialog.setAttribute('aria-labelledby', heading.id);
        const error = make('p', 'jfc-music-playlist-error');
        error.setAttribute('role', 'alert');
        const controls = make('div', 'jfc-music-playlist-actions');
        const confirm = make('button', 'jfc-music-playlist-button jfc-music-playlist-primary', confirmLabel);
        confirm.type = 'submit';
        controls.append(playlistControl('Cancel', closePlaylistDialog), confirm);
        build(form);
        form.prepend(heading);
        form.append(error, controls);
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (!store.enabled() || dialog !== playlistDialog) return closePlaylistDialog();
            confirm.disabled = true;
            try {
                const onClose = submit();
                closePlaylistDialog();
                if (typeof onClose === 'function') onClose();
            } catch (err) {
                error.textContent = err.message;
                confirm.disabled = false;
            }
        });
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            closePlaylistDialog();
        });
        dialog.addEventListener('close', () => {
            if (opener?.isConnected) opener.focus();
            else playlistView?.panel.querySelector('h2')?.focus();
        });
        dialog.append(form);
        document.body.append(dialog);
        playlistDialog = dialog;
        dialog.showModal();
    }

    function playlistNameInput(form, initial = '') {
        const label = make('label', '', 'Playlist name');
        const field = make('input');
        field.type = 'text';
        field.maxLength = playlistNameLimit;
        field.value = initial;
        label.append(field);
        form.append(label);
        return field;
    }

    function newPlaylist(store, name, trackIds = []) {
        if (!name) throw new Error('Enter a playlist name.');
        let id;
        do { id = playlistId(); } while (store.playlists.some(item => item.id === id));
        return { type: 'create', id, value: { id, name, createdAt: Date.now(), trackIds } };
    }

    function editPlaylistName(store, record) {
        let field;
        playlistForm(store, record ? 'Rename playlist' : 'Create Playlist', record ? 'Save name' : 'Create Playlist', form => {
            field = playlistNameInput(form, record?.name);
            field.autofocus = true;
        }, () => {
            const name = field.value.trim();
            if (!name) throw new Error('Enter a playlist name.');
            const operation = record ? { type: 'name', id: record.id, before: record.name, value: name } : newPlaylist(store, name);
            store.mutate([operation]);
            if (!record) return () => { location.hash = playlistHref(operation.id); };
        });
    }

    function confirmPlaylistDelete(store, record) {
        playlistForm(store, 'Delete playlist?', 'Delete playlist', form => {
            form.append(make('p', '', 'Remove “' + record.name + '” from Music Playlists?'));
        }, () => { store.mutate([{ type: 'delete', id: record.id, before: record }]); });
    }

    function addToMusicPlaylist(store, id) {
        if (!store?.enabled() || !store.ready || playlistDialog) return;
        const route = location.hash;
        const scope = playlistTrackScope();
        playlistTracks(store, [id]).then(items => {
            if (store !== playlistStore || !store.enabled() || location.hash !== route || playlistTrackScope() !== scope) return;
            const item = items.get(id);
            if (!item) return playlistFeedback('This audio track is unavailable.');
            let field;
            let choices;
            playlistForm(store, 'Add to Music Playlists', 'Add track', form => {
                form.append(make('p', '', item.Name || 'Audio track'));
                const group = make('fieldset', 'jfc-music-playlist-choices');
                group.append(make('legend', '', 'Choose playlists'));
                choices = store.playlists.map(record => {
                    const label = make('label');
                    const box = make('input');
                    box.type = 'checkbox';
                    box.disabled = record.trackIds.includes(id);
                    box.checked = box.disabled;
                    label.append(box, make('span', '', record.name + (box.disabled ? ' · Already added' : '')));
                    group.append(label);
                    return [record.id, box];
                });
                if (choices.length) form.append(group);
                field = playlistNameInput(form);
                field.placeholder = 'Or create a new playlist';
                if (!choices.length) field.autofocus = true;
            }, () => {
                const changes = choices.filter(([, box]) => box.checked && !box.disabled).map(([playlist]) =>
                    ({ type: 'add', id: playlist, value: id }));
                if (field.value.trim()) changes.push(newPlaylist(store, field.value.trim(), [id]));
                if (!changes.length) throw new Error('Select a playlist or enter a new playlist name.');
                if (!store.mutate(changes)) throw new Error('That track is already in the selected playlists.');
                return () => playlistFeedback('Track added to Music Playlists.');
            });
        }).catch(() => {
            if (store.enabled() && location.hash === route) playlistFeedback('Could not load this audio track.');
        });
    }

    let playbackRequest = 0;
    async function startPlaylist(store, record, shuffle, selected) {
        if (!record.trackIds.length) return playlistFeedback('Add a track before playing this playlist.');
        const request = ++playbackRequest;
        try {
            const tracks = await playlistTracks(store, record.trackIds);
            if (request !== playbackRequest || !store.enabled() || playlistView?.store !== store) return;
            const ids = record.trackIds.filter(id => tracks.get(id));
            if (!ids.length || selected && !ids.includes(selected)) return playlistFeedback('No playable track is available.');
            if (shuffle) {
                for (let i = ids.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [ids[i], ids[j]] = [ids[j], ids[i]];
                }
            }
            // Jellyfin Web 12.4's ItemsContainer handles playallfromhere through its native playback manager.
            const native = music?.page.querySelector(':scope > .padded-bottom-page .itemsContainer');
            if (!native || native.fetchData) return playlistFeedback('Jellyfin playback is unavailable on this view.');
            const group = make('div', 'itemsContainer');
            group.hidden = true;
            // The native fetchData branch queues the complete ordered result without the default 300-ID limit.
            group.fetchData = async () => ({ Items: ids.map(id => ({ ...tracks.get(id), ServerId: store.serverId })) });
            const entries = ids.map(id => {
                const item = make('div', 'jfc-music-playlist-playback itemAction');
                Object.assign(item.dataset, { id, type: 'Audio', mediatype: 'Audio', serverid: store.serverId, action: 'playallfromhere' });
                return item;
            });
            group.append(...entries);
            native.append(group);
            try {
                const start = entries[selected ? ids.indexOf(selected) : 0];
                if (start.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))) {
                    playlistFeedback('This Jellyfin client did not accept the playback request.');
                }
            } finally {
                group.remove();
            }
        } catch {
            playlistFeedback('Could not prepare the playlist for playback.');
        }
    }

    let playlistNotice;
    let playlistNoticeTimer;
    function playlistFeedback(message) {
        if (!playlistTrackScope() || !playlistStore?.enabled()) return;
        if (!playlistNotice?.isConnected) {
            playlistNotice = make('div', 'jfc-music-playlist-notice');
            playlistNotice.setAttribute('role', 'status');
            document.body.append(playlistNotice);
        }
        playlistNotice.textContent = message;
        clearTimeout(playlistNoticeTimer);
        playlistNoticeTimer = setTimeout(() => playlistNotice?.remove(), 3500);
    }

    function playlistActions(store, record, key) {
        const actions = make('div', 'jfc-music-playlist-actions');
        for (const [label, action] of [
            ['Play', () => startPlaylist(store, record, false)],
            ['Shuffle', () => startPlaylist(store, record, true)],
            ['Rename', () => editPlaylistName(store, record)],
            ['Delete', () => confirmPlaylistDelete(store, record)]
        ]) {
            const button = playlistControl(label, action, key + label);
            button.setAttribute('aria-label', label + ' ' + record.name);
            actions.append(button);
        }
        actions.firstChild.classList.add('jfc-music-playlist-primary');
        return actions;
    }

    function playlistCard(view, record, manage) {
        const { store } = view;
        const card = make('article', 'jfc-music-playlist-card');
        const link = playlistLink(record.name, record.id);
        link.dataset.focus = record.id;
        const summary = make('span', 'jfc-music-playlist-meta', trackCount(record.trackIds.length));
        link.prepend(playlistCover(store, record.trackIds));
        link.append(summary);
        card.append(link);
        if (manage) {
            card.append(playlistActions(store, record, record.id));
            if (record.trackIds.length) playlistTracks(store, record.trackIds).then(items => {
                if (summary.isConnected && store.enabled()) summary.textContent = playlistSummary(record, items);
            }).catch(() => {});
        }
        return card;
    }

    function populatePlaylistCards(view, target, records, manage) {
        const grid = make('div', 'jfc-music-playlist-grid');
        if (!records.length) {
            target.replaceChildren(make('p', 'jfc-music-playlist-empty',
                records === view.store.playlists || !view.query ? 'No music playlists yet.' : 'No matching playlists.'));
            return;
        }
        target.replaceChildren(grid);
        let rendered = 0;
        const next = playlistControl('Show more playlists', showMore);
        function showMore() {
            const end = Math.min(rendered + (manage ? 24 : 12), records.length);
            grid.append(...records.slice(rendered, end).map(record => playlistCard(view, record, manage)));
            rendered = end;
            if (rendered >= records.length) next.remove();
        }
        target.append(next);
        showMore();
    }

    function setPlaylistOrder(store, record, from, to) {
        if (from === to || to < 0 || to >= record.trackIds.length) return;
        const order = record.trackIds.slice();
        order.splice(to, 0, ...order.splice(from, 1));
        try {
            store.mutate([{ type: 'order', id: record.id, before: record.trackIds, value: order }]);
        } catch {
            playlistFeedback('This playlist changed. Try reordering again.');
        }
    }

    function playlistTrackRow(view, record, track, index) {
        const { store } = view;
        const id = record.trackIds[index];
        const row = make('li', 'jfc-music-playlist-row');
        const title = track?.Name || 'Unavailable track';
        row.append(make('span', 'jfc-music-playlist-number', index + 1), playlistImage(store.client, track, 96));
        const copy = make('div', 'jfc-music-playlist-track-info');
        if (track) {
            const play = playlistControl(title, () => startPlaylist(store, record, false, id), id + 'play');
            play.classList.add('jfc-music-playlist-track-title');
            play.setAttribute('aria-label', 'Play ' + title);
            copy.append(play);
            copy.append(make('span', 'jfc-music-playlist-meta', [track.Artists?.join(', '), track.Album].filter(Boolean).join(' · ')));
        } else {
            copy.append(make('strong', '', title), make('span', 'jfc-music-playlist-meta', 'This song could not be found.'));
        }
        row.append(copy, make('span', 'jfc-music-playlist-time', track?.RunTimeTicks ? duration(track.RunTimeTicks) : '—'));

        const actions = make('div', 'jfc-music-playlist-actions');
        for (const [label, arrow, step] of [['Move up', '↑', -1], ['Move down', '↓', 1]]) {
            const move = playlistControl(arrow, () => setPlaylistOrder(store, record, index, index + step), id + label);
            move.title = label;
            move.setAttribute('aria-label', label + ' ' + title);
            move.disabled = index + step < 0 || index + step >= record.trackIds.length;
            actions.append(move);
        }
        const remove = playlistControl('Remove', () => {
            store.mutate([{ type: 'remove', id: record.id, value: id }]);
            playlistFeedback('Track removed from ' + record.name + '.');
        }, id + 'remove');
        remove.setAttribute('aria-label', 'Remove ' + title);
        actions.append(remove);
        row.append(actions);

        if (matchMedia('(pointer: fine)').matches) {
            const handle = make('span', 'jfc-music-playlist-grip', '⠿');
            handle.draggable = true;
            handle.setAttribute('aria-hidden', 'true');
            handle.title = 'Drag to reorder';
            handle.addEventListener('dragstart', event => {
                view.dragged = { record, index };
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', title);
            });
            handle.addEventListener('dragend', () => { view.dragged = null; });
            row.addEventListener('dragover', event => {
                if (view.dragged?.record === record) event.preventDefault();
            });
            row.addEventListener('drop', event => {
                if (view.dragged?.record !== record) return;
                event.preventDefault();
                setPlaylistOrder(store, record, view.dragged.index, index);
                view.dragged = null;
            });
            row.prepend(handle);
        }
        return row;
    }

    function renderPlaylistDetail(view, record, target) {
        const { store } = view;
        const back = playlistLink('← Music Playlists');
        back.dataset.focus = 'back';
        const header = make('header', 'jfc-music-playlist-detail-heading');
        const text = make('div');
        const title = make('h2', '', record.name);
        title.tabIndex = -1;
        const summary = make('p', 'jfc-music-playlist-meta', trackCount(record.trackIds.length));
        const created = make('p', 'jfc-music-playlist-meta', 'Created ' + new Date(record.createdAt).toLocaleDateString());
        text.append(title, summary, created, playlistActions(store, record, 'detail'));
        header.append(playlistCover(store, record.trackIds), text);
        const listing = make('div');
        target.append(back, header, listing);
        if (!record.trackIds.length) {
            const songs = playlistLink('Browse All Songs');
            songs.href = musicRoute(5);
            listing.append(make('p', 'jfc-music-playlist-empty', 'Add songs from All Songs, an album, or Recently Played.'), songs);
            return;
        }
        const loading = make('p', 'jfc-music-playlist-meta', 'Loading tracks…');
        listing.append(loading);
        playlistTracks(store, record.trackIds).then(items => {
            if (playlistView !== view || !store.enabled() || !listing.isConnected) return;
            summary.textContent = playlistSummary(record, items);
            const list = make('ol', 'jfc-music-playlist-tracks');
            listing.replaceChildren(list);
            let runtimeRows = 0;
            const more = playlistControl('Show more tracks', renderRows);
            function renderRows() {
                const until = Math.min(record.trackIds.length, Math.max(runtimeRows + 60, view.trackLimit));
                list.append(...record.trackIds.slice(runtimeRows, until).map((id, index) =>
                    playlistTrackRow(view, record, items.get(id), runtimeRows + index)));
                runtimeRows = until;
                view.trackLimit = runtimeRows;
                if (until >= record.trackIds.length) more.remove();
            }
            listing.append(more);
            renderRows();
            if (view.restoreFocus && document.activeElement === document.body) {
                const previous = list.querySelector('[data-focus="' + CSS.escape(view.restoreFocus) + '"]');
                const focus = previous?.disabled ? previous.closest('li').querySelector('button:not(:disabled)') : previous;
                focus?.focus({ preventScroll: true });
            }
        }).catch(() => {
            if (listing.isConnected) {
                loading.textContent = 'Could not load tracks.';
                listing.append(playlistControl('Retry', () => {
                    target.replaceChildren();
                    renderPlaylistDetail(view, record, target);
                }));
            }
        });
    }

    function updatePlaylistUI(store) {
        const view = playlistView;
        if (!view || view.store !== store || !store.enabled()) return;
        view.message.textContent = store.status;
        view.retry.hidden = !store.status.includes('browser only') && !store.status.includes('unavailable') && !store.conflict;
        view.discard.hidden = !store.conflict;
        const previous = view.rendered;
        if (previous?.records === store.playlists && previous.ready === store.ready && previous.id === view.id && previous.active === view.active) return;
        view.rendered = { records: store.playlists, ready: store.ready, id: view.id, active: view.active };
        if (view.shelfReady !== store.ready || previous?.records !== store.playlists) {
            view.shelfReady = store.ready;
            view.shelfCreate.disabled = !store.ready;
            if (store.ready) populatePlaylistCards(view, view.shelfBody, store.playlists, false);
        }
        if (!view.active) return;
        const focused = document.activeElement;
        view.restoreFocus = focused?.dataset.focus || '';
        if (previous?.id !== view.id) view.trackLimit = 0;
        const target = view.content;
        target.replaceChildren();
        if (!store.ready) {
            target.append(make('p', '', 'Loading Music Playlists…'));
            return;
        }
        const record = store.playlists.find(item => item.id === view.id);
        if (record) {
            renderPlaylistDetail(view, record, target);
        } else {
            const header = make('header', 'jfc-music-playlist-heading');
            const title = make('h2', '', 'Music Playlists');
            title.tabIndex = -1;
            header.append(title, playlistControl('Create Playlist', () => editPlaylistName(store), 'create'));
            const field = make('input', 'jfc-music-playlist-search');
            field.type = 'search';
            field.placeholder = 'Search playlists';
            field.setAttribute('aria-label', 'Search playlists');
            field.value = view.query;
            field.dataset.focus = 'search';
            const cards = make('div');
            function filter() {
                const query = view.query.trim().toLocaleLowerCase();
                const records = query ? store.playlists.filter(item => item.name.toLocaleLowerCase().includes(query)) : store.playlists;
                populatePlaylistCards(view, cards, records, true);
            }
            field.addEventListener('input', () => {
                view.query = field.value;
                filter();
            });
            target.append(header, field, cards);
            filter();
        }
        if (view.restoreFocus) {
            target.querySelector('[data-focus="' + CSS.escape(view.restoreFocus) + '"]')?.focus({ preventScroll: true });
        } else if (previous && (previous.id !== view.id || !previous.active)) {
            target.querySelector('h2')?.focus({ preventScroll: true });
        }
    }

    function mountPlaylists(state, store) {
        const shell = make('section', 'jfc-music-playlist-shell');
        const shelf = make('section', 'jfc-music-playlist-shelf');
        const header = make('header', 'jfc-music-playlist-heading');
        const title = make('h2');
        title.append(playlistLink('Music Playlists'));
        const shelfCreate = playlistControl('Create Playlist', () => editPlaylistName(store));
        const shelfBody = make('div');
        header.append(title, shelfCreate);
        shelf.append(header, shelfBody);
        const panel = make('section', 'jfc-music-playlist-panel');
        const content = make('div');
        panel.append(content);
        const sync = make('div', 'jfc-music-playlist-sync');
        const message = make('span', '', 'Loading Music Playlists…');
        message.setAttribute('role', 'status');
        const retry = playlistControl('Retry sync', () => store.refresh());
        const discard = playlistControl('Use server copy', () => {
            playlistForm(store, 'Use server copy?', 'Use server copy', form => {
                form.append(make('p', '', 'Discard the pending local changes and load the last server copy?'));
            }, () => { store.useServerCopy(); });
        });
        sync.append(message, retry, discard);
        shell.append(shelf, panel, sync);
        state.played.section.after(shell);
        shelfBody.append(make('p', 'jfc-music-playlist-empty', 'Loading Music Playlists…'));
        const view = { store, shell, shelf, shelfCreate, shelfBody, panel, content, message, retry, discard, query: '', trackLimit: 0 };
        playlistView = view;
        store.refresh();
        return view;
    }

    function unmountPlaylists() {
        if (!playlistView) return;
        closePlaylistDialog();
        playbackRequest++;
        playlistView.shell.remove();
        playlistView = null;
    }

    function updatePlaylists(state, activeTab, target, params) {
        const store = currentPlaylistStore();
        if (!store) return;
        const view = playlistView || mountPlaylists(state, store);
        const active = target === 'music-playlists';
        view.id = active && params.get('playlist');
        view.active = active;
        view.shell.hidden = !active && activeTab !== 0;
        view.shelf.hidden = active;
        view.panel.hidden = !active;
        state.page.classList.toggle('jfc-music-playlist-active', active);
        updatePlaylistUI(store);
    }

    function playlistTrackScope() {
        const route = location.hash.split('?')[0];
        if (route === '#/music' && music?.modern) return music.page;
        if (route === '#/details') return document.querySelector('#itemDetailPage:not(.hide) #listChildrenCollapsible');
        return null;
    }

    let trackActionScope;
    let trackActionRoute;
    let trackActionAccount;
    let trackActionFrame;
    let trackActionVerified = false;
    const trackActionObserver = new MutationObserver(() => {
        if (!trackActionFrame) trackActionFrame = requestAnimationFrame(renderTrackActions);
    });

    function trackActionButton(store, id) {
        const button = playlistControl('+ Music Playlist', event => {
            event.stopPropagation();
            addToMusicPlaylist(store, id);
        });
        button.classList.add('jfc-music-playlist-add');
        return button;
    }

    function renderTrackActions() {
        trackActionFrame = 0;
        const scope = trackActionScope;
        const store = trackActionAccount;
        if (!trackActionVerified || scope !== playlistTrackScope() || !store?.ready || !store.enabled()) return;
        for (const row of scope.querySelectorAll(':is(.card, .listItem)[data-type="Audio"][data-id], [data-jfc-audio-id]')) {
            const id = row.dataset.jfcAudioId || row.dataset.id;
            if (!trackIdPattern.test(id) || row.dataset.isfolder === 'true' ||
                row.dataset.serverid && row.dataset.serverid !== store.serverId ||
                row.querySelector('.jfc-music-playlist-add')) continue;
            row.append(trackActionButton(store, id));
        }
    }

    function updateTrackActions(scope) {
        const route = location.hash;
        const store = scope ? currentPlaylistStore() : null;
        if (playlistStore && !playlistStore.enabled()) playlistStore = undefined;
        if (scope === trackActionScope && store === trackActionAccount && trackActionRoute === route) return;
        playbackRequest++;
        const nextPath = route.split('?')[0];
        closePlaylistDialog();
        playlistNotice?.remove();
        clearTimeout(playlistNoticeTimer);
        trackActionObserver.disconnect();
        trackActionScope?.querySelectorAll('.jfc-music-playlist-add').forEach(button => button.remove());
        trackActionScope = scope;
        trackActionAccount = store;
        trackActionRoute = route;
        trackActionVerified = nextPath === '#/music';
        if (!scope || !store) return;
        trackActionObserver.observe(scope, { childList: true, subtree: true });
        if (trackActionVerified) {
            if (store.ready) renderTrackActions();
            else store.refresh().then(renderTrackActions);
        } else {
            const id = new URLSearchParams(route.split('?')[1]).get('id');
            if (!trackIdPattern.test(id)) return;
            withRequestTimeout(() => store.client.getItem(store.userId, id)).then(item => {
                if (location.hash !== route || trackActionScope !== scope || store !== trackActionAccount) return;
                trackActionVerified = item?.Type === 'MusicAlbum';
                if (store.ready) renderTrackActions();
                else return store.refresh().then(renderTrackActions);
            }).catch(() => {});
        }
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
            const cards = result.Items.flatMap(item => {
                const card = makeMusicCard(item, client, definition);
                if (!card) return [];
                if (!state.modern || !isTrack(item)) return [card];
                const wrapper = make('div', 'jfc-music-playlist-audio-card');
                wrapper.dataset.jfcAudioId = item.Id;
                wrapper.append(card);
                return [wrapper];
            });
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
                button.href = index === 4 ? playlistHref() : musicRoute(index, target);
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
        unmountPlaylists();
        music.page.classList.remove('jfc-music-page', 'jfc-music-empty-library', 'jfc-music-albums-active', 'jfc-music-recent-albums', 'jfc-music-playlist-active');
        music.nodes.forEach(node => node.remove());
        music = null;
        recentlyPlayedRequested = false;
    }

    function updateModernMusic(state) {
        const activeTab = currentMusicTab();
        const params = new URLSearchParams(location.hash.split('?')[1]);
        const target = params.get('jfc');
        const playlistsActive = target === 'music-playlists';
        const phone = phoneMusicLayout.matches;
        const layout = phone ? 'phone' : 'modern';
        if (state.tabKey !== layout) {
            state.tabKey = layout;
            const order = phone ? phoneMusicOrder : modernMusicLabels.keys();
            const links = Array.from(order, index => {
                const label = phone && index === 5 ? 'All Songs' : modernMusicLabels[index];
                const link = musicButton('a', label, musicTabs[index][1]);
                link.href = musicRoute(index);
                link.dataset.tab = index;
                return link;
            });
            const playlists = musicButton('a', 'Music Playlists', 'queue_music');
            playlists.href = playlistHref();
            playlists.dataset.playlists = 'true';
            const nextTo = links.findIndex(link => Number(link.dataset.tab) === 4);
            links.splice(phone ? 1 : nextTo + 1, 0, playlists);
            state.list.replaceChildren(...links);
        }
        for (const link of state.list.children) {
            if (playlistsActive ? link.dataset.playlists : activeTab === Number(link.dataset.tab)) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        }
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
        updatePlaylists(state, activeTab, target, params);
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

    const watchTypes = {
        movies: { kind: 'Movie', route: '#/movies' },
        tvshows: { kind: 'Series', route: '#/tv' }
    };
    let watchSession;
    let watchView;
    const watchNativeLinks = 'a:is([href^="#/movies?"], [href^="#/tv?"]):not([data-jfc-watch-entry])';

    function watchLibraryHref(library) {
        return watchTypes[library.CollectionType].route + '?' + new URLSearchParams({
            topParentId: library.Id, collectionType: library.CollectionType
        });
    }

    function watchHref(session, filter = 'all') {
        const params = new URLSearchParams({ jfc: 'watch' });
        if (filter !== 'all') params.set('filter', filter);
        return watchLibraryHref(session.libraries[0]) + '&' + params;
    }

    function watchLink(session, label, filter, className) {
        const link = make('a', className, label);
        link.href = watchHref(session, filter);
        return link;
    }

    function watchEntry(session, reference, home = false) {
        const container = reference.parentElement;
        let link = container.querySelector(':scope > [data-jfc-watch-entry]');
        if (!link) {
            link = make('a', home ? 'homeLibraryButton jfc-watch-tile' : 'jfc-watch-tab');
            link.dataset.jfcWatchEntry = 'true';
            const decoration = home ? make('span', 'homeLibraryIcon') : icon('play_arrow');
            decoration.setAttribute('aria-hidden', 'true');
            link.append(decoration, make('span', home ? 'homeLibraryText' : '', 'Movies & Shows'));
            reference.before(link);
        }
        link.href = watchHref(session);
        if (new URLSearchParams(location.hash.split('?')[1]).get('jfc') === 'watch') link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
        return link;
    }

    function loadWatchLibraries(client, userId) {
        const session = { client, userId, libraries: null, rows: null };
        withRequestTimeout(() => client.getUserViews({}, userId)).then(result => {
            if (!Array.isArray(result?.Items)) throw new Error('Missing libraries');
            session.libraries = result.Items.filter(item => Object.hasOwn(watchTypes, item.CollectionType) && item.Id)
                .sort((a, b) => Number(b.CollectionType === 'movies') - Number(a.CollectionType === 'movies'));
        }).catch(error => {
            session.libraries = [];
            reportFailure('Movies & Shows libraries', error);
        }).finally(() => { if (session === watchSession) schedule(); });
        return session;
    }

    function watchDetails(item, client) {
        const route = window.Emby?.Page?.getRouteUrl({ ...item, ServerId: item.ServerId || client.serverId() });
        return typeof route === 'string' && route.startsWith('#/details?') ? route : null;
    }

    function watchArtwork(client, item, landscape = false) {
        if (!item) return null;
        const backdrop = landscape && (item.BackdropImageTags?.[0] || item.ParentBackdropImageTags?.[0]);
        const artId = backdrop && !item.BackdropImageTags?.[0] ? item.ParentBackdropItemId : item.Id;
        const tag = backdrop || item.ImageTags?.Primary;
        if (!tag || !artId || typeof client.getScaledImageUrl !== 'function') return null;
        const img = make('img');
        img.alt = '';
        img.decoding = 'async';
        if (!landscape) img.loading = 'lazy';
        img.addEventListener('error', () => img.remove(), { once: true });
        img.src = client.getScaledImageUrl(artId, {
            type: backdrop ? 'Backdrop' : 'Primary', tag, maxWidth: landscape ? 1800 : 360, quality: 85
        });
        return img;
    }

    function loadWatchRows(session) {
        const { client, userId } = session;
        const queries = session.libraries.map(library => {
            const type = watchTypes[library.CollectionType].kind;
            return withRequestTimeout(() => client.getItems(userId, {
                ParentId: library.Id, Recursive: true, IncludeItemTypes: type,
                Limit: 20, SortBy: 'DateCreated', SortOrder: 'Descending', Fields: 'Overview,Genres,DateCreated',
                EnableTotalRecordCount: false
            })).then(result => {
                if (!Array.isArray(result?.Items)) throw new Error('Missing catalog');
                return result.Items.filter(item => item.Type === type);
            });
        });
        const resume = withRequestTimeout(() => client.getResumableItems(userId, {
            MediaTypes: 'Video', Limit: 16, EnableTotalRecordCount: false
        })).then(result => (result.Items || []).filter(item => ['Movie', 'Episode', 'Series'].includes(item.Type)));
        session.rows = Promise.allSettled([...queries, resume]).then(results => {
            const unique = new Map();
            for (const result of results.slice(0, -1)) {
                if (result.status === 'fulfilled') result.value.forEach(item => unique.set(item.Id, item));
            }
            const latest = [...unique.values()].sort((a, b) => (Date.parse(b.DateCreated) || 0) - (Date.parse(a.DateCreated) || 0));
            session.result = {
                latest,
                resume: results.at(-1).value || [],
                resumeUnavailable: results.at(-1).status === 'rejected',
                failed: results.some(result => result.status === 'rejected')
            };
            session.loadedAt = Date.now();
            return session.result;
        });
        return session.rows;
    }

    function watchRow(view, title, items, progress = false) {
        const { client } = view.session;
        const shelf = makeShelf({ title, noun: title.toLowerCase().replaceAll(' ', '-'), icon: progress ? 'play_arrow' : 'layers' });
        shelf.section.classList.add('jfc-watch-row');
        shelf.section.classList.toggle('jfc-watch-resume-shelf', progress);
        shelf.track.classList.toggle('jfc-watch-resume', progress);
        for (const item of items) {
            const href = watchDetails(item, client);
            if (!href) continue;
            const card = make('a', 'jfc-watch-card');
            card.href = href;
            const art = make('span', 'jfc-watch-art');
            art.append(icon('play_arrow'));
            const image = watchArtwork(client, item, progress);
            if (image) art.append(image);
            const percentage = Math.min(100, Math.max(0, Number(item.UserData?.PlayedPercentage) || 0));
            if (progress && percentage) {
                const indicator = make('progress', 'jfc-watch-progress');
                indicator.max = 100;
                indicator.value = percentage;
                indicator.setAttribute('aria-label', 'Playback progress');
                art.append(indicator);
            }
            const name = make('strong', '', item.SeriesName && item.Type === 'Episode' ? item.SeriesName : item.Name);
            const note = item.Type === 'Episode' ? item.Name : [item.ProductionYear, item.Type === 'Movie' ? 'Movie' : 'Series'].filter(Boolean).join(' · ');
            card.append(art, name, make('span', 'jfc-watch-meta', note));
            if (!progress || !['Movie', 'Episode'].includes(item.Type)) {
                shelf.track.append(card);
                continue;
            }
            const tile = make('article', 'jfc-watch-resume-tile');
            const actions = make('div', 'jfc-watch-card-actions');
            const resume = musicButton('button', 'Resume', 'play_arrow');
            resume.type = 'button';
            resume.setAttribute('aria-label', 'Resume ' + (name.textContent || 'video'));
            resume.addEventListener('click', () => {
                const native = view.page.querySelector(':scope > .padded-bottom-page .itemsContainer');
                if (native && watchView === view) {
                    const trigger = make('button', 'itemAction');
                    trigger.hidden = true;
                    Object.assign(trigger.dataset, {
                        action: 'resume', id: item.Id, serverid: item.ServerId || client.serverId(),
                        type: item.Type, mediatype: 'Video', positionticks: item.UserData?.PlaybackPositionTicks || 0
                    });
                    native.append(trigger);
                    try {
                        if (!trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))) return;
                    } finally {
                        trigger.remove();
                    }
                }
                location.hash = href;
            });
            const info = make('a', '', 'Details');
            info.href = href;
            actions.append(resume, info);
            tile.append(card, actions);
            shelf.track.append(tile);
        }
        if (!shelf.track.childElementCount) return;
        shelf.body.append(shelf.track);
        (progress ? view.resume : view.recent).append(shelf.section);
        shelf.updateArrows();
        view.arrows.push(shelf.updateArrows);
        return true;
    }

    function renderWatch(view, data) {
        const { session, filter, chrome, spotlight, discovery, resume, recent } = view;
        view.data = data;
        view.arrows = [];
        discovery.dataset.jellynextDiscovery = filter === 'tvshows' ? 'shows' : filter;
        resume.replaceChildren();
        recent.replaceChildren();
        const matches = item => filter === 'all' || (filter === 'movies' ? item.Type === 'Movie' : item.Type !== 'Movie');
        const latest = data?.latest.filter(matches) || [];
        const featured = latest.find(item => item.BackdropImageTags?.length && watchDetails(item, session.client)) || latest[0];
        const hero = make('header', 'jfc-watch-feature');
        const art = watchArtwork(session.client, featured, true);
        if (art) hero.append(art);
        const copy = make('div', 'jfc-watch-feature-copy');
        copy.append(make('p', 'jfc-watch-kicker', featured ? 'FEATURED ' + (featured.Type === 'Movie' ? 'MOVIE' : 'SERIES') : 'CINEMATIC'));
        copy.append(make('h1', '', featured?.Name || 'Movies & Shows'));
        if (featured) {
            copy.append(make('p', 'jfc-watch-meta', [featured.ProductionYear, featured.OfficialRating, ...((featured.Genres || []).slice(0, 2))].filter(Boolean).join(' · ')));
            if (featured.Overview) copy.append(make('p', 'jfc-watch-overview', featured.Overview));
            const href = watchDetails(featured, session.client);
            if (href) {
                const details = make('a', 'jfc-watch-details', 'View details');
                details.href = href;
                copy.append(details);
            }
        }
        hero.append(copy);
        const controls = make('nav', 'jfc-watch-filters');
        controls.setAttribute('aria-label', 'Movies and shows filters');
        for (const [type, label] of [['movies', 'Movies'], ['tvshows', 'Shows']]) {
            if (!session.libraries.some(library => library.CollectionType === type)) continue;
            const link = watchLink(session, label, type);
            if (filter === type) link.setAttribute('aria-current', 'page');
            controls.append(link);
        }
        if (filter !== 'all') controls.append(watchLink(session, 'Clear filter', 'all', 'jfc-watch-clear'));
        chrome.replaceChildren(controls);
        spotlight.replaceChildren(hero);
        if (!watchRow(view, 'Continue Watching', data?.resume || [], true)) {
            const section = make('section', 'jfc-watch-row jfc-watch-resume-shelf');
            const heading = make('h2', 'jfc-music-shelf-title');
            heading.append(icon('play_arrow'), make('span', '', 'Continue Watching'));
            const status = make('p', 'jfc-watch-meta', data?.resumeUnavailable
                ? 'Watch progress could not be loaded.'
                : data ? 'Movies and episodes you start will appear here.' : 'Loading your watch progress…');
            status.setAttribute('role', 'status');
            section.append(heading, status);
            resume.append(section);
        }
        if (!data) {
            const status = make('p', 'jfc-watch-status', 'Loading your library…');
            status.setAttribute('role', 'status');
            recent.append(status);
            return;
        }
        watchRow(view, 'Recently Added Movies', latest.filter(item => item.Type === 'Movie').slice(0, 20));
        watchRow(view, 'Recently Added Shows', latest.filter(item => item.Type === 'Series').slice(0, 20));
        if (data.failed || (!latest.length && !data.resume.length)) {
            const status = make('p', 'jfc-watch-status', data.failed ? 'Some titles could not be loaded.' : 'No titles have been added to this view yet.');
            if (data.failed) {
                const retry = make('button', 'jfc-watch-details', 'Retry');
                retry.type = 'button';
                retry.addEventListener('click', () => {
                    renderWatch(view);
                    loadWatchRows(session).then(data => {
                        if (watchView === view) renderWatch(view, data);
                    });
                });
                status.append(' ', retry);
            }
            recent.append(status);
        }
    }

    function clearWatchPage() {
        if (!watchView) return;
        watchView.stopDiscovery();
        watchView.page.classList.remove('jfc-watch-active');
        watchView.panel.remove();
        watchView = null;
    }

    function observeWatchDiscovery(page) {
        const tracks = new Map();
        const flagged = new Map();
        const resize = new ResizeObserver(entries => {
            entries.forEach(({ target }) => tracks.get(target)?.update());
        });

        function update() {
            for (const [track, record] of tracks) {
                if (page.contains(track)) continue;
                resize.unobserve(track);
                record.dispose();
                record.controls.remove();
                tracks.delete(track);
            }
            for (const [section, notice] of flagged) {
                const status = section.querySelector('.jellynext-catalog-status');
                if (page.contains(section) && /^Popular movies\b/i.test(status?.textContent.trim())) continue;
                section.classList.remove('jfc-watch-old-movie-catalog');
                notice.remove();
                flagged.delete(section);
            }
            for (const section of page.querySelectorAll('.jellynext-discovery[data-jellynext-type="movies"]')) {
                const status = section.querySelector('.jellynext-catalog-status');
                if (flagged.has(section) || section.querySelector('.jellynext-genre-results') ||
                    !/^Popular movies\b/i.test(status?.textContent.trim())) continue;
                const notice = make('p', 'jfc-watch-catalog-notice', 'This Movie Discovery feed uses the older catalog. ');
                const setup = make('a', '', 'Install JellyNext 1.10.1.0 and set up the IMDb catalog');
                setup.href = 'https://github.com/Kaevorr/Jellyfin-Styleing/blob/main/INSTALL.md#optional-jellynext-discovery';
                notice.append(setup, '.');
                section.classList.add('jfc-watch-old-movie-catalog');
                status.after(notice);
                flagged.set(section, notice);
            }

            for (const track of page.querySelectorAll('.jellynext-discovery .jellynext-cards:not(.jellynext-catalog-grid)')) {
                if (tracks.has(track)) {
                    tracks.get(track).update();
                    continue;
                }
                const section = track.closest('.jellynext-genre, .jellynext-discovery');
                const label = section.querySelector('.jellynext-genre-title, .jellynext-heading')?.textContent || 'titles';
                const { controls, updateArrows, dispose } = makeShelfArrows(track, label);
                controls.classList.add('jfc-watch-jellynext-arrows');
                track.classList.add('jfc-watch-arrow-track');
                track.before(controls);
                const record = {
                    controls, dispose,
                    update() {
                        updateArrows();
                        controls.hidden = track.scrollWidth - track.clientWidth < 2 ||
                            !track.getClientRects().length || getComputedStyle(track).overflowX === 'clip';
                    }
                };
                tracks.set(track, record);
                resize.observe(track);
                record.update();
            }
        }

        const observer = new MutationObserver(update);
        observer.observe(page, { childList: true, subtree: true, characterData: true });
        update();
        return () => {
            observer.disconnect();
            resize.disconnect();
            for (const [track, record] of tracks) {
                track.classList.remove('jfc-watch-arrow-track');
                record.dispose();
                record.controls.remove();
            }
            for (const [section, notice] of flagged) {
                section.classList.remove('jfc-watch-old-movie-catalog');
                notice.remove();
            }
        };
    }

    function updateWatch(enabled, header, sections, route) {
        const client = window.ApiClient;
        const userId = enabled && header && client?.getCurrentUserId?.();
        if (watchSession && (watchSession.client !== client || watchSession.userId !== userId)) {
            clearWatchPage();
            document.querySelectorAll('[data-jfc-watch-entry]').forEach(entry => entry.remove());
            watchSession = null;
        }
        if (!userId) return;
        if (!watchSession) watchSession = loadWatchLibraries(client, userId);
        const session = watchSession;
        if (!session.libraries?.length) return;

        const desktopEntry = header.querySelector(watchNativeLinks) || header.querySelector('a[href="#/home?tab=1"]');
        if (desktopEntry) watchEntry(session, desktopEntry);
        const drawerEntry = document.querySelector('.MuiDrawer-root ' + watchNativeLinks);
        if (drawerEntry) watchEntry(session, drawerEntry);
        const homeTile = sections?.querySelector('.card:is([data-jfc-kind="movies"], [data-jfc-kind="tvshows"])');
        if (homeTile) watchEntry(session, homeTile, true);

        const params = new URLSearchParams(location.hash.split('?')[1]);
        const page = params.get('jfc') === 'watch' && (route === '#/movies' || route === '#/tv') &&
            document.querySelector(route === '#/movies' ? '#moviesPage' : '#tvshowsPage');
        if (!page) {
            if (route === '#/video' && watchView) session.loadedAt = Date.now() - 60001;
            return clearWatchPage();
        }
        const requested = params.get('filter');
        const filter = session.libraries.some(library => library.CollectionType === requested) ? requested : 'all';
        if (watchView?.page === page && watchView.panel.isConnected) {
            if (watchView.filter !== filter) {
                watchView.filter = filter;
                renderWatch(watchView, watchView.data);
                const filters = watchView.chrome.querySelector('.jfc-watch-filters');
                (filters?.querySelector('a[aria-current]') || filters?.querySelector('a'))?.focus({ preventScroll: true });
            } else {
                watchView.arrows.forEach(update => update());
            }
            return;
        }
        const entering = !watchView;
        clearWatchPage();
        const panel = make('section', 'jfc-watch');
        const chrome = make('div', 'jfc-watch-chrome');
        const resume = make('div', 'jfc-watch-resume-slot');
        const spotlight = make('div');
        const discovery = make('div');
        const recent = make('div');
        panel.append(chrome, spotlight, resume, discovery, recent);
        const view = { session, page, panel, chrome, resume, spotlight, discovery, recent, filter, arrows: [],
            stopDiscovery: observeWatchDiscovery(page) };
        watchView = view;
        page.classList.add('jfc-watch-active');
        page.prepend(panel);
        renderWatch(view, session.result);
        const expired = entering && session.loadedAt && Date.now() - session.loadedAt > 60000;
        const result = !session.rows || expired ? loadWatchRows(session) : session.rows;
        result.then(data => {
            if (data === view.data) return;
            if (watchView === view && location.hash.includes('jfc=watch')) renderWatch(view, data);
        });
    }

    let videoDetail;
    function updateVideoDetail(enabled, route) {
        const page = enabled && route === '#/details' && document.querySelector('#itemDetailPage:not(.hide)');
        const client = window.ApiClient;
        const user = client?.getCurrentUserId?.();
        const hash = location.hash;
        if (videoDetail?.page === page && videoDetail.hash === hash && videoDetail.client === client && videoDetail.user === user) return;
        videoDetail?.page?.classList.remove('jfc-video-detail');
        videoDetail = null;
        const id = new URLSearchParams(hash.split('?')[1]).get('id');
        if (!page || !id || !user || !client.getItem) return;
        const current = { page, hash, client, user };
        videoDetail = current;
        withRequestTimeout(() => client.getItem(user, id)).then(item => {
            if (videoDetail !== current || location.hash !== hash || window.ApiClient !== client || client.getCurrentUserId() !== user) return;
            page.classList.toggle('jfc-video-detail', ['Movie', 'Series', 'Season', 'Episode'].includes(item.Type));
        }).catch(() => {});
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
        updateTrackActions(cssReady && desktopOrMobile ? playlistTrackScope() : null);
        const homeActive = cssReady && sections && tab.classList.contains('is-active') &&
            getComputedStyle(tab).getPropertyValue('--jfc-hero-height').trim();
        if (homeActive) {
            const libraries = getLibraries(sections);
            const shortcuts = getPrimaryShortcuts(libraries);
            setHero(tab, sections);
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
        updateVideoDetail(cssReady && desktopOrMobile, route);
        updateWatch(cssReady && desktopOrMobile, modernHeader, homeActive ? sections : null, route);

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
        if (watchView) modules.push('Movies & Shows dashboard');
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
        const selector = '[data-role="page"], .MuiAppBar-root, .skinHeader, .MuiDrawer-root, style, #library-view-menu, a[href="#/home?tab=1"]';
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
