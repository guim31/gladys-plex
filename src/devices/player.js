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
//   sensors : playback state, now playing title, remaining minutes,
//             "in intro" and "in credits" binary markers (automation-friendly:
//             dim the lights when the credits start rolling).
//
// Gladys 5.3 music player (capabilities/music.md): the playback state is
// writable (0 pause, 1 play, 2 stop), and the "now playing" features title,
// artist, album, artwork, duration and position (writable: a seek) are
// published by `publishNowPlaying` with `nowPlayingOf()` below. The external
// ids of the features published before 5.3 never change: `playback-state`
// (passed through `featureExternalIds`), `volume` and `mute` (converted from
// television/volume_mute to music/mute by "Update" in Discover). The new ones
// follow the SDK's `${device}:${type}` convention. No shuffle nor repeat: the
// server does not report them (only the player's own timeline does).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  MUSIC_PLAYBACK_STATE,
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
  // Gladys 5.3: keys equal to the music types (`${device}:${type}`).
  TITLE: 'title',
  ARTIST: 'artist',
  ALBUM: 'album',
  ARTWORK: 'artwork',
  DURATION: 'duration',
  POSITION: 'position',
};

/** Upper bound of the duration and position features (seconds). */
export const MAX_SECONDS = 86_400;

/**
 * `featureExternalIds` of publishNowPlaying: the playback state kept its
 * pre-5.3 id; every other type follows `${device}:${type}`.
 * @param {{ feature: (key: string) => string }} ids - The player's external ids.
 */
export function nowPlayingFeatureIds(ids) {
  return { playback_state: ids.feature(PLAYER_FEATURE.PLAYBACK_STATE) };
}

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
  // A read-only music feature (the texts and the artwork key take 0/0).
  const sensor = (key, name, type, extra = {}) => ({
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.MUSIC,
    type,
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    keep_history: false,
    ...extra,
  });
  // A writable music feature: the player confirms every write (has_feedback).
  const control = (key, name, type, max, extra = {}) => ({
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.MUSIC,
    type,
    min: 0,
    max,
    read_only: false,
    has_feedback: true,
    keep_history: false,
    ...extra,
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
        has_feedback: true,
        keep_history: false,
      },
      // television/volume_mute before 1.3: same id, converted by "Update".
      control(PLAYER_FEATURE.MUTE, 'Mute', DEVICE_FEATURE_TYPES.MUSIC.MUTE, 1),
      // Read-only 0/1 before 1.3: same id, now writable (2 = stop).
      control(
        PLAYER_FEATURE.PLAYBACK_STATE,
        'Playback state',
        DEVICE_FEATURE_TYPES.MUSIC.PLAYBACK_STATE,
        MUSIC_PLAYBACK_STATE.IDLE,
      ),
      // min/max are meaningless for a text state but the Gladys device model
      // requires them on every feature (NOT NULL columns).
      sensor(PLAYER_FEATURE.TITLE, 'Title', DEVICE_FEATURE_TYPES.MUSIC.TITLE),
      sensor(PLAYER_FEATURE.ARTIST, 'Artist', DEVICE_FEATURE_TYPES.MUSIC.ARTIST),
      sensor(PLAYER_FEATURE.ALBUM, 'Album', DEVICE_FEATURE_TYPES.MUSIC.ALBUM),
      sensor(PLAYER_FEATURE.ARTWORK, 'Artwork', DEVICE_FEATURE_TYPES.MUSIC.ARTWORK),
      sensor(PLAYER_FEATURE.DURATION, 'Duration', DEVICE_FEATURE_TYPES.MUSIC.DURATION, {
        unit: DEVICE_FEATURE_UNITS.SECONDS,
        max: MAX_SECONDS,
      }),
      control(
        PLAYER_FEATURE.POSITION,
        'Position',
        DEVICE_FEATURE_TYPES.MUSIC.POSITION,
        MAX_SECONDS,
        {
          unit: DEVICE_FEATURE_UNITS.SECONDS,
        },
      ),
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

const seconds = (ms) => Math.max(0, Math.floor((Number(ms) || 0) / 1000));

/**
 * Title, artist and album lines of what a session plays: a track (title /
 * artist / album), an episode (title / show / season), a movie or a live
 * channel (its title alone).
 * @param {ReturnType<import('../plex/sessions.js').normalizeMetadata>} item
 */
export function describeItem(item) {
  if (item.type === 'episode') {
    return { title: item.name, artist: item.seriesName, album: item.seasonName };
  }
  if (item.type === 'track') {
    return { title: item.name, artist: item.trackArtist || item.artist, album: item.album };
  }
  return { title: item.name, artist: '', album: '' };
}

/**
 * Library image of what a session plays, best fit for the square frame of
 * the music widget: the album cover of a track, the show poster of an
 * episode, the poster of a movie.
 * @param {ReturnType<import('../plex/sessions.js').normalizeMetadata>} item
 * @returns {string|null} A `thumb` path of the server.
 */
export function artworkPathOf(item) {
  const images = item?.images ?? {};
  if (item?.type === 'track') {
    return images.parentThumb ?? images.thumb ?? null;
  }
  if (item?.type === 'episode') {
    return images.grandparentThumb ?? images.thumb ?? null;
  }
  return images.thumb ?? null;
}

/** Plex player state -> MUSIC_PLAYBACK_STATE. */
const PLAYBACK_STATE_OF = {
  playing: MUSIC_PLAYBACK_STATE.PLAYING,
  paused: MUSIC_PLAYBACK_STATE.PAUSED,
  buffering: MUSIC_PLAYBACK_STATE.BUFFERING,
  stopped: MUSIC_PLAYBACK_STATE.IDLE,
};

/**
 * The snapshot given to publishNowPlaying (Gladys 5.3). No session: IDLE and
 * the texts cleared explicitly (an absent key means "unchanged"). The
 * position is the last one the player reported to the server (the server
 * does not extrapolate it): the SDK republishes it on a state or title
 * change, or a drift of more than 3 s — never every second. Volume and mute
 * are not in a session: they are published after a command that set them.
 * @param {ReturnType<import('../plex/sessions.js').normalizeSession>|null} session
 * @param {(path: string) => string|null} artworkUrl - Proxied URL of a thumb path.
 */
export function nowPlayingOf(session, artworkUrl) {
  if (!session?.item) {
    return {
      playback_state: MUSIC_PLAYBACK_STATE.IDLE,
      title: '',
      artist: '',
      album: '',
      artwork_url: null,
      duration: 0,
      position: 0,
    };
  }
  const path = artworkPathOf(session.item);
  return {
    playback_state: PLAYBACK_STATE_OF[session.state] ?? MUSIC_PLAYBACK_STATE.PLAYING,
    ...describeItem(session.item),
    artwork_url: path ? artworkUrl(path) : null,
    // 0 for live TV: the music box shows "Live".
    duration: session.item.live ? 0 : Math.min(MAX_SECONDS, seconds(session.duration)),
    position: Math.min(MAX_SECONDS, seconds(session.viewOffset)),
  };
}
