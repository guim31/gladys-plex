// -----------------------------------------------------------------------------
// The Gladys 5.3 music player: the features of a player, its "now playing"
// published through publishNowPlaying, the writable music features, and the
// music panel (browse, search, play, queue, artwork) — against the fake
// Gladys of the SDK, the Plex server replaced by an in-memory library shaped
// like the answers of Plex Media Server 1.43.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateMediaItems, MUSIC_PLAYBACK_STATE } from '@gladysassistant/integration-sdk';
import { PlexMonitor } from '../src/monitor.js';
import { normalizeConfig } from '../src/config.js';
import { normalizeSession } from '../src/plex/sessions.js';
import { registerMusicHandlers } from '../src/music.js';
import { buildPlayerDevice, nowPlayingOf, playerExternalIds } from '../src/devices/player.js';
import { parseMediaId, FOLDER } from '../src/catalog.js';
import { createFakeApi } from './helpers/fakePlexApi.js';
import { SESSIONS } from './fixtures/plex.js';

const CONFIG = normalizeConfig({
  plex_url: 'http://192.0.2.10:32400',
  plex_token: 'secret-token',
  language: 'fr',
});

const ALBUM = {
  ratingKey: '14',
  type: 'album',
  title: 'Blue Morning',
  parentTitle: 'Test Quartet',
  thumb: '/library/metadata/14/thumb/1792967929',
};
const track = (ratingKey, title, extra = {}) => ({
  ratingKey,
  key: `/library/metadata/${ratingKey}`,
  type: 'track',
  title,
  grandparentTitle: 'Test Quartet',
  parentTitle: 'Blue Morning',
  parentThumb: ALBUM.thumb,
  thumb: ALBUM.thumb,
  duration: 28_029,
  ...extra,
});
const TRACKS = [track('15', 'Track 1'), track('16', 'Track 2'), track('17', 'Track 3')];
const ARTIST = { ratingKey: '8', type: 'artist', title: 'Test Quartet' };
const PLAYLIST = {
  ratingKey: '21',
  type: 'playlist',
  playlistType: 'audio',
  title: 'Evening',
  composite: '/playlists/21/composite/1',
};
const VIDEO_PLAYLIST = { ratingKey: '30', type: 'playlist', playlistType: 'video', title: 'Films' };
const LIBRARY = Object.fromEntries(
  [ALBUM, ARTIST, PLAYLIST, VIDEO_PLAYLIST, ...TRACKS].map((i) => [i.ratingKey, i]),
);

/** The fake API of the monitor tests, with the music library on top. */
function createMusicApi(options) {
  const queue = { id: '4', items: [], current: 0 };
  const queueItem = (item, i) => ({ ...item, playQueueItemID: 100 + i });
  const api = Object.assign(createFakeApi(options), {
    baseUrl: CONFIG.plex_url,
    token: CONFIG.plex_token,
    calls: [],
    queue,
    transientToken: 'transient-1',
    imageSizes: [],
    imageBytes: () => Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    async page(path, params, { offset, limit }) {
      this.calls.push({ path, params, offset, limit });
      const all =
        path === '/playlists'
          ? [PLAYLIST]
          : path.endsWith('/all')
            ? params.type === 8
              ? [ARTIST]
              : [ALBUM]
            : path === '/library/metadata/14/children'
              ? TRACKS
              : path === '/library/metadata/8/children'
                ? [ALBUM]
                : path === '/playlists/21/items'
                  ? [TRACKS[2]]
                  : [];
      return { items: all.slice(offset, offset + limit), total: all.length };
    },
    async getMetadata(ratingKey) {
      return LIBRARY[ratingKey] ?? null;
    },
    async searchHubs(query, limit) {
      this.calls.push({ path: '/hubs/search', query, limit });
      return [
        { type: 'artist', items: [ARTIST] },
        { type: 'album', items: [ALBUM] },
        { type: 'movie', items: [{ ratingKey: '99', type: 'movie', title: 'Blue' }] },
        { type: 'track', items: TRACKS },
        { type: 'playlist', items: [VIDEO_PLAYLIST, PLAYLIST] },
      ];
    },
    async createPlayQueue(source) {
      this.calls.push({ path: 'POST /playQueues', source });
      const items = source.playlistID ? [TRACKS[2]] : TRACKS;
      queue.items = items.map(queueItem);
      queue.current = 0;
      return {
        playQueueID: Number(queue.id),
        playQueueSelectedItemID: queue.items[0].playQueueItemID,
        Metadata: queue.items,
      };
    },
    async addToPlayQueue(id, source, next) {
      this.calls.push({ path: 'PUT /playQueues', id, source, next });
      return {};
    },
    async getPlayQueue(id, { offset, limit }) {
      this.calls.push({ path: 'GET /playQueues', id, offset, limit });
      return {
        items: queue.items.slice(offset, offset + limit),
        total: queue.items.length,
        currentIndex: queue.current,
      };
    },
    async getTransientToken() {
      return this.transientToken;
    },
    async getImage(path, width, height, format) {
      this.imageSizes.push({ path, width, height, format });
      return this.imageBytes(width);
    },
  });
  return api;
}

