// -----------------------------------------------------------------------------
// Plex Media Server HTTP API client.
//
// A thin wrapper around the local REST API of the Plex Media Server
// (https://<server>:32400). Every request is authenticated with the user's
// X-Plex-Token and asks for JSON (`Accept: application/json`), so no XML
// parsing is ever needed.
//
// Player commands are proxied THROUGH the server (the
// `X-Plex-Target-Client-Identifier` header selects the player): this is the
// same NAT/firewall-friendly path the official Plex apps use, and it avoids
// having to reach every player on its own address.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'plex-api' });

// Identifies this integration to the Plex server. Sent on every request; the
// server displays it in its own device list.
export const PLEX_CLIENT_HEADERS = {
  'X-Plex-Client-Identifier': 'gladys-plex-integration',
  'X-Plex-Product': 'Gladys Assistant',
  'X-Plex-Version': '1.0.3',
  'X-Plex-Device-Name': 'Gladys',
  'X-Plex-Platform': 'Node.js',
};

const REQUEST_TIMEOUT_MS = 10_000;

// Player commands get a much shorter budget than reads: Gladys expects the
// acknowledgement of a command within 5 s, and a command may be attempted on
// two routes (through the server, then straight to the player).
const COMMAND_TIMEOUT_MS = 2_000;

// Music panel (Gladys 5.3): Gladys waits 10 s for a music command, 15 s for
// an artwork. A listing is one request; playing chains up to three short
// ones (item, play queue, token) and the player command.
export const MUSIC_TIMEOUT_MS = { list: 5_000, step: 2_000, image: 4_000 };

// Port a Plex client advertising itself as a player listens on.
export const PLEX_CLIENT_PORT = 32500;

// Numeric Plex metadata types, used to count episodes/tracks in a library.
export const PLEX_METADATA_TYPES = {
  EPISODE: 4,
  TRACK: 10,
};

