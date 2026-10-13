// -----------------------------------------------------------------------------
// In-memory stand-in for the Plex API client (src/plex/api.js), answering with
// the fixtures of test/fixtures/plex.js. Shared by the monitor and loop tests.
// -----------------------------------------------------------------------------

import {
  SERVER_INFO,
  LIBRARIES,
  CLIENTS,
  SESSIONS,
  EPISODE_METADATA_WITH_MARKERS,
  LIBRARY_COUNTS,
} from '../fixtures/plex.js';

export function createFakeApi({
  sessions = SESSIONS,
  refuseCommands = false,
  refuseServer = false,
} = {}) {
  const commands = [];
  return {
    commands,
    sessions,
    refuseCommands,
    refuseServer,
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
    async playerCommand(machineIdentifier, path, params, options = {}) {
      if (this.refuseCommands) {
        throw new Error('Plex API error on /player/playback/play: HTTP 404');
      }
      // `refuseServer` reproduces the real-world case: the server will not
      // relay to a player it never discovered, but the player answers on its
      // own address.
      if (this.refuseServer && options.origin === undefined) {
        throw new Error('Plex API error on /player/playback/play: HTTP 404');
      }
      commands.push({
        machineIdentifier,
        path,
        params,
        ...(options.origin ? { origin: options.origin } : {}),
      });
    },
    async terminateSession(sessionId) {
      commands.push({ terminated: sessionId });
    },
    images: [],
    async getImage(path, width, height) {
      this.images.push({ path, width, height });
      return this.imageBytes?.(width) ?? Buffer.from([0xff, 0xd8, 0xff]);
    },
    async getRecentlyAdded() {
      return [
        {
          ratingKey: '2',
          type: 'movie',
          title: 'Sintel',
          year: 2010,
          thumb: '/library/metadata/2/thumb/9',
        },
      ];
    },
  };
}
