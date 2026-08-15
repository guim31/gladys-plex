// -----------------------------------------------------------------------------
// PlexMonitor tests: discovery payloads, session state publication, idle
// transitions, marker sensors and player commands — with a fake Plex API and
// a fake Gladys SDK.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlexMonitor, extractPlayerMachineId } from '../src/monitor.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  SERVER_INFO,
  LIBRARIES,
  CLIENTS,
  SESSIONS,
  EPISODE_METADATA_WITH_MARKERS,
  LIBRARY_COUNTS,
} from './fixtures/plex.js';

const CONFIG = normalizeConfig({
  plex_url: 'http://plex.local:32400',
  plex_token: 'secret-token',
});

function createFakeApi({ sessions = SESSIONS } = {}) {
  const commands = [];
  return {
    commands,
    sessions,
    async getServerInfo() {
      return { ...SERVER_INFO.MediaContainer };
    },
    async getLibraries() {
      return LIBRARIES.MediaContainer.Directory.map((d) => ({ ...d }));
    },
    async getClients() {
      return CLIENTS.MediaContainer.Server.map((c) => ({ ...c }));
    },
    async getSessions() {
      return this.sessions.MediaContainer.Metadata ?? [];
    },
    async getItemMarkers() {
      return EPISODE_METADATA_WITH_MARKERS.MediaContainer.Metadata[0].Marker;
    },
    async getLibraryCount(key, metadataType) {
      const fixtureKey =
        metadataType === 4 ? `${key}-episodes` : metadataType === 10 ? `${key}-tracks` : key;
      return LIBRARY_COUNTS[fixtureKey].MediaContainer.totalSize;
    },
    async playerCommand(machineIdentifier, path, params) {
      commands.push({ machineIdentifier, path, params });
    },
  };
}

async function createMonitor(options) {
  const gladys = createFakeGladys();
  const monitor = new PlexMonitor(gladys, CONFIG);
  monitor.api = createFakeApi(options);
  await monitor.init();
  return { gladys, monitor };
}

function statesByFeature(gladys) {
  return Object.fromEntries(gladys.published.map((s) => [s.featureExternalId, s.state]));
}

test('init discovers the server, the libraries and every player', async () => {
  const { monitor } = await createMonitor();
  assert.equal(monitor.serverInfo.friendlyName, 'Home Cinema');
  assert.equal(monitor.libraries.length, 3);
  // client-tv comes from /clients, client-phone only streams (sessions).
  assert.deepEqual([...monitor.players.keys()].sort(), ['client-phone', 'client-tv']);
});

test('buildDevices returns the server device plus one device per player', async () => {
  const { monitor } = await createMonitor();
  const devices = monitor.buildDevices();
  assert.equal(devices.length, 3);

  const server = devices[0];
  assert.equal(server.external_id, 'ext:plex:server:srv-abc123');
  assert.equal(server.name, 'Plex - Home Cinema');
  const featureKeys = server.features.map((f) => f.external_id);
  assert.ok(featureKeys.includes('ext:plex:server:srv-abc123:active-streams'));
  assert.ok(featureKeys.includes('ext:plex:server:srv-abc123:library-1-count'));
  assert.ok(featureKeys.includes('ext:plex:server:srv-abc123:library-2-episodes'));
  assert.ok(featureKeys.includes('ext:plex:server:srv-abc123:library-3-tracks'));

  const tv = devices.find((d) => d.external_id === 'ext:plex:player:client-tv');
  assert.equal(tv.name, 'Plex - TV Salon (Plex for Apple TV)');
  const tvFeatures = tv.features.map((f) => f.external_id.split(':').pop());
  for (const key of ['play', 'pause', 'stop', 'previous', 'next', 'volume', 'mute']) {
    assert.ok(tvFeatures.includes(key), `player device misses the "${key}" control`);
  }
});

test('library sensors can be disabled from the config', async () => {
  const gladys = createFakeGladys();
  const monitor = new PlexMonitor(gladys, { ...CONFIG, library_sensors: false });
  monitor.api = createFakeApi();
  await monitor.init();
  const server = monitor.buildDevices()[0];
  assert.ok(!server.features.some((f) => f.external_id.includes(':library-')));
});

test('refreshSessions publishes playback states, markers and server activity', async () => {
  const { gladys, monitor } = await createMonitor();
  await monitor.refreshSessions();
  const states = statesByFeature(gladys);

  // The TV plays an episode, 65 s in: inside the intro marker (30 s - 90 s).
  assert.equal(states['ext:plex:player:client-tv:playback-state'], 1);
  assert.equal(states['ext:plex:player:client-tv:intro'], 1);
  assert.equal(states['ext:plex:player:client-tv:credits'], 0);
  assert.equal(states['ext:plex:player:client-tv:remaining'], 59);

  // The phone is paused on a music track (no markers for tracks).
  assert.equal(states['ext:plex:player:client-phone:playback-state'], 0);

  // Server activity: 2 streams, 1 transcode, summed bandwidth.
  assert.equal(states['ext:plex:server:srv-abc123:active-streams'], 2);
  assert.equal(states['ext:plex:server:srv-abc123:transcode-sessions'], 1);
  assert.equal(states['ext:plex:server:srv-abc123:bandwidth'], 12_320);

  // Text states: now-playing per player + the server summary.
  const texts = Object.fromEntries(gladys.textStates.map((t) => [t.featureExternalId, t.text]));
  assert.equal(
    texts['ext:plex:player:client-tv:now-playing'],
    'Game of Thrones S01E01 - Winter Is Coming',
  );
  assert.match(texts['ext:plex:server:srv-abc123:now-playing'], /guilhem: Game of Thrones/);
});

