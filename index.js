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
import { PlexNotifications } from './src/plex/notifications.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

/** @type {PlexMonitor|null} Present once the Plex server has been reached. */
let monitor = null;

/** @type {PlexNotifications|null} Real-time notification socket. */
let notifications = null;

/** @type {ReturnType<typeof setInterval>|null} Fallback session poll. */
let sessionInterval = null;

/** @type {ReturnType<typeof setInterval>|null} Library statistics poll. */
let libraryInterval = null;

const NOT_CONFIGURED_MESSAGE = {
  en: 'Fill in the Plex server URL and token in the configuration.',
  fr: "Renseignez l'URL et le jeton du serveur Plex dans la configuration.",
};

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
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  if (!monitor) {
    throw new Error('Plex server not connected');
  }
  await monitor.handleSetValue(device, feature, value);
});

// --- Polling ------------------------------------------------------------------
// No device declares a Gladys poll_frequency (the core only accepts fast 1 s -
// 1 min polling): both refresh loops are owned by the integration (see
// startLoops), so onPoll is intentionally not registered.

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
  return {
    en: `Connected to "${friendlyName}" (Plex ${version}): ${libraries} libraries, ${players} players found.`,
    fr: `Connecté à « ${friendlyName} » (Plex ${version}) : ${libraries} bibliothèques, ${players} lecteurs trouvés.`,
  };
});

gladys.onAction('scan_clients', async () => {
  if (!monitor) {
    return NOT_CONFIGURED_MESSAGE;
  }
  const total = await monitor.discoverPlayers();
  await gladys.publishDiscoveredDevices(monitor.buildDevices());
  return {
    en: `${total} Plex players known. New ones appear in the Discovery tab.`,
    fr: `${total} lecteurs Plex connus. Les nouveaux apparaissent dans l'onglet Découverte.`,
  };
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // The server address or token may have changed: rebuild everything.
  await initialize();
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  config = normalizeConfig(await gladys.getConfig());
  await initialize();
});

gladys.on('disconnected', () => {
  stopLoops();
});

/**
 * (Re)connect to the Plex server, publish the devices and start the refresh
 * loops. Reports the application-level connection status either way.
 */
async function initialize() {
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
    monitor = nextMonitor;

    // Publish the devices (idempotent upsert by external_id).
    await gladys.publishDiscoveredDevices(monitor.buildDevices());

    // First data points, then the periodic loops.
    await monitor.refreshSessions();
    await monitor.refreshLibraries().catch((err) => {
      logger.warn(`Initial library refresh failed: ${err.message}`);
    });
    startLoops();

    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error(`Plex initialization failed: ${err.message}`);
    await gladys
      .setConnectionStatus(false, {
        en: `Cannot reach the Plex server: ${err.message}`,
        fr: `Impossible de joindre le serveur Plex : ${err.message}`,
      })
      .catch(() => {});
  }
}

/**
 * Start the session poll and the real-time notification socket. The socket
 * only accelerates the poll: every playback event triggers an immediate
 * (debounced) session refresh.
 */
function startLoops() {
  sessionInterval = setInterval(() => {
    refreshSessionsSafely();
  }, config.session_poll_frequency * 1_000);

  libraryInterval = setInterval(() => {
    monitor?.refreshLibraries().catch((err) => {
      logger.warn(`Library refresh failed: ${err.message}`);
    });
  }, config.poll_frequency * 1_000);

  notifications = new PlexNotifications(config, {
    onPlaying: () => monitor?.scheduleSessionRefresh(),
  });
  notifications.start();
}

function stopLoops() {
  if (sessionInterval) {
    clearInterval(sessionInterval);
    sessionInterval = null;
  }
  if (libraryInterval) {
    clearInterval(libraryInterval);
    libraryInterval = null;
  }
  if (notifications) {
    notifications.stop();
    notifications = null;
  }
}

let consecutiveFailures = 0;

async function refreshSessionsSafely() {
  if (!monitor) {
    return;
  }
  try {
    const newPlayers = await monitor.refreshSessions();
    if (newPlayers) {
      // A never-seen player started streaming: offer it in the Discovery tab.
      await gladys.publishDiscoveredDevices(monitor.buildDevices());
    }
    if (consecutiveFailures >= 3) {
      await gladys.setConnectionStatus(true).catch(() => {});
    }
    consecutiveFailures = 0;
  } catch (err) {
    consecutiveFailures += 1;
    logger.warn(`Session refresh failed (${consecutiveFailures}): ${err.message}`);
    if (consecutiveFailures === 3) {
      await gladys
        .setConnectionStatus(false, {
          en: `Lost contact with the Plex server: ${err.message}`,
          fr: `Contact perdu avec le serveur Plex : ${err.message}`,
        })
        .catch(() => {});
    }
  }
}

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  stopLoops();
  monitor?.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Plex integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