export class PlexApi {
  /**
   * @param {{ plex_url: string, plex_token: string, allow_self_signed?: boolean }} config
   */
  constructor(config) {
    this.baseUrl = config.plex_url;
    this.token = config.plex_token;
    // Global command counter: Plex players expect a monotonically increasing
    // commandID from a given controller.
    this.commandId = 0;
    if (config.allow_self_signed && this.baseUrl.startsWith('https://')) {
      // Native fetch offers no per-request TLS option. The integration runs
      // alone in its sandboxed container and only ever talks to the Plex
      // server, so relaxing TLS verification process-wide is acceptable here.
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  /**
   * Perform a GET request against the Plex server and return the parsed JSON
   * `MediaContainer` (or null for endpoints answering with an empty body).
   * @param {string} path - API path, starting with '/'.
   * @param {Record<string, string|number>} [params] - Query string parameters.
   * @param {Record<string, string>} [extraHeaders] - Additional headers.
   * @returns {Promise<object|null>}
   */
  async request(path, params = {}, extraHeaders = {}, options = {}) {
    const origin = options.origin ?? this.baseUrl;
    const url = new URL(origin + path);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          Accept: options.binary ? 'image/*' : 'application/json',
          'X-Plex-Token': this.token,
          ...PLEX_CLIENT_HEADERS,
          ...extraHeaders,
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // URL.origin drops any user:password@ part: never log credentials.
      throw new Error(`Plex server unreachable at ${new URL(origin).origin}: ${err.message}`, {
        cause: err,
      });
    }
    if (response.status === 401) {
      throw new Error('Plex authentication failed: check the X-Plex-Token.');
    }
    if (!response.ok) {
      throw new Error(`Plex API error on ${path}: HTTP ${response.status}`);
    }
    if (options.binary) {
      return Buffer.from(await response.arrayBuffer());
    }
    if (options.ignoreBody) {
      // A player answers its commands in XML (`<Response code="200" …/>`),
      // whatever the Accept header: the status code is the answer.
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const text = await response.text();
    if (text.length === 0) {
      return null;
    }
    return JSON.parse(text);
  }

  /**
   * Server identity: stable machine identifier + version. Cheap endpoint,
   * also used as the connectivity test.
   * @returns {Promise<{ machineIdentifier: string, version: string }>}
   */
  async getIdentity() {
    const data = await this.request('/identity');
    const container = data?.MediaContainer ?? {};
    return {
      machineIdentifier: container.machineIdentifier,
      version: container.version,
    };
  }

  /**
   * Server root: friendly name and capabilities.
   * @returns {Promise<{ friendlyName: string, version: string, machineIdentifier: string }>}
   */
  async getServerInfo() {
    const data = await this.request('/');
    const container = data?.MediaContainer ?? {};
    return {
      friendlyName: container.friendlyName,
      version: container.version,
      machineIdentifier: container.machineIdentifier,
    };
  }

  /**
   * Currently active playback sessions.
   * @returns {Promise<Array<object>>} Raw session metadata entries.
   */
  async getSessions() {
    const data = await this.request('/status/sessions');
    return data?.MediaContainer?.Metadata ?? [];
  }

  /**
   * Library sections (Movies, TV Shows, Music...).
   * @returns {Promise<Array<{ key: string, title: string, type: string }>>}
   */
  async getLibraries() {
    const data = await this.request('/library/sections');
    return (data?.MediaContainer?.Directory ?? []).map((d) => ({
      key: String(d.key),
      title: d.title,
      type: d.type, // 'movie' | 'show' | 'artist' | 'photo'
    }));
  }

  /**
   * Number of top-level items in a library section (movies, shows, artists...).
   * Asking for a 0-sized container returns `totalSize` without any item.
   * @param {string} sectionKey
   * @param {number} [metadataType] - Optional Plex type filter (4 = episodes,
   *   10 = tracks) to count leaf items of a show/artist library.
   * @returns {Promise<number>}
   */
  async getLibraryCount(sectionKey, metadataType) {
    const params = { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 };
    if (metadataType !== undefined) {
      params.type = metadataType;
    }
    const data = await this.request(`/library/sections/${sectionKey}/all`, params);
    return data?.MediaContainer?.totalSize ?? 0;
  }

  /**
   * Players the server knows how to reach (advertised over GDM or plex.tv).
   * NOTE: the JSON element is called `Server` in this endpoint's answer.
   * @returns {Promise<Array<{ machineIdentifier: string, name: string, product: string, address: string }>>}
   */
  async getClients() {
    const data = await this.request('/clients');
    return (data?.MediaContainer?.Server ?? []).map((c) => ({
      machineIdentifier: c.machineIdentifier,
      name: c.name,
      product: c.product,
      // Where the player listens for direct commands. The port matters: TV
      // apps often listen on 3005, not the default 32500.
      address: c.address,
      port: c.port !== undefined ? Number(c.port) : null,
    }));
  }

  /**
   * Intro/credits markers of a media item, used for the "in intro" and
   * "in credits" sensors (same signal Home Assistant exposes).
   * @param {string|number} ratingKey
   * @returns {Promise<Array<{ type: string, startTimeOffset: number, endTimeOffset: number }>>}
   */
  async getItemMarkers(ratingKey) {
    const data = await this.request(`/library/metadata/${ratingKey}`, { includeMarkers: 1 });
    const metadata = data?.MediaContainer?.Metadata?.[0] ?? {};
    return (metadata.Marker ?? []).map((m) => ({
      type: m.type,
      startTimeOffset: m.startTimeOffset,
      endTimeOffset: m.endTimeOffset,
    }));
  }

  /**
   * Latest additions of every library, newest first. Plex groups the new
   * episodes of a show into their season.
   * @param {number} size - How many entries to fetch.
   * @returns {Promise<Array<object>>} Raw metadata entries (movie, season, album...).
   */
  async getRecentlyAdded(size) {
    const data = await this.request('/library/recentlyAdded', {
      'X-Plex-Container-Start': 0,
      'X-Plex-Container-Size': size,
    });
    return data?.MediaContainer?.Metadata ?? [];
  }

  /**
   * A library image (poster, fan art, album cover), resized by the server's
   * photo transcoder to fit a dashboard widget.
   * @param {string} imagePath - `thumb` / `art` path of a metadata entry.
   * @param {number} width
   * @param {number} height
   * @returns {Promise<Buffer>} JPEG bytes.
   */
  async getImage(imagePath, width, height, format, timeoutMs) {
    // Without `format`, the transcoder keeps the format of the source: a PNG
    // cover comes back as a heavy PNG (186 KB at 400 px for a noisy one,
    // checked on PMS 1.43, labelled image/jpeg). `format=jpeg` gives ~30 KB.
    return this.request(
      '/photo/:/transcode',
      { url: imagePath, width, height, minSize: 1, upscale: 0, ...(format ? { format } : {}) },
      {},
      { binary: true, ...(timeoutMs ? { timeoutMs } : {}) },
    );
  }

  // --- Music library (Gladys 5.3 music panel) ---------------------------------

  /**
   * One page of a MediaContainer listing, with its full size.
   * @param {string} path
   * @param {Record<string, string|number>} params
   * @param {{ offset?: number, limit?: number }} [page]
   * @returns {Promise<{ items: Array<object>, total: number }>}
   */
  async page(path, params = {}, { offset = 0, limit = 50 } = {}) {
    const data = await this.request(
      path,
      { ...params, 'X-Plex-Container-Start': offset, 'X-Plex-Container-Size': limit },
      {},
      { timeoutMs: MUSIC_TIMEOUT_MS.list },
    );
    const container = data?.MediaContainer ?? {};
    const items = container.Metadata ?? container.Directory ?? [];
    const total = Number(container.totalSize);
    if (Number.isInteger(total) && total >= 0) {
      return { items, total };
    }
    // No full size (`size` is the page's): a full page announces one more
    // row, so the panel asks for the next page.
    return { items, total: offset + items.length + (items.length >= limit ? 1 : 0) };
  }

  /**
   * One library item, or null when the server does not know it (404).
   * @param {string} ratingKey
   * @returns {Promise<object|null>}
   */
  async getMetadata(ratingKey) {
    try {
      const data = await this.request(
        `/library/metadata/${encodeURIComponent(ratingKey)}`,
        {},
        {},
        { timeoutMs: MUSIC_TIMEOUT_MS.step },
      );
      return data?.MediaContainer?.Metadata?.[0] ?? null;
    } catch (err) {
      if (/HTTP 404/.test(err.message)) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Search every library (`/hubs/search`): one hub per item type, `limit`
   * items per hub at most.
   * @param {string} query
   * @param {number} limit
   * @returns {Promise<Array<{ type: string, items: Array<object> }>>}
   */
  async searchHubs(query, limit) {
    const data = await this.request(
      '/hubs/search',
      { query, limit },
      {},
      { timeoutMs: MUSIC_TIMEOUT_MS.list },
    );
    return (data?.MediaContainer?.Hub ?? []).map((hub) => ({
      type: hub.type,
      items: hub.Metadata ?? [],
    }));
  }

  /**
   * Create a play queue on the server (what a Plex app plays from).
   * @param {{ uri?: string, playlistID?: string }} source
   * @returns {Promise<object>} The MediaContainer of the new queue.
   */
  async createPlayQueue({ uri, playlistID }) {
    const data = await this.request(
      '/playQueues',
      {
        type: 'audio',
        ...(uri ? { uri } : {}),
        ...(playlistID ? { playlistID } : {}),
        shuffle: 0,
        repeat: 0,
        continuous: 0,
        own: 1,
      },
      {},
      { method: 'POST', timeoutMs: MUSIC_TIMEOUT_MS.step },
    );
    return data?.MediaContainer ?? {};
  }

  /**
   * Add items to an existing play queue, after the current item (`next`) or
   * at the end.
   * @param {string|number} playQueueId
   * @param {{ uri?: string, playlistID?: string }} source
   * @param {boolean} next
   */
  async addToPlayQueue(playQueueId, { uri, playlistID }, next) {
    const data = await this.request(
      `/playQueues/${encodeURIComponent(playQueueId)}`,
      { ...(uri ? { uri } : {}), ...(playlistID ? { playlistID } : {}), next: next ? 1 : 0 },
      {},
      { method: 'PUT', timeoutMs: MUSIC_TIMEOUT_MS.step },
    );
    return data?.MediaContainer ?? {};
  }

  /**
   * A page of a play queue. The server follows the item the player reports
   * (`playQueueSelectedItemOffset`) and pages with the container headers
   * (checked on PMS 1.43).
   * @param {string|number} playQueueId
   * @param {{ offset: number, limit: number }} page
   * @returns {Promise<{ items: Array<object>, total: number, currentIndex: number|null }>}
   */
  async getPlayQueue(playQueueId, { offset, limit }) {
    const data = await this.request(
      `/playQueues/${encodeURIComponent(playQueueId)}`,
      { own: 0, 'X-Plex-Container-Start': offset, 'X-Plex-Container-Size': limit },
      {},
      { timeoutMs: MUSIC_TIMEOUT_MS.list },
    );
    const container = data?.MediaContainer ?? {};
    const items = container.Metadata ?? [];
    const total = Number(container.playQueueTotalCount);
    const current = Number(container.playQueueSelectedItemOffset);
    return {
      items,
      total: Number.isInteger(total) && total >= 0 ? total : items.length,
      currentIndex: Number.isInteger(current) && current >= 0 ? current : null,
    };
  }

  /**
   * A short-lived token a player can use to stream from the server (what the
   * official controllers hand over in `playMedia`). Null only when the
   * server has none to give (an unclaimed server answers 400 or 403, checked
   * on PMS 1.43): a timeout or a server error throws, so the configured token
   * is never handed over by default.
   * @returns {Promise<string|null>}
   */
  async getTransientToken() {
    try {
      const data = await this.request(
        '/security/token',
        { type: 'delegation', scope: 'all' },
        {},
        { timeoutMs: MUSIC_TIMEOUT_MS.step },
      );
      return data?.MediaContainer?.token ?? null;
    } catch (err) {
      if (/HTTP (400|403|404)\b/.test(err.message)) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Terminate an active playback session server-side. Used as the `stop`
   * fallback for players the server cannot control remotely.
   * @param {string} sessionId - The `Session.id` of the active session.
   * @param {string} [reason] - Message displayed on the interrupted player.
   */
  async terminateSession(sessionId, reason = 'Stopped from Gladys Assistant') {
    logger.debug(`Terminating session ${sessionId}`);
    // Short budget: this call is the LAST leg of the stop fallback, after up
    // to two failed command attempts, and the whole chain must fit in the
    // 5 s Gladys waits for a command acknowledgement.
    await this.request(
      '/status/sessions/terminate',
      { sessionId, reason },
      {},
      { timeoutMs: COMMAND_TIMEOUT_MS },
    );
  }

  /**
   * Send a playback command to a player, proxied through the server.
   * @param {string} machineIdentifier - Target player identifier.
   * @param {string} path - Command path, e.g. '/player/playback/play'.
   * @param {Record<string, string|number>} [params] - Command parameters.
   */
  async playerCommand(machineIdentifier, path, params = {}, options = {}) {
    this.commandId += 1;
    logger.debug(`Player command ${path} -> ${machineIdentifier} (${options.origin ?? 'server'})`);
    await this.request(
      path,
      { ...params, commandID: this.commandId },
      { 'X-Plex-Target-Client-Identifier': machineIdentifier },
      // Gladys acks a command within 5 s: keep every attempt short so the
      // server route, the direct route and the fallback all fit in budget.
      { timeoutMs: COMMAND_TIMEOUT_MS, ignoreBody: true, ...options },
    );
  }
}
