// -----------------------------------------------------------------------------
// Realistic (trimmed) payloads of the Plex Media Server JSON API, used by the
// unit tests. Shapes match what a real server answers with
// `Accept: application/json`.
// -----------------------------------------------------------------------------

export const IDENTITY = {
  MediaContainer: {
    machineIdentifier: 'srv-abc123',
    version: '1.41.0.8994',
  },
};

export const SERVER_INFO = {
  MediaContainer: {
    friendlyName: 'Home Cinema',
    machineIdentifier: 'srv-abc123',
    version: '1.41.0.8994',
  },
};

export const LIBRARIES = {
  MediaContainer: {
    Directory: [
      { key: '1', title: 'Films', type: 'movie' },
      { key: '2', title: 'Séries', type: 'show' },
      { key: '3', title: 'Musique', type: 'artist' },
    ],
  },
};

export const CLIENTS = {
  MediaContainer: {
    Server: [
      {
        machineIdentifier: 'client-tv',
        name: 'TV Salon',
        product: 'Plex for Apple TV',
        address: '192.168.1.30',
      },
    ],
  },
};

// One episode playing on the living-room TV, one track paused on a phone.
export const SESSIONS = {
  MediaContainer: {
    Metadata: [
      {
        ratingKey: '4242',
        type: 'episode',
        title: 'Winter Is Coming',
        grandparentTitle: 'Game of Thrones',
        parentIndex: 1,
        index: 1,
        viewOffset: 65_000,
        duration: 3_600_000,
        User: { title: 'guilhem' },
        Player: {
          machineIdentifier: 'client-tv',
          title: 'TV Salon',
          product: 'Plex for Apple TV',
          state: 'playing',
          protocolCapabilities: 'timeline,playback,navigation,mirror,playqueues',
        },
        Session: { id: 'sess-1', bandwidth: 12_000 },
        TranscodeSession: { videoDecision: 'transcode' },
      },
      {
        ratingKey: '7777',
        type: 'track',
        title: 'Get Lucky',
        grandparentTitle: 'Daft Punk',
        parentTitle: 'Random Access Memories',
        viewOffset: 30_000,
        duration: 369_000,
        User: { title: 'ana' },
        // Streaming but NOT remotely controllable: no `playback` controller
        // and absent from /clients (the "Plexamp on iPad" case reported on
        // the forum).
        Player: {
          machineIdentifier: 'client-phone',
          title: 'Pixel 9',
          product: 'Plex for Android',
          state: 'paused',
          protocolCapabilities: 'timeline',
        },
        Session: { id: 'sess-2', bandwidth: 320 },
      },
    ],
  },
};

export const EMPTY_SESSIONS = { MediaContainer: { size: 0 } };

// Markers of the episode: intro from 30 s to 90 s, credits from 55 min.
export const EPISODE_METADATA_WITH_MARKERS = {
  MediaContainer: {
    Metadata: [
      {
        ratingKey: '4242',
        Marker: [
          { type: 'intro', startTimeOffset: 30_000, endTimeOffset: 90_000 },
          { type: 'credits', startTimeOffset: 3_300_000, endTimeOffset: 3_600_000 },
        ],
      },
    ],
  },
};

export const LIBRARY_COUNTS = {
  1: { MediaContainer: { totalSize: 250 } },
  2: { MediaContainer: { totalSize: 40 } },
  '2-episodes': { MediaContainer: { totalSize: 1200 } },
  3: { MediaContainer: { totalSize: 85 } },
  '3-tracks': { MediaContainer: { totalSize: 5400 } },
};
