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
  'X-Plex-Version': '1.0.0',
  'X-Plex-Device-Name': 'Gladys',
  'X-Plex-Platform': 'Node.js',
};

const REQUEST_TIMEOUT_MS = 10_000;

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
  async request(path, params = {}, extraHeaders = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Plex-Token': this.token,
          ...PLEX_CLIENT_HEADERS,
          ...extraHeaders,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Plex server unreachable at ${this.baseUrl}: ${err.message}`, { cause: err });
    }
    if (response.status === 401) {
      throw new Error('Plex authentication failed: check the X-Plex-Token.');
    }
    if (!response.ok) {
      throw new Error(`Plex API error on ${path}: HTTP ${response.status}`);
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
      address: c.address,
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
   * Send a playback command to a player, proxied through the server.
   * @param {string} machineIdentifier - Target player identifier.
   * @param {string} path - Command path, e.g. '/player/playback/play'.
   * @param {Record<string, string|number>} [params] - Command parameters.
   */
  async playerCommand(machineIdentifier, path, params = {}) {
    this.commandId += 1;
    logger.debug(`Player command ${path} -> ${machineIdentifier}`);
    await this.request(
      path,
      { ...params, commandID: this.commandId },
      { 'X-Plex-Target-Client-Identifier': machineIdentifier },
    );
  }
}
