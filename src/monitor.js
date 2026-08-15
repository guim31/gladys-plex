// -----------------------------------------------------------------------------
// PlexMonitor: the state of ONE Plex server and everything published to Gladys.
//
// It owns the Plex API client, the list of libraries, the players known so far
// and the currently active sessions. index.js wires the SDK events to it:
//   - init()             : first contact with the server (identity, libraries,
//                          players, sessions);
//   - buildDevices()     : discovery payload (server device + player devices);
//   - refreshSessions()  : poll /status/sessions and publish playback states;
//   - refreshLibraries() : poll the library item counts;
//   - handleSetValue()   : run a user command on a player.
//
// States are deduplicated before publishing (a 10 s session poll would
// otherwise republish identical values forever).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { PlexApi, PLEX_METADATA_TYPES } from './plex/api.js';
import {
  normalizeSession,
  commandTypeForMedia,
  isInMarker,
  remainingMinutes,
  buildActivitySummary,
} from './plex/sessions.js';
import {
  buildServerDevice,
  serverExternalIds,
  libraryFeatureKey,
  SERVER_FEATURE,
} from './devices/server.js';
import {
  buildPlayerDevice,
  playerExternalIds,
  playerFeatureKey,
  PLAYER_FEATURE,
  PLAYER_COMMAND_PATHS,
} from './devices/player.js';

const logger = createLogger({ name: 'plex-monitor' });

// Text published on a player with no active session.
const IDLE_TEXT = '-';

// Media types that can carry intro/credits markers.
const MARKER_MEDIA_TYPES = new Set(['episode', 'movie']);

const MARKER_CACHE_MAX_ENTRIES = 100;

export class PlexMonitor {
  /**
   * @param {object} gladys - SDK instance.
   * @param {ReturnType<import('./config.js').normalizeConfig>} config
   */
  constructor(gladys, config) {
    this.gladys = gladys;
    this.config = config;
    this.api = new PlexApi(config);
    this.serverInfo = null;
    this.libraries = [];
    /** @type {Map<string, { machineIdentifier: string, name: string, product: string }>} */
    this.players = new Map();
    /** @type {Map<string, object>} Active sessions by player machineIdentifier. */
    this.activeSessions = new Map();
    /** @type {Map<string|number, Array<object>>} Markers by media ratingKey. */
    this.markerCache = new Map();
    /** @type {Map<string, number|string>} Last published value by feature external id. */
    this.lastPublished = new Map();
    this.refreshTimer = null;
  }

  /**
   * First contact with the server. Throws when the server is unreachable or
   * the token is invalid — the caller reports the connection status.
   */
  async init() {
    this.serverInfo = await this.api.getServerInfo();
    logger.info(
      `Connected to Plex server "${this.serverInfo.friendlyName}" (v${this.serverInfo.version})`,
    );
    this.libraries = await this.api.getLibraries();
    await this.discoverPlayers();
    // Sessions also reveal players (a phone streaming right now may not be
    // advertised through /clients).
    for (const raw of await this.api.getSessions()) {
      const session = normalizeSession(raw);
      if (session) {
        this.rememberPlayer(session);
      }
    }
  }

  /**
   * Refresh the list of players advertised to the server.
   * @returns {Promise<number>} How many players are known in total.
   */
  async discoverPlayers() {
    for (const client of await this.api.getClients()) {
      if (client.machineIdentifier) {
        this.players.set(client.machineIdentifier, {
          machineIdentifier: client.machineIdentifier,
          name: client.name || client.product || client.machineIdentifier,
          product: client.product || '',
        });
      }
    }
    return this.players.size;
  }

  /**
   * Discovery payload: the server device + one device per known player.
   */
  buildDevices() {
    const devices = [buildServerDevice(this.gladys, this.serverInfo, this.libraries, this.config)];
    for (const player of this.players.values()) {
      devices.push(buildPlayerDevice(this.gladys, player));
    }
    return devices;
  }

