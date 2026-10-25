// -----------------------------------------------------------------------------
// Entry point of the Plex integration for Gladys Assistant.
//
// Role of this file: wire the SDK to the PlexMonitor (src/monitor.js). It holds
// no Plex logic itself:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. on connection, contacts the Plex server, publishes the devices and
//      starts the refresh loops (session poll + real-time WebSocket).
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, isConfigured } from './src/config.js';
import { PlexMonitor } from './src/monitor.js';
import { RefreshLoops } from './src/loops.js';
import { WIDGET } from './src/widgets.js';
import { MESSAGES } from './src/messages.js';
import { registerMusicHandlers } from './src/music.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

/** @type {PlexMonitor|null} Present once the Plex server has been reached. */
let monitor = null;

/** @type {RefreshLoops|null} Session poll, library poll and notification socket. */
let loops = null;

/** Increments on every initialize(): only the newest run may publish. */
let initGeneration = 0;

/** Retry of a failed start (Plex unreachable when the integration starts). */
let initRetryTimer = null;
let initFailures = 0;
const INIT_RETRY_FIRST_MS = 30_000;
const INIT_RETRY_MAX_MS = 5 * 60_000;

const NOT_CONFIGURED_MESSAGE = MESSAGES.notConfigured;

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  if (!monitor) {
    logger.warn('onScanRequest ignored: the Plex server is not connected yet');
    return;
  }
  await monitor.discoverPlayers();
  logger.info(`onScanRequest -> publishing ${monitor.players.size + 1} devices`);
  await gladys.publishDiscoveredDevices(monitor.buildDevices());
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  // The monitor logs one info line per command (route used, or failure).
  logger.debug(`onSetValue <- ${feature.external_id} = ${value}`);
  if (!monitor) {
    throw new Error('Plex server not connected');
  }
  await monitor.handleSetValue(device, feature, value);
});

// --- Device created: the user added a discovered device --------------------
// The states published while the device did not exist in Gladys were dropped,
// and the deduplication would never resend them: forget what was published
// for this device and refresh everything right away, so its features show
// fresh values seconds after the add.
/**
 * A device created, or updated from the Discovery tab ("Update": the Gladys
 * 5.3 music features of a player made before 1.3): the states published
 * while its features did not exist were dropped by Gladys, so publish
 * everything again (the SDK forgets its now-playing snapshot of it too).
 * @param {string} event
 */
const republish = (event) => async (device) => {
  logger.info(`${event} <- ${device.external_id}`);
  if (!monitor) {
    return;
  }
  monitor.resetPublicationCache(device.external_id);
  monitor.scheduleSessionRefresh();
  await monitor.refreshLibraries().catch((err) => {
    logger.warn(`Library refresh after ${event} failed: ${err.message}`);
  });
};
gladys.onDeviceCreated(republish('onDeviceCreated'));
gladys.onDeviceUpdated(republish('onDeviceUpdated'));

// Gladys 5.3 music panel (manifest `music`).
registerMusicHandlers(gladys, () => monitor);

// --- Polling ------------------------------------------------------------------
// No device declares should_poll / poll_frequency: every value comes from the
// integration's own timers (src/loops.js), never from the core's onPoll, which
// Gladys 5.2.0 never sends to a device created without should_poll
// (GladysAssistant/Gladys#3198). The handler below is only a fallback: should
// the core ever poll a Plex device, it asks for an early session refresh.
gladys.onPoll(async () => {
  monitor?.scheduleSessionRefresh();
});

// --- Manifest actions: buttons in the Configuration screen -------------------
gladys.onAction('test_connection', async () => {
  const testConfig = normalizeConfig(await gladys.getConfig());
  if (!isConfigured(testConfig)) {
    return NOT_CONFIGURED_MESSAGE;
  }
  const testMonitor = new PlexMonitor(gladys, testConfig);
  await testMonitor.init();
  const { friendlyName, version } = testMonitor.serverInfo;
  const libraries = testMonitor.libraries.length;
  const players = testMonitor.players.size;
  return MESSAGES.connected({ friendlyName, version, libraries, players });
});

gladys.onAction('scan_clients', async () => {
  if (!monitor) {
    return NOT_CONFIGURED_MESSAGE;
  }
  const total = await monitor.discoverPlayers();
  await gladys.publishDiscoveredDevices(monitor.buildDevices());
  return MESSAGES.playersScanned({ total });
});

