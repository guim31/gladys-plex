// -----------------------------------------------------------------------------
// Refresh loops and log volume, against the SDK's fake Gladys.
//
// - Polling: no device asks the core to poll it, and every value still reaches
//   Gladys from the integration's own timers, without a single onPoll
//   (GladysAssistant/Gladys#3198: Gladys 5.2.0 never polls a device created
//   without should_poll).
// - Logs: a normal cycle writes nothing at info level, repeated failures are
//   logged once, a flapping notification socket too, and the Plex token never
//   shows up.
// -----------------------------------------------------------------------------

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { PlexMonitor } from '../src/monitor.js';
import { RefreshLoops, FAILURES_BEFORE_DISCONNECTED } from '../src/loops.js';
import {
  PlexNotifications,
  STABLE_CONNECTION_MS,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
} from '../src/plex/notifications.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeApi } from './helpers/fakePlexApi.js';
import { SESSIONS } from './fixtures/plex.js';

const TOKEN = 'super-secret-plex-token';

const CONFIG = normalizeConfig({
  plex_url: 'http://plex.local:32400',
  plex_token: TOKEN,
  session_poll_frequency: 10,
  poll_frequency: 300,
});

/** Let the pending promise chains settle (setImmediate is not mocked). */
async function flush() {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Capture the integration's log lines (the SDK logger writes to the console). */
function captureLogs(t, level = 'info') {
  const previousLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  mock.method(console, 'log', record);
  mock.method(console, 'error', record);
  t.after(() => {
    mock.restoreAll();
    if (previousLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previousLevel;
    }
  });
  return {
    lines,
    at: (level) => lines.filter((line) => line.includes(`[${level}]`)),
  };
}

/** Same start-up as index.js initialize(), with the fake Plex API. */
async function startIntegration(t, apiOptions) {
  const gladys = createFakeGladys({ config: CONFIG });
  await gladys.connect();
  const monitor = new PlexMonitor(gladys, CONFIG);
  monitor.api = createFakeApi(apiOptions);
  await monitor.init();
  await gladys.publishDiscoveredDevices(monitor.buildDevices());
  await monitor.refreshSessions();
  await monitor.refreshLibraries();

  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const notifications = { started: 0, stopped: 0 };
  const loops = new RefreshLoops(gladys, CONFIG, monitor, {
    createNotifications: () => ({
      start: () => (notifications.started += 1),
      stop: () => (notifications.stopped += 1),
    }),
  });
  loops.start();
  t.after(() => {
    loops.stop();
    monitor.stop();
  });
  return { gladys, monitor, loops, notifications };
}

/** A copy of the session fixture with the TV episode paused. */
function sessionsWithTvPaused() {
  const copy = structuredClone(SESSIONS);
  copy.MediaContainer.Metadata[0].Player.state = 'paused';
  copy.MediaContainer.Metadata[0].viewOffset += 10_000;
  return copy;
}

test('no device relies on the core polling it', async (t) => {
  captureLogs(t);
  const { gladys } = await startIntegration(t);
  // The fake Gladys validated the payload like the host API does.
  assert.ok(gladys.fake.discoveredDevices.length >= 3);
  for (const device of gladys.fake.discoveredDevices) {
    assert.notEqual(device.should_poll, true, `${device.external_id} must not ask to be polled`);
    assert.equal(device.poll_frequency, undefined, device.external_id);
  }
});

test('sessions and libraries refresh from the internal timers, without any onPoll', async (t) => {
  captureLogs(t);
  const { gladys, monitor, notifications } = await startIntegration(t);
  assert.equal(notifications.started, 1);
  const statesBefore = gladys.fake.states.length;

  monitor.api.sessions = sessionsWithTvPaused();
  t.mock.timers.tick(CONFIG.session_poll_frequency * 1_000);
  await flush();
  const tv = monitor.buildDevices().find((d) => d.external_id.endsWith(':client-tv'));
  assert.ok(gladys.fake.states.length > statesBefore, 'the session poll published states');
  assert.ok(
    gladys.fake.states
      .slice(statesBefore)
      .some((s) => s.device_feature_external_id.startsWith(tv.external_id)),
    'the paused player got its new state',
  );
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => e.key),
    ['playback_paused'],
  );

  // Library counts change: the library timer publishes them, on its own.
  const counts = monitor.api.getLibraryCount.bind(monitor.api);
  monitor.api.getLibraryCount = async (...args) => (await counts(...args)) + 1;
  const libraryStatesBefore = gladys.fake.states.length;
  t.mock.timers.tick(CONFIG.poll_frequency * 1_000);
  await flush();
  const server = monitor.buildDevices()[0];
  assert.ok(
    gladys.fake.states
      .slice(libraryStatesBefore)
      .some((s) => s.device_feature_external_id.startsWith(server.external_id)),
    'the library poll published the new counts',
  );
  // Nothing above ever called gladys.fake.poll(): the timers alone did it.
});