  /**
   * Poll the active sessions and publish every playback state.
   * @returns {Promise<boolean>} True when a never-seen player appeared (the
   *   caller should republish the discovered devices).
   */
  async refreshSessions() {
    const rawSessions = await this.api.getSessions();
    const sessions = rawSessions.map(normalizeSession).filter(Boolean);

    let newPlayers = false;
    for (const session of sessions) {
      newPlayers = this.rememberPlayer(session) || newPlayers;
    }

    const previouslyActive = new Set(this.activeSessions.keys());
    this.activeSessions = new Map(sessions.map((s) => [s.machineIdentifier, s]));

    const states = [];
    // Per-player playback states.
    for (const session of sessions) {
      const ids = playerExternalIds(this.gladys, session.machineIdentifier);
      const markers = await this.getMarkers(session);
      this.collectIfChanged(
        states,
        ids.feature(PLAYER_FEATURE.PLAYBACK_STATE),
        session.state === 'playing' ? 1 : 0,
      );
      this.collectIfChanged(
        states,
        ids.feature(PLAYER_FEATURE.REMAINING),
        remainingMinutes(session),
      );
      this.collectIfChanged(
        states,
        ids.feature(PLAYER_FEATURE.IN_INTRO),
        isInMarker(markers, 'intro', session.viewOffset) ? 1 : 0,
      );
      this.collectIfChanged(
        states,
        ids.feature(PLAYER_FEATURE.IN_CREDITS),
        isInMarker(markers, 'credits', session.viewOffset) ? 1 : 0,
      );
      await this.publishTextIfChanged(ids.feature(PLAYER_FEATURE.NOW_PLAYING), session.title);
    }

    // Players that just went idle.
    for (const machineIdentifier of previouslyActive) {
      if (!this.activeSessions.has(machineIdentifier)) {
        const ids = playerExternalIds(this.gladys, machineIdentifier);
        this.collectIfChanged(states, ids.feature(PLAYER_FEATURE.PLAYBACK_STATE), 0);
        this.collectIfChanged(states, ids.feature(PLAYER_FEATURE.REMAINING), 0);
        this.collectIfChanged(states, ids.feature(PLAYER_FEATURE.IN_INTRO), 0);
        this.collectIfChanged(states, ids.feature(PLAYER_FEATURE.IN_CREDITS), 0);
        await this.publishTextIfChanged(ids.feature(PLAYER_FEATURE.NOW_PLAYING), IDLE_TEXT);
      }
    }

    // Server-level activity sensors.
    const serverIds = serverExternalIds(this.gladys, this.serverInfo.machineIdentifier);
    this.collectIfChanged(
      states,
      serverIds.feature(SERVER_FEATURE.ACTIVE_STREAMS),
      sessions.length,
    );
    this.collectIfChanged(
      states,
      serverIds.feature(SERVER_FEATURE.TRANSCODE_SESSIONS),
      sessions.filter((s) => s.transcoding).length,
    );
    this.collectIfChanged(
      states,
      serverIds.feature(SERVER_FEATURE.BANDWIDTH),
      sessions.reduce((total, s) => total + s.bandwidth, 0),
    );
    await this.publishTextIfChanged(
      serverIds.feature(SERVER_FEATURE.NOW_PLAYING),
      buildActivitySummary(sessions) || IDLE_TEXT,
    );

    if (states.length > 0) {
      await this.gladys.publishStates(states);
    }
    return newPlayers;
  }

  /**
   * Poll the item counts of every library and publish them.
   */
  async refreshLibraries() {
    if (!this.config.library_sensors) {
      return;
    }
    this.libraries = await this.api.getLibraries();
    const serverIds = serverExternalIds(this.gladys, this.serverInfo.machineIdentifier);
    const states = [];
    for (const library of this.libraries) {
      const count = await this.api.getLibraryCount(library.key);
      this.collectIfChanged(states, serverIds.feature(libraryFeatureKey(library, 'count')), count);
      if (library.type === 'show') {
        const episodes = await this.api.getLibraryCount(library.key, PLEX_METADATA_TYPES.EPISODE);
        this.collectIfChanged(
          states,
          serverIds.feature(libraryFeatureKey(library, 'episodes')),
          episodes,
        );
      }
      if (library.type === 'artist') {
        const tracks = await this.api.getLibraryCount(library.key, PLEX_METADATA_TYPES.TRACK);
        this.collectIfChanged(
          states,
          serverIds.feature(libraryFeatureKey(library, 'tracks')),
          tracks,
        );
      }
    }
    if (states.length > 0) {
      await this.gladys.publishStates(states);
    }
  }

