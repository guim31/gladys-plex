import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPlayback, playbackOf, buildEventData, SCENE_TRIGGER } from '../src/scene-events.js';
import { normalizeSession } from '../src/plex/sessions.js';
import { SESSIONS } from './fixtures/plex.js';

const snap = (entries) => new Map(Object.entries(entries));
const triggers = (events) => events.map((e) => `${e.trigger}:${e.key}`);

test('playbackOf: buffering counts as playing', () => {
  assert.deepEqual(playbackOf({ ratingKey: 42, state: 'buffering' }), {
    itemId: '42',
    paused: false,
  });
  assert.equal(playbackOf({ ratingKey: '42', state: 'paused' }).paused, true);
});

test('start, pause, resume, stop: one event per transition', () => {
  const playing = { itemId: 'a', paused: false };
  const paused = { itemId: 'a', paused: true };
  assert.deepEqual(triggers(diffPlayback(snap({}), snap({ tv: playing }))), [
    `${SCENE_TRIGGER.STARTED}:tv`,
  ]);
  assert.deepEqual(triggers(diffPlayback(snap({ tv: playing }), snap({ tv: paused }))), [
    `${SCENE_TRIGGER.PAUSED}:tv`,
  ]);
  assert.deepEqual(triggers(diffPlayback(snap({ tv: paused }), snap({ tv: playing }))), [
    `${SCENE_TRIGGER.RESUMED}:tv`,
  ]);
  assert.deepEqual(triggers(diffPlayback(snap({ tv: playing }), snap({}))), [
    `${SCENE_TRIGGER.STOPPED}:tv`,
  ]);
  assert.deepEqual(diffPlayback(snap({ tv: playing }), snap({ tv: { ...playing } })), []);
});

test('the next episode is a new start; a media showing up paused is start + pause', () => {
  assert.deepEqual(
    triggers(
      diffPlayback(
        snap({ tv: { itemId: 'e1', paused: false } }),
        snap({ tv: { itemId: 'e2', paused: false } }),
      ),
    ),
    [`${SCENE_TRIGGER.STARTED}:tv`],
  );
  assert.deepEqual(triggers(diffPlayback(snap({}), snap({ tv: { itemId: 'a', paused: true } }))), [
    `${SCENE_TRIGGER.STARTED}:tv`,
    `${SCENE_TRIGGER.PAUSED}:tv`,
  ]);
});

test('buildEventData: flat, primitives only, the filters and the variables', () => {
  const episode = normalizeSession(SESSIONS.MediaContainer.Metadata[0]);
  const data = buildEventData('ext:plex:player:client-tv', episode, 'Plex - TV Salon');
  assert.deepEqual(data, {
    player: 'ext:plex:player:client-tv',
    media_type: 'episode',
    title: 'Game of Thrones S01E01 - Winter Is Coming',
    name: 'Winter Is Coming',
    series_name: 'Game of Thrones',
    user: 'guilhem',
    player_name: 'Plex - TV Salon',
  });
  const track = normalizeSession(SESSIONS.MediaContainer.Metadata[1]);
  assert.equal(buildEventData('p', track, 'x').media_type, 'music');
  for (const value of Object.values(data)) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof value));
  }
});
