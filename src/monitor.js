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
import { PlexApi, PLEX_METADATA_TYPES, PLEX_CLIENT_PORT } from './plex/api.js';
import {
  normalizeSession,
  commandTypeForMedia,
  isPrivateAddress,
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
    /**
     * Players advertised in the legacy `/clients` list. Empty on most modern
     * servers (clients no longer announce themselves over GDM), so it is only
     * ONE of the controllability hints — the per-session
     * `protocolCapabilities` is the reliable one. Commands are attempted
     * regardless; this only drives the warning logs.
     * @type {Set<string>}
     */
    this.controllable = new Set();
    /** @type {Set<string>} Players muted by us (Plex has no toggle command). */
    this.mutedPlayers = new Set();
    /** @type {Map<string, 'server'|'direct'>} Route that last reached a player. */
    this.workingRoute = new Map();
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
    const clients = await this.api.getClients();
    this.controllable = new Set();
    for (const client of clients) {
      if (client.machineIdentifier) {
        this.controllable.add(client.machineIdentifier);
        this.players.set(client.machineIdentifier, {
          machineIdentifier: client.machineIdentifier,
          name: client.name || client.product || client.machineIdentifier,
          product: client.product || '',
          // Kept for the direct command route: /clients is the one source
          // that carries the exact port the player listens on.
          address: client.address || '',
          port: client.port || null,
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

    // Idle players: every known player without an active session. Thanks to
    // the deduplication this is a no-op in steady state; it covers both the
    // "just went idle" transition and a device freshly created in Gladys
    // while nothing is playing (its publication cache was just reset).
    for (const machineIdentifier of this.players.keys()) {
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
      await this.sendPlayerCommand(machineIdentifier, key, PLAYER_COMMAND_PATHS[key], {
        type: commandType,
      });
    } else if (key === PLAYER_FEATURE.VOLUME) {
      const volume = Math.max(0, Math.min(100, Math.round(value)));
      await this.sendPlayerCommand(machineIdentifier, key, '/player/playback/setParameters', {
        type: commandType,
        volume,
      });
      await this.gladys.publishState(feature.external_id, volume);
    } else if (key === PLAYER_FEATURE.MUTE) {
      // Gladys renders mute as a push button: it always sends 1, so the
      // feature has to behave as a TOGGLE. Plex has no "toggle mute"
      // command, so we track the state we last set for this player.
      const muted = !this.mutedPlayers.has(machineIdentifier);
      await this.sendPlayerCommand(machineIdentifier, key, '/player/playback/setParameters', {
        type: commandType,
        mute: muted ? 1 : 0,
      });
      if (muted) {
        this.mutedPlayers.add(machineIdentifier);
      } else {
        this.mutedPlayers.delete(machineIdentifier);
      }
      await this.gladys.publishState(feature.external_id, muted ? 1 : 0);
    } else {
      throw new Error(`No command handler for ${feature.external_id}`);
    }

    // Playback commands change the session state: refresh shortly after, so
    // the UI reflects the new state without waiting for the next poll.
    this.scheduleSessionRefresh(1_500);
  }

  /**
   * Send one command to a player, proxied through the Plex server.
   *
   * We always TRY: the legacy `/clients` list is empty on most modern
   * servers (players no longer announce themselves over GDM), so refusing
   * upfront would block perfectly controllable apps — Plexamp, Plex Web,
   * the mobile apps. When the server cannot deliver the command, `stop`
   * falls back to terminating the stream server-side, which always works.
   *
   * @param {string} machineIdentifier - Target player.
   * @param {string} key - Feature key, for logs and the stop fallback.
   * @param {string} path - Plex command path.
   * @param {Record<string, string|number>} params - Command parameters.
   */
  async sendPlayerCommand(machineIdentifier, key, path, params) {
    const session = this.activeSessions.get(machineIdentifier);
    const failures = [];

    for (const route of this.commandRoutes(machineIdentifier, session)) {
      try {
        await this.api.playerCommand(machineIdentifier, path, params, route.options);
        logger.info(`Command ${key} sent to player ${machineIdentifier} (${route.name} route)`);
        // Remember what worked: the next command goes straight there instead
        // of paying for a failing attempt first.
        this.workingRoute.set(machineIdentifier, route.name);
        return;
      } catch (err) {
        failures.push(`${route.name}: ${err.message}`);
      }
    }

    if (key === PLAYER_FEATURE.STOP && session?.sessionId) {
      // Nothing could reach the player: kill the stream server-side. This
      // always works, whatever the player.
      await this.api.terminateSession(session.sessionId);
      logger.info(`Session of ${machineIdentifier} terminated server-side (stop fallback)`);
      return;
    }

    // The remembered route no longer answers: forget it so the next command
    // starts from the nominal order again.
    this.workingRoute.delete(machineIdentifier);
    logger.warn(`Command ${key} failed on every route -> ${failures.join(' | ')}`);
    throw new Error(
      `No route could reach this Plex player for "${key}". Its app must advertise ` +
        `itself as a player to accept remote control: enable "Advertise as player" ` +
        `(Plex mobile apps: Settings > Remote control) and run "Scan for Plex players".`,
    );
  }

  /**
   * Routes a command may take, best-known first.
   *
   * 1. THROUGH THE SERVER (`X-Plex-Target-Client-Identifier`): works for the
   *    players the server discovered itself — TV apps, consoles. The legacy
   *    `/clients` path.
   * 2. STRAIGHT TO THE PLAYER (`http://<lan address>:32500`): the route Plex
   *    controllers use to cast. It reaches players the server never
   *    discovered (broadcast blocked, separate VLAN...), provided the app
   *    advertises itself as a player.
   *
   * @param {string} machineIdentifier
   * @param {object} [session] - Active session of that player, if any.
   */
  commandRoutes(machineIdentifier, session) {
    const routes = [{ name: 'server', options: {} }];
    const origin = this.directOrigin(machineIdentifier, session);
    if (origin) {
      routes.push({ name: 'direct', options: { origin } });
    }
    // A player that answered on one route keeps answering there: try it
    // first so the usual case costs a single request.
    const known = this.workingRoute.get(machineIdentifier);
    if (known) {
      routes.sort((a, b) => (a.name === known ? -1 : b.name === known ? 1 : 0));
    }
    return routes;
  }

  /**
   * Base URL of the direct route to a player, or null when it has none.
   *
   * Best source first: the `/clients` entry, which carries the EXACT address
   * and port the player listens on (TV apps often use 3005, not 32500) and
   * exists even when the player is idle. Otherwise the active session's
   * address with the default player port — but only for LOCAL sessions: a
   * stream watched from outside the home reports a public address, and
   * knocking on a WAN IP would only waste the command's time budget.
   *
   * @param {string} machineIdentifier
   * @param {object} [session] - Active session of that player, if any.
   * @returns {string|null}
   */
  directOrigin(machineIdentifier, session) {
    const client = this.players.get(machineIdentifier);
    if (client?.address && this.controllable.has(machineIdentifier)) {
      return `http://${client.address}:${client.port || PLEX_CLIENT_PORT}`;
    }
    if (session?.address && (session.local || isPrivateAddress(session.address))) {
      return `http://${session.address}:${PLEX_CLIENT_PORT}`;
    }
    return null;
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
   * Forget the last published values, so the next refresh republishes
   * everything. Called when a device is created in Gladys: the states
   * published while it did not exist yet were dropped, and the deduplication
   * would otherwise never send them again.
   * @param {string} [externalIdPrefix] - Only forget the features of this
   *   device (its external_id); omit to forget everything.
   */
  resetPublicationCache(externalIdPrefix) {
    if (!externalIdPrefix) {
      this.lastPublished.clear();
      return;
    }
    for (const key of this.lastPublished.keys()) {
      if (key.startsWith(externalIdPrefix)) {
        this.lastPublished.delete(key);
      }
    }
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
