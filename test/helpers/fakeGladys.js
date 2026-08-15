// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the integration modules rely on:
//   - externalIds(type, platformId)  -> { device, feature(key) }
//   - publishState / publishStates   -> record calls so tests can assert them
//   - publishDiscoveredDevices       -> record calls so tests can assert them
//   - setConnectionStatus            -> record calls so tests can assert them
// This lets us test the wiring logic (discovery payloads, dispatch, state
// publication) without a running Gladys server or a real WebSocket.
// -----------------------------------------------------------------------------

export function createFakeGladys() {
  const published = [];
  const textStates = [];
  const discovered = [];
  const connectionStatuses = [];

  return {
    published,
    textStates,
    discovered,
    connectionStatuses,

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
  };
}
