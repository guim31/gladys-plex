// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the integration modules rely on:
//   - externalIds(type, platformId)  -> { device, feature(key) }
//   - publishState / publishStates   -> record calls so tests can assert them
//   - publishDiscoveredDevices       -> record calls so tests can assert them
//   - publishSceneEvent              -> record calls so tests can assert them
//   - requestWidgetRefresh           -> record calls so tests can assert them
//   - setConnectionStatus            -> record calls so tests can assert them
//   - publishNowPlaying              -> recorded in `nowPlaying`, and each
//     value expanded into `published` / `textStates` under its feature id
//     (no diff: the SDK's own diff is tested with its fake, test/music.test.js)
// This lets us test the wiring logic (discovery payloads, dispatch, state
// publication) without a running Gladys server or a real WebSocket.
// -----------------------------------------------------------------------------

import { artworkKey } from '@gladysassistant/integration-sdk';

const TEXT_TYPES = new Set(['title', 'artist', 'album', 'artwork']);

export function createFakeGladys() {
  const published = [];
  const textStates = [];
  const discovered = [];
  const connectionStatuses = [];
  const sceneEvents = [];
  const widgetRefreshes = [];
  const nowPlaying = [];

  return {
    published,
    textStates,
    discovered,
    connectionStatuses,
    sceneEvents,
    widgetRefreshes,
    nowPlaying,

    externalIds(type, platformId) {
      const device = `ext:plex:${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      if (typeof state === 'object' && state !== null && state.text !== undefined) {
        textStates.push({ featureExternalId, text: state.text });
      } else {
        published.push({ featureExternalId, state });
      }
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({ featureExternalId: s.device_feature_external_id, state: s.state });
      }
    },

    async publishDiscoveredDevices(devices) {
      discovered.push(devices);
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data) {
      sceneEvents.push({ key, data });
    },

    async publishNowPlaying(device, snapshot, options = {}) {
      nowPlaying.push({ device, snapshot: { ...snapshot }, options });
      for (const [key, value] of Object.entries(snapshot)) {
        const type = key === 'artwork_url' ? 'artwork' : key;
        const featureExternalId = options.featureExternalIds?.[type] ?? `${device}:${type}`;
        if (TEXT_TYPES.has(type)) {
          const text = type === 'artwork' ? (value ? artworkKey(value) : '') : value;
          textStates.push({ featureExternalId, text });
        } else {
          published.push({ featureExternalId, state: value });
        }
      }
    },

    async requestWidgetRefresh(key) {
      widgetRefreshes.push(key);
    },
  };
}
