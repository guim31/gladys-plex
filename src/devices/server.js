// -----------------------------------------------------------------------------
// Device: PLEX MEDIA SERVER
//
// One device for the server itself, carrying the monitoring sensors the Home
// Assistant integration exposes:
//   - number of active playback sessions ("watching" count);
//   - number of sessions currently transcoding;
//   - total streaming bandwidth (kbps);
//   - a one-line "now playing" summary (who watches what);
//   - one item-count sensor per library (plus episodes for TV show libraries
//     and tracks for music libraries), optional via the `library_sensors`
//     config key.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'server';

export const SERVER_FEATURE = {
  ACTIVE_STREAMS: 'active-streams',
  TRANSCODE_SESSIONS: 'transcode-sessions',
  BANDWIDTH: 'bandwidth',
  NOW_PLAYING: 'now-playing',
};

/**
 * External ids of the server device.
 * @param {object} gladys - SDK instance.
 * @param {string} machineIdentifier - Stable Plex server identifier.
 */
export function serverExternalIds(gladys, machineIdentifier) {
  return gladys.externalIds(DEVICE_TYPE, machineIdentifier);
}

/**
 * Feature key of a library counter.
 * @param {{ key: string }} library - Library section.
 * @param {'count'|'episodes'|'tracks'} kind
 */
export function libraryFeatureKey(library, kind) {
  return `library-${library.key}-${kind}`;
}

/**
 * Build the discovery payload of the server device.
 * @param {object} gladys - SDK instance.
 * @param {{ friendlyName: string, machineIdentifier: string }} serverInfo
 * @param {Array<{ key: string, title: string, type: string }>} libraries
 * @param {{ library_sensors: boolean }} config
 */
export function buildServerDevice(gladys, serverInfo, libraries, config) {
  const ids = serverExternalIds(gladys, serverInfo.machineIdentifier);
  const counterFeature = (key, name, max = 100) => ({
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    min: 0,
    max,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  });

  const features = [
    counterFeature(SERVER_FEATURE.ACTIVE_STREAMS, 'Active streams'),
    counterFeature(SERVER_FEATURE.TRANSCODE_SESSIONS, 'Transcode sessions'),
    {
      name: 'Streaming bandwidth',
      external_id: ids.feature(SERVER_FEATURE.BANDWIDTH),
      category: DEVICE_FEATURE_CATEGORIES.DATARATE,
      type: DEVICE_FEATURE_TYPES.DATARATE.RATE,
      unit: DEVICE_FEATURE_UNITS.KILOBITS_PER_SECOND,
      min: 0,
      max: 1_000_000,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
    {
      name: 'Now playing',
      external_id: ids.feature(SERVER_FEATURE.NOW_PLAYING),
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: false,
      keep_history: false,
    },
  ];

  if (config.library_sensors) {
    for (const library of libraries) {
      features.push(counterFeature(libraryFeatureKey(library, 'count'), library.title, 1_000_000));
      if (library.type === 'show') {
        features.push(
          counterFeature(
            libraryFeatureKey(library, 'episodes'),
            `${library.title} (episodes)`,
            1_000_000,
          ),
        );
      }
      if (library.type === 'artist') {
        features.push(
          counterFeature(
            libraryFeatureKey(library, 'tracks'),
            `${library.title} (tracks)`,
            1_000_000,
          ),
        );
      }
    }
  }

  // No `poll_frequency` here: Gladys only accepts a closed list of fast
  // frequencies (1 s to 1 min, in ms) for device polling. The integration
  // refreshes the library statistics on its own timer instead
  // (config.poll_frequency seconds, see index.js).
  return {
    name: `Plex - ${serverInfo.friendlyName ?? 'Media Server'}`,
    external_id: ids.device,
    features,
  };
}