test('refreshSessions publishes only the changes (deduplication)', async () => {
  const { gladys, monitor } = await createMonitor();
  await monitor.refreshSessions();
  const before = gladys.published.length;
  await monitor.refreshSessions();
  assert.equal(gladys.published.length, before, 'identical states must not be republished');
});

test('a player going idle is reset to a stopped state', async () => {
  const { gladys, monitor } = await createMonitor();
  await monitor.refreshSessions();
  gladys.published.length = 0;
  gladys.textStates.length = 0;

  monitor.api.sessions = { MediaContainer: {} };
  await monitor.refreshSessions();
  const states = statesByFeature(gladys);

  assert.equal(states['ext:plex:player:client-tv:playback-state'], 0);
  assert.equal(states['ext:plex:player:client-tv:remaining'], 0);
  assert.equal(states['ext:plex:player:client-tv:intro'], 0);
  assert.equal(states['ext:plex:server:srv-abc123:active-streams'], 0);
  const texts = Object.fromEntries(gladys.textStates.map((t) => [t.featureExternalId, t.text]));
  assert.equal(texts['ext:plex:player:client-tv:now-playing'], '-');
});

test('refreshSessions reports never-seen players so discovery is republished', async () => {
  const { monitor } = await createMonitor({ sessions: { MediaContainer: {} } });
  assert.equal(await monitor.refreshSessions(), false);

  monitor.api.sessions = SESSIONS;
  assert.equal(await monitor.refreshSessions(), true, 'client-phone is new');
  assert.equal(await monitor.refreshSessions(), false, 'already known on the second pass');
});

test('refreshLibraries publishes every library count', async () => {
  const { gladys, monitor } = await createMonitor();
  await monitor.refreshLibraries();
  const states = statesByFeature(gladys);
  assert.equal(states['ext:plex:server:srv-abc123:library-1-count'], 250);
  assert.equal(states['ext:plex:server:srv-abc123:library-2-count'], 40);
  assert.equal(states['ext:plex:server:srv-abc123:library-2-episodes'], 1200);
  assert.equal(states['ext:plex:server:srv-abc123:library-3-tracks'], 5400);
});

test('handleSetValue routes playback commands to the right player', async () => {
  const { monitor } = await createMonitor();
  await monitor.refreshSessions();
  const device = { external_id: 'ext:plex:player:client-tv' };

  await monitor.handleSetValue(device, { external_id: `${device.external_id}:pause` }, 1);
  assert.deepEqual(monitor.api.commands[0], {
    machineIdentifier: 'client-tv',
    path: '/player/playback/pause',
    params: { type: 'video' },
  });

  // The phone plays music: commands carry the music controller type.
  const phone = { external_id: 'ext:plex:player:client-phone' };
  await monitor.handleSetValue(phone, { external_id: `${phone.external_id}:play` }, 1);
  assert.equal(monitor.api.commands[1].params.type, 'music');

  monitor.stop(); // cancel the post-command refresh timers
});

test('handleSetValue clamps the volume and publishes it back', async () => {
  const { gladys, monitor } = await createMonitor();
  const device = { external_id: 'ext:plex:player:client-tv' };
  await monitor.handleSetValue(device, { external_id: `${device.external_id}:volume` }, 150);

  assert.deepEqual(monitor.api.commands[0].params, { type: 'video', volume: 100 });
  assert.deepEqual(gladys.published.at(-1), {
    featureExternalId: 'ext:plex:player:client-tv:volume',
    state: 100,
  });
  monitor.stop();
});

test('handleSetValue toggles mute through setParameters', async () => {
  const { monitor } = await createMonitor();
  const device = { external_id: 'ext:plex:player:client-tv' };
  await monitor.handleSetValue(device, { external_id: `${device.external_id}:mute` }, 1);
  assert.deepEqual(monitor.api.commands[0].params, { type: 'video', mute: 1 });
  await monitor.handleSetValue(device, { external_id: `${device.external_id}:mute` }, 0);
  assert.deepEqual(monitor.api.commands[1].params, { type: 'video', mute: 0 });
  monitor.stop();
});

test('handleSetValue rejects unknown devices and features', async () => {
  const { monitor } = await createMonitor();
  await assert.rejects(
    () =>
      monitor.handleSetValue(
        { external_id: 'ext:plex:server:srv-abc123' },
        { external_id: 'ext:plex:server:srv-abc123:active-streams' },
        1,
      ),
    /Not a controllable Plex device/,
  );
  await assert.rejects(
    () =>
      monitor.handleSetValue(
        { external_id: 'ext:plex:player:client-tv' },
        { external_id: 'ext:plex:player:client-tv:unknown-feature' },
        1,
      ),
    /No command handler/,
  );
  monitor.stop();
});

test('extractPlayerMachineId parses player external ids only', () => {
  assert.equal(extractPlayerMachineId('ext:plex:player:client-tv'), 'client-tv');
  assert.equal(extractPlayerMachineId('ext:plex:server:srv-abc123'), null);
});
