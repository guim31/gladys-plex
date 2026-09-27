import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  posterOf,
  backdropOf,
  imageKey,
  itemLinks,
  describeItem,
  texts,
  buildNowPlayingContent,
  buildPlayerContent,
  buildLatestContent,
} from '../src/widgets.js';
import { normalizeSession, normalizeMetadata, mediaCategory } from '../src/plex/sessions.js';
import { SESSIONS } from './fixtures/plex.js';

const IMAGE_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const register = (artwork) => imageKey(artwork);
const featureOf = (key) => `ext:plex:player:client-tv:${key}`;

const EPISODE = {
  ...SESSIONS.MediaContainer.Metadata[0],
  thumb: '/library/metadata/4242/thumb/1700000003',
  art: '/library/metadata/100/art/1700000001',
  grandparentThumb: '/library/metadata/100/thumb/1700000001',
  grandparentArt: '/library/metadata/100/art/1700000001',
  summary: 'Lord Stark is troubled by reports from a Night Watch deserter.',
};
const TRACK = {
  ...SESSIONS.MediaContainer.Metadata[1],
  thumb: '/library/metadata/7777/thumb/1700000009',
  parentThumb: '/library/metadata/7700/thumb/1700000008',
};
const MOVIE = {
  ratingKey: '1',
  type: 'movie',
  title: 'Big Buck Bunny',
  year: 2008,
  thumb: '/library/metadata/1/thumb/1790533151',
  art: '/library/metadata/1/art/1790533151',
  viewOffset: 60_000,
  duration: 600_000,
  User: { title: 'guilhem' },
  Player: { machineIdentifier: 'client-tv', title: 'TV Salon', state: 'playing' },
};

test('artwork: show poster for an episode, album cover for a track, fan art for the frame', () => {
  const episode = normalizeMetadata(EPISODE);
  assert.equal(posterOf(episode).path, '/library/metadata/100/thumb/1700000001');
  assert.equal(backdropOf(episode).path, '/library/metadata/100/art/1700000001');
  const track = normalizeMetadata(TRACK);
  assert.equal(posterOf(track).path, '/library/metadata/7700/thumb/1700000008');
  assert.equal(backdropOf(track), null, 'music shows its square cover');
  const bare = normalizeMetadata({ ratingKey: '9', type: 'movie', title: 'X' });
  assert.equal(posterOf(bare), null);
  assert.equal(backdropOf(bare), null);
});

test('image keys match the widget contract and follow the artwork timestamp', () => {
  const key = imageKey({ path: '/library/metadata/100/art/1700000001', kind: 'backdrop' });
  assert.equal(key, 'backdrop-100-art-1700000001');
  assert.match(
    imageKey({ path: 'https://metadata-static.plex.tv/a/b/c.jpg?x=1', kind: 'poster' }),
    IMAGE_KEY,
  );
  assert.match(imageKey({ path: '/', kind: 'poster' }), IMAGE_KEY);
  assert.notEqual(
    imageKey({ path: '/library/metadata/1/thumb/1', kind: 'poster' }),
    imageKey({ path: '/library/metadata/1/thumb/2', kind: 'poster' }),
  );
});

test('links open the entry in the Plex web app', () => {
  const [link] = itemLinks('srv-abc123', '42', 'fr');
  assert.equal(
    link.url,
    'https://app.plex.tv/desktop/#!/server/srv-abc123/details?key=%2Flibrary%2Fmetadata%2F42',
  );
  assert.equal(link.label, 'Ouvrir dans Plex');
  assert.deepEqual(itemLinks('srv', null, 'en'), []);
});

test('describeItem and mediaCategory per media kind', () => {
  assert.deepEqual(describeItem(normalizeMetadata(EPISODE)), {
    heading: 'Game of Thrones',
    caption: 'S01E01 · Winter Is Coming',
  });
  assert.deepEqual(describeItem(normalizeMetadata(TRACK)), {
    heading: 'Get Lucky',
    caption: 'Daft Punk · Random Access Memories',
  });
  assert.equal(mediaCategory(normalizeMetadata({ type: 'episode', live: 1 })), 'live_tv');
  assert.equal(mediaCategory(normalizeMetadata({ type: 'clip' })), 'video');
  assert.equal(texts('fr-FR').play, 'Lecture');
  assert.equal(texts(undefined).play, 'Play');
});

