// -----------------------------------------------------------------------------
// PlexApi tests: URL building, headers, error handling — with a mocked fetch.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PlexApi } from '../src/plex/api.js';
import { IDENTITY, SESSIONS, LIBRARIES } from './fixtures/plex.js';

const realFetch = globalThis.fetch;
let calls;

function mockFetch(handler) {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return handler(new URL(url), options);
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const CONFIG = { plex_url: 'http://plex.local:32400', plex_token: 'secret-token' };

test('every request carries the token and the client identity headers', async () => {
  mockFetch(() => jsonResponse(IDENTITY));
  const api = new PlexApi(CONFIG);
  const identity = await api.getIdentity();

  assert.equal(identity.machineIdentifier, 'srv-abc123');
  const { url, options } = calls[0];
  assert.equal(url.origin + url.pathname, 'http://plex.local:32400/identity');
  assert.equal(options.headers['X-Plex-Token'], 'secret-token');
  assert.equal(options.headers.Accept, 'application/json');
  assert.ok(options.headers['X-Plex-Client-Identifier']);
});

test('getSessions returns the metadata entries (empty when nobody streams)', async () => {
  mockFetch(() => jsonResponse(SESSIONS));
  const api = new PlexApi(CONFIG);
  assert.equal((await api.getSessions()).length, 2);

  mockFetch(() => jsonResponse({ MediaContainer: { size: 0 } }));
  assert.deepEqual(await api.getSessions(), []);
});

test('getLibraries normalizes the section keys to strings', async () => {
  mockFetch(() => jsonResponse(LIBRARIES));
  const api = new PlexApi(CONFIG);
  const libraries = await api.getLibraries();
  assert.deepEqual(libraries[0], { key: '1', title: 'Films', type: 'movie' });
});

test('getLibraryCount asks for a 0-sized container and reads totalSize', async () => {
  mockFetch(() => jsonResponse({ MediaContainer: { totalSize: 250 } }));
  const api = new PlexApi(CONFIG);
  const count = await api.getLibraryCount('1', 4);

  assert.equal(count, 250);
  const { url } = calls[0];
  assert.equal(url.pathname, '/library/sections/1/all');
  assert.equal(url.searchParams.get('X-Plex-Container-Size'), '0');
  assert.equal(url.searchParams.get('type'), '4');
});

test('playerCommand targets the player and increments commandID', async () => {
  mockFetch(() => new Response('', { status: 200 }));
  const api = new PlexApi(CONFIG);
  await api.playerCommand('client-tv', '/player/playback/play', { type: 'video' });
  await api.playerCommand('client-tv', '/player/playback/pause', { type: 'video' });

  const first = calls[0];
  assert.equal(first.url.pathname, '/player/playback/play');
  assert.equal(first.url.searchParams.get('commandID'), '1');
  assert.equal(first.options.headers['X-Plex-Target-Client-Identifier'], 'client-tv');
  assert.equal(calls[1].url.searchParams.get('commandID'), '2');
});

test('a player answering its command in XML is a success', async () => {
  // What a companion player answers, whatever the Accept header.
  mockFetch(
    () =>
      new Response('<Response code="200" status="OK"/>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      }),
  );
  const api = new PlexApi(CONFIG);
  await api.playerCommand(
    'client-tv',
    '/player/playback/seekTo',
    { offset: 20_000 },
    {
      origin: 'http://192.0.2.44:32500',
    },
  );
  assert.equal(calls[0].url.origin, 'http://192.0.2.44:32500');
});

test('music library calls: pages, play queues, search, transient token', async () => {
  mockFetch((url, options) => {
    if (url.pathname === '/security/token') {
      return new Response('', { status: 400 });
    }
    if (url.pathname === '/hubs/search') {
      return jsonResponse({
        MediaContainer: {
          Hub: [{ type: 'album', Metadata: [{ ratingKey: '14' }] }, { type: 'track' }],
        },
      });
    }
    if (url.pathname.startsWith('/playQueues') && options.method === 'GET') {
      return jsonResponse({
        MediaContainer: {
          size: 2,
          playQueueTotalCount: 6,
          playQueueSelectedItemOffset: 3,
          Metadata: [{ ratingKey: '17' }, { ratingKey: '18' }],
        },
      });
    }
    if (url.pathname === '/library/metadata/404') {
      return new Response('', { status: 404 });
    }
    return jsonResponse({
      MediaContainer: { size: 1, totalSize: 9, Metadata: [{ ratingKey: '1' }] },
    });
  });
  const api = new PlexApi(CONFIG);
  assert.deepEqual(
    await api.page('/library/sections/3/all', { type: 9 }, { offset: 4, limit: 1 }),
    {
      items: [{ ratingKey: '1' }],
      total: 9,
    },
  );
  assert.equal(calls[0].url.searchParams.get('X-Plex-Container-Start'), '4');
  assert.equal(calls[0].url.searchParams.get('X-Plex-Container-Size'), '1');

  assert.deepEqual(await api.getPlayQueue(4, { offset: 2, limit: 2 }), {
    items: [{ ratingKey: '17' }, { ratingKey: '18' }],
    total: 6,
    currentIndex: 3,
  });
  assert.deepEqual(await api.searchHubs('blue', 5), [
    { type: 'album', items: [{ ratingKey: '14' }] },
    { type: 'track', items: [] },
  ]);
  assert.equal(await api.getMetadata('404'), null);
  assert.equal(await api.getTransientToken(), null, 'an unclaimed server has none');
  assert.equal(calls.at(-1).options.headers['X-Plex-Token'], 'secret-token');

  await api.createPlayQueue({
    uri: 'server://srv/com.plexapp.plugins.library/library/metadata/14',
  });
  const create = calls.at(-1);
  assert.equal(create.options.method, 'POST');
  assert.equal(create.url.searchParams.get('type'), 'audio');
  await api.addToPlayQueue(4, { playlistID: '21' }, true);
  const add = calls.at(-1);
  assert.deepEqual(
    [
      add.options.method,
      add.url.pathname,
      add.url.searchParams.get('playlistID'),
      add.url.searchParams.get('next'),
    ],
    ['PUT', '/playQueues/4', '21', '1'],
  );

  await api.getImage('/library/metadata/9/thumb/1', 400, 400, 'jpeg');
  assert.equal(calls.at(-1).url.searchParams.get('format'), 'jpeg');
  assert.equal(calls.at(-1).options.headers['X-Plex-Token'], 'secret-token', 'token as a header');
  assert.equal(calls.at(-1).url.searchParams.get('X-Plex-Token'), null, 'never in the URL');
});

test('the transient token: only a server without one falls back, other failures throw', async () => {
  mockFetch(() => new Response('', { status: 500 }));
  const api = new PlexApi(CONFIG);
  await assert.rejects(api.getTransientToken(), /HTTP 500/);
  mockFetch(() => new Response('', { status: 403 }));
  assert.equal(await api.getTransientToken(), null, 'unclaimed server, seen from a container');
  mockFetch(() => jsonResponse({ MediaContainer: { token: 'transient-abc' } }));
  assert.equal(await api.getTransientToken(), 'transient-abc');
});

test('a listing without totalSize announces one more row when the page is full', async () => {
  mockFetch(() => jsonResponse({ MediaContainer: { size: 2, Metadata: [{}, {}] } }));
  const api = new PlexApi(CONFIG);
  assert.equal((await api.page('/playlists', {}, { offset: 4, limit: 2 })).total, 7);
  assert.equal((await api.page('/playlists', {}, { offset: 4, limit: 5 })).total, 6);
});

test('a 401 answer surfaces a clear authentication error', async () => {
  mockFetch(() => new Response('', { status: 401 }));
  const api = new PlexApi(CONFIG);
  await assert.rejects(() => api.getIdentity(), /authentication failed/);
});

test('other HTTP errors surface the status code', async () => {
  mockFetch(() => new Response('', { status: 500 }));
  const api = new PlexApi(CONFIG);
  await assert.rejects(() => api.getIdentity(), /HTTP 500/);
});

test('network failures surface an unreachable-server error', async () => {
  mockFetch(() => {
    throw new Error('ECONNREFUSED');
  });
  const api = new PlexApi(CONFIG);
  await assert.rejects(() => api.getIdentity(), /unreachable/);
});