async function start({ sessions } = {}) {
  const gladys = createFakeGladys({ config: {} });
  const monitor = new PlexMonitor(gladys, CONFIG);
  monitor.api = createMusicApi(sessions ? { sessions } : undefined);
  registerMusicHandlers(gladys, () => monitor);
  await gladys.connect();
  await monitor.init();
  const tv = { external_id: playerExternalIds(gladys, 'client-tv').device };
  const phone = { external_id: playerExternalIds(gladys, 'client-phone').device };
  return { gladys, fake: gladys.fake, monitor, api: monitor.api, tv, phone };
}

const assertValid = (items) => assert.deepEqual(validateMediaItems(items), []);

// --- Device model ------------------------------------------------------------------

test('player device: the music features of Gladys 5.3, old ids kept', () => {
  const gladys = createFakeGladys();
  const device = buildPlayerDevice(gladys, { machineIdentifier: 'tv', name: 'TV', product: '' });
  const byKey = Object.fromEntries(
    device.features.map((f) => [f.external_id.slice(device.external_id.length + 1), f]),
  );
  // Converted in place by "Update": same ids as 1.2.
  assert.deepEqual(
    [byKey['playback-state'].category, byKey['playback-state'].type, byKey['playback-state'].max],
    ['music', 'playback_state', 2],
  );
  assert.equal(byKey['playback-state'].read_only, false);
  assert.equal(byKey['playback-state'].has_feedback, true);
  assert.deepEqual(
    [byKey.mute.category, byKey.mute.type, byKey.mute.has_feedback],
    ['music', 'mute', true],
  );
  assert.equal(byKey.volume.has_feedback, true);
  // New: `${device}:${type}`.
  for (const type of ['title', 'artist', 'album', 'artwork']) {
    assert.deepEqual(
      [byKey[type].type, byKey[type].min, byKey[type].max, byKey[type].read_only],
      [type, 0, 0, true],
    );
  }
  assert.deepEqual([byKey.duration.unit, byKey.duration.read_only], ['seconds', true]);
  assert.deepEqual(
    [byKey.position.unit, byKey.position.read_only, byKey.position.has_feedback],
    ['seconds', false, true],
  );
  // Plex does not report them: not published.
  assert.equal(byKey.shuffle, undefined);
  assert.equal(byKey.repeat, undefined);
  // Pre-5.3 features stay (scenes, dashboards).
  for (const key of [
    'play',
    'pause',
    'stop',
    'next',
    'previous',
    'now-playing',
    'remaining',
    'intro',
  ]) {
    assert.ok(byKey[key], key);
  }
});

