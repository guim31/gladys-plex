// -----------------------------------------------------------------------------
// The catalog of the Gladys 5.3 music panel (manifest `music`): browse,
// search, play, the play queue, and the bytes of the artworks. Read on demand
// from the Plex server, never stored. Everything comes back as MediaItems
// whose `id` is `<kind>:<ratingKey>` (`album:14`, `track:16`), opaque to
// Gladys and carried back by a play command and by the `music.play-media`
// scene action; our own folders use `gladys:`. A ratingKey stays the same as
// long as the item stays in the library.
//
// What the server gives (checked on Plex Media Server 1.43, unclaimed):
//   - every listing pages itself (`X-Plex-Container-Start` / `-Size`,
//     `totalSize`), play queues included (`playQueueTotalCount`);
//   - the play queue of a player is NOT in /status/sessions: its id comes
//     with the `playing` notifications of the socket (`playQueueID`), and the
//     server follows the item the player reports
//     (`playQueueSelectedItemOffset`);
//   - `/hubs/search` answers one hub per type (artist, album, track,
//     playlist…), `limit` items per hub;
//   - the photo transcoder keeps the format of the source unless asked:
//     `format=jpeg` (a noisy PNG cover: 186 KB as PNG, 31 KB as JPEG).
//
// Playing goes through a server play queue handed over to the player by the
// companion command `playMedia` (what the Plex apps and Home Assistant do);
// adding to the queue changes the server queue, then asks the player to
// reload it (`refreshPlayQueue`); jumping is `skipTo`. These three commands
// depend on the player app: refused, they surface as an error in the panel.
// -----------------------------------------------------------------------------

import { artworkKey, MUSIC_MEDIA_TYPES } from '@gladysassistant/integration-sdk';
import { localized, localizedError } from './messages.js';

/** Our folders. Plex ratingKeys are numbers: no clash with `gladys:`. */
export const FOLDER = {
  section: 'gladys:section:',
  artists: 'gladys:artists:',
  albums: 'gladys:albums:',
  playlists: 'gladys:playlists',
};

/** Plex item type -> MediaItem type. */
const KIND_OF_TYPE = {
  track: MUSIC_MEDIA_TYPES.TRACK,
  album: MUSIC_MEDIA_TYPES.ALBUM,
  artist: MUSIC_MEDIA_TYPES.ARTIST,
  playlist: MUSIC_MEDIA_TYPES.PLAYLIST,
};

/** Plex numeric types of a section listing. */
const SECTION_TYPE = { artist: 8, album: 9 };

/** Artwork sizes asked from the server (px): the player frame, a list row. */
export const ARTWORK_SIZE = { player: 400, list: 128 };

/** Bytes of an artwork the core accepts. */
export const MAX_ARTWORK_BYTES = 300 * 1024;

const MAX_ARTWORKS = 1000;
const MAX_TEXT = 200;
const PLAY_MODES = new Set(['replace', 'next', 'append']);

const clip = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, MAX_TEXT) : null;

/**
 * `<kind>:<ratingKey>` of a MediaItem id, or null for anything else.
 * @param {unknown} id
 * @returns {{ kind: string, ratingKey: string }|null}
 */
export function parseMediaId(id) {
  const match = /^(track|album|artist|playlist):(\d{1,12})$/.exec(String(id ?? ''));
  return match ? { kind: match[1], ratingKey: match[2] } : null;
}

export class MusicCatalog {
  /**
   * @param {import('./monitor.js').PlexMonitor} monitor
   */
  constructor(monitor) {
    this.monitor = monitor;
    /** @type {Map<string, { path: string, size: number }>} by artwork key */
    this.artworks = new Map();
  }

  get api() {
    return this.monitor.api;
  }

  get language() {
    return this.monitor.config.language;
  }

  // --- Artwork -------------------------------------------------------------------

