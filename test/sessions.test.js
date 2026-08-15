import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSession,
  buildNowPlayingTitle,
  commandTypeForMedia,
  isInMarker,
  remainingMinutes,
  buildActivitySummary,
} from '../src/plex/sessions.js';
import { SESSIONS } from './fixtures/plex.js';

const [EPISODE_SESSION, TRACK_SESSION] = SESSIONS.MediaContainer.Metadata;

test('normalizeSession extracts the playback facts of an episode', () => {
  const session = normalizeSession(EPISODE_SESSION);
  assert.equal(session.machineIdentifier, 'client-tv');
  assert.equal(session.state, 'playing');
  assert.equal(session.user, 'guilhem');
  assert.equal(session.mediaType, 'episode');
  assert.equal(session.title, 'Game of Thrones S01E01 - Winter Is Coming');
  assert.equal(session.transcoding, true);
  assert.equal(session.bandwidth, 12_000);
});

test('normalizeSession returns null without an attached player', () => {
  assert.equal(normalizeSession({ title: 'Orphan' }), null);
});

test('buildNowPlayingTitle formats every media type', () => {
  assert.equal(buildNowPlayingTitle(TRACK_SESSION), 'Daft Punk - Get Lucky');
  assert.equal(
    buildNowPlayingTitle({ type: 'movie', title: 'Inception', year: 2010 }),
    'Inception (2010)',
  );
  assert.equal(buildNowPlayingTitle({ type: 'movie', title: 'Home Video' }), 'Home Video');
});

test('commandTypeForMedia maps the Plex controller types', () => {
  assert.equal(commandTypeForMedia('track'), 'music');
  assert.equal(commandTypeForMedia('photo'), 'photo');
  assert.equal(commandTypeForMedia('episode'), 'video');
  assert.equal(commandTypeForMedia('movie'), 'video');
});

test('isInMarker detects the playhead inside a marker window', () => {
  const markers = [
    { type: 'intro', startTimeOffset: 30_000, endTimeOffset: 90_000 },
    { type: 'credits', startTimeOffset: 3_300_000, endTimeOffset: 3_600_000 },
  ];
  assert.equal(isInMarker(markers, 'intro', 65_000), true);
  assert.equal(isInMarker(markers, 'intro', 90_000), false); // end is exclusive
  assert.equal(isInMarker(markers, 'credits', 65_000), false);
  assert.equal(isInMarker(markers, 'credits', 3_400_000), true);
  assert.equal(isInMarker([], 'intro', 65_000), false);
});

test('remainingMinutes rounds up and never goes negative', () => {
  assert.equal(remainingMinutes({ viewOffset: 65_000, duration: 3_600_000 }), 59);
  assert.equal(remainingMinutes({ viewOffset: 3_600_000, duration: 3_600_000 }), 0);
  assert.equal(remainingMinutes({ viewOffset: 4_000_000, duration: 3_600_000 }), 0);
});

test('buildActivitySummary lists every session with its user', () => {
  const sessions = SESSIONS.MediaContainer.Metadata.map(normalizeSession);
  assert.equal(
    buildActivitySummary(sessions),
    'guilhem: Game of Thrones S01E01 - Winter Is Coming | ana: Daft Punk - Get Lucky (pause)',
  );
  assert.equal(buildActivitySummary([]), '');
});