  /**
   * Run a user command on a player device.
   * @param {{ external_id: string }} device
   * @param {{ external_id: string }} feature
   * @param {number} value
   */
  async handleSetValue(device, feature, value) {
    const machineIdentifier = extractPlayerMachineId(device.external_id);
    if (!machineIdentifier) {
      throw new Error(`Not a controllable Plex device: ${device.external_id}`);
    }
    const ids = playerExternalIds(this.gladys, machineIdentifier);
    const key = playerFeatureKey(feature.external_id, ids);
    const session = this.activeSessions.get(machineIdentifier);
    const commandType = commandTypeForMedia(session?.mediaType ?? 'video');

    if (PLAYER_COMMAND_PATHS[key]) {
      await this.api.playerCommand(machineIdentifier, PLAYER_COMMAND_PATHS[key], {
        type: commandType,
      });
    } else if (key === PLAYER_FEATURE.VOLUME) {
      const volume = Math.max(0, Math.min(100, Math.round(value)));
      await this.api.playerCommand(machineIdentifier, '/player/playback/setParameters', {
        type: commandType,
        volume,
      });
      await this.gladys.publishState(feature.external_id, volume);
    } else if (key === PLAYER_FEATURE.MUTE) {
      const mute = value === 1 ? 1 : 0;
      await this.api.playerCommand(machineIdentifier, '/player/playback/setParameters', {
        type: commandType,
        mute,
      });
      await this.gladys.publishState(feature.external_id, mute);
    } else {
      throw new Error(`No command handler for ${feature.external_id}`);
    }

    // Playback commands change the session state: refresh shortly after, so
    // the UI reflects the new state without waiting for the next poll.
    this.scheduleSessionRefresh(1_500);
  }

  /**
   * Coalesce refresh requests (WebSocket notifications arrive in bursts).
   * @param {number} [delayMs]
   */
  scheduleSessionRefresh(delayMs = 500) {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshSessions().catch((err) => logger.warn(`Session refresh failed: ${err.message}`));
    }, delayMs);
  }

  /** Stop the pending timers (disconnection, shutdown). */
  stop() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Track a player seen in a session.
   * @param {ReturnType<typeof normalizeSession>} session
   * @returns {boolean} True when the player was never seen before.
   */
  rememberPlayer(session) {
    if (this.players.has(session.machineIdentifier)) {
      return false;
    }
    this.players.set(session.machineIdentifier, {
      machineIdentifier: session.machineIdentifier,
      name: session.playerName,
      product: session.playerProduct,
    });
    logger.info(`New Plex player discovered: ${session.playerName}`);
    return true;
  }

  /**
   * Intro/credits markers of the media a session is playing (cached per media).
   * @param {ReturnType<typeof normalizeSession>} session
   * @returns {Promise<Array<object>>}
   */
  async getMarkers(session) {
    if (!MARKER_MEDIA_TYPES.has(session.mediaType) || session.ratingKey === undefined) {
      return [];
    }
    if (!this.markerCache.has(session.ratingKey)) {
      try {
        this.markerCache.set(session.ratingKey, await this.api.getItemMarkers(session.ratingKey));
      } catch (err) {
        logger.debug(`Marker fetch failed for ${session.ratingKey}: ${err.message}`);
        return [];
      }
      // Bounded cache: evict the oldest entries (Map keeps insertion order).
      while (this.markerCache.size > MARKER_CACHE_MAX_ENTRIES) {
        this.markerCache.delete(this.markerCache.keys().next().value);
      }
    }
    return this.markerCache.get(session.ratingKey);
  }

  /**
   * Append a numeric state to the batch only when it changed since the last
   * publication.
   */
  collectIfChanged(states, featureExternalId, value) {
    if (this.lastPublished.get(featureExternalId) === value) {
      return;
    }
    this.lastPublished.set(featureExternalId, value);
    states.push({ device_feature_external_id: featureExternalId, state: value });
  }

  /**
   * Publish a text state only when it changed since the last publication.
   */
  async publishTextIfChanged(featureExternalId, text) {
    if (this.lastPublished.get(featureExternalId) === text) {
      return;
    }
    this.lastPublished.set(featureExternalId, text);
    await this.gladys.publishState(featureExternalId, { text });
  }
}

/**
 * Extract the player machine identifier from a device external id
 * ("ext:<selector>:player:<machineId>"), or null for non-player devices.
 * @param {string} externalId
 * @returns {string|null}
 */
export function extractPlayerMachineId(externalId) {
  const marker = ':player:';
  const index = externalId.indexOf(marker);
  return index === -1 ? null : externalId.slice(index + marker.length);
}
