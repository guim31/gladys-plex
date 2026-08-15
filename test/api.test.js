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