test('nowPlayingOf: track, episode, movie, live, buffering, nothing', () => {
  const url = (path) => `http://plex${path}`;
  const raw = SESSIONS.MediaContainer.Metadata;
  const episode = normalizeSession({
    ...raw[0],
    parentTitle: 'Season 1',
    grandparentThumb: '/library/metadata/1/thumb/5',
    thumb: '/library/metadata/4242/thumb/9',
  });
  assert.deepEqual(nowPlayingOf(episode, url), {
    playback_state: MUSIC_PLAYBACK_STATE.PLAYING,
    title: 'Winter Is Coming',
    artist: 'Game of Thrones',
    album: 'Season 1',
    artwork_url: 'http://plex/library/metadata/1/thumb/5',
    duration: 3600,
    position: 65,
  });
  const compilation = normalizeSession({
    ...raw[1],
    originalTitle: 'Pharrell Williams',
    parentThumb: '/library/metadata/70/thumb/1',
  });
  const snapshot = nowPlayingOf(compilation, url);
  assert.equal(snapshot.playback_state, MUSIC_PLAYBACK_STATE.PAUSED);
  assert.equal(snapshot.artist, 'Pharrell Williams', 'the track artist first');
  assert.equal(snapshot.album, 'Random Access Memories');
  assert.equal(snapshot.artwork_url, 'http://plex/library/metadata/70/thumb/1');
  const movie = normalizeSession({ ...raw[0], type: 'movie', title: 'Heat', live: undefined });
  assert.deepEqual([nowPlayingOf(movie, url).artist, nowPlayingOf(movie, url).album], ['', '']);
  const live = normalizeSession({ ...raw[0], type: 'clip', live: 1 });
  assert.equal(nowPlayingOf(live, url).duration, 0, 'live: the widget shows "Live"');
  const buffering = normalizeSession({
    ...raw[0],
    Player: { ...raw[0].Player, state: 'buffering' },
  });
  assert.equal(nowPlayingOf(buffering, url).playback_state, MUSIC_PLAYBACK_STATE.BUFFERING);
  assert.deepEqual(nowPlayingOf(null, url), {
    playback_state: MUSIC_PLAYBACK_STATE.IDLE,
    title: '',
    artist: '',
    album: '',
    artwork_url: null,
    duration: 0,
    position: 0,
  });
});

// --- Now playing ---------------------------------------------------------------------

test('now playing goes through publishNowPlaying, under the old playback-state id', async (t) => {
  const sessions = structuredClone(SESSIONS);
  sessions.MediaContainer.Metadata[1].parentThumb = '/library/metadata/70/thumb/1';
  const { fake, monitor, tv, phone } = await start({ sessions });
  t.after(() => monitor.stop());
  await monitor.refreshSessions();
  const last = (device, key) => fake.lastState(`${device.external_id}:${key}`);
  assert.equal(last(tv, 'playback-state'), 1);
  assert.equal(last(tv, 'playback_state'), undefined, 'never the default id');
  assert.equal(last(tv, 'title'), 'Winter Is Coming');
  assert.equal(last(tv, 'position'), 65);
  assert.equal(last(phone, 'playback-state'), 0);
  assert.equal(last(phone, 'artist'), 'Daft Punk');
  assert.match(String(last(phone, 'artwork')), /^art-[0-9a-f]{12}$/);
  assert.equal(last(tv, 'artwork'), '', 'no image: an empty artwork');
  // The old text feature is still fed (scenes, dashboards).
  assert.equal(last(tv, 'now-playing'), 'Game of Thrones S01E01 - Winter Is Coming');
});

test('a position the server repeats while playing is not republished', async (t) => {
  const { gladys, monitor, tv } = await start();
  t.after(() => monitor.stop());
  const calls = [];
  const publish = gladys.publishNowPlaying.bind(gladys);
  gladys.publishNowPlaying = async (id, values, options) => {
    if (id === tv.external_id) calls.push(values);
    return publish(id, values, options);
  };
  await monitor.refreshSessions();
  await monitor.refreshSessions();
  assert.equal(calls[0].position, 65);
  assert.equal('position' in calls[1], false, 'the same sample is stale');
  // A new sample from the player goes again.
  monitor.api.sessions = structuredClone(SESSIONS);
  monitor.api.sessions.MediaContainer.Metadata[0].viewOffset = 75_000;
  await monitor.refreshSessions();
  assert.equal(calls[2].position, 75);
  // A device created or updated in Gladys gets everything again.
  monitor.resetPublicationCache(tv.external_id);
  await monitor.refreshSessions();
  assert.equal(calls[3].position, 75);
});

