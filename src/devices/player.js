// -----------------------------------------------------------------------------
// Device: PLEX PLAYER
//
// One device per Plex player (app, TV, Chromecast...) known to the server —
// the equivalent of a Home Assistant `media_player` entity. Playback controls
// use the MUSIC feature family (the one the Gladys dashboard "Music" widget
// understands, Sonos-style) completed with the TELEVISION push buttons that
// MUSIC lacks (stop, seek back/forward):
//
//   controls: play, pause, stop, previous, next, rewind, forward, volume, mute
//   sensors : playback state (0/1), now playing title, remaining minutes,
//             "in intro" and "in credits" binary markers (automation-friendly:
//             dim the lights when the credits start rolling).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'player';

export const PLAYER_FEATURE = {
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  PREVIOUS: 'previous',
  NEXT: 'next',
  REWIND: 'rewind',
  FORWARD: 'forward',
  VOLUME: 'volume',
  MUTE: 'mute',
  PLAYBACK_STATE: 'playback-state',
  NOW_PLAYING: 'now-playing',
  REMAINING: 'remaining',
  IN_INTRO: 'intro',
  IN_CREDITS: 'credits',
};

// Command features -> Plex player command path (proxied through the server).
export const PLAYER_COMMAND_PATHS = {
  [PLAYER_FEATURE.PLAY]: '/player/playback/play',
  [PLAYER_FEATURE.PAUSE]: '/player/playback/pause',
  [PLAYER_FEATURE.STOP]: '/player/playback/stop',
  [PLAYER_FEATURE.PREVIOUS]: '/player/playback/skipPrevious',
  [PLAYER_FEATURE.NEXT]: '/player/playback/skipNext',
  [PLAYER_FEATURE.REWIND]: '/player/playback/stepBack',
  [PLAYER_FEATURE.FORWARD]: '/player/playback/stepForward',
};

/**
 * External ids of a player device.
 * @param {object} gladys - SDK instance.
 * @param {string} machineIdentifier - Stable Plex player identifier.
 */
export function playerExternalIds(gladys, machineIdentifier) {
  return gladys.externalIds(DEVICE_TYPE, machineIdentifier);
}

/**
 * Feature key of a player feature external id, or null when the external id
 * belongs to another device ("ext:selector:player:<machineId>:<key>").
 * @param {string} featureExternalId
 * @param {{ device: string }} ids - The player's external ids.
 * @returns {string|null}
 */
export function playerFeatureKey(featureExternalId, ids) {
  const prefix = `${ids.device}:`;
  return featureExternalId.startsWith(prefix) ? featureExternalId.slice(prefix.length) : null;
}

/**
 * Build the discovery payload of one player device.
 * @param {object} gladys - SDK instance.
 * @param {{ machineIdentifier: string, name: string, product: string }} player
 */
export function buildPlayerDevice(gladys, player) {
  const ids = playerExternalIds(gladys, player.machineIdentifier);
  const pushButton = (key, name, category, type) => ({
    name,
    external_id: ids.feature(key),
    category,
    type,
    min: 1,
    max: 1,
    read_only: false,
    has_feedback: false,
    keep_history: false,
  });

  return {
    name: `Plex - ${player.name}${player.product ? ` (${player.product})` : ''}`,
    external_id: ids.device,
    features: [
      pushButton(
        PLAYER_FEATURE.PLAY,
        'Play',
        DEVICE_FEATURE_CATEGORIES.MUSIC,
        DEVICE_FEATURE_TYPES.MUSIC.PLAY,
      ),
      pushButton(
        PLAYER_FEATURE.PAUSE,
        'Pause',
        DEVICE_FEATURE_CATEGORIES.MUSIC,
        DEVICE_FEATURE_TYPES.MUSIC.PAUSE,
      ),
      pushButton(
        PLAYER_FEATURE.STOP,
        'Stop',
        DEVICE_FEATURE_CATEGORIES.TELEVISION,
        DEVICE_FEATURE_TYPES.TELEVISION.STOP,
      ),
      pushButton(
        PLAYER_FEATURE.PREVIOUS,
        'Previous',
        DEVICE_FEATURE_CATEGORIES.MUSIC,
        DEVICE_FEATURE_TYPES.MUSIC.PREVIOUS,
      ),
      pushButton(
        PLAYER_FEATURE.NEXT,
        'Next',
        DEVICE_FEATURE_CATEGORIES.MUSIC,
        DEVICE_FEATURE_TYPES.MUSIC.NEXT,
      ),
      pushButton(
        PLAYER_FEATURE.REWIND,
        'Rewind',
        DEVICE_FEATURE_CATEGORIES.TELEVISION,
        DEVICE_FEATURE_TYPES.TELEVISION.REWIND,
      ),
      pushButton(
        PLAYER_FEATURE.FORWARD,
        'Forward',
        DEVICE_FEATURE_CATEGORIES.TELEVISION,
        DEVICE_FEATURE_TYPES.TELEVISION.FORWARD,
      ),
      {
        name: 'Volume',
        external_id: ids.feature(PLAYER_FEATURE.VOLUME),
        category: DEVICE_FEATURE_CATEGORIES.MUSIC,
        type: DEVICE_FEATURE_TYPES.MUSIC.VOLUME,
        min: 0,
        max: 100,
        read_only: false,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'Mute',
        external_id: ids.feature(PLAYER_FEATURE.MUTE),
        category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
        type: DEVICE_FEATURE_TYPES.TELEVISION.VOLUME_MUTE,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'Playback state',
        external_id: ids.feature(PLAYER_FEATURE.PLAYBACK_STATE),
        category: DEVICE_FEATURE_CATEGORIES.MUSIC,
        type: DEVICE_FEATURE_TYPES.MUSIC.PLAYBACK_STATE,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'Now playing',
        external_id: ids.feature(PLAYER_FEATURE.NOW_PLAYING),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        // min/max are meaningless for a text state but the Gladys device
        // model requires them on every feature (NOT NULL columns).
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'Remaining time',
        external_id: ids.feature(PLAYER_FEATURE.REMAINING),
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        unit: DEVICE_FEATURE_UNITS.MINUTES,
        min: 0,
        max: 100_000,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'In intro',
        external_id: ids.feature(PLAYER_FEATURE.IN_INTRO),
        category: DEVICE_FEATURE_CATEGORIES.INPUT,
        type: DEVICE_FEATURE_TYPES.INPUT.BINARY,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'In credits',
        external_id: ids.feature(PLAYER_FEATURE.IN_CREDITS),
        category: DEVICE_FEATURE_CATEGORIES.INPUT,
        type: DEVICE_FEATURE_TYPES.INPUT.BINARY,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
    ],
  };
}