test('a normal cycle writes nothing at info level', async (t) => {
  const logs = captureLogs(t);
  const { monitor } = await startIntegration(t);
  logs.lines.length = 0; // Start-up lines (connection to the server) are expected.

  monitor.api.sessions = sessionsWithTvPaused();
  for (let i = 0; i < 40; i += 1) {
    t.mock.timers.tick(CONFIG.session_poll_frequency * 1_000);
    await flush();
  }
  monitor.api.sessions = SESSIONS;
  t.mock.timers.tick(CONFIG.poll_frequency * 1_000);
  await flush();

  assert.deepEqual(logs.at('INFO'), []);
  assert.deepEqual(logs.at('WARN'), []);
  assert.deepEqual(logs.at('ERROR'), []);
});

test('a Plex outage is logged once, flagged after three failures, and its end once', async (t) => {
  const logs = captureLogs(t);
  // An error that quotes the token: it must still only be logged once.
  const failure = `Plex API error on /status/sessions?X-Plex-Token=${TOKEN}: HTTP 500`;
  const { gladys, monitor } = await startIntegration(t);
  logs.lines.length = 0;
  const statusesBefore = gladys.fake.connectionStatuses.length;

  const getSessions = monitor.api.getSessions;
  monitor.api.getSessions = async () => {
    throw new Error(failure);
  };
  for (let i = 0; i < 10; i += 1) {
    t.mock.timers.tick(CONFIG.session_poll_frequency * 1_000);
    await flush();
  }
  assert.equal(logs.at('WARN').length, 1, logs.lines.join('\n'));
  assert.match(logs.at('WARN')[0], /Plex session refresh failed/);
  const statuses = gladys.fake.connectionStatuses.slice(statusesBefore);
  assert.equal(statuses.length, 1, `flagged once, after ${FAILURES_BEFORE_DISCONNECTED} failures`);
  assert.equal(statuses[0].connected, false);

  monitor.api.getSessions = getSessions;
  for (let i = 0; i < 3; i += 1) {
    t.mock.timers.tick(CONFIG.session_poll_frequency * 1_000);
    await flush();
  }
  assert.equal(logs.at('INFO').length, 1, logs.lines.join('\n'));
  assert.match(logs.at('INFO')[0], /working again after 10 failed attempt/);
  assert.equal(gladys.fake.connectionStatuses.at(-1).connected, true);
  assert.ok(
    logs.lines.every((line) => !line.includes(TOKEN)),
    'the token is masked in the deduplicated warning',
  );
});

test('a new player is offered in Discovery even if the first publication fails', async (t) => {
  const logs = captureLogs(t);
  const { gladys, monitor } = await startIntegration(t);
  logs.lines.length = 0;
  const statusesBefore = gladys.fake.connectionStatuses.length;

  const sessions = sessionsWithTvPaused();
  const kitchen = structuredClone(sessions.MediaContainer.Metadata[0]);
  kitchen.Player.machineIdentifier = 'client-kitchen';
  kitchen.Player.title = 'Kitchen';
  kitchen.Session.id = 'sess-kitchen';
  sessions.MediaContainer.Metadata.push(kitchen);
  monitor.api.sessions = sessions;

  // Gladys refuses the first publication (restart, rate limit...).
  const publish = gladys.publishDiscoveredDevices.bind(gladys);
  let refused = 0;
  gladys.publishDiscoveredDevices = async (devices) => {
    if (refused === 0) {
      refused += 1;
      throw new Error('Gladys busy');
    }
    return publish(devices);
  };
  t.mock.timers.tick(CONFIG.session_poll_frequency * 1_000);
  await flush();
  assert.equal(refused, 1);
  assert.ok(!gladys.fake.discoveredDevices.some((d) => d.external_id.endsWith(':client-kitchen')));

  t.mock.timers.tick(CONFIG.session_poll_frequency * 1_000);
  await flush();
  assert.ok(
    gladys.fake.discoveredDevices.some((d) => d.external_id.endsWith(':client-kitchen')),
    'published by the next poll',
  );
  // A Gladys-side failure is neither a Plex warning nor a lost connection.
  assert.equal(logs.at('WARN').length, 0, logs.lines.join('\n'));
  assert.equal(gladys.fake.connectionStatuses.length, statusesBefore);
  assert.deepEqual(
    logs.at('INFO').map((line) => line.replace(/^.*\] /, '')),
    ['New Plex player discovered: Kitchen'],
  );
});