  /**
   * URL of a library image at a size, through the photo transcoder, recorded
   * so its key can be served. The key is the SDK's (`artworkKey(url)`): the
   * thumb path carries the image's timestamp, so the key changes with the
   * image. The token is never in the URL (it is sent as a header).
   * @param {string|null} path - `thumb` path of the server.
   * @param {number} size
   * @returns {string|null}
   */
  artworkUrl(path, size) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      return null;
    }
    const url =
      `${this.api.baseUrl}/photo/:/transcode?width=${size}&height=${size}` +
      `&minSize=1&upscale=0&format=jpeg&url=${encodeURIComponent(path)}`;
    const key = artworkKey(url);
    this.artworks.delete(key);
    this.artworks.set(key, { path, size });
    while (this.artworks.size > MAX_ARTWORKS) {
      this.artworks.delete(this.artworks.keys().next().value);
    }
    return url;
  }

  /**
   * onMusicGetArtwork: the bytes of a recorded artwork, as JPEG resized by
   * the server, with the token (the default handler of the SDK would send
   * none and get a 401 from a claimed server).
   * @param {string} key
   * @returns {Promise<string>} Raw base64.
   */
  async artwork(key) {
    const artwork = this.artworks.get(key);
    if (!artwork) {
      throw new Error(`Unknown artwork ${key}`);
    }
    let size = artwork.size;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const bytes = await this.api.getImage(artwork.path, size, size, 'jpeg');
      if (bytes.length <= MAX_ARTWORK_BYTES) {
        return bytes.toString('base64');
      }
      size = Math.round(size * 0.7);
    }
    throw new Error(`Artwork ${artwork.path} too large`);
  }

  // --- Browse and search -------------------------------------------------------

  /** Music libraries of the server (type `artist`). */
  musicSections() {
    return this.monitor.libraries.filter((library) => library.type === 'artist');
  }

  /**
   * onMusicBrowse: our folders, then the library.
   * @param {{ external_id: string }} device
   * @param {{ parentId: string|null, offset: number, limit: number }} options
   */
  async browse(device, { parentId, offset = 0, limit = 50 }) {
    this.monitor.playerOf(device); // a player, or throws
    if (!parentId) {
      return this.folders(this.rootFolders(), offset, limit);
    }
    if (parentId.startsWith(FOLDER.section)) {
      const section = this.sectionOf(parentId.slice(FOLDER.section.length));
      return this.folders(this.sectionFolders(section), offset, limit);
    }
    let answer;
    if (parentId === FOLDER.playlists) {
      answer = await this.api.page('/playlists', { playlistType: 'audio' }, { offset, limit });
    } else if (parentId.startsWith(FOLDER.artists) || parentId.startsWith(FOLDER.albums)) {
      const artists = parentId.startsWith(FOLDER.artists);
      const section = this.sectionOf(
        parentId.slice((artists ? FOLDER.artists : FOLDER.albums).length),
      );
      answer = await this.api.page(
        `/library/sections/${encodeURIComponent(section.key)}/all`,
        { type: artists ? SECTION_TYPE.artist : SECTION_TYPE.album, sort: 'titleSort' },
        { offset, limit },
      );
    } else {
      const media = parseMediaId(parentId);
      if (!media || media.kind === MUSIC_MEDIA_TYPES.TRACK) {
        throw localizedError('notBrowsable', this.language);
      }
      await this.itemOf(media);
      const path =
        media.kind === MUSIC_MEDIA_TYPES.PLAYLIST
          ? `/playlists/${media.ratingKey}/items`
          : `/library/metadata/${media.ratingKey}/children`;
      answer = await this.api.page(path, {}, { offset, limit });
    }
    return { items: answer.items.map((item) => this.toMediaItem(item)), total: answer.total };
  }

  /** The root: Artists / Albums of a single music library, or one folder per library. */
  rootFolders() {
    const sections = this.musicSections();
    const folders =
      sections.length === 1
        ? this.sectionFolders(sections[0])
        : sections.map((section) => [
            `${FOLDER.section}${section.key}`,
            clip(section.title) ?? '?',
          ]);
    return [...folders, [FOLDER.playlists, localized('folderPlaylists', this.language)]];
  }

  sectionFolders(section) {
    return [
      [`${FOLDER.artists}${section.key}`, localized('folderArtists', this.language)],
      [`${FOLDER.albums}${section.key}`, localized('folderAlbums', this.language)],
    ];
  }

  folders(entries, offset, limit) {
    const items = entries.map(([id, title]) => ({
      id,
      type: MUSIC_MEDIA_TYPES.FOLDER,
      title,
      browsable: true,
      playable: false,
    }));
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  /** A music library by key, or a localized error (removed since). */
  sectionOf(key) {
    const section = this.musicSections().find((library) => library.key === key);
    if (!section) {
      throw localizedError('gone', this.language);
    }
    return section;
  }

  /**
   * onMusicSearch: artists, albums, tracks and audio playlists by name.
   * @param {{ external_id: string }} device
   * @param {{ query: string, type: string|null, limit: number }} options
   */
  async search(device, { query, type, limit = 20 }) {
    this.monitor.playerOf(device);
    const hubs = await this.api.searchHubs(query, limit);
    const items = [];
    for (const hub of hubs) {
      const kind = KIND_OF_TYPE[hub.type];
      if (!kind || (type && type !== kind)) {
        continue;
      }
      for (const item of hub.items) {
        // A video playlist is no music.
        if (item?.type === 'playlist' && item.playlistType !== 'audio') {
          continue;
        }
        items.push(this.toMediaItem(item));
      }
    }
    return { items: items.slice(0, limit) };
  }

  /**
   * A server item as a MediaItem. Never dropped: an item of an unexpected
   * type stays as a neutral row (the panel pages by rows received, and the
   * queue highlights by index).
   * @param {object} item - Raw server item.
   */
  toMediaItem(item) {
    const kind = KIND_OF_TYPE[item?.type];
    const ratingKey = String(item?.ratingKey ?? '');
    const title = clip(item?.title) ?? (ratingKey || '?');
    if (!kind || !/^\d{1,12}$/.test(ratingKey)) {
      return {
        id: `other:${ratingKey || 'unknown'}`.slice(0, 512),
        type: MUSIC_MEDIA_TYPES.TRACK,
        title,
        browsable: false,
        playable: false,
      };
    }
    const isTrack = kind === MUSIC_MEDIA_TYPES.TRACK;
    const path = isTrack
      ? (item.parentThumb ?? item.thumb)
      : kind === MUSIC_MEDIA_TYPES.PLAYLIST
        ? (item.composite ?? item.thumb)
        : item.thumb;
    const artwork = this.artworkUrl(path ?? null, ARTWORK_SIZE.list);
    const duration = Number(item.duration);
    return {
      id: `${kind}:${ratingKey}`,
      type: kind,
      title,
      subtitle: isTrack
        ? clip(item.originalTitle ?? item.grandparentTitle)
        : kind === MUSIC_MEDIA_TYPES.ALBUM
          ? clip(item.parentTitle)
          : null,
      duration: isTrack && duration > 0 ? Math.round(duration / 1000) : null,
      artwork_key: artwork ? artworkKey(artwork) : null,
      browsable: !isTrack,
      playable: true,
    };
  }

  /**
   * The library item of a media id, checked against its kind: a scene keeps
   * an id for months, the item may have been removed since.
   * @param {{ kind: string, ratingKey: string }} media
   */
  async itemOf(media) {
    const item = await this.api.getMetadata(media.ratingKey);
    if (!item || KIND_OF_TYPE[item.type] !== media.kind) {
      throw localizedError('gone', this.language);
    }
    if (media.kind === MUSIC_MEDIA_TYPES.PLAYLIST && item.playlistType !== 'audio') {
      throw localizedError('notPlayable', this.language);
    }
    return item;
  }

  // --- Play ------------------------------------------------------------------------

  /**
   * What a play queue is built from: a library URI, or a playlist id.
   * @param {{ kind: string, ratingKey: string }} media
   */
  sourceOf(media) {
    if (media.kind === MUSIC_MEDIA_TYPES.PLAYLIST) {
      return { playlistID: media.ratingKey };
    }
    const server = this.monitor.serverInfo.machineIdentifier;
    return {
      uri: `server://${server}/com.plexapp.plugins.library/library/metadata/${media.ratingKey}`,
    };
  }

  /**
   * onMusicPlay (and the `music.play-media` scene action): play a track, an
   * album, an artist or a playlist on the player — now, next, or at the end
   * of its queue. Next / at the end need the player's current play queue
   * (known from the notification socket): without one, the media is played.
   * @param {{ external_id: string }} device
   * @param {{ id: string, type?: string }} media
   * @param {'replace'|'next'|'append'} mode
   */
  async play(device, media, mode = 'replace') {
    const player = this.monitor.playerOf(device);
    if (!PLAY_MODES.has(mode)) {
      throw localizedError('badValue', this.language);
    }
    const parsed = parseMediaId(media?.id);
    if (!parsed) {
      throw localizedError('notPlayable', this.language);
    }
    await this.itemOf(parsed);
    const source = this.sourceOf(parsed);

    const queue = mode === 'replace' ? null : this.monitor.playQueueOf(player.machineIdentifier);
    if (queue) {
      await this.api.addToPlayQueue(queue.playQueueID, source, mode === 'next');
      await this.monitor.sendPlayerCommand(
        player.machineIdentifier,
        `music ${mode}`,
        '/player/playback/refreshPlayQueue',
        { playQueueID: queue.playQueueID, type: 'music' },
      );
      this.monitor.logPlay(player, `${parsed.kind} ${parsed.ratingKey}`, mode);
      return;
    }

    const created = await this.api.createPlayQueue(source);
    const first =
      (created.Metadata ?? []).find(
        (item) => String(item.playQueueItemID) === String(created.playQueueSelectedItemID),
      ) ?? created.Metadata?.[0];
    if (!created.playQueueID || !first?.key) {
      throw localizedError('emptyMedia', this.language);
    }
    await this.monitor.sendPlayerCommand(
      player.machineIdentifier,
      'music play',
      '/player/playback/playMedia',
      await this.playMediaParams(created.playQueueID, first.key),
    );
    this.monitor.logPlay(player, `${parsed.kind} ${parsed.ratingKey}`, 'replace');
    this.monitor.scheduleSessionRefresh(2_000);
  }

  /**
   * Parameters of `playMedia`: where the player finds the server and the
   * queue (what python-plexapi sends). The token is a short-lived one when
   * the server can give it, the configured one otherwise.
   * @param {string|number} playQueueId
   * @param {string} key - `/library/metadata/<ratingKey>` of the first item.
   */
  async playMediaParams(playQueueId, key) {
    const server = new URL(this.api.baseUrl);
    const protocol = server.protocol.replace(':', '');
    return {
      providerIdentifier: 'com.plexapp.plugins.library',
      machineIdentifier: this.monitor.serverInfo.machineIdentifier,
      protocol,
      address: server.hostname,
      port: server.port || (protocol === 'https' ? 443 : 80),
      offset: 0,
      key,
      token: (await this.api.getTransientToken()) ?? this.api.token,
      containerKey: `/playQueues/${playQueueId}?window=100&own=1`,
      type: 'music',
    };
  }

  // --- Queue -----------------------------------------------------------------------

  /**
   * onMusicQueueGet: a page of the player's current play queue. Every row of
   * the server queue is kept (the panel highlights `currentIndex - offset`).
   * @param {{ external_id: string }} device
   * @param {{ offset: number, limit: number }} options
   */
  async queue(device, { offset = 0, limit = 50 }) {
    const player = this.monitor.playerOf(device);
    const queue = this.monitor.playQueueOf(player.machineIdentifier);
    if (!queue) {
      return { items: [], currentIndex: null, total: 0 };
    }
    const page = await this.api.getPlayQueue(queue.playQueueID, { offset, limit });
    return {
      items: page.items.map((item) => this.toMediaItem(item)),
      currentIndex: page.currentIndex,
      total: page.total,
    };
  }

  /**
   * onMusicQueuePlay: jump to an item of the play queue (`skipTo`).
   * @param {{ external_id: string }} device
   * @param {number} index - In the full queue.
   */
  async queuePlay(device, index) {
    const player = this.monitor.playerOf(device);
    const queue = this.monitor.playQueueOf(player.machineIdentifier);
    if (!queue) {
      throw localizedError('nothingLoaded', this.language, { player: player.name });
    }
    if (!Number.isInteger(index) || index < 0) {
      throw localizedError('notInQueue', this.language);
    }
    const page = await this.api.getPlayQueue(queue.playQueueID, { offset: index, limit: 1 });
    const item = page.items[0];
    if (!item?.key || index >= page.total) {
      throw localizedError('notInQueue', this.language);
    }
    await this.monitor.sendPlayerCommand(
      player.machineIdentifier,
      'music skipTo',
      '/player/playback/skipTo',
      { key: item.key, playQueueItemID: item.playQueueItemID, type: 'music' },
    );
    this.monitor.scheduleSessionRefresh(1_500);
  }
}