// --- Dashboard widgets --------------------------------------------------------
gladys.onWidgetGet(WIDGET.NOW_PLAYING, async ({ language }) => {
  if (!monitor) {
    return { components: [] };
  }
  return monitor.nowPlayingContent(language);
});

gladys.onWidgetGet(WIDGET.PLAYER, async ({ settings, language }) => {
  if (!monitor) {
    return { components: [] };
  }
  return monitor.playerContent(language, settings?.player);
});

gladys.onWidgetGet(WIDGET.LATEST_MEDIA, async ({ settings, language }) => {
  if (!monitor) {
    return { components: [] };
  }
  return monitor.latestContent(language, settings?.kind);
});

gladys.onWidgetGetImage(async (imageKey) => {
  if (!monitor) {
    throw new Error('Plex server not connected');
  }
  return monitor.widgetImage(imageKey);
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  initFailures = 0; // A new configuration gets its own first error line.
  // The server address or token may have changed: rebuild everything.
  await initialize();
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  config = normalizeConfig(await gladys.getConfig());
  await initialize();
});

gladys.on('disconnected', () => {
  // Also drops an initialize() still in flight: the next `connected` starts over.
  initGeneration += 1;
  clearInitRetry();
  stopLoops();
});

/**
 * (Re)connect to the Plex server, publish the devices and start the refresh
 * loops. Reports the application-level connection status either way.
 */
async function initialize() {
  // Saving the config fires onConfigUpdated while `connected` may still be
  // initializing: without this guard the two runs would each start their own
  // poll loop and notification socket (duplicate "Connected to Plex server"
  // lines in the logs). Only the newest run is allowed to publish anything.
  const generation = ++initGeneration;
  const isStale = () => generation !== initGeneration;

  clearInitRetry();
  stopLoops();
  monitor?.stop();
  monitor = null;

  if (!isConfigured(config)) {
    logger.info('Waiting for the Plex configuration (URL + token)');
    await gladys.setConnectionStatus(false, NOT_CONFIGURED_MESSAGE).catch(() => {});
    return;
  }

  try {
    const nextMonitor = new PlexMonitor(gladys, config);
    await nextMonitor.init();
    if (isStale()) {
      logger.debug('Initialization superseded by a newer one, dropping it');
      nextMonitor.stop();
      return;
    }
    monitor = nextMonitor;

    // Publish the devices (idempotent upsert by external_id).
    await gladys.publishDiscoveredDevices(monitor.buildDevices());

    // First data points, then the periodic loops (which report a lasting
    // failure themselves).
    await monitor.refreshSessions().catch((err) => {
      logger.debug(`Initial session refresh failed: ${err.message}`);
    });
    await monitor.refreshLibraries().catch((err) => {
      logger.warn(`Initial library refresh failed: ${err.message}`);
    });
    await monitor.publishAbsentPlayersIdle();
    if (isStale()) {
      return;
    }
    startLoops();
    if (initFailures > 0) {
      logger.info(`Plex server reached after ${initFailures} failed attempt(s)`);
      initFailures = 0;
    }

    await gladys.setConnectionStatus(true);
  } catch (err) {
    if (isStale()) {
      return;
    }
    // Plex may simply start after Gladys: retry on our own timer (no core
    // polling to count on), logging the first failure only.
    initFailures += 1;
    const delayMs = Math.min(INIT_RETRY_FIRST_MS * 2 ** (initFailures - 1), INIT_RETRY_MAX_MS);
    if (initFailures === 1) {
      logger.error(`Plex initialization failed, retrying in the background: ${err.message}`);
    } else {
      logger.debug(`Plex initialization failed (${initFailures} in a row): ${err.message}`);
    }
    initRetryTimer = setTimeout(() => {
      initRetryTimer = null;
      if (!isStale()) {
        initialize();
      }
    }, delayMs);
    await gladys
      .setConnectionStatus(false, MESSAGES.unreachable({ error: err.message }))
      .catch(() => {});
  }
}

function clearInitRetry() {
  if (initRetryTimer) {
    clearTimeout(initRetryTimer);
    initRetryTimer = null;
  }
}

function startLoops() {
  loops = new RefreshLoops(gladys, config, monitor);
  loops.start();
}

function stopLoops() {
  loops?.stop();
  loops = null;
}

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  clearInitRetry();
  stopLoops();
  monitor?.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Plex integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