test('a library refresh failing on every poll is logged once', async (t) => {
  const logs = captureLogs(t);
  const { monitor } = await startIntegration(t);
  logs.lines.length = 0;
  monitor.api.getLibraryCount = async () => {
    throw new Error('Plex API error on /library/sections/1/all: HTTP 500');
  };
  for (let i = 0; i < 5; i += 1) {
    t.mock.timers.tick(CONFIG.poll_frequency * 1_000);
    await flush();
  }
  assert.equal(logs.at('WARN').length, 1, logs.lines.join('\n'));
  assert.equal(logs.at('INFO').length, 0);
});

// --- Notification socket --------------------------------------------------------

/** In-memory WebSocket: each instance is driven by the test. */
function createFakeSocketClass() {
  const sockets = [];
  class FakeSocket extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
      sockets.push(this);
    }
    close() {
      this.emit('close');
    }
  }
  return { FakeSocket, sockets };
}

test('a flapping notification socket logs one close and one return, never the token', async (t) => {
  // Debug level: the socket errors (which quote the URL, token included) are
  // captured too.
  const logs = captureLogs(t, 'debug');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { FakeSocket, sockets } = createFakeSocketClass();
  const notifications = new PlexNotifications(
    CONFIG,
    { onPlaying: () => {} },
    { WebSocketImpl: FakeSocket },
  );
  t.after(() => notifications.stop());
  notifications.start();
  assert.ok(sockets[0].url.includes(TOKEN), 'the token is sent to Plex');

  sockets[0].emit('open');
  // Opens and closes straight away, ten times in a row: the reconnection
  // delay keeps growing instead of going back to its first value.
  const delays = [];
  for (let i = 0; i < 10; i += 1) {
    const socket = sockets.at(-1);
    socket.emit('error', new Error(`Unexpected server response for ${socket.url}`));
    socket.emit('close');
    delays.push(notifications.reconnectDelay);
    t.mock.timers.tick(MAX_RECONNECT_DELAY_MS);
    sockets.at(-1).emit('open');
  }
  assert.equal(sockets.length, 11, 'one reconnection per close');
  assert.equal(delays.at(-1), MAX_RECONNECT_DELAY_MS);
  assert.ok(
    delays.every((d, i) => i === 0 || d >= delays[i - 1]),
    delays.join(','),
  );
  // Then it stays up: back to the first delay.
  t.mock.timers.tick(STABLE_CONNECTION_MS);
  assert.equal(notifications.reconnectDelay, INITIAL_RECONNECT_DELAY_MS);
  assert.ok(
    logs.at('DEBUG').some((line) => line.includes('***')),
    'the socket errors are logged',
  );

  const info = logs.at('INFO');
  assert.equal(info.length, 3, info.join('\n'));
  assert.match(info[0], /Connected to the Plex notification socket/);
  assert.match(info[1], /closed/);
  assert.match(info[2], /back/);
  assert.equal(logs.at('WARN').length, 0);
  assert.ok(logs.lines.every((line) => !line.includes(TOKEN)));
  assert.equal(notifications.redact(`x ${TOKEN} y`), 'x *** y');
});

test('a notification socket that never opens stays out of the info logs', async (t) => {
  const logs = captureLogs(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { FakeSocket, sockets } = createFakeSocketClass();
  const notifications = new PlexNotifications(
    CONFIG,
    { onPlaying: () => {} },
    { WebSocketImpl: FakeSocket },
  );
  t.after(() => notifications.stop());
  notifications.start();
  for (let i = 0; i < 5; i += 1) {
    sockets.at(-1).emit('close');
    t.mock.timers.tick(MAX_RECONNECT_DELAY_MS);
  }
  assert.equal(sockets.length, 6);
  assert.deepEqual(logs.at('INFO'), []);

  // It finally opens: one line, and no "back" line later.
  sockets.at(-1).emit('open');
  t.mock.timers.tick(STABLE_CONNECTION_MS);
  assert.equal(logs.at('INFO').length, 1);
  assert.match(logs.at('INFO')[0], /Connected to the Plex notification socket/);
});