test('now_playing: one row per playback with its poster, valid content', () => {
  const content = buildNowPlayingContent({
    sessions: [normalizeSession(EPISODE), normalizeSession(TRACK)],
    streamsFeature: 'ext:plex:server:s:active-streams',
    transcodesFeature: 'ext:plex:server:s:transcode-sessions',
    language: 'fr',
    register,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const [episode, track] = content.components.find((c) => c.type === 'card-list').items;
  assert.equal(episode.title, 'Game of Thrones S01E01 - Winter Is Coming');
  assert.equal(episode.subtitle, 'guilhem sur TV Salon');
  assert.equal(episode.badge.text, 'Transcodage');
  assert.equal(track.badge.text, 'Pause');
  assert.match(episode.image, IMAGE_KEY);

  const empty = buildNowPlayingContent({
    sessions: [],
    streamsFeature: 'a',
    transcodesFeature: 'b',
    language: 'en',
    register,
  });
  assert.deepEqual(validateWidgetContent(empty), []);
});

test('player: fits the content budget exactly, fan art fills the frame', () => {
  const content = buildPlayerContent({
    session: normalizeSession(MOVIE),
    playerName: 'Plex - TV Salon',
    featureOf,
    language: 'fr',
    register,
  });
  assert.deepEqual(validateWidgetContent(content), [], 'nothing dropped by the core');
  assert.equal(content.components.length, 8);
  assert.equal(content.components[0].text, 'Big Buck Bunny');
  const image = content.components.find((c) => c.type === 'image');
  assert.equal(image.fit, 'cover');
  assert.equal(image.key, 'backdrop-1-art-1790533151');
  assert.deepEqual(
    content.components.filter((c) => c.type === 'button').map((b) => b.device_feature),
    [featureOf('pause'), featureOf('stop'), featureOf('next')],
  );
});

test('player: play button while paused, cover contained for music, idle state', () => {
  const content = buildPlayerContent({
    session: normalizeSession(TRACK),
    playerName: 'Plex - Pixel 9',
    featureOf,
    language: 'en',
    register,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.ok(content.components.some((c) => c.type === 'button' && c.icon === 'play'));
  assert.equal(content.components.find((c) => c.type === 'image').fit, 'contain');

  const idle = buildPlayerContent({
    session: null,
    playerName: 'Plex - TV Salon',
    featureOf,
    language: 'fr',
    register,
  });
  assert.deepEqual(validateWidgetContent(idle), []);
  assert.equal(idle.components[1].text, 'Rien en lecture sur ce lecteur pour le moment.');
});

const RECENT = [
  {
    ratingKey: '7',
    type: 'season',
    title: 'Saison 1',
    parentTitle: 'Pioneer One',
    thumb: '/library/metadata/7/thumb/1',
    addedAt: 1790533161,
  },
  {
    ratingKey: '2',
    type: 'movie',
    title: 'Cosmos Laundromat',
    year: 2015,
    thumb: '/library/metadata/2/thumb/1',
    summary: 'A sheep.',
    addedAt: 1790533152,
  },
  {
    ratingKey: '12',
    type: 'album',
    title: 'Test Album',
    parentTitle: 'Test Artist',
    addedAt: 1790533150,
  },
].map(normalizeMetadata);

test('latest_media: seasons under their show, filtered by kind, linked to Plex', () => {
  const content = buildLatestContent({
    items: RECENT,
    kind: 'all',
    language: 'fr',
    machineIdentifier: 'srv',
    register,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const [season, movie] = content.components[0].items;
  assert.equal(season.title, 'Pioneer One');
  assert.equal(season.subtitle, 'Saison 1');
  assert.equal(season.date, undefined, 'the grid would show the date instead of the subtitle');
  assert.equal(movie.subtitle, '2015');
  assert.equal(movie.description, 'A sheep.');
  assert.equal(content.components[0].items.length, 2, 'albums only under "music"');

  const music = buildLatestContent({
    items: RECENT,
    kind: 'music',
    language: 'en',
    machineIdentifier: 'srv',
    register,
  });
  assert.equal(music.components[0].items[0].subtitle, 'Test Artist');
  const undated = buildLatestContent({
    items: [
      normalizeMetadata({ ratingKey: '5', type: 'movie', title: 'No year', addedAt: 1790533161 }),
    ],
    kind: 'movies',
    language: 'en',
    machineIdentifier: 'srv',
    register,
  });
  assert.equal(undated.components[0].items[0].date, '2026-09-27T18:19:21.000Z');
  const none = buildLatestContent({
    items: [],
    kind: 'movies',
    language: 'en',
    machineIdentifier: 'srv',
    register,
  });
  assert.equal(none.components[0].text, 'Nothing added recently.');
});