test('a player of Gladys the server does not list is published idle at start', async (t) => {
  const { gladys, monitor } = await start();
  t.after(() => monitor.stop());
  const published = [];
  const gone = playerExternalIds(gladys, 'old-phone').device;
  gladys.getDevices = async () => [
    { external_id: gone },
    { external_id: playerExternalIds(gladys, 'client-tv').device },
  ];
  gladys.publishNowPlaying = async (id, values) => published.push([id, values]);
  await monitor.publishAbsentPlayersIdle();
  assert.deepEqual(published, [[gone, nowPlayingOf(null, () => null)]]);
});

// --- Writable features ----------------------------------------------------------------

test('playback_state 0/1/2, position (seek), refusals', async (t) => {
  const { monitor, api, tv } = await start();
  t.after(() => monitor.stop());
  await monitor.refreshSessions();
  const set = (key, value) =>
    monitor.handleSetValue(tv, { external_id: `${tv.external_id}:${key}` }, value);

  await set('playback-state', 0);
  await set('playback-state', 1);
  await set('playback-state', 2);
  assert.deepEqual(
    api.commands.map((c) => c.path),
    ['/player/playback/pause', '/player/playback/play', '/player/playback/stop'],
  );
  await assert.rejects(set('playback-state', 3), /Valeur non prise en charge/);

  await set('position', 120.4);
  assert.deepEqual(api.commands.at(-1), {
    machineIdentifier: 'client-tv',
    path: '/player/playback/seekTo',
    params: { type: 'video', offset: 120_400 },
  });
  await set('position', 99_999);
  assert.equal(api.commands.at(-1).params.offset, 3_600_000, 'clamped to the duration');
  await assert.rejects(set('position', -1), /Valeur non prise en charge/);

  // Nothing loaded: play, pause and seek are refused, stop is a no-op.
  monitor.api.sessions = { MediaContainer: {} };
  await monitor.refreshSessions();
  const before = api.commands.length;
  await assert.rejects(set('playback-state', 1), /Rien n'est en cours de lecture sur TV Salon/);
  await assert.rejects(set('position', 10), /Rien n'est en cours de lecture/);
  await set('playback-state', 2);
  assert.equal(api.commands.length, before);
});

test('a live stream cannot be sought', async (t) => {
  const sessions = structuredClone(SESSIONS);
  sessions.MediaContainer.Metadata[0].live = 1;
  const { monitor, tv } = await start({ sessions });
  t.after(() => monitor.stop());
  await monitor.refreshSessions();
  await assert.rejects(
    monitor.handleSetValue(tv, { external_id: `${tv.external_id}:position` }, 10),
    /ne peut pas se déplacer dans un direct/,
  );
});

// --- Catalog -------------------------------------------------------------------------------

test('browse: root folders of one music library, then artists, albums, tracks, playlists', async (t) => {
  const { fake, monitor, api, tv } = await start();
  t.after(() => monitor.stop());
  const root = await fake.musicBrowse(tv, { parentId: null });
  assert.deepEqual(
    root.data.items.map((i) => [i.id, i.title, i.type, i.browsable, i.playable]),
    [
      [`${FOLDER.artists}3`, 'Artistes', 'folder', true, false],
      [`${FOLDER.albums}3`, 'Albums', 'folder', true, false],
      [FOLDER.playlists, 'Playlists', 'folder', true, false],
    ],
  );
  assertValid(root.data.items);

  const artists = await fake.musicBrowse(tv, {
    parentId: `${FOLDER.artists}3`,
    offset: 0,
    limit: 10,
  });
  assert.deepEqual(artists.data, {
    items: [
      {
        id: 'artist:8',
        type: 'artist',
        title: 'Test Quartet',
        subtitle: null,
        duration: null,
        artwork_key: null,
        browsable: true,
        playable: true,
      },
    ],
    total: 1,
  });
  assert.deepEqual(api.calls.at(-1), {
    path: '/library/sections/3/all',
    params: { type: 8, sort: 'titleSort' },
    offset: 0,
    limit: 10,
  });

  const tracks = await fake.musicBrowse(tv, { parentId: 'album:14', offset: 1, limit: 1 });
  assert.equal(tracks.data.total, 3);
  assert.deepEqual(
    [tracks.data.items[0].id, tracks.data.items[0].subtitle, tracks.data.items[0].duration],
    ['track:16', 'Test Quartet', 28],
  );
  assert.match(tracks.data.items[0].artwork_key, /^art-/);
  assertValid(tracks.data.items);

  const playlist = await fake.musicBrowse(tv, { parentId: 'playlist:21' });
  assert.deepEqual(
    playlist.data.items.map((i) => i.id),
    ['track:17'],
  );

  const notBrowsable = await fake.musicBrowse(tv, { parentId: 'track:15' });
  assert.match(notBrowsable.error, /ne peut pas être ouvert/);
  const gone = await fake.musicBrowse(tv, { parentId: 'album:999' });
  assert.match(gone.error, /n'est plus dans la bibliothèque/);
  const server = await fake.musicBrowse(
    { external_id: 'ext:test-integration:server:srv-abc123' },
    {},
  );
  assert.match(server.error, /n'est pas un lecteur Plex/);
});

test('browse: one folder per music library when there are several', async (t) => {
  const { fake, monitor, tv } = await start();
  t.after(() => monitor.stop());
  monitor.libraries.push({ key: '9', title: 'Concerts', type: 'artist' });
  const root = await fake.musicBrowse(tv, {});
  assert.deepEqual(
    root.data.items.map((i) => [i.id, i.title]),
    [
      [`${FOLDER.section}3`, 'Musique'],
      [`${FOLDER.section}9`, 'Concerts'],
      [FOLDER.playlists, 'Playlists'],
    ],
  );
  const inside = await fake.musicBrowse(tv, { parentId: `${FOLDER.section}9` });
  assert.deepEqual(
    inside.data.items.map((i) => i.id),
    [`${FOLDER.artists}9`, `${FOLDER.albums}9`],
  );
  const removed = await fake.musicBrowse(tv, { parentId: `${FOLDER.albums}5` });
  assert.match(removed.error, /n'est plus dans la bibliothèque/);
});

test('search: music hubs only, video playlists left out, type filter, limit', async (t) => {
  const { fake, monitor, tv } = await start();
  t.after(() => monitor.stop());
  const all = await fake.musicSearch(tv, { query: 'blue', limit: 20 });
  assert.deepEqual(
    all.data.items.map((i) => i.id),
    ['artist:8', 'album:14', 'track:15', 'track:16', 'track:17', 'playlist:21'],
  );
  assertValid(all.data.items);
  const albums = await fake.musicSearch(tv, { query: 'blue', type: 'album' });
  assert.deepEqual(
    albums.data.items.map((i) => i.id),
    ['album:14'],
  );
  const few = await fake.musicSearch(tv, { query: 'blue', limit: 2 });
  assert.equal(few.data.items.length, 2);
});

test('play (replace): a server play queue handed over by playMedia', async (t) => {
  const { fake, monitor, api, tv } = await start();
  t.after(() => monitor.stop());
  const ack = await fake.musicPlay(tv, { id: 'album:14', type: 'album' }, 'replace');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(api.calls.at(-1), {
    path: 'POST /playQueues',
    source: { uri: 'server://srv-abc123/com.plexapp.plugins.library/library/metadata/14' },
  });
  assert.deepEqual(api.commands.at(-1), {
    machineIdentifier: 'client-tv',
    path: '/player/playback/playMedia',
    params: {
      providerIdentifier: 'com.plexapp.plugins.library',
      machineIdentifier: 'srv-abc123',
      protocol: 'http',
      address: '192.0.2.10',
      port: '32400',
      offset: 0,
      key: '/library/metadata/15',
      token: 'transient-1',
      containerKey: '/playQueues/4?window=100&own=1',
      type: 'music',
    },
  });
  // A playlist is queued by its id; no transient token: the configured one.
  api.transientToken = null;
  await fake.musicPlay(tv, { id: 'playlist:21', type: 'playlist' });
  assert.deepEqual(api.calls.at(-1).source, { playlistID: '21' });
  assert.equal(api.commands.at(-1).params.token, 'secret-token');

  for (const [media, error] of [
    [{ id: 'album:999', type: 'album' }, /n'est plus dans la bibliothèque/],
    [{ id: 'artist:14', type: 'artist' }, /n'est plus dans la bibliothèque/],
    [{ id: 'playlist:30', type: 'playlist' }, /ne peut pas être lu/],
    [{ id: 'gladys:playlists', type: 'folder' }, /ne peut pas être lu/],
  ]) {
    assert.match((await fake.musicPlay(tv, media)).error, error, media.id);
  }
});

test('play next / at the end: the current server queue, then refreshPlayQueue', async (t) => {
  const { fake, monitor, api, tv, phone } = await start();
  t.after(() => monitor.stop());
  await monitor.refreshSessions();

  // The phone plays music, its queue not known yet: never replaced.
  const before = api.commands.length;
  const unknown = await fake.musicPlay(phone, { id: 'track:17', type: 'track' }, 'next');
  assert.match(unknown.error, /La file d'attente de Pixel 9 n'est pas encore connue/);
  assert.equal(api.commands.length, before, 'nothing sent to the player');

  monitor.notePlayQueues([
    { clientIdentifier: 'client-phone', playQueueID: 4, playQueueItemID: 101, state: 'paused' },
  ]);
  assert.equal(
    (await fake.musicPlay(phone, { id: 'track:17', type: 'track' }, 'next')).success,
    true,
  );
  assert.deepEqual(api.calls.at(-1), {
    path: 'PUT /playQueues',
    id: '4',
    source: { uri: 'server://srv-abc123/com.plexapp.plugins.library/library/metadata/17' },
    next: true,
  });
  assert.deepEqual(api.commands.at(-1).path, '/player/playback/refreshPlayQueue');
  assert.deepEqual(api.commands.at(-1).params, { playQueueID: '4', type: 'music' });

  await fake.musicPlay(phone, { id: 'playlist:21', type: 'playlist' }, 'append');
  assert.deepEqual(api.calls.at(-1).source, { playlistID: '21' });
  assert.equal(api.calls.at(-1).next, false);

  // The TV plays an episode: no music queue to add to.
  const video = await fake.musicPlay(tv, { id: 'album:14', type: 'album' }, 'append');
  assert.match(video.error, /TV Salon ne lit pas de musique/);

  // Nothing loaded: the media is simply played.
  monitor.activeSessions.delete('client-tv');
  assert.equal(
    (await fake.musicPlay(tv, { id: 'album:14', type: 'album' }, 'append')).success,
    true,
  );
  assert.equal(api.commands.at(-1).path, '/player/playback/playMedia');
});

test('volume and mute accepted by the player stay a success when Gladys refuses the state', async (t) => {
  const { gladys, monitor, api, tv } = await start();
  t.after(() => monitor.stop());
  gladys.publishNowPlaying = async () => {
    throw new Error('HTTP 429');
  };
  await monitor.handleSetValue(tv, { external_id: `${tv.external_id}:volume` }, 40);
  await monitor.handleSetValue(tv, { external_id: `${tv.external_id}:mute`, category: 'music' }, 1);
  assert.deepEqual(
    api.commands.map((c) => c.params),
    [
      { type: 'video', volume: 40 },
      { type: 'video', mute: 1 },
    ],
  );
});

test('a refused now-playing batch is published again with its position', async (t) => {
  const { gladys, monitor, tv } = await start();
  t.after(() => monitor.stop());
  const calls = [];
  let refuse = true;
  gladys.publishNowPlaying = async (id, values) => {
    if (id !== tv.external_id) return;
    calls.push(values);
    if (refuse) throw new Error('HTTP 429');
  };
  await monitor.refreshSessions();
  refuse = false;
  await monitor.refreshSessions();
  assert.equal(calls[1].position, 65, 'the sample was never published: it goes again');
});

test('queue: a page of the server queue, current index, jump with skipTo', async (t) => {
  const { fake, monitor, api, tv, phone } = await start();
  t.after(() => monitor.stop());
  await monitor.refreshSessions();
  assert.deepEqual((await fake.musicQueueGet(tv, {})).data, {
    items: [],
    current_index: null,
    total: 0,
  });

  await fake.musicPlay(tv, { id: 'album:14', type: 'album' });
  monitor.notePlayQueues([
    { clientIdentifier: 'client-tv', playQueueID: '4', playQueueItemID: 101 },
  ]);
  api.queue.current = 1;
  const page = await fake.musicQueueGet(tv, { offset: 1, limit: 2 });
  assert.deepEqual(
    [page.data.items.map((i) => i.id), page.data.current_index, page.data.total],
    [['track:16', 'track:17'], 1, 3],
  );
  assertValid(page.data.items);

  assert.equal((await fake.musicQueuePlay(tv, 2)).success, true);
  assert.deepEqual(api.commands.at(-1), {
    machineIdentifier: 'client-tv',
    path: '/player/playback/skipTo',
    params: { key: '/library/metadata/17', playQueueItemID: 102, type: 'music' },
  });
  assert.match((await fake.musicQueuePlay(tv, 3)).error, /n'est plus dans la file/);
  assert.match(
    (await fake.musicQueuePlay(phone, 0)).error,
    /Rien n'est en cours de lecture sur Pixel 9/,
  );

  // The player stops: its queue is forgotten.
  monitor.notePlayQueues([{ clientIdentifier: 'client-tv', playQueueID: '4', state: 'stopped' }]);
  assert.equal(monitor.playQueueOf('client-tv'), null);
});

test('notePlayQueues ignores entries without a player or a queue', async (t) => {
  const { monitor } = await start();
  t.after(() => monitor.stop());
  await monitor.refreshSessions();
  monitor.notePlayQueues([
    { playQueueID: 4 },
    { clientIdentifier: 'client-tv', playQueueID: 'x' },
    null,
  ]);
  assert.equal(monitor.playQueues.size, 0);
  monitor.notePlayQueues('nope');
  assert.equal(monitor.playQueues.size, 0);
});

test('artwork: JPEG through the transcoder with the token, asked smaller when too big', async (t) => {
  const { fake, monitor, api, tv } = await start();
  t.after(() => monitor.stop());
  const tracks = await fake.musicBrowse(tv, { parentId: 'album:14' });
  const key = tracks.data.items[0].artwork_key;
  const art = await fake.musicGetArtwork(key);
  assert.equal(art.success, true, art.error);
  assert.deepEqual(api.imageSizes.at(-1), {
    path: ALBUM.thumb,
    width: 128,
    height: 128,
    format: 'jpeg',
  });

  api.imageBytes = (width) => Buffer.alloc(width > 70 ? 400 * 1024 : 1000);
  assert.equal((await fake.musicGetArtwork(key)).success, true);
  assert.deepEqual(
    api.imageSizes.slice(-3).map((s) => s.width),
    [128, 90, 63],
  );
  api.imageBytes = () => Buffer.alloc(400 * 1024);
  assert.match((await fake.musicGetArtwork(key)).error, /too large/);
  assert.match((await fake.musicGetArtwork('art-000000000000')).error, /Unknown artwork/);
});

test('parseMediaId accepts our ids only', () => {
  assert.deepEqual(parseMediaId('album:14'), { kind: 'album', ratingKey: '14' });
  for (const id of ['folder:1', 'album:abc', 'album:', 'gladys:playlists', null, 'track:1:2']) {
    assert.equal(parseMediaId(id), null, String(id));
  }
});

test('music handlers answer an error while the server is not connected', async () => {
  const gladys = createFakeGladys({ config: {} });
  registerMusicHandlers(gladys, () => null);
  await gladys.connect();
  const ack = await gladys.fake.musicBrowse({ external_id: 'ext:test-integration:player:x' }, {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /not connected/);
});
